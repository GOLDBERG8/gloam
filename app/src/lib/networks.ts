/**
 * Gloam network registry: the runtime source of truth for every chain the
 * product can point at. Today Robinhood Chain testnet is the live flagship;
 * Tempo testnet (Moderato) is scaffolded for the World's Fair expansion and is
 * marked `planned` until its shielded pool + verifiers are deployed (Phase 1).
 *
 * Everything chain-specific (chain object, shielded pool, deploy block, hash
 * scheme, native + stable assets, explorer links) hangs off one `GloamNetwork`
 * record so the app can switch networks at runtime instead of at build time.
 * Robinhood values are re-exported from the existing single sources
 * (chain.ts / config.ts) so there is no second copy to drift.
 */
import { defineChain, type Address, type Chain } from "viem";
import { robinhoodTestnet } from "./chain";
import type { CeremonyKind } from "./circuitArtifacts";
import {
  TESTNET_POSEIDON_POOL,
  TESTNET_POSEIDON_DEPLOY_BLOCK,
  type HashScheme,
} from "./config";

export type NetworkKey = "robinhood" | "tempo";

/**
 * Chain ids of the networks registered in the wagmi config. Typed as the literal
 * union so `network.chainId` is accepted directly by wagmi hook options
 * (`useBalance`, `useSendTransaction`, `useWaitForTransactionReceipt`,
 * `switchChain`), which narrow `chainId` to the configured ids.
 */
export type GloamChainId = 46630 | 42431;

/** Whether a network is deployed and safe for real shield/spend writes. */
export type NetworkStatus = "live" | "planned";

export interface NetworkAsset {
  symbol: string;
  /** ERC-20 address, or null for the chain's native gas asset. */
  address: Address | null;
  decimals: number;
}

/**
 * Encrypted payment-memo board (GloamPayMemo): lets a recipient find a private
 * payment by scanning the chain with their Gloam address, no link needed.
 * `emitsPoster` is true for the first deploy, whose event also indexed the
 * poster's address (fixed in source by audit L-1; relayed memos hide it anyway).
 */
export interface PayMemoBoard {
  address: Address;
  deployBlock: bigint;
  emitsPoster: boolean;
}

function envAddress(v: string | undefined): Address | null {
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null;
}

function envBlock(v: string | undefined, fallback: bigint): bigint {
  try {
    return v ? BigInt(v) : fallback;
  } catch {
    return fallback;
  }
}

export interface GloamNetwork {
  key: NetworkKey;
  label: string;
  /** viem chain used for clients, wallet_addEthereumChain, etc. */
  chain: Chain;
  chainId: GloamChainId;
  /** Shielded pool address; null while a network is still `planned`. */
  pool: Address | null;
  /** Block the pool was deployed at, for getLogs / tree rebuild. */
  deployBlock: bigint | null;
  /** Largest eth_getLogs block range the public RPC accepts. */
  logRange: bigint;
  hashScheme: HashScheme;
  /**
   * The trusted-setup keys this network's verifiers hold: the single-party dev
   * keys on the testnets, the ceremony's final keys on mainnet. Proofs for the
   * network are made and checked with the same set (lib/circuitArtifacts).
   */
  ceremony: CeremonyKind;
  /** The asset the chain leads with in the product narrative. */
  primaryAsset: NetworkAsset;
  /** Stable assets shieldable on this network (empty until registered). */
  stableAssets: NetworkAsset[];
  status: NetworkStatus;
  /** Payment-memo board, null until deployed on this network. */
  payMemo: PayMemoBoard | null;
  /** One-line, honest description of where the network stands. */
  note: string;
  explorerTx: (hash: string) => string;
  explorerAddress: (addr: string) => string;
}

/**
 * Tempo testnet (Moderato). Payments-first EVM L1 (Reth) incubated by Stripe +
 * Paradigm; native currency is USD and gas is paid in stablecoins. Params from
 * the official connection docs (docs.tempo.xyz). USD decimals are unspecified
 * upstream; 18 is the EVM/Reth default and must be confirmed before writes.
 */
export const tempoTestnet = defineChain({
  id: 42431,
  name: "Tempo Testnet (Moderato)",
  nativeCurrency: { name: "US Dollar", symbol: "USD", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.moderato.tempo.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Tempo Testnet Explorer",
      url: "https://explore.testnet.tempo.xyz",
    },
  },
  // Multicall3 at its usual address, so batched reads go out as one call
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

const NETWORKS: Record<NetworkKey, GloamNetwork> = {
  robinhood: {
    key: "robinhood",
    label: "Robinhood Chain",
    chain: robinhoodTestnet,
    chainId: robinhoodTestnet.id,
    pool: TESTNET_POSEIDON_POOL,
    deployBlock: TESTNET_POSEIDON_DEPLOY_BLOCK,
    ceremony: "dev",
    // Robinhood's RPC rejects topic-filtered eth_getLogs over 100k blocks.
    logRange: 100_000n,
    hashScheme: "poseidon",
    primaryAsset: { symbol: "ETH", address: null, decimals: 18 },
    stableAssets: [],
    status: "live",
    payMemo: {
      address:
        envAddress(process.env.NEXT_PUBLIC_PAY_MEMO) ??
        "0x689ebd9d30E0235c73fd8f10236F850CDB3c5DCE",
      deployBlock: envBlock(process.env.NEXT_PUBLIC_PAY_MEMO_DEPLOY_BLOCK, 90_421_567n),
      emitsPoster: !envAddress(process.env.NEXT_PUBLIC_PAY_MEMO),
    },
    note: "Live on testnet: shield, private send, cash out, selective disclosure.",
    explorerTx: (hash) =>
      `${robinhoodTestnet.blockExplorers.default.url}/tx/${hash}`,
    explorerAddress: (addr) =>
      `${robinhoodTestnet.blockExplorers.default.url}/address/${addr}`,
  },
  tempo: {
    key: "tempo",
    label: "Tempo",
    chain: tempoTestnet,
    chainId: tempoTestnet.id,
    // No-middlemen pool redeployed on Tempo Moderato 2026-09-29: no
    // emergencyWithdraw, setup ended, admin changes behind a public 3-day
    // timelock. Reuses the existing verifiers + Poseidon2. Superseded:
    // 0xeD0b…2276 (block 35_578_268), 0x3eeE…D30b (block 34_556_677).
    pool: "0x841DC046Ea3CC842BA3A855731472c6Eb0F2d5eb",
    deployBlock: 37_411_195n,
    ceremony: "dev",
    // Tempo RPC: "query exceeds max block range 100000"
    logRange: 100_000n,
    hashScheme: "poseidon",
    primaryAsset: { symbol: "USD", address: null, decimals: 18 },
    stableAssets: [],
    status: "live",
    // Deployed 2026-09-29 from the fixed source (no poster in the event).
    payMemo: {
      address:
        envAddress(process.env.NEXT_PUBLIC_PAY_MEMO_TEMPO) ??
        "0x3ca88712e9219b5EE4c82D31cAfEaB64C9E9b4E3",
      deployBlock: envBlock(process.env.NEXT_PUBLIC_PAY_MEMO_TEMPO_DEPLOY_BLOCK, 37_410_900n),
      emitsPoster: false,
    },
    note: "Live on Tempo Moderato: private stablecoin payments (shield PathUSD, send, cash out).",
    explorerTx: (hash) =>
      `${tempoTestnet.blockExplorers.default.url}/tx/${hash}`,
    explorerAddress: (addr) =>
      `${tempoTestnet.blockExplorers.default.url}/address/${addr}`,
  },
};

export const DEFAULT_NETWORK_KEY: NetworkKey = "robinhood";

/** localStorage key the network selector persists to (mirror of NetworkProvider). */
const ACTIVE_NETWORK_STORAGE_KEY = "gloam.network";

/**
 * The active network for non-React code (lib functions that cannot use the
 * useNetwork hook). Reads the same localStorage key the selector writes, and
 * defaults to Robinhood. SSR and blocked-storage safe. React components should
 * prefer useNetwork().
 *
 * Only `live` networks are selectable in the UI, so today this always resolves
 * to Robinhood; it becomes meaningful the moment Tempo is marked live.
 */
export function getActiveNetwork(): GloamNetwork {
  if (typeof window === "undefined") return NETWORKS[DEFAULT_NETWORK_KEY];
  try {
    const v = window.localStorage.getItem(ACTIVE_NETWORK_STORAGE_KEY);
    if (isNetworkKey(v)) {
      const n = NETWORKS[v];
      // Never resolve to a non-writable network for lib/write code.
      if (isNetworkWritable(n)) return n;
    }
  } catch {
    /* private mode / blocked storage */
  }
  return NETWORKS[DEFAULT_NETWORK_KEY];
}

export const NETWORK_KEYS = Object.keys(NETWORKS) as NetworkKey[];

/** The key set a proof made for `chainId` was made with; the dev keys for a chain Gloam doesn't run on. */
export function ceremonyForChain(chainId: unknown): CeremonyKind {
  const id = Number(chainId);
  return NETWORK_KEYS.map((k) => NETWORKS[k]).find((n) => n.chainId === id)?.ceremony ?? "dev";
}

export function getNetwork(key: NetworkKey): GloamNetwork {
  return NETWORKS[key];
}

/** All networks, live first, for rendering a selector. */
export function allNetworks(): GloamNetwork[] {
  return NETWORK_KEYS.map(getNetwork).sort((a, b) =>
    a.status === b.status ? 0 : a.status === "live" ? -1 : 1
  );
}

export function isNetworkKey(v: string | null | undefined): v is NetworkKey {
  return v === "robinhood" || v === "tempo";
}

/** A network can take real shield/spend writes only when live with a pool. */
export function isNetworkWritable(n: GloamNetwork): boolean {
  return n.status === "live" && n.pool !== null;
}
