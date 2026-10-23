import { FUNDS_MAX_NOTES, cleanVerifierLabel } from "@/lib/proofs";
import { allNetworks, type GloamNetwork } from "@/lib/networks";
import { isNativeAsset, type LocalNote } from "@/lib/shield";
import { shieldTokensFor } from "@/lib/tokens";

/** How long a proof stays good for. 7 days is the default. */
export const EXPIRY_OPTIONS = [
  { id: "1d", label: "1 day", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
] as const;

export type ExpiryId = (typeof EXPIRY_OPTIONS)[number]["id"];

export function expiresAtFor(id: ExpiryId, now = Date.now()): number {
  const days = EXPIRY_OPTIONS.find((o) => o.id === id)?.days ?? 7;
  return Math.floor(now / 1000) + days * 86_400;
}

/** The label is sealed into the proof; lib/proofs caps it at 80 characters. */
export const VERIFIER_MAX = 80;

/** The label as it will be sealed (trimmed, single spaced), or null when not usable yet. */
export function verifierLabel(input: string): string | null {
  try {
    return cleanVerifierLabel(input);
  } catch {
    return null;
  }
}

function hasSecret(n: LocalNote): boolean {
  return Boolean(n.secret) && n.secret !== "0x" && n.secret.length > 10;
}

/** A note the new circuits can prove: secret known, bound, Poseidon. */
export function isCircuitNote(n: LocalNote): boolean {
  return hasSecret(n) && Boolean(n.bound) && n.scheme !== "keccak";
}

/** Unspent, in the vault and circuit-compatible: can back a proof of funds. */
export function isFundsNote(n: LocalNote): boolean {
  return isCircuitNote(n) && n.status !== "recovered" && !n.unfunded;
}

/**
 * A payment someone sent this wallet. Claimed payments (a Gloam address
 * payment, a claim link, a payroll payout) are saved with an `imp-` id; change,
 * deposits and trades are not. Spent ones still count: the payment still
 * happened. One the vault hasn't shown yet is not a payment yet. The prover
 * checks the note on chain before proving.
 */
export function isReceivedPayment(n: LocalNote): boolean {
  return n.id.startsWith("imp-") && isCircuitNote(n) && !n.unfunded;
}

export type FundsPick =
  | { kind: "empty" }
  | { kind: "ok"; notes: LocalNote[]; total: bigint }
  | { kind: "short"; total: bigint }
  | { kind: "too-many"; maxProvable: bigint; total: bigint };

/**
 * The fewest notes that cover `threshold`: largest first. Fewer notes means
 * fewer spend markers in the proof.
 */
export function pickFundsNotes(notes: LocalNote[], threshold: bigint | null): FundsPick {
  if (threshold == null || threshold <= 0n) return { kind: "empty" };
  const sorted = [...notes].sort((a, b) => {
    const x = BigInt(a.amountWei);
    const y = BigInt(b.amountWei);
    return x === y ? 0 : x > y ? -1 : 1;
  });
  const total = sorted.reduce((s, n) => s + BigInt(n.amountWei), 0n);
  if (total < threshold) return { kind: "short", total };
  const picked: LocalNote[] = [];
  let sum = 0n;
  for (const n of sorted) {
    if (sum >= threshold) break;
    picked.push(n);
    sum += BigInt(n.amountWei);
  }
  if (picked.length > FUNDS_MAX_NOTES) {
    const maxProvable = sorted
      .slice(0, FUNDS_MAX_NOTES)
      .reduce((s, n) => s + BigInt(n.amountWei), 0n);
    return { kind: "too-many", maxProvable, total };
  }
  return { kind: "ok", notes: picked, total: sum };
}

export function sumNotes(notes: LocalNote[]): bigint {
  return notes.reduce((s, n) => s + BigInt(n.amountWei || "0"), 0n);
}

/** Logo id for an asset on a chain; null for the native coin. */
export function logoIdFor(asset: string, chainId: number): string | null {
  if (isNativeAsset(asset)) return null;
  return (
    shieldTokensFor(chainId).find((t) => t.address.toLowerCase() === asset.toLowerCase())?.id ??
    asset
  );
}

export function networkFor(chainId: number): GloamNetwork | undefined {
  return allNetworks().find((n) => n.chainId === chainId);
}

export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * A verify link carries the proof after `#`, so opening it never sends the
 * proof to any server (the verify page promises nothing goes to Gloam). The
 * verify page also reads `?proof=`.
 */
export const MAX_LINK_LENGTH = 4000;

export function verifyLinkFor(token: string, origin: string): string | null {
  const url = `${origin}/verify#proof=${encodeURIComponent(token)}`;
  return url.length <= MAX_LINK_LENGTH ? url : null;
}

/**
 * A coarse reason for a failed proof, for product analytics only: a fixed
 * category, never the message (it can name a label or a network).
 */
export function proveFailReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  if (/not built yet/i.test(msg)) return "not_enabled";
  if (/reject|denied|cancel/i.test(msg)) return "cancelled";
  if (/switch to|another network|older vault/i.test(msg)) return "wrong_network";
  if (/no key|older balances|not a payment/i.test(msg)) return "unprovable_note";
  if (/already spent|not in the vault|read the vault/i.test(msg)) return "vault_sync";
  if (/could not load/i.test(msg)) return "load_failed";
  if (/say who|keep the name|expiry|amount|minimum|balances|same asset|add up/i.test(msg)) return "input";
  return "other";
}

export type FriendlyError = { tone: "warn" | "danger"; text: string };

/** Turns a prover error into plain words. */
export function friendlyProveError(e: unknown, what: "funds" | "payment" | "balance"): FriendlyError {
  const msg = e instanceof Error ? e.message : "";
  if (/not built yet/i.test(msg)) {
    const name = what === "funds" ? "Proof of funds" : what === "payment" ? "Proof of payment" : "Exact balance";
    return { tone: "warn", text: `${name} is not switched on in this version of Gloam yet.` };
  }
  if (/not a payment/i.test(msg)) return { tone: "warn", text: msg };
  if (/reject|denied|cancel/i.test(msg)) {
    return { tone: "warn", text: "Stopped before the proof was made. Nothing was shared." };
  }
  return {
    tone: "danger",
    text: msg || "Could not build the proof. Try again in a moment.",
  };
}
