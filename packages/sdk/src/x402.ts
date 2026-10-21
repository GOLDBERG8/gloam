/**
 * Gloam x402: private agent payments over the HTTP 402 flow.
 *
 * x402 lets a server answer a request with 402 Payment Required, describe what
 * it costs, and accept a payment header on the retry. The winning Colosseum
 * pattern (MCPay) paired x402 with stablecoins to monetize agent tool calls,
 * but that settlement is fully public: amount, sender, and recipient all leak.
 * Gloam's scheme keeps the settlement private.
 *
 * Scheme "gloam-private" is settle-then-prove and self-custodial:
 *   1. Server answers 402 with GloamPaymentRequirements (amount, asset, payTo).
 *      payTo is the payee's receive tag (gloamr1.…).
 *   2. The agent builds a private send (transfer) of the required amount to the
 *      payee from a note it already holds, and broadcasts it ITSELF. No operator
 *      or facilitator ever holds the agent's key or funds.
 *   3. The agent retries with an X-PAYMENT header carrying the payment note,
 *      sealed to payTo so only the payee can open it, plus the settlement tx
 *      hash. The public sees only that a shielded transfer happened, never the
 *      amount or the parties.
 *   4. The payee opens the note and sweeps it into a fresh note only it knows
 *      (settleGloamPayment), and grants access only after that sweep confirms.
 *      The payer created the payment note, so until the sweep it could spend it
 *      back; a verify without the sweep is never final.
 *
 * This is deliberately NOT a Tempo Zone. A Zone is operator-visible: the zone
 * operator sees every transaction inside it. Gloam is private from the public
 * AND from any operator; only the payer and the payee learn the amount, and
 * compliance visibility is opt-in per payment via a scoped disclosure (see
 * GloamComplianceDisclosure), not granted wholesale to an operator.
 */

import type { Address, Hex } from "viem";
import { buildPrivateSendIntent, type PrivateSendIntent } from "./builders.js";
import type { PoseidonMerklePath } from "./merkle.js";
import type { Prover } from "./prove.js";
import type { NoteExport } from "./witness.js";
import { noteCommitmentPoseidon } from "./note.js";
import { fieldToHex } from "./poseidon.js";
import { NATIVE_ASSET, RH_TESTNET_CHAIN_ID, poolForChainId } from "./constants.js";
import {
  assertReceiveTag,
  decodeNotePackage,
  encodeNotePackage,
  isReceiveTag,
  isSealedTicket,
  notePackageToExport,
  NOTE_PACKAGE_PREFIX,
  openSealedTicket,
  sealToReceiveTag,
  type ReceiveKey,
  type ReceiveKeyJwk,
} from "./receiveTag.js";

export const GLOAM_X402_SCHEME = "gloam-private" as const;
export const GLOAM_X402_VERSION = 1 as const;

const REQ_PREFIX = "gloamx402req1:";
const PAY_PREFIX = "gloamx402pay1:";
const NOTE_PREFIX = "gloamnote1:";

/**
 * Where Gloam sits versus a Tempo Zone. Surfaced on every requirements object so
 * the distinction is explicit at the protocol layer, not just in marketing.
 */
export const GLOAM_VS_ZONE = {
  model: "self-custodial shielded pool, private from the public and from any operator",
  gloam: [
    "Only the payer and the payee learn the amount",
    "The agent settles its own payment; no operator holds funds or keys",
    "Anonymity set: the payment is unlinkable to the payer's other activity",
    "Compliance visibility is opt-in per payment via a scoped disclosure",
  ],
  zone: [
    "The zone operator sees every transaction inside the zone",
    "Privacy is from the public, not from the operator",
    "Permissioned execution environment, not a permissionless pool",
    "No anonymity set; the operator knows all participants",
  ],
  oneLine:
    "Gloam is private from the public and self-custodial, with optional compliance disclosure. It is not an operator-visible Zone.",
} as const;

/** The 402 challenge a server returns to price a resource in private stablecoins. */
export interface GloamPaymentRequirements {
  x402Version: typeof GLOAM_X402_VERSION;
  scheme: typeof GLOAM_X402_SCHEME;
  /** Chain the shielded settlement happens on. */
  network: number;
  /** Required amount in base units (wei), as a decimal string. */
  maxAmountRequired: string;
  /** Settlement asset; zero address for the chain's native unit. */
  asset: Address;
  /** Human label for the asset, e.g. "USD" or "ETH". */
  assetSymbol: string;
  /** The payee's receive tag (gloamr1.…). The payment note is sealed to it. */
  payTo: string;
  /** The resource being paid for (URL or MCP tool id). */
  resource: string;
  description: string;
  /** Shielded pool the transfer settles through. */
  poolAddress: Address;
  maxTimeoutSeconds: number;
  /** Explicit Gloam-vs-Zone posture. */
  privacy: typeof GLOAM_VS_ZONE;
}

export interface BuildRequirementsParams {
  amountWei: bigint;
  asset?: Address;
  assetSymbol?: string;
  /** Your receive tag (gloamr1.…), from generateReceiveKey() or the Gloam app. Required. */
  payTo: string;
  resource: string;
  description?: string;
  network?: number;
  poolAddress?: Address;
  maxTimeoutSeconds?: number;
}

/** Server side: construct the 402 payment requirements for a resource. */
export function buildGloamPaymentRequirements(
  params: BuildRequirementsParams
): GloamPaymentRequirements {
  if (params.amountWei <= 0n) throw new Error("amountWei must be positive");
  assertReceiveTag(params.payTo, "payTo");
  const asset = params.asset ?? NATIVE_ASSET;
  const network = params.network ?? RH_TESTNET_CHAIN_ID;
  return {
    x402Version: GLOAM_X402_VERSION,
    scheme: GLOAM_X402_SCHEME,
    network,
    maxAmountRequired: params.amountWei.toString(),
    asset,
    assetSymbol: params.assetSymbol ?? (asset === NATIVE_ASSET ? "ETH" : "TOKEN"),
    payTo: params.payTo,
    resource: params.resource,
    description: params.description ?? `Private payment for ${params.resource}`,
    poolAddress: params.poolAddress ?? poolForChainId(network),
    maxTimeoutSeconds: params.maxTimeoutSeconds ?? 120,
    privacy: GLOAM_VS_ZONE,
  };
}

/**
 * Plain (unsealed) payment note encoding: base64 JSON, prefixed. Anyone who
 * reads it can spend the note. New payments seal the note to payTo instead
 * (gloam2t.…); this stays for older payers and the legacy path.
 */
export function encodePaymentNote(note: NoteExport): string {
  return NOTE_PREFIX + toB64(jsonStringify(note));
}
export function decodePaymentNote(token: string): NoteExport {
  const body = token.startsWith(NOTE_PREFIX)
    ? token.slice(NOTE_PREFIX.length)
    : token;
  const n = JSON.parse(fromB64(body)) as NoteExport;
  if (!n || !n.commitment || !n.amountWei || n.asset === undefined) {
    throw new Error("Not a valid Gloam payment note.");
  }
  return n;
}

/**
 * Payee side: open the payment note carried in an X-PAYMENT payload. A sealed
 * note (gloam2t.…) needs the receive key it was sealed to; a plain note from an
 * older payer opens without one. Returns the spendable note, so keep the result
 * server-side and sweep it (settleGloamPayment) before relying on it.
 */
export async function openGloamPaymentNote(
  paymentNote: string,
  receiveKey?: ReceiveKey | ReceiveKeyJwk
): Promise<NoteExport & { pool?: Address }> {
  let inner = paymentNote.trim();
  if (isSealedTicket(inner)) {
    if (!receiveKey) {
      throw new Error("This payment note is sealed to the payee's receive tag. Pass the payee's receive key to open it.");
    }
    inner = (await openSealedTicket(inner, receiveKey)).trim();
  }
  if (inner.startsWith(NOTE_PACKAGE_PREFIX)) {
    return notePackageToExport(decodeNotePackage(inner));
  }
  return decodePaymentNote(inner);
}

/**
 * Optional compliance disclosure scoped to an issuer viewing key. DESIGN STUB.
 *
 * On a compliance-enforcing stablecoin, an issuer needs a way to satisfy
 * oversight without the public seeing anything. Gloam's answer is a per-payment,
 * issuer-scoped disclosure that reuses the shield-circuit disclosure proof
 * (prove knowledge of a secret binding commitment to (amount, asset)) but is
 * directed at a named issuer viewing key rather than published.
 *
 * What is real here: the shape, the binding to the payment note, and the reuse
 * of the existing disclosure proof. What is a deployment prerequisite (and is
 * marked `stub: true` until then): encrypting the disclosure to the issuer's
 * published viewing key, and the on-chain freeze/blocklist reconciliation. See
 * TEMPO_EXPANSION.md sections 3 and 7.
 */
export interface GloamComplianceDisclosure {
  v: 1;
  scope: "issuer";
  /** Identifier of the issuer viewing key this disclosure is directed to. */
  issuerTag: string;
  commitment: Hex;
  amountWei: string;
  asset: Address;
  /** Shield-circuit disclosure proof, or null while stubbed. */
  proof: unknown | null;
  /** True until the proof is generated + encrypted to the issuer viewing key. */
  stub: boolean;
}

export interface BuildComplianceDisclosureParams {
  issuerTag: string;
  note: NoteExport;
  /** Inject a pre-made disclosure proof to leave stub mode. */
  proof?: unknown;
  /**
   * A shield prover (artifactProver over the shield artifacts). When given, this
   * generates the real disclosure proof over the note, proving it is worth
   * (amount, asset) without revealing the secret, exactly the shield-circuit
   * disclosure. This is the same statement selective disclosure uses, reused
   * for an issuer scope.
   */
  prove?: Prover;
}

/**
 * Build an issuer-scoped compliance disclosure for a payment note.
 *
 * With `prove` it generates the real shield-circuit disclosure proof binding the
 * note's commitment to (amount, asset); with an injected `proof` it wraps that;
 * with neither it returns a structurally valid stub (stub: true) documenting the
 * path. In every case the disclosure is directed at a named issuer viewing key.
 * Encrypting the proof to that key and the on-chain freeze reconciliation remain
 * deployment prerequisites (TEMPO_EXPANSION.md sections 3 and 7).
 */
export async function buildComplianceDisclosure(
  params: BuildComplianceDisclosureParams
): Promise<GloamComplianceDisclosure> {
  let proof = params.proof ?? null;
  let stub = params.proof === undefined && params.prove === undefined;

  if (proof === null && params.prove) {
    // Shield-circuit disclosure: prove knowledge of the secret binding the
    // commitment to (amount, asset). Public signals order: [commitment, amount, asset].
    const r = await params.prove({
      commitment: BigInt(params.note.commitment).toString(),
      amount: params.note.amountWei,
      asset: BigInt(params.note.asset).toString(),
      secret: BigInt(params.note.secret).toString(),
    });
    proof = r.proofBytes;
    stub = false;
  }

  return {
    v: 1,
    scope: "issuer",
    issuerTag: params.issuerTag,
    commitment: params.note.commitment,
    amountWei: params.note.amountWei,
    asset: params.note.asset,
    proof,
    stub,
  };
}

export function isComplianceDisclosureShape(
  d: unknown
): d is GloamComplianceDisclosure {
  const x = d as GloamComplianceDisclosure;
  return (
    !!x &&
    x.v === 1 &&
    x.scope === "issuer" &&
    typeof x.issuerTag === "string" &&
    typeof x.commitment === "string" &&
    typeof x.amountWei === "string" &&
    typeof x.asset === "string"
  );
}

/** The X-PAYMENT payload an agent sends on the 402 retry. */
export interface GloamPaymentPayload {
  x402Version: typeof GLOAM_X402_VERSION;
  scheme: typeof GLOAM_X402_SCHEME;
  network: number;
  payload: {
    /**
     * The payment note, sealed to payTo (gloam2t.…) so only the payee can open
     * it. Older payers sent it plain (gloamnote1:…), readable by anyone.
     */
    paymentNote: string;
    /** Settlement tx hash, present once the agent has broadcast the transfer. */
    txHash: Hex | null;
    /** The unsigned transfer call, so a self-custodial agent can broadcast it. */
    exec: PrivateSendIntent["exec"];
    /** Optional issuer-scoped compliance disclosure. */
    disclosure?: GloamComplianceDisclosure;
  };
}

export interface BuildPaymentParams {
  requirements: GloamPaymentRequirements;
  /** Secret of a note the agent already holds in the pool. */
  senderSecretHex: Hex;
  /** Total value of that note (wei). Must cover the required amount. */
  senderNoteAmountWei: bigint;
  /** Merkle path for the sender note (from syncTree.pathForCommitment). */
  path: PoseidonMerklePath;
  prove: Prover;
  /** Optional issuer tag to attach a compliance disclosure for the payment note. */
  issuerTag?: string;
  /** Optional pre-made disclosure proof; without it the disclosure is a stub. */
  disclosureProof?: unknown;
  /**
   * Optional shield prover to generate the real compliance-disclosure proof over
   * the payment note. The payer knows the payment note secret at build time, so
   * it can produce the issuer-scoped proof here.
   */
  disclosureProver?: Prover;
  /**
   * UNSAFE, legacy only. Pay a payTo that is not a receive tag by putting the
   * payment note in the header in plain text, where anyone who sees the header
   * (proxies, logs, the agent itself) can spend it. Without this, a payTo that
   * is not a receive tag is refused.
   */
  legacyUnsealed?: boolean;
}

export interface BuiltPayment {
  payload: GloamPaymentPayload;
  intent: PrivateSendIntent;
  /**
   * The payee's note, in the clear. Keep it inside the payer's process: the
   * header carries it sealed to payTo, and nobody else needs it.
   */
  paymentNote: NoteExport;
  /** The payer's change note; persist its secret, it is the remaining balance. */
  changeNote: NoteExport;
  /** True when the payment note in the header is sealed to payTo. */
  sealed: boolean;
  /** Encoded X-PAYMENT header value. */
  header: string;
}

/**
 * Agent side: build a private payment that satisfies the 402 requirements.
 * Constructs a private-send of exactly the required amount+asset to the payee,
 * seals the payment note to the payee's receive tag (requirements.payTo), and
 * returns the payload plus the unsigned transfer exec. It does NOT broadcast
 * (the agent signs and broadcasts, staying self-custodial); after broadcast the
 * caller sets payload.payload.txHash. Refuses a payTo that is not a receive tag.
 */
export async function buildGloamPayment(
  params: BuildPaymentParams
): Promise<BuiltPayment> {
  const req = params.requirements;
  if (req.scheme !== GLOAM_X402_SCHEME) {
    throw new Error(`Unsupported scheme "${req.scheme}"`);
  }
  const sealed = isReceiveTag(req.payTo);
  if (!sealed && !params.legacyUnsealed) assertReceiveTag(req.payTo, "requirements.payTo");
  const amountPayWei = BigInt(req.maxAmountRequired);
  if (params.senderNoteAmountWei < amountPayWei) {
    throw new Error("Sender note does not cover the required amount");
  }

  const intent = await buildPrivateSendIntent({
    secretHex: params.senderSecretHex,
    amountInWei: params.senderNoteAmountWei,
    amountPayWei,
    asset: req.asset,
    path: params.path,
    prove: params.prove,
    poolAddress: req.poolAddress,
    chainId: req.network,
  });

  const disclosure = params.issuerTag
    ? await buildComplianceDisclosure({
        issuerTag: params.issuerTag,
        note: intent.paymentNote,
        proof: params.disclosureProof,
        prove: params.disclosureProver,
      })
    : undefined;

  // Sealed to payTo: only the payee's receive key opens it. The ticket inside is
  // the same gloam1. package the app shares, so the app can open it too.
  const paymentNoteWire = sealed
    ? await sealToReceiveTag(
        encodeNotePackage({
          pool: req.poolAddress,
          asset: intent.paymentNote.asset,
          amountWei: intent.paymentNote.amountWei,
          secret: intent.paymentNote.secret,
          commitment: intent.paymentNote.commitment,
        }),
        req.payTo
      )
    : encodePaymentNote(intent.paymentNote);

  const payload: GloamPaymentPayload = {
    x402Version: GLOAM_X402_VERSION,
    scheme: GLOAM_X402_SCHEME,
    network: req.network,
    payload: {
      paymentNote: paymentNoteWire,
      txHash: null,
      exec: intent.exec,
      ...(disclosure ? { disclosure } : {}),
    },
  };

  return {
    payload,
    intent,
    paymentNote: intent.paymentNote,
    changeNote: intent.changeNote,
    sealed,
    header: encodePaymentHeader(payload),
  };
}

/** What every verify that has not swept the note says about finality. */
export const GLOAM_NOT_FINAL =
  "Not final. The payer created this payment note, so it also knows the secret and can spend the money back until you move it. Sweep it with settleGloamPayment (or sweepReceivedNote) and grant access only after the sweep confirms on chain.";

export interface VerifyResult {
  ok: boolean;
  reason: string | null;
  /** Amount the payment note carries (wei string), when decodable. */
  amountWei: string | null;
  asset: Address | null;
  /** Commitment whose membership the server must confirm on-chain. */
  commitment: Hex | null;
  /** Whether the payment note arrived sealed to payTo (null when it was not read). */
  sealed: boolean | null;
  /**
   * Always false here: a structural verify never makes a payment final. Only a
   * confirmed sweep does (settleGloamPayment returns final: true).
   */
  final: false;
  /** Plain statement of why this is not final and what to do. */
  finality: string;
  /**
   * Checks that can only be done against the chain, listed for the caller to
   * run after this structural verify passes. Kept explicit so nothing is
   * silently assumed settled.
   */
  onchainChecksRequired: string[];
}

/**
 * Server side: structurally verify a payment against its requirements. Confirms
 * the payment note binds the required amount+asset, is the payment output of
 * the presented transfer, the transfer targets the right pool and network, and
 * (if present) the compliance disclosure is well shaped.
 *
 * NOT FINAL. It does not confirm settlement, and even a settled payment can be
 * spent back by the payer until the payee sweeps it. Servers should call
 * settleGloamPayment, which runs this check and then the sweep. A sealed note
 * must be opened first (openGloamPaymentNote) and passed as `note`.
 */
export function verifyGloamPayment(args: {
  requirements: GloamPaymentRequirements;
  payload: GloamPaymentPayload;
  /** The opened payment note, for a payload whose note is sealed. */
  note?: NoteExport;
}): VerifyResult {
  const { requirements: req, payload: pay } = args;
  const sealed = typeof pay.payload?.paymentNote === "string" ? isSealedTicket(pay.payload.paymentNote) : null;
  const fail = (reason: string): VerifyResult => ({
    ok: false,
    reason,
    amountWei: null,
    asset: null,
    commitment: null,
    sealed,
    final: false,
    finality: GLOAM_NOT_FINAL,
    onchainChecksRequired: [],
  });

  if (pay.scheme !== GLOAM_X402_SCHEME) return fail("scheme mismatch");
  if (pay.network !== req.network) return fail("network mismatch");
  if (pay.payload.exec.fn !== "transfer") return fail("payment is not a private send");
  if (
    pay.payload.exec.poolAddress.toLowerCase() !==
    req.poolAddress.toLowerCase()
  ) {
    return fail("payment settles through a different pool");
  }

  let note: NoteExport;
  if (args.note) {
    note = args.note;
  } else if (sealed) {
    return fail(
      "payment note is sealed to the payee's receive tag: open it with openGloamPaymentNote(paymentNote, receiveKey) and pass it as note, or use settleGloamPayment"
    );
  } else {
    try {
      note = decodePaymentNote(pay.payload.paymentNote);
    } catch {
      return fail("payment note does not decode");
    }
  }
  if (note.asset.toLowerCase() !== req.asset.toLowerCase()) {
    return fail("payment note asset does not match required asset");
  }
  if (BigInt(note.amountWei) < BigInt(req.maxAmountRequired)) {
    return fail("payment note amount is below the required amount");
  }
  const outputs = pay.payload.exec.args?.[3];
  if (
    Array.isArray(outputs) &&
    typeof outputs[0] === "string" &&
    outputs[0].toLowerCase() !== note.commitment.toLowerCase()
  ) {
    return fail("payment note is not the payment output of this transfer");
  }
  if (pay.payload.disclosure && !isComplianceDisclosureShape(pay.payload.disclosure)) {
    return fail("compliance disclosure is malformed");
  }

  return {
    ok: true,
    reason: null,
    amountWei: note.amountWei,
    asset: note.asset,
    commitment: note.commitment,
    sealed,
    final: false,
    finality: GLOAM_NOT_FINAL,
    onchainChecksRequired: [
      "verifyPaymentNoteBinding(note) === true (the claimed amount binds to the commitment; a structural check alone would trust a lying payer)",
      `pool.commitmentSeen(${note.commitment}) === true (payment note is a real leaf)`,
      pay.payload.txHash
        ? `transfer tx ${pay.payload.txHash} succeeded on ${req.poolAddress}`
        : "settlement tx hash not yet attached (agent must broadcast the exec, then set payload.txHash)",
      "the transfer nullifier is recorded spent exactly once (no double spend)",
      "sweep the payment note into a fresh note only you know and wait for it to confirm (settleGloamPayment); until then the payer can spend it back",
    ],
  };
}

/**
 * Confirm a payment note's claimed amount actually binds to its commitment:
 * commitment == Poseidon(secret, amount, asset). verifyGloamPayment is a fast
 * structural check and trusts the encoded amountWei; without this, a payer could
 * present a note claiming the full price whose commitment was minted for a
 * smaller amount (and is a real on-chain leaf), passing structural verify while
 * underpaying. The payee only learns the true value at cash-out. Run this before
 * granting access on any payment where the payee will rely on the amount.
 */
export async function verifyPaymentNoteBinding(note: NoteExport): Promise<boolean> {
  try {
    const c = await noteCommitmentPoseidon(
      BigInt(note.secret),
      BigInt(note.amountWei),
      note.asset
    );
    return fieldToHex(c).toLowerCase() === note.commitment.toLowerCase();
  } catch {
    return false;
  }
}

export function encodePaymentHeader(p: GloamPaymentPayload): string {
  return PAY_PREFIX + toB64(jsonStringify(p));
}
export function decodePaymentHeader(h: string): GloamPaymentPayload {
  const body = h.startsWith(PAY_PREFIX) ? h.slice(PAY_PREFIX.length) : h;
  return JSON.parse(fromB64(body)) as GloamPaymentPayload;
}
export function encodeRequirements(r: GloamPaymentRequirements): string {
  return REQ_PREFIX + toB64(jsonStringify(r));
}
export function decodeRequirements(s: string): GloamPaymentRequirements {
  const body = s.startsWith(REQ_PREFIX) ? s.slice(REQ_PREFIX.length) : s;
  return JSON.parse(fromB64(body)) as GloamPaymentRequirements;
}

// Serialize with bigints coerced to decimal strings, so an exec's valueWei and
// any other bigint fields survive JSON transport. Wire values are strings; the
// self-custodial agent broadcasts from the in-memory intent, not the decoded
// header, so nothing depends on reviving these back to bigint.
function jsonStringify(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v
  );
}

// Base64 helpers that work in Node and the browser without a Buffer dependency.
function toB64(s: string): string {
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(s)));
  return Buffer.from(s, "utf-8").toString("base64");
}
function fromB64(s: string): string {
  if (typeof atob === "function") return decodeURIComponent(escape(atob(s)));
  return Buffer.from(s, "base64").toString("utf-8");
}
