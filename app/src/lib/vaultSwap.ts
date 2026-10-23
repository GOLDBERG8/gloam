/**
 * Swapping inside the private balance, through the vault (contracts/src/
 * GloamVaultSwap*.sol). One relayed transaction takes one note out of the
 * vault, buys an exact amount of another asset on a DEX, and puts that amount
 * back into the vault as a new note. Who swapped stays private; the amounts
 * are public, like any DEX trade.
 *
 * The note's unshield proof names a per-swap escrow as `to` (escrowFor on the
 * router), derived from the new note, a refund note and the route, so nobody
 * who copies the proof can change any of them. The refund note only lands if
 * someone sends the unshield on its own; then the money comes back as it.
 *
 * Robinhood Chain has two routers. v1 (GloamVaultSwapV4) swaps USDG and GLOAM
 * over three pools fixed at deploy. v2 (GloamVaultSwapV4b) swaps any token in
 * RH_SWAP_ASSETS_V2 for any other over RH_SWAP_POOLS_V2, in up to three hops,
 * with ETH held in the vault as WETH. One switch, VAULT_SWAP_V2_ROUTER, picks
 * which one new swaps use; the relay keeps both, so a refund of a swap made
 * through either still finishes.
 *
 * Shared by the app and the relay server: no browser-only imports here.
 */
import {
  concatHex,
  encodeAbiParameters,
  getContractAddress,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// GloamVaultSwapV4, deployed 2026-10-23 (block 95481565); pools match RH_SWAP_POOLS
const RH_ROUTER_V1: Address = "0x34AB06208586A737Bf1607fa996Bc9162271c52d";
// GloamVaultSwapTempo, deployed 2026-10-23 (block 45415156)
const TEMPO_ROUTER: Address = "0xfCa1887e77f738ef9C5751974b3f3873d029F2DC";

/**
 * The one switch for private swaps v2 (GloamVaultSwapV4b) on Robinhood Chain.
 * null: new swaps go through v1, as they do today. Put v2's address here once
 * it is deployed (contracts/script/DeployVaultSwapV4b.s.sol) and the vault
 * takes WETH. New swaps then go through v2: any token in RH_SWAP_ASSETS_V2 for
 * any other, over RH_SWAP_POOLS_V2. v1 stays known to the relay, so a refund
 * of a swap made through it still finishes.
 */
export const VAULT_SWAP_V2_ROUTER: Record<number, Address | null> = {
  4663: null,
};

/** The router new swaps go through, per chain. null: swaps are off there. */
export const VAULT_SWAP_ROUTERS: Record<number, Address | null> = {
  4663: VAULT_SWAP_V2_ROUTER[4663] ?? RH_ROUTER_V1,
  4217: TEMPO_ROUTER,
};

/**
 * While swaps are in a private preview, the Swap tab shows only for these
 * wallets. Empty: open to everyone. The routers themselves are permissionless;
 * this only decides who sees the tab.
 */
export const SWAP_PREVIEW_WALLETS: readonly string[] = [];

export function swapOpenTo(address: string | undefined): boolean {
  if (SWAP_PREVIEW_WALLETS.length === 0) return true;
  return Boolean(address) && SWAP_PREVIEW_WALLETS.some((w) => w.toLowerCase() === address!.toLowerCase());
}

export function vaultSwapRouter(chainId: number): Address | null {
  return VAULT_SWAP_ROUTERS[chainId] ?? null;
}

// ---------------------------------------------------------------- Robinhood Chain (Uniswap v4)

export const RH_POOL_MANAGER: Address = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
export const RH_V4_QUOTER: Address = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94";

export const RH_MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

const RH_USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const RH_GLOAM: Address = "0xDcD885F5c60b3aD49F6D58718696417314e8724d";
/**
 * Robinhood Chain's canonical WETH: Arbitrum's aeWETH behind the chain's token
 * bridge (l2Weth() on its WETH gateway 0x1D187C3E…F055, l1Address() is mainnet
 * WETH9), and the WETH9 of Uniswap v4's PositionManager there. Fully backed:
 * totalSupply equals its ETH balance (checked 2026-10-23).
 */
export const RH_WETH: Address = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const NATIVE: Address = "0x0000000000000000000000000000000000000000";
const ORYNTH_HOOK: Address = "0x953391a2DDf7E8437FeB878FDF2C6f325Fbf00CC";

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

/**
 * v1's pools, fixed when it was deployed (DeployVaultSwapRobinhood.s.sol).
 * Any other pool is refused on chain.
 */
export const RH_SWAP_POOLS: readonly PoolKey[] = [
  // ETH / USDG, fee 0.0087%, hookless
  { currency0: NATIVE, currency1: RH_USDG, fee: 87, tickSpacing: 1, hooks: NATIVE },
  // ETH / GLOAM, the launch pool (Orynth hook, which takes the creator fee)
  { currency0: NATIVE, currency1: RH_GLOAM, fee: 0, tickSpacing: 200, hooks: ORYNTH_HOOK },
  // USDG / GLOAM direct, fee 4.215%: dear, only used when it is the better price
  { currency0: RH_USDG, currency1: RH_GLOAM, fee: 42150, tickSpacing: 422, hooks: NATIVE },
];

/**
 * v2's pools: the list DeployVaultSwapV4b.s.sol allows at deploy. To add one,
 * the router's owner queues it on chain (usable 3 days later) and it is added
 * here too. The app routes only through a pool that is on this list and that
 * the router allows right now (livePools), so one the owner removed is
 * skipped at once. Hookless pools only, but for GLOAM's launch pool.
 */
export const RH_SWAP_POOLS_V2: readonly PoolKey[] = [
  ...RH_SWAP_POOLS,
  // ETH / USDG, fee 0.01%, hookless: the best price at small sizes
  { currency0: NATIVE, currency1: RH_USDG, fee: 100, tickSpacing: 1, hooks: NATIVE },
  // ETH / USDG, fee 0.05%, hookless: the deepest at larger sizes
  { currency0: NATIVE, currency1: RH_USDG, fee: 500, tickSpacing: 10, hooks: NATIVE },
  // WETH / USDG, fee 0.02%, hookless: WETH with no wrapping at all
  { currency0: RH_WETH, currency1: RH_USDG, fee: 200, tickSpacing: 4, hooks: NATIVE },
  // USDG / GLOAM direct, fee 2.4%, hookless
  { currency0: RH_USDG, currency1: RH_GLOAM, fee: 24000, tickSpacing: 240, hooks: NATIVE },
];

/** What v1 swaps between. */
const RH_SWAP_ASSETS_V1: readonly Address[] = [RH_USDG, RH_GLOAM];
/**
 * What v2 swaps between, in the order the picker lists them. To offer another
 * token: add it here and its pools to RH_SWAP_POOLS_V2 (queued on the router
 * first), and have the vault take it (a deposit limit, queued on the vault).
 */
export const RH_SWAP_ASSETS_V2: readonly Address[] = [RH_USDG, RH_GLOAM, RH_WETH];

// ---------------------------------------------------------------- Tempo (Stablecoin DEX)

export const TEMPO_STABLE_DEX: Address = "0xdec0000000000000000000000000000000000000";

const TEMPO_SWAP_ASSETS: readonly Address[] = [
  "0x20c000000000000000000000b9537d11c60e8b50", // USDC.e
  "0x20c0000000000000000000000000000000000000", // pathUSD
  "0x20c00000000000000000000014f22ca97301eb73", // USDT0
  "0x20c0000000000000000000006a37da5c996874be", // OUSD
];

/** The assets a new swap can go between, per chain (the current router's list). */
export const VAULT_SWAP_ASSETS: Record<number, readonly Address[]> = {
  4663: VAULT_SWAP_V2_ROUTER[4663] ? RH_SWAP_ASSETS_V2 : RH_SWAP_ASSETS_V1,
  4217: TEMPO_SWAP_ASSETS,
};

// ---------------------------------------------------------------- routers

export type SwapRouter = {
  address: Address;
  /** "v4": Uniswap v4 routes (GloamVaultSwapV4, V4b). "tempo": the Stablecoin DEX, no route. */
  venue: "v4" | "tempo";
  /** 1: GloamVaultSwapV4 or GloamVaultSwapTempo. 2: GloamVaultSwapV4b. */
  version: 1 | 2;
  /** The pools a route may use (on chain, v2's allowlist has the last word). */
  pools: readonly PoolKey[];
  maxHops: number;
  /** v2: the WETH the vault holds for ETH, unwrapped or wrapped at a route's ends. */
  weth: Address | null;
  /** What a swap through it can go between. */
  assets: readonly Address[];
};

/** Every router on a chain, the newest first. */
function routerList(chainId: number): SwapRouter[] {
  if (chainId === 4663) {
    const v1: SwapRouter = {
      address: RH_ROUTER_V1, venue: "v4", version: 1, pools: RH_SWAP_POOLS, maxHops: 2, weth: null, assets: RH_SWAP_ASSETS_V1,
    };
    const v2 = VAULT_SWAP_V2_ROUTER[4663];
    return v2
      ? [{ address: v2, venue: "v4", version: 2, pools: RH_SWAP_POOLS_V2, maxHops: 3, weth: RH_WETH, assets: RH_SWAP_ASSETS_V2 }, v1]
      : [v1];
  }
  if (chainId === 4217) {
    return [{ address: TEMPO_ROUTER, venue: "tempo", version: 1, pools: [], maxHops: 0, weth: null, assets: TEMPO_SWAP_ASSETS }];
  }
  return [];
}

/**
 * A router the app and the relay know: with no address, the one new swaps go
 * through; with one, that router (a refund goes back through the router its
 * swap used). null while swaps are off on the chain, or for an unknown address.
 */
export function swapRouterFor(chainId: number, address?: string | null): SwapRouter | null {
  const current = VAULT_SWAP_ROUTERS[chainId];
  if (!current) return null;
  const all = routerList(chainId);
  if (!all.length) return null;
  if (!address || same(address, current)) return { ...all[0]!, address: current };
  return all.find((r) => same(r.address, address)) ?? null;
}

export function isSwapAsset(chainId: number, asset: string, router?: string | null): boolean {
  const list = swapRouterFor(chainId, router)?.assets ?? VAULT_SWAP_ASSETS[chainId] ?? [];
  return list.some((a) => same(a, asset));
}

/**
 * How far below the quote the swap asks, in basis points. The trade must
 * cost no more than what arrives, or it reverts whole and nothing moves; the
 * part it does not use goes to the treasury. GLOAM moves, stablecoins barely.
 */
export function swapBufferBps(chainId: number): number {
  return chainId === 4217 ? 10 : 50;
}

// ---------------------------------------------------------------- contract

const SWAP_ERRORS = [
  "ZeroAddress", "NotAContract", "SameAsset", "NativeNotSupported", "InvalidAmount", "Reentrancy", "TokenCallFailed",
  "BadRoute", "NotPoolManager", "MiddleNotSettled", "BadRefund", "EscrowUsed", "NativeRefused",
].map((name) => ({ type: "error" as const, name, inputs: [] }));

/** GloamVaultSwap.EscrowKey, in order: what a swap's escrow address is derived from. */
const ESCROW_KEY_COMPONENTS = [
  { name: "nullifier", type: "bytes32" },
  { name: "amountIn", type: "uint256" },
  { name: "outCommitment", type: "bytes32" },
  { name: "assetOut", type: "address" },
  { name: "amountOut", type: "uint256" },
  { name: "refundCommitment", type: "bytes32" },
  { name: "refundAmount", type: "uint256" },
  { name: "routeHash", type: "bytes32" },
] as const;

export type EscrowKey = {
  nullifier: Hex;
  amountIn: bigint;
  outCommitment: Hex;
  assetOut: Address;
  amountOut: bigint;
  refundCommitment: Hex;
  refundAmount: bigint;
  routeHash: Hex;
};

/**
 * SwapEscrow's creation code (contracts/src/SwapEscrow.sol, solc 0.8.24,
 * optimizer 200, shanghai), pinned: keccak256 is SWAP_ESCROW_CODE_HASH, the
 * same value VaultSwapReview.t.sol checks against the compiled contract. The
 * app works each swap's escrow out from it and refuses to swap if the router's
 * own escrowFor disagrees.
 */
export const SWAP_ESCROW_INIT_CODE: Hex =
  "0x608060405234801561000f575f80fd5b5060405161023438038061023483398101604081905261002e916101a4565b6040516370a0823160e01b81523060048201525f906001600160a01b038316906370a0823190602401602060405180830381865afa158015610072573d5f803e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061009691906101d1565b905080156101a25760408051336024820152604480820184905282518083039091018152606490910182526020810180516001600160e01b031663a9059cbb60e01b17905290515f9182916001600160a01b038616916100f5916101e8565b5f604051808303815f865af19150503d805f811461012e576040519150601f19603f3d011682016040523d82523d5f602084013e610133565b606091505b509150915081801561015d57508051158061015d57508080602001905181019061015d9190610214565b61019f5760405162461bcd60e51b815260206004820152600f60248201526e32b9b1b937bb903a3930b739b332b960891b604482015260640160405180910390fd5b50505b005b5f602082840312156101b4575f80fd5b81516001600160a01b03811681146101ca575f80fd5b9392505050565b5f602082840312156101e1575f80fd5b5051919050565b5f82515f5b8181101561020757602081860181015185830152016101ed565b505f920191825250919050565b5f60208284031215610224575f80fd5b815180151581146101ca575f80fdfe";
export const SWAP_ESCROW_CODE_HASH: Hex = "0x192133b7cb5a5193a55ec981c9f7272702248f684d2b85aa1dd843dde9b85bd4";

/** A swap's escrow, worked out here: CREATE2 from the router, salt keccak256(abi.encode(key)). */
export function escrowAddress(router: Address, assetIn: Address, key: EscrowKey): Address {
  const salt = keccak256(encodeAbiParameters(ESCROW_KEY_COMPONENTS, [
    key.nullifier, key.amountIn, key.outCommitment, key.assetOut, key.amountOut, key.refundCommitment, key.refundAmount, key.routeHash,
  ]));
  const bytecode = concatHex([SWAP_ESCROW_INIT_CODE, encodeAbiParameters([{ type: "address" }], [assetIn])]);
  return getContractAddress({ opcode: "CREATE2", from: router, salt, bytecode });
}

/**
 * What a swap's refund note keeps, so the refund can be finished later from
 * this browser (lib/vaultSwapRun finishVaultSwapRefund) if someone sent the
 * note's unshield on its own. Amounts as decimal strings (the note store is JSON).
 */
export type VaultSwapRefundInfo = {
  router: Address;
  assetIn: Address;
  amountIn: string;
  out: { commitment: Hex; asset: Address; amount: string };
  route: PoolKey[];
};

/** The escrow key for a refund note, from what it keeps. */
export function refundEscrowKey(info: VaultSwapRefundInfo, nullifier: Hex, refundCommitment: Hex, refundAmount: bigint): EscrowKey {
  return {
    nullifier,
    amountIn: BigInt(info.amountIn),
    outCommitment: info.out.commitment,
    assetOut: info.out.asset,
    amountOut: BigInt(info.out.amount),
    refundCommitment,
    refundAmount,
    routeHash: keccak256(encodeRoute(info.route)),
  };
}

const balanceOfAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

/**
 * Whether a swap's money waits at its escrow (someone sent the note's unshield
 * on its own, and no refund has finished yet): its balance covers the refund note.
 */
export async function escrowHolds(
  client: PublicClient,
  info: VaultSwapRefundInfo,
  nullifier: Hex,
  refundCommitment: Hex,
  refundAmount: bigint,
  blockNumber?: bigint
): Promise<boolean> {
  const escrow = escrowAddress(info.router, info.assetIn, refundEscrowKey(info, nullifier, refundCommitment, refundAmount));
  const held = await client.readContract({
    address: info.assetIn,
    abi: balanceOfAbi,
    functionName: "balanceOf",
    args: [escrow],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  });
  return held >= refundAmount;
}

const DEPOSIT_COMPONENTS = [
  { name: "proof", type: "bytes" },
  { name: "commitment", type: "bytes32" },
  { name: "asset", type: "address" },
  { name: "amount", type: "uint256" },
] as const;

export const vaultSwapAbi = [
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "s",
        type: "tuple",
        components: [
          { name: "proof", type: "bytes" },
          { name: "root", type: "bytes32" },
          { name: "nullifier", type: "bytes32" },
          { name: "asset", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
      { name: "d", type: "tuple", components: DEPOSIT_COMPONENTS },
      { name: "r", type: "tuple", components: DEPOSIT_COMPONENTS },
      { name: "route", type: "bytes" },
    ],
    outputs: [{ name: "amountIn", type: "uint256" }],
  },
  {
    type: "function",
    name: "escrowFor",
    stateMutability: "view",
    inputs: [
      { name: "assetIn", type: "address" },
      { name: "k", type: "tuple", components: ESCROW_KEY_COMPONENTS },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "error",
    name: "OverInput",
    inputs: [
      { name: "needed", type: "uint256" },
      { name: "available", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ShortOutput",
    inputs: [
      { name: "got", type: "uint256" },
      { name: "wanted", type: "uint256" },
    ],
  },
  { type: "error", name: "PoolNotAllowed", inputs: [{ name: "poolId", type: "bytes32" }] },
  ...SWAP_ERRORS,
] as const;

const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

/** The route bytes the router takes: abi.encode(PoolKey[]) on Robinhood Chain, nothing on Tempo. */
export function encodeRoute(route: readonly PoolKey[]): Hex {
  if (!route.length) return "0x";
  return encodeAbiParameters([{ type: "tuple[]", components: POOL_KEY_COMPONENTS }], [
    route.map((k) => ({ ...k })),
  ]);
}

/** A pool's v4 PoolId, keccak256(abi.encode(PoolKey)): what the routers' allowlists hold. */
export function poolId(k: PoolKey): Hex {
  return keccak256(encodeAbiParameters([{ type: "tuple", components: POOL_KEY_COMPONENTS }], [{ ...k }]));
}

const sameKey = (a: PoolKey, b: PoolKey) =>
  same(a.currency0, b.currency0) && same(a.currency1, b.currency1) && a.fee === b.fee && a.tickSpacing === b.tickSpacing && same(a.hooks, b.hooks);
const holds = (k: PoolKey, c: string) => same(k.currency0, c) || same(k.currency1, c);

/**
 * The currencies a route passes through, as the PoolManager sees them, worked
 * out exactly as the router does it (GloamVaultSwapV4b._walk), or null when the
 * router would refuse the route. A WETH note pays in ETH when its first pool
 * holds ETH and not WETH; a WETH note can be bought with a route that ends at
 * ETH. Each currency once, and WETH nowhere inside a route that unwraps or
 * wraps it. Every pool must be one of the router's (and pass `allowed`).
 */
export function routeCurrencies(
  r: SwapRouter,
  assetIn: Address,
  assetOut: Address,
  route: readonly PoolKey[],
  allowed?: (k: PoolKey) => boolean
): Address[] | null {
  const n = route.length;
  if (r.venue !== "v4" || n === 0 || n > r.maxHops) return null;
  if (same(assetIn, assetOut) || same(assetIn, NATIVE) || same(assetOut, NATIVE)) return null;
  const weth = r.weth;
  let cur: Address = assetIn;
  if (weth && same(assetIn, weth) && !holds(route[0]!, weth) && holds(route[0]!, NATIVE)) cur = NATIVE;
  const path: Address[] = [cur];
  for (const k of route) {
    if (!r.pools.some((p) => sameKey(p, k)) || (allowed && !allowed(k))) return null;
    if (same(k.currency0, cur)) cur = k.currency1;
    else if (same(k.currency1, cur)) cur = k.currency0;
    else return null;
    path.push(cur);
  }
  if (!same(cur, assetOut) && !(weth && same(assetOut, weth) && same(cur, NATIVE))) return null;
  const wraps = same(path[0]!, NATIVE) || same(path[n]!, NATIVE);
  for (let i = 0; i <= n; i++) {
    if (wraps && weth && same(path[i]!, weth)) return null;
    for (let j = i + 1; j <= n; j++) if (same(path[i]!, path[j]!)) return null;
  }
  return path;
}

/** Every route the router takes from `assetIn` to `assetOut`, fewest hops first. */
export function routesBetween(
  assetIn: Address,
  assetOut: Address,
  r: SwapRouter | null = swapRouterFor(4663),
  allowed?: (k: PoolKey) => boolean
): PoolKey[][] {
  if (!r || r.venue !== "v4") return [];
  const pools = allowed ? r.pools.filter(allowed) : r.pools;
  const out: PoolKey[][] = [];
  const extend = (route: PoolKey[]) => {
    if (route.length && routeCurrencies(r, assetIn, assetOut, route)) out.push(route);
    if (route.length >= r.maxHops) return;
    for (const k of pools) if (!route.includes(k)) extend([...route, k]);
  };
  extend([]);
  return out.sort((a, b) => a.length - b.length);
}

/** Whether `route` is one the router would take, for the relay to check before it pays gas. */
export function isKnownRoute(
  chainId: number,
  assetIn: Address,
  assetOut: Address,
  route: readonly PoolKey[],
  router?: string | null
): boolean {
  const r = swapRouterFor(chainId, router);
  if (!r) return false;
  if (r.venue === "tempo") return route.length === 0;
  return routeCurrencies(r, assetIn, assetOut, route) !== null;
}

const allowedPoolAbi = [
  { type: "function", name: "allowedPool", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;
const liveCache = new Map<string, { at: number; live: Set<Hex> }>();
const LIVE_TTL_MS = 60_000;

/**
 * Which of the router's pools it allows right now, read from the chain (one
 * multicall, kept a minute). v1's list is fixed, so all of them. A failed read
 * keeps every listed pool: the router itself still refuses one it doesn't allow.
 */
export async function livePools(client: PublicClient, r: SwapRouter): Promise<(k: PoolKey) => boolean> {
  if (r.version !== 2) return () => true;
  const key = r.address.toLowerCase();
  const hit = liveCache.get(key);
  const ids = r.pools.map(poolId);
  const isLive = (live: Set<Hex>) => {
    const ok = r.pools.filter((_, i) => live.has(ids[i]!));
    return (k: PoolKey) => ok.some((p) => sameKey(p, k));
  };
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return isLive(hit.live);
  const res = await client
    .multicall({
      multicallAddress: RH_MULTICALL3,
      allowFailure: false,
      contracts: ids.map((id) => ({ address: r.address, abi: allowedPoolAbi, functionName: "allowedPool", args: [id] }) as const),
    })
    .catch(() => null);
  if (!res) return () => true;
  const live = new Set(ids.filter((_, i) => res[i] === true));
  liveCache.set(key, { at: Date.now(), live });
  return isLive(live);
}

// ---------------------------------------------------------------- quotes

const PATH_KEY_COMPONENTS = [
  { name: "intermediateCurrency", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
  { name: "hookData", type: "bytes" },
] as const;

const QUOTE_EXACT_PARAMS = [
  {
    name: "params",
    type: "tuple",
    components: [
      { name: "exactCurrency", type: "address" },
      { name: "path", type: "tuple[]", components: PATH_KEY_COMPONENTS },
      { name: "exactAmount", type: "uint128" },
    ],
  },
] as const;

/** Uniswap's V4Quoter, multi-hop: the same pools in the same order the router swaps them. */
const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: QUOTE_EXACT_PARAMS,
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteExactOutput",
    stateMutability: "nonpayable",
    inputs: QUOTE_EXACT_PARAMS,
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const dexAbi = [
  {
    type: "function",
    name: "quoteSwapExactAmountIn",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint128" },
    ],
    outputs: [{ name: "amountOut", type: "uint128" }],
  },
  {
    type: "function",
    name: "quoteSwapExactAmountOut",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountOut", type: "uint128" },
    ],
    outputs: [{ name: "amountIn", type: "uint128" }],
  },
] as const;

/**
 * The quoter's params for a route. Exact input names the currency paid and,
 * per hop, the one it comes out in; exact output names the currency bought
 * and, per hop, the one it goes in with (V4Router's order).
 */
function quoteParams(route: readonly PoolKey[], path: readonly Address[], exactIn: boolean, amount: bigint) {
  const n = route.length;
  return {
    exactCurrency: exactIn ? path[0]! : path[n]!,
    path: route.map((k, i) => ({
      intermediateCurrency: exactIn ? path[i + 1]! : path[i]!,
      fee: k.fee,
      tickSpacing: k.tickSpacing,
      hooks: k.hooks,
      hookData: "0x" as Hex,
    })),
    exactAmount: amount,
  };
}

/** What `amountIn` buys along each route, all in one multicall. 0 where a route can't fill. */
async function v4ExactInAll(
  client: PublicClient,
  r: SwapRouter,
  routes: readonly PoolKey[][],
  assetIn: Address,
  assetOut: Address,
  amountIn: bigint
): Promise<bigint[]> {
  const res = await client.multicall({
    multicallAddress: RH_MULTICALL3,
    allowFailure: true,
    contracts: routes.map(
      (route) =>
        ({
          address: RH_V4_QUOTER,
          abi: quoterAbi,
          functionName: "quoteExactInput",
          args: [quoteParams(route, routeCurrencies(r, assetIn, assetOut, route)!, true, amountIn)],
        }) as const
    ),
  });
  return res.map((x) => (x.status === "success" ? x.result[0] : 0n));
}

/** What buying exactly `amountOut` costs along `route`, hop by hop from the last, as the router does it. */
async function v4ExactOut(
  client: PublicClient,
  r: SwapRouter,
  route: readonly PoolKey[],
  assetIn: Address,
  assetOut: Address,
  amountOut: bigint
): Promise<bigint> {
  const { result } = await client.simulateContract({
    address: RH_V4_QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactOutput",
    args: [quoteParams(route, routeCurrencies(r, assetIn, assetOut, route)!, false, amountOut)],
  });
  return result[0];
}

/**
 * The refund note a swap makes in advance, used only if someone sends the
 * note's unshield on its own (GloamVaultSwap): the amount less the vault's
 * highest possible cash-out fee (1%), so it is never more than arrives.
 */
export function refundAmountFor(amount: bigint): bigint {
  return amount - amount / 100n;
}

/** The vault's cash-out fee on `amount` (ShieldPoolCore._withdrawFee). */
export function vaultFeeOf(amount: bigint, feeBps: number): bigint {
  const bps = BigInt(feeBps);
  return (amount / 10_000n) * bps + ((amount % 10_000n) * bps) / 10_000n;
}

export type SwapPlan = {
  /** The router the plan is for: the route is checked against its pools. */
  router: Address;
  /** What arrives at the router: the note's value less the vault's cash-out fee. */
  available: bigint;
  /** What the new note will hold. */
  amountOut: bigint;
  /** What buying amountOut costs at the quote. Never above `available`. */
  cost: bigint;
  /** available - cost, at the quote: goes to the treasury. */
  leftover: bigint;
  route: PoolKey[];
};

/**
 * The best swap of a note worth `amountIn` of `assetIn` into `assetOut`: the
 * expected output at the best allowed route, less the buffer, checked by an
 * exact-output quote so it costs no more than what arrives.
 */
export type SwapAsk = {
  assetIn: Address;
  assetOut: Address;
  amountIn: bigint;
  feeBps: number;
  /** The router to plan for; the one new swaps use when left out. */
  router?: Address;
};

export async function planVaultSwap(client: PublicClient, chainId: number, p: SwapAsk): Promise<SwapPlan> {
  const r = swapRouterFor(chainId, p.router);
  if (!r) throw new Error("Private swaps are not live on this network yet.");
  if (!isSwapAsset(chainId, p.assetIn, r.address) || !isSwapAsset(chainId, p.assetOut, r.address)) {
    throw new Error("There is no swap between these two yet.");
  }
  const available = p.amountIn - vaultFeeOf(p.amountIn, p.feeBps);
  if (available <= 0n) throw new Error("That amount is too small to swap.");
  const buffer = BigInt(swapBufferBps(chainId));

  if (chainId === 4217) {
    const expected = await client.readContract({
      address: TEMPO_STABLE_DEX,
      abi: dexAbi,
      functionName: "quoteSwapExactAmountIn",
      args: [p.assetIn, p.assetOut, available],
    });
    const amountOut = (expected * (10_000n - buffer)) / 10_000n;
    if (amountOut <= 0n) throw new Error("That amount is too small to swap.");
    const cost = await client.readContract({
      address: TEMPO_STABLE_DEX,
      abi: dexAbi,
      functionName: "quoteSwapExactAmountOut",
      args: [p.assetIn, p.assetOut, amountOut],
    });
    if (cost > available) throw new Error("The price is moving too fast. Try again in a moment.");
    return { router: r.address, available, amountOut, cost, leftover: available - cost, route: [] };
  }

  const routes = routesBetween(p.assetIn, p.assetOut, r, await livePools(client, r));
  if (!routes.length) throw new Error("There is no swap between these two yet.");
  const outs = await v4ExactInAll(client, r, routes, p.assetIn, p.assetOut, available);
  let best = 0;
  for (let i = 1; i < routes.length; i++) if (outs[i]! > outs[best]!) best = i;
  if (!(outs[best]! > 0n)) throw new Error("No pool can fill this swap right now. Try a smaller amount.");
  const route = routes[best]!;
  const amountOut = (outs[best]! * (10_000n - buffer)) / 10_000n;
  if (amountOut <= 0n) throw new Error("That amount is too small to swap.");
  const cost = await v4ExactOut(client, r, route, p.assetIn, p.assetOut, amountOut);
  if (cost > available) throw new Error("The price is moving too fast. Try again in a moment.");
  return { router: r.address, available, amountOut, cost, leftover: available - cost, route };
}

/** How often a quote on screen is asked again. One older than two of these stops showing. */
export const QUOTE_TTL_MS = 15_000;

/** Whether a quote made at `at` may still show at `now`. */
export function quoteFresh(at: number, now: number): boolean {
  return now - at < 2 * QUOTE_TTL_MS;
}

/**
 * The plan to send: priced again right before the swap, and used only if it
 * gives more than the quote the person saw. The router buys exactly amountOut
 * and the rest goes to the treasury, so a price that moved their way since the
 * quote now goes to them. One that moved against them keeps what they agreed
 * to (the router refuses it if the buffer no longer covers it), and a failed
 * read keeps the quote.
 */
export async function replanVaultSwap(
  client: PublicClient,
  chainId: number,
  p: SwapAsk,
  quoted: SwapPlan
): Promise<SwapPlan> {
  const fresh = await planVaultSwap(client, chainId, { ...p, router: quoted.router }).catch(() => null);
  return fresh && fresh.amountOut > quoted.amountOut ? fresh : quoted;
}
