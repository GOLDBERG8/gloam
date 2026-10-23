/**
 * Gloam network registry: the runtime source of truth for every chain the
 * product can point at. Two testnets (Robinhood Chain testnet and Tempo
 * Moderato) and their two mainnets.
 *
 * Everything chain-specific (chain object, shielded pool, deploy block, hash
 * scheme, native + stable assets, explorer links) hangs off one `GloamNetwork`
 * record so the app can switch networks at runtime instead of at build time.
 * Robinhood values are re-exported from the existing single sources
 * (chain.ts / config.ts) so there is no second copy to drift.
 *
 * A mainnet only exists once its pool is filled in (MAINNET_POOLS in
 * lib/mainnet.ts). Until then it is left out of NETWORK_KEYS, isNetworkKey,
 * allNetworks and everything built on them (selector, API, relay, MCP, proofs),
 * so the app is exactly the two testnets it was before.
 */
import { defineChain, type Address, type Chain } from "viem";
import { robinhood, robinhoodTestnet } from "./chain";
import type { CeremonyKind } from "./circuitArtifacts";
import {
  TESTNET_POSEIDON_POOL,
  TESTNET_POSEIDON_DEPLOY_BLOCK,
  type HashScheme,
} from "./config";
import { isMainnetLive, mainnetPool } from "./mainnet";

export type NetworkKey = "robinhood" | "tempo" | "robinhood-mainnet" | "tempo-mainnet";

/** The chain a network runs on, testnet or mainnet: wallets, fees and logos follow it. */
export type ChainFamily = "robinhood" | "tempo";

/**
 * Chain ids of the networks Gloam knows. Typed as the literal union so
 * `network.chainId` is accepted directly by wagmi hook options (`useBalance`,
 * `useSendTransaction`, `useWaitForTransactionReceipt`, `switchChain`), which
 * narrow `chainId` to the configured ids. Mainnet ids are only registered with
 * wagmi once their pool is filled in (lib/wagmi.ts).
 */
export type GloamChainId = 46630 | 42431 | 4663 | 4217;

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
  /** The chain's name, the same for its testnet and its mainnet ("Robinhood Chain", "Tempo"). */
  label: string;
  family: ChainFamily;
  /** Test funds (true) or real money (false). */
  testnet: boolean;
  /**
   * Tokenized stocks: the Markets page, stock holdings and private trade. Only
   * on Robinhood Chain testnet; the mainnet pools take payments only.
   */
  stocks: boolean;
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
  /** The chain's native gas coin (ETH on Robinhood Chain, USD on Tempo). */
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

/**
 * Tempo mainnet. Same shape as Moderato: no gas coin, fees in USD stablecoins.
 * The native currency keeps 18 decimals like the testnet entry, because wallets
 * refuse wallet_addEthereumChain with anything else and Gloam never moves it.
 * Multicall3 is deployed at its usual address (checked on chain 2026-10-20).
 */
export const tempoMainnet = defineChain({
  id: 4217,
  name: "Tempo",
  nativeCurrency: { name: "US Dollar", symbol: "USD", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.tempo.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Tempo Explorer",
      url: "https://explore.tempo.xyz",
    },
  },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const RH_MAINNET_POOL = mainnetPool(4663);
const TEMPO_MAINNET_POOL = mainnetPool(4217);

const NETWORKS: Record<NetworkKey, GloamNetwork> = {
  robinhood: {
    key: "robinhood",
    label: "Robinhood Chain",
    family: "robinhood",
    testnet: true,
    stocks: true,
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
    family: "tempo",
    testnet: true,
    stocks: false,
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
  // Mainnet: ShieldPoolPayments with the ceremony's final keys, payments only
  // (no sealed swap), beta deposit limits on, and a payment-memo board (payMemo).
  "robinhood-mainnet": {
    key: "robinhood-mainnet",
    label: "Robinhood Chain",
    family: "robinhood",
    testnet: false,
    stocks: false,
    chain: robinhood,
    chainId: robinhood.id,
    pool: RH_MAINNET_POOL?.pool ?? null,
    deployBlock: RH_MAINNET_POOL?.deployBlock ?? null,
    ceremony: "production",
    logRange: 100_000n,
    hashScheme: "poseidon",
    primaryAsset: { symbol: "ETH", address: null, decimals: 18 },
    stableAssets: [],
    status: "live",
    // GloamPayMemo, deployed 2026-10-23 (no owner, holds nothing, never logs the poster)
    payMemo: { address: "0x01B3172d9900Cb26d57E986429b9b23854c74598", deployBlock: 95_494_392n, emitsPoster: false },
    note: "Mainnet, real money: private USDG payments, and $GLOAM held privately.",
    explorerTx: (hash) => `${robinhood.blockExplorers.default.url}/tx/${hash}`,
    explorerAddress: (addr) => `${robinhood.blockExplorers.default.url}/address/${addr}`,
  },
  "tempo-mainnet": {
    key: "tempo-mainnet",
    label: "Tempo",
    family: "tempo",
    testnet: false,
    stocks: false,
    chain: tempoMainnet,
    chainId: tempoMainnet.id,
    pool: TEMPO_MAINNET_POOL?.pool ?? null,
    deployBlock: TEMPO_MAINNET_POOL?.deployBlock ?? null,
    ceremony: "production",
    logRange: 100_000n,
    hashScheme: "poseidon",
    primaryAsset: { symbol: "USD", address: null, decimals: 18 },
    stableAssets: [],
    status: "live",
    // GloamPayMemo, deployed 2026-10-23 (no owner, holds nothing, never logs the poster)
    payMemo: { address: "0x342E3745967FDB4223902E196Ceb792c15d8C1c4", deployBlock: 45_417_629n, emitsPoster: false },
    note: "Mainnet, real money: private stablecoin payments (USDC.e, pathUSD, USDT0, OUSD).",
    explorerTx: (hash) => `${tempoMainnet.blockExplorers.default.url}/tx/${hash}`,
    explorerAddress: (addr) => `${tempoMainnet.blockExplorers.default.url}/address/${addr}`,
  },
};

/** Mainnets whose pool is filled in, Robinhood Chain first. Empty before deploy day. */
const MAINNET_KEYS: NetworkKey[] = (["robinhood-mainnet", "tempo-mainnet"] as const).filter(
  (k) => NETWORKS[k].pool !== null && NETWORKS[k].deployBlock !== null
);

/** True once at least one mainnet pool is filled in: the app then labels real money and test funds. */
export const MAINNET_ENABLED = MAINNET_KEYS.length > 0;

/** The network a visitor starts on before mainnet is live (and on the server, always). */
export const DEFAULT_NETWORK_KEY: NetworkKey = "robinhood";

let sessionDefault: NetworkKey | null = null;

/**
 * The network a visitor lands on when they never picked one: Robinhood Chain
 * testnet, as always, until mainnet is live; from then a mainnet (Robinhood
 * Chain's, or Tempo's when only Tempo has a pool). Worked out once per page
 * load, so the selector and lib code never disagree if the launch passes while
 * a tab is open. On the server it is always DEFAULT_NETWORK_KEY.
 */
export function defaultNetworkKey(): NetworkKey {
  if (typeof window === "undefined") return DEFAULT_NETWORK_KEY;
  sessionDefault ??= isMainnetLive() && MAINNET_KEYS[0] ? MAINNET_KEYS[0] : DEFAULT_NETWORK_KEY;
  return sessionDefault;
}

/** localStorage key the network selector persists to (mirror of NetworkProvider). */
const ACTIVE_NETWORK_STORAGE_KEY = "gloam.network";

/**
 * The active network for non-React code (lib functions that cannot use the
 * useNetwork hook). Reads the same localStorage key the selector writes, and
 * falls back to defaultNetworkKey(). SSR and blocked-storage safe. React
 * components should prefer useNetwork().
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
  return NETWORKS[defaultNetworkKey()];
}

/** The networks Gloam runs on right now: mainnets with a pool first, then the testnets. */
export const NETWORK_KEYS: NetworkKey[] = [...MAINNET_KEYS, "robinhood", "tempo"];

/**
 * The key set a proof made for `chainId` was made with; the dev keys for a
 * chain Gloam doesn't run on. Mainnet chain ids always answer "production",
 * pool or not, so a mainnet proof is never checked against the dev keys.
 */
export function ceremonyForChain(chainId: unknown): CeremonyKind {
  const id = Number(chainId);
  return Object.values(NETWORKS).find((n) => n.chainId === id)?.ceremony ?? "dev";
}

export function getNetwork(key: NetworkKey): GloamNetwork {
  return NETWORKS[key];
}

/** All networks Gloam runs on, live first, for rendering a selector. */
export function allNetworks(): GloamNetwork[] {
  return NETWORK_KEYS.map(getNetwork).sort((a, b) =>
    a.status === b.status ? 0 : a.status === "live" ? -1 : 1
  );
}

/** A key of a network Gloam runs on right now (a mainnet without a pool is not one). */
export function isNetworkKey(v: string | null | undefined): v is NetworkKey {
  return typeof v === "string" && (NETWORK_KEYS as string[]).includes(v);
}

/** A network can take real shield/spend writes only when live with a pool. */
export function isNetworkWritable(n: GloamNetwork): boolean {
  return n.status === "live" && n.pool !== null;
}

/** The network names an API takes, for its errors: '"robinhood" or "tempo"' until a mainnet pool is in. */
export function networkKeyChoices(): string {
  const q = (["robinhood", "tempo", ...MAINNET_KEYS] as NetworkKey[]).map((k) => `"${k}"`);
  return `${q.slice(0, -1).join(", ")} or ${q[q.length - 1]}`;
}

/** "Robinhood Chain testnet", "Tempo testnet", or plain "Robinhood Chain" / "Tempo" on mainnet. */
export function networkName(n: Pick<GloamNetwork, "label" | "testnet">): string {
  return n.testnet ? `${n.label} testnet` : n.label;
}
