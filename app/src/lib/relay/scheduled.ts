/**
 * Scheduled cash outs: "cash out later".
 *
 * A cash out is public (the asset, the amount and the wallet it pays), so one
 * that follows a payment within a minute can be matched to it by timing. Here
 * the browser makes the cash-out proof as usual and hands it to the relay with
 * a send time picked at random inside the window the person chose (an hour,
 * six, or a day). A cron sends due jobs through the normal relay path
 * (lib/relay/server).
 *
 * A job holds no secret: the proof and its public inputs. The proof binds the
 * amount and the recipient, so whoever holds the job can only send it as it is
 * or not at all. Before sending, the chain is read at one block: a spent
 * nullifier means the money already moved. The vault accepts every root it
 * ever had (knownRoots, not only its recent history), so a proof does not go
 * stale while it waits; a root it does not know at all means the proof can
 * never land, so the job expires and nothing moved.
 *
 * Sending is idempotent. A job is taken under a short lock, marked "sending"
 * before the relay is called, and the chain is read first on every pass, so a
 * job that was sent but not recorded (a crash, a lost reply) settles as sent
 * instead of going out twice. The relay itself refuses a second copy of a
 * spend while one is in flight (lib/relay/inflight).
 *
 * Once the relay may have handed a job to the node (a timeout, a lost reply,
 * any answer that is not a clear refusal), the job stays "sending" until the
 * chain settles it: it is never cancelled, failed or said to be unsent on a
 * guess. Only the chain (spent, or a root it does not know with the note
 * unspent, read at one block) or a refusal raised before anything reached
 * the node ends it.
 *
 * This file is the logic and an in-memory store (for tests and local runs);
 * lib/relay/scheduledStore.ts keeps jobs in Redis in production.
 */
import type { Address, Hex } from "viem";

/** The longest a cash out may wait. A live job's record (JOB_TTL_SEC) outlasts it, give-up time included. */
export const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
/** The windows the app offers. */
export const DELAY_WINDOWS = { hour: 60 * 60 * 1000, "6h": 6 * 60 * 60 * 1000, day: MAX_DELAY_MS } as const;
export type DelayWindow = keyof typeof DELAY_WINDOWS;
/** No earlier than this after it is scheduled, so even the shortest draw is not "right away". */
export const MIN_DELAY_MS = 2 * 60 * 1000;
/** A job that keeps failing for a passing reason (a busy relay, a slow node) gives up this long after its time. */
export const GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;
/** A job marked "sending" longer than this is read again: the send may have died with its instance. */
export const SENDING_STALE_MS = 5 * 60 * 1000;
/** How long a live job record is kept (refreshed on every save). */
export const JOB_TTL_SEC = 3 * 24 * 60 * 60;
/** How long a finished job is kept, without its proof, so the app can still read what happened. */
export const JOB_DONE_TTL_SEC = 7 * 24 * 60 * 60;

export type JobStatus =
  | "scheduled"
  | "sending"
  /** The relay sent it (hash set). The chain settles it. */
  | "sent"
  /** The vault does not know the proof's root and the note is unspent: it can never land, nothing moved. */
  | "expired"
  /** The note was already spent when the job came due (this cash out, or another spend). */
  | "spent"
  /** It could not go out (refused before reaching the node, or reverted). Nothing moved. */
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
  /** A send may have reached the node: from now on only the chain settles the job. */
  maybeSent?: boolean;
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

/** When the runner next looks at a live job: its send time, or for one going out, once that send is stale. */
export function dueAt(job: CashOutJob): number {
  return job.status === "sending" ? job.updatedAt + SENDING_STALE_MS : job.sendAfter;
}

/** Whether a new request is the same cash out as a waiting job: same recipient, amount and asset. */
export function sameCashOut(job: CashOutJob, want: { to: string; amount: string; asset: string }): boolean {
  return (
    job.to.toLowerCase() === want.to.toLowerCase() &&
    job.amount === want.amount &&
    job.asset.toLowerCase() === want.asset.toLowerCase()
  );
}

// ---------------------------------------------------------------- store

export interface JobStore {
  get(id: string): Promise<CashOutJob | null>;
  /** Saves the job, and keeps it in the due queue (by dueAt) while it is live. */
  put(job: CashOutJob): Promise<void>;
  /**
   * Saves a new job as the one for its spend, in one step: the spend's pointer,
   * the job and its place in the queue. When the pointer already names another
   * job (other than `replace`), nothing is written and that job's id comes back.
   */
  create(job: CashOutJob, replace?: string): Promise<string>;
  /** Ids due by `now`, oldest first. */
  due(now: number, limit: number): Promise<string[]>;
  /** The live job already scheduled for this spend, if any. */
  byNullifier(chainId: number, nullifier: Hex): Promise<string | null>;
  /** A short lock on one job; returns its release, or null while another run holds it. */
  lock(id: string, ttlSec: number): Promise<(() => Promise<void>) | null>;
  /** Takes an id out of the due queue (its record is gone or over). */
  forget(id: string): Promise<void>;
}

/** Jobs in this process only: for tests and a local dev server without Redis. */
export function memoryJobStore(): JobStore {
  const jobs = new Map<string, CashOutJob>();
  const locks = new Map<string, number>();
  /** The job named for each spend, like the Redis store's pointer. */
  const spends = new Map<string, string>();
  const spendKey = (chainId: number, nullifier: Hex) => `${chainId}:${nullifier.toLowerCase()}`;
  return {
    async get(id) {
      const j = jobs.get(id);
      return j ? { ...j } : null;
    },
    async put(job) {
      jobs.set(job.id, { ...job });
      if (isLive(job.status)) spends.set(spendKey(job.chainId, job.nullifier), job.id);
    },
    async create(job, replace) {
      const key = spendKey(job.chainId, job.nullifier);
      const held = spends.get(key);
      if (held && held !== job.id && held !== replace) return held;
      jobs.set(job.id, { ...job });
      spends.set(key, job.id);
      return job.id;
    },
    async due(now, limit) {
      return [...jobs.values()]
        .filter((j) => isLive(j.status) && dueAt(j) <= now)
        .sort((a, b) => dueAt(a) - dueAt(b))
        .slice(0, limit)
        .map((j) => j.id);
    },
    async byNullifier(chainId, nullifier) {
      const id = spends.get(spendKey(chainId, nullifier));
      const j = id ? jobs.get(id) : undefined;
      return j && isLive(j.status) ? j.id : null;
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

/** An error from a send: its relay code (lib/relay/server RelayError). */
export type SendFailure = { code: string; message: string };

export type RunDeps = {
  now: () => number;
  /** Reads the chain for this job; throws when the node can't be read. */
  readChain: (job: CashOutJob) => Promise<ChainView>;
  /** Sends the cash out through the relay; returns the hash, or throws a SendFailure-like error. */
  send: (job: CashOutJob) => Promise<Hex>;
};

/**
 * Relay codes raised before anything reaches the node (lib/relay/server): the
 * request was refused, so nothing went out on that try.
 */
const REFUSED = new Set([
  "screened",
  "asset_policy",
  "vault_recipient",
  "bad_request",
  "network",
  "relay_off",
  "relay_empty",
  "busy",
  "rate_limit",
  "check_failed",
]);
/** Of those, the ones that mean this cash out can never go out as it is. */
const PERMANENT = new Set(["screened", "asset_policy", "vault_recipient", "bad_request", "network"]);
/** The relay's dry run reverted with these: the call reverts, so it was not sent. */
const REVERTED = new Set(["InvalidProof", "InvalidAmount", "ZeroAddress", "VerifierNotSet", "DuplicateCommitment", "InsufficientPoolBalance"]);
/** A dry-run revert that can pass (the vault fills up again): try again later. */
const REVERTED_PASSING = new Set(["InsufficientPoolBalance"]);

const EXPIRED_REASON = "The vault does not know this proof's root, so it can never go out.";

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

/**
 * A job that is done no longer needs its proof: it is dropped, so it can never be sent later.
 * Nor when it was asked for, the one thing here the chain does not already show next to its
 * hash: kept, it would tie the person's visit to the cash out.
 */
function retire(job: CashOutJob, status: JobStatus): CashOutJob {
  return isLive(status) ? job : { ...job, proof: "0x", createdAt: 0 };
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
  if (!isLive(job.status)) {
    await store.forget(id);
    return job.status;
  }
  if (job.sendAfter > now) return "skipped";
  // Another run is sending it right now (its lock may have lapsed mid-send).
  if (job.status === "sending" && now - job.updatedAt < SENDING_STALE_MS) return "skipped";
  // A "sending" job found here may have gone out (the run died, or the node's answer was lost).
  const mayBeOut = job.status === "sending" || job.maybeSent === true;

  let chain: ChainView;
  try {
    chain = await deps.readChain(job);
  } catch {
    // The node did not answer. One that may be out stays "sending" and is read again later;
    // one that never reached the node tries again next pass, or gives up when long overdue.
    if (mayBeOut) return settle(store, job, "sending", now, { maybeSent: true });
    if (now - job.sendAfter > GIVE_UP_AFTER_MS) return settle(store, job, "failed", now, { reason: "The network could not be read in time." });
    return settle(store, job, "scheduled", now);
  }
  // Spent: by this job on an earlier pass whose result was lost, or elsewhere.
  if (chain.spent) return settle(store, job, job.hash || mayBeOut ? "sent" : "spent", now);
  // Read at one block with the note unspent: no copy of this proof can ever land.
  if (!chain.knownRoot) return settle(store, job, "expired", now, { reason: EXPIRED_REASON });

  // Marked before the send, so a crash after the send is read back from the chain, not sent again.
  const sending: CashOutJob = { ...job, status: "sending", attempts: job.attempts + 1, updatedAt: now };
  await store.put(sending);
  try {
    const hash = await deps.send(job);
    return settle(store, sending, "sent", deps.now(), { hash });
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "error";
    const reason = (e instanceof Error ? e.message : "The relay could not send it.").slice(0, 160);
    const t = deps.now();
    // Spent by now: by an earlier try of this job, or by another spend.
    if (code === "AlreadySpent") return settle(store, sending, mayBeOut ? "sent" : "spent", t);
    // Anything but a clear refusal may have reached the node (a timeout, a lost
    // reply, another request holding this spend): only the chain settles it now.
    // So does any refusal once an earlier try may have gone out.
    const refused = REFUSED.has(code) || REVERTED.has(code) || code === "UnknownRoot";
    if (!refused || mayBeOut) return settle(store, sending, "sending", t, { maybeSent: true, reason });
    if (code === "UnknownRoot") return settle(store, sending, "expired", t, { reason: EXPIRED_REASON });
    if (PERMANENT.has(code) || (REVERTED.has(code) && !REVERTED_PASSING.has(code))) {
      return settle(store, sending, "failed", t, { reason });
    }
    if (t - job.sendAfter > GIVE_UP_AFTER_MS) return settle(store, sending, "failed", t, { reason });
    // A passing refusal (busy, out of gas for a moment, the vault short for now): again next pass.
    return settle(store, sending, "scheduled", t, { reason });
  }
}

/**
 * Cancels a job that has not gone out. Returns its status after the call:
 * "sending" once a run has reached the send (it may be on its way, so only
 * the chain can settle it), whatever its status says.
 */
export async function cancelJob(store: JobStore, id: string, now: number): Promise<JobStatus | null> {
  const release = await store.lock(id, 30);
  if (!release) return "sending";
  try {
    const job = await store.get(id);
    if (!job) return null;
    if (job.status === "scheduled" && (job.attempts > 0 || job.maybeSent)) return "sending";
    if (job.status !== "scheduled") return job.status;
    await store.put(retire({ ...job, status: "cancelled", updatedAt: now }, "cancelled"));
    return "cancelled";
  } finally {
    await release();
  }
}

export type ScheduleOutcome = {
  job: CashOutJob;
  /** created: saved now. existing: the same cash out was already waiting. conflict: another one is. */
  outcome: "created" | "existing" | "conflict";
};

/**
 * Saves `job` as the one live job for its spend. Another live job for the same
 * spend comes back instead: "existing" when it is the same cash out, "conflict"
 * when it pays another address (or amount). A spend whose last job is over is
 * taken over once; two requests at the same moment can't both be saved.
 */
export async function scheduleJob(store: JobStore, job: CashOutJob): Promise<ScheduleOutcome> {
  let replace: string | undefined;
  for (let i = 0; i < 2; i++) {
    const holder = await store.create(job, replace);
    if (holder === job.id) return { job, outcome: "created" };
    const other = await store.get(holder);
    if (other && isLive(other.status)) return { job: other, outcome: sameCashOut(other, job) ? "existing" : "conflict" };
    replace = holder;
  }
  throw new Error("cash out later: the spend is being scheduled by another request");
}
