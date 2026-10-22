/**
 * Self-test: reading a payment code out of whatever was pasted (lib/notePackage).
 *
 *  - the whole claim link, the dot written %2E, a code inside a message
 *  - a code an email or chat broke over lines or with a space
 *  - a cut-off code followed by other words is refused, never misread
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-claim-codes.mts
 */
import assert from "node:assert/strict";
import { buildNotePackage, decodeNotePackage, encodeNotePackage } from "../src/lib/notePackage";

const pack = buildNotePackage({
  pool: "0x39e28cde55cab798874746ac52cb4b5cc99a0194",
  asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  amountWei: "5000000",
  secret: `0x${"12".repeat(31)}`,
  commitment: `0x${"34".repeat(32)}`,
  note: "Salary",
} as Parameters<typeof buildNotePackage>[0]);
const code = encodeNotePackage(pack);

const reads: [string, string][] = [
  ["the code", code],
  ["the whole link, dot as %2E", `https://www.gloam.trade/claim?net=robinhood-mainnet#claim=${code.replace(".", "%2E")}`],
  ["inside a message", `Here is your pay ${code} thanks`],
  ["broken over a line", `${code.slice(0, 40)}\n${code.slice(40)}`],
  ["broken twice, then a word", `${code.slice(0, 30)}\r\n${code.slice(30, 70)} \n${code.slice(70)}\nThanks!`],
  ["a space inside", `${code.slice(0, 50)} ${code.slice(50)}`],
];
let n = 0;
for (const [label, text] of reads) {
  const got = await decodeNotePackage(text);
  assert.equal(got.secret, pack.secret, label);
  assert.equal(got.amountWei, pack.amountWei, label);
  n++;
}
await assert.rejects(decodeNotePackage(`${code.slice(0, 40)}\nHello there`), "a cut-off code is refused");
n++;
console.log(`${n} claim-code checks passed`);
