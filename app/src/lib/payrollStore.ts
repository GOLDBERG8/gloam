/**
 * Where payroll runs live (the runs themselves in lib/payroll).
 *
 * A run holds claim codes and payment secrets, so it is money: sealed with
 * sealJson under the same data key as the private balance (lib/noteVault).
 * Old runs make room for new ones, except a run still holding a payment that
 * may land: its codes are the only copy, so it is never dropped. The recovery
 * backup carries those runs too (lib/recovery), and every write tells it.
 *
 * Kept apart from lib/payroll (which pulls in the prover) so the backup can
 * read runs without loading it.
 */
import type { Address } from "viem";
import { openJson, sealJson } from "./noteVault";
import type { PayrollBatch, PayrollRow } from "./payroll";

const STORE_KEY = "gloam.payroll.v1";
/** Finished runs kept besides the ones still holding a payment that may land. */
const KEEP_RUNS = 30;
/** Fired on window after every write (recovery backs runs up). */
export const PAYROLL_SAVED_EVENT = "gloam:payroll-saved";

/**
 * A payment on record that the chain has not settled for this browser yet: it
 * may have landed or may still land, and the row holds its codes and secrets.
 */
export function holdsPendingPayment(r: PayrollRow): boolean {
  return Boolean(r.spendNullifier) && r.status !== "paid" && r.status !== "failed";
}

async function readAll(): Promise<PayrollBatch[]> {
  if (typeof window === "undefined") return [];
  const all = await openJson<PayrollBatch[]>(window.localStorage.getItem(STORE_KEY));
  return Array.isArray(all) ? all : [];
}

async function writeAll(batches: PayrollBatch[]): Promise<void> {
  // Claim links are money: stored encrypted under the same device key as notes.
  let others = 0;
  const kept = batches.filter((b) => b.rows.some(holdsPendingPayment) || ++others <= KEEP_RUNS);
  window.localStorage.setItem(STORE_KEY, await sealJson(kept));
  window.dispatchEvent(new Event(PAYROLL_SAVED_EVENT));
}

export async function loadBatches(chainId: number, pool: Address): Promise<PayrollBatch[]> {
  return (await readAll())
    .filter((b) => b.chainId === chainId && b.pool.toLowerCase() === pool.toLowerCase())
    .sort((a, b) => b.createdAt - a.createdAt);
}

let writeQueue: Promise<void> = Promise.resolve();
export function saveBatch(batch: PayrollBatch): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const all = await readAll();
    await writeAll([batch, ...all.filter((b) => b.id !== batch.id)]);
  });
  return writeQueue;
}

export async function deleteBatch(id: string): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await writeAll((await readAll()).filter((b) => b.id !== id));
  });
  return writeQueue;
}

/** Runs on any network still holding a payment that may land: what the backup carries. */
export async function pendingPayrollRuns(): Promise<PayrollBatch[]> {
  await writeQueue;
  return (await readAll()).filter((b) => b.rows.some(holdsPendingPayment));
}

function isRun(v: unknown): v is PayrollBatch {
  const b = v as Partial<PayrollBatch> | null;
  return (
    Boolean(b) &&
    typeof b!.id === "string" &&
    typeof b!.chainId === "number" &&
    typeof b!.pool === "string" &&
    typeof b!.asset === "string" &&
    typeof b!.employer === "string" &&
    Array.isArray(b!.rows)
  );
}

/**
 * Take in runs from a backup. A run already in this browser is kept as it is.
 * With `owner`, restored runs pay from that wallet (the one signed in now), as
 * restored notes are shown under it. Returns how many were added.
 */
export async function restorePayrollRuns(value: unknown, owner?: string | null): Promise<number> {
  if (typeof window === "undefined" || !Array.isArray(value)) return 0;
  const incoming = value.filter(isRun);
  if (!incoming.length) return 0;
  let added = 0;
  writeQueue = writeQueue.then(async () => {
    const all = await readAll();
    const ids = new Set(all.map((b) => b.id));
    const fresh = incoming
      .filter((b) => !ids.has(b.id))
      .map((b) => (owner ? { ...b, employer: owner as Address } : b));
    added = fresh.length;
    if (fresh.length) await writeAll([...all, ...fresh]);
  });
  await writeQueue;
  return added;
}
