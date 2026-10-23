/**
 * Self-test: private swaps through the vault (lib/vaultSwap, the relay's swap call).
 *
 *  - routes: only the router's allowlisted pools, one hop or two through a shared currency
 *  - the route bytes decode as the router's PoolKey[] and the pool ids are the live ones
 *  - the cash-out fee matches the vault's math
 *  - a quote stops showing once it is old, and the swap sends a fresher price only when it gives more
 *  - the relay refuses a swap while no router is set, and a bad asset or route before any read
 *  - with --live: a real quote on Robinhood Chain and Tempo mainnet (read-only)
 *
 * Run: npx tsx scripts/selftest-vault-swap.mts [--live]
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, decodeAbiParameters, encodeAbiParameters, http, keccak256, type Address } from "viem";
import {
  QUOTE_TTL_MS,
  RH_SWAP_POOLS,
  SWAP_ESCROW_CODE_HASH,
  SWAP_ESCROW_INIT_CODE,
  VAULT_SWAP_ROUTERS,
  encodeRoute,
  escrowAddress,
  refundEscrowKey,
  isKnownRoute,
  planVaultSwap,
  quoteFresh,
  refundAmountFor,
  replanVaultSwap,
  routesBetween,
  vaultFeeOf,
  vaultSwapRouter,
} from "../src/lib/vaultSwap";
import { getNetwork } from "../src/lib/networks";
import { RelayError, relayVaultSwap } from "../src/lib/relay/server";

let n = 0;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const GLOAM = "0xDcD885F5c60b3aD49F6D58718696417314e8724d" as Address;
const keyType = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

// The routers deployed on 2026-10-23, and nothing on the testnets.
assert.equal(vaultSwapRouter(4663), "0x34AB06208586A737Bf1607fa996Bc9162271c52d");
assert.equal(vaultSwapRouter(4217), "0xfCa1887e77f738ef9C5751974b3f3873d029F2DC");
assert.equal(vaultSwapRouter(46630), null);
n += 3;

// The pool ids are the live ones the simulation used.
const ids = RH_SWAP_POOLS.map((k) => keccak256(encodeAbiParameters([{ type: "tuple", components: keyType }], [k])).slice(0, 10));
assert.deepEqual(ids, ["0x3b0cbf06", "0xc5f37371", "0xe5b1e488"]);
n++;

// Routes both ways: direct, and through ETH.
const there = routesBetween(USDG, GLOAM);
assert.equal(there.length, 2);
assert.equal(there[0]!.length, 1, "the direct pool");
assert.equal(there[1]!.length, 2, "through ETH");
assert.equal(routesBetween(GLOAM, USDG).length, 2);
assert.equal(routesBetween(USDG, USDG).length, 0);
n += 5;
assert.ok(isKnownRoute(4663, USDG, GLOAM, there[1]!));
assert.ok(!isKnownRoute(4663, USDG, GLOAM, [...there[1]!].reverse()), "hops in the wrong order");
assert.ok(!isKnownRoute(4663, USDG, GLOAM, [{ ...there[0]![0]!, hooks: "0x000000000000000000000000000000000000dEaD" }]));
assert.ok(isKnownRoute(4217, USDG, GLOAM, []), "Tempo takes no route");
assert.ok(!isKnownRoute(4217, USDG, GLOAM, there[0]!));
n += 5;

// The escrow code the app works addresses out from is the pinned one, and (when
// the contracts are built) exactly what the compiler made of SwapEscrow.sol.
assert.equal(keccak256(SWAP_ESCROW_INIT_CODE), SWAP_ESCROW_CODE_HASH);
n++;
const artifact = new URL("../../contracts/out/SwapEscrow.sol/SwapEscrow.json", import.meta.url);
if (existsSync(artifact)) {
  const built = JSON.parse(readFileSync(artifact, "utf8")).bytecode.object as string;
  assert.equal(built.toLowerCase(), SWAP_ESCROW_INIT_CODE.toLowerCase(), "SwapEscrow was changed: update SWAP_ESCROW_INIT_CODE");
  n++;
}
// Every part of the key moves the address; the refund note's key is what the swap used.
{
  const router = "0x00000000000000000000000000000000000beef1" as Address;
  const key = {
    nullifier: `0x${"01".repeat(32)}`,
    amountIn: 20_000_000n,
    outCommitment: `0x${"02".repeat(32)}`,
    assetOut: GLOAM,
    amountOut: 7n * 10n ** 18n,
    refundCommitment: `0x${"03".repeat(32)}`,
    refundAmount: refundAmountFor(20_000_000n),
    routeHash: keccak256(encodeRoute(there[1]!)),
  } as const;
  const base = escrowAddress(router, USDG, key);
  for (const change of [
    { nullifier: `0x${"09".repeat(32)}` },
    { amountIn: 20_000_001n },
    { amountOut: 1n },
    { refundCommitment: `0x${"09".repeat(32)}` },
    { routeHash: keccak256(encodeRoute(there[0]!)) },
  ]) {
    assert.notEqual(escrowAddress(router, USDG, { ...key, ...change } as typeof key), base);
  }
  assert.notEqual(escrowAddress(router, GLOAM, key), base, "another input asset");
  assert.notEqual(escrowAddress("0x00000000000000000000000000000000000beef2", USDG, key), base, "another router");
  const info = {
    router,
    assetIn: USDG,
    amountIn: "20000000",
    out: { commitment: key.outCommitment, asset: GLOAM, amount: key.amountOut.toString() },
    route: there[1]!,
  };
  assert.deepEqual(refundEscrowKey(info, key.nullifier, key.refundCommitment, key.refundAmount), key);
  n += 8;
}

// Route bytes decode as PoolKey[].
const bytes = encodeRoute(there[1]!);
const [decoded] = decodeAbiParameters([{ type: "tuple[]", components: keyType }], bytes);
assert.equal(decoded.length, 2);
assert.equal(decoded[1]!.hooks.toLowerCase(), "0x953391a2ddf7e8437feb878fdf2c6f325fbf00cc");
assert.equal(encodeRoute([]), "0x");
n += 3;

// The vault's fee: floor(amount * bps / 10000), split so it cannot overflow.
assert.equal(vaultFeeOf(20_000_000n, 25), 50_000n);
assert.equal(vaultFeeOf(19_999n, 25), 49n);
assert.equal(vaultFeeOf(10n ** 18n, 0), 0n);
n += 3;
// The refund note is never more than arrives, at any fee the vault allows (up to 1%).
for (const amt of [1n, 99n, 100n, 19_999n, 20_000_000n, 10n ** 18n + 7n]) {
  for (const bps of [0, 25, 100]) assert.ok(refundAmountFor(amt) <= amt - vaultFeeOf(amt, bps), `${amt} at ${bps}`);
}
n++;

// Quote age: refreshed every 15 seconds, gone once two refreshes are missed.
assert.equal(QUOTE_TTL_MS, 15_000);
assert.ok(quoteFresh(1_000, 1_000));
assert.ok(quoteFresh(1_000, 1_000 + 2 * QUOTE_TTL_MS - 1));
assert.ok(!quoteFresh(1_000, 1_000 + 2 * QUOTE_TTL_MS), "two refreshes missed");
assert.ok(!quoteFresh(1_000, 1_000 + 10 * 60_000), "a quote from ten minutes ago");
n += 4;

// Right before a swap goes, the price is read again (a fake Tempo exchange here).
// The better of that and the quote is sent: a move in the person's favour goes to
// them, not the treasury; a move against them or a failed read keeps the quote.
{
  const pathUSD = "0x20c0000000000000000000000000000000000000" as Address;
  const usdce = "0x20c000000000000000000000b9537d11c60e8b50" as Address;
  const dex = (rate: number | "down") =>
    ({
      readContract: async ({ functionName, args }: { functionName: string; args: readonly bigint[] }) => {
        if (rate === "down") throw new Error("rpc down");
        const amount = args[2]!;
        const scaled = (a: bigint, r: number) => (a * BigInt(Math.round(r * 1e6))) / 1_000_000n;
        if (functionName === "quoteSwapExactAmountIn") return scaled(amount, rate);
        if (functionName === "quoteSwapExactAmountOut") return scaled(amount, 1 / rate) + 1n;
        throw new Error(functionName);
      },
    }) as never;
  const p = { assetIn: pathUSD, assetOut: usdce, amountIn: 10_000_000n, feeBps: 25 };
  const quoted = await planVaultSwap(dex(1), 4217, p);
  assert.equal(quoted.available, 9_975_000n);
  assert.ok(quoted.cost <= quoted.available && quoted.leftover > 0n);
  const better = await replanVaultSwap(dex(1.01), 4217, p, quoted);
  assert.ok(better.amountOut > quoted.amountOut, "a better price since the quote reaches the person");
  assert.ok(better.cost <= better.available);
  assert.equal(await replanVaultSwap(dex(0.995), 4217, p, quoted), quoted, "a worse price keeps what they agreed to");
  assert.equal(await replanVaultSwap(dex(1), 4217, p, quoted).then((x) => x.amountOut), quoted.amountOut);
  assert.equal(await replanVaultSwap(dex("down"), 4217, p, quoted), quoted, "a failed read keeps the quote");
  n += 7;
}

// The relay: refused while off, then refused on bad input before it reads anything.
const net = getNetwork("robinhood-mainnet");
const good = {
  spend: { proof: `0x${"11".repeat(256)}`, root: `0x${"22".repeat(32)}`, nullifier: `0x${"33".repeat(32)}`, asset: USDG, amount: "20000000" },
  deposit: { proof: `0x${"44".repeat(256)}`, commitment: `0x${"55".repeat(32)}`, asset: GLOAM, amount: "7000000000000000000" },
  refund: { proof: `0x${"66".repeat(256)}`, commitment: `0x${"77".repeat(32)}`, asset: USDG, amount: refundAmountFor(20_000_000n).toString() },
  route: there[1]!,
};
async function refused(body: Record<string, unknown>, code: string) {
  await assert.rejects(relayVaultSwap(net, body), (e: unknown) => e instanceof RelayError && e.code === code);
  n++;
}
const deployed = VAULT_SWAP_ROUTERS[4663];
VAULT_SWAP_ROUTERS[4663] = null;
await refused(good, "no_swap");
VAULT_SWAP_ROUTERS[4663] = "0x000000000000000000000000000000000000beef";
await refused({ ...good, deposit: { ...good.deposit, asset: "0x20c0000000000000000000000000000000000000" } }, "swap_asset");
await refused({ ...good, deposit: { ...good.deposit, asset: USDG } }, "bad_request");
await refused({ ...good, route: [...there[1]!].reverse() }, "BadRoute");
await refused({ ...good, route: [{ ...there[0]![0]!, fee: 3000 }] }, "BadRoute");
await refused({ ...good, route: [there[0]![0], there[0]![0], there[0]![0]] }, "bad_request");
await refused({ ...good, spend: { ...good.spend, proof: "0x12" } }, "bad_request");
await refused({ ...good, refund: { ...good.refund, asset: GLOAM } }, "bad_request");
await refused({ ...good, refund: { ...good.refund, amount: "20000001" } }, "bad_request");
await refused({ ...good, refund: undefined }, "bad_request");
VAULT_SWAP_ROUTERS[4663] = deployed;

if (process.argv.includes("--live")) {
  const rh = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
  const p = await planVaultSwap(rh as never, 4663, { assetIn: USDG, assetOut: GLOAM, amountIn: 20_000_000n, feeBps: 25 });
  assert.ok(p.cost <= p.available && p.amountOut > 0n);
  console.log(`live RH: 20 USDG -> ${Number(p.amountOut) / 1e18} GLOAM via ${p.route.length} hop(s), leftover ${Number(p.leftover) / 1e6} USDG`);
  const back = await planVaultSwap(rh as never, 4663, { assetIn: GLOAM, assetOut: USDG, amountIn: 10n ** 18n, feeBps: 25 });
  console.log(`live RH: 1 GLOAM -> ${Number(back.amountOut) / 1e6} USDG via ${back.route.length} hop(s)`);
  const tempo = createPublicClient({ transport: http("https://rpc.tempo.xyz") });
  const t = await planVaultSwap(tempo as never, 4217, {
    assetIn: "0x20c0000000000000000000000000000000000000",
    assetOut: "0x20c000000000000000000000b9537d11c60e8b50",
    amountIn: 10_000_000n,
    feeBps: 25,
  });
  assert.ok(t.cost <= t.available);
  console.log(`live Tempo: 10 pathUSD -> ${Number(t.amountOut) / 1e6} USDC.e, leftover ${Number(t.leftover) / 1e6}`);
  n += 3;
}

console.log(`vault swap: ${n} passed`);
