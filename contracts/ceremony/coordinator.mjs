#!/usr/bin/env node
/**
 * Coordinator side of Gloam's phase-2 trusted setup.
 *
 *   node coordinator.mjs init
 *       Compile the six circuits with circom and start round 000 from the
 *       public Powers of Tau file (no contribution in it yet).
 *
 *   node coordinator.mjs accept <round-folder>
 *       Check a contributor's round: every key must come from our round 000
 *       and the public ptau, with one more contribution than the last round we
 *       accepted. Then file it under rounds/ and log it in TRANSCRIPT.md.
 *
 *   node coordinator.mjs finalize --beacon <hex> --label "<where the beacon is from>"
 *       Apply a public random beacon announced in advance (a drand round) to
 *       the last accepted round, check the result, then export the verifying
 *       keys and Solidity verifiers and copy the browser files into the app.
 *       Prints the SHA-256 fingerprints for app/src/lib/circuitArtifacts.ts.
 */
import * as snarkjs from "snarkjs";
import { execFileSync } from "child_process";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import {
  BUILD, CIRCUITS, HERE, PTAU, PTAU_NAME, ROUNDS, hashHex, logger, readManifest, roundDir, sha256File, writeManifest, zkeyIn,
} from "./lib.mjs";

const TRANSCRIPT = join(HERE, "TRANSCRIPT.md");
const APP_CIRCUITS = resolve(HERE, "../../app/public/circuits");
const VERIFIERS = resolve(HERE, "../src/verifiers");
const CIRCOM = existsSync(join(homedir(), ".cargo/bin/circom")) ? join(homedir(), ".cargo/bin/circom") : "circom";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (k) => {
  const i = rest.indexOf(k);
  return i >= 0 ? rest[i + 1] : undefined;
};

/** The last round we accepted, kept in rounds/accepted.json (a contributor's new round may already sit in rounds/). */
const ACCEPTED = join(ROUNDS, "accepted.json");
function lastAccepted() {
  return existsSync(ACCEPTED) ? JSON.parse(readFileSync(ACCEPTED, "utf8")).last : -1;
}
function markAccepted(n) {
  writeFileSync(ACCEPTED, JSON.stringify({ last: n }) + "\n");
}

function requirePtau() {
  if (!existsSync(PTAU)) {
    console.error(`Missing build/${PTAU_NAME}. Download it as README.md describes, then run again.`);
    process.exit(1);
  }
}

async function init() {
  requirePtau();
  if (lastAccepted() >= 0) throw new Error("The ceremony is already started (rounds/accepted.json). Init runs once.");
  const circom = execFileSync(CIRCOM, ["--version"]).toString().trim();
  const info = { circom, snarkjs: "0.7.5", ptau: { file: PTAU_NAME, sha256: await sha256File(PTAU) }, circuits: {} };
  const dir = roundDir(0);
  mkdirSync(dir, { recursive: true });
  const manifest = { round: 0, contributor: "none (initial keys from the public ptau)", previous: null, files: {}, contributionHashes: {} };

  for (const c of CIRCUITS) {
    const out = join(BUILD, c.name);
    mkdirSync(out, { recursive: true });
    console.log(`== ${c.name}: compile`);
    execFileSync(CIRCOM, [c.source, "--r1cs", "--wasm", "--sym", "-o", out, "-l", "node_modules"], { cwd: HERE, stdio: ["ignore", "ignore", "inherit"] });
    const r1cs = join(out, `${c.name}.r1cs`);
    const r1csInfo = await snarkjs.r1cs.info(r1cs);
    console.log(`== ${c.name}: ${r1csInfo.nConstraints} constraints, new key`);
    await snarkjs.zKey.newZKey(r1cs, PTAU, zkeyIn(dir, c), logger);
    manifest.files[c.name] = await sha256File(zkeyIn(dir, c));
    info.circuits[c.name] = {
      constraints: r1csInfo.nConstraints,
      r1csSha256: await sha256File(r1cs),
      wasmSha256: await sha256File(join(out, `${c.name}_js`, `${c.name}.wasm`)),
    };
  }
  writeManifest(dir, manifest);
  markAccepted(0);
  writeFileSync(join(BUILD, "ceremony-info.json"), JSON.stringify(info, null, 2) + "\n");

  writeFileSync(
    TRANSCRIPT,
    [
      "# Gloam trusted setup transcript",
      "",
      `Phase 1: \`${PTAU_NAME}\` (Perpetual Powers of Tau, Hermez/Polygon), SHA-256 \`${info.ptau.sha256}\`.`,
      `Compiler: ${circom}. snarkjs 0.7.5.`,
      "",
      "| Circuit | Constraints | r1cs SHA-256 |",
      "|---|---|---|",
      ...CIRCUITS.map((c) => `| ${c.name} | ${info.circuits[c.name].constraints} | \`${info.circuits[c.name].r1csSha256}\` |`),
      "",
      "## Rounds",
      "",
      `- **Round 000** (${new Date().toISOString().slice(0, 10)}): initial keys from the public ptau, no contribution.`,
      "",
    ].join("\n"),
  );
  console.log(`\nRound 000 is ready in ${dir}. Publish it with the r1cs files, then send it to the first contributor.`);
}

async function accept(folder) {
  requirePtau();
  if (!folder) throw new Error("Usage: node coordinator.mjs accept <round-folder>");
  const src = resolve(folder);
  const m = readManifest(src);
  const expected = lastAccepted() + 1;
  if (m.round !== expected) throw new Error(`This is round ${m.round}; the next round to accept is ${expected}.`);
  const init0 = roundDir(0);
  for (const c of CIRCUITS) {
    const z = zkeyIn(src, c);
    if ((await sha256File(z)) !== m.files[c.name]) throw new Error(`${c.name}.zkey does not match its manifest.`);
    console.log(`== ${c.name}`);
    const ok = await snarkjs.zKey.verifyFromInit(zkeyIn(init0, c), PTAU, z, logger);
    if (!ok) throw new Error(`${c.name}.zkey does not come from our round 000 and the public ptau.`);
  }
  const dest = roundDir(m.round);
  if (resolve(dest) !== src) cpSync(src, dest, { recursive: true });
  markAccepted(m.round);
  appendFileSync(
    TRANSCRIPT,
    [
      `- **Round ${String(m.round).padStart(3, "0")}** (${new Date().toISOString().slice(0, 10)}): ${m.contributor}`,
      ...CIRCUITS.map((c) => `  - ${c.name}: \`${m.contributionHashes[c.name]}\``),
      "",
    ].join("\n"),
  );
  console.log(`\nAccepted round ${m.round} from ${m.contributor}. Publish it and send it to the next contributor.`);
}

async function finalize() {
  requirePtau();
  const beacon = flag("--beacon");
  const label = flag("--label");
  if (!beacon || !/^[0-9a-fA-F]{64}$/.test(beacon) || !label) {
    throw new Error('Usage: node coordinator.mjs finalize --beacon <64 hex chars> --label "drand round N"');
  }
  const last = lastAccepted();
  if (last < 1) throw new Error("No contributions accepted yet.");
  const from = roundDir(last);
  const out = join(BUILD, "final");
  mkdirSync(out, { recursive: true });
  const template = readFileSync(join(HERE, "node_modules/snarkjs/templates/verifier_groth16.sol.ejs"), "utf8");
  const prints = [];
  const finals = {};

  for (const c of CIRCUITS) {
    console.log(`== ${c.name}: beacon`);
    const final = join(out, `${c.app}_final.zkey`);
    const h = await snarkjs.zKey.beacon(zkeyIn(from, c), final, `Beacon: ${label}`, beacon, 10, logger);
    if (!(await snarkjs.zKey.verifyFromInit(zkeyIn(roundDir(0), c), PTAU, final, logger))) {
      throw new Error(`${c.name}: final key failed verification.`);
    }
    finals[c.name] = hashHex(h);
    const vkey = await snarkjs.zKey.exportVerificationKey(final);
    writeFileSync(join(out, `${c.app}_vkey.json`), JSON.stringify(vkey, null, 1) + "\n");
    if (c.verifier) {
      const sol = await snarkjs.zKey.exportSolidityVerifier(final, { groth16: template });
      writeFileSync(join(VERIFIERS, `${c.verifier}.sol`), sol.replace(/contract Groth16Verifier/, `contract ${c.verifier}`));
    }
    const wasm = join(BUILD, c.name, `${c.name}_js`, `${c.name}.wasm`);
    copyFileSync(wasm, join(APP_CIRCUITS, `${c.app}.wasm`));
    copyFileSync(final, join(APP_CIRCUITS, `${c.app}_final.zkey`));
    copyFileSync(join(out, `${c.app}_vkey.json`), join(APP_CIRCUITS, `${c.app}_vkey.json`));
    prints.push([`${c.app}.wasm`, await sha256File(wasm)], [`${c.app}_final.zkey`, await sha256File(final)]);
  }

  appendFileSync(
    TRANSCRIPT,
    [
      `## Final (${new Date().toISOString().slice(0, 10)})`,
      "",
      `Beacon applied to round ${String(last).padStart(3, "0")}: \`${beacon}\` (${label}), 2^10 iterations.`,
      "",
      ...CIRCUITS.map((c) => `- ${c.name}: \`${finals[c.name]}\``),
      "",
      "Browser files (SHA-256):",
      "",
      ...prints.map(([f, s]) => `- \`${f}\`: \`${s}\``),
      "",
    ].join("\n"),
  );
  console.log("\nFinal keys are in build/final and copied into the app. Solidity verifiers regenerated.");
  console.log("Update app/src/lib/circuitArtifacts.ts with these fingerprints, then set PROVING_CEREMONY to production:\n");
  for (const [f, s] of prints) console.log(`${f}  ${s}`);
}

const run = { init, accept: () => accept(rest[0]), finalize }[cmd];
if (!run) {
  console.error("Usage: node coordinator.mjs init | accept <round-folder> | finalize --beacon <hex> --label <text>");
  process.exit(1);
}
await run();
process.exit(0);
