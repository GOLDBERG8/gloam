/**
 * Self-test: typed amounts are read without guessing (lib/amountText). A typed
 * "1,25" never becomes 125 and "-1" never becomes 1, in the request form, every
 * amount field (parseAssetAmount, safeParseUnits) and the payroll CSV. Review
 * finding 1, 23 Oct 2026.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-amount-text.mts
 */
import assert from "node:assert/strict";
import "./browser-shim.mjs";

const { readAmountText, amountTextError } = await import("../src/lib/amountText");
const { parseAssetAmount } = await import("../src/lib/shield");
const { safeParseUnits, safeParseEther } = await import("../src/lib/amount");
const { normalizeRequestAmount } = await import("../src/lib/paymentRequest");
const { parsePayrollCsv } = await import("../src/lib/payroll");

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

// any address with no known token reads as 18 decimals; USDG on mainnet has 6
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const usdg = { decimals: 6, symbol: "USDG" };

test("a decimal comma is refused, never read as thousands", () => {
  const r = readAmountText("1,25");
  assert.equal(r.ok, false);
  assert.match(amountTextError("1,25")!, /dot for decimals/);
  assert.equal(parseAssetAmount("1,25", USDG), null, "not 125");
  assert.equal(safeParseUnits("1,25", 6), null);
  assert.ok("error" in normalizeRequestAmount("1,25", usdg), "the request form refuses it");
  assert.equal(readAmountText("0,5").ok, false);
  assert.equal(readAmountText("1,2,5").ok, false);
});

test("a minus sign is refused, never dropped", () => {
  assert.match(amountTextError("-1")!, /negative/);
  assert.equal(parseAssetAmount("-1", USDG), null, "not 1");
  assert.equal(safeParseEther("-1"), null);
  assert.ok("error" in normalizeRequestAmount("-1", usdg));
  assert.equal(readAmountText("1-0").ok, false);
});

test("thousands separators in groups of three still work", () => {
  assert.deepEqual(readAmountText("1,250"), { ok: true, text: "1250" });
  assert.deepEqual(readAmountText("12,500.75"), { ok: true, text: "12500.75" });
  assert.deepEqual(readAmountText("1,000,000"), { ok: true, text: "1000000" });
  assert.equal(parseAssetAmount("1,250", USDG), 1_250_000_000n);
  assert.deepEqual(normalizeRequestAmount("1,250", usdg), { value: "1250" });
});

test("plain amounts read as typed", () => {
  assert.deepEqual(readAmountText("1.25"), { ok: true, text: "1.25" });
  assert.deepEqual(readAmountText(".5"), { ok: true, text: ".5" });
  assert.deepEqual(readAmountText(" 42 "), { ok: true, text: "42" });
  assert.deepEqual(readAmountText("7."), { ok: true, text: "7" }, "a trailing dot while typing");
  assert.deepEqual(readAmountText(""), { ok: true, text: "" });
  assert.equal(parseAssetAmount("1.25", USDG), 1_250_000n);
  assert.deepEqual(normalizeRequestAmount("1.25", usdg), { value: "1.25" });
});

test("letters, exponents and extra dots are refused", () => {
  assert.match(amountTextError("1e5")!, /numbers only/);
  assert.match(amountTextError("12abc")!, /numbers only/);
  assert.match(amountTextError("1.2.3")!, /one dot/);
  assert.equal(parseAssetAmount("1e5", USDG), null);
});

test("more decimals than the asset has is refused, never clipped", () => {
  assert.match(amountTextError("1.1234567", 6)!, /6 decimal places/);
  assert.equal(parseAssetAmount("1.1234567", USDG), null);
  assert.equal(safeParseUnits("1.1234567", 6), null, "no longer quietly cut to 1.123456");
  assert.equal(safeParseUnits("1.123456", 6), 1_123_456n);
});

test("payroll CSV rows with a decimal comma or a minus become row errors", () => {
  const { rows } = parsePayrollCsv('name,amount\nAda,"1,25"\nBola,-1\nChi,"1,250"\nDayo,2.5', USDG as `0x${string}`);
  assert.equal(rows.length, 4);
  assert.match(rows[0]!.error ?? "", /dot for decimals/);
  assert.equal(rows[0]!.amount, null);
  assert.match(rows[1]!.error ?? "", /negative/);
  assert.equal(rows[1]!.amount, null);
  assert.equal(rows[2]!.error, null);
  assert.equal(rows[2]!.amount, 1_250_000_000n);
  assert.equal(rows[3]!.error, null);
  assert.equal(rows[3]!.amount, 2_500_000n);
});

console.log(`\namount text: ${passed} passed`);
