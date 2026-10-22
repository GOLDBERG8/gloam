/**
 * Bring money in from another chain, through Relay (relay.link).
 *
 * Relay gives a one-time deposit address on the source chain. The person sends
 * a stablecoin or the chain's own coin there, from any wallet or exchange, and
 * Relay delivers the matching stablecoin (swapping if needed) to their own
 * wallet on Robinhood Chain or Tempo. From there they add it to their private
 * balance as usual. Nothing here touches the shielded pool: the bridge is a
 * public step, like any deposit.
 *
 * Relay only delivers to mainnets, so the panel stays hidden while Gloam runs
 * on testnet. NEXT_PUBLIC_BRIDGE_PREVIEW=1 shows it anyway for local review.
 *
 * Every chain and token below was checked with a live Relay deposit-address
 * quote into Robinhood Chain USDG on 2026-10-19 (Solana's route was checked
 * without a deposit address, which needs an API key). Logos are kept in
 * public/brand so a browser never calls a third party to draw them.
 */
import type { ChainFamily, GloamNetwork } from "./networks";

export type BridgeChainKind = "evm" | "svm" | "tvm" | "bvm";

export interface BridgeToken {
  symbol: string;
  /** Contract, mint or Relay's native-coin id on its own chain. */
  address: string;
  decimals: number;
  logo: string;
  /** A dollar stablecoin, so the amount is in dollars. */
  stable?: boolean;
}

export interface BridgeChain {
  /** Relay's chain id (Solana, Tron and Bitcoin use Relay's own ids). */
  id: number;
  name: string;
  kind: BridgeChainKind;
  /** Relay needs an API key for deposit addresses from this chain. */
  needsKey?: boolean;
  /** The network's own chain: a swap the wallet signs, not a deposit address. */
  swap?: boolean;
  tokens: BridgeToken[];
}

export const BRIDGE_CHAINS: BridgeChain[] = [
  { id: 1, name: "Ethereum", kind: "evm", tokens: [{ symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6, logo: "/brand/tokens/usdt.png", stable: true }, { symbol: "USDG", address: "0xe343167631d89b6ffc58b88d6b7fb0228795491d", decimals: 6, logo: "/brand/tokens/usdg.png", stable: true }, { symbol: "PYUSD", address: "0x6c3ea9036406852006290770bedfcaba0e23a0e8", decimals: 6, logo: "/brand/tokens/pyusd.png", stable: true }, { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
  { id: 8453, name: "Base", kind: "evm", tokens: [{ symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "USDT", address: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", decimals: 6, logo: "/brand/tokens/usdt.png", stable: true }, { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
  { id: 792703809, name: "Solana", kind: "svm", needsKey: true, tokens: [{ symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "USDT", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6, logo: "/brand/tokens/usdt.png", stable: true }, { symbol: "USDG", address: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH", decimals: 6, logo: "/brand/tokens/usdg.png", stable: true }, { symbol: "PYUSD", address: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", decimals: 6, logo: "/brand/tokens/pyusd.png", stable: true }, { symbol: "SOL", address: "11111111111111111111111111111111", decimals: 9, logo: "/brand/tokens/sol.png" }] },
  { id: 56, name: "BNB Chain", kind: "evm", tokens: [{ symbol: "USDC", address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", decimals: 18, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "USDT", address: "0x55d398326f99059ff775485246999027b3197955", decimals: 18, logo: "/brand/tokens/usdt.png", stable: true }, { symbol: "BNB", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/bnb.png" }] },
  { id: 8253038, name: "Bitcoin", kind: "bvm", tokens: [{ symbol: "BTC", address: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8", decimals: 8, logo: "/brand/tokens/btc.png" }] },
  { id: 42161, name: "Arbitrum", kind: "evm", tokens: [{ symbol: "USDC", address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "USDT", address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", decimals: 6, logo: "/brand/tokens/usdt.png", stable: true }, { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
  { id: 728126428, name: "Tron", kind: "tvm", tokens: [{ symbol: "USDT", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6, logo: "/brand/tokens/usdt.png", stable: true }, { symbol: "TRX", address: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", decimals: 6, logo: "/brand/tokens/trx.png" }] },
  { id: 137, name: "Polygon", kind: "evm", tokens: [{ symbol: "USDC", address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "USDT", address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", decimals: 6, logo: "/brand/tokens/usdt.png", stable: true }, { symbol: "USDC.e", address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", decimals: 6, logo: "/brand/tokens/usdc.e.png", stable: true }] },
  { id: 10, name: "Optimism", kind: "evm", tokens: [{ symbol: "USDC", address: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "USDT", address: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", decimals: 6, logo: "/brand/tokens/usdt.png", stable: true }, { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
  { id: 43114, name: "Avalanche", kind: "evm", tokens: [{ symbol: "USDC", address: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }] },
  { id: 59144, name: "Linea", kind: "evm", tokens: [{ symbol: "USDC", address: "0x176211869ca2b568f2a7d4ee941e073a821ee1ff", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
  { id: 324, name: "zkSync Era", kind: "evm", tokens: [{ symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
  { id: 130, name: "Unichain", kind: "evm", tokens: [{ symbol: "USDC", address: "0x078d782b760474a361dda0af3839290b0ef57ad6", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
  { id: 480, name: "World Chain", kind: "evm", tokens: [{ symbol: "USDC", address: "0x79a02482a880bce3f13e09da970dc34db4cd24d1", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
  { id: 143, name: "Monad", kind: "evm", tokens: [{ symbol: "USDC", address: "0x754704bc059f8c67012fed69bc8a327a5aafb603", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "USDT0", address: "0xe7cd86e13ac4309349f30b3435a9d337750fc82d", decimals: 6, logo: "/brand/tokens/usdt0.png", stable: true }, { symbol: "MON", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/mon.png" }] },
  { id: 999, name: "HyperEVM", kind: "evm", tokens: [{ symbol: "USDC", address: "0xb88339cb7199b77e23db6e890353e22632ba630f", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "HYPE", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/hype.png" }] },
  { id: 146, name: "Sonic", kind: "evm", tokens: [{ symbol: "USDC", address: "0x29219dd400f2bf60e5a23d13be72b486d4038894", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }] },
  { id: 5000, name: "Mantle", kind: "evm", tokens: [{ symbol: "USDC", address: "0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "USDT0", address: "0x779ded0c9e1022225f8e0630b35a9b54be713736", decimals: 6, logo: "/brand/tokens/usdt0.png", stable: true }] },
  { id: 196, name: "X Layer", kind: "evm", tokens: [{ symbol: "USDC", address: "0xb6ceceab302e2e4948951ee7843fc24e92933061", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }, { symbol: "USDG", address: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8", decimals: 6, logo: "/brand/tokens/usdg.png", stable: true }] },
  { id: 42220, name: "Celo", kind: "evm", tokens: [{ symbol: "USDC", address: "0xceba9300f2b948710d2653dd7b07f33a8b32118c", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }] },
  { id: 100, name: "Gnosis", kind: "evm", tokens: [{ symbol: "USDC", address: "0x2a22f9c3b484c3629090feed35f17ff8f88f76f0", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }] },
  { id: 534352, name: "Scroll", kind: "evm", tokens: [{ symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
  { id: 57073, name: "Ink", kind: "evm", tokens: [{ symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
  { id: 80094, name: "Berachain", kind: "evm", tokens: [{ symbol: "USDC", address: "0x549943e04f40284185054145c6e4e9568c1d3241", decimals: 6, logo: "/brand/tokens/usdc.png", stable: true }] },
  { id: 81457, name: "Blast", kind: "evm", tokens: [{ symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }] },
];

export interface BridgeDestination {
  chainId: number;
  chain: string;
  token: { symbol: string; address: string; decimals: number; logo: string };
}

/** Where money lands on each chain: the mainnet stablecoin its pool takes. */
export const BRIDGE_DESTINATIONS: Record<ChainFamily, BridgeDestination> = {
  robinhood: {
    chainId: 4663,
    chain: "Robinhood Chain",
    token: { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, logo: "/brand/tokens/usdg.png" },
  },
  tempo: {
    chainId: 4217,
    chain: "Tempo",
    token: { symbol: "USDC", address: "0x20c000000000000000000000b9537d11c60e8b50", decimals: 6, logo: "/brand/tokens/usdc.png" },
  },
};

/**
 * The gas coin on a network's own chain, swapped by Relay into the pool's
 * stablecoin in the same wallet. Same chain, so the wallet signs one swap
 * instead of sending to a deposit address, which costs far less: a live quote
 * on 2026-10-21 gave 2.490 USDG for 0.001 ETH this way, 2.441 through an address.
 */
export const SWAP_SOURCES: Partial<Record<ChainFamily, BridgeChain>> = {
  robinhood: {
    id: 4663,
    name: "Robinhood Chain",
    kind: "evm",
    swap: true,
    tokens: [{ symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, logo: "/brand/tokens/eth.png" }],
  },
};

/** The swap on this network's own chain, when it has one: mainnet only, since Relay swaps real money. */
export function swapSource(network: Pick<GloamNetwork, "family" | "chainId">): BridgeChain | null {
  const s = SWAP_SOURCES[network.family];
  return s && s.id === network.chainId ? s : null;
}

/** ETH kept back by Max, so the swap itself can still pay its network fee. */
export const SWAP_GAS_RESERVE_WEI = BigInt(200_000_000_000_000);

/**
 * Gloam's tag on Relay quotes, so /admin can read back what went through the
 * panel (lib/relayVolume). Relay takes it only with an API key.
 */
export const RELAY_REFERRER = "gloam.trade";

/** Dollar limits for one bridge, checked against Relay's own dollar value of the deposit. */
export const BRIDGE_MIN_USD = 1;
export const BRIDGE_MAX_USD = 25_000;

const CHAIN_NAMES = new Map<number, string>([
  ...BRIDGE_CHAINS.map((c) => [c.id, c.name] as [number, string]),
  ...Object.values(BRIDGE_DESTINATIONS).map((d) => [d.chainId, d.chain] as [number, string]),
]);

/** A chain's name by Relay id, or "Chain <id>" when Gloam doesn't list it. */
export function relayChainName(id: number | null): string {
  if (id == null) return "Unknown";
  return CHAIN_NAMES.get(id) ?? `Chain ${id}`;
}

export function bridgeChain(id: number): BridgeChain | null {
  return BRIDGE_CHAINS.find((c) => c.id === id) ?? null;
}

export function bridgeToken(chain: BridgeChain, symbol: string): BridgeToken | null {
  return chain.tokens.find((t) => t.symbol === symbol) ?? null;
}

export function chainLogo(id: number, dark = false): string {
  return `/brand/chains/${id}${dark ? "-dark" : ""}.png`;
}

/** Shown on mainnets, or anywhere when the preview flag is on. */
export function bridgeVisible(network: GloamNetwork): boolean {
  return process.env.NEXT_PUBLIC_BRIDGE_PREVIEW === "1" || !network.chain.testnet;
}

/** A refund address on a non-EVM source chain, roughly checked. */
export function validRefundAddress(kind: BridgeChainKind, v: string): boolean {
  if (kind === "svm") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
  if (kind === "tvm") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v);
  if (kind === "bvm") return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(v);
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

export type BridgeQuote = {
  requestId: string;
  /** Empty for a swap, which the wallet signs as `tx` instead. */
  depositAddress: string;
  tx: { to: string; data: string; value: string; chainId: number } | null;
  send: { amount: string; symbol: string; chain: string; chainId: number; logo: string; usd: number | null };
  receive: { amount: string; minimum: string; symbol: string; chain: string; logo: string };
  feeUsd: number;
  /** Relay's estimate in seconds; Bitcoin also waits for its own confirmations. */
  timeSec: number;
  bitcoin: boolean;
};

/**
 * Chains a connected wallet can pay from straight into the private balance:
 * the wallet signs and Relay makes the deposit when the money arrives (an
 * approve and shieldBound run by Relay's router on Robinhood Chain or Tempo).
 * That covers a Solana wallet, an EVM wallet on any listed chain, and the swap
 * on the network's own chain. A deposit address can't carry that call, so
 * sending from an exchange still lands in the wallet first.
 */
export function privateBridgeable(chain: BridgeChain): boolean {
  return chain.kind === "svm" || chain.kind === "evm";
}

/** One transaction an EVM wallet signs for a private bridge order. */
export type PrivateBridgeTx = { to: string; data: string; value: string; chainId: number };

/** A Relay order that pays into the private balance, ready for the source wallet to sign. */
export type PrivateBridgeQuote = {
  requestId: string;
  /** The unsigned Solana transaction, base64, when a Solana wallet pays. */
  solanaTx: string | null;
  /** The transactions an EVM wallet signs in order (an approve, then the deposit; or one swap). */
  evmTxs: PrivateBridgeTx[] | null;
  /** The swap on this chain: the deposit happens in the same transaction. */
  sameChain: boolean;
  send: { amount: string; symbol: string; chain: string; chainId: number; logo: string; usd: number | null };
  receive: { amount: string; symbol: string; chain: string; logo: string };
  /** The swap's price buffer, back to the wallet as the stablecoin. */
  extra: string | null;
  feeUsd: number;
  /** The paying chain's own network fee, when Relay prices it. */
  gasUsd: number | null;
  timeSec: number;
};

export type BridgeStage = "waiting" | "moving" | "done" | "failed" | "refunded";

export type BridgeStatus = { stage: BridgeStage; outTx: string | null };
