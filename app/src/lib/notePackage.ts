/**
 * Portable **payment tickets** for Gloam vault pay.
 * Not a traditional address transfer, bearer secret for a vault note.
 * - Compact: gloam1.<base64url>
 * - Optional passphrase: gloam1e.<base64url> (AES-GCM)
 * Still accepts legacy JSON for older shares.
 *
 * A package can carry the payer's private note ("Invoice 042", lib/paymentNote)
 * under its own key: `n` in the compact form, `note` in the full JSON that
 * gloam1e locks. It is optional both ways: packages without it decode as
 * before, and older app versions skip the key they do not know. The note only
 * ever sits inside the payment (sealed, locked or in a claim link's fragment).
 */

import type { Address, Hex } from "viem";
import { NATIVE_ASSET } from "./shield";
import { cleanPaymentNote } from "./paymentNote";

export type NotePackage = {
  v: 1;
  type: "gloam-private-note";
  scheme: "poseidon";
  pool: Address;
  asset: Address;
  amountWei: string;
  secret: Hex;
  commitment: Hex;
  message?: string;
  /** The payer's private note to the payee, cleaned, at most 80 characters. */
  note?: string;
};

const PREFIX_PLAIN = "gloam1.";
const PREFIX_ENC = "gloam1e.";

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/** Fresh ArrayBuffer-backed view, satisfies strict BufferSource typing (TS 5.x). */
function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

export function buildNotePackage(args: {
  pool: Address;
  asset?: Address;
  amountWei: string;
  secret: Hex;
  commitment: Hex;
  /** Optional private note for the payee ("Invoice 042"). */
  note?: string;
}): NotePackage {
  const note = cleanPaymentNote(args.note);
  return {
    v: 1,
    type: "gloam-private-note",
    scheme: "poseidon",
    pool: args.pool,
    asset: args.asset ?? NATIVE_ASSET,
    amountWei: args.amountWei,
    secret: args.secret,
    commitment: args.commitment,
    message: "Gloam payment, import under Move → Receive. Keep secret.",
    ...(note ? { note } : {}),
  };
}

/** The package as short-keyed JSON, the form both plain and locked codes carry. */
function compactJson(pack: NotePackage): string {
  const note = cleanPaymentNote(pack.note);
  return JSON.stringify({
    v: pack.v,
    t: pack.type,
    s: pack.scheme,
    p: pack.pool,
    a: pack.asset,
    w: pack.amountWei,
    k: pack.secret,
    c: pack.commitment,
    // Only when there is one, so a package without a note is byte-for-byte the old format.
    ...(note ? { n: note } : {}),
  });
}

/** Compact share string (no passphrase). */
export function encodeNotePackage(pack: NotePackage): string {
  return PREFIX_PLAIN + b64urlEncode(utf8(compactJson(pack)));
}

/**
 * How a phrase is matched: capitals, extra spaces and curly quotes do not count.
 * Phone keyboards capitalise the first letter and curl apostrophes, so the right
 * phrase typed on a phone used to fail with "Wrong passphrase".
 */
export function canonicalPhrase(passphrase: string): string {
  return tidyPhrase(passphrase).toLowerCase();
}

function tidyPhrase(passphrase: string): string {
  return passphrase
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Phrases to try on a locked code: the matched form first (codes made since
 * 16 Oct 2026), then the phrase as typed and its near misses for older codes,
 * which were locked with the exact phrase.
 */
function phraseCandidates(passphrase: string): string[] {
  const tidy = tidyPhrase(passphrase);
  const flipped = tidy
    ? (tidy[0] === tidy[0].toUpperCase() ? tidy[0].toLowerCase() : tidy[0].toUpperCase()) + tidy.slice(1)
    : tidy;
  return [...new Set([canonicalPhrase(passphrase), passphrase.trim(), tidy, flipped])].filter(Boolean);
}

/**
 * PBKDF2 rounds. Codes locked from 20 Oct 2026 use 310,000 (OWASP's floor for
 * PBKDF2-SHA256); older ones used 120,000 and still open. The count isn't in the
 * code, so opening tries the current one first.
 */
const PBKDF2_ROUNDS = 310_000;
const PBKDF2_ROUNDS_BEFORE = [120_000];

async function deriveKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ROUNDS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    buf(utf8(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: buf(salt),
      iterations,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypt package with a shared passphrase (sender tells recipient the phrase). */
export async function encodeNotePackageEncrypted(
  pack: NotePackage,
  passphrase: string
): Promise<string> {
  if (!passphrase.trim()) throw new Error("Passphrase required");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(canonicalPhrase(passphrase), salt);
  // The same short-keyed JSON as a plain code, so a locked link is barely longer
  // than an open one. Readers have always accepted both key styles.
  const plain = buf(utf8(compactJson(pack)));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, key, plain)
  );
  const out = new Uint8Array(salt.length + iv.length + cipher.length);
  out.set(salt, 0);
  out.set(iv, 16);
  out.set(cipher, 28);
  return PREFIX_ENC + b64urlEncode(out);
}

/** The note as the payee keeps it: whatever the sender put there, cleaned again. */
function noteOf(obj: Record<string, unknown>): { note?: string } {
  const note = cleanPaymentNote(obj.note ?? obj.n);
  return note ? { note } : {};
}

function expandCompact(obj: Record<string, unknown>): NotePackage | null {
  if (obj.t !== "gloam-private-note" && obj.type !== "gloam-private-note") {
    // compact form uses t/s/p/a/w/k/c
    if (obj.t && obj.k && obj.w) {
      return {
        v: 1,
        type: "gloam-private-note",
        scheme: "poseidon",
        pool: String(obj.p) as Address,
        asset: (String(obj.a || NATIVE_ASSET) as Address),
        amountWei: String(obj.w),
        secret: String(obj.k) as Hex,
        commitment: String(obj.c || "0x") as Hex,
        ...noteOf(obj),
      };
    }
    return null;
  }
  return {
    v: 1,
    type: "gloam-private-note",
    scheme: "poseidon",
    pool: String(obj.pool || obj.p) as Address,
    asset: String(obj.asset || obj.a || NATIVE_ASSET) as Address,
    amountWei: String(obj.amountWei || obj.w),
    secret: String(obj.secret || obj.k) as Hex,
    commitment: String(obj.commitment || obj.c || "0x") as Hex,
    message: obj.message ? String(obj.message) : undefined,
    ...noteOf(obj),
  };
}

/**
 * Parse legacy JSON, gloam1.*, gloam1e.* (passphrase), or gloam2t.* (receive tag).
 * For gloam2t, pass `tryTagDecrypt: true` to use this browser’s viewing key.
 */
export async function decodeNotePackage(
  input: string,
  passphrase?: string,
  opts?: { tryTagDecrypt?: boolean }
): Promise<NotePackage> {
  const s = input.trim();

  // Pay-to-tag sealed package, only recipient’s receive key opens it
  if (s.startsWith("gloam2t.")) {
    if (!opts?.tryTagDecrypt) {
      throw new Error(
        "This ticket is encrypted to a receive tag. Claim it in the browser that owns that tag."
      );
    }
    const { decryptTicketWithLocalTag } = await import("./receiveTag");
    const inner = await decryptTicketWithLocalTag(s);
    // Recurse without tag prefix (inner is gloam1 / gloam1e / JSON)
    return decodeNotePackage(inner, passphrase, { tryTagDecrypt: false });
  }

  if (s.startsWith(PREFIX_ENC)) {
    if (!passphrase?.trim()) {
      throw new Error("This payment is locked, enter the passphrase from the sender.");
    }
    const raw = b64urlDecode(s.slice(PREFIX_ENC.length));
    if (raw.length < 29) throw new Error("Corrupt locked payment.");
    const salt = raw.slice(0, 16);
    const iv = raw.slice(16, 28);
    const cipher = raw.slice(28);
    let plain: Uint8Array | null = null;
    rounds: for (const iterations of [PBKDF2_ROUNDS, ...PBKDF2_ROUNDS_BEFORE]) {
      for (const phrase of phraseCandidates(passphrase)) {
        try {
          const key = await deriveKey(phrase, salt, iterations);
          plain = new Uint8Array(
            await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(iv) }, key, buf(cipher))
          );
          break rounds;
        } catch {
          /* try the next form */
        }
      }
    }
    if (!plain) throw new Error("Wrong passphrase or corrupt payment.");
    try {
      const pack = expandCompact(JSON.parse(utf8Decode(plain)) as Record<string, unknown>);
      if (!pack?.secret || !pack.amountWei) throw new Error("Invalid payment.");
      return pack;
    } catch {
      throw new Error("Wrong passphrase or corrupt payment.");
    }
  }

  if (s.startsWith(PREFIX_PLAIN)) {
    const plain = utf8Decode(b64urlDecode(s.slice(PREFIX_PLAIN.length)));
    const pack = expandCompact(JSON.parse(plain) as Record<string, unknown>);
    if (!pack?.secret || !pack.amountWei) throw new Error("Invalid payment package.");
    return pack;
  }

  // Legacy pretty JSON
  if (s.startsWith("{")) {
    const pack = expandCompact(JSON.parse(s) as Record<string, unknown>);
    if (!pack?.secret || !pack.amountWei) {
      throw new Error("Not a valid Gloam payment package.");
    }
    return pack;
  }

  throw new Error(
    "Paste a Gloam payment (gloam1… / gloam1e… / gloam2t… or full package)."
  );
}

export function isEncryptedPackage(input: string): boolean {
  const t = input.trim();
  return t.startsWith(PREFIX_ENC) || t.startsWith("gloam2t.");
}

export function isPayToTagSealed(input: string): boolean {
  return input.trim().startsWith("gloam2t.");
}

export function formatAmountEth(wei: string): string {
  try {
    const n = Number(wei) / 1e18;
    if (!Number.isFinite(n)) return wei;
    if (n === 0) return "0";
    if (n < 0.0001) return "<0.0001";
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  } catch {
    return wei;
  }
}
