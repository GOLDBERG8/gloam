/**
 * Self-test: a Gloam address (gloamr1.<P-256 key>) is decoded in full before
 * it is accepted (lib/receiveTag isValidReceiveTag). "gloamr1.", "gloamr1.invalid"
 * and a truncated address are refused in a payroll row, a payment request and
 * the send form's check. Review finding 8, 23 Oct 2026.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-receive-tag.mts
 */
import assert from "node:assert/strict";
import "./browser-shim.mjs";

const { isValidReceiveTag, RECEIVE_TAG_PREFIX } = await import("../src/lib/receiveTag");
const { isValidRequestTag } = await import("../src/lib/paymentRequest");
const { parsePayrollCsv } = await import("../src/lib/payroll");

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** A real Gloam address, made the way the app makes one. */
async function realTag(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return RECEIVE_TAG_PREFIX + Buffer.from(spki).toString("base64url");
}

const good = await realTag();
const other = await realTag();
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`;

test("a real Gloam address passes", () => {
  assert.equal(isValidReceiveTag(good), true);
  assert.equal(isValidReceiveTag(`  ${good}  `), true);
  assert.equal(isValidRequestTag(good), true);
});

test("the prefix alone, junk after it, or a cut-off address is refused", () => {
  for (const bad of ["gloamr1.", "gloamr1.invalid", good.slice(0, -10), `${good}AAAA`, good.replace("gloamr1.", "gloamr2.")]) {
    assert.equal(isValidReceiveTag(bad), false, bad.slice(0, 24));
    assert.equal(isValidRequestTag(bad), false);
  }
  // the right length but not a P-256 key
  assert.equal(isValidReceiveTag(RECEIVE_TAG_PREFIX + "A".repeat(122)), false);
});

test("payroll rows with a broken Gloam address are errors in the preview", () => {
  const csv = `name,gloam_address,amount\nAda,gloamr1.invalid,10\nBola,gloamr1.,10\nChi,${good},10\nDayo,${other},5\nEke,,3`;
  const { rows } = parsePayrollCsv(csv, USDG);
  assert.equal(rows.length, 5);
  assert.match(rows[0]!.error ?? "", /incomplete or mistyped/);
  assert.match(rows[1]!.error ?? "", /incomplete or mistyped/);
  assert.notEqual(rows[0]!.kind, "gloam");
  assert.equal(rows[2]!.error, null);
  assert.equal(rows[2]!.kind, "gloam");
  assert.equal(rows[3]!.kind, "gloam");
  assert.equal(rows[4]!.kind, "link", "a blank address still means a claim link");
});

console.log(`\nreceive tag: ${passed} passed`);
