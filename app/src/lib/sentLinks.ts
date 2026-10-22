/**
 * Sent links: the payment codes you send from Pay > Send privately, kept in
 * this browser so a lost link is not lost money.
 *
 * A record is saved when the sender is the only one holding the code: a claim
 * link (gloam1 / gloam1e), or a payment to a Gloam address whose private
 * heads-up did not post (gloam2t). It holds the full code, so it is money and
 * lives sealed under the vault's data key (lib/sentLinksStore), never in plain
 * localStorage. A lock phrase is never stored.
 *
 * Status comes from the chain: a code is "Used" once its note's nullifier is
 * spent in the pool. The nullifier is worked out when the payment is made, from
 * the payment note, with the same helper a claim uses, so locked codes and
 * Gloam-address codes can be checked without opening them. Claiming alone puts
 * nothing on-chain, so "Not used yet" means nobody has moved the money yet.
 *
 * This file is pure (no storage, no network) so scripts/selftest-sent-links.mts
 * can run it in Node.
 */
import type { Address, Hex } from "viem";
import { noteNullifierPoseidon } from "./notePoseidon";
import { fieldToHex, hexToField } from "./poseidon";
import { cleanPaymentNote } from "./paymentNote";

/** Records kept per network and pool, unless more codes than that still hold money. */
export const SENT_LINKS_MAX = 100;

/** A claim link anyone with the code can claim, or a payment sealed to someone's Gloam address. */
export type SentLinkKind = "link" | "address";

export type SentLink = {
  id: string;
  /** The full code (gloam1. / gloam1e. / gloam2t.). Bearer for links: this is the money. */
  code: string;
  kind: SentLinkKind;
  chainId: number;
  pool: Address;
  asset: Address;
  /** Asset symbol when it was sent (the native symbol differs per network). */
  symbol: string;
  amountWei: string;
  createdAt: number;
  /** Locked with a phrase (gloam1e). The phrase itself is never stored. */
  locked: boolean;
  /** The payment note's nullifier, for the spent check. */
  nullifier?: Hex;
  /** The private note that went with the payment. */
  note?: string;
  /** The sender claimed it back into their own balance. */
  takenBackAt?: number;
  /** Seen spent on-chain. A spent nullifier stays spent, so this never needs a recheck. */
  usedAt?: number;
};

export type SentLinkStatus = "checking" | "unused" | "used" | "taken-back" | "unknown";

export const SENT_LINK_STATUS_LABEL: Record<SentLinkStatus, string> = {
  checking: "Checking…",
  unused: "Not used yet",
  used: "Used",
  "taken-back": "Taken back",
  unknown: "Couldn't check",
};

const CODE_RE = /^(gloam1|gloam1e|gloam2t)\.[A-Za-z0-9_\-.]+$/;
const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function sentLinkKind(code: string): SentLinkKind {
  return code.trim().startsWith("gloam2t.") ? "address" : "link";
}

export function isPhraseLocked(code: string): boolean {
  return code.trim().startsWith("gloam1e.");
}

/** The nullifier of a payment note, exactly as a claim works it out (MoveView, Claim a payment). */
export async function paymentNullifier(secret: Hex, commitment: Hex): Promise<Hex> {
  return fieldToHex(await noteNullifierPoseidon(hexToField(secret), hexToField(commitment)));
}

export function makeSentLink(args: {
  code: string;
  chainId: number;
  pool: Address;
  asset: Address;
  symbol: string;
  amountWei: string;
  nullifier?: Hex;
  note?: string;
  now?: number;
}): SentLink {
  const code = args.code.trim();
  const createdAt = args.now ?? Date.now();
  const note = cleanPaymentNote(args.note);
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    id: `sl-${createdAt.toString(36)}-${rand}`,
    code,
    kind: sentLinkKind(code),
    chainId: args.chainId,
    pool: args.pool,
    asset: args.asset,
    symbol: args.symbol,
    amountWei: args.amountWei,
    createdAt,
    locked: isPhraseLocked(code),
    ...(args.nullifier ? { nullifier: args.nullifier } : {}),
    ...(note ? { note } : {}),
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * Read stored records back, dropping anything that is not a whole record.
 * Kind and locked always follow the code, never what was stored.
 */
export function parseSentLinks(value: unknown): SentLink[] {
  if (!Array.isArray(value)) return [];
  const out: SentLink[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const code = typeof r.code === "string" ? r.code.trim() : "";
    if (!CODE_RE.test(code)) continue;
    if (typeof r.id !== "string" || !r.id) continue;
    const chainId = num(r.chainId);
    const createdAt = num(r.createdAt);
    if (!chainId || !createdAt) continue;
    if (typeof r.pool !== "string" || !ADDR_RE.test(r.pool)) continue;
    if (typeof r.asset !== "string" || !ADDR_RE.test(r.asset)) continue;
    if (typeof r.amountWei !== "string" || !/^\d+$/.test(r.amountWei)) continue;
    const nullifier =
      typeof r.nullifier === "string" && HEX32_RE.test(r.nullifier) ? (r.nullifier as Hex) : undefined;
    const note = cleanPaymentNote(r.note);
    const takenBackAt = num(r.takenBackAt);
    const usedAt = num(r.usedAt);
    out.push({
      id: r.id,
      code,
      kind: sentLinkKind(code),
      chainId,
      pool: r.pool as Address,
      asset: r.asset as Address,
      symbol: typeof r.symbol === "string" && r.symbol ? r.symbol.slice(0, 16) : "",
      amountWei: r.amountWei,
      createdAt,
      locked: isPhraseLocked(code),
      ...(nullifier ? { nullifier } : {}),
      ...(note ? { note } : {}),
      ...(takenBackAt ? { takenBackAt } : {}),
      ...(usedAt ? { usedAt } : {}),
    });
  }
  return out;
}

export function sameScope(r: Pick<SentLink, "chainId" | "pool">, chainId: number, pool: string): boolean {
  return r.chainId === chainId && r.pool.toLowerCase() === pool.toLowerCase();
}

function scopeKey(r: Pick<SentLink, "chainId" | "pool">): string {
  return `${r.chainId}:${r.pool.toLowerCase()}`;
}

/**
 * Newest first, at most `max` per network and pool. A code whose money has not
 * moved is never dropped (this record may be its only copy), so only used and
 * taken-back records make room, oldest first.
 */
export function capSentLinks(list: SentLink[], max = SENT_LINKS_MAX): SentLink[] {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  const open = new Map<string, number>();
  for (const r of sorted) if (needsCheck(r)) open.set(scopeKey(r), (open.get(scopeKey(r)) ?? 0) + 1);
  const settled = new Map<string, number>();
  return sorted.filter((r) => {
    if (needsCheck(r)) return true;
    const k = scopeKey(r);
    const n = (settled.get(k) ?? 0) + 1;
    settled.set(k, n);
    return (open.get(k) ?? 0) + n <= max;
  });
}

/** Add a record (a code already in the list is replaced, not doubled), then cap. */
export function addSentLink(list: SentLink[], rec: SentLink, max = SENT_LINKS_MAX): SentLink[] {
  return capSentLinks([rec, ...list.filter((r) => r.id !== rec.id && r.code !== rec.code)], max);
}

/**
 * What a row shows. `spent` is the last on-chain check for it: undefined while
 * none has come back, null when it failed. A failed check never guesses.
 */
export function sentLinkStatus(
  rec: Pick<SentLink, "takenBackAt" | "usedAt">,
  spent: boolean | null | undefined
): SentLinkStatus {
  if (rec.takenBackAt) return "taken-back";
  if (rec.usedAt || spent === true) return "used";
  if (spent === false) return "unused";
  if (spent === null) return "unknown";
  return "checking";
}

/** Only an unused claim link can be taken back; a Gloam-address payment opens for its owner only. */
export function canTakeBack(rec: Pick<SentLink, "kind">, status: SentLinkStatus): boolean {
  return rec.kind === "link" && status === "unused";
}

/** Only rows whose money has moved can leave the list. */
export function canRemove(status: SentLinkStatus): boolean {
  return status === "used" || status === "taken-back";
}

/** Rows that still need an on-chain check. */
export function needsCheck(rec: Pick<SentLink, "takenBackAt" | "usedAt">): boolean {
  return !rec.takenBackAt && !rec.usedAt;
}
