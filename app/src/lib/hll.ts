/**
 * A small HyperLogLog, the same idea as Redis's PFADD and PFCOUNT, for the
 * in-process store (lib/partnersKv) that local development and the self-tests
 * use. Production uses Redis's own.
 *
 * What it keeps is a list of registers: for each of 16,384 slots, the longest
 * run of zero bits seen among the items that landed there. The items
 * themselves are hashed and dropped, so the registers can say roughly how many
 * different items went in, and nothing about which ones.
 *
 * Stored as a plain string: "hll1:" and then "slot.rank" pairs for the slots
 * that are set, like Redis's sparse form.
 */
import { createHash } from "crypto";

const P = 14;
const M = 1 << P;
const PREFIX = "hll1:";

export type Registers = Map<number, number>;

export function isHll(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(PREFIX);
}

export function decodeHll(v: string | null | undefined): Registers {
  const out: Registers = new Map();
  if (!v || !isHll(v)) return out;
  for (const pair of v.slice(PREFIX.length).split(",")) {
    if (!pair) continue;
    const [i, r] = pair.split(".");
    const slot = Number(i);
    const rank = Number(r);
    if (Number.isInteger(slot) && slot >= 0 && slot < M && Number.isInteger(rank) && rank > 0) out.set(slot, rank);
  }
  return out;
}

export function encodeHll(regs: Registers): string {
  return PREFIX + [...regs.entries()].sort((a, b) => a[0] - b[0]).map(([i, r]) => `${i}.${r}`).join(",");
}

/** The slot an item lands in and its rank (1 + trailing zero bits of the rest of its hash). */
function place(item: string): [number, number] {
  const h = createHash("sha256").update(item).digest();
  const x = h.readBigUInt64LE(0);
  const slot = Number(x & BigInt(M - 1));
  let rest = x >> BigInt(P);
  let rank = 1;
  while ((rest & 1n) === 0n && rank <= 64 - P) {
    rank++;
    rest >>= 1n;
  }
  return [slot, rank];
}

/** Adds items in place. True when any register changed (what PFADD reports as 1). */
export function addToHll(regs: Registers, items: string[]): boolean {
  let changed = false;
  for (const item of items) {
    const [slot, rank] = place(item);
    if ((regs.get(slot) ?? 0) < rank) {
      regs.set(slot, rank);
      changed = true;
    }
  }
  return changed;
}

/** The registers of several sketches together (what PFCOUNT does with more than one key). */
export function mergeHll(list: Registers[]): Registers {
  const out: Registers = new Map();
  for (const regs of list) for (const [i, r] of regs) if ((out.get(i) ?? 0) < r) out.set(i, r);
  return out;
}

/** Roughly how many different items went in. Exact or nearly so for small counts. */
export function countHll(regs: Registers): number {
  if (regs.size === 0) return 0;
  const alpha = 0.7213 / (1 + 1.079 / M);
  let sum = M - regs.size; // empty registers count 2^0
  for (const r of regs.values()) sum += 2 ** -r;
  const raw = (alpha * M * M) / sum;
  const empty = M - regs.size;
  // small counts: linear counting on the empty registers is far more accurate
  if (raw <= 2.5 * M && empty > 0) return Math.round(M * Math.log(M / empty));
  return Math.round(raw);
}
