"use client";

/**
 * Running a private swap from the browser (lib/vaultSwap has the router and
 * quotes). A swap spends one whole note, so part of a note is first set aside
 * in its own note (lib/cashOutSplit, the same as a partial cash out). Then:
 *
 *   1. make the new note for exactly the planned amount, and a refund note in
 *      the note's own asset, and prove both shields;
 *   2. ask the router for this swap's escrow (escrowFor: derived from both new
 *      notes and the route) and prove the note's unshield to it, so nobody can
 *      change what lands;
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
import { fieldToBytes32, proveUnshieldInBrowser } from "./proveClient";
import type { PoseidonMerklePath } from "./merklePoseidon";
import { prepareBridgeNote } from "./bridgePrivate";
import { freshPath, splitForCashOut } from "./cashOutSplit";
import { relayVaultSwap, RelaySubmitError, waitForTx } from "./relay/client";
import { getRhPublicClient } from "./rhClient";
import { dropUnsentNote, saveLocalNote, shieldPoolAbi, updateLocalNote, type LocalNote } from "./shield";
import type { GloamNetwork } from "./networks";
import { encodeRoute, refundAmountFor, vaultSwapAbi, type SwapPlan } from "./vaultSwap";

/** Relay codes after which the swap may still have gone out. */
const MAYBE_SENT = new Set(["maybe_sent", "rpc", "network", "error", "internal", "in_flight"]);

export const SWAP_MAYBE_SENT =
  "The swap may have gone out. Your money is safe in the vault: refresh in a minute to see where it landed.";

export const SWAP_REFUNDED =
  "The swap couldn't finish, so the money went back to your private balance, less the vault's cash-out fee.";

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

  // 2. The escrow the unshield must name, and the unshield proof to it.
  const routeBytes = encodeRoute(plan.route);
  const escrow = await getRhPublicClient().readContract({
    address: router,
    abi: vaultSwapAbi,
    functionName: "escrowFor",
    args: [target.asset, out.note.commitment, args.assetOut, plan.amountOut, back.note.commitment, BigInt(back.note.amountWei), keccak256(routeBytes)],
  });
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
  const { proofBytes } = await proveUnshieldInBrowser(w.circomInput);
  const nullifier = fieldToBytes32(w.publicInputs.nullifier);

  // 3. Both saved before anything is sent.
  const now = Date.now();
  const outNote: LocalNote = { ...out.note, id: `sw-${now}`, sweptFrom: { id: target.id, nullifier }, sweepPending: true };
  const refundNote: LocalNote = { ...back.note, id: `swr-${now}`, sweptFrom: { id: target.id, nullifier }, sweepPending: true };
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
    // Final: nothing moved, the note is still in the balance.
    dropBoth();
    throw new Error("The swap didn't go through, so nothing moved. Get a new quote and try again.");
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
  updateLocalNote(landed.id, { sweepPending: false, txHash: hash, ...(at ? { leafIndex: at.leafIndex } : {}) });
  return {
    hash,
    refunded,
    outNote: { ...landed, txHash: hash, sweepPending: false, ...(at ? { leafIndex: at.leafIndex } : {}) },
  };
}
