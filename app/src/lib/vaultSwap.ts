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
 * v2's pools: exactly the list DeployVaultSwapV4b.s.sol allows at deploy, in
 * the same order (contracts/test/fixtures/vault-swap-v2-pools.json pins both).
 * To add one, the router's owner queues it on chain (usable 3 days later) and
 * it is added here too. The app routes only through a pool that is on this list
 * and that the router allows right now (livePools), so one the owner removed is
 * skipped at once.
 *
 * Picked from live Robinhood Chain state on 2026-10-23 (price impact quoted at
 * $50 to $5,000): ETH and USDG as the hubs, then each token's deepest hookless
 * pool, and where a Fables pool is deeper or close, that one too as a second
 * route. Fables hooks are not upgradeable and only set the pool's fee (their
 * admin can change it or pause a pool); GLOAM's launch pool has the Orynth
 * hook, which takes the creator fee. Never a pool with the unverified hook
 * 0x958541c0…c880 (it quotes stale prices). Whatever a hook does, the router
 * pays at most what arrived and delivers the exact note, so a hook can cost a
 * swap its buffer at most, or make it fail.
 */
export const RH_SWAP_POOLS_V2: readonly PoolKey[] = [
  // ETH / USDG, 0.05%, hookless (0x387bf619…)
  { currency0: NATIVE, currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 500, tickSpacing: 10, hooks: NATIVE },
  // ETH / USDG, 0.01%, hookless (0x24107d15…)
  { currency0: NATIVE, currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 100, tickSpacing: 1, hooks: NATIVE },
  // WETH / USDG, 0.02%, hookless (0x84bd4e2d…)
  { currency0: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 200, tickSpacing: 4, hooks: NATIVE },
  // ETH / GLOAM, 0%, Orynth launch hook (0xc5f37371…)
  { currency0: NATIVE, currency1: "0xDcD885F5c60b3aD49F6D58718696417314e8724d", fee: 0, tickSpacing: 200, hooks: "0x953391a2DDf7E8437FeB878FDF2C6f325Fbf00CC" },
  // USDG / GLOAM, 4.215%, hookless (0xe5b1e488…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xDcD885F5c60b3aD49F6D58718696417314e8724d", fee: 42150, tickSpacing: 422, hooks: NATIVE },
  // USDG / GLOAM, 2.4%, hookless (0x9200eb96…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xDcD885F5c60b3aD49F6D58718696417314e8724d", fee: 24000, tickSpacing: 240, hooks: NATIVE },
  // USDe / USDG, 0.01%, hookless (0xa5f23cae…)
  { currency0: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 100, tickSpacing: 1, hooks: NATIVE },
  // USDG / U, 0.0075%, hookless (0xf399bd15…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xcE24439F2D9C6a2289F741120FE202248B666666", fee: 75, tickSpacing: 1, hooks: NATIVE },
  // USDG / cbBTC, 0.15%, hookless (0x94c62eeb…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4", fee: 1500, tickSpacing: 15, hooks: NATIVE },
  // PONS / USDG, 0.3%, hookless (0x4be9657e…)
  { currency0: "0x39dBED3a2bd333467115dE45665cC57F813C4571", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 3000, tickSpacing: 60, hooks: NATIVE },
  // CASHCAT / USDG, 0.269%, hookless (0xa92a3df2…)
  { currency0: "0x020bfC650A365f8BB26819deAAbF3E21291018b4", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 2690, tickSpacing: 54, hooks: NATIVE },
  // CASHCAT / USDG, dynamic fee, Fables fee hook (0x31608601…)
  { currency0: "0x020bfC650A365f8BB26819deAAbF3E21291018b4", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 8388608, tickSpacing: 60, hooks: "0x08E52564Bad99E05a694b4809F397edcA417A080" },
  // USDG / VIRTUAL, 0.3%, hookless (0xa9573206…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31", fee: 3000, tickSpacing: 60, hooks: NATIVE },
  // SPY / USDG, 0.01%, hookless (0xe1ae6a4c…)
  { currency0: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 100, tickSpacing: 1, hooks: NATIVE },
  // USDG / NVDA, 0.01%, hookless (0x6444a8e0…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", fee: 100, tickSpacing: 1, hooks: NATIVE },
  // TSLA / USDG, 0.3%, hookless (0x8517f807…)
  { currency0: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 3000, tickSpacing: 60, hooks: NATIVE },
  // TSLA / USDG, dynamic fee, Fables fee hook (0xd5effce8…)
  { currency0: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 8388608, tickSpacing: 10, hooks: "0x67D86050d22D574Df046F3D90F722045F714e080" },
  // AMZN / USDG, 0.24%, hookless (0xefc94885…)
  { currency0: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 2400, tickSpacing: 24, hooks: NATIVE },
  // AMZN / USDG, dynamic fee, Fables fee hook (0x5619cb84…)
  { currency0: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 8388608, tickSpacing: 60, hooks: "0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080" },
  // ETH / SPCX, 0.3%, hookless (0x541942af…)
  { currency0: NATIVE, currency1: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", fee: 3000, tickSpacing: 30, hooks: NATIVE },
  // SPCX / USDG, dynamic fee, Fables fee hook (0xb81d873d…)
  { currency0: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 8388608, tickSpacing: 10, hooks: "0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080" },
  // ETH / CRCL, 0.15%, hookless (0x6d9af55c…)
  { currency0: NATIVE, currency1: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", fee: 1500, tickSpacing: 15, hooks: NATIVE },
  // USDG / CRCL, dynamic fee, Fables fee hook (0xdb9c3400…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", fee: 8388608, tickSpacing: 60, hooks: "0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080" },
  // USDG / META, 0.3%, hookless (0x5875d407…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", fee: 3000, tickSpacing: 60, hooks: NATIVE },
  // USDG / MSTR, 0.24%, hookless (0xc105b830…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xec262a75e413fAfD0dF80480274532C79D42da09", fee: 2400, tickSpacing: 24, hooks: NATIVE },
  // GOOGL / USDG, 0.3%, hookless (0xd4ecb79f…)
  { currency0: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 3000, tickSpacing: 60, hooks: NATIVE },
  // USDG / AAPL, 0.3%, hookless (0xc748f467…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", fee: 3000, tickSpacing: 60, hooks: NATIVE },
  // USDG / AAPL, dynamic fee, Fables fee hook (0xa2347ba6…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", fee: 8388608, tickSpacing: 10, hooks: "0x70a9A88402989226847Ec122043CE5e7FF462080" },
  // USDG / MSFT, 0.3%, hookless (0x9194a557…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", fee: 3000, tickSpacing: 60, hooks: NATIVE },
  // USDG / PLTR, 0.15%, hookless (0xc59eaeda…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", fee: 1500, tickSpacing: 15, hooks: NATIVE },
  // USDG / AMD, 1%, hookless (0xde9f85fd…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", fee: 10000, tickSpacing: 200, hooks: NATIVE },
  // USDG / COIN, 0.25%, hookless (0xe2e1a0e3…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", fee: 2500, tickSpacing: 25, hooks: NATIVE },
  // AMC / USDG, 0.05%, hookless (0x06b97324…)
  { currency0: "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 500, tickSpacing: 5, hooks: NATIVE },
  // USDG / HIMS, 0.9%, hookless (0x68d4f28f…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xCceE82fE024c36fA15E1005edE3E9e4787e23D09", fee: 9000, tickSpacing: 90, hooks: NATIVE },
  // USDG / HIMS, dynamic fee, Fables fee hook (0x16dce5f6…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xCceE82fE024c36fA15E1005edE3E9e4787e23D09", fee: 8388608, tickSpacing: 60, hooks: "0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080" },
  // USDG / INTC, 1%, hookless (0xf2e329e6…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", fee: 10000, tickSpacing: 200, hooks: NATIVE },
  // USDG / INTC, dynamic fee, Fables fee hook (0x5e4c3534…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", fee: 8388608, tickSpacing: 60, hooks: "0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080" },
  // TSM / USDG, 0.75%, hookless (0x0ba5d53d…)
  { currency0: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fee: 7500, tickSpacing: 75, hooks: NATIVE },
  // USDG / GLD, 0.21%, hookless (0xd85389e6…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e", fee: 2100, tickSpacing: 21, hooks: NATIVE },
  // USDG / GLD, dynamic fee, Fables fee hook (0xfe281bbf…)
  { currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", currency1: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e", fee: 8388608, tickSpacing: 10, hooks: "0xB608a78761f179f7C56f15E7D13921B92F00a080" },
  // ETH / MU, 0.8%, hookless (0x881b4219…)
  { currency0: NATIVE, currency1: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", fee: 8000, tickSpacing: 80, hooks: NATIVE },
];

/** What v1 swaps between. */
const RH_SWAP_ASSETS_V1: readonly Address[] = [RH_USDG, RH_GLOAM];
/**
 * What v2 swaps between, in the order the picker lists them: the dollar, $GLOAM,
 * ETH (as WETH), two more dollars, crypto, then Robinhood's stock tokens. Each
 * one's metadata is in lib/tokens RH_MAINNET_SWAP_TOKENS. To offer another
 * token: add it here and there, its pools to RH_SWAP_POOLS_V2 (queued on the
 * router first), and have the vault take it (a deposit limit, queued on the
 * vault). Left out on purpose: HOOD (a third-party vault share), QQQ (6 to 17%
 * price impact at $5,000 on v4), tokens with a transfer tax or one-sided
 * liquidity, and tokens that trade only on Uniswap v3.
 */
export const RH_SWAP_ASSETS_V2: readonly Address[] = [
  RH_USDG,
  RH_GLOAM,
  RH_WETH,
  "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", // USDe
  "0xcE24439F2D9C6a2289F741120FE202248B666666", // U
  "0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4", // cbBTC
  "0x39dBED3a2bd333467115dE45665cC57F813C4571", // PONS
  "0x020bfC650A365f8BB26819deAAbF3E21291018b4", // CASHCAT
  "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31", // VIRTUAL
  "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", // SPY
  "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", // NVDA
  "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", // TSLA
  "0x12f190a9F9d7D37a250758b26824B97CE941bF54", // AMZN
  "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", // SPCX
  "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", // CRCL
  "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", // META
  "0xec262a75e413fAfD0dF80480274532C79D42da09", // MSTR
  "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", // GOOGL
  "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", // AAPL
  "0xe93237C50D904957Cf27E7B1133b510C669c2e74", // MSFT
  "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", // PLTR
  "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", // AMD
  "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", // COIN
  "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B", // AMC
  "0xCceE82fE024c36fA15E1005edE3E9e4787e23D09", // HIMS
  "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", // INTC
  "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", // TSM
  "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e", // GLD
  "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", // MU
];

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

/**
 * Every route the router takes from `assetIn` to `assetOut`, fewest hops
 * first: a walk over the pools that join, each route checked by
 * routeCurrencies, the router's own rules.
 */
export function routesBetween(
  assetIn: Address,
  assetOut: Address,
  r: SwapRouter | null = swapRouterFor(4663),
  allowed?: (k: PoolKey) => boolean
): PoolKey[][] {
  if (!r || r.venue !== "v4") return [];
  const pools = allowed ? r.pools.filter(allowed) : r.pools;
  const weth = r.weth;
  const out: PoolKey[][] = [];
  const extend = (route: PoolKey[], cur: Address) => {
    for (const k of pools) {
      if (route.includes(k)) continue;
      // a WETH note pays its first pool in ETH when that pool holds ETH and not WETH
      const from = !route.length && weth && same(assetIn, weth) && !holds(k, weth) && holds(k, NATIVE) ? NATIVE : cur;
      if (!holds(k, from)) continue;
      const next = same(k.currency0, from) ? k.currency1 : k.currency0;
      const at = [...route, k];
      if (routeCurrencies(r, assetIn, assetOut, at)) out.push(at);
      // past the output a route could only come back to it
      if (at.length < r.maxHops && !same(next, assetOut)) extend(at, next);
    }
  };
  extend([], assetIn);
  return out.sort((a, b) => a.length - b.length);
}

/** The most routes one quote asks about, fewest hops first: one multicall, kept small. */
export const MAX_QUOTED_ROUTES = 24;

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

/** What each route's amount buys along it, all in one multicall. 0 where a route can't fill. */
async function v4ExactInAll(
  client: PublicClient,
  r: SwapRouter,
  routes: readonly PoolKey[][],
  assetIn: Address,
  assetOut: Address,
  amountIn: readonly bigint[]
): Promise<bigint[]> {
  const res = await client.multicall({
    multicallAddress: RH_MULTICALL3,
    allowFailure: true,
    contracts: routes.map(
      (route, i) =>
        ({
          address: RH_V4_QUOTER,
          abi: quoterAbi,
          functionName: "quoteExactInput",
          args: [quoteParams(route, routeCurrencies(r, assetIn, assetOut, route)!, true, amountIn[i]!)],
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

/** One asset's beta deposit limits in the vault, and what it holds of it now. */
export type VaultRoom = { perDeposit: bigint; total: bigint; deposited: bigint };

/** The most one deposit of the asset can bring in right now: 0 when the vault doesn't take it or is full. */
export function depositRoom(v: VaultRoom): bigint {
  const left = v.total > v.deposited ? v.total - v.deposited : 0n;
  return v.perDeposit < left ? v.perDeposit : left;
}

/**
 * Whether a swap spending `amount` of a note could always land its refund note
 * (refundAmountFor) back in the vault: within the input asset's per-deposit
 * limit, and within its total once the note itself has left. A refund that
 * doesn't fit waits at the escrow until the limit is raised, so the app never
 * makes one: a larger note is split first.
 */
export function refundFits(v: VaultRoom, amount: bigint): boolean {
  const back = refundAmountFor(amount);
  return back <= v.perDeposit && v.deposited - amount + back <= v.total;
}

/** The most of one note a single swap may spend so its refund note fits (refundFits). */
export function maxSwapInForRefund(v: VaultRoom): bigint {
  let a = (v.perDeposit * 100n) / 99n + 1n;
  while (a > 0n && refundAmountFor(a) > v.perDeposit) a--;
  return a;
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
  /**
   * How much worse this size trades than a hundredth of it on the same route,
   * in basis points (pool fees cancel out): the price impact. null when unknown.
   */
  impactBps?: number | null;
};

/** Above this price impact the swap tab warns that a smaller amount gets a better rate. */
export const IMPACT_WARN_BPS = 100;

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

  const routes = routesBetween(p.assetIn, p.assetOut, r, await livePools(client, r)).slice(0, MAX_QUOTED_ROUTES);
  if (!routes.length) throw new Error("There is no swap between these two yet.");
  // every route at the full size and at a hundredth of it, in one multicall
  const probe = available / 100n;
  const outs = await v4ExactInAll(client, r, [...routes, ...(probe > 0n ? routes : [])], p.assetIn, p.assetOut, [
    ...routes.map(() => available),
    ...(probe > 0n ? routes.map(() => probe) : []),
  ]);
  let best = 0;
  for (let i = 1; i < routes.length; i++) if (outs[i]! > outs[best]!) best = i;
  if (!(outs[best]! > 0n)) throw new Error("No pool can fill this swap right now. Try a smaller amount.");
  const route = routes[best]!;
  const amountOut = (outs[best]! * (10_000n - buffer)) / 10_000n;
  if (amountOut <= 0n) throw new Error("That amount is too small to swap.");
  const small = probe > 0n ? outs[routes.length + best]! : 0n;
  const impactBps = small > 0n ? priceImpactBps(available, outs[best]!, probe, small) : null;
  const cost = await v4ExactOut(client, r, route, p.assetIn, p.assetOut, amountOut);
  if (cost > available) throw new Error("The price is moving too fast. Try again in a moment.");
  return { router: r.address, available, amountOut, cost, leftover: available - cost, route, impactBps };
}

/** 1 - (out / in) / (smallOut / smallIn), in basis points, never below 0. */
export function priceImpactBps(amountIn: bigint, out: bigint, smallIn: bigint, smallOut: bigint): number {
  if (amountIn <= 0n || smallIn <= 0n || smallOut <= 0n) return 0;
  const bps = 10_000n - (out * smallIn * 10_000n) / (smallOut * amountIn);
  return bps > 0n ? Number(bps) : 0;
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
