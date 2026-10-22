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
import { buildNotePackage, decodeNotePackage, encodeNotePackage, paymentCodeIn } from "../src/lib/notePackage";
import { appClaimPath, claimLinkFor, codeFromHash } from "../src/lib/claimLink";
import { isClaimLink } from "../src/lib/funnel";

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

// Links carry only characters chat apps keep inside a URL: no "." and no "%2E" after the prefix.
const link = claimLinkFor(code, "robinhood-mainnet");
const frag = link.slice(link.indexOf("#"));
assert.match(frag, /^#claim=gloam1-[A-Za-z0-9_-]+$/, "the link's code is all URL-safe characters");
assert.equal(codeFromHash(frag), code, "the link reads back as the code");
assert.ok(isClaimLink(codeFromHash(frag)!) && isClaimLink(frag.slice(7)), "both spellings count as claim links");
assert.equal((await decodeNotePackage(link)).secret, pack.secret, "the whole new link claims");
assert.equal((await decodeNotePackage(frag.slice(7))).secret, pack.secret, "the hyphen code alone claims");
assert.ok(appClaimPath(code, "robinhood-mainnet").includes("#claim=gloam1-"));
n += 6;

// Links sent before this keep working: the dot, and the dot written %2E.
const oldPct = `https://www.gloam.trade/claim?net=robinhood-mainnet#claim=${code.replace(".", "%2E")}`;
assert.equal(codeFromHash(oldPct.slice(oldPct.indexOf("#"))), code);
assert.equal((await decodeNotePackage(oldPct)).secret, pack.secret);
assert.equal((await decodeNotePackage(`https://www.gloam.trade/claim#claim=${code}`)).secret, pack.secret);
n += 3;

// WhatsApp cut the link at "gloam1" and left the rest as text starting "%2E".
const leftover = code.replace(/^gloam1\./, "%2E");
assert.equal(paymentCodeIn(leftover), code, "the text WhatsApp left over reads as the code");
assert.equal((await decodeNotePackage(leftover)).secret, pack.secret, "and claims");
const whole = `https://www.gloam.trade/claim?net=robinhood-mainnet#claim=gloam1\n${leftover}`;
assert.equal((await decodeNotePackage(whole)).secret, pack.secret, "the whole cut message pasted back claims");
n += 3;
console.log(`${n} claim-code checks passed`);
