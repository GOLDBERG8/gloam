"use client";

/**
 * "Cash out later", browser side (the relay keeps and sends the job:
 * lib/relay/scheduled). The note being cashed out is marked with its job
 * (LocalNote.cashOut) in the encrypted local vault, so a closed tab never loses
 * track of it, and is kept out of the balance while it waits.
 *
 * reconcileCashOuts asks the relay how each job stands. One that went out is
 * settled by the chain like any spend (the note's nullifier shows spent). One
 * that came back unsent (it waited past the vault's proof window, kept failing
 * or was cancelled) makes the note spendable again: nothing moved.
 */
import type { Address, Hex } from "viem";
import { getAllNotes } from "./noteVault";
import { updateLocalNote, type CashOutMark, type LocalNote } from "./shield";

export type CashOutWindow = "hour" | "6h";

export type CashOutJobView = {
  id: string;
  chainId: number;
  sendAfter: number;
  status: "scheduled" | "sending" | "sent" | "expired" | "spent" | "failed" | "cancelled";
  updatedAt: number;
  hash?: Hex;
  reason?: string;
};

export class CashOutLaterError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
  }
}

/** A sent job whose spend the chain still doesn't show after this long did not land. */
const SENT_GRACE_MS = 30 * 60 * 1000;

/** Hands a proven cash out to the relay to send at a random time inside `window`. */
export async function scheduleCashOut(p: {
  chainId: number;
  proof: Hex;
  root: Hex;
  nullifier: Hex;
  asset: Address;
  to: Address;
  amount: bigint;
  window: CashOutWindow;
}): Promise<CashOutJobView> {
  let res: Response;
  try {
    res = await fetch("/api/relay/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...p, amount: p.amount.toString() }),
    });
  } catch {
    throw new CashOutLaterError("Could not reach the relay. Check your connection.", "network");
  }
  const json = (await res.json().catch(() => ({}))) as Partial<CashOutJobView> & { ok?: boolean; error?: string; code?: string };
  if (!res.ok || !json.ok || !json.id || typeof json.sendAfter !== "number") {
    throw new CashOutLaterError(json.error ?? "Could not schedule this cash out.", json.code ?? "error");
  }
  return json as CashOutJobView;
}

/** The job's status, "gone" once the relay no longer keeps it, or null when it could not be read. */
export async function cashOutJobStatus(id: string): Promise<CashOutJobView | "gone" | null> {
  try {
    const res = await fetch(`/api/relay/scheduled?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 404) return "gone";
    const json = (await res.json().catch(() => ({}))) as Partial<CashOutJobView> & { ok?: boolean };
    return res.ok && json.ok && json.status ? (json as CashOutJobView) : null;
  } catch {
    return null;
  }
}

/**
 * Cancels a job that has not gone out. True when it can no longer go out:
 * cancelled now, or already over without sending (expired, failed, or gone
 * from the relay, which then has no proof to send). False when it is going
 * out or went out, or the relay could not be asked.
 */
export async function cancelCashOut(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/relay/scheduled?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.status === 404) return true;
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string };
    return Boolean(json.ok) || json.status === "expired" || json.status === "failed" || json.status === "cancelled";
  } catch {
    return false;
  }
}

/** Notes with a cash out still waiting or on its way. */
export function scheduledCashOutNotes(notes: LocalNote[] = getAllNotes()): LocalNote[] {
  return notes.filter((n) => n.status !== "recovered" && (n.cashOut?.state === "scheduled" || n.cashOut?.state === "sent"));
}

/** Notes whose scheduled cash out came back unsent, for a one-time notice. */
export function returnedCashOutNotes(notes: LocalNote[] = getAllNotes()): LocalNote[] {
  return notes.filter(
    (n) => n.status !== "recovered" && (n.cashOut?.state === "expired" || n.cashOut?.state === "failed")
  );
}

/** What a job's status means for its note, or null to leave the mark as it is. */
export function nextMark(mark: CashOutMark, view: CashOutJobView | "gone", now = Date.now()): CashOutMark | null {
  if (view === "gone") {
    // The relay forgot it (days later). If it had gone out, the chain settles the note first.
    return { ...mark, state: "failed" };
  }
  switch (view.status) {
    case "scheduled":
    case "sending":
      return view.sendAfter !== mark.at ? { ...mark, at: view.sendAfter } : null;
    case "sent":
      if (mark.state === "sent" && now - view.updatedAt > SENT_GRACE_MS) return { ...mark, state: "failed" };
      return mark.state === "sent" ? null : { ...mark, state: "sent" };
    case "spent":
      // The note's own spend: the chain marks it spent on the next read.
      return mark.state === "sent" ? null : { ...mark, state: "sent" };
    case "expired":
    case "failed":
    case "cancelled":
      return { ...mark, state: view.status };
  }
}

/** Updates every waiting cash out from the relay. True when a note changed. */
export async function reconcileCashOuts(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  let changed = false;
  for (const n of scheduledCashOutNotes()) {
    const mark = n.cashOut!;
    const view = await cashOutJobStatus(mark.job);
    if (view === null) continue;
    const next = nextMark(mark, view);
    if (next) {
      updateLocalNote(n.id, { cashOut: next });
      changed = true;
    }
  }
  return changed;
}

/** Clears the notice on a note whose cash out came back, once it was shown or it is spent again. */
export function dismissReturnedCashOut(noteId: string) {
  updateLocalNote(noteId, { cashOut: undefined });
}
