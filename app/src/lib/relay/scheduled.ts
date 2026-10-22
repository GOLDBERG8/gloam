/**
 * Scheduled cash outs: "cash out later".
 *
 * A cash out is public (the asset, the amount and the wallet it pays), so one
 * that follows a payment within a minute can be matched to it by timing. Here
 * the browser makes the cash-out proof as usual and hands it to the relay with
 * a send time picked at random inside the window the person chose (an hour or
 * six). A cron sends due jobs through the normal relay path (lib/relay/server).
 *
 * A job holds no secret: the proof and its public inputs. The proof binds the
 * amount and the recipient, so whoever holds the job can only send it as it is
 * or not at all. Before sending, the chain is read: a root the vault no longer
 * keeps (it remembers its last 100) means the proof can't land, so the job
 * expires and nothing moved; a spent nullifier means the money already moved.
 *
 * Sending is idempotent. A job is taken under a short lock, marked "sending"
 * before the relay is called, and the chain is read first on every pass, so a
 * job that was sent but not recorded (a crash, a lost reply) settles as sent
 * instead of going out twice. The relay itself refuses a second copy of a
 * spend while one is in flight (lib/relay/inflight).
 *
 * This file is the logic and an in-memory store (for tests and local runs);
 * lib/relay/scheduledStore.ts keeps jobs in Redis in production.
 */
import type { Address, Hex } from "viem";

/** The longest a cash out may wait. */
export const MAX_DELAY_MS = 6 * 60 * 60 * 1000;
/** The windows the app offers. */
export const DELAY_WINDOWS = { hour: 60 * 60 * 1000, "6h": MAX_DELAY_MS } as const;
export type DelayWindow = keyof typeof DELAY_WINDOWS;
/** No earlier than this after it is scheduled, so even the shortest draw is not "right away". */
export const MIN_DELAY_MS = 2 * 60 * 1000;
/** A job that keeps failing for a passing reason (a busy relay, a slow node) gives up this long after its time. */
export const GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;
/** A job marked "sending" longer than this is read again: the send may have died with its instance. */
export const SENDING_STALE_MS = 5 * 60 * 1000;
/** How long a job record is kept, so the app can still read what happened. */
export const JOB_TTL_SEC = 3 * 24 * 60 * 60;

export type JobStatus =
  | "scheduled"
  | "sending"
  /** The relay sent it (hash set). The chain settles it. */
  | "sent"
  /** The vault no longer keeps the proof's root: nothing moved, cash out again. */
  | "expired"
  /** The note was already spent when the job came due (this cash out, or another spend). */
  | "spent"
  /** It could not go out (refused, or kept failing). Nothing moved. */
  | "failed"
  | "cancelled";

export type CashOutJob = {
  id: string;
  chainId: number;
  proof: Hex;
  root: Hex;
  nullifier: Hex;
  asset: Address;
  to: Address;
  /** Base units, as a decimal string. */
  amount: string;
  createdAt: number;
  sendAfter: number;
  status: JobStatus;
  attempts: number;
  updatedAt: number;
  hash?: Hex;
  /** A short, public reason when it failed (never a secret). */
  reason?: string;
};

/** What a person may read about a job: no proof, no inputs. */
export type JobView = Pick<CashOutJob, "id" | "chainId" | "sendAfter" | "status" | "updatedAt" | "hash" | "reason">;

export function jobView(j: CashOutJob): JobView {
  return {
    id: j.id,
    chainId: j.chainId,
    sendAfter: j.sendAfter,
    status: j.status,
    updatedAt: j.updatedAt,
    ...(j.hash ? { hash: j.hash } : {}),
    ...(j.reason ? { reason: j.reason } : {}),
  };
}

/** A send time drawn uniformly inside the window, never sooner than MIN_DELAY_MS. */
export function drawSendAfter(now: number, window: DelayWindow, random: () => number = Math.random): number {
  const span = DELAY_WINDOWS[window];
  return now + MIN_DELAY_MS + Math.floor(random() * (span - MIN_DELAY_MS));
}

export function isLive(status: JobStatus): boolean {
  return status === "scheduled" || status === "sending";
}

// ---------------------------------------------------------------- store

export interface JobStore {
  get(id: string): Promise<CashOutJob | null>;
  /** Saves the job, and keeps it in the due queue while it is live. */
  put(job: CashOutJob): Promise<void>;
  /** Ids due by `now`, oldest first. */
  due(now: number, limit: number): Promise<string[]>;
  /** The live job already scheduled for this spend, if any. */
  byNullifier(chainId: number, nullifier: Hex): Promise<string | null>;
  /** A short lock on one job; returns its release, or null while another run holds it. */
  lock(id: string, ttlSec: number): Promise<(() => Promise<void>) | null>;
  /** Takes an id whose job record is gone out of the due queue. */
  forget(id: string): Promise<void>;
}

/** Jobs in this process only: for tests and a local dev server without Redis. */
export function memoryJobStore(): JobStore {
  const jobs = new Map<string, CashOutJob>();
  const locks = new Map<string, number>();
  return {
    async get(id) {
      const j = jobs.get(id);
      return j ? { ...j } : null;
    },
    async put(job) {
      jobs.set(job.id, { ...job });
    },
    async due(now, limit) {
      return [...jobs.values()]
        .filter((j) => isLive(j.status) && j.sendAfter <= now)
        .sort((a, b) => a.sendAfter - b.sendAfter)
        .slice(0, limit)
        .map((j) => j.id);
    },
    async byNullifier(chainId, nullifier) {
      const n = nullifier.toLowerCase();
      const hit = [...jobs.values()].find((j) => j.chainId === chainId && j.nullifier.toLowerCase() === n && isLive(j.status));
      return hit?.id ?? null;
    },
    async lock(id, ttlSec) {
      const now = Date.now();
      const held = locks.get(id);
      if (held && held > now) return null;
      locks.set(id, now + ttlSec * 1000);
      return async () => {
        locks.delete(id);
      };
    },
    async forget(id) {
      jobs.delete(id);
    },
  };
}

// ---------------------------------------------------------------- running

/** The chain at send time: is the note spent, and does the vault still keep the proof's root. */
export type ChainView = { spent: boolean; knownRoot: boolean };

/** An error from a send: its relay code, and whether it can never succeed. */
export type SendFailure = { code: string; message: string };

export type RunDeps = {
  now: () => number;
  /** Reads the chain for this job; throws when the node can't be read. */
  readChain: (job: CashOutJob) => Promise<ChainView>;
  /** Sends the cash out through the relay; returns the hash, or throws a SendFailure-like error. */
  send: (job: CashOutJob) => Promise<Hex>;
};

/** Relay codes that mean this cash out can never go out as it is. */
const PERMANENT = new Set(["screened", "asset_policy", "vault_recipient", "InvalidProof", "InvalidAmount", "ZeroAddress", "network", "bad_request"]);

export type RunResult = { id: string; status: JobStatus | "skipped" };

/**
 * Sends the jobs due now, one at a time. Safe to run on several instances at
 * once and to re-run: each job is taken under its own lock, and the chain is
 * read before every send. Stops taking new jobs after `budgetMs`, so a run
 * ends well inside its function limit; the rest go on the next pass.
 */
export async function runDueJobs(store: JobStore, deps: RunDeps, limit = 20, budgetMs = 40_000): Promise<RunResult[]> {
  const out: RunResult[] = [];
  const start = deps.now();
  for (const id of await store.due(start, limit)) {
    if (deps.now() - start > budgetMs) break;
    const release = await store.lock(id, 90);
    if (!release) {
      out.push({ id, status: "skipped" });
      continue;
    }
    try {
      out.push({ id, status: await runOne(store, deps, id) });
    } finally {
      await release();
    }
  }
  return out;
}

/** A job that is done no longer needs its proof: it is dropped, so it can never be sent later. */
function retire(job: CashOutJob, status: JobStatus): CashOutJob {
  return isLive(status) ? job : { ...job, proof: "0x" };
}

async function settle(store: JobStore, job: CashOutJob, status: JobStatus, now: number, extra: Partial<CashOutJob> = {}) {
  await store.put(retire({ ...job, ...extra, status, updatedAt: now }, status));
  return status;
}

async function runOne(store: JobStore, deps: RunDeps, id: string): Promise<JobStatus | "skipped"> {
  const job = await store.get(id);
  if (!job) {
    await store.forget(id);
    return "skipped";
  }
  const now = deps.now();
  if (!isLive(job.status)) return job.status;
  if (job.sendAfter > now) return "skipped";
  // Another run is sending it right now (its lock may have lapsed mid-send).
  if (job.status === "sending" && now - job.updatedAt < SENDING_STALE_MS) return "skipped";

  let chain: ChainView;
  try {
    chain = await deps.readChain(job);
  } catch {
    // The node did not answer: try again on the next pass, unless it is long overdue.
    if (now - job.sendAfter > GIVE_UP_AFTER_MS) return settle(store, job, "failed", now, { reason: "The network could not be read in time." });
    return settle(store, job, "scheduled", now);
  }
  // Spent: by this job on an earlier pass whose result was lost, or elsewhere.
  if (chain.spent) return settle(store, job, job.hash || job.status === "sending" ? "sent" : "spent", now);
  if (!chain.knownRoot) return settle(store, job, "expired", now, { reason: "It waited longer than the vault keeps its proof." });

  // Marked before the send, so a crash after the send is read back from the chain, not sent again.
  await store.put({ ...job, status: "sending", attempts: job.attempts + 1, updatedAt: now });
  try {
    const hash = await deps.send(job);
    return settle(store, { ...job, attempts: job.attempts + 1 }, "sent", deps.now(), { hash });
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "error";
    const message = e instanceof Error ? e.message : "The relay could not send it.";
    const sent = { ...job, attempts: job.attempts + 1 };
    if (code === "AlreadySpent") return settle(store, sent, "spent", deps.now());
    if (code === "UnknownRoot") return settle(store, sent, "expired", deps.now(), { reason: "It waited longer than the vault keeps its proof." });
    // Another request holds this spend: it may be going out. Read the chain next pass.
    if (code === "in_flight") return settle(store, sent, "sending", deps.now());
    if (PERMANENT.has(code)) return settle(store, sent, "failed", deps.now(), { reason: message.slice(0, 160) });
    if (deps.now() - job.sendAfter > GIVE_UP_AFTER_MS) return settle(store, sent, "failed", deps.now(), { reason: message.slice(0, 160) });
    // A passing failure (busy, out of gas for a moment, a slow node): again next pass.
    return settle(store, sent, "scheduled", deps.now(), { reason: message.slice(0, 160) });
  }
}

/** Cancels a job that has not gone out. Returns its status after the call. */
export async function cancelJob(store: JobStore, id: string, now: number): Promise<JobStatus | null> {
  const release = await store.lock(id, 30);
  if (!release) return "sending";
  try {
    const job = await store.get(id);
    if (!job) return null;
    if (job.status !== "scheduled") return job.status;
    await store.put(retire({ ...job, status: "cancelled", updatedAt: now }, "cancelled"));
    return "cancelled";
  } finally {
    await release();
  }
}
