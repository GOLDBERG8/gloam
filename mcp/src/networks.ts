/**
 * Per-network runtime config for the MCP's execution rail. Pool, chain id,
 * deploy block, key set and assets come from the SDK (single source of truth:
 * GLOAM_NETWORKS for the testnets, mainnetNetwork() for the mainnets); the RPC
 * (overridable), explorer, native currency and the default asset are added here
 * because the SDK stays transport-agnostic.
 *
 * Four networks: Robinhood Chain and Tempo, each on mainnet (real money, the
 * ceremony's final keys, payments only, beta deposit limits) and testnet (test
 * funds, dev keys). A mainnet only exists here once the SDK has its pool, so a
 * build without it never offers that network. Robinhood Chain and Tempo are
 * separate deployments of the same pool design, so the same execution code
 * serves every network.
 *
 * GLOAM_RPC_URL_<chainId> points a network at another RPC (for example a
 * private one), read when this module loads.
 */
import type { Address } from "viem";
import {
  GLOAM_NETWORKS,
  NATIVE_ASSET,
  TEMPO_PATHUSD,
  mainnetNetwork,
  type CeremonyKind,
  type GloamNetwork,
} from "@gloamtrade/sdk";

export type NetworkKey = "robinhood" | "tempo" | "robinhood-mainnet" | "tempo-mainnet";
export type ChainFamily = "robinhood" | "tempo";

export interface McpNetwork {
  key: NetworkKey;
  /** Which chain: Robinhood Chain or Tempo, testnet or mainnet. */
  family: ChainFamily;
  /** Test funds (true) or real money (false). */
  testnet: boolean;
  /** The key set the pool's verifiers hold: dev on testnet, the ceremony's final keys on mainnet. */
  ceremony: CeremonyKind;
  name: string;
  chainId: number;
  pool: Address;
  rpc: string;
  explorer: string;
  /** Block the pool was deployed at, for tree scans. */
  deployBlock: bigint;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** Whether native-value shields are allowed (Tempo blocks native msg.value; Robinhood Chain mainnet lists no native asset). */
  nativeShield: boolean;
  /** Default asset to shield: native ETH on Robinhood testnet, PathUSD on Tempo testnet, USDG / USDC.e on mainnet. */
  defaultAsset: Address;
  defaultAssetSymbol: string;
  defaultAssetDecimals: number;
}

type Env = Record<string, string | undefined>;

const rpcFor = (chainId: number, fallback: string, env: Env = process.env) =>
  env[`GLOAM_RPC_URL_${chainId}`]?.trim() || fallback;

const NATIVE = {
  robinhood: { name: "Ether", symbol: "ETH", decimals: 18 },
  tempo: { name: "US Dollar", symbol: "USD", decimals: 18 },
} as const;

export const MCP_NETWORKS: Record<"robinhood" | "tempo", McpNetwork> = {
  robinhood: {
    key: "robinhood",
    family: "robinhood",
    testnet: true,
    ceremony: "dev",
    name: "Robinhood Chain Testnet",
    chainId: GLOAM_NETWORKS.robinhood.chainId,
    pool: GLOAM_NETWORKS.robinhood.pool,
    rpc: rpcFor(GLOAM_NETWORKS.robinhood.chainId, "https://rpc.testnet.chain.robinhood.com"),
    explorer: "https://explorer.testnet.chain.robinhood.com",
    deployBlock: GLOAM_NETWORKS.robinhood.deployBlock,
    nativeCurrency: NATIVE.robinhood,
    nativeShield: true,
    defaultAsset: NATIVE_ASSET,
    defaultAssetSymbol: "ETH",
    defaultAssetDecimals: 18,
  },
  tempo: {
    key: "tempo",
    family: "tempo",
    testnet: true,
    ceremony: "dev",
    name: "Tempo Moderato Testnet",
    chainId: GLOAM_NETWORKS.tempo.chainId,
    pool: GLOAM_NETWORKS.tempo.pool,
    rpc: rpcFor(GLOAM_NETWORKS.tempo.chainId, "https://rpc.moderato.tempo.xyz"),
    explorer: "https://explore.testnet.tempo.xyz",
    deployBlock: GLOAM_NETWORKS.tempo.deployBlock,
    nativeCurrency: NATIVE.tempo,
    nativeShield: false,
    defaultAsset: TEMPO_PATHUSD,
    defaultAssetSymbol: "PathUSD",
    defaultAssetDecimals: 6,
  },
};

function fromMainnet(n: GloamNetwork | null): McpNetwork | null {
  if (!n) return null;
  // The first listed asset is the default: USDG on Robinhood Chain, USDC.e on Tempo.
  const first = n.assets[0]!;
  return {
    key: n.key,
    family: n.family,
    testnet: false,
    ceremony: n.ceremony,
    name: n.family === "robinhood" ? "Robinhood Chain Mainnet" : "Tempo Mainnet",
    chainId: n.chainId,
    pool: n.pool,
    rpc: rpcFor(n.chainId, n.rpcUrl),
    explorer: n.explorerUrl,
    deployBlock: n.deployBlock,
    nativeCurrency: NATIVE[n.family],
    nativeShield: n.nativeShield,
    defaultAsset: first.address,
    defaultAssetSymbol: first.symbol,
    defaultAssetDecimals: first.decimals,
  };
}

/** The mainnets this build has a pool for, Robinhood Chain first. Empty before deploy day. */
export const MCP_MAINNETS: McpNetwork[] = [fromMainnet(mainnetNetwork("robinhood")), fromMainnet(mainnetNetwork("tempo"))].filter(
  (n): n is McpNetwork => n !== null
);

/** Every network this build can use: mainnets first, then the testnets. */
export function allNetworks(): McpNetwork[] {
  return [...MCP_MAINNETS, MCP_NETWORKS.robinhood, MCP_NETWORKS.tempo];
}

/** The network keys this build offers, for tool schemas (mainnets first). */
export const NETWORK_KEYS = allNetworks().map((n) => n.key) as [NetworkKey, ...NetworkKey[]];

export function isNetworkKey(v: unknown): v is NetworkKey {
  return typeof v === "string" && (NETWORK_KEYS as string[]).includes(v);
}

export function networkByKey(key: NetworkKey): McpNetwork {
  const n = allNetworks().find((x) => x.key === key);
  if (!n) throw new Error(`${key} is not available in this version of @gloamtrade/mcp: its pool is not published in the SDK it ships with. Update the package.`);
  return n;
}

export function networkByChainId(chainId: number): McpNetwork | undefined {
  return allNetworks().find((n) => n.chainId === chainId);
}

/** "Robinhood Chain mainnet (real money)" / "Tempo testnet (test funds)", for messages. */
export function describeNetwork(n: McpNetwork): string {
  const chain = n.family === "robinhood" ? "Robinhood Chain" : "Tempo";
  return n.testnet ? `${chain} testnet (test funds)` : `${chain} mainnet (real money)`;
}

/**
 * The network tools use when the agent does not name one: GLOAM_NETWORK when it
 * names a network this build has, else Robinhood Chain testnet as in earlier
 * versions. A GLOAM_NETWORK this build does not have fails loudly instead of
 * quietly using another network.
 */
export function defaultNetworkKey(env: Env = process.env): NetworkKey {
  const raw = env.GLOAM_NETWORK?.trim();
  if (!raw) return "robinhood";
  if (isNetworkKey(raw)) return raw;
  throw new Error(
    raw === "robinhood-mainnet" || raw === "tempo-mainnet"
      ? `GLOAM_NETWORK=${raw}, but this version of @gloamtrade/mcp has no ${raw} pool yet. Update the package, or pick one of: ${NETWORK_KEYS.join(", ")}.`
      : `GLOAM_NETWORK=${raw} is not a Gloam network. Use one of: ${NETWORK_KEYS.join(", ")}.`
  );
}

/**
 * The Tempo network a Tempo access key lives on: Tempo mainnet when
 * GLOAM_NETWORK names a mainnet, otherwise Tempo testnet. An access key is
 * authorized per chain, so one made on testnet does nothing on mainnet.
 */
export function tempoAccessNetwork(env: Env = process.env): McpNetwork {
  const key = defaultNetworkKey(env);
  return key === "robinhood-mainnet" || key === "tempo-mainnet" ? networkByKey("tempo-mainnet") : MCP_NETWORKS.tempo;
}
