"use client";

/**
 * Bringing money in straight to the private balance (app/api/bridge/private):
 * the browser makes the note and its shield proof for the exact amount, Relay
 * makes the deposit on arrival, and this settles the note once the vault
 * shows it. The note is saved before the wallet is asked, out of the balance
 * until it lands (sweepPending), so a closed tab never loses it:
 * reconcileClaims (lib/claimSweep) settles it on the next visit.
 */
import type { Address, Hex } from "viem";
import { appClaimEnv } from "./claimSweep";
import type { GloamNetwork } from "./networks";
import { makeBoundNotePoseidon } from "./notePoseidon";
import { proveShieldInBrowser } from "./proveClient";
import { HASH_SCHEME, updateLocalNote, type LocalNote } from "./shield";

/** A note for exactly `amount` of `asset` in this network's vault, and the proof that binds it. */
export async function prepareBridgeNote(
  amount: bigint,
  asset: Address,
  network: GloamNetwork,
  owner: Address
): Promise<{ note: LocalNote; proof: Hex }> {
  if (!network.pool) throw new Error("This network has no vault yet.");
  const n = await makeBoundNotePoseidon(amount, asset);
  const { proofBytes } = await proveShieldInBrowser({
    commitment: BigInt(n.commitment).toString(),
    amount: amount.toString(),
    asset: BigInt(asset).toString(),
    secret: BigInt(n.secret).toString(),
  });
  const note: LocalNote = {
    id: `${Date.now()}-${n.commitment.slice(0, 10)}`,
    chainId: network.chainId,
    pool: network.pool,
    asset,
    amountWei: amount.toString(),
    commitment: n.commitment,
    secret: n.secret,
    nullifier: n.nullifier,
    bound: true,
    scheme: HASH_SCHEME,
    from: owner,
    createdAt: Date.now(),
    status: "open",
    source: "local",
  };
  return { note, proof: proofBytes };
}

/** Count the note once the vault holds its commitment. Returns false while it hasn't landed. */
export async function settleBridgeNote(note: LocalNote, txHash: string | null): Promise<boolean> {
  const env = appClaimEnv();
  const seen = await env.chain.isCommitmentSeen(note.commitment).catch(() => false);
  if (!seen) return false;
  const leafIndex = await env.leafIndexOf(note.commitment).catch(() => undefined);
  updateLocalNote(note.id, {
    sweepPending: false,
    ...(leafIndex != null ? { leafIndex } : {}),
    ...(txHash && /^0x[0-9a-fA-F]{64}$/.test(txHash) ? { txHash: txHash as Hex } : {}),
  });
  return true;
}
