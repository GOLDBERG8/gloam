/**
 * The receive-and-credit example credits the right token.
 *
 * Anyone can pay a Gloam address in any token the vault takes, and amounts are
 * in that token's base units. The example must credit only payments in the
 * token it credits, read with that token's decimals: a GLOAM payment of
 * 25,000,000 base units is 0.000000000025 GLOAM, not 25 USDG. Loads the example
 * itself (types stripped by the TypeScript compiler, the SDK import pointed at
 * this build) and checks what it would credit, without running its main loop.
 *
 * Run after build:  node test/examples.selftest.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import ts from "typescript";
import { mainnetNetwork, RH_MAINNET_USDG, GLOAM_TOKEN } from "../dist/index.js";

let checks = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  checks++;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "examples/receive-and-credit.ts"), "utf8");
// Written outside dist, so a test run never ends up in the published package.
const js = ts
  .transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  .outputText.replace(/from "@gloamtrade\/sdk"/g, `from "${pathToFileURL(join(root, "dist/index.js")).href}"`)
  .replace(/from "viem"/g, `from "${import.meta.resolve("viem")}"`);
const out = join(mkdtempSync(join(tmpdir(), "gloam-example-")), "receive-and-credit.mjs");
writeFileSync(out, js);
// Importing must not run the example's main (it would make a key and exit, or watch forever).
const exit = process.exit;
process.exit = (code) => {
  throw new Error(`the example ran its main on import (exit ${code})`);
};
let example = null;
let loadError = null;
try {
  example = await import(pathToFileURL(out).href);
} catch (e) {
  loadError = e;
} finally {
  process.exit = exit;
}
assert(!loadError, `the example loads without running: ${loadError?.message}`);
assert(typeof example.creditFor === "function", "the example exports creditFor");

const net = mainnetNetwork("robinhood");
const payment = (asset, amountWei, note) => ({
  commitment: "0x" + "c1".repeat(32),
  nullifier: "0x" + "0f".repeat(32),
  amountWei,
  asset,
  note,
  sealedTicket: "gloam2t.x",
  notePackage: { v: 1, type: "gloam-private-note", scheme: "poseidon", pool: net.pool, asset, amountWei, secret: "0x01", commitment: "0x01" },
  blockNumber: null,
  txHash: null,
});

const usdg = example.creditFor(payment(RH_MAINNET_USDG, "25000000", "agent:42"));
assert(usdg.agentId === "42" && usdg.amount === "25", `25 USDG credits agent 42 (got ${JSON.stringify(usdg)})`);
const lower = example.creditFor(payment(RH_MAINNET_USDG.toLowerCase(), "1500000", "agent:7"));
assert(lower.agentId === "7" && lower.amount === "1.5", "the asset match ignores address case");
const gloam = example.creditFor(payment(GLOAM_TOKEN, "25000000", "agent:42"));
assert("skip" in gloam && /GLOAM/.test(gloam.skip), `a GLOAM payment is not credited as USDG (got ${JSON.stringify(gloam)})`);
const stranger = example.creditFor(payment("0x000000000000000000000000000000000000dEaD", "25000000", "agent:42"));
assert("skip" in stranger, "a token the vault does not list is not credited");
const noNote = example.creditFor(payment(RH_MAINNET_USDG, "25000000", null));
assert("skip" in noNote && /agent note/.test(noNote.skip), "a payment with no agent note is not credited");

console.log(`examples.selftest: ok (${checks} assertions)`);
