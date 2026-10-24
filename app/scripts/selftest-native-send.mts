/** Run from app/: ../mcp/node_modules/.bin/tsx scripts/selftest-native-send.mts */
import assert from "node:assert/strict";
import { formatEther, parseEther, type Address } from "viem";
import { maxNativeSend } from "../src/lib/nativeSend";

const address: Address = "0x0000000000000000000000000000000000000001";
type Client = Parameters<typeof maxNativeSend>[0];
const makeClient = (balance: bigint, gas = 21_000n) => ({
  getBalance: async () => balance,
  estimateFeesPerGas: async () => ({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1n }),
  estimateGas: async () => gas,
}) as unknown as Client;

for (const text of ["1.23456789", "0.00009", "1000000", "1000000000000.123456789012345678"]) {
  const balance = parseEther(text);
  const max = await maxNativeSend(makeClient(balance), address, address);
  assert.equal(max, balance - 25_200n * 1_000_000_000n);
  assert.equal(parseEther(formatEther(max)), max, "form text round-trips every raw unit");
  assert.match(formatEther(max), /^\d+(\.\d+)?$/, "no locale punctuation or compact suffixes");
}
await assert.rejects(maxNativeSend(makeClient(1n), address, address), /network fee/);
const changing = makeClient(parseEther("1"));
let calls = 0;
changing.estimateGas = async () => ++calls === 1 ? 21_000n : 50_000n;
assert.equal(await maxNativeSend(changing, address, address), parseEther("1") - 60_000n * 1_000_000_000n);
assert.equal(calls, 3, "recheck the candidate after a gas increase");
const legacy = makeClient(parseEther("1"));
legacy.estimateFeesPerGas = (async (args: { type?: string } = {}) => {
  if (args.type !== "legacy") throw new Error("EIP-1559 unavailable");
  return { gasPrice: 2_000_000_000n };
}) as Client["estimateFeesPerGas"];
assert.equal(await maxNativeSend(legacy, address, address), parseEther("1") - 25_200n * 2_000_000_000n);
const failing = makeClient(parseEther("1"));
failing.estimateGas = async () => { throw new Error("Receiver reverted"); };
await assert.rejects(maxNativeSend(failing, address, address), /Receiver reverted/);
await assert.rejects(maxNativeSend(makeClient(parseEther("1"), 0n), address, address), /estimate the network fee/);
const unstable = makeClient(parseEther("1"));
let gas = 21_000n;
unstable.estimateGas = async () => { gas *= 2n; return gas; };
await assert.rejects(maxNativeSend(unstable, address, address), /keeps changing/);
console.log("ok: exact Max amounts, fee reserve, changing gas, legacy fees and estimation failures");
