"use client";

/**
 * Running a private swap from the browser (lib/vaultSwap has the router and
 * quotes). A swap spends one whole note, so part of a note is first set aside
 * in its own note (lib/cashOutSplit, the same as a partial cash out). Then:
 *
 *   1. make the new note for exactly the planned amount, and a refund note in
 *      the note's own asset, and prove both shields;
 *   2. work out this swap's escrow (derived from the note spent, both new notes
 *      and the route), check it against the router's escrowFor, and prove the
 *      note's unshield to it, so nobody can change what lands;
 *   3. save both new notes before anything is sent, out of the balance until
 *      one lands (sweepPending, named after the note they come from: the sync
 *      that counts one retires that note and the other, lib/claimSweep);
 *   4. hand the proofs to the Gloam relay. The wallet never submits a swap:
 *      that would put it next to the swap on the explorer.
 *
 * The new notes are dropped only when the swap surely never went out (the
 * relay refused it before sending, or its transaction reverted). A send that
 * may have gone out keeps them, and the next sync settles them either way.
 */
import { keccak256, type Address, type Hex } from "viem";
import { buildPoseidonUnshieldWitness } from "./proverPoseidon";
import { fieldToBytes32, proveShieldInBrowser, proveUnshieldInBrowser } from "./proveClient";
import { noteNullifierPoseidon } from "./notePoseidon";
import { fieldToHex, hexToField } from "./poseidon";
import type { PoseidonMerklePath } from "./merklePoseidon";
import { prepareBridgeNote } from "./bridgePrivate";
import { freshPath, splitForCashOut } from "./cashOutSplit";
import { relayVaultSwap, RelaySubmitError, waitForTx } from "./relay/client";
import { getRhPublicClient } from "./rhClient";
import { dropUnsentNote, saveLocalNote, shieldPoolAbi, updateLocalNote, type LocalNote } from "./shield";
import type { GloamNetwork } from "./networks";
import {
  encodeRoute,
  escrowAddress,
  refundAmountFor,
  vaultSwapAbi,
  type EscrowKey,
  type SwapPlan,
  type VaultSwapRefundInfo,
} from "./vaultSwap";

/** Relay codes after which the swap may still have gone out. */
const MAYBE_SENT = new Set(["maybe_sent", "rpc", "network", "error", "internal", "in_flight"]);

export const SWAP_MAYBE_SENT =
  "The swap may have gone out. Your money is safe in the vault: refresh in a minute to see where it landed.";

export const SWAP_REVERTED =
  "The swap didn't go through on this try. Your money is safe in the vault: refresh in a minute, then get a new quote.";

export const SWAP_REFUNDED =
  "The swap couldn't finish, so the money went back to your private balance, less up to 1%: the vault's cash-out fee, plus a safety margin that goes to the Gloam treasury.";

export type SwapResult = { hash: Hex; outNote: LocalNote; refunded: boolean };

export async function runVaultSwap(args: {
  network: GloamNetwork;
  router: Address;
  note: LocalNote;
  /** How much of the note to swap; below its value, the rest stays a note of its own. */
  amount: bigint;
  assetOut: Address;
  plan: SwapPlan;
  owner: Address;
  /** The note's tree path, read fresh. */
  pathFor: (note: LocalNote) => Promise<PoseidonMerklePath | null>;
  onStatus: (s: string) => void;
}): Promise<SwapResult> {
  const { network, note, amount, plan, router } = args;
  if (!network.pool) throw new Error("This network has no vault yet.");
  const noteWei = BigInt(note.amountWei);
  if (amount <= 0n || amount > noteWei) throw new Error("Pick an amount up to this balance.");

  // The note to spend: the whole one, or the part set aside.
  let target = note;
  if (amount < noteWei) {
    const start = await args.pathFor(note);
    if (!start) throw new Error("Could not read your private balance. Refresh and try again.");
    target = await splitForCashOut({
      note,
      amount,
      path: start,
      owner: args.owner,
      // the split goes through the relay too: a swap never shows the wallet
      relayOn: true,
      sendWithWallet: () => Promise.reject(new Error("Swaps go through the Gloam relay.")),
      onStatus: args.onStatus,
    });
  }
  const targetWei = BigInt(target.amountWei);

  // 1. The new note and the refund note, with their shield proofs.
  args.onStatus("Proving privately, this takes 10 to 30 seconds…");
  const out = await prepareBridgeNote(plan.amountOut, args.assetOut, network, args.owner);
  const back = await prepareBridgeNote(refundAmountFor(targetWei), target.asset, network, args.owner);

  // 2. The escrow the unshield must name: worked out here, and checked against
  //    the router's own answer, so a wrong RPC can't send the note elsewhere.
  const nullifier =
    target.nullifier && target.nullifier !== "0x"
      ? target.nullifier
      : (fieldToHex(await noteNullifierPoseidon(hexToField(target.secret), hexToField(target.commitment))) as Hex);
  const routeBytes = encodeRoute(plan.route);
  const key: EscrowKey = {
    nullifier,
    amountIn: targetWei,
    outCommitment: out.note.commitment,
    assetOut: args.assetOut,
    amountOut: plan.amountOut,
    refundCommitment: back.note.commitment,
    refundAmount: BigInt(back.note.amountWei),
    routeHash: keccak256(routeBytes),
  };
  const escrow = escrowAddress(router, target.asset, key);
  const routerSays = await getRhPublicClient().readContract({
    address: router,
    abi: vaultSwapAbi,
    functionName: "escrowFor",
    args: [target.asset, key],
  });
  if (routerSays.toLowerCase() !== escrow.toLowerCase()) {
    throw new Error("This swap's address didn't check out, so nothing was sent. Refresh and try again.");
  }
  const path = await args.pathFor(target);
  if (!path) throw new Error("Could not read your private balance. Refresh and try again.");
  const w = await buildPoseidonUnshieldWitness({
    secretHex: target.secret,
    amount: targetWei,
    asset: target.asset,
    to: escrow,
    path,
  });
  if (!w.checks.commitmentMatches) throw new Error(w.blocker ?? "This balance does not match the vault.");
  if (fieldToBytes32(w.publicInputs.nullifier).toLowerCase() !== nullifier.toLowerCase()) {
    throw new Error("This balance does not match the vault.");
  }
  const { proofBytes } = await proveUnshieldInBrowser(w.circomInput);

  // 3. Both saved before anything is sent. The refund note keeps what finishing
  //    a refund needs (finishVaultSwapRefund), in case it is ever wanted.
  const now = Date.now();
  const refundInfo: VaultSwapRefundInfo = {
    router,
    assetIn: target.asset,
    amountIn: targetWei.toString(),
    out: { commitment: out.note.commitment, asset: args.assetOut, amount: plan.amountOut.toString() },
    route: plan.route,
  };
  const outNote: LocalNote = { ...out.note, id: `sw-${now}`, sweptFrom: { id: target.id, nullifier }, sweepPending: true };
  const refundNote: LocalNote = {
    ...back.note,
    id: `swr-${now}`,
    sweptFrom: { id: target.id, nullifier },
    sweepPending: true,
    vaultSwap: refundInfo,
  };
  saveLocalNote(outNote);
  saveLocalNote(refundNote);
  const dropBoth = () => {
    dropUnsentNote(outNote.id);
    dropUnsentNote(refundNote.id);
  };

  // 4. Through the relay only.
  args.onStatus("Swapping through the Gloam relay…");
  let hash: Hex;
  try {
    hash = await relayVaultSwap({
      chainId: network.chainId,
      spend: { proof: proofBytes, root: fieldToBytes32(w.publicInputs.root), nullifier, asset: target.asset, amount: targetWei },
      deposit: { proof: out.proof, commitment: outNote.commitment, asset: args.assetOut, amount: plan.amountOut },
      refund: { proof: back.proof, commitment: refundNote.commitment, asset: target.asset, amount: BigInt(refundNote.amountWei) },
      route: plan.route,
    });
  } catch (e) {
    if (e instanceof RelaySubmitError && MAYBE_SENT.has(e.code)) throw new Error(SWAP_MAYBE_SENT);
    dropBoth();
    throw e;
  }

  args.onStatus("Waiting for the swap to land…");
  let outcome: "success" | "reverted";
  try {
    outcome = await waitForTx(hash);
  } catch {
    // A slow network: it may still land, and the next sync settles it.
    throw new Error(SWAP_MAYBE_SENT);
  }
  if (outcome === "reverted") {
    // Not proof that nothing moved: a copy or a resend of this call may have
    // landed first, and its unshield proof (to this swap's escrow) is public now.
    // Both notes stay saved, out of the balance; the sync settles them.
    throw new Error(SWAP_REVERTED);
  }

  // Landed: the new note, or (if someone sent the unshield on its own first)
  // the refund note. Which one is read from the vault; if that read fails both
  // stay pending and the next sync settles them, so no money is ever hidden.
  const seen = (c: Hex) =>
    getRhPublicClient().readContract({ address: network.pool!, abi: shieldPoolAbi, functionName: "commitmentSeen", args: [c] });
  const [outSeen, refundSeen] = await Promise.all([seen(outNote.commitment), seen(refundNote.commitment)]).catch(
    () => [false, false] as const
  );
  if (!outSeen && !refundSeen) throw new Error("The swap went out. Refresh in a minute to see it in your balance.");
  const refunded = !outSeen;
  const landed = refunded ? refundNote : outNote;
  const unused = refunded ? outNote : refundNote;
  const at = await freshPath(landed.commitment);
  updateLocalNote(target.id, { status: "recovered", txHash: hash });
  updateLocalNote(unused.id, { status: "recovered", sweepPending: false });
  updateLocalNote(landed.id, { status: "open", sweepPending: false, txHash: hash, ...(at ? { leafIndex: at.leafIndex } : {}) });
  return {
    hash,
    refunded,
    outNote: { ...landed, txHash: hash, sweepPending: false, ...(at ? { leafIndex: at.leafIndex } : {}) },
  };
}

/** Proof bytes and a root the router never reads on the refund path (64 zero bytes, a zero root). */
const UNUSED_PROOF = `0x${"00".repeat(64)}` as Hex;
const UNUSED_ROOT = `0x${"00".repeat(32)}` as Hex;
const RETRY_MS = 60_000;
const lastTry = new Map<string, number>();

/**
 * Puts a swap's waiting money back as its refund note: the case where someone
 * sent the swapped note's unshield on its own, so the money sits at the swap's
 * escrow (lib/claimSweep finds it and calls this). Proves the refund note's
 * shield again from its saved secret and sends the same swap call through the
 * relay; the router sees the note spent and makes the refund. At most one try
 * a minute per note; the next sync counts the note once it lands.
 */
export async function finishVaultSwapRefund(note: LocalNote): Promise<void> {
  const info = note.vaultSwap;
  const from = note.sweptFrom;
  if (!info || !from || !note.sweepPending) return;
  const last = lastTry.get(note.id);
  if (last !== undefined && Date.now() - last < RETRY_MS) return;
  lastTry.set(note.id, Date.now());

  const { proofBytes } = await proveShieldInBrowser({
    commitment: BigInt(note.commitment).toString(),
    amount: note.amountWei,
    asset: BigInt(note.asset).toString(),
    secret: BigInt(note.secret).toString(),
  });
  const hash = await relayVaultSwap({
    chainId: note.chainId,
    spend: { proof: UNUSED_PROOF, root: UNUSED_ROOT, nullifier: from.nullifier, asset: info.assetIn, amount: BigInt(info.amountIn) },
    deposit: { proof: UNUSED_PROOF, commitment: info.out.commitment, asset: info.out.asset, amount: BigInt(info.out.amount) },
    refund: { proof: proofBytes, commitment: note.commitment, asset: note.asset, amount: BigInt(note.amountWei) },
    route: info.route,
  });
  await waitForTx(hash).catch(() => null);
}
