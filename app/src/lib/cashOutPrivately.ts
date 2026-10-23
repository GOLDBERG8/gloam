"use client";

/**
 * "Cash out privately": one cash out made into a few pieces (lib/cashOutPlan
 * picks them), each handed to the relay through "cash out later", so each goes
 * out at its own random time inside the window the person picked.
 *
 * No new money logic: each piece is split off with lib/cashOutSplit (a private
 * transfer to the person's own two new notes, both saved before it is sent),
 * proven like any cash out (lib/cashOutProof), and scheduled with
 * lib/cashOutLater. One piece at a time, in order: split it off, prove it,
 * schedule it, then the next one from the change. Everything goes through the
 * relay, so the wallet never shows.
 *
 * Every piece is tagged (LocalNote.cashOutPlan) when it is split off, before
 * anything is sent. So whatever stops a run (a refused split, a relay that is
 * down, a closed tab), nothing is lost and nothing is hidden:
 *  - pieces already scheduled go out as planned, and each can be cancelled;
 *  - a piece split off but not scheduled stays in the private balance and
 *    shows as one (unscheduledPieces), to schedule again or keep;
 *  - the rest of the money stays in the private balance as one note;
 *  - a split that may have gone out keeps both its notes, out of the balance
 *    until the next sync settles them (lib/claimSweep), like any split.
 * A run stops at the first problem. It never guesses past one.
 */
import type { Address, Hex } from "viem";
import { cashOutPending, updateLocalNote, type LocalNote } from "./shield";
import { getAllNotes } from "./noteVault";
import type { PoseidonMerklePath } from "./merklePoseidon";
import { proveCashOut, type CashOutCall } from "./cashOutProof";
import { freshPath, SPLIT_MAYBE_SENT, splitNote, type SplitArgs } from "./cashOutSplit";
import { scheduleNoteCashOut, type CashOutWindow, type OwnedCashOutJob } from "./cashOutLater";
import { MAX_PIECES, MIN_PIECES } from "./cashOutPlan";

export type PieceState = "waiting" | "splitting" | "proving" | "scheduling" | "scheduled" | "stopped";

export type PieceProgress = { amount: bigint; to: Address; state: PieceState; at?: number };

/** What a run uses to move money: the app's own paths, swapped for fakes in the selftest. */
export type PrivateCashOutDeps = {
  /** A note's path in the vault tree, read fresh from the chain. */
  pathOf: (n: LocalNote) => Promise<PoseidonMerklePath | null>;
  split: (a: SplitArgs) => Promise<{ part: LocalNote; change: LocalNote | null }>;
  prove: (n: LocalNote, to: Address, path: PoseidonMerklePath, chainId: number) => Promise<CashOutCall>;
  schedule: (n: LocalNote, call: CashOutCall, window: CashOutWindow) => Promise<OwnedCashOutJob>;
  newId: () => string;
};

const appDeps: PrivateCashOutDeps = {
  pathOf: async (n) => (await freshPath(n.commitment))?.path ?? null,
  split: splitNote,
  prove: proveCashOut,
  schedule: scheduleNoteCashOut,
  newId: () => crypto.randomUUID(),
};

export type PrivateCashOutResult = {
  /** The jobs the relay holds, in piece order. */
  jobs: OwnedCashOutJob[];
  /** null when every piece is scheduled; else the piece (from 0) the run stopped at. */
  stoppedAt: number | null;
  /** What stopped it, in plain words. */
  error: string | null;
  /** The split that stopped it may have gone out: its notes settle on the next sync. */
  maybeSent: boolean;
};

const NO_PATH = "Could not read your private balance. Refresh and try again.";

/** The relay sends every step of a private cash out; the wallet is never asked. */
function noWallet(): Promise<Hex> {
  return Promise.reject(new Error("A private cash out goes through the Gloam relay."));
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/**
 * Checks a plan against its note before anything moves: 2 to 4 pieces, each
 * with an address, adding up to at most the note. Throws in plain words.
 */
export function checkPlan(note: LocalNote, pieces: bigint[], to: Address[]): void {
  if (pieces.length < MIN_PIECES || pieces.length > MAX_PIECES) throw new Error("A private cash out has 2 to 4 pieces.");
  if (to.length !== pieces.length) throw new Error("Each piece needs an address.");
  if (pieces.some((p) => p <= 0n)) throw new Error("Each piece needs an amount.");
  const total = pieces.reduce((s, p) => s + p, 0n);
  if (total > BigInt(note.amountWei)) throw new Error("The pieces add up to more than this balance.");
  if (note.status === "recovered" || note.sweepPending || cashOutPending(note)) {
    throw new Error("This balance is busy. Refresh and try again.");
  }
}

/**
 * Runs a private cash out of `pieces` (base units, adding up to at most the
 * note) to `to` (one address per piece), each scheduled inside `window`.
 * Resolves with what was scheduled and, when it stopped early, where and why;
 * it throws only when the plan is refused before anything moved.
 */
export async function runPrivateCashOut(args: {
  note: LocalNote;
  pieces: bigint[];
  to: Address[];
  window: CashOutWindow;
  owner: Address;
  onStatus?: (s: string) => void;
  onPiece?: (i: number, p: Partial<PieceProgress>) => void;
  deps?: Partial<PrivateCashOutDeps>;
}): Promise<PrivateCashOutResult> {
  const { note, pieces, to, window, owner } = args;
  checkPlan(note, pieces, to);
  const d: PrivateCashOutDeps = { ...appDeps, ...args.deps };
  const status = args.onStatus ?? (() => {});
  const piece = args.onPiece ?? (() => {});
  const n = pieces.length;
  const whole = pieces.reduce((s, p) => s + p, 0n) === BigInt(note.amountWei);
  const plan = d.newId();
  const tagOf = (i: number) => ({ plan, piece: i + 1, of: n, to: to[i]!, window });
  const jobs: OwnedCashOutJob[] = [];
  const stop = (i: number, e: unknown): PrivateCashOutResult => {
    piece(i, { state: "stopped" });
    const error = e instanceof Error && e.message ? e.message : "Something went wrong.";
    return { jobs, stoppedAt: i, error, maybeSent: error === SPLIT_MAYBE_SENT };
  };

  let rest: LocalNote = note;
  for (let i = 0; i < n; i++) {
    const label = `Piece ${i + 1} of ${n}`;
    let target: LocalNote;
    try {
      if (BigInt(rest.amountWei) === pieces[i]) {
        // The last piece of a plan for the whole note: the change of the split
        // before, tagged as this piece when it was made.
        target = rest;
      } else {
        piece(i, { state: "splitting" });
        status(`${label}: setting it aside…`);
        const path = await d.pathOf(rest);
        if (!path) throw new Error(NO_PATH);
        const { part, change } = await d.split({
          note: rest,
          amount: pieces[i]!,
          path,
          owner,
          relayOn: true,
          sendWithWallet: noWallet,
          onStatus: (s) => status(`${label}: ${lowerFirst(s)}`),
          partTag: tagOf(i),
          // when the pieces are the whole note, the change of the second-last split is the last piece
          changeTag: whole && i === n - 2 ? tagOf(n - 1) : undefined,
        });
        // Every split but one for the whole note leaves change; without it there is nothing left to split.
        if (!change && i < n - 1) throw new Error("The rest of this cash out could not be set aside. It is in your private balance.");
        target = part;
        if (change) rest = change;
      }
    } catch (e) {
      return stop(i, e);
    }
    try {
      piece(i, { state: "proving" });
      status(`${label}: proving privately…`);
      const path = await d.pathOf(target);
      if (!path) throw new Error(NO_PATH);
      const call = await d.prove(target, to[i]!, path, target.chainId);
      piece(i, { state: "scheduling" });
      status(`${label}: scheduling with the Gloam relay…`);
      const job = await d.schedule(target, call, window);
      jobs.push(job);
      piece(i, { state: "scheduled", at: job.sendAfter });
    } catch (e) {
      return stop(i, e);
    }
  }
  return { jobs, stoppedAt: null, error: null, maybeSent: false };
}

/**
 * Pieces of a private cash out that are in the private balance but not
 * scheduled: split off, then stopped (a relay that was down, a closed tab). A
 * piece whose cash out came back shows that notice instead, and one still
 * landing shows once the sync settles it.
 */
export function unscheduledPieces(notes: LocalNote[] = getAllNotes()): LocalNote[] {
  return notes.filter((n) => n.cashOutPlan && n.status !== "recovered" && !n.sweepPending && !n.cashOut);
}

/** Keeps a piece as plain money in the balance: it no longer shows as a piece to schedule. */
export function keepPiece(noteId: string) {
  updateLocalNote(noteId, { cashOutPlan: undefined });
}

// ---------------------------------------------------------------- the person's choice

const PREF_KEY = "gloam.cashout.private";

export type PrivateCashOutPref = {
  /** Cash out privately when it is offered (the default), or all at once. */
  on: boolean;
  window: CashOutWindow;
};

const WINDOWS: readonly CashOutWindow[] = ["hour", "6h", "day"];

/** What this browser last chose: privately, over about 6 hours, unless the person picked otherwise. */
export function readPrivatePref(): PrivateCashOutPref {
  const fallback: PrivateCashOutPref = { on: true, window: "6h" };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREF_KEY) ?? "null") as Partial<PrivateCashOutPref> | null;
    return {
      on: typeof raw?.on === "boolean" ? raw.on : fallback.on,
      window: raw?.window && WINDOWS.includes(raw.window) ? raw.window : fallback.window,
    };
  } catch {
    return fallback;
  }
}

export function savePrivatePref(patch: Partial<PrivateCashOutPref>) {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrivatePref(), ...patch }));
  } catch {
    /* a private window: the choice lasts this visit */
  }
}

/**
 * Schedules a piece that was split off but not scheduled, as it was planned:
 * the same address and window. The caller checks the address first, as for
 * any cash out.
 */
export async function schedulePiece(note: LocalNote, deps: Partial<PrivateCashOutDeps> = {}): Promise<OwnedCashOutJob> {
  const tag = note.cashOutPlan;
  if (!tag) throw new Error("This is not a piece of a private cash out.");
  const d: PrivateCashOutDeps = { ...appDeps, ...deps };
  const path = await d.pathOf(note);
  if (!path) throw new Error(NO_PATH);
  const call = await d.prove(note, tag.to, path, note.chainId);
  return d.schedule(note, call, tag.window);
}
