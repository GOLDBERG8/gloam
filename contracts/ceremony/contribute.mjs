#!/usr/bin/env node
/**
 * Add your contribution to Gloam's trusted setup.
 *
 *   node contribute.mjs <latest-round-folder> --name "Your name or handle"
 *
 * For each circuit it mixes fresh randomness from this computer, plus anything
 * you type, into the latest keys and writes a new round folder next to the one
 * you gave it. The randomness only ever exists in this process's memory: it is
 * never written to disk or printed. As long as one contributor's randomness is
 * gone for good, nobody can forge a proof.
 *
 * At the end it prints your contribution hashes. Post them publicly (X, a gist)
 * and send the new round folder to the coordinator.
 */
import * as snarkjs from "snarkjs";
import { randomBytes, createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { createInterface } from "readline/promises";
import { CIRCUITS, hashHex, logger, readManifest, sha256File, writeManifest, zkeyIn } from "./lib.mjs";

const args = process.argv.slice(2);
const nameAt = args.indexOf("--name");
const name = nameAt >= 0 ? args[nameAt + 1] : "";
const inDir = args.find((a, i) => !a.startsWith("--") && i !== nameAt + 1);
if (!inDir || !name) {
  console.error('Usage: node contribute.mjs <latest-round-folder> --name "Your name or handle"');
  process.exit(1);
}

const prev = readManifest(resolve(inDir));
const next = prev.round + 1;
const outDir = join(dirname(resolve(inDir)), `round-${String(next).padStart(3, "0")}`);
if (existsSync(outDir)) {
  console.error(`${basename(outDir)} already exists next to ${basename(inDir)}. Move it away first.`);
  process.exit(1);
}

for (const c of CIRCUITS) {
  const f = zkeyIn(resolve(inDir), c);
  if (!existsSync(f)) throw new Error(`Missing ${c.name}.zkey in ${inDir}`);
  const want = prev.files[c.name];
  if (want && (await sha256File(f)) !== want) throw new Error(`${c.name}.zkey does not match the round's manifest. Download it again.`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const typed = await rl.question("Type some random text (it is mixed in, never stored), then press Enter: ");
rl.close();

mkdirSync(outDir, { recursive: true });
const manifest = { round: next, contributor: name, previous: prev.round, files: {}, contributionHashes: {} };

console.log(`\nContributing as "${name}" to round ${next} (${CIRCUITS.length} circuits). This takes a few minutes.\n`);
for (const c of CIRCUITS) {
  // Fresh entropy per circuit: OS randomness plus the typed text, hashed together.
  const entropy = createHash("sha512").update(randomBytes(64)).update(typed).update(c.name).digest("hex");
  console.log(`== ${c.name}`);
  const h = await snarkjs.zKey.contribute(zkeyIn(resolve(inDir), c), zkeyIn(outDir, c), name, entropy, logger);
  manifest.contributionHashes[c.name] = hashHex(h);
  manifest.files[c.name] = await sha256File(zkeyIn(outDir, c));
}
writeManifest(outDir, manifest);

console.log(`\nDone. Your round is in ${outDir}\n`);
console.log("Post this publicly so anyone can check your contribution is in the final keys:\n");
console.log(`I contributed to Gloam's trusted setup, round ${next}, as ${name}.`);
for (const c of CIRCUITS) console.log(`${c.name}: ${manifest.contributionHashes[c.name]}`);
console.log("\nThen send the round folder to the coordinator. You can delete everything else.");
process.exit(0);
