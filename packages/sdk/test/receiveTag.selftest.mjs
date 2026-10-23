/**
 * Receive tags and sealed payment notes.
 *
 * A payment note is a bearer secret, so an x402 payment carries it sealed to
 * the payee's receive tag (gloamr1.…): only the payee's key opens it. Checks the
 * seal round trip, that a different key cannot open it, that payTo must be a
 * real receive tag (refused before any proving), the explicit legacy escape
 * hatch, the gloam1. note package format, and byte compatibility with the Gloam
 * app's own receive-tag code (when this Node can load the app's TypeScript).
 *
 * Run after build:  node test/receiveTag.selftest.mjs
 */
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  generateReceiveKey,
  isReceiveTag,
  assertReceiveTag,
  sealToReceiveTag,
  openSealedTicket,
  isSealedTicket,
  encodeNotePackage,
  decodeNotePackage,
  notePackageToExport,
  openGloamPaymentNote,
  buildGloamPaymentRequirements,
  buildGloamPayment,
  verifyGloamPayment,
  decodePaymentNote,
  IncrementalMerkleTreePoseidon,
  noteCommitmentPoseidon,
  noteNullifierPoseidon,
  fieldToHex,
  FIELD_PRIME,
  GLOAM_X402_SCHEME,
  GLOAM_X402_VERSION,
  GLOAM_VS_ZONE,
  SEALED_VAULT,
  RECEIVE_TAG_PREFIX,
} from "../dist/index.js";

let checks = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  checks++;
}
async function rejects(fn, re, msg) {
  try {
    await fn();
  } catch (e) {
    assert(!re || re.test(e.message), `${msg} (message: ${e.message})`);
    return;
  }
  assert(false, `${msg} (did not throw)`);
}
const b64url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── tags ──────────────────────────────────────────────────────────────────────
const payee = await generateReceiveKey();
const other = await generateReceiveKey();
assert(payee.tag.startsWith(RECEIVE_TAG_PREFIX), "tag has the gloamr1. prefix");
assert(isReceiveTag(payee.tag), "a generated tag is a receive tag");
assert(payee.privateJwk.d && payee.privateJwk.crv === "P-256", "private half is a P-256 JWK");
assert(!payee.tag.includes(payee.privateJwk.d), "the tag does not contain the private key");
for (const bad of [
  "gloam:rcpt:demo-payee",
  "gloamr1.payee-tag-for-tests",
  "gloamr1." + b64url(new Uint8Array(91).fill(7)), // right length, not a P-256 key
  "gloamr1." + payee.tag.slice(8, 60), // truncated
  "0x000000000000000000000000000000000000dEaD",
  "",
]) {
  assert(!isReceiveTag(bad), `not a receive tag: ${bad.slice(0, 30)}`);
}
await rejects(() => assertReceiveTag("gloam:rcpt:x"), /must be a Gloam receive tag \(gloamr1/, "assertReceiveTag explains what a tag is");

// ── seal / open ───────────────────────────────────────────────────────────────
const plain = "gloam1.hello / ünïcödé / " + "x".repeat(300);
const sealed = await sealToReceiveTag(plain, payee.tag);
assert(isSealedTicket(sealed) && sealed.startsWith("gloam2t."), "sealed ticket has the gloam2t. prefix");
assert(!sealed.includes("hello"), "sealed ticket hides the plaintext");
assert((await openSealedTicket(sealed, payee)) === plain, "payee's key opens the ticket");
assert((await openSealedTicket(sealed, payee.privateJwk)) === plain, "a bare JWK opens it too");
await rejects(() => openSealedTicket(sealed, other), /different receive tag/, "another key cannot open it");
assert((await sealToReceiveTag(plain, payee.tag)) !== sealed, "each seal is fresh (ephemeral key + iv)");
await rejects(() => sealToReceiveTag(plain, "gloam:rcpt:x"), /receive tag/, "cannot seal to a non-tag");
// The plaintext is padded to a 512-byte step, so a ticket's length does not show
// how large the amount is or how long the note is.
{
  const sealedFor = async (amountWei, note) =>
    sealToReceiveTag(encodeNotePackage({ pool: SEALED_VAULT, asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", amountWei, secret: fieldToHex(7n), commitment: fieldToHex(8n), note }), payee.tag);
  const sizes = new Set();
  for (const [w, n] of [["1", undefined], ["10000", undefined], ["100000000000", undefined], ["1", "Invoice 042"], ["25000000", "agent:42"]]) {
    const t = await sealedFor(w, n);
    sizes.add(t.length);
    const opened = await openSealedTicket(t, payee);
    assert(opened === encodeNotePackage({ pool: SEALED_VAULT, asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", amountWei: w, secret: fieldToHex(7n), commitment: fieldToHex(8n), note: n }), "a padded ticket opens to the exact package");
  }
  assert(sizes.size === 1, `small and large amounts, with or without a short note, seal to one length (got ${[...sizes].join(", ")})`);
  const largest = await sealedFor(((1n << 128n) - 1n).toString(), "\u{1F600}".repeat(20) + "x".repeat(60));
  assert(largest.length <= 1714, `the largest ticket stays within what the board and the relay take (${largest.length} bytes)`);
}
// tamper one ciphertext byte: AES-GCM rejects it
const flip = sealed.slice(0, -3) + (sealed.at(-3) === "A" ? "B" : "A") + sealed.slice(-2);
await rejects(() => openSealedTicket(flip, payee), null, "a tampered ticket does not open");

// ── note package format (same bytes as the app) ───────────────────────────────
const STABLE = "0x00000000000000000000000000000000000000ee";
const pkg = { pool: SEALED_VAULT, asset: STABLE, amountWei: "250", secret: fieldToHex(99n), commitment: fieldToHex(await noteCommitmentPoseidon(99n, 250n, STABLE)) };
const expected =
  "gloam1." +
  b64url(Buffer.from(JSON.stringify({ v: 1, t: "gloam-private-note", s: "poseidon", p: pkg.pool, a: pkg.asset, w: pkg.amountWei, k: pkg.secret, c: pkg.commitment })));
assert(encodeNotePackage(pkg) === expected, "gloam1. package is byte-identical to the app's compact form");
const back = decodeNotePackage(expected);
assert(back.secret === pkg.secret && back.amountWei === "250" && back.pool === SEALED_VAULT, "gloam1. package decodes");
// The app may add a private note under "n"; it must not break decoding.
const withNote = "gloam1." + b64url(Buffer.from(JSON.stringify({ v: 1, t: "gloam-private-note", s: "poseidon", p: pkg.pool, a: pkg.asset, w: "250", k: pkg.secret, c: pkg.commitment, n: "Invoice 042" })));
assert(decodeNotePackage(withNote).secret === pkg.secret, "a package with the app's optional note still decodes");
const exp = await notePackageToExport(back);
assert(exp.nullifier === fieldToHex(await noteNullifierPoseidon(99n, BigInt(pkg.commitment))), "export derives the nullifier");

// Only canonical fields decode. Poseidon reads its inputs mod p, so a package
// claiming 250 + p (or secret + p) opens the same commitment as the real one.
const rawPack = (over) => "gloam1." + b64url(Buffer.from(JSON.stringify({ v: 1, t: "gloam-private-note", s: "poseidon", p: pkg.pool, a: pkg.asset, w: "250", k: pkg.secret, c: pkg.commitment, ...over })));
for (const [over, why] of [
  [{ w: (250n + FIELD_PRIME).toString() }, "an amount of real + p"],
  [{ w: (1n << 128n).toString() }, "an amount of 2^128 (the circuits' range check)"],
  [{ w: "0x10" }, "an amount in hex"],
  [{ w: "-1" }, "a negative amount"],
  [{ k: fieldToHex(99n + FIELD_PRIME) }, "a secret of real + p"],
  [{ k: "0x" + "0".repeat(65) + "1" }, "a secret longer than 32 bytes"],
  [{ c: fieldToHex(BigInt(pkg.commitment) + FIELD_PRIME) }, "a commitment of real + p"],
  [{ a: "0x" + (BigInt(STABLE) + FIELD_PRIME).toString(16) }, "an asset of real + p"],
  [{ a: "not-hex" }, "an asset that is not an address"],
]) {
  await rejects(async () => decodeNotePackage(rawPack(over)), /Not a valid Gloam note package/, `decode refuses ${why}`);
}
assert(decodeNotePackage(rawPack({ w: ((1n << 128n) - 1n).toString() })).amountWei === ((1n << 128n) - 1n).toString(), "the largest amount the circuits take still decodes");

// ── x402: payTo must be a receive tag ─────────────────────────────────────────
const SECRET = 4242n, NOTE_AMOUNT = 1000n, PRICE = 400n;
const tree = new IncrementalMerkleTreePoseidon();
await tree.insert(await noteCommitmentPoseidon(SECRET, NOTE_AMOUNT, STABLE));
const path = await tree.path(0);
await rejects(
  async () => buildGloamPaymentRequirements({ amountWei: PRICE, asset: STABLE, payTo: "gloam:rcpt:demo", resource: "r" }),
  /payTo must be a Gloam receive tag/,
  "requirements refuse a payTo that is not a receive tag"
);
// A requirements object from an older server, built by hand with a non-tag payTo.
const legacyReq = {
  x402Version: GLOAM_X402_VERSION, scheme: GLOAM_X402_SCHEME, network: 46630, maxAmountRequired: PRICE.toString(),
  asset: STABLE, assetSymbol: "USD", payTo: "gloam:rcpt:demo", resource: "r", description: "d",
  poolAddress: SEALED_VAULT, maxTimeoutSeconds: 120, privacy: GLOAM_VS_ZONE,
};
let proved = 0;
const countingProve = async () => (proved++, { proofBytes: "0xdeadbeef" });
await rejects(
  () => buildGloamPayment({ requirements: legacyReq, senderSecretHex: fieldToHex(SECRET), senderNoteAmountWei: NOTE_AMOUNT, path, prove: countingProve }),
  /requirements\.payTo must be a Gloam receive tag/,
  "the payer refuses a payTo that is not a receive tag"
);
assert(proved === 0, "refused before any proving");
// The explicit legacy escape hatch: plain note in the header (unsafe, documented).
const legacy = await buildGloamPayment({ requirements: legacyReq, senderSecretHex: fieldToHex(SECRET), senderNoteAmountWei: NOTE_AMOUNT, path, prove: countingProve, legacyUnsealed: true });
assert(legacy.sealed === false && legacy.payload.payload.paymentNote.startsWith("gloamnote1:"), "legacyUnsealed sends a plain note");
assert(decodePaymentNote(legacy.payload.payload.paymentNote).secret === legacy.paymentNote.secret, "plain note is readable by anyone (why it is unsafe)");
const vLegacy = verifyGloamPayment({ requirements: legacyReq, payload: legacy.payload });
assert(vLegacy.ok === true && vLegacy.sealed === false && vLegacy.final === false, "a plain note still verifies, never final");
// Sealed payment: only the payee opens it, and the header never carries the secret.
const req = buildGloamPaymentRequirements({ amountWei: PRICE, asset: STABLE, assetSymbol: "USD", payTo: payee.tag, resource: "r" });
const built = await buildGloamPayment({ requirements: req, senderSecretHex: fieldToHex(SECRET), senderNoteAmountWei: NOTE_AMOUNT, path, prove: countingProve });
const secretHex = built.paymentNote.secret.slice(2).toLowerCase();
assert(!built.header.toLowerCase().includes(secretHex), "header does not contain the payment note secret");
assert(!JSON.stringify(built.payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).toLowerCase().includes(secretHex), "payload does not contain the payment note secret");
await rejects(() => openGloamPaymentNote(built.payload.payload.paymentNote), /sealed/, "a sealed note needs the receive key");
await rejects(() => openGloamPaymentNote(built.payload.payload.paymentNote, other), /different receive tag/, "someone else's key cannot open the payment");
const opened = await openGloamPaymentNote(built.payload.payload.paymentNote, payee);
assert(opened.secret === built.paymentNote.secret && opened.nullifier === built.paymentNote.nullifier, "payee opens the exact payment note");
assert(opened.pool === SEALED_VAULT, "opened note names its pool");

// ── byte compatibility with the app's receiveTag.ts ───────────────────────────
// Node 22.6+ can load the app's TypeScript directly (type stripping). On older
// Node this part is skipped; the format checks above still ran.
let appChecked = false;
const appFile = join(dirname(fileURLToPath(import.meta.url)), "../../../app/src/lib/receiveTag.ts");
if (existsSync(appFile)) {
  let app = null;
  try {
    process.removeAllListeners("warning"); // Node notes it is reparsing the app file as ESM
    app = await import(pathToFileURL(appFile).href);
  } catch {
    app = null;
  }
  if (app?.encryptTicketForTag) {
    const store = new Map();
    globalThis.window = globalThis;
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    // The app's browser identity, holding the SDK-generated key.
    store.set("gloam.receive.identity.v1", JSON.stringify({ v: 1, createdAt: 1, privateJwk: payee.privateJwk, publicSpkiB64: payee.tag.slice(RECEIVE_TAG_PREFIX.length) }));
    assert((await app.getOrCreateReceiveIdentity()).tag === payee.tag, "app reads the same tag from the same key");
    assert((await app.decryptTicketWithLocalTag(sealed)).trimEnd() === plain, "the app opens a ticket the SDK sealed");
    assert((await app.decryptTicketWithLocalTag(built.payload.payload.paymentNote)).startsWith("gloam1."), "the app opens an x402 payment note as a gloam1. package");
    const fromApp = await app.encryptTicketForTag(plain, payee.tag);
    assert((await openSealedTicket(fromApp, payee)) === plain, "the SDK opens a ticket the app sealed");
    store.clear();
    const appTag = (await app.getOrCreateReceiveIdentity()).tag;
    assert(isReceiveTag(appTag), "a tag the app generates passes the SDK's receive-tag check");
    appChecked = true;
  }
}

console.log(`receiveTag.selftest: ok (${checks} assertions${appChecked ? ", app byte-compat checked" : ", app byte-compat skipped on this Node"})`);
