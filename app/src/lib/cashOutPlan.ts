/**
 * Smarter cash-out defaults, the part that only reads and counts.
 *
 * Inside the vault a payment shows nothing. A cash out shows its amount and
 * where it goes, so one that matches money the person added (the same amount,
 * or soon after) is easy to tie back to them. Two things here:
 *
 *  - findCashOutLink spots that: an amount within 1% of a deposit or a payment
 *    received in the last 30 days, or any deposit in the last few hours.
 *  - planPieces breaks a cash out into 2 to 4 ordinary-looking pieces (round
 *    sizes plus a remainder) that add up to exactly the amount, none of them
 *    within 1% of recent money in. The app then sends each piece through "cash
 *    out later" (lib/cashOutPrivately), so each goes out at its own random time.
 *
 * Only this browser's own notes are read: deposits made here (and a reshield
 * after a public swap), and payments claimed here. Nothing leaves the browser.
 * Chain-only rows are skipped: they carry no real date.
 */
import { withdrawFeeOf, type LocalNote } from "./shield";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How far back money in counts as linkable. */
export const LINK_LOOKBACK_MS = 30 * DAY;
/** A deposit this recent is flagged whatever its amount: timing alone lines them up. */
export const RECENT_DEPOSIT_MS = 3 * HOUR;

/** Pieces are offered only above this many whole units (5 USDG): below it a split costs more than it hides. */
export const PRIVATE_MIN_UNITS = 5n;
/** Every piece is a split and a proof the relay pays gas for, so never more than this. */
export const MAX_PIECES = 4;
export const MIN_PIECES = 2;
/** The smallest piece, in whole units. */
const MIN_PIECE_UNITS = 1n;

// ---------------------------------------------------------------- money in

export type MoneyInKind = "deposit" | "received";

export type MoneyIn = { id: string; kind: MoneyInKind; amountWei: bigint; at: number };

/**
 * What a local note says about money that came in, by how the app names it:
 * a deposit (lib/shield ShieldView and BridgeIn notes, `<ms>-0x…`; a reshield
 * after a public swap, `vt-`), or a payment claimed here (`imp-`). Change,
 * splits, secured moves and swap outputs are the person's own money moving
 * inside the vault, so they are not money in.
 */
export function moneyInKind(n: Pick<LocalNote, "id" | "source">): MoneyInKind | null {
  if (n.source === "chain") return null;
  const id = n.id;
  if (/^\d{12,}-0x[0-9a-f]+$/i.test(id)) return "deposit";
  if (id.startsWith("vt-")) return "deposit";
  if (id.startsWith("imp-")) return "received";
  // The recording demo's seeded deposits (lib/demo/store); its change is `chg-demo-`.
  if (id.startsWith("demo-")) return "deposit";
  return null;
}

/** Money in for `asset` in the lookback, newest first. A spent deposit still counts: its amount is public. */
export function recentMoneyIn(notes: LocalNote[], asset: string, now = Date.now(), lookbackMs = LINK_LOOKBACK_MS): MoneyIn[] {
  const want = asset.toLowerCase();
  const seen = new Set<string>();
  const out: MoneyIn[] = [];
  for (const n of notes) {
    if (!n || seen.has(n.id) || n.asset?.toLowerCase() !== want) continue;
    const kind = moneyInKind(n);
    if (!kind || !Number.isFinite(n.createdAt) || now - n.createdAt > lookbackMs) continue;
    let v: bigint;
    try {
      v = BigInt(n.amountWei || "0");
    } catch {
      continue;
    }
    if (v <= 0n) continue;
    seen.add(n.id);
    out.push({ id: n.id, kind, amountWei: v, at: n.createdAt });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Whether `amount` is within 1% of `base`. */
export function nearAmount(amount: bigint, base: bigint): boolean {
  if (base <= 0n || amount <= 0n) return false;
  const diff = amount > base ? amount - base : base - amount;
  return diff * 100n <= base;
}

// ---------------------------------------------------------------- spotting the link

export type CashOutLink =
  /** The amount is (about) a deposit or payment received. */
  | { kind: "same" | "close"; source: MoneyInKind; at: number; amountWei: bigint }
  /** A deposit came in only hours ago, whatever its amount. */
  | { kind: "recent"; source: "deposit"; at: number; amountWei: bigint };

/**
 * The plainest link between this cash out and money that came in: an amount
 * match first (exact before close, a deposit before a payment, newest first),
 * then a deposit in the last few hours. Null when nothing lines up.
 */
export function findCashOutLink(amountWei: bigint, notes: LocalNote[], asset: string, now = Date.now()): CashOutLink | null {
  if (amountWei <= 0n) return null;
  const ins = recentMoneyIn(notes, asset, now);
  const rank = (m: MoneyIn) => (m.amountWei === amountWei ? 0 : 2) + (m.kind === "deposit" ? 0 : 1);
  const match = ins
    .filter((m) => nearAmount(amountWei, m.amountWei))
    .sort((a, b) => rank(a) - rank(b) || b.at - a.at)[0];
  if (match) {
    return { kind: match.amountWei === amountWei ? "same" : "close", source: match.kind, at: match.at, amountWei: match.amountWei };
  }
  const recent = ins.find((m) => m.kind === "deposit" && now - m.at <= RECENT_DEPOSIT_MS);
  return recent ? { kind: "recent", source: "deposit", at: recent.at, amountWei: recent.amountWei } : null;
}

/** "just now", "12 minutes ago", "about 2 hours ago", or "on Oct 22". */
export function whenLabel(at: number, now = Date.now()): string {
  const ago = Math.max(0, now - at);
  if (ago < MINUTE) return "just now";
  if (ago < HOUR) {
    const m = Math.round(ago / MINUTE);
    return m === 1 ? "a minute ago" : `${m} minutes ago`;
  }
  if (ago < DAY) {
    const h = Math.round(ago / HOUR);
    return h === 1 ? "about an hour ago" : `about ${h} hours ago`;
  }
  return `on ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** The calm note for the cash-out card, in plain words. */
export function linkMessage(link: CashOutLink, now = Date.now()): string {
  const when = whenLabel(link.at, now);
  if (link.kind === "recent") return `You added money ${when}. A cash out this soon after is easy to line up with it.`;
  if (link.source === "received") {
    return link.kind === "same"
      ? `This is the same amount you were paid ${when}, so whoever paid you could spot it.`
      : `This is close to what you were paid ${when}, so whoever paid you could spot it.`;
  }
  return link.kind === "same"
    ? `This is the same amount you added ${when}, so anyone can link the two.`
    : `This is close to the amount you added ${when}, so anyone can link the two.`;
}

// ---------------------------------------------------------------- the pieces

/** A seeded random source (mulberry32), so a plan is the same on every render and in tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6 and 7.5 times a power of ten, in hundredths. */
const MANTISSAS = [100n, 125n, 150n, 200n, 250n, 300n, 400n, 500n, 600n, 750n];

/** The ordinary-looking whole amounts up to `maxUnits`: 1, 2, 3, 4, 5, 6, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, … */
export function niceUnits(maxUnits: bigint): bigint[] {
  const out: bigint[] = [];
  for (let scale = 1n; scale <= maxUnits * 100n; scale *= 10n) {
    for (const m of MANTISSAS) {
      const v = m * scale;
      if (v % 100n !== 0n) continue;
      const units = v / 100n;
      if (units >= 1n && units <= maxUnits && !out.includes(units)) out.push(units);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export type PiecePlan = {
  /** In base units, in the order they are made; they add up to exactly the amount. */
  pieces: bigint[];
  /** The remainder keeps cents that match money that came in (its tail can tie it back): rounding the amount leaves them in the vault. */
  tailMatch: boolean;
};

/** How many pieces an amount gets at most: small ones stay at two, since every piece costs a split and a proof. */
export function mostPieces(units: bigint, cap = MAX_PIECES): number {
  const most = units < 15n ? 2 : units < 50n ? 3 : 4;
  return Math.max(MIN_PIECES, Math.min(most, cap, MAX_PIECES));
}

/** Every sum of 2 or more pieces but not all of them. */
function partialSums(pieces: bigint[]): bigint[] {
  const out: bigint[] = [];
  const n = pieces.length;
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    if ((mask & (mask - 1)) === 0) continue; // a single piece
    let s = 0n;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s += pieces[i]!;
    out.push(s);
  }
  return out;
}

/**
 * Whether a set of pieces is safe to use. Always: 2 to `cap` pieces, each at
 * least one whole unit and under 90% of the amount, adding up to exactly
 * `amount`, and none within 1% of money that came in. When `strict`, also none
 * over 75% of the amount, no two the same, and no group of them (short of all)
 * adding up to money that came in.
 */
export function piecesOk(pieces: bigint[], amount: bigint, unit: bigint, avoid: bigint[], cap = MAX_PIECES, strict = false): boolean {
  if (pieces.length < MIN_PIECES || pieces.length > Math.min(cap, MAX_PIECES)) return false;
  if (pieces.some((p) => p < MIN_PIECE_UNITS * unit || p * 10n >= amount * 9n)) return false;
  if (pieces.reduce((s, p) => s + p, 0n) !== amount) return false;
  if (pieces.some((p) => avoid.some((d) => nearAmount(p, d)))) return false;
  if (!strict) return true;
  if (pieces.some((p) => p * 4n > amount * 3n)) return false;
  if (new Set(pieces.map(String)).size !== pieces.length) return false;
  return !partialSums(pieces).some((s) => avoid.some((d) => nearAmount(s, d)));
}

function scaleBy(v: bigint, f: number): bigint {
  return (v * BigInt(Math.round(f * 10_000))) / 10_000n;
}

/** Closeness of two positive amounts as a ratio distance (0 is equal). */
function ratioGap(a: bigint, b: bigint): number {
  const x = Number(a);
  const y = Number(b);
  return Math.abs(Math.log(x / y));
}

/**
 * One draw: round pieces near an even share (with some wobble), then the
 * remainder. Null when a round piece no longer fits.
 */
function draw(amount: bigint, n: number, nice: bigint[], minPiece: bigint, random: () => number): bigint[] | null {
  const out: bigint[] = [];
  let left = amount;
  for (let k = 0; k < n - 1; k++) {
    const still = n - k;
    const room = left - BigInt(still - 1) * minPiece;
    const fits = nice.filter((v) => v >= minPiece && v <= room);
    if (!fits.length) return null;
    const target = scaleBy(left / BigInt(still), 0.55 + random() * 0.9);
    const want = target > 0n ? target : minPiece;
    const closest = [...fits].sort((a, b) => ratioGap(a, want) - ratioGap(b, want)).slice(0, 3);
    const pick = closest[Math.floor(random() * closest.length)]!;
    out.push(pick);
    left -= pick;
  }
  out.push(left);
  return out;
}

/**
 * Two or three pieces by trying every round size in turn, for when the draws
 * found nothing safe (a lot of recent money in at round amounts).
 */
function search(amount: bigint, most: number, nice: bigint[], unit: bigint, avoid: bigint[], cap: number): bigint[] | null {
  const minPiece = MIN_PIECE_UNITS * unit;
  for (const strict of [true, false]) {
    for (const a of nice) {
      const rest = amount - a;
      if (rest < minPiece) break;
      const two = [a, rest];
      if (piecesOk(two, amount, unit, avoid, cap, strict)) return two;
    }
    if (most < 3) continue;
    for (const a of nice) {
      for (const b of nice) {
        const rest = amount - a - b;
        if (rest < minPiece) break;
        const three = [a, b, rest];
        if (piecesOk(three, amount, unit, avoid, cap, strict)) return three;
      }
    }
  }
  return null;
}

/**
 * Breaks `amount` (base units of an asset with `decimals`) into 2 to 4
 * ordinary-looking pieces: round sizes (5, 10, 20, 25, 50, 100…) plus a
 * remainder, adding up to exactly `amount`, none within 1% of an amount in
 * `avoid` (recent money in). Null at or below PRIVATE_MIN_UNITS whole units,
 * or when no safe set exists. The same `random` gives the same plan.
 */
export function planPieces(p: {
  amount: bigint;
  decimals: number;
  avoid?: bigint[];
  random?: () => number;
  maxPieces?: number;
}): PiecePlan | null {
  const unit = 10n ** BigInt(p.decimals);
  const amount = p.amount;
  if (amount <= PRIVATE_MIN_UNITS * unit) return null;
  const avoid = (p.avoid ?? []).filter((d) => d > 0n);
  const random = p.random ?? Math.random;
  const cap = Math.max(MIN_PIECES, Math.min(p.maxPieces ?? MAX_PIECES, MAX_PIECES));
  const most = mostPieces(amount / unit, cap);
  const nice = niceUnits(amount / unit).map((u) => u * unit);
  const minPiece = MIN_PIECE_UNITS * unit;

  let pieces: bigint[] | null = null;
  for (let attempt = 0; attempt < 80 && !pieces; attempt++) {
    const strict = attempt < 50;
    const n = MIN_PIECES + Math.floor(random() * (most - MIN_PIECES + 1));
    const got = draw(amount, n, nice, minPiece, random);
    if (got && piecesOk(got, amount, unit, avoid, cap, strict)) pieces = got;
  }
  pieces ??= search(amount, most, nice, unit, avoid, cap);
  if (!pieces) return null;

  const tail = pieces[pieces.length - 1]! % unit;
  const tailMatch = tail !== 0n && avoid.some((d) => d % unit === tail);
  return { pieces, tailMatch };
}

/** The fee the pieces pay together: each pays the pool's own fee on its amount (so never more than one cash out of the whole). */
export function piecesFee(pieces: bigint[], bps: number): bigint {
  return pieces.reduce((s, p) => s + withdrawFeeOf(p, bps), 0n);
}

/**
 * The relay transactions and browser proofs a plan takes: a split for every
 * piece but the last when the pieces are the whole note (then the last is the
 * change), one for every piece otherwise, and a cash-out proof per piece.
 */
export function planSteps(pieces: bigint[], noteWei: bigint): { splits: number; proofs: number } {
  const total = pieces.reduce((s, p) => s + p, 0n);
  const splits = total === noteWei ? pieces.length - 1 : pieces.length;
  return { splits, proofs: splits + pieces.length };
}
