/**
 * Per-IP rate limits, shared by the hosted MCP server and the API routes.
 * Fixed windows: one minute unless the caller asks for longer (an hour, a day).
 *
 * Counts that guard money, accounts or paid APIs live in Upstash Redis
 * (UPSTASH_REDIS_REST_URL + _TOKEN, the same REST pipeline as lib/tractionStore)
 * so every serverless instance shares them, and fall back to process memory
 * when Redis is not set or does not answer. Counts for cheap reads (LOCAL_BUCKETS)
 * stay in memory: every request there used to cost Redis commands, and the
 * Vercel firewall already limits each IP across instances.
 * IPs are stored hashed, never in the clear, and expire with their window.
 */
import { createHash } from "crypto";
import { redisConfigured } from "@/lib/tractionStore";

const WINDOW_SEC = 60;

/**
 * Buckets counted per instance, never in Redis: public reads, page analytics,
 * MCP requests and the helper bot's per-minute limits. What stays shared: the
 * relay, sign-in recovery, the testers form, admin and partner sign-in, partner
 * writes, address screening (a paid API) and the bot's daily model caps.
 */
const LOCAL_BUCKETS = new Set([
  "req",
  "verify",
  "collect",
  "funnel",
  "markets",
  "activity",
  "vault-leaves",
  "api-ip",
  "screen-policy",
  "tg-user",
  "tg-global",
  "tg-bug",
  "tg-warn",
  "tg-classify",
]);
const PREFIX = "gloam:mcp:rl:";
const MEM_MAX_KEYS = 10_000;

export type RateResult = { allowed: boolean; limit: number; remaining: number; retryAfterSec: number };

/** The client's IP as the platform reports it (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "local";
}

/**
 * The unit a limit counts. An IPv4 address counts on its own. An IPv6 address
 * counts by its /64 network, because one household or server can rotate
 * through billions of addresses inside its /64 and dodge a per-address limit.
 */
export function ipBucket(ip: string): string {
  const raw = ip.trim().toLowerCase().split("%")[0] ?? "";
  if (!raw.includes(":")) return raw;
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return mapped[1];
  let groups: string[];
  if (raw.includes("::")) {
    const [head = "", tail = ""] = raw.split("::");
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  } else {
    groups = raw.split(":");
  }
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

function ipKey(ip: string): string {
  return createHash("sha256").update(`gloam-mcp|${ipBucket(ip)}`).digest("hex").slice(0, 32);
}

function memCounts(): Map<string, { n: number; exp: number }> {
  const g = globalThis as { __gloamMcpRate?: Map<string, { n: number; exp: number }> };
  if (!g.__gloamMcpRate) g.__gloamMcpRate = new Map();
  return g.__gloamMcpRate;
}

function memIncr(key: string, now: number, windowSec: number): number {
  const m = memCounts();
  if (m.size > MEM_MAX_KEYS) {
    for (const [k, v] of m) if (v.exp <= now) m.delete(k);
    if (m.size > MEM_MAX_KEYS) m.clear();
  }
  const cur = m.get(key);
  if (!cur || cur.exp <= now) {
    m.set(key, { n: 1, exp: now + windowSec * 1000 });
    return 1;
  }
  cur.n++;
  return cur.n;
}

let lastMissLog = 0;
/** A failed shared count falls back to this instance's memory; say so at most once a minute. */
function logRedisMiss(e: unknown) {
  const now = Date.now();
  if (now - lastMissLog < 60_000) return;
  lastMissLog = now;
  console.warn("gloam_ratelimit_redis_miss", e instanceof Error ? e.message : "unknown");
}

/** Upstash's REST pipeline: results in order, with the reason when a command fails. */
async function redisCall(cmds: (string | number)[][]): Promise<{ result?: unknown; error?: string }[]> {
  const url = process.env.UPSTASH_REDIS_REST_URL!.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim();
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
    cache: "no-store",
    signal: AbortSignal.timeout(2_000),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return (await res.json()) as { result?: unknown; error?: string }[];
}

/** One command per hit: the window's first hit also sets the expiry. */
async function redisIncr(key: string, windowSec: number): Promise<number> {
  const json = await redisCall([["INCR", key]]);
  const n = Number(json?.[0]?.result);
  if (!Number.isFinite(n) || n < 1) {
    // Upstash puts the reason (a spent quota, say) in the command's error
    const why = typeof json?.[0]?.error === "string" ? `: ${json[0].error.slice(0, 160)}` : "";
    throw new Error(`redis: bad INCR result${why}`);
  }
  // if this fails the key only lingers in storage; the next window counts under a new key
  if (n === 1) await redisCall([["EXPIRE", key, windowSec * 2]]).catch(() => {});
  return n;
}

/**
 * Counts one hit for `bucket` from this IP and says whether it is allowed.
 * `windowSec` is the window length (default one minute; 3600 for an hour,
 * 86400 for a UTC day). Never throws: when Redis fails, the in-memory count
 * decides.
 */
export async function hitRateLimit(
  ip: string,
  bucket: string,
  limit: number,
  now = Date.now(),
  windowSec = WINDOW_SEC,
): Promise<RateResult> {
  const span = Number.isSafeInteger(windowSec) && windowSec > 0 ? windowSec : WINDOW_SEC;
  const window = Math.floor(now / 1000 / span);
  // one-minute keys keep their old shape; longer windows name their length
  const slot = span === WINDOW_SEC ? `${window}` : `${span}s:${window}`;
  const key = `${PREFIX}${bucket}:${ipKey(ip)}:${slot}`;
  let n: number;
  if (redisConfigured() && !LOCAL_BUCKETS.has(bucket)) {
    try {
      n = await redisIncr(key, span);
    } catch (e) {
      logRedisMiss(e);
      n = memIncr(key, now, span);
    }
  } else {
    n = memIncr(key, now, span);
  }
  const retryAfterSec = Math.max(1, (window + 1) * span - Math.floor(now / 1000));
  return { allowed: n <= limit, limit, remaining: Math.max(0, limit - n), retryAfterSec };
}
