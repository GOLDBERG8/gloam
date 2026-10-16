#!/usr/bin/env node
/**
 * Check a round of Gloam's trusted setup yourself.
 *
 *   node verify.mjs <round-folder>
 *
 * For each circuit it recompiles nothing and trusts nothing from us: it checks
 * the keys against the circuit (build/<name>/<name>.r1cs) and the public Powers
 * of Tau file (build/powersOfTau28_hez_final_16.ptau), and lists every
 * contribution in order, so you can find your own hash in it. Get the r1cs files
 * and the round from the ceremony release; get the ptau from the URL in README.md.
 */
import * as snarkjs from "snarkjs";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { BUILD, CIRCUITS, PTAU, readManifest, sha256File, zkeyIn } from "./lib.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node verify.mjs <round-folder>");
  process.exit(1);
}
if (!existsSync(PTAU)) {
  console.error(`Missing ${PTAU}. See README.md for where to download it.`);
  process.exit(1);
}

const manifest = readManifest(resolve(dir));
let ok = true;
for (const c of CIRCUITS) {
  const r1cs = join(BUILD, c.name, `${c.name}.r1cs`);
  const zkey = zkeyIn(resolve(dir), c);
  console.log(`\n== ${c.name}`);
  if (manifest.files?.[c.name] && (await sha256File(zkey)) !== manifest.files[c.name]) {
    console.log("  file does not match manifest.json");
    ok = false;
    continue;
  }
  const good = await snarkjs.zKey.verifyFromR1cs(r1cs, PTAU, zkey, console);
  console.log(good ? "  OK" : "  FAILED");
  ok &&= good;
}
console.log(ok ? "\nEvery circuit in this round checks out." : "\nSomething failed. Do not use this round.");
process.exit(ok ? 0 : 1);
