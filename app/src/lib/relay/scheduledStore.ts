/**
 * Where scheduled cash outs live in production: the same Redis the relay's
 * locks use (lib/relay/inflight, Upstash REST). A job outlives a redeploy and
 * is seen by every instance, so the cron finds it whichever one runs.
 *
 *   gloam:cashout:job:<id>                 the job, JSON, kept JOB_TTL_SEC
 *   gloam:cashout:due                      sorted set of live job ids by send time
 *   gloam:cashout:nf:<chainId>:<nullifier> the job scheduled for that spend
 *   gloam:cashout:lock:<id>                a short lock while one run works on it
 *
 * Without Redis there is nowhere shared to keep a job, so scheduling is refused
 * (scheduledStoreReady) rather than kept in one instance's memory, except on a
 * local dev server.
 */
import { randomUUID } from "crypto";
import type { Hex } from "viem";
import { redisConfigured } from "@/lib/tractionStore";
import { JOB_TTL_SEC, isLive, memoryJobStore, type CashOutJob, type JobStore } from "./scheduled";

const PREFIX = "gloam:cashout:";
const DUE = `${PREFIX}due`;
const REDIS_TIMEOUT_MS = 4_000;

async function redis(args: (string | number)[]): Promise<unknown> {
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

const RELEASE_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

function nfKey(chainId: number, nullifier: Hex) {
  return `${PREFIX}nf:${chainId}:${nullifier.toLowerCase()}`;
}

function redisJobStore(): JobStore {
  return {
    async get(id) {
      const raw = await redis(["GET", `${PREFIX}job:${id}`]);
      if (typeof raw !== "string") return null;
      try {
        return JSON.parse(raw) as CashOutJob;
      } catch {
        return null;
      }
    },
    async put(job) {
      await redis(["SET", `${PREFIX}job:${job.id}`, JSON.stringify(job), "EX", JOB_TTL_SEC]);
      if (isLive(job.status)) {
        await redis(["ZADD", DUE, job.sendAfter, job.id]);
        await redis(["SET", nfKey(job.chainId, job.nullifier), job.id, "EX", JOB_TTL_SEC]);
      } else {
        await redis(["ZREM", DUE, job.id]);
      }
    },
    async due(now, limit) {
      const ids = await redis(["ZRANGEBYSCORE", DUE, "-inf", now, "LIMIT", 0, limit]);
      return Array.isArray(ids) ? ids.map(String) : [];
    },
    async byNullifier(chainId, nullifier) {
      const id = await redis(["GET", nfKey(chainId, nullifier)]);
      if (typeof id !== "string") return null;
      const job = await this.get(id);
      return job && isLive(job.status) ? id : null;
    },
    async lock(id, ttlSec) {
      const key = `${PREFIX}lock:${id}`;
      const token = randomUUID();
      if ((await redis(["SET", key, token, "NX", "EX", ttlSec])) !== "OK") return null;
      return async () => {
        try {
          await redis(["EVAL", RELEASE_SCRIPT, 1, key, token]);
        } catch {
          /* it expires on its own */
        }
      };
    },
    async forget(id) {
      await redis(["ZREM", DUE, id]);
    },
  };
}

let local: JobStore | null = null;

/** Whether jobs can be kept somewhere every instance and the cron can read. */
export function scheduledStoreReady(): boolean {
  return redisConfigured() || process.env.NODE_ENV !== "production";
}

/** The job store: Redis when set, else (dev only) this process's memory. */
export function scheduledStore(): JobStore {
  if (redisConfigured()) return redisJobStore();
  local ??= memoryJobStore();
  return local;
}
