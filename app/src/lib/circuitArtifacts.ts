/**
 * Circuit artifacts in /public/circuits.
 * Ceremony: **dev** (Powers of Tau + single-party contribution), not production.
 * SHA-256 fingerprints for tamper detection at prove time.
 */

export type CeremonyKind = "dev" | "production";

export const PROVING_CEREMONY: CeremonyKind = "dev";

export const CIRCUIT_ARTIFACTS = {
  unshieldWasm: {
    path: "/circuits/unshield.wasm",
    sha256:
      "84ac0942b1618c6112a10bfe82ff0a62a80b7a14881565781eb513e9e581c480",
  },
  unshieldZkey: {
    path: "/circuits/unshield_final.zkey",
    sha256:
      "f4b4c5bfa315cef38634eec1b64b8d9ad1d28725f61fde5e169fef1896360b63",
  },
  transferWasm: {
    path: "/circuits/transfer.wasm",
    sha256:
      "081929509c3477ee264cb2422183018c23122d59952ed4a61c4932c95d360872",
  },
  transferZkey: {
    path: "/circuits/transfer_final.zkey",
    sha256:
      "f75bc324f12e1f467f5779a7275737aa0fa514a6c317e3d775f1dba8f0234666",
  },
  sealedSwapWasm: {
    path: "/circuits/sealed_swap.wasm",
    sha256:
      "7b8d18f3274d2e3e8d65ed3e41b66ab940082c9906d9281b28a25491f74405b0",
  },
  sealedSwapZkey: {
    path: "/circuits/sealed_swap_final.zkey",
    sha256:
      "c8521ebffe9a2181d5072e5351392c0f311a8a2f30be1b3ae954b77b1f728920",
  },
  shieldWasm: {
    path: "/circuits/shield.wasm",
    sha256:
      "58157ec90f8af891acfa998bd599511b4d5cd06803cea32ab28a6eea8a9b2336",
  },
  shieldZkey: {
    path: "/circuits/shield_final.zkey",
    sha256:
      "e4d42271b99faa218faebb38a06f69b5ccf01e328d3dea4381ab567e9fbd2481",
  },
  /** Only for checking an older balance disclosure (lib/disclosure). */
  shieldVkey: {
    path: "/circuits/shield_vkey.json",
    sha256:
      "f4c3de52c35689296b6d2253d0368fdec47648744c28a97fa013a1bb25445986",
  },
} as const;

function hexSha256(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

const verified = new Set<string>();

/** Fetch artifact and check SHA-256. Cached per session path. */
export async function assertArtifactIntegrity(
  path: string,
  expectedSha256: string
): Promise<void> {
  const key = `${path}:${expectedSha256}`;
  if (verified.has(key)) return;

  // revalidate (a 304 when unchanged), so a copy cached before a regeneration can't fail the check forever
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Missing circuit file ${path} (${res.status}).`);
  }
  const data = await res.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", data);
  const got = hexSha256(digest);
  if (got !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Circuit artifact hash mismatch for ${path}. Expected ${expectedSha256.slice(0, 12)}… got ${got.slice(0, 12)}…, refuse to prove.`
    );
  }
  verified.add(key);
}

export async function assertUnshieldArtifacts(): Promise<void> {
  await assertArtifactIntegrity(
    CIRCUIT_ARTIFACTS.unshieldWasm.path,
    CIRCUIT_ARTIFACTS.unshieldWasm.sha256
  );
  await assertArtifactIntegrity(
    CIRCUIT_ARTIFACTS.unshieldZkey.path,
    CIRCUIT_ARTIFACTS.unshieldZkey.sha256
  );
}

export async function assertTransferArtifacts(): Promise<void> {
  await assertArtifactIntegrity(
    CIRCUIT_ARTIFACTS.transferWasm.path,
    CIRCUIT_ARTIFACTS.transferWasm.sha256
  );
  await assertArtifactIntegrity(
    CIRCUIT_ARTIFACTS.transferZkey.path,
    CIRCUIT_ARTIFACTS.transferZkey.sha256
  );
}

export async function assertSealedSwapArtifacts(): Promise<void> {
  await assertArtifactIntegrity(
    CIRCUIT_ARTIFACTS.sealedSwapWasm.path,
    CIRCUIT_ARTIFACTS.sealedSwapWasm.sha256
  );
  await assertArtifactIntegrity(
    CIRCUIT_ARTIFACTS.sealedSwapZkey.path,
    CIRCUIT_ARTIFACTS.sealedSwapZkey.sha256
  );
}

export async function assertShieldArtifacts(): Promise<void> {
  await assertArtifactIntegrity(
    CIRCUIT_ARTIFACTS.shieldWasm.path,
    CIRCUIT_ARTIFACTS.shieldWasm.sha256
  );
  await assertArtifactIntegrity(
    CIRCUIT_ARTIFACTS.shieldZkey.path,
    CIRCUIT_ARTIFACTS.shieldZkey.sha256
  );
}

export function isDevCeremony(): boolean {
  return PROVING_CEREMONY === "dev";
}
