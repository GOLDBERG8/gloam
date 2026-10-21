/**
 * Fetch the shield circuit into public/circuits so the browser can prove
 * locally. Runs before dev/build. Two key sets: the testnet dev key at the
 * root, and the trusted setup's final key under final/ for mainnet (the .wasm
 * is shared). Skips files already present, or the whole step if
 * NEXT_PUBLIC_GLOAM_ARTIFACTS points at a remote http(s) URL (then the browser
 * fetches them from there instead).
 */
import { mkdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

const remote = process.env.NEXT_PUBLIC_GLOAM_ARTIFACTS;
if (remote && /^https?:\/\//.test(remote)) {
  console.log(`Using remote artifacts at ${remote}; skipping local download.`);
  process.exit(0);
}

const SOURCE = (process.env.GLOAM_ARTIFACTS_SOURCE || "https://www.gloam.trade/circuits").replace(/\/+$/, "");
// SHA-256 of each file, as pinned in @gloamtrade/sdk (CIRCUIT_SHA256).
const FILES = {
  "shield.wasm": "58157ec90f8af891acfa998bd599511b4d5cd06803cea32ab28a6eea8a9b2336",
  "shield_final.zkey": "e4d42271b99faa218faebb38a06f69b5ccf01e328d3dea4381ab567e9fbd2481",
  "final/shield_final.zkey": "3054877c35e2e0e9f76c43aa4791ac2b3ac51b8967d51be2215e89c0a5fbb512",
};
const OUT = "public/circuits";

let ok = true;
for (const [f, sha256] of Object.entries(FILES)) {
  const dest = join(OUT, f);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`  ✓ ${f} (present)`);
    continue;
  }
  try {
    process.stdout.write(`  ↓ ${f} … `);
    const res = await fetch(`${SOURCE}/${f}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (createHash("sha256").update(buf).digest("hex") !== sha256) throw new Error("does not match its pinned SHA-256");
    writeFileSync(dest, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  } catch (e) {
    ok = false;
    console.log(`failed (${e.message})`);
  }
}

if (!ok) {
  console.error(`\nCould not fetch some artifacts from ${SOURCE}.`);
  console.error(`Set GLOAM_ARTIFACTS_SOURCE to a reachable base, or copy`);
  console.error(`shield.wasm, shield_final.zkey and final/shield_final.zkey into ${OUT}/ manually.\n`);
  process.exit(1);
}
