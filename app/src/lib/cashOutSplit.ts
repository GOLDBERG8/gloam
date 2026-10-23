"use client";

/**
 * "Cash out a different amount". A cash out spends one whole note, so to cash
 * out part of one the app first pays that part to the person's own fresh note
 * (a private transfer with two outputs: the amount, and the change), waits for
 * it to land, and then cashes out the amount note. The money never leaves the
 * person: both new notes are theirs, and the transfer reveals nothing.
 *
 * Both new notes are saved before anything is sent, out of the balance until
 * the chain shows them (sweepPending, the same rule as every send). A note is
 * dropped only when the transfer surely never went out (lib/walletErrors); a
 * send that may have gone out keeps them, and the next sync settles them
 * (lib/claimSweep reconcileClaims). Each names the note it came from
 * (sweptFrom), so the sync that counts them also retires that note: the money
 * is never counted twice, and if that note is spent some other way the two
 * that can never land leave the balance.
 */
import type { Address, Hex } from "viem";
import { buildTransferWitness, type TransferWitness } from "./proverTransfer";
import { fieldToBytes32, proveTransferInBrowser } from "./proveClient";
import type { PoseidonMerklePath } from "./merklePoseidon";
import { relayTransfer, RelaySubmitError, waitForTx } from "./relay/client";
import { getRhPublicClient } from "./rhClient";
import { readDemo } from "./demoFlag";
import { demoLeafIndex } from "./demo/store";
import { getActiveNetwork } from "./networks";
import { dropUnsentNote, saveLocalNote, shieldPoolAbi, updateLocalNote, type CashOutPlanTag, type LocalNote } from "./shield";
import { syncShieldTree } from "./treeSync";
import { surelyNotSent } from "./walletErrors";

/** Relay codes after which the transfer may still have gone out. */
const RELAY_MAYBE_SENT = new Set(["maybe_sent", "rpc", "network", "error", "internal", "in_flight"]);

export const SPLIT_MAYBE_SENT =
  "The first step may have gone out. Your money is safe in the vault and shows again once it lands. Then cash out from there.";

export const SPLIT_NO_PATH = "The amount is set aside in your private balance. Refresh, then cash it out.";

export const SPLIT_REVERTED =
  "The first step didn't go through on this try. Your money is safe in the vault: refresh, then try again.";

/** Whether a failed send of the first step may still have gone out (then its notes are kept). */
export function splitMaybeSent(e: unknown, relayOn: boolean): boolean {
  return relayOn ? e instanceof RelaySubmitError && RELAY_MAYBE_SENT.has(e.code) : !surelyNotSent(e);
}

export type TransferArgs = {
  proof: Hex;
  root: Hex;
  nullifier: Hex;
  commitments: readonly [Hex, Hex];
};

/** Rounds a base-unit amount down to whole units of the asset (whole dollars for a stablecoin). */
export function roundDownToWhole(amountWei: bigint, decimals: number): bigint {
  const unit = BigInt(10) ** BigInt(decimals);
  return (amountWei / unit) * unit;
}

/**
 * Whether `amountWei` sits within 1% of money that came into this browser's
 * balance in the last day (a deposit, or a payment received): a cash out of
 * the same size is easy to match to it.
 */
export function matchesRecentIncoming(amountWei: bigint, notes: LocalNote[], asset: string, now = Date.now()): boolean {
  if (amountWei <= BigInt(0)) return false;
  const since = now - 24 * 60 * 60 * 1000;
  return notes.some((n) => {
    if (n.asset.toLowerCase() !== asset.toLowerCase() || n.createdAt < since) return false;
    // Change from a send, and this browser's own cash-out splits, are not money coming in.
    if (n.id.startsWith("chg-") || n.id.startsWith("co-")) return false;
    const v = BigInt(n.amountWei || "0");
    if (v <= BigInt(0)) return false;
    const diff = v > amountWei ? v - amountWei : amountWei - v;
    return diff * BigInt(100) <= v;
  });
}

/** The tree path for a note once it is in the vault, read fresh from the chain. */
export async function freshPath(commitment: Hex): Promise<{ leafIndex: number; path: PoseidonMerklePath } | null> {
  for (let i = 0; i < 4; i++) {
    const tree = await syncShieldTree(getRhPublicClient()).catch(() => null);
    const idx = tree?.indexByCommitment.get(commitment.toLowerCase());
    if (tree && idx != null) {
      const path = (await tree.pathForLeaf(idx)) as PoseidonMerklePath | null;
      if (path) return { leafIndex: idx, path };
    }
    if (i < 3) await new Promise((r) => setTimeout(r, 1_500));
  }
  return null;
}

/**
 * The two notes a split makes (the amount, and the change when there is any),
 * both the owner's. Each names the note the transfer spends (`spentNullifier`
 * is its nullifier), so they are settled with it.
 */
export function splitNotes(
  note: LocalNote,
  w: Pick<TransferWitness, "paymentNote" | "changeNote">,
  spentNullifier: Hex,
  owner: Address,
  now: number
): { part: LocalNote; change: LocalNote | null } {
  const base = {
    chainId: note.chainId,
    pool: note.pool,
    asset: note.asset,
    bound: true,
    scheme: "poseidon" as const,
    from: owner,
    createdAt: now,
    status: "open" as const,
    source: "local" as const,
    // the note this transfer spends: settled together (lib/claimSweep settlePending)
    sweptFrom: { id: note.id, nullifier: spentNullifier },
  };
  const part: LocalNote = {
    ...base,
    id: `co-${now}`,
    amountWei: w.paymentNote.amountWei,
    commitment: w.paymentNote.commitment,
    secret: w.paymentNote.secret,
    nullifier: w.paymentNote.nullifier,
  };
  const change: LocalNote | null =
    BigInt(w.changeNote.amountWei) > BigInt(0)
      ? {
          ...base,
          id: `chg-${now}`,
          amountWei: w.changeNote.amountWei,
          commitment: w.changeNote.commitment,
          secret: w.changeNote.secret,
          nullifier: w.changeNote.nullifier,
        }
      : null;
  return { part, change };
}

async function seen(pool: Address, commitment: Hex): Promise<boolean> {
  // Recording demo: in the pretend vault once it has a leaf there.
  if (readDemo()) return demoLeafIndex(getActiveNetwork().chainId, commitment) != null;
  return (await getRhPublicClient().readContract({
    address: pool,
    abi: shieldPoolAbi,
    functionName: "commitmentSeen",
    args: [commitment],
  })) as boolean;
}

export type SplitArgs = {
  note: LocalNote;
  amount: bigint;
  path: PoseidonMerklePath;
  owner: Address;
  relayOn: boolean;
  sendWithWallet: (t: TransferArgs) => Promise<Hex>;
  onStatus: (s: string) => void;
  /** A private cash out's piece tags (lib/cashOutPrivately), saved with the two new notes before anything is sent. */
  partTag?: CashOutPlanTag;
  changeTag?: CashOutPlanTag;
};

/**
 * Splits `note` into `amount` and the change, both the owner's, and returns the
 * amount note once it is in the vault (with its leaf index), ready to cash out.
 * `sendWithWallet` sends the transfer from the connected wallet when the relay
 * is off.
 */
export async function splitForCashOut(args: SplitArgs): Promise<LocalNote> {
  return (await splitNote(args)).part;
}

/**
 * splitForCashOut, also returning the change once it is in the vault (with its
 * leaf index when the chain showed it), so a private cash out can split the
 * next piece from it. Null change when the amount is the whole note.
 */
export async function splitNote(args: SplitArgs): Promise<{ part: LocalNote; change: LocalNote | null }> {
  const { note, amount, owner } = args;
  const total = BigInt(note.amountWei);
  if (amount <= BigInt(0) || amount >= total) throw new Error("Pick an amount below this balance.");

  args.onStatus("Setting the amount aside privately, this takes 10 to 30 seconds…");
  const w = await buildTransferWitness({
    secretHex: note.secret,
    amountIn: total,
    amountPay: amount,
    asset: note.asset,
    path: args.path,
  });
  if (w.blocker) throw new Error(w.blocker);
  const { proofBytes } = await proveTransferInBrowser(w.circomInput);

  const nullifier = fieldToBytes32(w.publicInputs.nullifier);
  const made = splitNotes(note, w, nullifier, owner, Date.now());
  const part: LocalNote = args.partTag ? { ...made.part, cashOutPlan: args.partTag } : made.part;
  const change: LocalNote | null =
    made.change && args.changeTag ? { ...made.change, cashOutPlan: args.changeTag } : made.change;
  // Both are money: kept before anything is sent, out of the balance until they land.
  saveLocalNote({ ...part, sweepPending: true });
  if (change) saveLocalNote({ ...change, sweepPending: true });
  const dropBoth = () => {
    dropUnsentNote(part.id);
    if (change) dropUnsentNote(change.id);
  };

  const t: TransferArgs = {
    proof: proofBytes,
    root: fieldToBytes32(w.publicInputs.root),
    nullifier,
    commitments: [fieldToBytes32(w.publicInputs.newCommitment0), fieldToBytes32(w.publicInputs.newCommitment1)],
  };

  let hash: Hex;
  try {
    if (args.relayOn) {
      args.onStatus("Setting the amount aside through the Gloam relay…");
      hash = await relayTransfer({ chainId: note.chainId, ...t });
    } else {
      args.onStatus("Confirm the first step in your wallet…");
      hash = await args.sendWithWallet(t);
    }
  } catch (e) {
    if (splitMaybeSent(e, args.relayOn)) throw new Error(SPLIT_MAYBE_SENT);
    dropBoth();
    throw e;
  }

  args.onStatus("Waiting for the first step to land…");
  let outcome: "success" | "reverted" | null = null;
  try {
    outcome = await waitForTx(hash);
  } catch {
    // A slow network: it may still land, and the next sync settles it.
    throw new Error(SPLIT_MAYBE_SENT);
  }
  if (outcome === "reverted") {
    // Not proof that nothing moved: a copy of this transfer, or a resend of it,
    // may have landed first, and its proof is public now and could still land
    // later. Both notes stay saved, out of the balance; the sync settles them.
    throw new Error(SPLIT_REVERTED);
  }

  // Landed: the original note is spent, the two new ones count from now on.
  let landed = false;
  for (let i = 0; i < 4 && !landed; i++) {
    landed = await seen(note.pool, part.commitment).catch(() => false);
    if (!landed) await new Promise((r) => setTimeout(r, 1_250));
  }
  const fresh = await freshPath(part.commitment);
  updateLocalNote(note.id, { status: "recovered", txHash: hash });
  let landedChange: LocalNote | null = null;
  if (change) {
    const changeAt = await freshPath(change.commitment);
    const at = changeAt ? { leafIndex: changeAt.leafIndex } : {};
    updateLocalNote(change.id, { sweepPending: false, txHash: hash, ...at });
    landedChange = { ...change, sweepPending: false, txHash: hash, ...at };
  }
  updateLocalNote(part.id, { sweepPending: false, txHash: hash, ...(fresh ? { leafIndex: fresh.leafIndex } : {}) });
  if (!fresh) throw new Error(SPLIT_NO_PATH);
  return { part: { ...part, txHash: hash, leafIndex: fresh.leafIndex, sweepPending: false }, change: landedChange };
}
