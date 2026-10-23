"use client";

/**
 * "Cash out later", browser side (the relay keeps and sends the job:
 * lib/relay/scheduled). The note being cashed out is marked with its job
 * (LocalNote.cashOut) in the encrypted local vault, so a closed tab never loses
 * track of it, and is kept out of the balance while it waits.
 *
 * reconcileCashOuts asks the relay how each job stands. One that went out is
 * settled by the chain like any spend (the note's nullifier shows spent). One
 * that came back unsent (refused, a root the vault never knew, or cancelled)
 * makes the note spendable again, but only once the note's own chain shows it
 * unspent: nothing moved. A job that is going out, or may have gone out, never
 * puts its note back; neither does a relay that can't be read or no longer
 * holds the job. The chain settles those.
 */
import { isAddress, type Address, type Hex } from "viem";
import type { CashOutCall } from "./cashOutProof";
import { readDemo } from "./demoFlag";
import { demoCancelCashOut, demoCashOutStatus, demoScheduleCashOut } from "./demo/chain";
import { getActiveNetwork } from "./networks";
import { getAllNotes } from "./noteVault";
import { noteNullifierPoseidon } from "./notePoseidon";
import { fieldToHex, hexToField } from "./poseidon";
import { getRhPublicClient } from "./rhClient";
import { shieldPoolAbi, updateLocalNote, type CashOutMark, type LocalNote } from "./shield";
import type { DelayWindow } from "./relay/scheduled";

/** The windows the relay offers (lib/relay/scheduled DELAY_WINDOWS): about an hour, 6 hours or a day. */
export type CashOutWindow = DelayWindow;

export type CashOutJobView = {
  id: string;
  chainId: number;
  sendAfter: number;
  status: "scheduled" | "sending" | "sent" | "expired" | "spent" | "failed" | "cancelled";
  updatedAt: number;
  hash?: Hex;
  reason?: string;
};

/** A job as its owner sees it when scheduling: with the address it really pays. */
export type OwnedCashOutJob = CashOutJobView & { to: Address };

export class CashOutLaterError extends Error {
  constructor(
    message: string,
    public code: string,
    /** already_scheduled: the cash out already waiting for this money. */
    public job?: OwnedCashOutJob
  ) {
    super(message);
  }
}

/** A sent job the chain still doesn't show after this long has its transaction checked. */
const SENT_GRACE_MS = 30 * 60 * 1000;

function isOwnedJob(v: unknown): v is OwnedCashOutJob {
  const j = v as Partial<OwnedCashOutJob> | null;
  return Boolean(j && typeof j.id === "string" && typeof j.sendAfter === "number" && typeof j.status === "string" && isAddress(j.to ?? ""));
}

/** The note's mark for a job the relay holds: where it really pays, and whether it still waits. */
export function markFor(job: OwnedCashOutJob): CashOutMark {
  return { job: job.id, at: job.sendAfter, to: job.to, state: job.status === "scheduled" ? "scheduled" : "sent" };
}

/**
 * Hands a proven cash out to the relay to send at a random time inside
 * `window`. Asking again for the same money returns the job already waiting;
 * when that one pays another address, a CashOutLaterError carries it.
 */
export async function scheduleCashOut(p: {
  chainId: number;
  proof: Hex;
  root: Hex;
  nullifier: Hex;
  asset: Address;
  to: Address;
  amount: bigint;
  window: CashOutWindow;
}): Promise<OwnedCashOutJob> {
  // Recording demo: the pretend relay keeps the job (lib/demo/chain), by the same rules.
  if (readDemo()) {
    const r = await demoScheduleCashOut(p);
    if (r.ok) return r.job;
    throw new CashOutLaterError(r.error, r.code, r.job);
  }
  let res: Response;
  try {
    res = await fetch("/api/relay/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...p, amount: p.amount.toString() }),
    });
  } catch {
    throw new CashOutLaterError("Could not reach the relay. Check your connection.", "network");
  }
  const json = (await res.json().catch(() => ({}))) as Partial<OwnedCashOutJob> & {
    ok?: boolean;
    error?: string;
    code?: string;
    job?: unknown;
  };
  if (json.code === "already_scheduled" && isOwnedJob(json.job)) {
    throw new CashOutLaterError(json.error ?? "Already scheduled to another address. Cancel it first.", json.code, json.job);
  }
  if (!res.ok || !json.ok || !isOwnedJob(json)) {
    throw new CashOutLaterError(json.error ?? "Could not schedule this cash out.", json.code ?? "error");
  }
  return json;
}

/**
 * The job's status, "gone" once the relay no longer keeps it, or null when it
 * could not be read (offline, a relay error, or cashing out later is off).
 */
export async function cashOutJobStatus(id: string): Promise<CashOutJobView | "gone" | null> {
  if (readDemo()) return demoCashOutStatus(id);
  try {
    const res = await fetch(`/api/relay/scheduled?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 404) return "gone";
    const json = (await res.json().catch(() => ({}))) as Partial<CashOutJobView> & { ok?: boolean };
    return res.ok && json.ok && json.status ? (json as CashOutJobView) : null;
  } catch {
    return null;
  }
}

/**
 * What asking to cancel did: "cancelled" now; "over" when it already ended
 * without going out (the next reconcile settles it); "going" once it is on its
 * way or went out; "gone" when the relay no longer holds it; null when the
 * relay could not be asked.
 */
export type CancelResult = "cancelled" | "over" | "going" | "gone" | null;

export async function cancelCashOut(id: string): Promise<CancelResult> {
  if (readDemo()) return demoCancelCashOut(id);
  try {
    const res = await fetch(`/api/relay/scheduled?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.status === 404) return "gone";
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string };
    if (json.ok) return "cancelled";
    if (json.status === "expired" || json.status === "failed" || json.status === "cancelled") return "over";
    if (json.status === "sending" || json.status === "sent" || json.status === "spent") return "going";
    return null;
  } catch {
    return null;
  }
}

/**
 * Hands a proven cash out of `note` to the relay and marks the note with the
 * job, out of the balance while it waits. The address shown is the one the
 * relay holds, not the one asked for: when this money already has a cash out
 * waiting to another address, the note is marked with that one and this throws.
 */
export async function scheduleNoteCashOut(note: LocalNote, call: CashOutCall, window: CashOutWindow): Promise<OwnedCashOutJob> {
  let job: OwnedCashOutJob;
  try {
    job = await scheduleCashOut({ ...call, window });
  } catch (e) {
    if (e instanceof CashOutLaterError && e.job) updateLocalNote(note.id, { cashOut: markFor(e.job) });
    throw e;
  }
  updateLocalNote(note.id, { cashOut: markFor(job) });
  return job;
}

/** Notes with a cash out still waiting or on its way. */
export function scheduledCashOutNotes(notes: LocalNote[] = getAllNotes()): LocalNote[] {
  return notes.filter((n) => n.status !== "recovered" && (n.cashOut?.state === "scheduled" || n.cashOut?.state === "sent"));
}

/** Notes whose scheduled cash out came back unsent, for a one-time notice. */
export function returnedCashOutNotes(notes: LocalNote[] = getAllNotes()): LocalNote[] {
  return notes.filter(
    (n) => n.status !== "recovered" && (n.cashOut?.state === "expired" || n.cashOut?.state === "failed")
  );
}

const RETURNED = new Set<CashOutMark["state"]>(["expired", "failed", "cancelled"]);

/**
 * What the relay's answer means for the note's mark, or null to leave it. A
 * job going out (or that may have) is "on its way" and never waits again. A
 * relay that no longer holds the job says nothing: the chain settles a spend.
 * A returned state still needs the chain's word (reconcileCashOuts).
 */
export function nextMark(mark: CashOutMark, view: CashOutJobView | "gone"): CashOutMark | null {
  if (view === "gone") return null;
  switch (view.status) {
    case "scheduled":
      return view.sendAfter !== mark.at ? { ...mark, at: view.sendAfter } : null;
    case "sending":
    case "sent":
    case "spent":
      // On its way, or the note's own spend: the chain marks it spent on a later read.
      return mark.state === "sent" ? null : { ...mark, state: "sent" };
    case "expired":
    case "failed":
    case "cancelled":
      return { ...mark, state: view.status };
  }
}

/** What reconciling reads: the relay, and the active network's vault. */
export type CashOutEnv = {
  chainId: number;
  pool: Address | null;
  now: () => number;
  status: (id: string) => Promise<CashOutJobView | "gone" | null>;
  /** null: could not be read. */
  isSpent: (nullifier: Hex) => Promise<boolean | null>;
  /** A sent transaction's outcome; null while it has no receipt or can't be read. */
  receipt: (hash: Hex) => Promise<"success" | "reverted" | null>;
};

/** The relay and the active network's vault, over the app's own RPC. */
export function appCashOutEnv(): CashOutEnv {
  const net = getActiveNetwork();
  const pool = net.pool ?? null;
  return {
    chainId: net.chainId,
    pool,
    now: () => Date.now(),
    status: cashOutJobStatus,
    isSpent: async (nullifier) => {
      if (!pool) return null;
      try {
        return (await getRhPublicClient().readContract({
          address: pool,
          abi: shieldPoolAbi,
          functionName: "isSpent",
          args: [nullifier],
        })) as boolean;
      } catch {
        return null;
      }
    },
    receipt: async (hash) => {
      try {
        return (await getRhPublicClient().getTransactionReceipt({ hash })).status;
      } catch {
        return null;
      }
    },
  };
}

async function nullifierOf(n: LocalNote): Promise<Hex | null> {
  if (n.nullifier && n.nullifier !== "0x") return n.nullifier;
  try {
    return fieldToHex(await noteNullifierPoseidon(hexToField(n.secret), hexToField(n.commitment)));
  } catch {
    return null;
  }
}

/** Whether the note's own chain shows it unspent (false: spent, null: could not tell). */
async function unspentOnChain(n: LocalNote, env: CashOutEnv): Promise<boolean | null> {
  const nullifier = await nullifierOf(n);
  if (!nullifier) return null;
  const spent = await env.isSpent(nullifier);
  return spent === null ? null : !spent;
}

/** Notes this env can read: on the active network's vault (another network's are left for when it is active). */
function onEnvChain(n: LocalNote, env: CashOutEnv): boolean {
  return n.chainId === env.chainId && Boolean(env.pool) && n.pool.toLowerCase() === env.pool!.toLowerCase();
}

/**
 * Updates every waiting cash out on the active network from the relay. A note
 * goes back to the balance only when the relay says it ended unsent and the
 * note's chain shows it unspent, or its transaction reverted with the note
 * unspent. True when a note changed.
 */
export async function reconcileCashOuts(env?: CashOutEnv): Promise<boolean> {
  if (!env && typeof window === "undefined") return false;
  const e = env ?? appCashOutEnv();
  let changed = false;
  for (const n of scheduledCashOutNotes()) {
    if (!onEnvChain(n, e)) continue;
    const mark = n.cashOut!;
    const view = await e.status(mark.job);
    if (view === null) continue;
    let next = nextMark(mark, view);
    if (next && RETURNED.has(next.state)) {
      const unspent = await unspentOnChain(n, e);
      if (unspent === null) continue;
      // Spent after all: it went out, and the chain retires the note.
      if (!unspent) next = mark.state === "sent" ? null : { ...mark, state: "sent" };
    } else if (
      !next &&
      view !== "gone" &&
      view.status === "sent" &&
      view.hash &&
      e.now() - view.updatedAt > SENT_GRACE_MS &&
      (await e.receipt(view.hash)) === "reverted" &&
      (await unspentOnChain(n, e)) === true
    ) {
      // Sent, but the transaction reverted and the note is unspent: nothing moved.
      next = { ...mark, state: "failed" };
    }
    if (next) {
      updateLocalNote(n.id, { cashOut: next });
      changed = true;
    }
  }
  return changed;
}

/**
 * A job the relay no longer holds can't be sent by it. Its note is spendable
 * again once its own chain shows it unspent. True when it was put back.
 */
export async function releaseGoneCashOut(n: LocalNote, env: CashOutEnv = appCashOutEnv()): Promise<boolean> {
  if (!n.cashOut || !onEnvChain(n, env)) return false;
  if ((await unspentOnChain(n, env)) !== true) return false;
  updateLocalNote(n.id, { cashOut: undefined });
  return true;
}

/**
 * Clears the notice on a note whose cash out came back, once it was shown or
 * it is spent again. A private cash out's piece stops being one too: it is
 * plain money in the balance from here, not a piece still to schedule.
 */
export function dismissReturnedCashOut(noteId: string) {
  updateLocalNote(noteId, { cashOut: undefined, cashOutPlan: undefined });
}
