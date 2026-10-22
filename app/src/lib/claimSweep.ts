/**
 * Securing a claimed payment: the payee side of a person-to-person payment.
 *
 * A Gloam payment is a note: commitment = Poseidon(secret, amount, asset),
 * spent by revealing nullifier = Poseidon(secret, commitment). The payer picks
 * the secret, so the payer can spend the note too. Claiming a payment (a
 * gloam2t payment to a Gloam address, a gloam1 / gloam1e claim link, a payroll
 * payout) only saves it in this browser, and until the payee moves it the
 * payer could take it back.
 *
 * Securing moves it: a private transfer of the whole amount into a fresh note
 * whose secret only this browser knows (with a zero change note). Once that
 * lands, the claimed note's nullifier is spent by the payee and the money is
 * theirs alone. If the payer spends it first, the move cannot land and the
 * claim is dropped.
 *
 * The move is the SDK's sweep (packages/sdk/src/sweep.ts), the same one x402
 * and MPP payees settle with. This file supplies the app's side: the browser
 * prover, the vault reads, the relay or the wallet to send through, and the
 * local bookkeeping. The fresh note is saved before anything is sent and is
 * left out of the balance until it lands; it is never dropped, because a send
 * that looked failed can still land. reconcileClaims settles it from what the
 * chain shows.
 */
import {
  sweepReceivedNote,
  transferCallArgs,
  type PoseidonMerklePath,
  type Prover,
  type SweepChain,
  type SweepResult,
} from "@gloamtrade/sdk";
import type { Address, Hex } from "viem";
import { getActiveNetwork } from "./networks";
import { noteNullifierPoseidon } from "./notePoseidon";
import { fieldToHex, hexToField } from "./poseidon";
import { proveTransferInBrowser } from "./proveClient";
import { relayTransfer, waitForTx } from "./relay/client";
import { getRhPublicClient } from "./rhClient";
import { getAllNotes } from "./noteVault";
import { saveLocalNote, shieldPoolAbi, updateLocalNote, type LocalNote } from "./shield";
import { syncShieldTree } from "./treeSync";
import { escrowHolds } from "./vaultSwap";

/** Claimed payments are saved under this id prefix (MoveView). */
export const CLAIM_PREFIX = "imp-";
/** Fresh notes from securing a claim. */
const SECURED_PREFIX = "swp-";

export function claimNoteId(): string {
  return `${CLAIM_PREFIX}${Date.now()}`;
}

/** A payment someone else made that this browser claimed. */
export function isClaimedNote(n: LocalNote): boolean {
  return n.id.startsWith(CLAIM_PREFIX);
}

/** Claimed, still spendable, and not yet moved: the payer can still spend it. */
export function isUnsecuredClaim(n: LocalNote): boolean {
  return (
    isClaimedNote(n) &&
    !n.secured &&
    n.status !== "recovered" &&
    Boolean(n.secret) &&
    n.secret !== "0x"
  );
}

/** The fresh note a claim was secured into (a cash-out split also names the note it came from). */
export function isSecuredClaim(n: LocalNote): boolean {
  return Boolean(n.sweptFrom?.id.startsWith(CLAIM_PREFIX));
}

type Transfer = { chainId: number; proof: Hex; root: Hex; nullifier: Hex; commitments: readonly [Hex, Hex] };

/** What securing reads and calls: the app's own below, a test's own in scripts/. */
export type ClaimEnv = {
  /** The active network's vault. */
  chainId: number;
  pool: Address | null;
  chain: SweepChain;
  prove: Prover;
  relay: (t: Transfer) => Promise<Hex>;
  /** Where a commitment sits in the vault tree, once it is there. */
  leafIndexOf: (commitment: Hex) => Promise<number | undefined>;
  /**
   * A spend and a commitment read at one block, so two answers from nodes a
   * block apart can't call a move that landed dead. Null fields: unread.
   */
  stateAt?: (
    nullifier: Hex | null,
    commitment: Hex
  ) => Promise<{ spent: boolean | null; seen: boolean | null; block?: bigint | null }>;
  /**
   * A private swap's refund note: does its money wait at the swap's escrow, at
   * `block` (the block stateAt read)? Null: unread.
   */
  escrowWaiting?: (n: LocalNote, block: bigint) => Promise<boolean | null>;
  /** Puts a swap's waiting money back as its refund note (lib/vaultSwapRun). */
  finishRefund?: (n: LocalNote) => Promise<void>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readBool(pool: Address, fn: "isSpent" | "commitmentSeen", arg: Hex, blockNumber?: bigint): Promise<boolean> {
  return getRhPublicClient().readContract({
    address: pool,
    abi: shieldPoolAbi,
    functionName: fn,
    args: [arg],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  }) as Promise<boolean>;
}

/** Both reads at one block. A node without that block yet fails the read, which counts as unread. */
async function readStateAt(pool: Address, nullifier: Hex | null, commitment: Hex) {
  const block = await getRhPublicClient().getBlockNumber().catch(() => null);
  if (block === null) return { spent: null, seen: null, block: null };
  const [spent, seen] = await Promise.all([
    nullifier ? readBool(pool, "isSpent", nullifier, block).catch(() => null) : Promise.resolve(null),
    readBool(pool, "commitmentSeen", commitment, block).catch(() => null),
  ]);
  return { spent, seen, block };
}

/** The vault tree, waiting a little for a commitment that only just landed. */
async function findLeaf(commitment: Hex) {
  for (let i = 0; i < 4; i++) {
    const tree = await syncShieldTree(getRhPublicClient()).catch(() => null);
    const idx = tree?.indexByCommitment.get(commitment.toLowerCase());
    if (tree && idx != null) return { tree, idx };
    if (i < 3) await sleep(1_250);
  }
  return null;
}

/** The app's vault on the active network, read over its own RPC. */
export function appClaimEnv(onStage?: (text: string) => void): ClaimEnv {
  const net = getActiveNetwork();
  const pool = net.pool;
  return {
    chainId: net.chainId,
    pool,
    chain: {
      isSpent: (nullifier) => readBool(pool!, "isSpent", nullifier),
      isCommitmentSeen: (commitment) => readBool(pool!, "commitmentSeen", commitment),
      pathForCommitment: async (commitment) => {
        const found = await findLeaf(commitment);
        return found ? ((await found.tree.pathForLeaf(found.idx)) as PoseidonMerklePath | null) : null;
      },
      waitForReceipt: async (hash) => {
        onStage?.("Waiting for it to land…");
        return { status: await waitForTx(hash) };
      },
    },
    prove: async (input) => {
      const { proofBytes, publicSignals } = await proveTransferInBrowser(input);
      return { proofBytes, publicSignals };
    },
    relay: relayTransfer,
    leafIndexOf: async (commitment) => (await findLeaf(commitment))?.idx,
    stateAt: (nullifier, commitment) => readStateAt(pool!, nullifier, commitment),
    escrowWaiting: async (n, block) => {
      if (!n.vaultSwap || !n.sweptFrom) return false;
      return escrowHolds(getRhPublicClient(), n.vaultSwap, n.sweptFrom.nullifier, n.commitment, BigInt(n.amountWei), block).catch(
        () => null
      );
    },
    finishRefund: async (n) => {
      const { finishVaultSwapRefund } = await import("./vaultSwapRun");
      await finishVaultSwapRefund(n);
    },
  };
}

/** The claimed note's nullifier, from the note or worked out from its secret. */
async function nullifierOf(n: LocalNote): Promise<Hex> {
  if (n.nullifier && n.nullifier !== "0x") return n.nullifier;
  return fieldToHex(await noteNullifierPoseidon(hexToField(n.secret), hexToField(n.commitment)));
}

/** The move landed: count the fresh note and retire the claimed one. */
async function finalize(env: ClaimEnv, fresh: LocalNote, txHash: Hex | null) {
  const leafIndex = await env.leafIndexOf(fresh.commitment);
  updateLocalNote(fresh.id, {
    // counted again even if an earlier sync gave it up (a refund that landed late)
    status: "open",
    sweepPending: false,
    ...(leafIndex != null ? { leafIndex } : {}),
    ...(txHash ? { txHash } : {}),
  });
  if (fresh.sweptFrom) updateLocalNote(fresh.sweptFrom.id, { status: "recovered", secured: true });
}

/**
 * One pending fresh note, from what the chain shows. Seen in the vault: it is
 * counted and its claimed note retired. Not seen while the claimed note is
 * spent: it can never land, so it leaves the balance for good (kept as
 * history). Otherwise it stays pending. The app reads both at one block
 * (stateAt), so answers from two nodes a block apart can't call a move that
 * landed dead.
 *
 * One exception: a private swap's refund note (`vaultSwap`) whose note was
 * spent by an unshield sent on its own. The money then waits at the swap's
 * escrow and lands as this note once the refund is finished, so while the
 * escrow holds it (or can't be read) the note is "refund" or pending, never dead.
 */
async function settlePending(env: ClaimEnv, fresh: LocalNote): Promise<"landed" | "dead" | "pending" | "refund"> {
  const { spent, seen, block } = env.stateAt
    ? await env.stateAt(fresh.sweptFrom?.nullifier ?? null, fresh.commitment)
    : {
        spent: fresh.sweptFrom ? await env.chain.isSpent(fresh.sweptFrom.nullifier).catch(() => null) : null,
        seen: await env.chain.isCommitmentSeen(fresh.commitment).catch(() => null),
        block: null,
      };
  if (seen === true) {
    await finalize(env, fresh, null);
    return "landed";
  }
  if (seen === false && spent === true) {
    if (fresh.vaultSwap) {
      // The escrow is read at the same block, or a refund landing in between
      // would read as "spent, not seen, escrow empty" and be given up.
      if (block == null) return "pending";
      const waiting = env.escrowWaiting ? await env.escrowWaiting(fresh, block).catch(() => null) : null;
      if (waiting === true) return "refund";
      if (waiting === null) return "pending";
    }
    updateLocalNote(fresh.id, { status: "recovered", sweepPending: false });
    return "dead";
  }
  return "pending";
}

/** Earlier moves of this claim that may have landed since. Returns the one that did. */
async function settleEarlier(env: ClaimEnv, claimId: string): Promise<LocalNote | null> {
  const earlier = getAllNotes().filter(
    (n) => n.sweepPending && n.status !== "recovered" && n.sweptFrom?.id === claimId
  );
  for (const fresh of earlier) {
    if ((await settlePending(env, fresh)) === "landed") return fresh;
  }
  return null;
}

function securedResult(fresh: LocalNote, hash: Hex | null): SweepResult {
  const { secret, commitment, nullifier, amountWei, asset } = fresh;
  return {
    ok: true,
    final: true,
    status: "swept",
    reason: null,
    hash,
    freshNote: { secret, commitment, nullifier: nullifier ?? "0x", amountWei, asset },
    amountWei,
    asset,
  };
}

export type SecureParams = {
  /** The claimed note (an unsecured `imp-` note on the active network). */
  note: LocalNote;
  /** Send through the Gloam relay, so the wallet never shows and needs no gas. */
  relay: boolean;
  /** Sends pool.transfer(...args) from the wallet when the relay is off. Returns the hash. */
  sendWithWallet: (call: { pool: Address; args: readonly [Hex, Hex, Hex, readonly [Hex, Hex]] }) => Promise<Hex>;
  /** Progress, in plain words. */
  onStage?: (text: string) => void;
};

/**
 * Move a claimed note into a fresh note only this browser knows. `final` is
 * true once the move has landed. Statuses (SDK SweepStatus):
 *  - swept: secured; the fresh note is in the balance.
 *  - already_spent: someone spent it first (the payer); the claim is dropped.
 *  - not_settled: the payment is not in the vault yet; try again later.
 *  - failed / unconfirmed: still the claimed note; secure it again later.
 *  - bad_note: the amount does not match the note's record in the vault.
 */
export async function secureClaim(
  p: SecureParams,
  env: ClaimEnv = appClaimEnv(p.onStage)
): Promise<SweepResult> {
  const { note } = p;
  const pool = env.pool;
  if (!pool || note.chainId !== env.chainId || note.pool.toLowerCase() !== pool.toLowerCase()) {
    throw new Error("Switch to the network this payment is on to secure it.");
  }
  const nullifier = await nullifierOf(note);
  // A move sent before (a lost reply, a closed tab) may have landed already.
  const landed = await settleEarlier(env, note.id);
  if (landed) return securedResult(landed, null);
  let fresh: LocalNote | null = null;

  p.onStage?.("Proving privately…");
  const result = await sweepReceivedNote({
    note: {
      secret: note.secret,
      commitment: note.commitment,
      nullifier,
      amountWei: note.amountWei,
      asset: note.asset,
    },
    poolAddress: pool,
    chainId: note.chainId,
    prove: env.prove,
    chain: env.chain,
    // Saved before anything is sent: if this tab closes, this is the only copy.
    beforeSubmit: (out) => {
      fresh = {
        id: `${SECURED_PREFIX}${Date.now()}`,
        chainId: note.chainId,
        pool,
        asset: out.asset,
        amountWei: out.amountWei,
        commitment: out.commitment,
        secret: out.secret,
        nullifier: out.nullifier,
        bound: true,
        scheme: "poseidon",
        from: note.from,
        createdAt: Date.now(),
        status: "open",
        source: "local",
        sweptFrom: { id: note.id, nullifier },
        sweepPending: true,
        // The payer's note stays with the money.
        ...(note.note ? { note: note.note } : {}),
      };
      saveLocalNote(fresh);
    },
    submit: (intent) => {
      const args = transferCallArgs(intent);
      if (p.relay) {
        p.onStage?.("Securing it through the Gloam relay…");
        return env.relay({
          chainId: note.chainId,
          proof: args[0],
          root: args[1],
          nullifier: args[2],
          commitments: args[3],
        });
      }
      p.onStage?.("Confirm in your wallet to secure it…");
      return p.sendWithWallet({ pool, args });
    },
  });

  const out = fresh as LocalNote | null;
  if (result.status === "swept" && out) {
    await finalize(env, out, result.hash);
  } else if (result.status === "already_spent") {
    updateLocalNote(note.id, { status: "recovered" });
    // Spent by someone else, unless one of our own moves landed: ask the chain.
    const ours = await settleEarlier(env, note.id);
    if (ours) return securedResult(ours, ours.id === out?.id ? result.hash : null);
  }
  // failed / unconfirmed: the fresh note stays pending until the chain says
  // what happened (reconcileClaims). A relay that lost its reply may still
  // have sent it.
  return result;
}

/**
 * Settle secured claims whose move was sent but not confirmed here (a closed
 * tab, a lost reply, another device's backup). Returns true when something
 * changed.
 */
export async function reconcileClaims(env?: ClaimEnv): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const pending = getAllNotes().filter((n) => n.sweepPending && n.status !== "recovered");
  if (!pending.length) return false;
  const e = env ?? appClaimEnv();
  const pool = e.pool;
  if (!pool) return false;
  let changed = false;
  for (const fresh of pending) {
    if (fresh.chainId !== e.chainId || fresh.pool.toLowerCase() !== pool.toLowerCase()) continue;
    const state = await settlePending(e, fresh);
    if (state === "refund") {
      // proving and relaying take a while: the sync doesn't wait, the next one counts it
      void e.finishRefund?.(fresh).catch(() => {});
      continue;
    }
    if (state !== "pending") changed = true;
  }
  return changed;
}
