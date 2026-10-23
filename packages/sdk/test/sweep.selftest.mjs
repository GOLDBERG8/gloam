/**
 * Payee sweep self-test: an x402 payment is final only after the payee moves
 * the received note into a fresh note only it knows.
 *
 * Runs against an in-memory pool that enforces what ShieldPoolPoseidon.transfer
 * enforces (known root, nullifier spent once, fresh commitments, insert both
 * outputs), with a mocked submitter. Covers the happy path, a payer who spends
 * the note back first, a payer who front-runs the sweep, a payment that never
 * landed, a replayed header, relay failures, and a sweep that landed while its
 * receipt was lost. When the transfer artifacts are present it also proves the
 * zero-change sweep with snarkjs and verifies it against the transfer vkey.
 *
 * Run after build:  node test/sweep.selftest.mjs
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  IncrementalMerkleTreePoseidon,
  noteCommitmentPoseidon,
  noteNullifierPoseidon,
  fieldToHex,
  hexToField,
  generateReceiveKey,
  buildGloamPaymentRequirements,
  buildGloamPayment,
  buildPrivateSendIntent,
  verifyGloamPayment,
  openGloamPaymentNote,
  settleGloamPayment,
  sweepReceivedNote,
  packGroth16Proof,
  transferCallArgs,
  GLOAM_NOT_FINAL,
  SEALED_VAULT,
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

const STABLE = "0x00000000000000000000000000000000000000ee";
const NETWORK = 46630;
const stubProve = async () => ({ proofBytes: "0xdeadbeef" });

/** A pool that follows the contract's transfer rules (proofs are not checked here). */
function mockPool() {
  const tree = new IncrementalMerkleTreePoseidon();
  const index = new Map();
  const roots = new Set();
  const spent = new Set();
  const receipts = new Map();
  let n = 0;
  const lc = (h) => h.toLowerCase();
  const insert = async (c) => {
    index.set(lc(c), await tree.insert(hexToField(c)));
    roots.add(fieldToHex(tree.currentRoot));
  };
  return {
    insert,
    spent,
    /** Apply transfer(proof, root, nullifier, [c0, c1]); returns a tx hash, receipt "reverted" on any rule break. */
    async transfer(args) {
      const [, root, nullifier, outs] = args;
      const hash = `0x${(++n).toString(16).padStart(64, "0")}`;
      const ok = roots.has(lc(root)) && !spent.has(lc(nullifier)) && outs.every((c) => !index.has(lc(c)));
      if (ok) {
        spent.add(lc(nullifier));
        for (const c of outs) await insert(c);
      }
      receipts.set(hash, ok ? "success" : "reverted");
      return hash;
    },
    chain: {
      isSpent: async (nf) => spent.has(lc(nf)),
      isCommitmentSeen: async (c) => index.has(lc(c)),
      pathForCommitment: async (c) => (index.has(lc(c)) ? tree.path(index.get(lc(c))) : null),
      waitForReceipt: async (hash) => ({ status: receipts.get(hash) ?? "reverted" }),
    },
  };
}

/** A payer note in the pool, a sealed payment to `payee`, broadcast into the pool. */
async function paidPool(payee, { broadcast = true, secret = 4242n, noteAmount = 1000n, price = 400n } = {}) {
  const pool = mockPool();
  await pool.insert(fieldToHex(await noteCommitmentPoseidon(7n, 5n, STABLE))); // a decoy leaf
  const c = fieldToHex(await noteCommitmentPoseidon(secret, noteAmount, STABLE));
  await pool.insert(c);
  const req = buildGloamPaymentRequirements({ amountWei: price, asset: STABLE, assetSymbol: "USD", payTo: payee.tag, resource: "r", network: NETWORK });
  const built = await buildGloamPayment({
    requirements: req,
    senderSecretHex: fieldToHex(secret),
    senderNoteAmountWei: noteAmount,
    path: await pool.chain.pathForCommitment(c),
    prove: stubProve,
  });
  if (broadcast) {
    const hash = await pool.transfer(built.intent.exec.args);
    assert((await pool.chain.waitForReceipt(hash)).status === "success", "payer's transfer lands");
    built.payload.payload.txHash = hash;
  }
  return { pool, req, built };
}

const submitTo = (pool, log = []) => async (intent) => {
  log.push("submit");
  return pool.transfer(transferCallArgs(intent));
};

const payee = await generateReceiveKey();
const stranger = await generateReceiveKey();

// ── 1. happy path: open, verify, sweep, final ─────────────────────────────────
{
  const { pool, req, built } = await paidPool(payee);
  const verifyOnly = verifyGloamPayment({ requirements: req, payload: built.payload, note: await openGloamPaymentNote(built.payload.payload.paymentNote, payee) });
  assert(verifyOnly.ok && verifyOnly.final === false && verifyOnly.finality === GLOAM_NOT_FINAL, "verify without a sweep is ok but not final");

  const order = [];
  const r = await settleGloamPayment({
    requirements: req,
    payload: built.payload,
    receiveKey: payee,
    prove: stubProve,
    chain: pool.chain,
    submit: submitTo(pool, order),
    beforeSubmit: (fresh) => order.push(`stored ${fresh.commitment}`),
  });
  assert(r.grantAccess === true && r.final === true && r.status === "swept", `settle grants access after the sweep (${r.reason})`);
  assert(order[0].startsWith("stored ") && order[1] === "submit", "the fresh note is handed over for storage before the sweep is submitted");
  assert(r.freshNote && r.freshNote.amountWei === "400", "fresh note carries the whole payment");
  assert(r.freshNote.secret !== built.paymentNote.secret, "fresh note has a new secret the payer never saw");
  assert(await pool.chain.isCommitmentSeen(r.freshNote.commitment), "fresh note is in the pool");
  const payNullifier = fieldToHex(await noteNullifierPoseidon(hexToField(built.paymentNote.secret), hexToField(built.paymentNote.commitment)));
  assert(await pool.chain.isSpent(payNullifier), "the received note is now spent by the payee");
  assert(r.sweep.hash && r.verify.ok, "result carries the sweep hash and the verify");

  // The payer tries to spend the payment back after being served: the pool refuses.
  const back = await buildPrivateSendIntent({
    secretHex: built.paymentNote.secret, amountInWei: 400n, amountPayWei: 400n, asset: STABLE,
    path: await pool.chain.pathForCommitment(built.paymentNote.commitment), prove: stubProve, poolAddress: SEALED_VAULT, chainId: NETWORK,
  });
  const h = await pool.transfer(back.exec.args);
  assert((await pool.chain.waitForReceipt(h)).status === "reverted", "after the sweep the payer cannot spend the payment back");

  // Replaying the same X-PAYMENT header cannot buy a second access.
  const again = await settleGloamPayment({ requirements: req, payload: built.payload, receiveKey: payee, prove: stubProve, chain: pool.chain, submit: submitTo(pool) });
  assert(again.grantAccess === false && again.status === "already_spent", "a replayed header is refused");
}

// ── 2. payer spends the note back before the payee sweeps ─────────────────────
{
  const { pool, req, built } = await paidPool(payee);
  const back = await buildPrivateSendIntent({
    secretHex: built.paymentNote.secret, amountInWei: 400n, amountPayWei: 400n, asset: STABLE,
    path: await pool.chain.pathForCommitment(built.paymentNote.commitment), prove: stubProve, poolAddress: SEALED_VAULT, chainId: NETWORK,
  });
  await pool.transfer(back.exec.args);
  const log = [];
  let stored = 0;
  const r = await settleGloamPayment({
    requirements: req, payload: built.payload, receiveKey: payee, prove: stubProve, chain: pool.chain,
    submit: submitTo(pool, log), beforeSubmit: () => stored++,
  });
  assert(r.grantAccess === false && r.status === "already_spent", "refused: the nullifier is already spent");
  assert(/do not grant access/.test(r.reason), "the reason says not to grant access");
  assert(log.length === 0 && stored === 0, "nothing proved, stored or submitted");
  assert(r.freshNote === null, "no fresh note");
}

// ── 3. payer front-runs the sweep (spends it between check and submit) ────────
{
  const { pool, req, built } = await paidPool(payee);
  const frontRun = async (intent) => {
    const back = await buildPrivateSendIntent({
      secretHex: built.paymentNote.secret, amountInWei: 400n, amountPayWei: 400n, asset: STABLE,
      path: await pool.chain.pathForCommitment(built.paymentNote.commitment), prove: stubProve, poolAddress: SEALED_VAULT, chainId: NETWORK,
    });
    await pool.transfer(back.exec.args);
    return pool.transfer(transferCallArgs(intent));
  };
  const r = await settleGloamPayment({ requirements: req, payload: built.payload, receiveKey: payee, prove: stubProve, chain: pool.chain, submit: frontRun });
  assert(r.grantAccess === false && r.status === "already_spent", "a sweep that loses the race is refused");
  assert(r.sweep.hash !== null, "the reverted sweep's hash is reported");
}

// ── 4. payment never landed ───────────────────────────────────────────────────
{
  const { pool, req, built } = await paidPool(payee, { broadcast: false });
  const r = await settleGloamPayment({ requirements: req, payload: built.payload, receiveKey: payee, prove: stubProve, chain: pool.chain, submit: submitTo(pool) });
  assert(r.grantAccess === false && r.status === "not_settled", "a payment that is not in the pool is not settled");
}

// ── 5. wrong key, wrong tag, lying note ───────────────────────────────────────
{
  const { pool, req, built } = await paidPool(payee);
  const wrongKey = await settleGloamPayment({ requirements: req, payload: built.payload, receiveKey: stranger.privateJwk, prove: stubProve, chain: pool.chain, submit: submitTo(pool) });
  assert(wrongKey.status === "rejected" && /different receive tag/.test(wrongKey.reason), "another key cannot settle the payment");
  const wrongTag = await settleGloamPayment({ requirements: req, payload: built.payload, receiveKey: stranger, prove: stubProve, chain: pool.chain, submit: submitTo(pool) });
  assert(wrongTag.status === "rejected" && /different receive tag/.test(wrongTag.reason), "a key for another tag is refused up front");

  const note = await openGloamPaymentNote(built.payload.payload.paymentNote, payee);
  const lying = await sweepReceivedNote({
    note: { ...note, amountWei: "4000" }, poolAddress: SEALED_VAULT, chainId: NETWORK, prove: stubProve, chain: pool.chain, submit: submitTo(pool),
  });
  assert(lying.status === "bad_note" && !lying.final, "a note whose amount does not bind is refused");
  // amount + p hashes to the same commitment, and the sweep proof would be valid (the
  // circuit sees the reduced amount), but the fresh note would claim amount + p.
  const sent = [];
  const alias = await sweepReceivedNote({
    note: { ...note, amountWei: (BigInt(note.amountWei) + FIELD_PRIME).toString() }, poolAddress: SEALED_VAULT, chainId: NETWORK, prove: stubProve, chain: pool.chain, submit: submitTo(pool, sent),
  });
  assert(alias.status === "bad_note" && !alias.final && alias.freshNote === null, "a note claiming amount + p is refused");
  assert(sent.length === 0, "nothing is submitted for it");
}

// ── 6. submit failures ────────────────────────────────────────────────────────
{
  const { pool, req, built } = await paidPool(payee);
  const note = await openGloamPaymentNote(built.payload.payload.paymentNote, payee);
  const base = { note, poolAddress: SEALED_VAULT, chainId: NETWORK, prove: stubProve, chain: pool.chain };

  const down = await sweepReceivedNote({ ...base, submit: async () => { throw new Error("relay is down"); } });
  assert(down.status === "failed" && down.final === false && /relay is down/.test(down.reason), "a submit that fails moves nothing and says why");
  assert(down.freshNote === null, "nothing to keep when nothing was sent");

  // Sent and landed, but the receipt was lost: the chain says it landed.
  const lost = await sweepReceivedNote({
    ...base,
    chain: { ...pool.chain, waitForReceipt: async () => { throw new Error("timeout"); } },
    submit: submitTo(pool),
  });
  assert(lost.status === "swept" && lost.final === true, "a sweep that landed counts even if its receipt was lost");

  // Sent, not landed, not spent: unknown, keep the fresh note.
  const { pool: pool2, built: built2 } = await paidPool(payee);
  const note2 = await openGloamPaymentNote(built2.payload.payload.paymentNote, payee);
  const pending = await sweepReceivedNote({
    note: note2, poolAddress: SEALED_VAULT, chainId: NETWORK, prove: stubProve,
    chain: { ...pool2.chain, waitForReceipt: async () => { throw new Error("timeout"); } },
    submit: async () => "0x" + "ab".repeat(32),
  });
  assert(pending.status === "unconfirmed" && pending.final === false && pending.freshNote, "an unknown outcome is unconfirmed and keeps the fresh note");
  void req;
}

// ── 7. the zero-change sweep is a valid transfer proof ────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const circuits = join(here, "../../../app/public/circuits");
const vkeyPath = join(here, "../../../contracts/circuits/build/transfer_v2/transfer_vkey.json");
let proved = 0;
if (existsSync(join(circuits, "transfer_final.zkey")) && existsSync(vkeyPath)) {
  const snarkjs = await import("snarkjs");
  const vkey = JSON.parse(readFileSync(vkeyPath, "utf8"));
  const { pool, req, built } = await paidPool(payee);
  let signals = null;
  const realProve = async (input) => {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, join(circuits, "transfer.wasm"), join(circuits, "transfer_final.zkey"));
    assert(await snarkjs.groth16.verify(vkey, publicSignals, proof), "sweep proof verifies against the transfer vkey");
    signals = publicSignals;
    proved++;
    return { proofBytes: packGroth16Proof(proof), publicSignals };
  };
  const r = await settleGloamPayment({ requirements: req, payload: built.payload, receiveKey: payee, prove: realProve, chain: pool.chain, submit: submitTo(pool) });
  assert(r.final === true, "settles with a real proof");
  assert(BigInt(signals[2]) === hexToField(r.freshNote.commitment), "proof's first output is the fresh payee note");
  const payNullifier = await noteNullifierPoseidon(hexToField(built.paymentNote.secret), hexToField(built.paymentNote.commitment));
  assert(BigInt(signals[1]) === payNullifier, "proof spends the received payment note");
  globalThis.curve_bn128?.terminate?.();
}

console.log(`sweep.selftest: ok (${checks} assertions${proved ? `, ${proved} real sweep proof verified` : ", transfer artifacts absent: proving skipped"})`);
process.exit(0);
