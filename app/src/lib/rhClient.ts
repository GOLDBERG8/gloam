/**
 * Dedicated public client for the active Gloam network's pool reads.
 * Does NOT depend on the wallet connection or wagmi chain selection, so the
 * browser can always read the vault even when the wallet is on another network.
 * Resolves the active network (Robinhood today, Tempo once selectable) and
 * caches one client per chain.
 */

import { createPublicClient, http, type PublicClient } from "viem";
import { getActiveNetwork } from "./networks";

const cache = new Map<number, PublicClient>();

export function getRhPublicClient(): PublicClient {
  const net = getActiveNetwork();
  const existing = cache.get(net.chainId);
  if (existing) return existing;
  const client = createPublicClient({
    chain: net.chain,
    transport: http(net.chain.rpcUrls.default.http[0], {
      timeout: 25_000,
      retryCount: 2,
    }),
    // reads made together (spent checks, balances) go out as one Multicall3 call
    batch: { multicall: true },
  });
  cache.set(net.chainId, client);
  return client;
}
