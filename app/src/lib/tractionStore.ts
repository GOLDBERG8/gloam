/**
 * Product event store for /admin traction.
 *
 * Persistence:
 *  1. Upstash Redis REST (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN), durable
 *  2. In-process ring buffer, last N events (lost on cold start; fine for dev)
 *
 * Besides the raw stream and all-time counters it keeps:
 *  - per-day counters (UTC), so the dashboard can show the last two weeks
 *  - breakdown counters for a few low-cardinality meta fields (kind, network,
 *    chainId, reason, booleans), e.g. "proof_created|kind=funds"
 *
 * On-chain volume/users are separate (see onchainMetrics), that is source of truth.
 */

export type StoredEvent = {
  t: string;
  path: string | null;
  ref: string | null;
  meta: Record<string, unknown> | null;
  ts: number;
  ua: string | null;
};

export type DailyCounters = { day: string; counters: Record<string, number> };

const MEM_MAX = 2_000;
const REDIS_LIST = "gloam:traction:events";
const REDIS_COUNTERS = "gloam:traction:counters";
const REDIS_DIMS = "gloam:traction:dims";
const REDIS_DAY_PREFIX = "gloam:traction:day:";
const REDIS_MAX = 5_000;
const DAY_TTL_SEC = 120 * 86_400;
/** Events and caches are best effort: a slow store is skipped, not waited on. */
const REDIS_TIMEOUT_MS = 4_000;
/** Days of per-day counters the summary returns (today included). */
export const DAILY_DAYS = 14;

/** Meta fields that become breakdown counters. Values are already sanitized by /api/collect. */
const DIM_KEYS = ["kind", "reason", "network", "chainId", "hasAmount", "hasNote", "hasProof", "relay"] as const;

const mem: StoredEvent[] = [];
const memCounters = new Map<string, number>();
const memDims = new Map<string, number>();
const memDaily = new Map<string, Map<string, number>>();

/** True when Upstash REST env vars are set (values are never read out here). */
export function redisConfigured() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function redisBase() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL!.trim().replace(/\/$/, ""),
    token: process.env.UPSTASH_REDIS_REST_TOKEN!.trim(),
  };
}

async function redisCommand(args: (string | number)[]): Promise<unknown> {
  const { url, token } = redisBase();
  const res = await fetch(`${url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const json = (await res.json()) as { result?: unknown };
  return json.result;
}

/** Several commands in one round trip (Upstash /pipeline). Results in order; a failed command gives null. */
async function redisPipeline(cmds: (string | number)[][]): Promise<unknown[]> {
  if (cmds.length === 0) return [];
  const { url, token } = redisBase();
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmds),
    cache: "no-store",
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: string }[];
  return json.map((r) => (r && !r.error ? (r.result ?? null) : null));
}

/** Small JSON cache in Redis for server-side snapshots (e.g. on-chain metrics). Null when unset or unavailable. */
export async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!redisConfigured()) return null;
  try {
    const raw = await redisCommand(["GET", key]);
    return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSec: number): Promise<void> {
  if (!redisConfigured()) return;
  try {
    await redisCommand(["SET", key, JSON.stringify(value), "EX", Math.max(1, Math.round(ttlSec))]);
  } catch {
    /* non-fatal: the caller still has its in-memory copy */
  }
}

/** UTC day, YYYY-MM-DD. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The last `n` UTC days, oldest first, ending today. */
export function lastDays(n: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(utcDay(now - i * 86_400_000));
  return out;
}

function dimKeysFor(ev: StoredEvent): string[] {
  if (!ev.meta) return [];
  const out: string[] = [];
  for (const k of DIM_KEYS) {
    const v = ev.meta[k];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out.push(`${ev.t}|${k}=${String(v).slice(0, 24)}`);
    }
  }
  return out;
}

function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1);
}

/** Days this instance has already set the day counter's expiry for. */
const expirySet = new Set<string>();
/** Events this instance has stored since it last trimmed the recent list. */
let sinceTrim = 0;
/** Trim the recent list every this many events per instance, not on every one. */
const TRIM_EVERY = 25;

export async function recordTractionEvent(ev: StoredEvent): Promise<void> {
  mem.unshift(ev);
  if (mem.length > MEM_MAX) mem.length = MEM_MAX;
  bump(memCounters, ev.t);
  const dims = dimKeysFor(ev);
  for (const d of dims) bump(memDims, d);
  // Day of arrival, not the client's clock.
  const day = utcDay(Date.now());
  let dayMap = memDaily.get(day);
  if (!dayMap) {
    dayMap = new Map();
    memDaily.set(day, dayMap);
    const oldest = utcDay(Date.now() - 60 * 86_400_000);
    for (const k of [...memDaily.keys()]) if (k < oldest) memDaily.delete(k);
  }
  bump(dayMap, ev.t);

  if (!redisConfigured()) return;
  try {
    const dayKey = `${REDIS_DAY_PREFIX}${day}`;
    // each command is billed, so the list trim and the day's expiry run now and then, not per event
    const trim = ++sinceTrim >= TRIM_EVERY;
    const expire = !expirySet.has(day);
    await redisPipeline([
      ["LPUSH", REDIS_LIST, JSON.stringify(ev)],
      ...(trim ? [["LTRIM", REDIS_LIST, 0, REDIS_MAX - 1]] : []),
      ["HINCRBY", REDIS_COUNTERS, ev.t, 1],
      ["HINCRBY", REDIS_COUNTERS, "total", 1],
      ...dims.map((d) => ["HINCRBY", REDIS_DIMS, d, 1]),
      ["HINCRBY", dayKey, ev.t, 1],
      ...(expire ? [["EXPIRE", dayKey, DAY_TTL_SEC]] : []),
    ]);
    if (trim) sinceTrim = 0;
    if (expire) {
      if (expirySet.size > 7) expirySet.clear();
      expirySet.add(day);
    }
  } catch {
    /* non-fatal, memory still has it for this instance */
  }
}

function hashToRecord(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < raw.length; i += 2) {
    const k = raw[i];
    const v = Number(raw[i + 1]);
    if (typeof k === "string" && k) out[k] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

function mapToRecord(m: Map<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (m) for (const [k, v] of m) out[k] = v;
  return out;
}

export async function readTractionSummary(): Promise<{
  backend: "redis" | "memory";
  totalEvents: number;
  counters: Record<string, number>;
  /** "event|field=value" → count */
  dims: Record<string, number>;
  /** Oldest first, DAILY_DAYS long. */
  daily: DailyCounters[];
  recent: StoredEvent[];
}> {
  const days = lastDays(DAILY_DAYS);

  if (redisConfigured()) {
    try {
      const results = await redisPipeline([
        ["LRANGE", REDIS_LIST, 0, 99],
        ["HGETALL", REDIS_COUNTERS],
        ["HGETALL", REDIS_DIMS],
        ...days.map((d) => ["HGETALL", `${REDIS_DAY_PREFIX}${d}`]),
      ]);
      const [raw, countersRaw, dimsRaw, ...dayRaw] = results;
      const counters = hashToRecord(countersRaw);
      const recent: StoredEvent[] = [];
      for (const row of Array.isArray(raw) ? raw : []) {
        try {
          recent.push(JSON.parse(String(row)) as StoredEvent);
        } catch {
          /* skip */
        }
      }
      return {
        backend: "redis",
        totalEvents: counters.total ?? recent.length,
        counters,
        dims: hashToRecord(dimsRaw),
        daily: days.map((day, i) => ({ day, counters: hashToRecord(dayRaw[i]) })),
        recent,
      };
    } catch {
      /* fall through */
    }
  }

  return {
    backend: "memory",
    totalEvents: mem.length,
    counters: mapToRecord(memCounters),
    dims: mapToRecord(memDims),
    daily: days.map((day) => ({ day, counters: mapToRecord(memDaily.get(day)) })),
    recent: mem.slice(0, 100),
  };
}
