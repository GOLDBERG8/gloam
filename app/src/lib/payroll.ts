/**
 * Private payroll: pay a whole team from your private balance in one run.
 *
 * How it works (v1, no contract changes):
 *   - The transfer circuit spends one private balance entry ("note") into a
 *     payment + change, so a payroll is a chain of private sends: each payment
 *     is taken from the smallest note that covers it, and its change becomes
 *     spendable for the next one once confirmed.
 *   - People with a Gloam address are paid directly: their payment is
 *     encrypted to their address and (where the memo board is live) posted
 *     on-chain so it shows up in their app. Everyone else gets a claim link.
 *   - An optional note column ("September salary") travels inside each
 *     payment, so only that person reads it (lib/paymentNote).
 *   - Through the relay, the employer's wallet never appears next to any of
 *     the payments. The public sees private transfers, never who or how much.
 *
 * Crash safety: before a payment is submitted, its change note and the batch
 * row are persisted. A row is paid only once the pool holds that row's own
 * payment commitment. A payment whose fate is unclear is never written off:
 * the row keeps its codes, and a retry sends that very same payment again
 * (the same note into the same payment and change), so at most one copy can
 * ever land. Its codes go only once the chain shows they never can: the note
 * it spends went into another payment. A refresh can never lose or
 * double-pay money.
 *
 * Proving the total: each row also keeps the payee note's secret and the
 * opening of the note it spent (sealed at rest with the batch, like claim
 * links), so a finished run can later prove "N payments adding up to exactly T"
 * (lib/proofs, payroll_total). Runs paid before that was kept cannot, unless
 * every payee was a claim link and the spent notes are still on this device.
 */
import type { Address, Hex, PublicClient } from "viem";
import { claimLinkFor } from "./claimLink";
import { fieldToHex, hexToField, noteCommitmentPoseidon, noteNullifierPoseidon, randomSecretField } from "@gloamtrade/sdk";
import { buildTransferWitness, type TransferWitness } from "@/lib/proverTransfer";
import { fieldToBytes32, proveTransferInBrowser } from "@/lib/proveClient";
import { syncShieldTree, type SyncedTree } from "@/lib/treeSync";
import type { PoseidonMerklePath } from "@/lib/merklePoseidon";
import { buildNotePackage, decodeNotePackage, encodeNotePackage } from "@/lib/notePackage";
import type { PayrollNote } from "@/lib/proofs";
import { readAmountText } from "@/lib/amountText";
import { encryptTicketForTag, isReceiveTag, isValidReceiveTag } from "@/lib/receiveTag";
import { ticketToMemoBytes } from "@/lib/payMemo";
import { cleanPaymentNote } from "@/lib/paymentNote";
import { keepPaidCodes, saveBatch } from "@/lib/payrollStore";
import { markPrivatePaid } from "@/lib/firstPayment";
import { countLinkCreated } from "@/lib/funnel";
import {
  activeSpendableNotes,
  assetDecimals,
  formatAssetAmount,
  loadLocalNotes,
  parseAssetAmount,
  saveLocalNote,
  shieldPoolAbi,
  updateLocalNote,
  type LocalNote,
} from "@/lib/shield";

// ------------------------------------------------------------------ types

export type PayeeKind = "gloam" | "link";

export type PayrollRowStatus =
  | "queued"
  | "preparing"
  | "sending"
  | "confirming"
  | "notifying"
  /** Sent, and the chain has not settled it yet. Never written off: resuming checks again. */
  | "unconfirmed"
  | "paid"
  | "failed";

export type PayrollRow = {
  id: string;
  name: string;
  /** Gloam address (gloamr1…) or "" for a claim link */
  recipient: string;
  kind: PayeeKind;
  /** raw units of the batch asset */
  amount: string;
  /** Private note sealed into their payment, e.g. "September salary". */
  note?: string;
  status: PayrollRowStatus;
  error?: string;
  attempts?: number;
  // execution record (persisted before submit, for crash-safe resume)
  spendNoteId?: string;
  spendNullifier?: Hex;
  changeNoteId?: string;
  paymentCommitment?: Hex;
  /** The change output, so a retry can send this exact payment again (zero change included). */
  changeSecret?: Hex;
  changeCommitment?: Hex;
  /** encrypted to their Gloam address, or a plain claim code for links */
  ticket?: string;
  txHash?: Hex;
  /** When the payment was handed to the wallet or the relay. */
  sentAt?: number;
  memoPosted?: boolean;
  // kept for the payroll total proof (sealed with the batch, never exported)
  /** The secret of the note this row paid them (the payer creates it). */
  paymentSecret?: Hex;
  /** The opening of the payer's note this row spent: its spend marker is spendNullifier. */
  spendSecret?: Hex;
  spendAmount?: string;
  /** Its code was copied to Sent links (lib/payrollStore keepPaidCodes), once. */
  codeKept?: boolean;
};

export type PayrollBatch = {
  id: string;
  title: string;
  createdAt: number;
  chainId: number;
  pool: Address;
  asset: Address;
  employer: Address;
  relay: boolean;
  status: "draft" | "running" | "paused" | "needs_funds" | "done";
  rows: PayrollRow[];
  /** Set when the run pays a saved schedule (lib/payrollSchedule): which one, and for which payday. */
  scheduleId?: string;
  payday?: string;
};

export type DraftRow = {
  line: number;
  name: string;
  recipient: string;
  kind: PayeeKind;
  amountInput: string;
  amount: bigint | null;
  /** From the optional note column, cleaned ("" when none). */
  note?: string;
  error: string | null;
};

// ------------------------------------------------------------------ CSV

export const PAYROLL_MAX_ROWS = 200;

/** The note column is optional: lists without it work as they always have. */
export const PAYROLL_TEMPLATE = [
  "name,gloam_address,amount,note",
  "Ada Obi,gloamr1.PASTE_THEIR_GLOAM_ADDRESS,1250,September salary",
  "Tunde Bello,,980,Invoice 7",
].join("\n");

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === "," || ch === "\t" || ch === ";") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

const NAME_KEYS = ["name", "payee", "employee", "person", "contractor", "full name"];
const RECIPIENT_KEYS = ["gloam_address", "gloam address", "gloam", "address", "recipient", "to", "wallet"];
const AMOUNT_KEYS = ["amount", "pay", "salary", "usd", "value", "total"];
const NOTE_KEYS = ["note", "notes", "memo", "reference", "ref", "description"];

function findCol(header: string[], keys: string[]): number {
  return header.findIndex((h) => keys.includes(h.toLowerCase().replace(/\s+/g, " ").trim()));
}

/** Parse pasted or uploaded CSV into draft rows (validated, not yet a batch). */
export function parsePayrollCsv(text: string, asset: Address): { rows: DraftRow[]; error: string | null } {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l, i) => ({ l: l.trim(), i: i + 1 }))
    .filter((x) => x.l.length > 0);
  if (!lines.length) return { rows: [], error: null };

  // Without a header: name, address, amount, then an optional note.
  let cols = { name: 0, recipient: 1, amount: 2, note: 3 };
  let start = 0;
  const first = splitCsvLine(lines[0].l);
  const looksLikeHeader = first.some((c) =>
    [...NAME_KEYS, ...RECIPIENT_KEYS, ...AMOUNT_KEYS].includes(c.toLowerCase().trim())
  );
  if (looksLikeHeader) {
    const n = findCol(first, NAME_KEYS);
    const r = findCol(first, RECIPIENT_KEYS);
    const a = findCol(first, AMOUNT_KEYS);
    if (a < 0) return { rows: [], error: "Add an amount column (name, gloam_address, amount)." };
    cols = { name: n, recipient: r, amount: a, note: findCol(first, NOTE_KEYS) };
    start = 1;
  } else if (first.length === 2) {
    cols = { name: 0, recipient: -1, amount: 1, note: -1 };
  }

  const body = lines.slice(start);
  if (body.length > PAYROLL_MAX_ROWS) {
    return { rows: [], error: `Up to ${PAYROLL_MAX_ROWS} people per run. Split the list into smaller batches.` };
  }

  const rows = body.map(({ l, i }, idx): DraftRow => {
    const c = splitCsvLine(l);
    const name = (cols.name >= 0 ? c[cols.name] : "")?.slice(0, 60) || `Person ${idx + 1}`;
    const recipient = (cols.recipient >= 0 ? c[cols.recipient] : "")?.trim() ?? "";
    const amountInput = (c[cols.amount] ?? "").replace(/[$\s]/g, "");
    const note = cols.note >= 0 ? cleanPaymentNote(c[cols.note]) : "";
    let error: string | null = null;
    let kind: PayeeKind = "link";
    if (recipient) {
      if (isValidReceiveTag(recipient)) {
        kind = "gloam";
      } else if (isReceiveTag(recipient)) {
        error = "That Gloam address is incomplete or mistyped. Copy it again from their Receive page.";
      } else if (/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
        error = "That is a public wallet, paying it would show the amount. Use their Gloam address, or leave it blank for a claim link.";
      } else {
        error = "Not a Gloam address (they start with gloamr1). Leave it blank to send a claim link.";
      }
    }
    // the same reader as every amount field: "1,25" or "-1" is a row error, never 125 or 1
    const read = readAmountText(amountInput, assetDecimals(asset));
    const amount = read.ok ? parseAssetAmount(amountInput, asset) : null;
    if (!error && !read.ok) {
      error = read.error;
    } else if (!error && (amount === null || amount <= 0n)) {
      error = "Enter an amount above zero.";
    }
    return { line: i, name, recipient: kind === "gloam" ? recipient : "", kind, amountInput, amount, note, error };
  });
  return { rows, error: null };
}

export function draftTotal(rows: DraftRow[]): bigint {
  return rows.reduce((s, r) => s + (r.error || r.amount == null ? 0n : r.amount), 0n);
}

// ------------------------------------------------------------------ funding

/** Spendable notes for this asset on the active network, with tree positions. */
export function fundingNotes(address: string, asset: Address, tree: SyncedTree | null): LocalNote[] {
  return activeSpendableNotes(loadLocalNotes(address))
    .filter((n) => n.asset.toLowerCase() === asset.toLowerCase() && n.scheme !== "keccak")
    .map((n) => {
      if (n.leafIndex != null) return n;
      const idx = tree?.indexByCommitment.get(n.commitment.toLowerCase());
      return idx != null ? { ...n, leafIndex: idx } : n;
    })
    .filter((n) => n.leafIndex != null);
}

/**
 * Can the current notes pay these amounts, given each payment must come out of
 * one note (with its change reused)? Returns how much more to add, as a single
 * deposit, to cover the rows that do not fit.
 */
export function fundingPlan(amounts: bigint[], notes: bigint[]): { covered: number; shortfall: bigint } {
  const pool = notes.filter((n) => n > 0n).sort((a, b) => (a < b ? -1 : 1));
  let covered = 0;
  let shortfall = 0n;
  for (const amt of amounts) {
    const i = pool.findIndex((n) => n >= amt);
    if (i < 0) {
      shortfall += amt;
      continue;
    }
    covered++;
    const change = pool[i] - amt;
    pool.splice(i, 1);
    if (change > 0n) {
      const j = pool.findIndex((n) => n > change);
      pool.splice(j < 0 ? pool.length : j, 0, change);
    }
  }
  return { covered, shortfall };
}

// ------------------------------------------------------------------ storage

// Runs are stored in lib/payrollStore, which the recovery backup reads too.
export { deleteBatch, loadBatches, saveBatch } from "@/lib/payrollStore";

export function newBatch(args: {
  title: string;
  chainId: number;
  pool: Address;
  asset: Address;
  employer: Address;
  relay: boolean;
  rows: DraftRow[];
  /** The schedule this run pays, and the payday (YYYY-MM-DD) it covers. */
  schedule?: { id: string; payday: string };
}): PayrollBatch {
  const stamp = Date.now();
  return {
    ...(args.schedule ? { scheduleId: args.schedule.id, payday: args.schedule.payday } : {}),
    id: `pr-${stamp}`,
    title: args.title,
    createdAt: stamp,
    chainId: args.chainId,
    pool: args.pool,
    asset: args.asset,
    employer: args.employer,
    relay: args.relay,
    status: "draft",
    rows: args.rows
      .filter((r) => !r.error && r.amount != null)
      .map((r, i) => ({
        id: `${stamp}-${i}`,
        name: r.name,
        recipient: r.recipient,
        kind: r.kind,
        amount: r.amount!.toString(),
        ...(r.note ? { note: r.note } : {}),
        status: "queued" as const,
      })),
  };
}

// ------------------------------------------------------------------ links + export

export function claimLink(origin: string, networkKey: string, code: string): string {
  // The code rides in the URL fragment, which browsers never send to a server.
  return claimLinkFor(code, networkKey, origin);
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function exportResultsCsv(
  batch: PayrollBatch,
  opts: { origin: string; networkKey: string; assetLabel: string; explorerTx: (h: string) => string }
): string {
  // The note column only shows up when the run had notes, so older exports read the same.
  const withNotes = batch.rows.some((r) => r.note);
  const head = ["name", "paid_to", "amount", "asset", "status", "claim_link", "payment_code", "transaction", ...(withNotes ? ["note"] : [])];
  const lines = batch.rows.map((r) => {
    const link = r.kind === "link" && r.ticket ? claimLink(opts.origin, opts.networkKey, r.ticket) : "";
    // Direct payees whose notification did not post need their encrypted code.
    const code = r.kind === "gloam" && r.ticket && !r.memoPosted ? r.ticket : "";
    return [
      r.name,
      r.kind === "gloam" ? r.recipient : "claim link",
      formatAssetAmount(r.amount, batch.asset, 6),
      opts.assetLabel,
      r.status,
      link,
      code,
      r.txHash ? opts.explorerTx(r.txHash) : "",
      ...(withNotes ? [r.note ?? ""] : []),
    ]
      .map(csvCell)
      .join(",");
  });
  return [head.join(","), ...lines].join("\n");
}

// ------------------------------------------------------------------ engine

export type SubmitTransfer = (args: {
  proof: Hex;
  root: Hex;
  nullifier: Hex;
  commitments: readonly [Hex, Hex];
}) => Promise<Hex>;

export type SubmitMemo = (args: { paymentCommitment: Hex; memo: Hex }) => Promise<Hex>;

export type PayrollEngineDeps = {
  client: PublicClient;
  submitTransfer: SubmitTransfer;
  /** null when no memo board is live on this network */
  submitMemo: SubmitMemo | null;
  waitForTx: (hash: Hex) => Promise<"success" | "reverted">;
  onUpdate: (batch: PayrollBatch) => void;
  shouldStop: () => boolean;
  /** The vault tree and the prover: the app's own unless a test passes its own (scripts/selftest-payroll.mts). */
  syncTree?: () => Promise<SyncedTree | null>;
  prove?: (input: TransferWitness["circomInput"]) => Promise<{ proofBytes: Hex }>;
};

export class PayrollStop extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function syncUntil(deps: PayrollEngineDeps, commitment?: string, tries = 8): Promise<SyncedTree | null> {
  let tree: SyncedTree | null = null;
  for (let i = 0; i < tries; i++) {
    tree = await (deps.syncTree ? deps.syncTree() : syncShieldTree(deps.client));
    if (!commitment || tree?.indexByCommitment.has(commitment.toLowerCase())) return tree;
    await sleep(1_250);
  }
  return tree;
}

async function isSpent(client: PublicClient, pool: Address, nullifier: Hex, blockNumber?: bigint): Promise<boolean> {
  return (await client.readContract({
    address: pool,
    abi: shieldPoolAbi,
    functionName: "isSpent",
    args: [nullifier],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  })) as boolean;
}

async function commitmentSeen(client: PublicClient, pool: Address, commitment: Hex, blockNumber?: bigint): Promise<boolean> {
  return (await client.readContract({
    address: pool,
    abi: shieldPoolAbi,
    functionName: "commitmentSeen",
    args: [commitment],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  })) as boolean;
}

/**
 * Run (or resume) a payroll batch. Mutates and persists `batch` as it goes and
 * reports every change through deps.onUpdate. Resolves when every row is paid
 * or failed, or when stopped / out of funds / waiting on the chain (batch.status
 * says which).
 */
export async function runPayroll(batch: PayrollBatch, deps: PayrollEngineDeps): Promise<PayrollBatch> {
  const { client } = deps;
  const emit = async () => {
    deps.onUpdate({ ...batch, rows: batch.rows.map((r) => ({ ...r })) });
    await saveBatch(batch);
  };
  batch.status = "running";
  await emit();

  try {
    for (const row of batch.rows) {
      if (row.status === "paid" || row.status === "failed") continue;
      if (deps.shouldStop()) throw new PayrollStop();

      // Resume: a payment on record landed, can never land, or may still land.
      if (row.spendNullifier) {
        const outcome = await sentOutcome(client, batch.pool, row);
        if (outcome === "landed") {
          await settlePaid(batch, row, deps, emit);
          continue;
        }
        if (outcome === "unknown" || (outcome === "pending" && (await mayStillLand(client, row)))) {
          await holdUnconfirmed(row, STILL_CONFIRMING, emit);
        }
        if (outcome === "dead") discardDead(row);
        // Still pending past its window: payRow sends that same payment again.
      }

      await payRow(batch, row, deps, emit);
    }
    batch.status = "done";
  } catch (e) {
    if (e instanceof PayrollStop) {
      if (batch.status === "running") batch.status = "paused";
    } else {
      batch.status = "paused";
      throw e;
    }
  } finally {
    await emit();
  }
  return batch;
}

/** How long a sent payment gets to land before the run sends that same payment again. */
const LAND_WINDOW_MS = 10 * 60_000;
const STILL_CONFIRMING = "Sent. The network hasn't confirmed it yet. Resume the run in a minute to check.";
const NOT_CONFIRMED =
  "Not confirmed yet. Gloam keeps this payment as it is, and it can only ever land once. Resume the run to check again.";
const RESEND_BLOCKED = "Could not rebuild this payment exactly as it was sent, so it is kept as it is.";

/**
 * What the chain shows for this row's payment:
 *  - landed: the pool holds this row's own payment commitment. A spent note
 *    alone is not enough, another send could have spent it.
 *  - dead: the note it spends is spent and the payment is not in the pool, so
 *    it can never land and its codes can go.
 *  - pending: neither yet. It may still land, so the row keeps its codes.
 *  - unknown: the chain could not be read.
 * Both are read at one block: a balanced RPC can send two reads to nodes a
 * block apart, and "spent" from one with "not seen" from the other would call
 * a payment that landed dead and throw its codes away. A node that doesn't
 * have that block yet fails the read, which counts as unknown.
 */
async function sentOutcome(
  client: PublicClient,
  pool: Address,
  row: PayrollRow
): Promise<"landed" | "dead" | "pending" | "unknown"> {
  if (!row.spendNullifier || !row.paymentCommitment) return "dead";
  const blockNumber = await client.getBlockNumber().catch(() => null);
  if (blockNumber === null) return "unknown";
  const [spent, seen] = await Promise.all([
    isSpent(client, pool, row.spendNullifier, blockNumber).catch(() => null),
    commitmentSeen(client, pool, row.paymentCommitment, blockNumber).catch(() => null),
  ]);
  if (seen === true) return "landed";
  if (seen === false && spent === true) return "dead";
  if (seen === null || spent === null) return "unknown";
  return "pending";
}

/**
 * The last send went out under ten minutes ago with no final answer, so give it
 * time before sending the same payment again. A reverted receipt is final, and a
 * payment never handed to a wallet or the relay has nothing in flight.
 */
async function mayStillLand(client: PublicClient, row: PayrollRow): Promise<boolean> {
  if (!row.sentAt || Date.now() - row.sentAt > LAND_WINDOW_MS) return false;
  if (!row.txHash) return true;
  const receipt = await client.getTransactionReceipt({ hash: row.txHash }).catch(() => null);
  return receipt?.status !== "reverted";
}

/** After a good receipt: the pool shows this row's payment (read a few times, for a lagging RPC). */
async function confirmLanded(client: PublicClient, pool: Address, row: PayrollRow): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    if ((await sentOutcome(client, pool, row)) === "landed") return true;
    if (i < 3) await sleep(1_250);
  }
  return false;
}

/** Keep the row and its payment exactly as they are, and stop until the chain settles it. */
async function holdUnconfirmed(row: PayrollRow, why: string, emit: () => Promise<void>): Promise<never> {
  row.status = "unconfirmed";
  row.error = why;
  await emit();
  throw new PayrollStop();
}

/** The wallet prompt was turned down, so this send never went out. */
function isDeclined(e: unknown): boolean {
  let x = e as { name?: string; code?: number; message?: string; cause?: unknown } | undefined;
  for (let i = 0; x && i < 6; i++, x = x.cause as typeof x) {
    if (x.name === "UserRejectedRequestError" || x.code === 4001) return true;
    if (typeof x.message === "string" && /user (rejected|denied)/i.test(x.message)) return true;
  }
  return false;
}

/** Only for a payment the chain shows can never land (or that was never handed out). */
function discardPending(row: PayrollRow) {
  // The change note never reached the pool; hide it so it is not counted.
  if (row.changeNoteId) updateLocalNote(row.changeNoteId, { status: "recovered" });
  row.spendNoteId = undefined;
  row.spendNullifier = undefined;
  row.changeNoteId = undefined;
  row.paymentCommitment = undefined;
  row.changeSecret = undefined;
  row.changeCommitment = undefined;
  row.ticket = undefined;
  row.txHash = undefined;
  row.sentAt = undefined;
  row.paymentSecret = undefined;
  row.spendSecret = undefined;
  row.spendAmount = undefined;
}

/** Its note went into another payment: retire that note here too, then drop this one. */
function discardDead(row: PayrollRow) {
  if (row.spendNoteId) updateLocalNote(row.spendNoteId, { status: "recovered" });
  discardPending(row);
}

/**
 * The payment on record for this row, proven again against today's vault: the
 * same note spent into the same payment and change. Sending it again can never
 * pay twice. Both copies spend one note, so at most one lands, and whichever
 * does makes exactly the notes (and the payee's code) this row already holds.
 */
async function samePaymentWitness(
  batch: PayrollBatch,
  row: PayrollRow,
  tree: SyncedTree | null
): Promise<TransferWitness> {
  const local = loadLocalNotes(batch.employer);
  const spent = local.find((n) => n.id === row.spendNoteId);
  const secret = row.spendSecret ?? spent?.secret;
  const amountIn = row.spendAmount ?? spent?.amountWei;
  if (!tree || !secret || !amountIn || !row.paymentSecret || !row.paymentCommitment || !row.spendNullifier) {
    throw new Error(RESEND_BLOCKED);
  }
  const commitment =
    spent?.commitment ?? fieldToHex(await noteCommitmentPoseidon(hexToField(secret), BigInt(amountIn), batch.asset));
  const leaf = spent?.leafIndex ?? tree.indexByCommitment.get(commitment.toLowerCase());
  const path = leaf != null ? ((await tree.pathForLeaf(leaf)) as PoseidonMerklePath | null) : null;
  if (!path) throw new Error("Could not read the vault. Try again.");
  const w = await buildTransferWitness({
    secretHex: secret,
    amountIn: BigInt(amountIn),
    amountPay: BigInt(row.amount),
    asset: batch.asset,
    path,
  });
  if (w.blocker) throw new Error(w.blocker);
  if (fieldToBytes32(w.publicInputs.nullifier).toLowerCase() !== row.spendNullifier.toLowerCase()) {
    throw new Error(RESEND_BLOCKED);
  }

  // Swap the fresh outputs for the ones on record, each checked against its commitment.
  const opens = async (s: Hex, amount: string, c: Hex) =>
    (await noteCommitmentPoseidon(hexToField(s), BigInt(amount), batch.asset)) === hexToField(c);
  const pay = { secret: row.paymentSecret, commitment: row.paymentCommitment };
  if (!(await opens(pay.secret, w.paymentNote.amountWei, pay.commitment))) throw new Error(RESEND_BLOCKED);
  const changeNote = row.changeNoteId ? local.find((n) => n.id === row.changeNoteId) : undefined;
  const change =
    row.changeSecret && row.changeCommitment
      ? { secret: row.changeSecret, commitment: row.changeCommitment }
      : changeNote
        ? { secret: changeNote.secret, commitment: changeNote.commitment }
        : null;
  if (change && !(await opens(change.secret, w.changeNote.amountWei, change.commitment))) {
    throw new Error(RESEND_BLOCKED);
  }
  // No change on record only ever means a zero change, which holds nothing to keep.
  if (!change && BigInt(w.changeNote.amountWei) > 0n) throw new Error(RESEND_BLOCKED);
  const c0 = hexToField(pay.commitment);
  const c1 = change ? hexToField(change.commitment) : w.publicInputs.newCommitment1;
  return {
    ...w,
    circomInput: {
      ...w.circomInput,
      secretPay: hexToField(pay.secret).toString(),
      newCommitment0: c0.toString(),
      ...(change ? { secretChange: hexToField(change.secret).toString(), newCommitment1: c1.toString() } : {}),
    },
    publicInputs: { ...w.publicInputs, newCommitment0: c0, newCommitment1: c1 },
  };
}

async function payRow(
  batch: PayrollBatch,
  row: PayrollRow,
  deps: PayrollEngineDeps,
  emit: () => Promise<void>
) {
  const amount = BigInt(row.amount);
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (deps.shouldStop()) throw new PayrollStop();
    row.attempts = attempt;
    row.status = "preparing";
    row.error = undefined;
    await emit();

    const tree = await syncUntil(deps);
    // A payment already on record (sent before, maybe still landing) goes out
    // again exactly as it was. Otherwise a new one is built.
    let note: LocalNote | undefined;
    if (!row.spendNullifier) {
      note = fundingNotes(batch.employer, batch.asset, tree)
        .filter((n) => BigInt(n.amountWei) >= amount)
        .sort((a, b) => (BigInt(a.amountWei) < BigInt(b.amountWei) ? -1 : 1))[0];
      if (!note) {
        batch.status = "needs_funds";
        row.status = "queued";
        row.error = "Not enough in one private balance entry for this payment. Add money privately, then resume.";
        await emit();
        throw new PayrollStop();
      }
    }

    let declined = false;
    try {
      let w: TransferWitness;
      if (note) {
        const path = (await tree!.pathForLeaf(note.leafIndex!)) as PoseidonMerklePath | null;
        if (!path) throw new Error("Could not read the vault. Try again.");
        w = await buildTransferWitness({
          secretHex: note.secret,
          amountIn: BigInt(note.amountWei),
          amountPay: amount,
          asset: batch.asset,
          path,
        });
        if (w.blocker) throw new Error(w.blocker);
      } else {
        w = await samePaymentWitness(batch, row, tree);
      }
      const { proofBytes } = deps.prove ? await deps.prove(w.circomInput) : await proveTransferInBrowser(w.circomInput);

      if (note) {
        const pack = buildNotePackage({
          pool: batch.pool,
          asset: batch.asset,
          amountWei: w.paymentNote.amountWei,
          secret: w.paymentNote.secret,
          commitment: w.paymentNote.commitment,
          note: row.note,
        });
        const plain = encodeNotePackage(pack);
        const ticket = row.kind === "gloam" ? await encryptTicketForTag(plain, row.recipient) : plain;

        // Persist the change note and the row BEFORE submitting (crash safety).
        // The change is out of the balance until the payment lands (the note it
        // comes from still counts until then); finalizeTransfer counts it, or the
        // sync settles it with the note it came from (lib/claimSweep).
        const spendNullifier = fieldToBytes32(w.publicInputs.nullifier);
        let changeNoteId: string | undefined;
        if (BigInt(w.changeNote.amountWei) > 0n) {
          // Never reused: a later payment for this row must not overwrite an earlier change.
          changeNoteId = `chg-pr-${row.id}-${Date.now()}`;
          saveLocalNote({
            id: changeNoteId,
            chainId: batch.chainId,
            pool: batch.pool,
            asset: batch.asset,
            amountWei: w.changeNote.amountWei,
            commitment: w.changeNote.commitment,
            secret: w.changeNote.secret,
            nullifier: w.changeNote.nullifier,
            bound: true,
            scheme: "poseidon",
            from: batch.employer,
            createdAt: Date.now(),
            status: "open",
            source: "local",
            sweptFrom: { id: note.id, nullifier: spendNullifier },
            sweepPending: true,
          });
        }
        row.spendNoteId = note.id;
        row.spendNullifier = spendNullifier;
        row.changeNoteId = changeNoteId;
        row.paymentCommitment = fieldToBytes32(w.publicInputs.newCommitment0);
        row.changeSecret = w.changeNote.secret;
        row.changeCommitment = w.changeNote.commitment;
        row.ticket = ticket;
        row.paymentSecret = w.paymentNote.secret;
        row.spendSecret = note.secret;
        row.spendAmount = note.amountWei;
      }
      const lastSend = { sentAt: row.sentAt, txHash: row.txHash };
      row.status = "sending";
      row.sentAt = Date.now();
      row.txHash = undefined;
      await emit();

      let hash: Hex;
      try {
        hash = await deps.submitTransfer({
          proof: proofBytes,
          root: fieldToBytes32(w.publicInputs.root),
          nullifier: row.spendNullifier!,
          commitments: [row.paymentCommitment!, fieldToBytes32(w.publicInputs.newCommitment1)],
        });
      } catch (e) {
        if (isDeclined(e)) {
          declined = true;
          row.sentAt = lastSend.sentAt;
          row.txHash = lastSend.txHash;
        }
        throw e;
      }
      row.txHash = hash;
      row.status = "confirming";
      await emit();

      const outcome = await deps.waitForTx(hash);
      if (outcome !== "success") throw new Error("The payment was rejected on-chain.");
      // A good receipt is not enough: paid means the pool holds this row's own payment.
      if (!(await confirmLanded(deps.client, batch.pool, row))) throw new Error(STILL_CONFIRMING);

      await settlePaid(batch, row, deps, emit);
      return;
    } catch (e) {
      if (e instanceof PayrollStop) throw e;
      const msg = e instanceof Error ? e.message : "Payment failed";
      if (row.spendNullifier && declined && !row.sentAt) {
        // Turned down before this payment ever went out: nothing can land.
        discardPending(row);
      } else if (row.spendNullifier) {
        // It may have landed despite the error (a receipt timeout, a lost relay reply).
        const outcome = await sentOutcome(deps.client, batch.pool, row);
        if (outcome === "landed") {
          await settlePaid(batch, row, deps, emit);
          return;
        }
        if (outcome === "unknown" || (outcome === "pending" && (await mayStillLand(deps.client, row)))) {
          // keep the row and the payee's code: resuming settles it from the chain
          await holdUnconfirmed(row, STILL_CONFIRMING, emit);
        }
        if (outcome === "dead") discardDead(row);
      }
      row.error = msg;
      if (declined) {
        // Resuming asks the wallet again (for the same payment, if one is still on record).
        row.status = "queued";
        await emit();
        throw new PayrollStop();
      }
      if (attempt === 3) {
        // Handed out before and not ruled out by the chain: never called failed.
        if (row.spendNullifier && row.sentAt) await holdUnconfirmed(row, NOT_CONFIRMED, emit);
        discardPending(row);
        row.status = "failed";
        await emit();
        return;
      }
      await sleep(1_500);
    }
  }
}

/** The row's own payment is in the pool: book it, let a Gloam-address payee know, mark it paid. */
async function settlePaid(batch: PayrollBatch, row: PayrollRow, deps: PayrollEngineDeps, emit: () => Promise<void>) {
  await finalizeTransfer(batch, row, deps);
  await notify(batch, row, deps, emit);
  row.status = "paid";
  // A code only the payer holds (a claim link, a heads-up that didn't post)
  // is money until the payee moves it: Sent links keeps it, backs it up and
  // offers Take back.
  await keepPaidCodes(batch).catch(() => undefined);
  await emit();
}

async function finalizeTransfer(batch: PayrollBatch, row: PayrollRow, deps: PayrollEngineDeps) {
  // A payroll payment is a private payment too (retires the first-payment nudge).
  markPrivatePaid(batch.chainId);
  // A payee paid by link got a claim link, which the claim-link counts include (lib/funnel).
  if (row.kind === "link") countLinkCreated();
  if (row.spendNoteId) updateLocalNote(row.spendNoteId, { status: "recovered", txHash: row.txHash });
  if (row.changeNoteId) {
    const notes = loadLocalNotes(batch.employer);
    const change = notes.find((n) => n.id === row.changeNoteId);
    const tree = await syncUntil(deps, change?.commitment);
    const idx = change ? tree?.indexByCommitment.get(change.commitment.toLowerCase()) : undefined;
    // landed: the change counts from now on
    updateLocalNote(row.changeNoteId, { leafIndex: idx, txHash: row.txHash, sweepPending: false });
  }
}

async function notify(batch: PayrollBatch, row: PayrollRow, deps: PayrollEngineDeps, emit: () => Promise<void>) {
  if (row.kind !== "gloam" || row.memoPosted || !deps.submitMemo || !row.ticket || !row.paymentCommitment) return;
  row.status = "notifying";
  await emit();
  try {
    const h = await deps.submitMemo({
      paymentCommitment: row.paymentCommitment,
      memo: ticketToMemoBytes(row.ticket),
    });
    row.memoPosted = (await deps.waitForTx(h)) === "success";
  } catch {
    // The money already landed; they can still claim with the payment code.
    row.memoPosted = false;
  }
}

// ------------------------------------------------------------------ total proof

/** Why a run's total cannot be proven yet, in plain words. */
const OLD_RUN =
  "This run was paid with an older version of Gloam that did not keep what a total proof needs, so it cannot be proven. Runs paid from now on can.";

/**
 * Every paid payment of a run with what its total proof needs, in run order.
 * New runs keep it on each row; older runs can still be proven when every
 * payee was a claim link (the code holds the payee's secret) and the notes
 * they spent are still on this device. Failed rows paid nothing and are left out.
 */
export async function payrollProofNotes(
  batch: PayrollBatch
): Promise<{ notes: PayrollNote[]; failed: number } | { blocker: string }> {
  if (batch.status !== "done") return { blocker: "Finish the run first. A total can only be proven once every payment is settled." };
  const paid = batch.rows.filter((r) => r.status === "paid");
  if (!paid.length) return { blocker: "Nobody was paid in this run, so there is no total to prove." };
  const local = typeof window === "undefined" ? [] : loadLocalNotes(batch.employer);
  const notes: PayrollNote[] = [];
  for (const r of paid) {
    if (!r.paymentCommitment || !r.spendNullifier) return { blocker: OLD_RUN };
    let secret = r.paymentSecret;
    if (!secret && r.kind === "link" && r.ticket) {
      try {
        const pack = await decodeNotePackage(r.ticket);
        if (pack.commitment.toLowerCase() === r.paymentCommitment.toLowerCase()) secret = pack.secret;
      } catch {
        /* not a plain claim code */
      }
    }
    const spent = r.spendSecret ? null : local.find((n) => n.id === r.spendNoteId);
    const spendSecret = r.spendSecret ?? spent?.secret;
    const spendAmount = r.spendAmount ?? spent?.amountWei;
    if (!secret || !spendSecret || !spendAmount) return { blocker: OLD_RUN };
    notes.push({
      secret,
      amount: BigInt(r.amount),
      commitment: r.paymentCommitment,
      spendSecret,
      spendAmount: BigInt(spendAmount),
      nullifier: r.spendNullifier,
      txHash: r.txHash ?? null,
    });
  }
  return { notes, failed: batch.rows.filter((r) => r.status === "failed").length };
}

/**
 * Recording demo: a simulated run makes no notes, so each paid row gets the
 * records a real run keeps (made-up keys, real Poseidon openings). A total
 * proof built from them is a demo proof, which only a demo tab on this device
 * accepts (lib/demo/proof).
 */
export async function withDemoProofRecords(batch: PayrollBatch): Promise<PayrollBatch> {
  const rows = await Promise.all(
    batch.rows.map(async (r) => {
      if (r.status !== "paid" || r.paymentSecret) return r;
      const amount = BigInt(r.amount);
      const secret = await randomSecretField();
      const spendSecret = await randomSecretField();
      const spendAmount = amount * 4n;
      const commitment = await noteCommitmentPoseidon(secret, amount, batch.asset);
      const spent = await noteCommitmentPoseidon(spendSecret, spendAmount, batch.asset);
      return {
        ...r,
        paymentCommitment: fieldToHex(commitment),
        spendNullifier: fieldToHex(await noteNullifierPoseidon(spendSecret, spent)),
        paymentSecret: fieldToHex(secret),
        spendSecret: fieldToHex(spendSecret),
        spendAmount: spendAmount.toString(),
      };
    })
  );
  return { ...batch, rows };
}
