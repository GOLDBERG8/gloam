/**
 * Payee side: finding the payments sealed to a receive key.
 *
 * Runs scanIncomingPayments and openIncomingPayment against an in-memory chain:
 * a payment-message board with real sealed payments, payments to someone else,
 * a forged message, spent and not-yet-landed payments, a duplicate post, a node
 * that refuses wide ranges, and a mainnet with no board. With GLOAM_LIVE=1 it
 * also scans the live testnet boards read-only (Robinhood Chain and Tempo) with
 * a fresh key, and checks that the mainnets report they have no board yet.
 *
 * Run after build:  node test/incoming.selftest.mjs
 */
import { createPublicClient, http } from "viem";
import {
  scanIncomingPayments,
  openIncomingPayment,
  payMemoBoardFor,
  NoPayMemoBoardError,
  generateReceiveKey,
  sealToReceiveTag,
  encodeNotePackage,
  noteCommitmentPoseidon,
  noteNullifierPoseidon,
  randomSecretField,
  fieldToHex,
  mainnetNetwork,
  GLOAM_NETWORKS,
  RH_MAINNET_USDG,
  FIELD_PRIME,
} from "../dist/index.js";

let checks = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  checks++;
}

// The mainnet vault, with its history starting at block 1 so the mock chain's small block numbers count.
const net = { ...mainnetNetwork("robinhood"), deployBlock: 1n };
const BOARD = { address: "0x00000000000000000000000000000000000b0a2d", deployBlock: 1000n, emitsPoster: false };
const lc = (h) => h.toLowerCase();
const toHex = (s) => "0x" + Buffer.from(s, "utf8").toString("hex");

/** A chain with a vault (commitments in, nullifiers spent, per block) and a memo board. */
function mockChain({ maxRange = null, maxResults = null } = {}) {
  const memos = []; // { block, commitment, memo, tx }
  const inVaultAt = new Map(); // commitment -> block it landed
  const spentAt = new Map(); // nullifier -> block it was spent
  let head = 5000n;
  let calls = 0;
  const client = {
    async getBlockNumber() {
      return head;
    },
    async getLogs({ address, fromBlock, toBlock }) {
      calls++;
      if (lc(address) !== lc(BOARD.address)) return [];
      if (maxRange !== null && toBlock - fromBlock + 1n > maxRange) throw new Error("query exceeds max block range 100000");
      const hits = memos.filter((m) => m.block >= fromBlock && m.block <= toBlock);
      if (maxResults !== null && hits.length > maxResults) throw new Error(`logs matched by query exceeds limit of ${maxResults}`);
      return hits.map((m) => ({ args: { paymentCommitment: m.commitment, memo: m.memo }, blockNumber: m.block, transactionHash: m.tx }));
    },
    async readContract({ functionName, args, blockNumber }) {
      const at = blockNumber ?? head;
      if (functionName === "commitmentSeen") return (inVaultAt.get(lc(args[0])) ?? Infinity) <= Number(at);
      if (functionName === "isSpent") return (spentAt.get(lc(args[0])) ?? Infinity) <= Number(at);
      throw new Error(`unexpected read ${functionName}`);
    },
  };
  return {
    client,
    memos,
    land: (c, block = 1500) => inVaultAt.set(lc(c), block),
    spend: (n, block = 1600) => spentAt.set(lc(n), block),
    setHead: (b) => (head = b),
    calls: () => calls,
  };
}

/** A payment the way the app makes one: a note package (with a private note), sealed to the payee's tag. */
async function payment(tag, amountWei, note, { pool = net.pool } = {}) {
  const secret = await randomSecretField();
  const commitment = fieldToHex(await noteCommitmentPoseidon(secret, amountWei, RH_MAINNET_USDG));
  const nullifier = fieldToHex(await noteNullifierPoseidon(secret, BigInt(commitment)));
  const pack = encodeNotePackage({ pool, asset: RH_MAINNET_USDG, amountWei: amountWei.toString(), secret: fieldToHex(secret), commitment, note });
  return { commitment, nullifier, sealed: await sealToReceiveTag(pack, tag) };
}

const raeto = await generateReceiveKey();
const someoneElse = await generateReceiveKey();

// ── scan ──────────────────────────────────────────────────────────────────────
{
  const chain = mockChain();
  const a = await payment(raeto.tag, 25_000_000n, "agent-42");
  const b = await payment(raeto.tag, 10_000_000n, "agent-7");
  const other = await payment(someoneElse.tag, 99_000_000n, "not yours");
  const spentOne = await payment(raeto.tag, 5_000_000n, "agent-9");
  const pending = await payment(raeto.tag, 3_000_000n, "agent-3");
  const wrongPool = await payment(raeto.tag, 4_000_000n, "agent-4", { pool: "0x0000000000000000000000000000000000000001" });
  for (const p of [a, b, other, spentOne, wrongPool]) chain.land(p.commitment);
  chain.spend(spentOne.nullifier);
  chain.memos.push(
    { block: 1501n, commitment: a.commitment, memo: toHex(a.sealed), tx: "0xa1" },
    { block: 1502n, commitment: other.commitment, memo: toHex(other.sealed), tx: "0xa2" },
    { block: 1503n, commitment: b.commitment, memo: toHex(b.sealed), tx: "0xa3" },
    // a forged message: a real code for `a`, posted under b's commitment
    { block: 1504n, commitment: b.commitment, memo: toHex(a.sealed), tx: "0xa4" },
    // the same payment posted twice
    { block: 1505n, commitment: a.commitment, memo: toHex(a.sealed), tx: "0xa5" },
    { block: 1506n, commitment: spentOne.commitment, memo: toHex(spentOne.sealed), tx: "0xa6" },
    { block: 1507n, commitment: pending.commitment, memo: toHex(pending.sealed), tx: "0xa7" },
    { block: 1508n, commitment: wrongPool.commitment, memo: toHex(wrongPool.sealed), tx: "0xa8" },
    // junk anyone can post
    { block: 1509n, commitment: a.commitment, memo: toHex("hello"), tx: "0xa9" }
  );
  const r = await scanIncomingPayments({ client: chain.client, network: net, receiveKey: raeto, board: BOARD });
  assert(r.scannedTo === 5000n, "reports the block it read at");
  assert(r.payments.length === 2, `finds exactly the two real, unspent payments to this key (got ${r.payments.length})`);
  const [p1, p2] = r.payments;
  assert(p1.note === "agent-42" && p1.amountWei === "25000000" && p1.commitment === a.commitment, "first payment, its note and amount");
  assert(p2.note === "agent-7" && p2.txHash === "0xa3" && p2.blockNumber === 1503n, "second payment, where it was posted");
  assert(p1.nullifier === a.nullifier && p1.sealedTicket === a.sealed, "nullifier and sealed code returned");
  assert(p1.notePackage.secret && p1.notePackage.note === "agent-42", "the opened package, ready to secure");

  // the same scan with the wrong key finds nothing of Raeto's
  const theirs = await scanIncomingPayments({ client: chain.client, network: net, receiveKey: someoneElse, board: BOARD });
  assert(theirs.payments.length === 1 && theirs.payments[0].note === "not yours", "another key only sees its own payment");

  // resuming from scannedTo + 1 finds nothing new; reading at an earlier block hides a payment that had not landed yet
  assert((await scanIncomingPayments({ client: chain.client, network: net, receiveKey: raeto, board: BOARD, fromBlock: r.scannedTo + 1n })).payments.length === 0, "resume finds nothing new");
  const early = await scanIncomingPayments({ client: chain.client, network: net, receiveKey: raeto, board: BOARD, toBlock: 1499n });
  assert(early.payments.length === 0 && early.scannedTo === 1499n, "everything is read at the pinned block");

  // once secured, a payment drops out
  chain.spend(a.nullifier, 4000);
  const after = await scanIncomingPayments({ client: chain.client, network: net, receiveKey: raeto, board: BOARD });
  assert(after.payments.length === 1 && after.payments[0].note === "agent-7", "a secured payment is not offered again");
}

// ── a code that claims more than its note holds ───────────────────────────────
{
  // A real 1-unit note, packaged as 1 + p: Poseidon reads the amount mod p, so the
  // commitment matches and the note is in the vault, but it holds 0.000001 USDG.
  const chain = mockChain();
  const secret = await randomSecretField();
  const commitment = fieldToHex(await noteCommitmentPoseidon(secret, 1n, RH_MAINNET_USDG));
  const pack = encodeNotePackage({ pool: net.pool, asset: RH_MAINNET_USDG, amountWei: (1n + FIELD_PRIME).toString(), secret: fieldToHex(secret), commitment, note: "agent:attacker" });
  chain.land(commitment);
  chain.memos.push({ block: 1501n, commitment, memo: toHex(await sealToReceiveTag(pack, raeto.tag)), tx: "0xc1" });
  const r = await scanIncomingPayments({ client: chain.client, network: net, receiveKey: raeto, board: BOARD });
  assert(r.payments.length === 0, `a code claiming amount + p is not a payment (got ${r.payments.map((p) => p.amountWei).join(",")})`);
}

// ── a node that refuses wide ranges or too many results ───────────────────────
{
  const chain = mockChain({ maxRange: 1000n, maxResults: 3 });
  const pays = [];
  for (let i = 0; i < 8; i++) {
    const p = await payment(raeto.tag, BigInt(1_000_000 + i), `agent-${i}`);
    chain.land(p.commitment, 1100);
    chain.memos.push({ block: BigInt(1100 + i * 300), commitment: p.commitment, memo: toHex(p.sealed), tx: `0xb${i}` });
    pays.push(p);
  }
  const r = await scanIncomingPayments({ client: chain.client, network: net, receiveKey: raeto, board: BOARD, chunkSize: 100_000n });
  assert(r.payments.length === 8, `ranges the node refuses are split until it answers (got ${r.payments.length})`);
  assert(r.payments.map((p) => p.note).join(",") === pays.map((_, i) => `agent-${i}`).join(","), "oldest first");
}

// ── every network has a board (both mainnets since 2026-10-23); a chain without one says so ──
{
  assert(payMemoBoardFor(4663)?.address === "0x01B3172d9900Cb26d57E986429b9b23854c74598", "Robinhood Chain mainnet board");
  assert(payMemoBoardFor(4217)?.address === "0x342E3745967FDB4223902E196Ceb792c15d8C1c4", "Tempo mainnet board");
  assert(payMemoBoardFor(4663)?.emitsPoster === false && payMemoBoardFor(4217)?.emitsPoster === false, "mainnet boards never log the poster");
  assert(payMemoBoardFor(46630)?.address && payMemoBoardFor(42431)?.address, "the testnets have boards");
  let err = null;
  try {
    await scanIncomingPayments({ client: mockChain().client, network: { ...net, chainId: 999_999 }, receiveKey: raeto });
  } catch (e) {
    err = e;
  }
  assert(err instanceof NoPayMemoBoardError && /sealed code/.test(err.message), "a scan without a board says to use the sealed code");
}

// ── a sealed code handed over directly ────────────────────────────────────────
{
  const chain = mockChain();
  const p = await payment(raeto.tag, 12_000_000n, "agent-12");
  let r = await openIncomingPayment({ client: chain.client, network: net, receiveKey: raeto, sealedTicket: p.sealed });
  assert(r.status === "not_in_vault_yet" && r.payment.note === "agent-12", "not landed yet, note readable");
  chain.land(p.commitment);
  r = await openIncomingPayment({ client: chain.client, network: net, receiveKey: raeto, sealedTicket: `  ${p.sealed}\n` });
  assert(r.status === "ready" && r.payment.amountWei === "12000000", "ready to secure");
  chain.spend(p.nullifier);
  r = await openIncomingPayment({ client: chain.client, network: net, receiveKey: raeto, sealedTicket: p.sealed });
  assert(r.status === "already_spent", "already secured or taken back");
  let threw = false;
  try {
    await openIncomingPayment({ client: chain.client, network: net, receiveKey: someoneElse, sealedTicket: p.sealed });
  } catch (e) {
    threw = /sealed to this receive key/.test(e.message);
  }
  assert(threw, "a code sealed to another key is refused");
}

// ── live, read-only (GLOAM_LIVE=1) ────────────────────────────────────────────
let live = "skipped (set GLOAM_LIVE=1)";
if (process.env.GLOAM_LIVE === "1") {
  const fresh = await generateReceiveKey();
  for (const n of [GLOAM_NETWORKS.robinhood, GLOAM_NETWORKS.tempo]) {
    const client = createPublicClient({ transport: http(n.rpcUrl) });
    const r = await scanIncomingPayments({ client, network: n, receiveKey: fresh });
    assert(r.payments.length === 0 && r.scannedTo > n.deployBlock, `${n.label} testnet board scans end to end`);
  }
  for (const family of ["robinhood", "tempo"]) {
    const n = mainnetNetwork(family);
    const client = createPublicClient({ transport: http(n.rpcUrl) });
    const r = await scanIncomingPayments({ client, network: n, receiveKey: fresh });
    assert(r.payments.length === 0 && r.scannedTo >= payMemoBoardFor(n.chainId).deployBlock, `${n.label} mainnet board scans end to end`);
  }
  live = "testnet and mainnet boards scanned";
}

console.log(`incoming.selftest: ok (${checks} assertions; live: ${live})`);
