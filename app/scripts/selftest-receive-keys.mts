/**
 * Self-test: receive keys sealed at rest (lib/receiveTag on lib/noteVault).
 *
 * Runs the app's own storage code with an in-memory localStorage and
 * IndexedDB. Covers: a new key is sealed, never stored as plain JSON; keys an
 * earlier version stored as plain JSON keep working and are sealed on first
 * read; rotation keeps old keys opening; the recovery export and import still
 * round-trip; concurrent first use makes one address, not several; a value
 * that will not open is set aside, not destroyed; and turning a passkey on
 * reseals the keys with the notes. A padded sealed ticket (L-2) opens to the
 * same payment in the app and in the SDK, which both trim the padding.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-receive-keys.mts
 */
import assert from "node:assert/strict";
import { countEvents, localStorage } from "./browser-shim.mjs";

const rt = await import("../src/lib/receiveTag");
const vault = await import("../src/lib/noteVault");
const { b64url, randomBytes } = await import("../src/lib/passkeyWrap");

const ID_KEY = "gloam.receive.identity.v1";
const PREV_KEY = "gloam.receive.identity.prev.v1";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** No private key material anywhere in localStorage, in any form a reader could use. */
function assertNoPlainKeys() {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    const v = localStorage.getItem(k) ?? "";
    if (k.endsWith(".unreadable")) continue;
    assert.ok(!/privateJwk|"d"\s*:/.test(v), `plain key material under ${k}`);
  }
}

/** A key as an earlier version stored it: plain JSON, private half included. */
async function legacyIdentity() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return {
    v: 1 as const,
    createdAt: Date.now() - 86_400_000,
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
    publicSpkiB64: b64url(spki),
  };
}

function clearReceiveSlots() {
  for (const k of [ID_KEY, PREV_KEY, `${ID_KEY}.unreadable`, `${PREV_KEY}.unreadable`]) localStorage.removeItem(k);
}

await test("a new receive key is sealed, never plain JSON", async () => {
  clearReceiveSlots();
  const events = countEvents(rt.RECEIVE_IDENTITY_EVENT);
  const a = await rt.getOrCreateReceiveIdentity();
  assert.ok(a.tag.startsWith("gloamr1."));
  assert.ok(vault.isSealedValue(localStorage.getItem(ID_KEY)), "stored sealed");
  assertNoPlainKeys();
  const b = await rt.getOrCreateReceiveIdentity();
  assert.equal(b.tag, a.tag, "sticky");
  assert.equal(events(), 1, "recovery hears about the new key once");
});

await test("plain JSON keys from an earlier version keep working and get sealed", async () => {
  clearReceiveSlots();
  const cur = await legacyIdentity();
  const old = await legacyIdentity();
  localStorage.setItem(ID_KEY, JSON.stringify(cur));
  localStorage.setItem(PREV_KEY, JSON.stringify([old]));
  // A payment sent to each before the upgrade.
  const toCur = await rt.encryptTicketForTag("gloam1.to-current", `gloamr1.${cur.publicSpkiB64}`);
  const toOld = await rt.encryptTicketForTag("gloam1.to-old", `gloamr1.${old.publicSpkiB64}`);

  const id = await rt.getOrCreateReceiveIdentity();
  assert.equal(id.tag, `gloamr1.${cur.publicSpkiB64}`, "same address, not a new one");
  assert.equal(id.createdAt, cur.createdAt);
  assert.ok(vault.isSealedValue(localStorage.getItem(ID_KEY)), "current sealed");
  assert.ok(vault.isSealedValue(localStorage.getItem(PREV_KEY)), "earlier keys sealed");
  assertNoPlainKeys();
  assert.equal(await rt.decryptTicketWithLocalTag(toCur), "gloam1.to-current");
  assert.equal(await rt.decryptTicketWithLocalTag(toOld), "gloam1.to-old");
  const exported = await rt.exportReceiveKeys();
  assert.equal(exported.current?.publicSpkiB64, cur.publicSpkiB64);
  assert.deepEqual(exported.previous.map((p) => p.publicSpkiB64), [old.publicSpkiB64]);
});

await test("rotating keeps payments to the old address opening", async () => {
  const before = await rt.getOrCreateReceiveIdentity();
  const toBefore = await rt.encryptTicketForTag("gloam1.before", before.tag);
  const after = await rt.rotateReceiveIdentity();
  assert.notEqual(after.tag, before.tag);
  assert.equal((await rt.getOrCreateReceiveIdentity()).tag, after.tag);
  assert.equal(await rt.decryptTicketWithLocalTag(toBefore), "gloam1.before");
  assert.equal(await rt.decryptTicketWithLocalTag(await rt.encryptTicketForTag("gloam1.after", after.tag)), "gloam1.after");
  const { previous } = await rt.exportReceiveKeys();
  assert.ok(previous.some((p) => `gloamr1.${p.publicSpkiB64}` === before.tag));
  assertNoPlainKeys();
});

await test("recovery export and import still round-trip", async () => {
  const backup = JSON.parse(JSON.stringify(await rt.exportReceiveKeys()));
  const tag = (await rt.getOrCreateReceiveIdentity()).tag;
  const ticket = await rt.encryptTicketForTag("gloam1.restored", tag);
  const olderTicket = await rt.encryptTicketForTag(
    "gloam1.restored-older",
    `gloamr1.${backup.previous[0].publicSpkiB64}`
  );
  // A browser that lost its keys, restoring from the backup.
  clearReceiveSlots();
  const fresh = await rt.getOrCreateReceiveIdentity();
  assert.notEqual(fresh.tag, tag);
  await rt.importReceiveKeys(backup);
  assert.equal((await rt.getOrCreateReceiveIdentity()).tag, tag, "the backup's address is current again");
  assert.equal(await rt.decryptTicketWithLocalTag(ticket), "gloam1.restored");
  assert.equal(await rt.decryptTicketWithLocalTag(olderTicket), "gloam1.restored-older");
  const after = await rt.exportReceiveKeys();
  assert.ok(after.previous.some((p) => `gloamr1.${p.publicSpkiB64}` === fresh.tag), "the interim key is kept too");
  assertNoPlainKeys();
});

await test("first use from several places at once makes one address", async () => {
  clearReceiveSlots();
  const tags = await Promise.all(Array.from({ length: 5 }, () => rt.getOrCreateReceiveIdentity()));
  assert.equal(new Set(tags.map((t) => t.tag)).size, 1);
});

await test("a value that will not open is set aside, not destroyed", async () => {
  clearReceiveSlots();
  const damaged = "gloamenc1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  localStorage.setItem(ID_KEY, damaged);
  const id = await rt.getOrCreateReceiveIdentity();
  assert.ok(id.tag.startsWith("gloamr1."));
  assert.deepEqual(JSON.parse(localStorage.getItem(`${ID_KEY}.unreadable`)!), [damaged]);
  await rt.getOrCreateReceiveIdentity();
  assert.equal(JSON.parse(localStorage.getItem(`${ID_KEY}.unreadable`)!).length, 1, "kept once");
});

await test("turning a passkey on reseals the receive keys with the notes", async () => {
  clearReceiveSlots();
  const id = await rt.getOrCreateReceiveIdentity();
  const ticket = await rt.encryptTicketForTag("gloam1.passkey", id.tag);
  const sealedBefore = localStorage.getItem(ID_KEY);
  const prf = randomBytes(32);
  await vault.protectVaultWithPrf({
    credentialId: b64url(randomBytes(16)),
    rpId: "gloam.trade",
    prfSalt: randomBytes(32),
    prfOutput: prf,
  });
  const sealedAfter = localStorage.getItem(ID_KEY);
  assert.ok(vault.isSealedValue(sealedAfter));
  assert.notEqual(sealedAfter, sealedBefore, "resealed under the passkey's data key");
  assert.equal((await rt.getOrCreateReceiveIdentity()).tag, id.tag, "same address");
  assert.equal(await rt.decryptTicketWithLocalTag(ticket), "gloam1.passkey");
  await vault.removeVaultPasskey(prf);
  assert.equal((await rt.getOrCreateReceiveIdentity()).tag, id.tag);
  assertNoPlainKeys();
});

await test("a padded sealed ticket opens to the same payment in the app and in the SDK", async () => {
  const { buildNotePackage, decodeNotePackage, encodeNotePackage } = await import("../src/lib/notePackage");
  const sdk = await import("@gloamtrade/sdk");
  clearReceiveSlots();
  const id = await rt.getOrCreateReceiveIdentity();
  const pack = buildNotePackage({
    pool: "0x39e28cDe55caB798874746aC52Cb4B5Cc99a0194",
    asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    amountWei: "100000000",
    secret: ("0x" + "1f".repeat(32)) as `0x${string}`,
    commitment: ("0x" + "2e".repeat(32)) as `0x${string}`,
    note: "rent",
  });
  const code = encodeNotePackage(pack);
  const sealed = await rt.encryptTicketForTag(code, id.tag);
  assert.equal(await rt.decryptTicketWithLocalTag(sealed), code);
  const inApp = await decodeNotePackage(sealed, undefined, { tryTagDecrypt: true });
  assert.deepEqual([inApp.amountWei, inApp.secret, inApp.commitment, inApp.note], [pack.amountWei, pack.secret, pack.commitment, "rent"]);
  // the SDK opens it to the code, with the padding already off
  const { current } = await rt.exportReceiveKeys();
  const opened = await sdk.openSealedTicket(sealed, current!.privateJwk);
  assert.equal(opened, code);
  const inSdk = sdk.decodeNotePackage(opened);
  assert.deepEqual([inSdk.amountWei, inSdk.secret, inSdk.commitment, inSdk.note], [pack.amountWei, pack.secret, pack.commitment, "rent"]);
  // what a reader gets straight out of AES-GCM: the code, then spaces up to the step
  const raw = code.padEnd(512, " ");
  assert.equal((await decodeNotePackage(raw)).commitment, pack.commitment, "the app's decoder trims it");
  assert.equal(sdk.decodeNotePackage(raw).commitment, pack.commitment, "and so does the SDK's");
});

console.log(`\n${passed} receive-key checks passed`);
