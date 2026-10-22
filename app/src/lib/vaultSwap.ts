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
 * Off until a router is deployed: VAULT_SWAP_ROUTERS is empty, so the Swap tab
 * never shows and the relay refuses swaps. Fill in each address after Duke
 * deploys (contracts/script/DeployVaultSwap*.s.sol).
 *
 * Shared by the app and the relay server: no browser-only imports here.
 */
import { encodeAbiParameters, type Address, type Hex, type PublicClient } from "viem";

/** The router per chain. null: swaps are off there. */
export const VAULT_SWAP_ROUTERS: Record<number, Address | null> = {
  4663: null,
  4217: null,
};

export function vaultSwapRouter(chainId: number): Address | null {
  return VAULT_SWAP_ROUTERS[chainId] ?? null;
}

// ---------------------------------------------------------------- Robinhood Chain (Uniswap v4)

export const RH_POOL_MANAGER: Address = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
export const RH_V4_QUOTER: Address = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94";

const RH_USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const RH_GLOAM: Address = "0xDcD885F5c60b3aD49F6D58718696417314e8724d";
const NATIVE: Address = "0x0000000000000000000000000000000000000000";

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

/**
 * The pools the Robinhood Chain router allows, the same list its deploy script
 * passes (DeployVaultSwapRobinhood.s.sol). Any other pool is refused on chain.
 */
export const RH_SWAP_POOLS: readonly PoolKey[] = [
  // ETH / USDG, fee 0.0087%, the deepest hookless one
  { currency0: NATIVE, currency1: RH_USDG, fee: 87, tickSpacing: 1, hooks: NATIVE },
  // ETH / GLOAM, the launch pool (Orynth hook, which takes the creator fee)
  { currency0: NATIVE, currency1: RH_GLOAM, fee: 0, tickSpacing: 200, hooks: "0x953391a2DDf7E8437FeB878FDF2C6f325Fbf00CC" },
  // USDG / GLOAM direct, fee 4.215%: dear, only used when it is the better price
  { currency0: RH_USDG, currency1: RH_GLOAM, fee: 42150, tickSpacing: 422, hooks: NATIVE },
];

// ---------------------------------------------------------------- Tempo (Stablecoin DEX)

export const TEMPO_STABLE_DEX: Address = "0xdec0000000000000000000000000000000000000";

/** The assets a swap can go between, per chain (the vault's own list). */
export const VAULT_SWAP_ASSETS: Record<number, readonly Address[]> = {
  4663: [RH_USDG, RH_GLOAM],
  4217: [
    "0x20c000000000000000000000b9537d11c60e8b50", // USDC.e
    "0x20c0000000000000000000000000000000000000", // pathUSD
    "0x20c00000000000000000000014f22ca97301eb73", // USDT0
    "0x20c0000000000000000000006a37da5c996874be", // OUSD
  ],
};

export function isSwapAsset(chainId: number, asset: string): boolean {
  return (VAULT_SWAP_ASSETS[chainId] ?? []).some((a) => a.toLowerCase() === asset.toLowerCase());
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
  "BadRoute", "NotPoolManager", "MiddleNotSettled", "BadRefund", "EscrowUsed",
].map((name) => ({ type: "error" as const, name, inputs: [] }));

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
      { name: "outCommitment", type: "bytes32" },
      { name: "assetOut", type: "address" },
      { name: "amountOut", type: "uint256" },
      { name: "refundCommitment", type: "bytes32" },
      { name: "refundAmount", type: "uint256" },
      { name: "routeHash", type: "bytes32" },
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

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Every allowed route from `assetIn` to `assetOut`: one pool, or two through a shared currency. */
export function routesBetween(assetIn: Address, assetOut: Address): PoolKey[][] {
  const joins = (k: PoolKey, a: string) => same(k.currency0, a) || same(k.currency1, a);
  const other = (k: PoolKey, a: string) => (same(k.currency0, a) ? k.currency1 : k.currency0);
  const out: PoolKey[][] = [];
  for (const k of RH_SWAP_POOLS) {
    if (joins(k, assetIn) && same(other(k, assetIn), assetOut)) out.push([k]);
  }
  for (const a of RH_SWAP_POOLS) {
    if (!joins(a, assetIn)) continue;
    const mid = other(a, assetIn);
    if (same(mid, assetOut)) continue;
    for (const b of RH_SWAP_POOLS) {
      if (b === a || !joins(b, mid) || !same(other(b, mid), assetOut)) continue;
      out.push([a, b]);
    }
  }
  return out;
}

/** Whether `route` is one the app would build, for the relay to check before it pays gas. */
export function isKnownRoute(chainId: number, assetIn: Address, assetOut: Address, route: readonly PoolKey[]): boolean {
  if (chainId === 4217) return route.length === 0;
  const key = (k: PoolKey) => `${k.currency0}|${k.currency1}|${k.fee}|${k.tickSpacing}|${k.hooks}`.toLowerCase();
  const want = route.map(key).join(">");
  return routesBetween(assetIn, assetOut).some((r) => r.map(key).join(">") === want);
}

// ---------------------------------------------------------------- quotes

const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteExactOutputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
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

function directions(route: readonly PoolKey[], assetIn: Address): boolean[] {
  let cur: string = assetIn;
  return route.map((k) => {
    const z = same(k.currency0, cur);
    cur = z ? k.currency1 : k.currency0;
    return z;
  });
}

async function v4ExactIn(client: PublicClient, route: readonly PoolKey[], assetIn: Address, amountIn: bigint): Promise<bigint> {
  const dirs = directions(route, assetIn);
  let amount = amountIn;
  for (let i = 0; i < route.length; i++) {
    const { result } = await client.simulateContract({
      address: RH_V4_QUOTER,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: route[i]!, zeroForOne: dirs[i]!, exactAmount: amount, hookData: "0x" }],
    });
    amount = result[0];
  }
  return amount;
}

/** What buying exactly `amountOut` costs along `route`, hop by hop from the last, as the router does it. */
async function v4ExactOut(client: PublicClient, route: readonly PoolKey[], assetIn: Address, amountOut: bigint): Promise<bigint> {
  const dirs = directions(route, assetIn);
  let amount = amountOut;
  for (let i = route.length - 1; i >= 0; i--) {
    const { result } = await client.simulateContract({
      address: RH_V4_QUOTER,
      abi: quoterAbi,
      functionName: "quoteExactOutputSingle",
      args: [{ poolKey: route[i]!, zeroForOne: dirs[i]!, exactAmount: amount, hookData: "0x" }],
    });
    amount = result[0];
  }
  return amount;
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
export async function planVaultSwap(
  client: PublicClient,
  chainId: number,
  p: { assetIn: Address; assetOut: Address; amountIn: bigint; feeBps: number }
): Promise<SwapPlan> {
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
    return { available, amountOut, cost, leftover: available - cost, route: [] };
  }

  const routes = routesBetween(p.assetIn, p.assetOut);
  if (!routes.length) throw new Error("There is no swap between these two yet.");
  const quoted = await Promise.all(
    routes.map(async (route) => ({ route, out: await v4ExactIn(client, route, p.assetIn, available).catch(() => 0n) }))
  );
  const best = quoted.reduce((a, b) => (b.out > a.out ? b : a));
  if (best.out <= 0n) throw new Error("No pool can fill this swap right now. Try a smaller amount.");
  const amountOut = (best.out * (10_000n - buffer)) / 10_000n;
  const cost = await v4ExactOut(client, best.route, p.assetIn, amountOut);
  if (cost > available) throw new Error("The price is moving too fast. Try again in a moment.");
  return { available, amountOut, cost, leftover: available - cost, route: best.route };
}
