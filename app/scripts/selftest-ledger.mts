/**
 * Self-test: the transparency ledger (components/transparency/ledger.ts)
 * never reads a block twice when the chain's head goes back.
 *
 * Behind a load balancer a lagging node can answer an older head. The scan
 * must never end below where the last pass stopped: if it did, the next pass
 * would read those blocks again and count their events twice.
 *
 *  - a pass at the head, one at an older head (a lagging node), one at a head
 *    below the event, then the head moving on: one deposit throughout, and the
 *    point scanned to never moves back
 *
 * The RPC is stubbed: one Shielded event in Robinhood Chain mainnet's pool.
 * Nothing reaches the network. Each pass waits out viem's 4 second cache of
 * the block number, so the run takes about 15 seconds.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-ledger.mts
 */
import assert from "node:assert/strict";
import { toEventSelector } from "viem";
import { getNetwork } from "../src/lib/networks";

const SHIELDED = toEventSelector("Shielded(bytes32,address,uint256,uint256,address)");
const net = getNetwork("robinhood-mainnet");
assert.ok(net.pool && net.deployBlock != null, "Robinhood Chain mainnet has a pool");
const POOL = net.pool.toLowerCase();
const EVENT_BLOCK = BigInt(net.deployBlock) + 1000n;
const pad = (h: string) => `0x${h.replace(/^0x/, "").padStart(64, "0")}`;
let head = 0n;

type Rpc = { id: number; method: string; params: { fromBlock: string; toBlock: string }[] };
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as Rpc | Rpc[];
  const one = (q: Rpc) => {
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: q.id, result });
    if (q.method === "eth_blockNumber") return ok(`0x${head.toString(16)}`);
    if (q.method === "eth_chainId") return ok("0x1237");
    if (q.method === "eth_getLogs") {
      const from = BigInt(q.params[0]!.fromBlock);
      const to = BigInt(q.params[0]!.toBlock);
      if (EVENT_BLOCK < from || EVENT_BLOCK > to) return ok([]);
      return ok([
        {
          address: POOL,
          blockNumber: `0x${EVENT_BLOCK.toString(16)}`,
          blockHash: pad("1"),
          logIndex: "0x0",
          transactionIndex: "0x0",
          transactionHash: pad("ab"),
          removed: false,
          topics: [SHIELDED, pad("c0"), pad("5fc5360D0400a0Fd4f2af552ADD042D716F1d168"), pad("1234")],
          data: pad("f4240") + pad("0").slice(2),
        },
      ]);
    }
    if (q.method === "eth_call") return ok(pad("0"));
    if (q.method === "eth_getBalance") return ok("0x0");
    if (q.method === "eth_getBlockByNumber") {
      return ok({
        number: (q.params as unknown as string[])[0],
        timestamp: "0x6700000",
        hash: pad("1"),
        parentHash: pad("0"),
        transactions: [],
        logsBloom: `0x${"0".repeat(512)}`,
        gasLimit: "0x0",
        gasUsed: "0x0",
        baseFeePerGas: "0x0",
        miner: pad("0").slice(0, 42),
        extraData: "0x",
        difficulty: "0x0",
        size: "0x0",
        nonce: "0x0000000000000000",
        stateRoot: pad("0"),
        receiptsRoot: pad("0"),
        transactionsRoot: pad("0"),
        sha3Uncles: pad("0"),
        uncles: [],
        mixHash: pad("0"),
      });
    }
    return { jsonrpc: "2.0", id: q.id, error: { code: -32601, message: `not stubbed: ${q.method}` } };
  };
  const out = Array.isArray(body) ? body.map(one) : one(body);
  return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const { loadLedger } = await import("../src/components/transparency/ledger");

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** viem keeps the block number for 4 seconds; a new head needs a fresh read. */
const newHead = async (h: bigint) => {
  await new Promise((r) => setTimeout(r, 4_200));
  head = h;
};

await test("a head that goes back never moves the scan back or counts an event twice", async () => {
  head = EVENT_BLOCK + 5000n;
  const first = await loadLedger("robinhood-mainnet", { force: true });
  assert.equal(first.counts.deposits, 1);
  const scanned = BigInt(first.scannedTo);
  assert.ok(scanned >= EVENT_BLOCK);

  await newHead(EVENT_BLOCK + 4000n);
  const lagging = await loadLedger("robinhood-mainnet", { force: true });
  assert.equal(BigInt(lagging.scannedTo), scanned, "a lagging node's head leaves the scan where it was");
  assert.equal(lagging.counts.deposits, 1);

  await newHead(EVENT_BLOCK - 500n);
  const below = await loadLedger("robinhood-mainnet", { force: true });
  assert.equal(BigInt(below.scannedTo), scanned, "a head below the event too");
  assert.equal(below.counts.deposits, 1);

  await newHead(EVENT_BLOCK + 9000n);
  const later = await loadLedger("robinhood-mainnet", { force: true });
  assert.ok(BigInt(later.scannedTo) > scanned, "the scan moves on with the head");
  assert.equal(later.counts.deposits, 1, "the event is counted once");
  assert.equal(later.recent.length, 1);
});

console.log(`ledger: ${passed} passed`);
