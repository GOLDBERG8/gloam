/**
 * Self-test: reading a payment code out of whatever was pasted (lib/notePackage).
 *
 *  - the whole claim link, the dot written %2E, a code inside a message
 *  - a code an email or chat broke over lines or with a space
 *  - a cut-off code followed by other words is refused, never misread
 *  - a code is claimed only on its own network, though both mainnet vaults share an address
 *  - an amount the circuits cannot hold (2^128 or more, amount + p) is refused
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-claim-codes.mts
 */
import assert from "node:assert/strict";
import { buildNotePackage, decodeNotePackage, encodeNotePackage, encodeNotePackageEncrypted, paymentCodeIn } from "../src/lib/notePackage";
import { appClaimPath, claimLinkFor, codeFromHash } from "../src/lib/claimLink";
import { isClaimLink } from "../src/lib/funnel";
import { getNetwork } from "../src/lib/networks";
import { claimNetworkProblem } from "../src/lib/paymentRequest";

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

// Links carry only letters, digits and "=" after "#claim=": WhatsApp ended
// links at a ".", a "%2E" and a "-" there.
const link = claimLinkFor(code, "robinhood-mainnet");
const frag = link.slice(link.indexOf("#"));
assert.match(frag, /^#claim=gloam1=[A-Za-z0-9=]+$/, "the link's code is letters, digits and =");
assert.equal(codeFromHash(frag), code, "the link reads back as the code");
assert.ok(isClaimLink(codeFromHash(frag)!) && isClaimLink(frag.slice(7)), "both spellings count as claim links");
assert.equal((await decodeNotePackage(link)).secret, pack.secret, "the whole new link claims");
assert.equal((await decodeNotePackage(frag.slice(7))).secret, pack.secret, "the link's code alone claims");
assert.ok(appClaimPath(code, "robinhood-mainnet").includes("#claim=gloam1="));
n += 6;

// A body with "-", "_" and "." (locked and sealed codes have them) comes back exactly.
for (const odd of ["gloam1e.ab-cd_efQ", "gloam2t.x_y-z.w9", "gloam1.-_.-_"]) {
  const f = claimLinkFor(odd, "tempo-mainnet");
  const h = f.slice(f.indexOf("#"));
  assert.match(h, /^#claim=gloam(1e|2t|1)=[A-Za-z0-9=]+$/, `${odd} links with letters, digits and = only`);
  assert.equal(codeFromHash(h), odd, `${odd} reads back`);
  assert.equal(paymentCodeIn(f), odd, `${odd} reads back from the pasted link`);
  n += 3;
}

// Links sent with a hyphen after the prefix (for a few hours on 22 Oct) still read,
// and so does the text WhatsApp left when it cut one at the hyphen.
const dashLink = `https://www.gloam.trade/claim?net=robinhood-mainnet#claim=${code.replace(".", "-")}`;
assert.equal(codeFromHash(dashLink.slice(dashLink.indexOf("#"))), code);
assert.equal((await decodeNotePackage(dashLink)).secret, pack.secret);
const dashLeft = code.replace(/^gloam1\./, "-");
assert.equal(paymentCodeIn(dashLeft), code, "the text WhatsApp left after a hyphen reads as the code");
assert.equal((await decodeNotePackage(`https://www.gloam.trade/claim?net=robinhood-mainnet#claim=gloam1\n${dashLeft}`)).secret, pack.secret);
n += 4;

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
// The network check: same vault address on both mainnets, so the asset decides.
{
  const rh = getNetwork("robinhood-mainnet");
  const tempo = getNetwork("tempo-mainnet");
  const rhTest = getNetwork("robinhood");
  assert.equal(rh.pool?.toLowerCase(), tempo.pool?.toLowerCase(), "both mainnet vaults share an address");
  const read = await decodeNotePackage(code);
  assert.equal(claimNetworkProblem(rh, read), null, "a USDG code claims on Robinhood Chain");
  assert.match(claimNetworkProblem(tempo, read) ?? "", /different network/, "and not on Tempo");
  assert.match(claimNetworkProblem(rhTest, read) ?? "", /different vault/, "nor on the testnet vault");
  const tempoPack = { pool: tempo.pool!, asset: "0x20c000000000000000000000b9537d11c60e8b50" };
  assert.equal(claimNetworkProblem(tempo, tempoPack), null, "a USDC.e code claims on Tempo");
  assert.match(claimNetworkProblem(rh, tempoPack) ?? "", /different network/, "and not on Robinhood Chain");
  assert.match(claimNetworkProblem(tempo, { asset: read.asset }) ?? "", /different network/, "a code naming no vault");
  assert.equal(claimNetworkProblem(rh, { asset: read.asset.toUpperCase().replace("0X", "0x") }), null, "any case");
  n += 8;
}
// Poseidon reads the amount mod p, so 5000000 + p opens the same note as 5000000.
// Only amounts the circuits hold (below 2^128) read, in every form a code comes in.
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const LIMIT = 1n << 128n;
const legacyJson = (w: string) => JSON.stringify({ v: 1, type: "gloam-private-note", scheme: "poseidon", pool: pack.pool, asset: pack.asset, amountWei: w, secret: pack.secret, commitment: pack.commitment });
for (const w of [(5_000_000n + P).toString(), LIMIT.toString(), "0x10", "-1"]) {
  await assert.rejects(decodeNotePackage(encodeNotePackage({ ...pack, amountWei: w })), `a plain code with amount ${w.slice(0, 12)} is refused`);
  await assert.rejects(decodeNotePackage(legacyJson(w)), `an old JSON package with amount ${w.slice(0, 12)} is refused`);
  n += 2;
}
await assert.rejects(decodeNotePackage(await encodeNotePackageEncrypted({ ...pack, amountWei: (5_000_000n + P).toString() }, "pass phrase"), "pass phrase"), "a locked code with amount + p is refused");
const top = (LIMIT - 1n).toString();
assert.equal((await decodeNotePackage(encodeNotePackage({ ...pack, amountWei: top }))).amountWei, top, "the largest amount the circuits hold still reads");
assert.equal((await decodeNotePackage(await encodeNotePackageEncrypted(pack, "pass phrase"), "pass phrase")).amountWei, pack.amountWei, "a locked code still reads");
n += 3;
console.log(`${n} claim-code checks passed`);
