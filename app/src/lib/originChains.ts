/**
 * The EVM chains a connected wallet can pay a private bridge order from
 * (lib/bridge BRIDGE_CHAINS, kind "evm"). Registered in the wagmi config so
 * the wallet can switch to them and their receipts can be read, and used on
 * the server to check the wallet holds enough before it signs.
 */
import type { Chain } from "viem";
import {
  arbitrum,
  avalanche,
  base,
  berachain,
  blast,
  bsc,
  celo,
  gnosis,
  hyperEvm,
  ink,
  linea,
  mainnet,
  mantle,
  monad,
  optimism,
  polygon,
  scroll,
  sonic,
  unichain,
  worldchain,
  xLayer,
  zksync,
} from "viem/chains";

export const ORIGIN_CHAINS: readonly Chain[] = [
  mainnet,
  base,
  bsc,
  arbitrum,
  polygon,
  optimism,
  avalanche,
  linea,
  zksync,
  unichain,
  worldchain,
  monad,
  hyperEvm,
  sonic,
  mantle,
  xLayer,
  celo,
  gnosis,
  scroll,
  ink,
  berachain,
  blast,
];

export function originChain(id: number): Chain | null {
  return ORIGIN_CHAINS.find((c) => c.id === id) ?? null;
}
