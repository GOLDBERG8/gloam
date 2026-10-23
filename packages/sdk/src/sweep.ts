/**
 * Payee side of x402: make a received payment final.
 *
 * In the gloam-private scheme the payer builds the payment note, so the payer
 * knows its secret too. Until the payee moves the money, the payer could be
 * served and then spend the note back. The fix is a sweep: a private transfer
 * from the received note into a fresh note only the payee knows (the whole
 * amount, plus a zero-value change note). Once the sweep confirms on chain the
 * received note's nullifier is spent by the payee, and the money is the payee's
 * alone. If the payer already spent it, the sweep cannot land and the payee
 * refuses access.
 *
 * settleGloamPayment is the safe default for servers: open the sealed note,
 * verify it, sweep it, and grant access only when `final` is true. Chain reads
 * and submission are injected, so a server can sweep through its own wallet or
 * through the Gloam relay, and tests can run it against a mock chain.
 */

import type { Address, Hex, PublicClient } from "viem";
import { buildPrivateSendIntent, type PrivateSendIntent } from "./builders.js";
import type { PoseidonMerklePath } from "./merkle.js";
import { noteNullifierPoseidon } from "./note.js";
import { fieldToHex, hexToField } from "./poseidon.js";
import type { Prover } from "./prove.js";
import type { ReceiveKey, ReceiveKeyJwk } from "./receiveTag.js";
import { GloamRelayError, relayIntent, type RelayOptions } from "./relay.js";
import { syncTree, type SyncTreeParams } from "./sync.js";
import type { NoteExport } from "./witness.js";
import {
  openGloamPaymentNote,
  verifyGloamPayment,
  verifyPaymentNoteBinding,
  type GloamPaymentPayload,
  type GloamPaymentRequirements,
  type VerifyResult,
} from "./x402.js";

/** ShieldPoolPoseidon.transfer, for signing a sweep (or any private send) with your own wallet. */
export const POOL_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "root", type: "bytes32" },
      { name: "nullifier", type: "bytes32" },
      { name: "newCommitments", type: "bytes32[2]" },
    ],
    outputs: [],
  },
] as const;

/** The pool reads a sweep needs. */
export const POOL_STATE_ABI = [
  {
    type: "function",
    name: "isSpent",
    stateMutability: "view",
    inputs: [{ name: "nullifier", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "commitmentSeen",
    stateMutability: "view",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/** A private send's exec args typed for POOL_TRANSFER_ABI: `writeContract({ address, abi, functionName: "transfer", args })`. */
export function transferCallArgs(intent: PrivateSendIntent): readonly [Hex, Hex, Hex, readonly [Hex, Hex]] {
  return intent.exec.args as readonly [Hex, Hex, Hex, readonly [Hex, Hex]];
}

/** What a sweep needs to know about the chain. */
export interface SweepChain {
  /** pool.isSpent(nullifier) */
  isSpent(nullifier: Hex): Promise<boolean>;
  /** pool.commitmentSeen(commitment) */
  isCommitmentSeen(commitment: Hex): Promise<boolean>;
  /** Membership path for a commitment, or null when it is not a leaf yet. */
  pathForCommitment(commitment: Hex): Promise<PoseidonMerklePath | null>;
  /** Wait for a submitted transaction and report how it ended. */
  waitForReceipt(hash: Hex): Promise<{ status: "success" | "reverted" }>;
}

/** Submits a built private send and returns its transaction hash. */
export type SweepSubmitter = (intent: PrivateSendIntent) => Promise<Hex>;

/** A SweepChain over a viem PublicClient: reads the pool and rebuilds the tree for each path. */
export function sweepChainFromClient(client: PublicClient, params: SyncTreeParams): SweepChain {
  return {
    isSpent: (nullifier) =>
      client.readContract({ address: params.pool, abi: POOL_STATE_ABI, functionName: "isSpent", args: [nullifier] }),
    isCommitmentSeen: (commitment) =>
      client.readContract({ address: params.pool, abi: POOL_STATE_ABI, functionName: "commitmentSeen", args: [commitment] }),
    pathForCommitment: async (commitment) => (await syncTree(client, params)).pathForCommitment(commitment),
    waitForReceipt: async (hash) => ({ status: (await client.waitForTransactionReceipt({ hash })).status }),
  };
}

/** Submit sweeps through the Gloam relay, so the payee's wallet never appears and needs no gas. */
export function relaySubmitter(opts: RelayOptions = {}): SweepSubmitter {
  return (intent) => relayIntent(intent, opts);
}

/** Relay answers that leave open whether the transaction went out. */
const RELAY_MAYBE_SENT = new Set(["maybe_sent", "rpc", "network", "error", "internal", "in_flight"]);

export type SweepStatus = "swept" | "already_spent" | "not_settled" | "bad_note" | "unconfirmed" | "failed";

export interface SweepResult {
  ok: boolean;
  /** True only when the money now sits in a note only the payee knows, confirmed on chain. */
  final: boolean;
  status: SweepStatus;
  reason: string | null;
  hash: Hex | null;
  /**
   * The payee's fresh note. Set when swept, and when unconfirmed (the sweep may
   * still land, so keep it). Its secret is the money: store it before anything else.
   */
  freshNote: NoteExport | null;
  amountWei: string;
  asset: Address;
}

export interface SweepParams {
  /** The received note, opened (see openGloamPaymentNote). */
  note: NoteExport;
  poolAddress: Address;
  chainId: number;
  /** Transfer-circuit prover (artifactProver over transfer.wasm + transfer_final.zkey). */
  prove: Prover;
  chain: SweepChain;
  submit: SweepSubmitter;
  /**
   * Called with the fresh note after it is proved and before it is submitted.
   * Persist it here: if the process dies after submitting, this is the only copy.
   */
  beforeSubmit?: (freshNote: NoteExport, intent: PrivateSendIntent) => void | Promise<void>;
}

const ALREADY_SPENT =
  "The payment note was already spent, most likely by the payer who created it. The money is not yours: do not grant access.";

/**
 * Move a received note into a fresh note only you know. Returns final: true
 * only after the sweep confirms. Refuses (already_spent) when the note was spent
 * before the sweep could land, and reports not_settled when the payment is not
 * in the pool yet.
 */
export async function sweepReceivedNote(params: SweepParams): Promise<SweepResult> {
  const { note, chain } = params;
  const base = { amountWei: note.amountWei, asset: note.asset };
  const result = (status: SweepStatus, reason: string | null, extra: Partial<SweepResult> = {}): SweepResult => ({
    ok: status === "swept",
    final: status === "swept",
    status,
    reason,
    hash: null,
    freshNote: null,
    ...base,
    ...extra,
  });

  let amount: bigint;
  try {
    amount = BigInt(note.amountWei);
  } catch {
    return result("bad_note", "The received note has no readable amount.");
  }
  if (amount <= 0n) return result("bad_note", "The received note carries no value.");
  if (!(await verifyPaymentNoteBinding(note))) {
    return result("bad_note", "The received note's amount does not match its commitment.");
  }
  const nullifier = fieldToHex(await noteNullifierPoseidon(hexToField(note.secret), hexToField(note.commitment)));
  if (await chain.isSpent(nullifier)) return result("already_spent", ALREADY_SPENT);
  const path = await chain.pathForCommitment(note.commitment);
  if (!path) {
    return result("not_settled", "The payment is not in the pool yet. Wait for the payer's transfer to confirm, then try again.");
  }

  // The whole amount to a fresh payee note; the change note is zero.
  const intent = await buildPrivateSendIntent({
    secretHex: note.secret,
    amountInWei: amount,
    amountPayWei: amount,
    asset: note.asset,
    path,
    prove: params.prove,
    poolAddress: params.poolAddress,
    chainId: params.chainId,
  });
  const fresh = intent.paymentNote;
  await params.beforeSubmit?.(fresh, intent);

  let hash: Hex | null = null;
  let reverted = false;
  let error = "";
  // The relay could not say whether it sent the sweep (a timeout after the node took it, a lost reply):
  // it may still land, so the fresh note is kept rather than reported as nothing moved.
  let maybeSent = false;
  try {
    hash = await params.submit(intent);
    const receipt = await chain.waitForReceipt(hash);
    if (receipt.status === "success") return result("swept", null, { hash, freshNote: fresh });
    reverted = true;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    maybeSent = !hash && e instanceof GloamRelayError && RELAY_MAYBE_SENT.has(e.code);
  }

  // It did not confirm cleanly. Ask the chain what actually happened.
  const landed = await chain.isCommitmentSeen(fresh.commitment).catch(() => null);
  if (landed === true) return result("swept", null, { hash, freshNote: fresh });
  const spent = await chain.isSpent(nullifier).catch(() => null);
  if (landed === false && spent === true) return result("already_spent", ALREADY_SPENT, { hash });
  if (landed === false && spent === false && !maybeSent && (!hash || reverted)) {
    return result("failed", `The sweep did not go through and nothing moved${error ? `: ${error}` : "."} It can be retried.`, { hash });
  }
  return result(
    "unconfirmed",
    `The sweep was sent but has not confirmed${error ? ` (${error})` : ""}. Keep the fresh note and check again before granting access.`,
    { hash, freshNote: fresh }
  );
}

export interface SettleParams {
  requirements: GloamPaymentRequirements;
  payload: GloamPaymentPayload;
  /** The payee's receive key (the one behind requirements.payTo). Needed for sealed notes. */
  receiveKey?: ReceiveKey | ReceiveKeyJwk;
  prove: Prover;
  chain: SweepChain;
  submit: SweepSubmitter;
  beforeSubmit?: SweepParams["beforeSubmit"];
}

export interface SettleResult {
  /** Grant access only when this is true. Same as `final`. */
  grantAccess: boolean;
  ok: boolean;
  final: boolean;
  status: "rejected" | SweepStatus;
  reason: string | null;
  verify: VerifyResult | null;
  sweep: SweepResult | null;
  /** The payee's fresh note (see SweepResult.freshNote). Store its secret. */
  freshNote: NoteExport | null;
}

/**
 * Server side, the safe default: open the payment note with the payee's receive
 * key, verify it against the requirements, and sweep it into a fresh note only
 * the payee knows. grantAccess is true only after the sweep confirms on chain.
 */
export async function settleGloamPayment(params: SettleParams): Promise<SettleResult> {
  const { requirements: req, payload } = params;
  const reject = (reason: string, verify: VerifyResult | null = null): SettleResult => ({
    grantAccess: false,
    ok: false,
    final: false,
    status: "rejected",
    reason,
    verify,
    sweep: null,
    freshNote: null,
  });

  const key = params.receiveKey;
  if (key && "tag" in key && key.tag && key.tag.trim() !== String(req.payTo).trim()) {
    return reject("These requirements ask for payment to a different receive tag than this key.");
  }
  let note: NoteExport;
  try {
    note = await openGloamPaymentNote(payload.payload.paymentNote, key);
  } catch (e) {
    return reject(`Could not open the payment note: ${e instanceof Error ? e.message : String(e)}`);
  }
  const verify = verifyGloamPayment({ requirements: req, payload, note });
  if (!verify.ok) return reject(verify.reason ?? "payment did not verify", verify);

  const sweep = await sweepReceivedNote({
    note,
    poolAddress: req.poolAddress,
    chainId: req.network,
    prove: params.prove,
    chain: params.chain,
    submit: params.submit,
    beforeSubmit: params.beforeSubmit,
  });
  return {
    grantAccess: sweep.final,
    ok: sweep.ok,
    final: sweep.final,
    status: sweep.status,
    reason: sweep.reason,
    verify,
    sweep,
    freshNote: sweep.freshNote,
  };
}
