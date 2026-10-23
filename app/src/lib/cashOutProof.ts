"use client";

/**
 * The cash-out proof, made in this browser: it spends one whole note and binds
 * the amount and the address it pays. The same call goes out now (through the
 * relay or from the wallet) or to the relay for later (lib/cashOutLater).
 */
import type { Address, Hex } from "viem";
import type { PoseidonMerklePath } from "./merklePoseidon";
import { fieldToBytes32, proveUnshieldInBrowser } from "./proveClient";
import { buildPoseidonUnshieldWitness } from "./proverPoseidon";
import type { LocalNote } from "./shield";

export type CashOutCall = {
  chainId: number;
  proof: Hex;
  root: Hex;
  nullifier: Hex;
  asset: Address;
  to: Address;
  amount: bigint;
};

/** Proves a cash out of all of `note` to `to`. Throws when the note does not open its commitment. */
export async function proveCashOut(note: LocalNote, to: Address, path: PoseidonMerklePath, chainId: number): Promise<CashOutCall> {
  const w = await buildPoseidonUnshieldWitness({
    secretHex: note.secret,
    amount: BigInt(note.amountWei),
    asset: note.asset,
    to,
    path,
  });
  if (!w.checks.commitmentMatches) {
    throw new Error(w.blocker ?? "This balance does not match the vault.");
  }
  const { proofBytes } = await proveUnshieldInBrowser(w.circomInput);
  return {
    chainId,
    proof: proofBytes,
    root: fieldToBytes32(w.publicInputs.root),
    nullifier: fieldToBytes32(w.publicInputs.nullifier),
    asset: note.asset,
    to,
    amount: BigInt(note.amountWei),
  };
}
