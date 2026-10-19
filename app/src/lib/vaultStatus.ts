/**
 * Vault readiness without depending on the user's wallet network.
 */

import { zeroAddress, type Address } from "viem";
import {
  TESTNET_POSEIDON_POOL,
  LEGACY_POSEIDON_POOL,
} from "./config";
import { getRhPublicClient } from "./rhClient";
import { SHIELD_POOL_ADDRESS, shieldPoolAbi } from "./shield";
import { readDemo } from "./demoFlag";
import { demoPoolInventory } from "./demo/chain";

/** Sealed-swap IVerifier on the hardened RH testnet pool (poseidon-testnet.json).
 *  Used only as a transient-RPC-error fallback, never to mask a real disable. */
export const KNOWN_SEALED_SWAP_VERIFIER =
  "0x9D866ca3b981585D5E6B138E4411C804c4d6C198" as const satisfies Address;

export type VaultReadiness =
  | { status: "ready"; verifier: Address; pool: Address }
  | { status: "no_verifier"; pool: Address }
  | { status: "offline"; pool: Address | null; reason: string };

export async function readVaultSealedReadiness(): Promise<VaultReadiness> {
  const pool = SHIELD_POOL_ADDRESS;
  if (!pool) {
    return { status: "offline", pool: null, reason: "No vault address in app config." };
  }

  // Known sealed vault: prefer live read, fall back to known verifier
  const isKnownSealed =
    pool.toLowerCase() === TESTNET_POSEIDON_POOL.toLowerCase();

  try {
    const client = getRhPublicClient();
    const v = (await client.readContract({
      address: pool,
      abi: shieldPoolAbi,
      functionName: "sealedSwapVerifier",
    })) as Address;

    if (!v || v === zeroAddress) {
      // A successful read of 0 means sealed swaps are genuinely unset, or were
      // deliberately disabled (audit H1). Report unavailable so the UI falls
      // back to the public path instead of letting a private trade revert
      // on-chain. (Do NOT mask a real disable with the known-verifier fallback.)
      return { status: "no_verifier", pool };
    }
    return { status: "ready", verifier: v, pool };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "RPC error";
    // A failed read is not a "yes": sealed swaps are off on-chain (audit H1),
    // so assuming the known verifier here let people send trades that could
    // only revert. Say the network is unreachable and let them retry.
    if (isKnownSealed) {
      return { status: "offline", pool, reason: "Couldn't reach Robinhood Chain just now. Try again in a moment." };
    }
    if (pool.toLowerCase() === LEGACY_POSEIDON_POOL.toLowerCase()) {
      return {
        status: "offline",
        pool,
        reason: "This build points at the pre-sealed vault. Need the sealed pool.",
      };
    }
    return { status: "offline", pool, reason: msg.slice(0, 120) };
  }
}

export async function readPoolDeposited(asset: Address): Promise<bigint | null> {
  // Recording demo: the vault always holds enough to cover the pretend wallet.
  if (readDemo()) return demoPoolInventory(asset);
  const pool = SHIELD_POOL_ADDRESS;
  if (!pool) return null;
  try {
    const client = getRhPublicClient();
    return (await client.readContract({
      address: pool,
      abi: shieldPoolAbi,
      functionName: "deposited",
      args: [asset],
    })) as bigint;
  } catch {
    return null;
  }
}
