"use client";

/**
 * Fresh proofs for cash outs waiting with the relay: every "cash out later",
 * a private cash out's pieces included.
 *
 * A cash-out proof is made against the vault's root at that moment, and the
 * vault keeps every root, so anyone who rebuilds the tree can tell roughly
 * when a waiting proof was made. Cash outs proven together could be grouped
 * that way, and one proven right after a deposit points back at it.
 *
 * While the app is open, this makes a fresh proof of each waiting cash out
 * against the current root and hands it to the relay (lib/cashOutLater
 * replaceCashOutProof). The relay swaps it into the same job: the same spend,
 * recipient, amount, asset and send time. It runs every so often, then once
 * more in the last stretch before the send time, so a cash out whose app
 * stays open goes out with a root from around its own time. One that goes out
 * while the app is closed keeps the root of its last proof.
 *
 * It stays in the background:
 *  - one proof at a time, and never while the person is proving something
 *    themselves (lib/proveClient provingNow);
 *  - nothing within a minute of its send time;
 *  - nothing when the vault has no newer root.
 * A refused or failed swap keeps the old proof, and the cash out goes out as
 * scheduled either way. Only the mark's root and time change here.
 */
import type { Address, Hex } from "viem";
import { proveCashOut, type CashOutCall } from "./cashOutProof";
import { replaceCashOutProof, scheduledCashOutNotes, type ReplaceProofResult } from "./cashOutLater";
import { freshPath } from "./cashOutSplit";
import type { PoseidonMerklePath } from "./merklePoseidon";
import { getActiveNetwork } from "./networks";
import { getAllNotes } from "./noteVault";
import { fieldToBytes32, provingNow } from "./proveClient";
import { REPROVE_MIN_LEAD_MS } from "./relay/scheduled";
import { updateLocalNote, type CashOutMark, type LocalNote } from "./shield";

export { REPROVE_MIN_LEAD_MS };
/** A waiting proof is renewed at most this often while the app is open. */
export const REFRESH_EVERY_MS = 10 * 60 * 1000;
/** And once more inside this stretch before its send time. */
export const LAST_STRETCH_MS = 15 * 60 * 1000;

/**
 * Whether a waiting cash out is due a fresh proof now, against `root` (the
 * vault's current root, or null when not known).
 */
export function reproveDue(mark: CashOutMark, now: number, root: Hex | null): boolean {
  if (mark.state !== "scheduled") return false;
  const lead = mark.at - now;
  if (lead < REPROVE_MIN_LEAD_MS) return false;
  // The vault has not moved since: a new proof would carry the same root.
  if (root && mark.root && mark.root.toLowerCase() === root.toLowerCase()) return false;
  const last = mark.provenAt ?? 0;
  // Inside the last stretch: once, so the root is from around its own send time.
  if (lead <= LAST_STRETCH_MS) return last < mark.at - LAST_STRETCH_MS;
  return now - last >= REFRESH_EVERY_MS;
}

/** What a refresh reads and does: the app's own paths, swapped for fakes in the selftest. */
export type ReproveEnv = {
  chainId: number;
  pool: Address | null;
  now: () => number;
  /** The note's path in the vault tree as it is now (its root included), or null. */
  pathOf: (n: LocalNote) => Promise<PoseidonMerklePath | null>;
  prove: (n: LocalNote, to: Address, path: PoseidonMerklePath, chainId: number) => Promise<CashOutCall>;
  replace: (job: string, call: CashOutCall) => Promise<ReplaceProofResult>;
  /** Someone is proving something in this tab: stop for now. */
  busy: () => boolean;
};

export function appReproveEnv(): ReproveEnv {
  const net = getActiveNetwork();
  return {
    chainId: net.chainId,
    pool: net.pool ?? null,
    now: () => Date.now(),
    pathOf: async (n) => (await freshPath(n.commitment))?.path ?? null,
    prove: proveCashOut,
    replace: replaceCashOutProof,
    busy: provingNow,
  };
}

export type ReproveSummary = { replaced: number; kept: number; skipped: number };

/** Jobs the relay refused a new proof for, and when: not asked again for a while (this tab only). */
const refusedAt = new Map<string, number>();
let running: Promise<ReproveSummary> | null = null;

/**
 * Renews the proof of every waiting cash out on the active network that is
 * due one, soonest first. One run at a time in a tab; calling again while one
 * runs returns it.
 */
export function refreshWaitingProofs(env?: ReproveEnv): Promise<ReproveSummary> {
  if (typeof window === "undefined" && !env) return Promise.resolve({ replaced: 0, kept: 0, skipped: 0 });
  running ??= run(env ?? appReproveEnv()).finally(() => {
    running = null;
  });
  return running;
}

async function run(e: ReproveEnv): Promise<ReproveSummary> {
  const out: ReproveSummary = { replaced: 0, kept: 0, skipped: 0 };
  const pool = e.pool?.toLowerCase();
  if (!pool) return out;
  const waiting = scheduledCashOutNotes()
    .filter((n) => n.cashOut?.state === "scheduled" && n.chainId === e.chainId && n.pool.toLowerCase() === pool)
    .sort((a, b) => a.cashOut!.at - b.cashOut!.at);
  for (const n of waiting) {
    if (e.busy()) break;
    const mark = n.cashOut!;
    const tried = refusedAt.get(mark.job);
    if (mark.at - e.now() < REPROVE_MIN_LEAD_MS || (tried && e.now() - tried < REFRESH_EVERY_MS)) {
      out.skipped++;
      continue;
    }
    const path = await e.pathOf(n).catch(() => null);
    if (!path || !reproveDue(mark, e.now(), fieldToBytes32(path.root))) {
      out.skipped++;
      continue;
    }
    let call: CashOutCall;
    try {
      call = await e.prove(n, mark.to, path, n.chainId);
    } catch {
      out.skipped++;
      continue;
    }
    // Proving takes a while: never hand one in within a minute of its send time.
    if (mark.at - e.now() < REPROVE_MIN_LEAD_MS) {
      out.skipped++;
      continue;
    }
    const r = await e.replace(mark.job, call).catch(() => null);
    // The relay could not be asked: the old proof stays, and a later pass tries again.
    if (r === null) break;
    if (r.status === "kept") {
      refusedAt.set(mark.job, e.now());
      out.kept++;
      continue;
    }
    // The mark may have moved on while this was proving (reconciled, cancelled): only a waiting one is updated.
    const current = getAllNotes().find((x) => x.id === n.id)?.cashOut;
    if (current && current.job === mark.job && current.state === "scheduled") {
      updateLocalNote(n.id, { cashOut: { ...current, at: r.job.sendAfter, root: call.root, provenAt: e.now() } });
    }
    out.replaced++;
  }
  return out;
}
