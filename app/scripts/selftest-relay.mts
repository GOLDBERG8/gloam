/**
 * Self-test: relay guard rails from the 2026-10-11 audit (R-1, I-3).
 *
 *  - payment message cap: the largest real sealed ticket fits, 2,049 bytes
 *    and the board's 8,192 are refused; sealed tickets are padded, so their
 *    size says nothing about the amount and little about the note (L-2)
 *  - the one-request-per-spend lock in memory mode: a second take is refused,
 *    a release lets the next one in, it expires, and a stale release leaves a
 *    newer holder alone
 *  - the relay against a fake chain: a copy of a proof that is being sent is
 *    refused with a 409, the spent check runs before the dry run on sends and
 *    cash outs, the lock is dropped when nothing went out and kept once
 *    something did (or may have)
 *  - a send that may have reached a node (a dropped connection, a 502, a
 *    private RPC that took it and never answered) is reported maybe_sent and
 *    never sent again, with the public RPC never handed the raw send; only a
 *    real nonce or replacement refusal from the node is retried, once
 *  - payment messages: a relayed transfer hands back a memo ticket for its
 *    payment, the payer's ticketed message gets through after 40 strangers
 *    have tried, partner keys keep their own few, the app client keeps the
 *    ticket and sends it, no secret means no ticket, and no limit keys on an IP
 *  - cash outs to the vault or the memo board are refused before any chain
 *    call, on the server, in the shared check the app uses, and in the SDK
 *
 * fetch is stubbed for the whole run: chain calls go to an in-process fake
 * that answers the few JSON-RPC methods the relay uses, at the chain's public
 * RPC and at a made-up private one, and anything else fails. The relay key is a throwaway made here. Nothing reaches any host.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-relay.mts
 */
import assert from "node:assert/strict";
import { getAddress, toFunctionSelector, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.CHAINALYSIS_API_KEY;
process.env.GLOAM_RELAYER_PRIVATE_KEY = generatePrivateKey();

const {
  IN_FLIGHT_MESSAGE,
  MAYBE_SENT_MESSAGE,
  RELAY_MEMO_MAX_BYTES,
  RelayError,
  asMemo,
  memoTicket,
  relayMemo,
  relayTransfer,
  relayUnshield,
} = await import("../src/lib/relay/server");
const relayClient = await import("../src/lib/relay/client");
const { INFLIGHT_TTL_SEC, inflightKey, takeInflight } = await import("../src/lib/relay/inflight");
const { CASH_OUT_TO_BOARD_MESSAGE, CASH_OUT_TO_VAULT_MESSAGE, cashOutTargetProblem } = await import(
  "../src/lib/cashOutTarget"
);
const { POST: relayPost } = await import("../src/app/api/relay/route");
const { serverTransport } = await import("../src/lib/serverRpc");
const { getNetwork } = await import("../src/lib/networks");
const { buildNotePackage, encodeNotePackage } = await import("../src/lib/notePackage");
const { encryptTicketForTag } = await import("../src/lib/receiveTag");
const { PAY_MEMO_MAX_BYTES, ticketToMemoBytes } = await import("../src/lib/payMemo");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

function isRelayError(code: string, status: number, message?: string) {
  return (e: unknown) => {
    assert.ok(e instanceof RelayError, `expected a RelayError, got ${String(e)}`);
    assert.equal(e.code, code);
    assert.equal(e.status, status);
    if (message) assert.equal(e.message, message);
    return true;
  };
}

const net = getNetwork("robinhood");
assert.ok(net.pool && net.payMemo, "robinhood needs a pool and a memo board");
const POOL = net.pool;
const BOARD = net.payMemo.address;
const RPC = net.chain.rpcUrls.default.http[0];
const CLEAN = "0x1111111111111111111111111111111111111111" as Address;
const PROOF = ("0x" + "22".repeat(256)) as Hex;
const H32 = ("0x" + "11".repeat(32)) as Hex;
const TX_HASH = ("0x" + "ab".repeat(32)) as Hex;
let n = 0;
/** A fresh nullifier per case, so locks from one case never touch another. */
function nullifier(): Hex {
  n++;
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

// ---------------------------------------------------------------- fake chain

/**
 * How the node answers a raw send: "ok"; "reject" (out of gas); "drop" (the
 * connection drops, the node may have it); "http502"; "known" (the node already
 * holds it); "nonce_once" (a real nonce clash on the first send, then ok);
 * "private_took" (the private RPC takes it and the connection drops, then the
 * public RPC, where it already landed, calls it a nonce too low).
 */
type SendMode = "ok" | "reject" | "drop" | "http502" | "known" | "nonce_once" | "private_took";
const chain = { spent: false, known: true, seen: true, send: "ok" as SendMode };
const calls: string[] = [];
/** Which RPC got each raw send. */
const sends: ("public" | "private")[] = [];
const PRIVATE_RPC = "https://private-rpc.selftest.invalid";
const NONCE_TOO_LOW = { code: -32000, message: "nonce too low: address 0x0000000000000000000000000000000000000000, tx: 0 state: 1" };
const SEL = {
  spent: toFunctionSelector("spent(bytes32)"),
  isKnownRoot: toFunctionSelector("isKnownRoot(bytes32)"),
  commitmentSeen: toFunctionSelector("commitmentSeen(bytes32)"),
};
const word = (b: boolean) => "0x" + (b ? "1" : "0").padStart(64, "0");
const Z32 = "0x" + "00".repeat(32);
const BLOCK = {
  number: "0x1",
  hash: "0x" + "12".repeat(32),
  parentHash: Z32,
  nonce: "0x0000000000000000",
  sha3Uncles: Z32,
  logsBloom: "0x" + "00".repeat(256),
  transactionsRoot: Z32,
  stateRoot: Z32,
  receiptsRoot: Z32,
  miner: "0x" + "00".repeat(20),
  difficulty: "0x0",
  totalDifficulty: "0x0",
  extraData: "0x",
  size: "0x1",
  gasLimit: "0x1c9c380",
  gasUsed: "0x0",
  timestamp: "0x1",
  baseFeePerGas: "0x1",
  transactions: [],
  uncles: [],
};

type RpcReq = { id: number; method: string; params?: unknown[] };

function answer(r: RpcReq): { result?: unknown; error?: { code: number; message: string } } {
  switch (r.method) {
    case "eth_chainId":
      return { result: toHex(net.chainId) };
    case "eth_blockNumber":
      return { result: "0x1" };
    case "eth_getBlockByNumber":
      return { result: BLOCK };
    case "eth_getTransactionCount":
      return { result: "0x0" };
    case "eth_maxPriorityFeePerGas":
    case "eth_gasPrice":
      return { result: "0x1" };
    case "eth_estimateGas":
      return { result: "0x1b7740" };
    case "eth_call": {
      const data = String((r.params?.[0] as { data?: string; input?: string })?.data ?? (r.params?.[0] as { input?: string })?.input);
      const sel = data.slice(0, 10);
      if (sel === SEL.spent) return { result: word(chain.spent) };
      if (sel === SEL.isKnownRoot) return { result: word(chain.known) };
      if (sel === SEL.commitmentSeen) return { result: word(chain.seen) };
      return { error: { code: -32000, message: `fake chain: unknown call ${sel}` } };
    }
    case "eth_sendRawTransaction":
      if (chain.send === "reject") return { error: { code: -32000, message: "insufficient funds for gas * price + value" } };
      if (chain.send === "known") return { error: { code: -32000, message: "already known" } };
      if (chain.send === "nonce_once" && sends.length === 1) return { error: NONCE_TOO_LOW };
      if (chain.send === "private_took") return { error: NONCE_TOO_LOW };
      return { result: TX_HASH };
    default:
      return { error: { code: -32601, message: `fake chain: ${r.method} not handled` } };
  }
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = (typeof input === "string" ? input : input instanceof URL ? input.href : input.url).replace(/\/$/, "");
  // the app's relay client (lib/relay/client) posts here: hand it to the route itself
  if (url === "/api/relay") {
    return relayPost(new Request("http://localhost/api/relay", { method: init?.method ?? "GET", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.200" }, body: init?.body }));
  }
  const via = url === RPC.replace(/\/$/, "") ? "public" : url === PRIVATE_RPC ? "private" : null;
  if (!via) throw new Error(`selftest: no network (${url})`);
  const body = JSON.parse(String(init?.body)) as RpcReq | RpcReq[];
  const list = Array.isArray(body) ? body : [body];
  for (const r of list) calls.push(r.method === "eth_call" ? `eth_call:${callName(r)}` : r.method);
  const isSend = list.some((r) => r.method === "eth_sendRawTransaction");
  if (isSend) sends.push(via);
  // A dropped connection on the send: the node may or may not have the transaction.
  if (isSend && (chain.send === "drop" || (chain.send === "private_took" && via === "private"))) {
    throw new TypeError("fetch failed");
  }
  if (isSend && chain.send === "http502") return new Response("bad gateway", { status: 502 });
  const out = list.map((r) => ({ jsonrpc: "2.0", id: r.id, ...answer(r) }));
  return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

function callName(r: RpcReq): string {
  const data = String((r.params?.[0] as { data?: string })?.data ?? "");
  const sel = data.slice(0, 10);
  return sel === SEL.spent ? "spent" : sel === SEL.isKnownRoot ? "isKnownRoot" : sel === SEL.commitmentSeen ? "commitmentSeen" : sel;
}

function reset(state: Partial<typeof chain> = {}) {
  Object.assign(chain, { spent: false, known: true, seen: true, send: "ok" }, state);
  calls.length = 0;
  sends.length = 0;
}

/** Runs `fn` with GLOAM_RPC_URL set for the test network, so relay sends go to the private RPC first. */
async function withPrivateRpc(fn: () => Promise<void>) {
  const name = `GLOAM_RPC_URL_${net.chainId}`;
  process.env[name] = PRIVATE_RPC;
  try {
    await fn();
  } finally {
    delete process.env[name];
  }
}

/** True when nobody holds the lock for this spend (takes it and lets it go again). */
async function lockFree(nul: Hex): Promise<boolean> {
  const l = await takeInflight(inflightKey(net.chainId, nul));
  if (!l) return false;
  await l.release();
  return true;
}

function transferBody(nul: Hex) {
  return { proof: PROOF, root: H32, nullifier: nul, commitments: [H32, H32] };
}

function unshieldBody(nul: Hex, to: string) {
  return { proof: PROOF, root: H32, nullifier: nul, asset: "0x0000000000000000000000000000000000000000", to, amount: "1" };
}

function req(url: string, body: unknown, ip = "203.0.113.9") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------- memo cap

async function receiveTag(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return "gloamr1." + Buffer.from(spki).toString("base64url");
}

async function sealedMemo(note: string, amountWei = (2n ** 256n - 1n).toString()): Promise<Hex> {
  const pack = buildNotePackage({
    pool: getAddress(POOL),
    asset: getAddress("0x20c0000000000000000000000000000000000001"),
    amountWei,
    secret: ("0x" + "f".repeat(64)) as Hex,
    commitment: ("0x" + "e".repeat(64)) as Hex,
    note,
  });
  return ticketToMemoBytes(await encryptTicketForTag(encodeNotePackage(pack), await receiveTag()));
}

const bytesOf = (memo: Hex) => (memo.length - 2) / 2;
const memoOf = (bytes: number) => ("0x" + "ab".repeat(bytes)) as Hex;

await test("memo cap is 2048 bytes, under the board's 8192", () => {
  assert.equal(RELAY_MEMO_MAX_BYTES, 2048);
  assert.equal(PAY_MEMO_MAX_BYTES, 8192);
});

await test("the largest real sealed ticket is 1714 bytes and fits", async () => {
  // 80 lone surrogates: each one JSON-escapes to \uXXXX, 6 bytes, the most any character costs.
  const worst = await sealedMemo("\uD800".repeat(80));
  assert.equal(bytesOf(worst), 1714);
  assert.equal(asMemo(worst), worst);
  // 80 emoji (4 bytes each), a note made of real characters: padded to the 1024-byte step.
  const emoji = await sealedMemo("\u{1F600}".repeat(80));
  assert.equal(bytesOf(emoji), 1535);
  assert.equal(asMemo(emoji), emoji);
  // No note at all: padded to the 512-byte step.
  assert.equal(bytesOf(await sealedMemo("")), 852);
  // A longer note is cut to 80 characters before it is sealed.
  assert.equal(bytesOf(await sealedMemo("\uD800".repeat(500))), 1714);
});

await test("sealed messages come in three sizes, whatever the amount and note (L-2)", async () => {
  // every amount from 1 base unit to 2^256 - 1, no note: one size
  const amounts = ["1", "10000", "1000000", "100000000", "10000000000000", (2n ** 128n).toString(), (2n ** 256n - 1n).toString()];
  const noNote = new Set<number>();
  for (const w of amounts) noNote.add(bytesOf(await sealedMemo("", w)));
  assert.deepEqual([...noNote], [852]);
  // any note: one of three sizes, and never past the largest a ticket was before
  const sizes = new Set<number>();
  for (const note of ["a", "rent", "x".repeat(20), "x".repeat(40), "x".repeat(80), "\u{1F600}".repeat(40), "\uD800".repeat(80)]) {
    for (const w of ["1", "100000000", (2n ** 256n - 1n).toString()]) sizes.add(bytesOf(await sealedMemo(note, w)));
  }
  assert.ok([...sizes].every((n) => n === 852 || n === 1535 || n === 1714), `sizes ${[...sizes].join(", ")}`);
});

await test("2048 bytes pass, 2049 and 8192 are refused as too large", () => {
  assert.equal(asMemo(memoOf(2048)), memoOf(2048));
  assert.throws(() => asMemo(memoOf(2049)), isRelayError("bad_request", 400, "The payment message is too large."));
  assert.throws(() => asMemo(memoOf(8192)), isRelayError("bad_request", 400, "The payment message is too large."));
});

await test("malformed memos are refused", () => {
  for (const bad of [undefined, 42, "", "0x", "0xabc", "abab", "0xzz", "0x" + "ab".repeat(10) + "g0"]) {
    assert.throws(() => asMemo(bad), isRelayError("bad_request", 400, "Invalid payment message."));
  }
});

await test("relay refuses an oversize memo before any chain call", async () => {
  reset();
  await assert.rejects(
    relayMemo(net, { paymentCommitment: H32, memo: memoOf(2049) }, "selftest-memo"),
    isRelayError("bad_request", 400, "The payment message is too large.")
  );
  assert.deepEqual(calls, []);
});

await test("relay posts the largest real ticket end to end", async () => {
  reset();
  const worst = await sealedMemo("\uD800".repeat(80));
  assert.equal(await relayMemo(net, { paymentCommitment: H32, memo: worst }, "selftest-memo"), TX_HASH);
  assert.equal(calls[0], "eth_call:commitmentSeen");
  assert.ok(calls.includes("eth_estimateGas") && calls.includes("eth_sendRawTransaction"));
});

// ---------------------------------------------------------------- lock, memory mode

await test("lock: ttl is 180 s and keys ignore nullifier case", () => {
  assert.equal(INFLIGHT_TTL_SEC, 180);
  const lower = "0x" + "ab".repeat(32);
  assert.equal(inflightKey(46630, lower), inflightKey(46630, lower.toUpperCase().replace("0X", "0x")));
  assert.notEqual(inflightKey(46630, lower), inflightKey(42431, lower));
});

await test("lock: second take refused, release lets the next one in", async () => {
  const key = inflightKey(net.chainId, nullifier());
  const a = await takeInflight(key);
  assert.ok(a);
  assert.equal(a.store, "memory");
  assert.equal(await takeInflight(key), null);
  assert.equal(await takeInflight(key), null);
  await a.release();
  const b = await takeInflight(key);
  assert.ok(b);
  await b.release();
});

await test("lock: expires after its ttl", async () => {
  const key = inflightKey(net.chainId, nullifier());
  const t0 = 1_700_000_000_000;
  assert.ok(await takeInflight(key, 2, t0));
  assert.equal(await takeInflight(key, 2, t0 + 1_999), null);
  const again = await takeInflight(key, 2, t0 + 2_000);
  assert.ok(again);
  await again.release();
});

await test("lock: a stale release leaves the newer holder alone", async () => {
  const key = inflightKey(net.chainId, nullifier());
  const t0 = 1_700_000_100_000;
  const old = await takeInflight(key, 1, t0);
  assert.ok(old);
  const newer = await takeInflight(key, 1, t0 + 1_000);
  assert.ok(newer);
  await old.release();
  assert.equal(await takeInflight(key, 1, t0 + 1_001), null);
  await newer.release();
  const next = await takeInflight(key, 1, t0 + 1_002);
  assert.ok(next);
  await next.release();
});

// ---------------------------------------------------------------- relay, one request per spend

await test("a copy of a proof being sent is refused with 409 before any chain call", async () => {
  reset();
  const nul = nullifier();
  const held = await takeInflight(inflightKey(net.chainId, nul));
  assert.ok(held);
  await assert.rejects(relayTransfer(net, transferBody(nul)), isRelayError("in_flight", 409, IN_FLIGHT_MESSAGE));
  await assert.rejects(relayUnshield(net, unshieldBody(nul, CLEAN)), isRelayError("in_flight", 409, IN_FLIGHT_MESSAGE));
  // Same nullifier in capitals is the same spend.
  await assert.rejects(
    relayTransfer(net, transferBody(nul.toUpperCase().replace("0X", "0x") as Hex)),
    isRelayError("in_flight", 409)
  );
  const res = await relayPost(req("http://localhost/api/relay", { chainId: net.chainId, action: "transfer", ...transferBody(nul) }));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { ok: false, error: IN_FLIGHT_MESSAGE, code: "in_flight" });
  assert.deepEqual(calls, []);
  await held.release();
});

await test("send: spent check before the dry run; a spent note never reaches it and frees the lock", async () => {
  reset({ spent: true });
  const nul = nullifier();
  await assert.rejects(relayTransfer(net, transferBody(nul)), isRelayError("AlreadySpent", 409));
  assert.ok(calls.includes("eth_call:spent"));
  assert.ok(!calls.includes("eth_estimateGas"));
  assert.ok(await lockFree(nul));
});

await test("cash out: spent check before the dry run; a spent note never reaches it and frees the lock", async () => {
  reset({ spent: true });
  const nul = nullifier();
  await assert.rejects(relayUnshield(net, unshieldBody(nul, CLEAN)), isRelayError("AlreadySpent", 409));
  assert.ok(calls.includes("eth_call:spent"));
  assert.ok(!calls.includes("eth_estimateGas"));
  assert.ok(await lockFree(nul));
});

await test("an unknown root frees the lock", async () => {
  reset({ known: false });
  const nul = nullifier();
  await assert.rejects(relayTransfer(net, transferBody(nul)), isRelayError("UnknownRoot", 409));
  assert.ok(await lockFree(nul));
});

await test("a send the node refuses frees the lock, so the user can retry", async () => {
  reset({ send: "reject" });
  const nul = nullifier();
  await assert.rejects(relayTransfer(net, transferBody(nul)), isRelayError("relay_empty", 503));
  assert.ok(calls.indexOf("eth_call:spent") < calls.indexOf("eth_estimateGas"));
  assert.ok(calls.includes("eth_sendRawTransaction"));
  assert.ok(await lockFree(nul));
});

await test("send: once sent, the lock holds and a duplicate is refused without a chain call", async () => {
  reset();
  const nul = nullifier();
  assert.equal(await relayTransfer(net, transferBody(nul)), TX_HASH);
  const spentAt = calls.indexOf("eth_call:spent");
  assert.ok(spentAt >= 0 && spentAt < calls.indexOf("eth_estimateGas"));
  assert.ok(calls.indexOf("eth_estimateGas") < calls.indexOf("eth_sendRawTransaction"));
  calls.length = 0;
  await assert.rejects(relayTransfer(net, transferBody(nul)), isRelayError("in_flight", 409));
  assert.deepEqual(calls, []);
  assert.equal(await lockFree(nul), false);
});

await test("cash out: once sent, the lock holds; spent check came before the dry run", async () => {
  reset();
  const nul = nullifier();
  assert.equal(await relayUnshield(net, unshieldBody(nul, CLEAN)), TX_HASH);
  const spentAt = calls.indexOf("eth_call:spent");
  assert.ok(spentAt >= 0 && spentAt < calls.indexOf("eth_estimateGas"));
  await assert.rejects(relayUnshield(net, unshieldBody(nul, CLEAN)), isRelayError("in_flight", 409));
});

await test("a send that may have gone out (dropped connection) is maybe_sent, sent once, and keeps the lock", async () => {
  reset({ send: "drop" });
  const nul = nullifier();
  await assert.rejects(relayTransfer(net, transferBody(nul)), isRelayError("maybe_sent", 502, MAYBE_SENT_MESSAGE));
  // viem's message lists the request, "nonce" included: that is no reason to send a second copy
  assert.deepEqual(sends, ["public"]);
  assert.equal(await lockFree(nul), false);
});

await test("a 502 on the send is maybe_sent and never sent again", async () => {
  reset({ send: "http502" });
  const nul = nullifier();
  await assert.rejects(relayTransfer(net, transferBody(nul)), isRelayError("maybe_sent", 502, MAYBE_SENT_MESSAGE));
  assert.deepEqual(sends, ["public"]);
  assert.equal(await lockFree(nul), false);
});

await test("'already known' means the node holds it: maybe_sent, never sent again", async () => {
  reset({ send: "known" });
  const nul = nullifier();
  await assert.rejects(relayTransfer(net, transferBody(nul)), isRelayError("maybe_sent", 502, MAYBE_SENT_MESSAGE));
  assert.deepEqual(sends, ["public"]);
  assert.equal(await lockFree(nul), false);
});

await test("a real nonce clash from the node is retried once from the chain's nonce", async () => {
  reset({ send: "nonce_once" });
  const nul = nullifier();
  assert.equal(await relayTransfer(net, transferBody(nul)), TX_HASH);
  assert.deepEqual(sends, ["public", "public"]);
  // the second send read the nonce from the chain again
  assert.ok(calls.lastIndexOf("eth_getTransactionCount") > calls.indexOf("eth_sendRawTransaction"));
});

await test("private RPC took the send and dropped: never replayed on the public RPC, maybe_sent, lock kept", async () => {
  await withPrivateRpc(async () => {
    reset({ send: "private_took" });
    const nul = nullifier();
    await assert.rejects(relayTransfer(net, transferBody(nul)), isRelayError("maybe_sent", 502, MAYBE_SENT_MESSAGE));
    assert.deepEqual(sends, ["private"]);
    assert.equal(await lockFree(nul), false);
  });
});

await test("sendOnce: the public backup answers reads but never gets a raw send", async () => {
  await withPrivateRpc(async () => {
    reset({ send: "private_took" });
    const raw = ("0x" + "02".repeat(100)) as Hex;
    const once = serverTransport(net, { retryCount: 0 }, { sendOnce: true })({ chain: net.chain });
    await assert.rejects(once.request({ method: "eth_sendRawTransaction", params: [raw] }));
    assert.deepEqual(sends, ["private"]);
    // reads still fall back: the private RPC is down for reads too here, and the public one answers
    const down = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(PRIVATE_RPC)) throw new TypeError("fetch failed");
      return down(input, init);
    }) as typeof fetch;
    try {
      assert.equal(await once.request({ method: "eth_chainId" }), toHex(net.chainId));
    } finally {
      globalThis.fetch = down;
    }
    // without sendOnce (server reads), the public RPC stays a full backup
    sends.length = 0;
    const reads = serverTransport(net, { retryCount: 0 })({ chain: net.chain });
    await assert.rejects(reads.request({ method: "eth_sendRawTransaction", params: [raw] }));
    assert.deepEqual(sends, ["private", "public"]);
  });
});

// ---------------------------------------------------------------- payment message tickets (M-2, L-3)

const MEMO_SECRET = "selftest-memo-secret-" + "x".repeat(32);
/** A fresh payment commitment per case, so message counts from one case never touch another. */
function payment(): Hex {
  n++;
  return `0x${(0xc000_0000 + n).toString(16).padStart(64, "0")}` as Hex;
}
const memoBody = (c: Hex, extra: Record<string, unknown> = {}) => ({ chainId: net.chainId, action: "memo", paymentCommitment: c, memo: memoOf(64), ...extra });
const transferTo = (c: Hex) => ({ chainId: net.chainId, action: "transfer", ...transferBody(nullifier()), commitments: [c, H32] });

async function post(ip: string, body: unknown) {
  const res = await relayPost(req("http://localhost/api/relay", body, ip));
  return { status: res.status, json: (await res.json()) as { ok: boolean; code?: string; hash?: Hex; memoTicket?: string | null } };
}

function withMemoSecret(secret: string | undefined) {
  if (secret === undefined) delete process.env.GLOAM_RELAY_MEMO_SECRET;
  else process.env.GLOAM_RELAY_MEMO_SECRET = secret;
}

await test("memo ticket: a relayed transfer hands back one for its payment, and only for it", async () => {
  withMemoSecret(MEMO_SECRET);
  reset();
  const pay = payment();
  const { status, json } = await post("203.0.113.9", transferTo(pay));
  assert.equal(status, 200);
  assert.equal(json.hash, TX_HASH);
  assert.ok(json.memoTicket && /^[A-Za-z0-9_-]{43}$/.test(json.memoTicket), "a 32-byte base64url ticket");
  assert.equal(json.memoTicket, memoTicket(net.chainId, pay));
  assert.equal(memoTicket(net.chainId, pay.toUpperCase().replace("0X", "0x")), json.memoTicket, "any case");
  assert.notEqual(memoTicket(net.chainId, payment()), json.memoTicket);
  assert.notEqual(memoTicket(net.chainId + 1, pay), json.memoTicket);
});

await test("memo DoS: 40 strangers can't block the payer's ticketed heads-up", async () => {
  withMemoSecret(MEMO_SECRET);
  reset();
  const pay = payment();
  const ticket = (await post("203.0.113.9", transferTo(pay))).json.memoTicket!;
  let accepted = 0;
  for (let i = 0; i < 40; i++) {
    const r = await post(`198.51.100.${i + 1}`, memoBody(pay));
    if (r.status === 200) accepted++;
    else assert.deepEqual([r.status, r.json.code], [409, "memo_sent"]);
  }
  assert.equal(accepted, 10, "strangers share a small allowance per payment");
  // a made-up ticket, or another payment's, is a stranger's
  assert.equal((await post("198.51.100.99", memoBody(pay, { ticket: memoTicket(net.chainId, payment()) }))).status, 409);
  assert.equal((await post("198.51.100.99", memoBody(pay, { ticket: "A".repeat(43) }))).status, 409);
  assert.equal((await post("198.51.100.99", memoBody(pay, { ticket: 42 }))).status, 409);
  // the payer's own few, from any IP
  for (const ip of ["203.0.113.9", "203.0.113.10", "2001:db8::1"]) {
    const r = await post(ip, memoBody(pay, { ticket }));
    assert.equal(r.status, 200);
    assert.equal(r.json.hash, TX_HASH);
  }
  assert.equal((await post("203.0.113.9", memoBody(pay, { ticket }))).status, 409, "and only a few");
});

await test("partner keys keep their own few per payment, apart from strangers and each other", async () => {
  withMemoSecret(MEMO_SECRET);
  reset();
  const pay = payment();
  const body = { paymentCommitment: pay, memo: memoOf(64) };
  for (let i = 0; i < 10; i++) assert.equal(await relayMemo(net, body), TX_HASH);
  await assert.rejects(relayMemo(net, body), isRelayError("memo_sent", 409));
  for (const key of ["key:key_a1b2", "key:key_c3d4"]) {
    for (let i = 0; i < 3; i++) assert.equal(await relayMemo(net, body, key), TX_HASH);
    await assert.rejects(relayMemo(net, body, key), isRelayError("memo_sent", 409));
  }
});

await test("no memo limit keys on the poster's IP", async () => {
  withMemoSecret(MEMO_SECRET);
  reset();
  const counts = (globalThis as { __gloamMcpRate?: Map<string, unknown> }).__gloamMcpRate!;
  const memoKeys = () => [...counts.keys()].filter((k) => /:relay-memo(?:-all)?:/.test(k));
  const before = new Set(memoKeys());
  const added = () => memoKeys().filter((k) => !before.has(k)).length;
  const ips = ["198.51.100.1", "198.51.100.2", "2a01:4f8:c17:1234::1", "2a01:dead:beef::1"];
  const pay = payment();
  for (const ip of ips) await post(ip, memoBody(pay));
  // strangers: one shared count, whoever posted from where
  assert.equal(added(), 1);
  const ticket = memoTicket(net.chainId, pay)!;
  for (const ip of ips) await post(ip, memoBody(pay, { ticket }));
  // and one for the payer
  assert.equal(added(), 2);
});

await test("app client: keeps the transfer's ticket and sends it with that payment's message", async () => {
  withMemoSecret(MEMO_SECRET);
  reset();
  const pay = payment();
  // strangers used up the shared allowance first
  for (let i = 0; i < 10; i++) await relayMemo(net, { paymentCommitment: pay, memo: memoOf(64) });
  const sent = await relayClient.relayTransfer({ chainId: net.chainId, proof: PROOF, root: H32, nullifier: nullifier(), commitments: [pay, H32] });
  assert.equal(sent, TX_HASH);
  assert.equal(await relayClient.relayMemo({ chainId: net.chainId, paymentCommitment: pay, memo: memoOf(64) }), TX_HASH);
  // a payment this browser never relayed has no ticket: a stranger's share, used up here
  const other = payment();
  for (let i = 0; i < 10; i++) await relayMemo(net, { paymentCommitment: other, memo: memoOf(64) });
  await assert.rejects(
    relayClient.relayMemo({ chainId: net.chainId, paymentCommitment: other, memo: memoOf(64) }),
    (e: unknown) => e instanceof relayClient.RelaySubmitError && e.code === "memo_sent"
  );
});

await test("app client: a heads-up the relay's node has not seen yet is tried again, other refusals are not", async () => {
  reset();
  const keep = { ...relayClient.MEMO_NOT_SEEN_RETRY };
  relayClient.MEMO_NOT_SEEN_RETRY.delayMs = 0;
  const real = globalThis.fetch;
  let refusals = 0;
  let memoPosts = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/relay") && init?.body && String(init.body).includes('"action":"memo"')) {
      memoPosts++;
      if (refusals > 0) {
        refusals--;
        return new Response(JSON.stringify({ ok: false, error: "That payment is not in the vault yet.", code: "not_seen" }), { status: 409 });
      }
    }
    return real(input, init);
  }) as typeof fetch;
  try {
    refusals = 2;
    assert.equal(await relayClient.relayMemo({ chainId: net.chainId, paymentCommitment: payment(), memo: memoOf(64) }), TX_HASH);
    assert.equal(memoPosts, 3, "two not_seen answers, then it goes");
    memoPosts = 0;
    refusals = 5;
    await assert.rejects(
      relayClient.relayMemo({ chainId: net.chainId, paymentCommitment: payment(), memo: memoOf(64) }),
      (e: unknown) => e instanceof relayClient.RelaySubmitError && e.code === "not_seen"
    );
    assert.equal(memoPosts, 3, "three tries at most");
  } finally {
    globalThis.fetch = real;
    Object.assign(relayClient.MEMO_NOT_SEEN_RETRY, keep);
  }
});

await test("no secret: no ticket is handed out, and everyone but partner keys shares the small allowance", async () => {
  for (const secret of [undefined, "", "too-short-to-trust"]) {
    withMemoSecret(secret);
    reset();
    const pay = payment();
    assert.equal(memoTicket(net.chainId, pay), null);
    assert.equal((await post("203.0.113.9", transferTo(pay))).json.memoTicket, null);
    // a ticket made with the secret once set opens nothing now
    withMemoSecret(MEMO_SECRET);
    const old = memoTicket(net.chainId, pay);
    withMemoSecret(secret);
    for (let i = 0; i < 10; i++) assert.equal((await post(`198.51.100.${i + 1}`, memoBody(pay, { ticket: old }))).status, 200);
    assert.equal((await post("203.0.113.9", memoBody(pay, { ticket: old }))).status, 409);
    assert.equal(await relayMemo(net, { paymentCommitment: pay, memo: memoOf(64) }, "key:key_a1b2"), TX_HASH);
  }
  withMemoSecret(undefined);
});

// ---------------------------------------------------------------- cash out to the vault

await test("shared check: vault and memo board refused, any case; wallets pass", () => {
  assert.equal(cashOutTargetProblem(POOL, net), CASH_OUT_TO_VAULT_MESSAGE);
  assert.equal(cashOutTargetProblem(POOL.toLowerCase(), net), CASH_OUT_TO_VAULT_MESSAGE);
  assert.equal(cashOutTargetProblem(getAddress(POOL), net), CASH_OUT_TO_VAULT_MESSAGE);
  assert.equal(cashOutTargetProblem(BOARD.toLowerCase(), net), CASH_OUT_TO_BOARD_MESSAGE);
  assert.equal(cashOutTargetProblem(CLEAN, net), null);
  assert.equal(cashOutTargetProblem(CLEAN, { pool: null, payMemo: null }), null);
  assert.equal(CASH_OUT_TO_VAULT_MESSAGE, "That address is the vault itself. Cash out to a wallet you control.");
});

await test("relay refuses a cash out to the vault before any chain call or lock", async () => {
  reset();
  for (const to of [POOL, POOL.toLowerCase(), getAddress(POOL)]) {
    const nul = nullifier();
    await assert.rejects(relayUnshield(net, unshieldBody(nul, to)), isRelayError("vault_recipient", 400, CASH_OUT_TO_VAULT_MESSAGE));
    assert.ok(await lockFree(nul));
  }
  await assert.rejects(
    relayUnshield(net, unshieldBody(nullifier(), BOARD)),
    isRelayError("vault_recipient", 400, CASH_OUT_TO_BOARD_MESSAGE)
  );
  assert.deepEqual(calls, []);
});

await test("relay route answers 400 vault_recipient for a cash out to the vault", async () => {
  reset();
  const res = await relayPost(
    req("http://localhost/api/relay", { chainId: net.chainId, action: "unshield", ...unshieldBody(nullifier(), POOL) })
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, error: CASH_OUT_TO_VAULT_MESSAGE, code: "vault_recipient" });
  assert.deepEqual(calls, []);
});

await test("SDK builder refuses a cash out to the pool before proving", async () => {
  const { buildUnshieldIntent } = await import("@gloamtrade/sdk");
  let proved = false;
  await assert.rejects(
    buildUnshieldIntent({
      secretHex: ("0x" + "01".repeat(32)) as Hex,
      amountWei: 1n,
      to: POOL.toLowerCase() as Address,
      poolAddress: POOL,
      path: {} as never,
      prove: async () => {
        proved = true;
        throw new Error("should not prove");
      },
    }),
    /vault itself/
  );
  assert.equal(proved, false);
});

console.log(`\nrelay: ${passed} passed`);
