/**
 * One relay request per spend at a time.
 *
 * A private send or cash out is keyed by its nullifier. While one request for
 * it is being checked and sent, a second copy of the same proof is refused, so
 * copies sent at the same moment cannot each pass the dry run and then revert
 * on chain at the relay's expense (audit R-1).
 *
 * The lock is shared across serverless instances through Upstash Redis
 * (SET NX EX, same env and REST call as lib/mcpRemote/rateLimit), and falls
 * back to process memory when Redis is not set or does not answer.
 *
 * Whoever holds it releases it when the request fails before anything was
 * sent, so the user can retry right away. Once a transaction is out, the lock
 * stays until it expires: by then the spend has landed and the relay's spent
 * check refuses any copy.
 */
import { randomUUID } from "crypto";
import { redisConfigured } from "@/lib/tractionStore";

/**
 * How long a lock lives, in seconds. Once sent, a transaction lands within a
 * second or two on both relay chains (Robinhood Chain testnet is an Arbitrum
 * Orbit chain with blocks about every 0.25 s, Tempo about every 0.5 to 1 s).
 * The rest covers one request's slowest path before the send: the spent check,
 * the dry run and the send, each behind a 20 to 30 s RPC timeout.
 */
export const INFLIGHT_TTL_SEC = 180;

const PREFIX = "gloam:relay:inflight:";
const MEM_MAX_KEYS = 10_000;
const REDIS_TIMEOUT_MS = 2_000;

export type InflightLock = {
  key: string;
  /** Where the lock lives: shared Redis, or this instance's memory. */
  store: "redis" | "memory";
  /** Drops the lock if it is still ours. Never throws. */
  release: () => Promise<void>;
};

/** Lock key for one spend: chain id and nullifier (public on chain once spent). */
export function inflightKey(chainId: number, nullifier: string): string {
  return `${PREFIX}${chainId}:${nullifier.toLowerCase()}`;
}

// ---------------------------------------------------------------- memory

type Held = { token: string; exp: number };

function memLocks(): Map<string, Held> {
  const g = globalThis as { __gloamRelayInflight?: Map<string, Held> };
  if (!g.__gloamRelayInflight) g.__gloamRelayInflight = new Map();
  return g.__gloamRelayInflight;
}

function memTake(key: string, token: string, ttlSec: number, now: number): boolean {
  const m = memLocks();
  if (m.size > MEM_MAX_KEYS) {
    for (const [k, v] of m) if (v.exp <= now) m.delete(k);
    if (m.size > MEM_MAX_KEYS) m.clear();
  }
  const cur = m.get(key);
  if (cur && cur.exp > now) return false;
  m.set(key, { token, exp: now + ttlSec * 1000 });
  return true;
}

function memRelease(key: string, token: string): void {
  const m = memLocks();
  if (m.get(key)?.token === token) m.delete(key);
}

// ---------------------------------------------------------------- redis

async function redis(args: (string | number)[]): Promise<unknown> {
  if (!redisConfigured()) throw new Error("redis: not configured");
  const url = process.env.UPSTASH_REDIS_REST_URL!.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error("redis: command failed");
  return json.result ?? null;
}

// Delete only when the value is still our token, so a slow request whose lock
// already expired cannot drop the lock a newer request now holds.
const RELEASE_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

// ---------------------------------------------------------------- lock

/**
 * Takes the lock for `key` for `ttlSec` seconds, or returns null while another
 * request holds it. Never throws: when Redis fails, this instance's memory
 * decides.
 */
export async function takeInflight(
  key: string,
  ttlSec = INFLIGHT_TTL_SEC,
  now = Date.now(),
): Promise<InflightLock | null> {
  const ttl = Number.isSafeInteger(ttlSec) && ttlSec > 0 ? ttlSec : INFLIGHT_TTL_SEC;
  const token = randomUUID();
  if (redisConfigured()) {
    try {
      const got = (await redis(["SET", key, token, "NX", "EX", ttl])) === "OK";
      if (!got) return null;
      return {
        key,
        store: "redis",
        release: async () => {
          try {
            await redis(["EVAL", RELEASE_SCRIPT, 1, key, token]);
          } catch {
            /* it expires on its own */
          }
        },
      };
    } catch {
      /* Redis did not answer: fall through to memory */
    }
  }
  if (!memTake(key, token, ttl, now)) return null;
  return {
    key,
    store: "memory",
    release: async () => memRelease(key, token),
  };
}

// ---------------------------------------------------------------- send lane

const LANE_PREFIX = "gloam:relay:lane:";
const NONCE_PREFIX = "gloam:relay:nonce:";
/** A send holds its lane for at most this long: signing plus one RPC call, behind a 30 s timeout. */
const LANE_TTL_SEC = 35;
/** An idle lane forgets its nonce after this long and starts again from the chain. */
const NONCE_TTL_SEC = 300;
/** How long a request waits for its turn before the relay says it is busy. */
export const LANE_WAIT_MS = 25_000;

const memNonces = new Map<string, { next: number; exp: number }>();

async function storedNonce(lane: string): Promise<number | null> {
  try {
    const raw = await redis(["GET", NONCE_PREFIX + lane]);
    const n = Number(raw);
    return raw !== null && Number.isSafeInteger(n) ? n : null;
  } catch {
    const m = memNonces.get(lane);
    return m && m.exp > Date.now() ? m.next : null;
  }
}

async function saveNonce(lane: string, next: number): Promise<void> {
  memNonces.set(lane, { next, exp: Date.now() + NONCE_TTL_SEC * 1000 });
  try {
    await redis(["SET", NONCE_PREFIX + lane, next, "EX", NONCE_TTL_SEC]);
  } catch {
    /* memory keeps it for this instance */
  }
}

/** Drops the kept nonce, so the next send reads it from the chain again. Never throws. */
export async function forgetNonce(lane: string): Promise<void> {
  memNonces.delete(lane);
  try {
    await redis(["DEL", NONCE_PREFIX + lane]);
  } catch {
    /* it expires on its own */
  }
}

/**
 * Sends from one relay account go out one at a time, each with the next nonce.
 * Without this, sends arriving together on different instances all read the
 * same pending nonce and knock each other out. The lane is a short shared lock;
 * the nonce is kept beside it and is never behind the chain's pending count, so
 * a node that is a moment behind cannot hand out a used one. A send takes a few
 * hundred milliseconds, so a queue clears quickly. Returns null when the lane
 * stayed busy for `waitMs`.
 */
export async function inSendLane<T>(
  lane: string,
  chainNonce: () => Promise<number>,
  send: (nonce: number) => Promise<T>,
  waitMs = LANE_WAIT_MS,
): Promise<{ value: T } | null> {
  const out = await inSendLanes([{ id: lane, chainNonce }], (_, nonce) => send(nonce), waitMs);
  return out && { value: out.value };
}

/**
 * The same over several relay accounts (one lane each): the send takes the
 * first free lane, starting at a random one, so N accounts send N at a time.
 * Returns null when every lane stayed busy for `waitMs`.
 */
export async function inSendLanes<T>(
  lanes: { id: string; chainNonce: () => Promise<number> }[],
  send: (lane: number, nonce: number) => Promise<T>,
  waitMs = LANE_WAIT_MS,
): Promise<{ value: T; lane: number } | null> {
  if (!lanes.length) return null;
  const deadline = Date.now() + waitMs;
  const start = Math.floor(Math.random() * lanes.length);
  for (;;) {
    for (let k = 0; k < lanes.length; k++) {
      const i = (start + k) % lanes.length;
      const lane = lanes[i]!;
      const lock = await takeInflight(LANE_PREFIX + lane.id, LANE_TTL_SEC);
      if (!lock) continue;
      try {
        const [kept, onChain] = await Promise.all([storedNonce(lane.id), lane.chainNonce()]);
        const nonce = Math.max(onChain, kept ?? 0);
        const value = await send(i, nonce);
        await saveNonce(lane.id, nonce + 1);
        return { value, lane: i };
      } finally {
        await lock.release();
      }
    }
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 80 + Math.random() * 170));
  }
}
