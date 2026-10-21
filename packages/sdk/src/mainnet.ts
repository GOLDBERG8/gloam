/**
 * Mainnet pools: the one place their addresses live in the SDK.
 *
 * MAINNET_POOLS is FILLED IN ON DEPLOY DAY: paste each pool address and the
 * block its deploy transaction landed in (the deploy script prints both), the
 * same values as MAINNET_POOLS in the app (app/src/lib/mainnet.ts). Until a
 * chain has both, that mainnet does not exist for the SDK: mainnetNetwork()
 * returns null, gloamNetworks() leaves it out, and the builders refuse its
 * chain id instead of guessing a pool.
 *
 * Everything else about mainnet (chains, assets, limits, keys) is derived in
 * constants.ts from these two entries.
 */
import type { Address } from "viem";

export type MainnetChainId = 4663 | 4217;

export interface MainnetPoolInput {
  /** ShieldPoolPayments address, or null until it is deployed. */
  pool: Address | null;
  /** Block the pool's deploy transaction landed in, or null until it is deployed. */
  deployBlock: bigint | null;
}

export const MAINNET_POOLS: Record<MainnetChainId, MainnetPoolInput> = {
  // Robinhood Chain mainnet (4663): USDG + GLOAM. Filled on deploy day.
  4663: { pool: null, deployBlock: null },
  // Tempo mainnet (4217): USDC.e, pathUSD, USDT0, OUSD. Filled on deploy day.
  4217: { pool: null, deployBlock: null },
};

/**
 * A chain's mainnet pool, or null while it is not filled in. A value that is
 * not a real address or deploy block throws, so a typo fails loudly instead of
 * pointing money at the wrong contract.
 */
export function mainnetPoolFor(chainId: MainnetChainId): { pool: Address; deployBlock: bigint } | null {
  const { pool, deployBlock } = MAINNET_POOLS[chainId];
  if (pool === null || deployBlock === null) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(pool) || /^0x0{40}$/.test(pool)) {
    throw new Error(`MAINNET_POOLS[${chainId}].pool is not a pool address: ${pool}`);
  }
  if (deployBlock <= 0n) {
    throw new Error(`MAINNET_POOLS[${chainId}].deployBlock must be the deploy block, got ${deployBlock}`);
  }
  return { pool, deployBlock };
}
