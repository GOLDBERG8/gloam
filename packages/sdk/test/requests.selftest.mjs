/**
 * Payment request links: the SDK builds the same link the Gloam app builds and
 * reads (app/src/lib/paymentRequest.ts). Checks the fields and their order, the
 * network and token lookup, amount rules, the 80-character note cap (refused,
 * never trimmed, so an agent ID cannot arrive cut short), and reading a link
 * back. The cross-check against the app's own parser runs in the app's
 * selftest-sdk-request-link.
 *
 * Run after build:  node test/requests.selftest.mjs
 */
import {
  buildPaymentRequestLink,
  parsePaymentRequestLink,
  normalizeRequestAmount,
  generateReceiveKey,
  mainnetNetwork,
  GLOAM_NETWORKS,
  RH_MAINNET_USDG,
  TEMPO_USDCE,
  REQUEST_NOTE_MAX,
  encodeNotePackage,
  decodeNotePackage,
} from "../dist/index.js";

let checks = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  checks++;
}
function throws(fn, re, msg) {
  try {
    fn();
  } catch (e) {
    assert(re.test(e.message), `${msg} (got: ${e.message})`);
    return;
  }
  assert(false, `${msg} (did not throw)`);
}

const { tag } = await generateReceiveKey();
const rh = mainnetNetwork("robinhood");
const tempo = mainnetNetwork("tempo");
assert(rh && tempo, "both mainnets are in this SDK version");

// The app's exact shape: tab and mode in the query, the request in the fragment, fields in order.
const link = buildPaymentRequestLink({ payTo: tag, network: rh, asset: "USDG", amount: "25.50", note: "agent-42" });
const [base, frag] = link.split("#");
assert(base === "https://gloam.trade/app/vault?tab=move&mode=pay", "opens the app's pay screen");
const keys = [...new URLSearchParams(frag).keys()];
assert(keys.join(",") === "to,amount,asset,note,chain", "fields in the app's order");
const read = parsePaymentRequestLink(link);
assert(read.payTo === tag, "payTo reads back");
assert(read.networkKey === "robinhood-mainnet", "the network key is the app's");
assert(read.asset === RH_MAINNET_USDG, "the token is named by its address");
assert(read.amount === "25.5", "the amount is normalized like the app does");
assert(read.note === "agent-42", "the note reads back");

// Network by key or chain id, token by symbol in any case, origin without a trailing slash.
const t = buildPaymentRequestLink({ payTo: tag, network: "tempo-mainnet", asset: "usdc.e", origin: "https://www.gloam.trade/" });
assert(t.startsWith("https://www.gloam.trade/app/vault?"), "custom origin, trailing slash dropped");
assert(parsePaymentRequestLink(t).asset === TEMPO_USDCE && parsePaymentRequestLink(t).amount === null, "no amount means the payer chooses");
assert(parsePaymentRequestLink(buildPaymentRequestLink({ payTo: tag, network: 4217, asset: TEMPO_USDCE })).networkKey === "tempo-mainnet", "network by chain id");
assert(parsePaymentRequestLink(buildPaymentRequestLink({ payTo: tag, network: GLOAM_NETWORKS.robinhood, asset: "ETH" })).networkKey === "robinhood", "testnet works, native ETH there");

// The note: cleaned like a payment note, refused (not trimmed) over 80 characters.
assert(REQUEST_NOTE_MAX === 80, "same cap as the app");
const longest = "a".repeat(80);
assert(parsePaymentRequestLink(buildPaymentRequestLink({ payTo: tag, network: rh, asset: "USDG", note: longest })).note === longest, "an 80-character note fits");
throws(() => buildPaymentRequestLink({ payTo: tag, network: rh, asset: "USDG", note: "a".repeat(81) }), /at most 80/, "an 81-character note is refused");
assert(
  parsePaymentRequestLink(buildPaymentRequestLink({ payTo: tag, network: rh, asset: "USDG", note: "  agent\u0000  7‮ " })).note === "agent 7",
  "control and direction-override characters are cleaned the app's way"
);

// What is refused before a link exists.
throws(() => buildPaymentRequestLink({ payTo: "0x1111111111111111111111111111111111111111", network: rh, asset: "USDG" }), /receive tag/, "a public address is not a Gloam address");
throws(() => buildPaymentRequestLink({ payTo: tag, network: rh, asset: "ETH" }), /does not take "ETH". It takes: USDG, GLOAM/, "a token the mainnet vault does not take");
throws(() => buildPaymentRequestLink({ payTo: tag, network: 1, asset: "USDG" }), /does not run on 1/, "a chain Gloam is not on");
throws(() => normalizeRequestAmount("1.1234567", { decimals: 6, symbol: "USDG" }), /6 decimal places/, "too many decimals");
throws(() => normalizeRequestAmount("0", { decimals: 6, symbol: "USDG" }), /above zero/, "zero");
throws(() => normalizeRequestAmount("12,5x", { decimals: 6, symbol: "USDG" }), /numbers and one dot/, "not a number");
assert(normalizeRequestAmount("1,250.000", { decimals: 6, symbol: "USDG" }) === "1250", "commas and trailing zeros");
assert(normalizeRequestAmount("007.10", { decimals: 6, symbol: "USDG" }) === "7.1", "leading zeros");

// The note travels inside the payment: the package keeps it under "n" and reads it back.
const pkg = { pool: rh.pool, asset: RH_MAINNET_USDG, amountWei: "25500000", secret: "0x01", commitment: "0x02" };
const plain = encodeNotePackage(pkg);
const withNote = encodeNotePackage({ ...pkg, note: "agent-42" });
assert(plain !== withNote && decodeNotePackage(withNote).note === "agent-42", "a package carries the note");
assert(decodeNotePackage(plain).note === undefined, "a package without a note has none");

console.log(`requests.selftest: ok (${checks} assertions)`);
