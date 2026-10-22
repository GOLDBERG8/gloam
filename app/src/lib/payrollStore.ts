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
import { makeSentLink, paymentNullifier } from "./sentLinks";
import { restoreSentLinks } from "./sentLinksStore";
import { assetLabel } from "./shield";

const STORE_KEY = "gloam.payroll.v1";
/** Runs this browser could not open (another key, damaged data), set aside so a write never destroys them. */
const UNREADABLE_KEY = "gloam.payroll.v1.unreadable";
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
  const raw = window.localStorage.getItem(STORE_KEY);
  if (!raw) return [];
  const all = await openJson<PayrollBatch[]>(raw);
  if (!Array.isArray(all)) {
    // Another key or damaged data: keep the ciphertext aside before anything writes over it.
    if (!window.localStorage.getItem(UNREADABLE_KEY)) window.localStorage.setItem(UNREADABLE_KEY, raw);
    return [];
  }
  return all;
}

async function writeAll(batches: PayrollBatch[]): Promise<void> {
  // Claim links are money: stored encrypted under the same device key as notes.
  let others = 0;
  const kept = batches.filter((b) => b.rows.some(holdsPendingPayment) || ++others <= KEEP_RUNS);
  window.localStorage.setItem(STORE_KEY, await sealJson(kept));
  window.dispatchEvent(new Event(PAYROLL_SAVED_EVENT));
}

export async function loadBatches(chainId: number, pool: Address): Promise<PayrollBatch[]> {
  const runs = (await readAll())
    .filter((b) => b.chainId === chainId && b.pool.toLowerCase() === pool.toLowerCase())
    .sort((a, b) => b.createdAt - a.createdAt);
  // Runs paid before their codes went to Sent links: copy them over once.
  for (const run of runs) {
    if (await keepPaidCodes(run).catch(() => false)) await saveBatch(run).catch(() => undefined);
  }
  return runs;
}

/** Paid, and the payer holds the only copy of the code: a claim link, or a heads-up that didn't post. */
function codeOnlyPayerHolds(r: PayrollRow): boolean {
  return (
    r.status === "paid" &&
    !r.codeKept &&
    Boolean(r.ticket) &&
    Boolean(r.paymentSecret) &&
    Boolean(r.paymentCommitment) &&
    (r.kind === "link" || !r.memoPosted)
  );
}

/**
 * Copy a run's paid codes that only the payer holds into Sent links, which
 * never drops a code whose money has not moved, carries it in the backup and
 * offers Take back. A finished run can then make room for new ones without
 * losing a code. Only codes missing from Sent links are added, so a status
 * seen there (used, taken back) stays. Marks the rows; returns true when it
 * changed any.
 */
export async function keepPaidCodes(batch: PayrollBatch): Promise<boolean> {
  const rows = batch.rows.filter(codeOnlyPayerHolds);
  if (!rows.length) return false;
  const symbol = assetLabel(batch.asset);
  const records = await Promise.all(
    rows.map(async (r) =>
      makeSentLink({
        code: r.ticket!,
        chainId: batch.chainId,
        pool: batch.pool,
        asset: batch.asset,
        symbol,
        amountWei: r.amount,
        nullifier: await paymentNullifier(r.paymentSecret!, r.paymentCommitment!),
        note: r.note,
        now: r.sentAt ?? batch.createdAt,
      })
    )
  );
  await restoreSentLinks(records);
  for (const r of rows) r.codeKept = true;
  return true;
}

// One failed write (a full localStorage, say) must not stop every later save
// or the backup, so the queue itself never stays rejected.
let writeQueue: Promise<void> = Promise.resolve();
function queue(task: () => Promise<void>): Promise<void> {
  const run = writeQueue.then(task);
  writeQueue = run.catch(() => undefined);
  return run;
}

export function saveBatch(batch: PayrollBatch): Promise<void> {
  return queue(async () => {
    const all = await readAll();
    await writeAll([batch, ...all.filter((b) => b.id !== batch.id)]);
  });
}

export async function deleteBatch(id: string): Promise<void> {
  return queue(async () => {
    await writeAll((await readAll()).filter((b) => b.id !== id));
  });
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

/** Shown on a restored row that was never sent from the device that backed it up. */
export const NOT_SENT_HERE =
  "Not sent. This run was started on another device: pay this person from there, or in a new run.";

/**
 * A run from a backup can only settle what it already sent. A row with no
 * payment on record may have been paid since by the other device, so it is not
 * left queued for Resume to pay again here.
 */
function asRestored(b: PayrollBatch, owner?: string | null): PayrollBatch {
  return {
    ...b,
    ...(owner ? { employer: owner as Address } : {}),
    rows: b.rows.map((r) =>
      r.status === "paid" || r.status === "failed" || r.spendNullifier
        ? r
        : { ...r, status: "failed" as const, error: NOT_SENT_HERE }
    ),
  };
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
  await queue(async () => {
    const all = await readAll();
    const ids = new Set(all.map((b) => b.id));
    const fresh = incoming.filter((b) => !ids.has(b.id)).map((b) => asRestored(b, owner));
    added = fresh.length;
    if (fresh.length) await writeAll([...all, ...fresh]);
  });
  return added;
}
