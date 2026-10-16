// Shared helpers for Gloam's phase-2 ceremony scripts.
import { createHash } from "crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const CIRCUITS = JSON.parse(readFileSync(join(HERE, "circuits.json"), "utf8"));
export const BUILD = join(HERE, "build");
export const ROUNDS = join(HERE, "rounds");

/** Phase 1: the public Perpetual Powers of Tau (Hermez/Polygon), 2^16, final with beacon. */
export const PTAU_NAME = "powersOfTau28_hez_final_16.ptau";
export const PTAU = join(BUILD, PTAU_NAME);

export const roundDir = (n) => join(ROUNDS, `round-${String(n).padStart(3, "0")}`);
export const zkeyIn = (dir, c) => join(dir, `${c.name}.zkey`);

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/** snarkjs returns contribution hashes as bytes; print them the way snarkjs logs do. */
export function hashHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

export function readManifest(dir) {
  const p = join(dir, "manifest.json");
  if (!existsSync(p)) throw new Error(`No manifest.json in ${dir}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function writeManifest(dir, manifest) {
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

/** Quiet logger for snarkjs, keeping only lines worth showing. */
export const logger = {
  debug() {},
  info(msg) {
    if (/contribution|hash|beacon|ZKey Ok|Circuit Hash/i.test(String(msg))) console.log("  " + msg);
  },
  warn: (m) => console.warn("  " + m),
  error: (m) => console.error("  " + m),
};
