import { defineChain, zeroAddress, type Address, type Chain } from "viem";
import { mainnetPoolFor, type MainnetChainId } from "./mainnet.js";

/** Native ETH is represented as the zero address across the vault. */
export const NATIVE_ASSET: Address = zeroAddress;

/** BN254 scalar field modulus. */
export const FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Robinhood Chain. */
export const RH_TESTNET_CHAIN_ID = 46630;
export const RH_MAINNET_CHAIN_ID = 4663;

/** Tempo Moderato testnet. Payments-first stablecoin L1; native is USD and it
 *  blocks native msg.value, so shields there are ERC-20-only (PathUSD, 6-dec). */
export const TEMPO_TESTNET_CHAIN_ID = 42431;
/** Tempo mainnet. */
export const TEMPO_MAINNET_CHAIN_ID = 4217;

/** Contracts of record (RH testnet 46630). */
// No-middlemen Poseidon pool (shieldVerifier enforced, no emergencyWithdraw,
// admin changes behind a public 3-day timelock). Redeployed 2026-09-29;
// supersedes 0xAc25c3C4A880194324d1fC78722694e0F315aF1c and 0xaEbB…1834.
// NEVER the drainable pre-C1 pool 0x4F38…12D8F (audit H-P1).
export const SEALED_VAULT: Address =
  "0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740";
export const SEALED_VAULT_DEPLOY_BLOCK = 126_185_021n;
export const GLOAM_PAY_MEMO: Address =
  "0x689ebd9d30E0235c73fd8f10236F850CDB3c5DCE";
/** ShieldIVerifier adapter — set as the pool's shieldVerifier; shield() reverts,
 *  deposits must go through shieldBound() with a proof. */
export const SHIELD_VERIFIER: Address =
  "0x28E6d0D02568EE634f9596645775275DE76b2847";

/** No-middlemen Poseidon pool on Tempo Moderato (42431). Redeployed 2026-09-29,
 *  reuses the same verifiers + Poseidon2 as Robinhood, so the same circuits and
 *  proving path work unchanged — only the pool address and chain id differ. */
export const TEMPO_SEALED_VAULT: Address =
  "0x841DC046Ea3CC842BA3A855731472c6Eb0F2d5eb";
export const TEMPO_SEALED_VAULT_DEPLOY_BLOCK = 37_411_195n;
/** Encrypted payment-message board on Tempo (event has no poster address). */
export const TEMPO_PAY_MEMO: Address =
  "0x3ca88712e9219b5EE4c82D31cAfEaB64C9E9b4E3";
/** Paxos Global Dollar (USDG) on Robinhood Chain testnet, 6 decimals. */
export const RH_USDG: Address =
  "0x7E955252E15c84f5768B83c41a71F9eba181802F";
/** OpenUSD (OUSD), Tempo's recommended stablecoin; 6 decimals, same address on mainnet and Moderato. */
export const TEMPO_OUSD: Address =
  "0x20c0000000000000000000006a37da5c996874be";
/** PathUSD, the primary 6-decimal shieldable stablecoin on Tempo; same address on mainnet and Moderato. */
export const TEMPO_PATHUSD: Address =
  "0x20c0000000000000000000000000000000000000";

// ── Mainnet ───────────────────────────────────────────────────────────────────
// Pool addresses and deploy blocks come from MAINNET_POOLS (src/mainnet.ts),
// the only place they are written. Everything below is known ahead of deploy.

/** Paxos Global Dollar (USDG) on Robinhood Chain mainnet, 6 decimals. */
export const RH_MAINNET_USDG: Address =
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
/** $GLOAM on Robinhood Chain mainnet, 18 decimals. */
export const GLOAM_TOKEN: Address =
  "0xDcD885F5c60b3aD49F6D58718696417314e8724d";
/** Bridged USDC (USDC.e) on Tempo mainnet, TIP-20, 6 decimals. */
export const TEMPO_USDCE: Address =
  "0x20c000000000000000000000b9537d11c60e8b50";
/** USDT0 on Tempo mainnet, TIP-20, 6 decimals. */
export const TEMPO_USDT0: Address =
  "0x20c00000000000000000000014f22ca97301eb73";

/** PoseidonT3 (circomlib, 2 inputs) the mainnet pools hash with, same address on both mainnets. */
export const MAINNET_POSEIDON_T3: Address =
  "0x1a32C2c2A77225EC2dD3BF7be1018819b1039Cb4";

/**
 * Cash-out fee on the mainnet pools at launch: 0.25% (25 basis points) of the
 * amount unshielded, kept by the pool. Deposits and private payments are free.
 * The live value is the pool's withdrawFeeBps(); read it when it matters.
 */
export const CASH_OUT_FEE_BPS = 25;

/**
 * What the pool keeps from a cash out of `amount` base units, rounded down the
 * same way the contract does (the recipient gets amount - fee).
 */
export function cashOutFee(amount: bigint, bps: number = CASH_OUT_FEE_BPS): bigint {
  if (amount < 0n) throw new Error("amount must not be negative");
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("bps must be an integer from 0 to 10000");
  const b = BigInt(bps);
  return (amount / 10_000n) * b + ((amount % 10_000n) * b) / 10_000n;
}

/**
 * Which trusted-setup keys a network's verifiers hold. The testnets use the
 * single-party dev keys. Mainnet uses the final keys of the 13-contributor
 * ceremony (drand round 6561386, release ceremony-final). A proof made with one
 * set never verifies against the other.
 */
export type CeremonyKind = "dev" | "production";

/** Beta deposit limit for one asset, in its base units. */
export interface DepositLimit {
  perDeposit: bigint;
  total: bigint;
}

/** An asset a Gloam pool takes. */
export interface GloamAsset {
  symbol: string;
  /** Token address; the zero address (NATIVE_ASSET) for the chain's native coin. */
  address: Address;
  decimals: number;
  /** Beta deposit limit on mainnet; null where none is set (testnets). */
  depositLimit: DepositLimit | null;
}

export type GloamNetworkKey = "robinhood" | "tempo" | "robinhood-mainnet" | "tempo-mainnet";

/** The chain a network runs on, testnet or mainnet. */
export type GloamChainFamily = "robinhood" | "tempo";

/** Robinhood Chain mainnet (4663). */
export const RH_MAINNET_CHAIN: Chain = defineChain({
  id: RH_MAINNET_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "RobinScan", url: "https://robin.etherscan.io" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

/** Robinhood Chain testnet (46630). */
export const RH_TESTNET_CHAIN: Chain = defineChain({
  id: RH_TESTNET_CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Robinhood Testnet Explorer", url: "https://explorer.testnet.chain.robinhood.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

/**
 * Tempo mainnet (4217). No gas coin: fees are paid in USD stablecoins. The
 * native currency keeps 18 decimals because wallets refuse to add a chain
 * otherwise; Gloam never moves it.
 */
export const TEMPO_MAINNET_CHAIN: Chain = defineChain({
  id: TEMPO_MAINNET_CHAIN_ID,
  name: "Tempo",
  nativeCurrency: { name: "US Dollar", symbol: "USD", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.tempo.xyz"] } },
  blockExplorers: { default: { name: "Tempo Explorer", url: "https://explore.tempo.xyz" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

/** Tempo Moderato testnet (42431). */
export const TEMPO_TESTNET_CHAIN: Chain = defineChain({
  id: TEMPO_TESTNET_CHAIN_ID,
  name: "Tempo Testnet (Moderato)",
  nativeCurrency: { name: "US Dollar", symbol: "USD", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.moderato.tempo.xyz"] } },
  blockExplorers: { default: { name: "Tempo Testnet Explorer", url: "https://explore.testnet.tempo.xyz" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

const units = (whole: bigint, decimals: number) => whole * 10n ** BigInt(decimals);
const stableLimit: DepositLimit = { perDeposit: units(500n, 6), total: units(25_000n, 6) };

/** Robinhood Chain mainnet pool assets and their beta deposit limits. Native ETH is not listed. */
export const RH_MAINNET_ASSETS: GloamAsset[] = [
  { symbol: "USDG", address: RH_MAINNET_USDG, decimals: 6, depositLimit: stableLimit },
  { symbol: "GLOAM", address: GLOAM_TOKEN, decimals: 18, depositLimit: { perDeposit: units(25_000n, 18), total: units(250_000n, 18) } },
];

/** Tempo mainnet pool assets (TIP-20, 6 decimals) and their beta deposit limits. */
export const TEMPO_MAINNET_ASSETS: GloamAsset[] = [
  { symbol: "USDC.e", address: TEMPO_USDCE, decimals: 6, depositLimit: stableLimit },
  { symbol: "pathUSD", address: TEMPO_PATHUSD, decimals: 6, depositLimit: stableLimit },
  { symbol: "USDT0", address: TEMPO_USDT0, decimals: 6, depositLimit: stableLimit },
  { symbol: "OUSD", address: TEMPO_OUSD, decimals: 6, depositLimit: stableLimit },
];

/**
 * The networks Gloam's private core runs on. Robinhood Chain and Tempo are
 * separate deployments of the same shielded-pool design (not a bridge, not one
 * cross-chain pool), each with a mainnet and a testnet. An app or agent picks
 * one and points the builders at that network's pool and chain id.
 */
export interface GloamNetwork {
  key: GloamNetworkKey;
  /** The chain's name, the same for its mainnet and testnet ("Robinhood Chain", "Tempo"). */
  label: string;
  chainId: number;
  /** Shielded pool address. */
  pool: Address;
  /** Block the pool was deployed at (start of tree scans). */
  deployBlock: bigint;
  /** Encrypted payment-message board for this network, or null where there is none (mainnet at launch). */
  payMemo: Address | null;
  /** Whether native-value shields are allowed (Tempo blocks native msg.value; Robinhood Chain mainnet lists no native asset). */
  nativeShield: boolean;
  /** Which chain this is, testnet or mainnet. */
  family: GloamChainFamily;
  /** Test funds (true) or real money (false). */
  testnet: boolean;
  /** The key set this network's verifiers hold; prove with the same set. */
  ceremony: CeremonyKind;
  /** viem chain, for clients and wallet_addEthereumChain. */
  chain: Chain;
  rpcUrl: string;
  explorerUrl: string;
  /** Assets the pool takes, with beta deposit limits on mainnet. */
  assets: GloamAsset[];
}

/** A testnet entry: always has a payment-message board. */
export type GloamTestnetNetwork = GloamNetwork & { key: "robinhood" | "tempo"; payMemo: Address; testnet: true };

/**
 * The two TESTNETS, by chain: Robinhood Chain testnet (46630) and Tempo
 * Moderato (42431). Unchanged since 0.0.x so existing code keeps working; for
 * mainnet use mainnetNetwork() or gloamNetworks().
 */
export const GLOAM_NETWORKS: Record<"robinhood" | "tempo", GloamTestnetNetwork> = {
  robinhood: {
    key: "robinhood",
    label: "Robinhood Chain",
    chainId: RH_TESTNET_CHAIN_ID,
    pool: SEALED_VAULT,
    deployBlock: SEALED_VAULT_DEPLOY_BLOCK,
    payMemo: GLOAM_PAY_MEMO,
    nativeShield: true,
    family: "robinhood",
    testnet: true,
    ceremony: "dev",
    chain: RH_TESTNET_CHAIN,
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
    // Plus the faucet stock tokens (TSLA, AMZN, PLTR, NFLX, AMD), testnet only.
    assets: [
      { symbol: "ETH", address: NATIVE_ASSET, decimals: 18, depositLimit: null },
      { symbol: "USDG", address: RH_USDG, decimals: 6, depositLimit: null },
    ],
  },
  tempo: {
    key: "tempo",
    label: "Tempo",
    chainId: TEMPO_TESTNET_CHAIN_ID,
    pool: TEMPO_SEALED_VAULT,
    deployBlock: TEMPO_SEALED_VAULT_DEPLOY_BLOCK,
    payMemo: TEMPO_PAY_MEMO,
    nativeShield: false,
    family: "tempo",
    testnet: true,
    ceremony: "dev",
    chain: TEMPO_TESTNET_CHAIN,
    rpcUrl: "https://rpc.moderato.tempo.xyz",
    explorerUrl: "https://explore.testnet.tempo.xyz",
    assets: [
      { symbol: "PathUSD", address: TEMPO_PATHUSD, decimals: 6, depositLimit: null },
      { symbol: "OUSD", address: TEMPO_OUSD, decimals: 6, depositLimit: null },
      { symbol: "AlphaUSD", address: "0x20c0000000000000000000000000000000000001", decimals: 6, depositLimit: null },
      { symbol: "BetaUSD", address: "0x20c0000000000000000000000000000000000002", decimals: 6, depositLimit: null },
      { symbol: "ThetaUSD", address: "0x20c0000000000000000000000000000000000003", decimals: 6, depositLimit: null },
    ],
  },
};

/** The two TESTNETS, by chain. Same object as GLOAM_NETWORKS, named for what it holds. */
export const GLOAM_TESTNETS = GLOAM_NETWORKS;

const MAINNET_CHAIN_IDS: Record<GloamChainFamily, MainnetChainId> = { robinhood: 4663, tempo: 4217 };

function buildMainnet(family: GloamChainFamily): GloamNetwork | null {
  const chainId = MAINNET_CHAIN_IDS[family];
  const p = mainnetPoolFor(chainId);
  if (!p) return null;
  const rh = family === "robinhood";
  const chain = rh ? RH_MAINNET_CHAIN : TEMPO_MAINNET_CHAIN;
  return {
    key: rh ? "robinhood-mainnet" : "tempo-mainnet",
    label: rh ? "Robinhood Chain" : "Tempo",
    chainId,
    pool: p.pool,
    deployBlock: p.deployBlock,
    // Payment-message boards, deployed 2026-10-23 (no owner, never logs the poster).
    payMemo: rh ? "0x01B3172d9900Cb26d57E986429b9b23854c74598" : "0x342E3745967FDB4223902E196Ceb792c15d8C1c4",
    nativeShield: false,
    family,
    testnet: false,
    ceremony: "production",
    chain,
    rpcUrl: chain.rpcUrls.default.http[0]!,
    explorerUrl: chain.blockExplorers!.default.url,
    assets: rh ? RH_MAINNET_ASSETS : TEMPO_MAINNET_ASSETS,
  };
}

const MAINNETS: Record<GloamChainFamily, GloamNetwork | null> = {
  robinhood: buildMainnet("robinhood"),
  tempo: buildMainnet("tempo"),
};

/**
 * A chain's MAINNET network (real money), or null while its pool is not in
 * this SDK version. Mainnet pools are ShieldPoolPayments: payments only, beta
 * deposit limits, the ceremony's final keys, a 0.25% cash-out fee.
 */
export function mainnetNetwork(family: GloamChainFamily): GloamNetwork | null {
  return MAINNETS[family];
}

/** Every network Gloam runs on right now: mainnets with a pool first, then the testnets. */
export function gloamNetworks(): GloamNetwork[] {
  const live = [MAINNETS.robinhood, MAINNETS.tempo].filter((n): n is GloamNetwork => n !== null);
  return [...live, GLOAM_NETWORKS.robinhood, GLOAM_NETWORKS.tempo];
}

/** A network by key ("robinhood-mainnet", "tempo-mainnet", "robinhood", "tempo"), or null if it has no pool yet. */
export function getGloamNetwork(key: GloamNetworkKey): GloamNetwork | null {
  return gloamNetworks().find((n) => n.key === key) ?? null;
}

/** Resolve the Gloam network for a chain id, or undefined if Gloam has no pool there (yet). */
export function networkForChainId(chainId: number): GloamNetwork | undefined {
  return gloamNetworks().find((n) => n.chainId === chainId);
}

/** True for Robinhood Chain mainnet (4663) and Tempo mainnet (4217), pool or not. */
export function isMainnetChainId(chainId: number): boolean {
  return chainId === RH_MAINNET_CHAIN_ID || chainId === TEMPO_MAINNET_CHAIN_ID;
}

/**
 * The key set a proof for `chainId` must use. Mainnet chain ids always answer
 * "production", pool or not, so a mainnet proof is never made with dev keys.
 */
export function ceremonyForChainId(chainId: number): CeremonyKind {
  return isMainnetChainId(chainId) ? "production" : "dev";
}

/** "Robinhood Chain testnet", "Tempo testnet", or plain "Robinhood Chain" / "Tempo" on mainnet. */
export function networkName(chainId: number): string {
  if (chainId === RH_MAINNET_CHAIN_ID) return "Robinhood Chain";
  if (chainId === TEMPO_MAINNET_CHAIN_ID) return "Tempo";
  if (chainId === RH_TESTNET_CHAIN_ID) return "Robinhood Chain testnet";
  if (chainId === TEMPO_TESTNET_CHAIN_ID) return "Tempo testnet";
  return `chain ${chainId}`;
}

/**
 * The Gloam pool on `chainId`, for builders called without a poolAddress.
 * Throws on a mainnet whose pool is not in this SDK version and on chains Gloam
 * does not run on, rather than guess a pool.
 */
export function poolForChainId(chainId: number): Address {
  const net = networkForChainId(chainId);
  if (net) return net.pool;
  if (isMainnetChainId(chainId)) {
    throw new Error(
      `The Gloam pool on ${networkName(chainId)} mainnet is not in this version of @gloamtrade/sdk. Update the SDK, or pass poolAddress.`
    );
  }
  throw new Error(`Gloam has no pool on chain ${chainId}. Pass poolAddress.`);
}

/**
 * Checks a deposit against what the network's pool takes, before any proof is
 * made: a native deposit where the pool takes none, an asset a mainnet pool
 * does not list, or an amount over the beta per-deposit limit. Unknown chains
 * (a pool passed in explicitly) are not checked. The pool's running total is
 * checked on chain, not here.
 */
export function assertDepositAllowed(chainId: number, asset: Address, amount: bigint): void {
  const net = networkForChainId(chainId);
  if (!net) return;
  const where = networkName(chainId);
  if (asset.toLowerCase() === NATIVE_ASSET.toLowerCase() && !net.nativeShield) {
    throw new Error(`The ${where} pool takes no native deposits. Pass an asset it lists: ${net.assets.map((a) => a.symbol).join(", ")}.`);
  }
  if (net.testnet) return;
  const listed = net.assets.find((a) => a.address.toLowerCase() === asset.toLowerCase());
  if (!listed) {
    throw new Error(`The ${where} pool does not list ${asset}. It takes ${net.assets.map((a) => a.symbol).join(", ")}.`);
  }
  if (listed.depositLimit && amount > listed.depositLimit.perDeposit) {
    const cap = listed.depositLimit.perDeposit / 10n ** BigInt(listed.decimals);
    throw new Error(`Over the beta limit on ${where}: at most ${cap.toLocaleString("en-US")} ${listed.symbol} per deposit.`);
  }
}

// ── Circuit artifacts ─────────────────────────────────────────────────────────

/** Where Gloam hosts the circuit files. Dev keys at the root, the ceremony's final keys under /final. */
export const GLOAM_ARTIFACTS_URL = "https://www.gloam.trade/circuits";

/** The pool circuits: deposit, private send, cash out. */
export type PoolCircuit = "shield" | "transfer" | "unshield";

/**
 * SHA-256 of each circuit file, to check a download before proving with it.
 * The .wasm files are the same for both key sets; the zkeys differ.
 */
export const CIRCUIT_SHA256: {
  wasm: Record<PoolCircuit, string>;
  zkey: Record<CeremonyKind, Record<PoolCircuit, string>>;
} = {
  wasm: {
    shield: "58157ec90f8af891acfa998bd599511b4d5cd06803cea32ab28a6eea8a9b2336",
    transfer: "081929509c3477ee264cb2422183018c23122d59952ed4a61c4932c95d360872",
    unshield: "84ac0942b1618c6112a10bfe82ff0a62a80b7a14881565781eb513e9e581c480",
  },
  zkey: {
    dev: {
      shield: "e4d42271b99faa218faebb38a06f69b5ccf01e328d3dea4381ab567e9fbd2481",
      transfer: "f75bc324f12e1f467f5779a7275737aa0fa514a6c317e3d775f1dba8f0234666",
      unshield: "f4b4c5bfa315cef38634eec1b64b8d9ad1d28725f61fde5e169fef1896360b63",
    },
    production: {
      shield: "3054877c35e2e0e9f76c43aa4791ac2b3ac51b8967d51be2215e89c0a5fbb512",
      transfer: "bdbae966705bc85e76571b4945da74a43fc4503a955fd4e3799358bcff749cdb",
      unshield: "5a12073f3f84b52f794feaf862fb1d48301124319db95a9c6d0dc58277fa54ed",
    },
  },
};

/** One circuit's files for a key set, as paths relative to the artifacts root, with their SHA-256. */
export function circuitArtifactFiles(
  circuit: PoolCircuit,
  ceremony: CeremonyKind
): { wasm: string; zkey: string; sha256: { wasm: string; zkey: string } } {
  return {
    wasm: `${circuit}.wasm`,
    zkey: ceremony === "production" ? `final/${circuit}_final.zkey` : `${circuit}_final.zkey`,
    sha256: { wasm: CIRCUIT_SHA256.wasm[circuit], zkey: CIRCUIT_SHA256.zkey[ceremony][circuit] },
  };
}

/**
 * URLs of the wasm and zkey to prove `circuit` for `chainId`, with the key set
 * that chain's verifiers hold (final keys on mainnet, dev keys on testnet).
 * Pass straight to artifactProver in the browser; in node, download them first
 * (snarkjs proves from local paths there) and check CIRCUIT_SHA256.
 */
export function circuitArtifactUrls(
  circuit: PoolCircuit,
  chainId: number,
  base: string = GLOAM_ARTIFACTS_URL
): { wasm: string; zkey: string } {
  const root = base.replace(/\/+$/, "");
  const f = circuitArtifactFiles(circuit, ceremonyForChainId(chainId));
  return { wasm: `${root}/${f.wasm}`, zkey: `${root}/${f.zkey}` };
}
