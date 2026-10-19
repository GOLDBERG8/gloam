/**
 * Bring money in from another chain, through Relay (relay.link).
 *
 * Relay gives a one-time deposit address on the source chain. The person sends
 * a stablecoin there from any wallet or exchange, and Relay delivers the
 * matching stablecoin to their own wallet on Robinhood Chain or Tempo. From
 * there they add it to their private balance as usual. Nothing here touches
 * the shielded pool: the bridge is a public step, like any deposit.
 *
 * Relay only delivers to mainnets, so the panel stays hidden while Gloam runs
 * on testnet. NEXT_PUBLIC_BRIDGE_PREVIEW=1 shows it anyway for local review.
 *
 * Routes were checked against Relay's live quote API on 2026-10-19.
 */
import type { GloamNetwork, NetworkKey } from "./networks";

export type BridgeChainKind = "evm" | "svm" | "tvm";

export interface BridgeToken {
  symbol: string;
  /** Contract or mint address on its own chain. */
  address: string;
  decimals: number;
}

export interface BridgeSource {
  key: string;
  /** Chain name as people know it. */
  chain: string;
  /** Relay's chain id (Solana and Tron use Relay's own ids). */
  chainId: number;
  token: BridgeToken;
  kind: BridgeChainKind;
  /** Relay needs an API key for deposit addresses from this chain. */
  needsKey?: boolean;
}

export const BRIDGE_SOURCES: BridgeSource[] = [
  { key: "base-usdc", chain: "Base", chainId: 8453, kind: "evm", token: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 } },
  { key: "ethereum-usdc", chain: "Ethereum", chainId: 1, kind: "evm", token: { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 } },
  { key: "ethereum-usdt", chain: "Ethereum", chainId: 1, kind: "evm", token: { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 } },
  { key: "arbitrum-usdc", chain: "Arbitrum", chainId: 42161, kind: "evm", token: { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 } },
  { key: "optimism-usdc", chain: "Optimism", chainId: 10, kind: "evm", token: { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 } },
  { key: "polygon-usdc", chain: "Polygon", chainId: 137, kind: "evm", token: { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 } },
  { key: "bnb-usdt", chain: "BNB Chain", chainId: 56, kind: "evm", token: { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 } },
  { key: "solana-usdc", chain: "Solana", chainId: 792703809, kind: "svm", needsKey: true, token: { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 } },
  { key: "tron-usdt", chain: "Tron", chainId: 728126428, kind: "tvm", token: { symbol: "USDT", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 } },
];

export interface BridgeDestination {
  chainId: number;
  chain: string;
  token: BridgeToken;
}

/** Where money lands for each Gloam network: the mainnet stablecoin its pool takes. */
export const BRIDGE_DESTINATIONS: Record<NetworkKey, BridgeDestination> = {
  robinhood: {
    chainId: 4663,
    chain: "Robinhood Chain",
    token: { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  },
  tempo: {
    chainId: 4217,
    chain: "Tempo",
    token: { symbol: "USDC", address: "0x20c000000000000000000000b9537d11c60e8b50", decimals: 6 },
  },
};

export const BRIDGE_MIN = 1;
export const BRIDGE_MAX = 25_000;

export function bridgeSource(key: string): BridgeSource | null {
  return BRIDGE_SOURCES.find((s) => s.key === key) ?? null;
}

/** Shown on mainnets, or anywhere when the preview flag is on. */
export function bridgeVisible(network: GloamNetwork): boolean {
  return process.env.NEXT_PUBLIC_BRIDGE_PREVIEW === "1" || !network.chain.testnet;
}

/** A refund address on a non-EVM source chain, roughly checked. */
export function validRefundAddress(kind: BridgeChainKind, v: string): boolean {
  if (kind === "svm") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
  if (kind === "tvm") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v);
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

export type BridgeQuote = {
  requestId: string;
  depositAddress: string;
  send: { amount: string; symbol: string; chain: string };
  receive: { amount: string; minimum: string; symbol: string; chain: string };
  feeUsd: number;
  timeSec: number;
};

export type BridgeStage = "waiting" | "moving" | "done" | "failed" | "refunded";

export type BridgeStatus = { stage: BridgeStage; outTx: string | null };
