/**
 * Gloam relay, server side.
 *
 * Submits already-proven private sends, cash outs and payment memos from a
 * Gloam relay account, so the user's own wallet never appears next to them on
 * a block explorer. The pool never checks msg.sender on transfer/unshield (the
 * Groth16 proof is the authorization, and unshield binds the recipient inside
 * the proof), so relaying cannot redirect funds: the worst a relay can do is
 * refuse to submit.
 *
 * Guard rails:
 *   - only the active pool's transfer/unshield and the memo board's postMemo
 *   - one request per spend at a time: a send or cash out takes a lock on its
 *     nullifier, shared across instances (lib/relay/inflight), before anything
 *     is read from the chain, so copies of one proof sent together cannot each
 *     pass the dry run and then revert at the relay's expense; the lock is
 *     dropped if nothing went out, and kept until it expires once a
 *     transaction did
 *   - spent and root check on every send and cash out, before the dry run, so
 *     a spent note never reaches the gas estimate
 *   - dry run (gas estimate against the pool) before anything is sent, so a bad
 *     proof, a spent note or a stale root costs the relay nothing
 *   - no cash out to the vault itself or the memo board (lib/cashOutTarget),
 *     which would strand the money
 *   - memos only for commitments the pool has actually inserted, and no larger
 *     than a real sealed ticket needs (RELAY_MEMO_MAX_BYTES)
 *   - sanctions screening of every public recipient (a cash out's `to`) before
 *     anything is checked or sent (lib/screeningServer.ts), plus on Tempo the
 *     asset's TIP-403 issuer policy for the vault and `to`; private sends and
 *     memos carry no public address, so there is nothing to screen
 *   - per-sender and per-network rate limits, shared across instances (the
 *     network cap counts only transactions actually sent), and a few relayed
 *     payment messages per payment: the payer's own (with the memo ticket the
 *     transfer handed back), each partner key's, and one small allowance that
 *     everyone else shares, none of them kept by IP
 *
 * Submission is free for the user on every network, mainnet included: the relay
 * pays the gas. A relay fee would need its own public output inside the circuit,
 * which the mainnet pools do not have, so at launch the Gloam team pays mainnet
 * gas from the relay account. The only fee on mainnet is the pool's 0.25% on a cash out.
 *
 * Key: GLOAM_RELAYER_PRIVATE_KEY (server env only, never NEXT_PUBLIC_). With no
 * key set the relay reports itself disabled and the app falls back to wallet
 * submission. GLOAM_RELAY_MEMO_SECRET (server only, 32 characters or more)
 * signs the memo tickets; unset, no tickets go out and every payment message
 * but a partner key's shares the small allowance.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  createPublicClient,
  createWalletClient,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createHmac, timingSafeEqual } from "crypto";
import {
  NETWORK_KEYS,
  getNetwork,
  isNetworkWritable,
  type GloamNetwork,
} from "@/lib/networks";
import { hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import { SCREEN_BLOCKED_MESSAGE } from "@/lib/screening";
import { screenAddresses } from "@/lib/screeningServer";
import { cashOutTargetProblem } from "@/lib/cashOutTarget";
import { forgetNonce, inSendLanes, inflightKey, takeInflight } from "@/lib/relay/inflight";
import { serverTransport } from "@/lib/serverRpc";
import { isKnownRoute, isSwapAsset, vaultSwapAbi, vaultSwapRouter, encodeRoute, type PoolKey } from "@/lib/vaultSwap";

const POOL_ERRORS = [
  "ZeroCommitment",
  "AlreadySpent",
  "UnknownRoot",
  "VerifierNotSet",
  "InvalidProof",
  "ZeroAddress",
  "TransferFailed",
  "InvalidAmount",
  "InsufficientPoolBalance",
  "DuplicateCommitment",
  "Reentrancy",
].map((name) => ({ type: "error" as const, name, inputs: [] }));

export const relayPoolAbi = [
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
  {
    type: "function",
    name: "unshield",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "root", type: "bytes32" },
      { name: "nullifier", type: "bytes32" },
      { name: "asset", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "spent",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "commitmentSeen",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isKnownRoot",
    stateMutability: "view",
    inputs: [{ name: "root", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  ...POOL_ERRORS,
] as const;

const memoAbi = [
  {
    type: "function",
    name: "postMemo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "paymentCommitment", type: "bytes32" },
      { name: "memo", type: "bytes" },
    ],
    outputs: [],
  },
  { type: "error", name: "ZeroCommitment", inputs: [] },
  { type: "error", name: "BadMemo", inputs: [] },
] as const;

/** Plain-language reasons for pool reverts (shown to the user). */
const REVERT_MESSAGES: Record<string, string> = {
  AlreadySpent: "This money was already spent. Refresh your balance.",
  UnknownRoot: "Your view of the vault is out of date. Refresh and try again.",
  InvalidProof: "The payment proof did not check out. Refresh and try again.",
  InsufficientPoolBalance: "The vault does not hold enough of this asset to cash out right now.",
  DuplicateCommitment: "This payment was already submitted.",
  VerifierNotSet: "This vault is not fully set up yet.",
  InvalidAmount: "That amount is not valid.",
  ZeroAddress: "Missing a destination address.",
  BadMemo: "The payment message is too large.",
  OverInput: "The price moved since the quote. Get a new one and try again.",
  ShortOutput: "The price moved since the quote. Get a new one and try again.",
  OverDepositLimit: "The vault is not taking that much of this asset right now. Swap a smaller amount.",
  PoolNotAllowed: "This swap route is not allowed.",
  BadRoute: "This swap route is not allowed.",
  FeeOnTransferNotSupported: "This token cannot be swapped into the vault.",
};

/** The router's call, with the vault's errors it can bubble up, for plain-language reverts. */
const swapCallAbi = [
  ...vaultSwapAbi,
  ...POOL_ERRORS,
  { type: "error" as const, name: "OverDepositLimit", inputs: [] },
  { type: "error" as const, name: "FeeOnTransferNotSupported", inputs: [] },
] as const;

export class RelayError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "bad_request"
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- config

let cachedAccounts: PrivateKeyAccount[] | undefined;

/**
 * Every relay account: GLOAM_RELAYER_PRIVATE_KEY, then any extra keys in
 * GLOAM_RELAYER_PRIVATE_KEYS (comma separated). Each sends on its own lane, so
 * more funded keys means more payments sent at the same moment.
 */
export function relayerAccounts(): PrivateKeyAccount[] {
  if (cachedAccounts) return cachedAccounts;
  const raws = [process.env.GLOAM_RELAYER_PRIVATE_KEY, ...(process.env.GLOAM_RELAYER_PRIVATE_KEYS ?? "").split(",")]
    .map((r) => r?.trim())
    .filter((r): r is string => Boolean(r));
  const seen = new Set<string>();
  const out: PrivateKeyAccount[] = [];
  for (const raw of raws) {
    const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) continue;
    const account = privateKeyToAccount(key);
    if (seen.has(account.address)) continue;
    seen.add(account.address);
    out.push(account);
  }
  return (cachedAccounts = out);
}

/** The first relay account (the one the status names). */
export function relayerAccount(): PrivateKeyAccount | null {
  return relayerAccounts()[0] ?? null;
}

export function relayNetworks(): GloamNetwork[] {
  return NETWORK_KEYS.map(getNetwork).filter(isNetworkWritable);
}

export function networkForChain(chainId: unknown): GloamNetwork {
  const id = typeof chainId === "number" ? chainId : Number(chainId);
  const net = relayNetworks().find((n) => n.chainId === id);
  if (!net || !net.pool) {
    throw new RelayError("This network is not supported by the relay.", 400, "network");
  }
  return net;
}

const publicClients = new Map<number, PublicClient>();

export function relayPublicClient(net: GloamNetwork): PublicClient {
  const hit = publicClients.get(net.chainId);
  if (hit) return hit;
  const c = createPublicClient({
    chain: net.chain,
    transport: serverTransport(net, { timeout: 20_000, retryCount: 1 }),
  });
  publicClients.set(net.chainId, c);
  return c;
}

/**
 * A send goes out once, to one RPC: no retry, and never replayed on the public
 * backup (lib/serverRpc sendOnce). A copy of a send the node already took can
 * only revert, or come back as a nonce clash that hides the first one.
 */
function walletFor(net: GloamNetwork, account: PrivateKeyAccount) {
  return createWalletClient({
    account,
    chain: net.chain,
    transport: serverTransport(net, { timeout: 30_000, retryCount: 0 }, { sendOnce: true }),
  });
}

// ---------------------------------------------------------------- limits

// Shared across server instances (lib/mcpRemote/rateLimit: Upstash Redis, or
// process memory when it is not set or does not answer).
const WINDOW_SEC = 10 * 60;
// A payroll run is up to 200 payments plus 200 notifications.
const PER_IP = 400;
/** Transactions the relay actually sends per network per hour. Refused requests never count. */
const PER_NETWORK_HOURLY = 5_000;
/**
 * Relayed payment messages per payment per day: for the payer, who holds the
 * payment's memo ticket, and for each partner key (one is needed, the rest
 * covers retries), and for everyone else together, so nobody can spend the
 * relay's gas posting junk for payments that are already in the vault.
 */
const MEMOS_PER_PAYMENT = 3;
const MEMOS_PER_PAYMENT_ALL = 10;

/** Per-sender limit (an IP, or an API key), checked before anything else. */
export async function checkRateLimit(requester: string): Promise<void> {
  if (!(await hitRateLimit(requester, "relay-ip", PER_IP, Date.now(), WINDOW_SEC)).allowed) {
    throw new RelayError("Too many requests from this device. Wait a few minutes.", 429, "rate_limit");
  }
}

// ---------------------------------------------------------------- memo tickets

/** Shortest GLOAM_RELAY_MEMO_SECRET taken; anything shorter counts as unset (a ticket in hand lets anyone guess at it offline). */
const MEMO_SECRET_MIN = 32;
let warnedShortSecret = false;

function memoSecret(): string | null {
  const s = process.env.GLOAM_RELAY_MEMO_SECRET?.trim();
  if (!s) return null;
  if (s.length < MEMO_SECRET_MIN) {
    if (!warnedShortSecret) console.warn("gloam_relay_memo_secret_short", JSON.stringify({ min: MEMO_SECRET_MIN }));
    warnedShortSecret = true;
    return null;
  }
  return s;
}

/**
 * The payer's ticket for a payment's message: HMAC-SHA256 under
 * GLOAM_RELAY_MEMO_SECRET of the chain and the payment commitment, base64url.
 * The relay hands it back with the transfer it relayed, so only whoever sent
 * that transfer through it holds one, and their heads-up gets its own few
 * messages that strangers can't use up (commitments are public on chain).
 * Null when the secret is unset or too short: then nobody holds a ticket and
 * every message but a partner key's shares the strangers' allowance.
 */
export function memoTicket(chainId: number, commitment: string): string | null {
  const secret = memoSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${chainId}:${commitment.toLowerCase()}`).digest("base64url");
}

function memoTicketOk(chainId: number, commitment: Hex, ticket: unknown): boolean {
  if (typeof ticket !== "string" || ticket.length > 64) return false;
  const want = memoTicket(chainId, commitment);
  if (!want) return false;
  const a = Buffer.from(ticket);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One relay transaction on this network, counted only once it passed every check and the dry run. */
async function takeNetworkSlot(net: GloamNetwork): Promise<void> {
  if (!(await hitRateLimit(`chain:${net.chainId}`, "relay-net", PER_NETWORK_HOURLY, Date.now(), 3600)).allowed) {
    throw new RelayError("The relay is busy. Try again shortly or send from your wallet.", 429, "rate_limit");
  }
}

// ---------------------------------------------------------------- validation

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function asBytes32(v: unknown, field: string): Hex {
  if (typeof v !== "string" || !BYTES32.test(v)) throw new RelayError(`Invalid ${field}.`);
  return v as Hex;
}

export function asAddress(v: unknown, field: string): Address {
  if (typeof v !== "string" || !ADDRESS.test(v)) throw new RelayError(`Invalid ${field}.`);
  return v as Address;
}

export function asProof(v: unknown): Hex {
  // Groth16 proof bytes: a handful of field elements, never more than 2 KB.
  if (typeof v !== "string" || !/^0x([0-9a-fA-F]{2}){64,2048}$/.test(v)) {
    throw new RelayError("Invalid proof.");
  }
  return v as Hex;
}

export function asAmount(v: unknown): bigint {
  if (typeof v !== "string" || !/^\d{1,78}$/.test(v)) throw new RelayError("Invalid amount.");
  const n = BigInt(v);
  if (n <= 0n) throw new RelayError("Invalid amount.");
  return n;
}

/**
 * Largest payment message the relay posts, in bytes. The memo board itself
 * takes up to 8192 (GloamPayMemo.MAX_MEMO), but a real message is always a
 * sealed ticket, and the largest one is 1714 bytes:
 *
 *   note JSON   376 bytes with no note (pool and asset addresses, a 78-digit
 *               amount, the secret and the commitment), plus `,"n":""` (7)
 *               and the note: 80 characters at 6 bytes each at worst once
 *               JSON escapes them (a lone surrogate becomes \uXXXX; emoji are
 *               4), so 480. Total 863.
 *   gloam1.     7 + base64url(863) = 7 + 1151 = 1158
 *   sealed      2 + 91 (P-256 key) + 12 (IV) + 1158 + 16 (GCM tag) = 1279
 *   gloam2t.    8 + base64url(1279) = 8 + 1706 = 1714
 *
 * The app pads every ticket before sealing it (lib/receiveTag padSealed) to
 * 512, 1024 or at most 1158 bytes, so padding never takes one past 1714.
 *
 * 2048 leaves 334 bytes over that worst case (over 600 for a note of real
 * characters), and a junk message costs the relay a quarter of what the board
 * would take.
 */
export const RELAY_MEMO_MAX_BYTES = 2048;

export function asMemo(v: unknown): Hex {
  if (typeof v !== "string") throw new RelayError("Invalid payment message.");
  if (v.length > 2 + 2 * RELAY_MEMO_MAX_BYTES) throw new RelayError(REVERT_MESSAGES.BadMemo);
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(v)) throw new RelayError("Invalid payment message.");
  return v as Hex;
}

/** Refuses a cash out that would strand the money in the vault or the memo board. */
export function assertCashOutTarget(net: Pick<GloamNetwork, "pool" | "payMemo">, to: Address): void {
  const problem = cashOutTargetProblem(to, net);
  if (problem) throw new RelayError(problem, 400, "vault_recipient");
}

// ---------------------------------------------------------------- submit

function revertName(err: unknown): string | null {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? null;
  }
  return null;
}

/**
 * What the node said about a failed call, and nothing else. viem's full
 * message also lists the request (its nonce, gas and data), so a test on it
 * matches words the node never said: every failed send names a "nonce".
 */
function nodeSaid(err: unknown): string {
  if (err instanceof BaseError) return `${err.shortMessage} ${err.details ?? ""}`;
  return err instanceof Error ? err.message : String(err);
}

/** A refusal over the nonce itself: nothing was taken, and the next nonce from the chain fixes it. */
const NONCE_CLASH = /nonce too (?:low|high)|nonce provided for the transaction|replacement|underpriced/i;

/**
 * A failed call, in plain words. `code` is for anything else: "check_failed"
 * when the dry run failed (nothing was sent), "rpc" when the node refused the
 * send itself (it may still have been taken, so callers treat it as maybe sent).
 */
function explain(err: unknown, fallback: string, code: "rpc" | "check_failed" = "rpc"): RelayError {
  const name = revertName(err);
  if (name && REVERT_MESSAGES[name]) return new RelayError(REVERT_MESSAGES[name], 422, name);
  const msg = nodeSaid(err);
  if (/insufficient funds|gas required exceeds/i.test(msg)) {
    return new RelayError("The relay is out of gas. Send from your wallet for now.", 503, "relay_empty");
  }
  return new RelayError(fallback, 502, code);
}

// Tempo caps a tx at 30M gas; keep headroom and pad estimates for Tempo's
// storage-heavy pricing (tree inserts).
const GAS_CAP = 25_000_000n;
function padGas(est: bigint) {
  const padded = (est * 13n) / 10n;
  return padded > GAS_CAP ? GAS_CAP : padded;
}

type SwapSpend = { proof: Hex; root: Hex; nullifier: Hex; asset: Address; amount: bigint };
type SwapDeposit = { proof: Hex; commitment: Hex; asset: Address; amount: bigint };

export type Call =
  | { kind: "transfer"; args: readonly [Hex, Hex, Hex, readonly [Hex, Hex]] }
  | { kind: "unshield"; args: readonly [Hex, Hex, Hex, Address, Address, bigint] }
  | { kind: "memo"; args: readonly [Hex, Hex] }
  | { kind: "swap"; router: Address; args: readonly [SwapSpend, SwapDeposit, SwapDeposit, Hex] };

/** Public addresses a call pays out to. Only a cash out has one. */
function publicRecipients(call: Call): Address[] {
  return call.kind === "unshield" ? [call.args[4]] : [];
}

/**
 * Refuse a call that pays a sanctioned address. Says nothing more than that.
 * With `net` on Tempo, a cash out is also checked against the asset's TIP-403
 * issuer policy: the vault must be allowed to send it and `to` to receive it.
 */
export async function screenCall(call: Call, net?: GloamNetwork): Promise<void> {
  const recipients = publicRecipients(call);
  if (recipients.length === 0) return;
  const context =
    net && call.kind === "unshield"
      ? { chainId: net.chainId, asset: call.args[3], flow: "cashout" as const }
      : undefined;
  const { allowed, message } = await screenAddresses(recipients, context);
  if (!allowed) {
    // A wallet block (sanctions or issuer) is neutral. A vault-level issuer
    // block or pause is not about the wallet, so it is said plainly.
    if (!message || message === SCREEN_BLOCKED_MESSAGE) {
      throw new RelayError(SCREEN_BLOCKED_MESSAGE, 403, "screened");
    }
    throw new RelayError(message, 403, "asset_policy");
  }
}

export const MAYBE_SENT_MESSAGE = "This may have gone out already. Wait a minute and refresh before trying again.";

/** A timeout or a dropped connection on the send can come after the node took the transaction. */
function mayHaveSent(err: unknown): boolean {
  if (err instanceof BaseError && err.walk((e) => e instanceof TimeoutError || e instanceof HttpRequestError)) {
    return true;
  }
  return /already known|timed? ?out/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * What a failed send means: "maybe_sent" when the node may have taken it (a
 * timeout, a dropped connection), so the caller must not call it unsent;
 * otherwise the node's refusal, explained.
 */
export function sendFailure(err: unknown): RelayError {
  if (mayHaveSent(err)) return new RelayError(MAYBE_SENT_MESSAGE, 502, "maybe_sent");
  return explain(err, "The relay could not submit this payment. Try again or send from your wallet.");
}

/** The relay accounts that can still pay for a send on `net`, first one first. */
export async function fundedRelayAccounts(
  net: GloamNetwork,
  offMessage = "The relay is off. Send from your wallet.",
  isEmpty: (net: GloamNetwork, a: PrivateKeyAccount) => Promise<boolean> = relayEmpty
): Promise<PrivateKeyAccount[]> {
  const all = relayerAccounts();
  if (!all.length) throw new RelayError(offMessage, 503, "relay_off");
  const accounts = (await Promise.all(all.map(async (a) => ((await isEmpty(net, a)) ? null : a)))).filter(
    (a): a is PrivateKeyAccount => a !== null
  );
  if (!accounts.length) {
    throw new RelayError("The relay is out of gas. Send from your wallet for now.", 503, "relay_empty");
  }
  return accounts;
}

/** `onMaybeSent` runs when the send failed in a way that may still have put the transaction out. */
async function submit(net: GloamNetwork, call: Call, onMaybeSent?: () => void): Promise<Hex> {
  // Screen before anything else: a blocked call never reaches the chain.
  await screenCall(call, net);
  // only accounts that can still pay for a send take part
  const accounts = await fundedRelayAccounts(net);
  const account = accounts[0]!;
  const pub = relayPublicClient(net);
  const pool = net.pool!;

  const estimate = (): Promise<bigint> => {
    switch (call.kind) {
      case "transfer":
        return pub.estimateContractGas({ address: pool, abi: relayPoolAbi, functionName: "transfer", args: call.args, account });
      case "unshield":
        return pub.estimateContractGas({ address: pool, abi: relayPoolAbi, functionName: "unshield", args: call.args, account });
      case "memo":
        return pub.estimateContractGas({ address: net.payMemo!.address, abi: memoAbi, functionName: "postMemo", args: call.args, account });
      case "swap":
        return pub.estimateContractGas({ address: call.router, abi: swapCallAbi, functionName: "swap", args: call.args, account });
    }
  };
  const send = (gas: bigint, nonce: number, from: PrivateKeyAccount): Promise<Hex> => {
    const wallet = walletFor(net, from);
    switch (call.kind) {
      case "transfer":
        return wallet.writeContract({ address: pool, abi: relayPoolAbi, functionName: "transfer", args: call.args, gas, nonce, chain: net.chain, account: from });
      case "unshield":
        return wallet.writeContract({ address: pool, abi: relayPoolAbi, functionName: "unshield", args: call.args, gas, nonce, chain: net.chain, account: from });
      case "memo":
        return wallet.writeContract({ address: net.payMemo!.address, abi: memoAbi, functionName: "postMemo", args: call.args, gas, nonce, chain: net.chain, account: from });
      case "swap":
        return wallet.writeContract({ address: call.router, abi: swapCallAbi, functionName: "swap", args: call.args, gas, nonce, chain: net.chain, account: from });
    }
  };

  let gas: bigint;
  try {
    // Dry run: reverts here (bad proof, spent note, stale root) cost nothing.
    gas = await estimate();
  } catch (e) {
    throw explain(e, "Could not check this payment. Try again.", "check_failed");
  }
  await takeNetworkSlot(net);

  // one send at a time per relay account and chain, each with the next nonce; with
  // several accounts, the first free one sends (lib/relay/inflight)
  const lanes = accounts.map((a) => ({
    id: `${net.chainId}:${a.address.toLowerCase()}`,
    chainNonce: () => pub.getTransactionCount({ address: a.address, blockTag: "pending" }),
  }));
  let usedLane: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await inSendLanes(lanes, (i, nonce) => {
        usedLane = lanes[i]!.id;
        return send(padGas(gas), nonce, accounts[i]!);
      });
      if (!out) throw new RelayError(RELAY_BUSY_MESSAGE, 503, "busy");
      return out.value;
    } catch (e) {
      if (e instanceof RelayError) throw e;
      // A send the node may have taken (a timeout, a dropped connection, "already
      // known") is never sent again: a second one would only revert and hide the first.
      const failure = sendFailure(e);
      if (failure.code === "maybe_sent") {
        onMaybeSent?.();
        throw failure;
      }
      // The node refused it over the nonce: the kept nonce and the chain disagree.
      // Start again from the chain, once.
      if (attempt === 0 && usedLane && NONCE_CLASH.test(nodeSaid(e))) {
        await forgetNonce(usedLane);
        continue;
      }
      throw failure;
    }
  }
  throw new RelayError("The relay could not submit this payment.", 502, "rpc");
}

export const IN_FLIGHT_MESSAGE = "This payment is already being sent. Wait a moment and refresh.";
export const RELAY_BUSY_MESSAGE = "The relay is busy right now. Try again in a moment or send from your wallet.";

/**
 * A send or cash out, one at a time per nullifier: take the lock, check the
 * note is unspent and the root known, then dry run and send. The lock is
 * dropped when nothing went out (a failed check, dry run or send), so the user
 * can retry at once; once a transaction is out it stays until it expires.
 */
async function submitSpend(
  net: GloamNetwork,
  call: Extract<Call, { kind: "transfer" | "unshield" | "swap" }>,
  precheck?: () => Promise<void>
): Promise<Hex> {
  const root = call.kind === "swap" ? call.args[0].root : call.args[1];
  const nullifier = call.kind === "swap" ? call.args[0].nullifier : call.args[2];
  const lock = await takeInflight(inflightKey(net.chainId, nullifier));
  if (!lock) throw new RelayError(IN_FLIGHT_MESSAGE, 409, "in_flight");
  let keep = false;
  try {
    await (precheck ? precheck() : precheckSpend(net, root, nullifier));
    const hash = await submit(net, call, () => {
      keep = true;
    });
    keep = true;
    return hash;
  } finally {
    if (!keep) await lock.release();
  }
}

export async function relayTransfer(net: GloamNetwork, body: Record<string, unknown>) {
  const proof = asProof(body.proof);
  const root = asBytes32(body.root, "root");
  const nullifier = asBytes32(body.nullifier, "nullifier");
  const commitments = body.commitments;
  if (!Array.isArray(commitments) || commitments.length !== 2) throw new RelayError("Invalid commitments.");
  const c0 = asBytes32(commitments[0], "commitment");
  const c1 = asBytes32(commitments[1], "commitment");
  return submitSpend(net, { kind: "transfer", args: [proof, root, nullifier, [c0, c1]] });
}

type UnshieldCall = Extract<Call, { kind: "unshield" }>;

/** A cash out from a request body, with its recipient checked and screened. */
async function unshieldCall(net: GloamNetwork, body: Record<string, unknown>): Promise<UnshieldCall> {
  const proof = asProof(body.proof);
  const root = asBytes32(body.root, "root");
  const nullifier = asBytes32(body.nullifier, "nullifier");
  const asset = asAddress(body.asset, "asset");
  const to = asAddress(body.to, "recipient");
  const amount = asAmount(body.amount);
  assertCashOutTarget(net, to);
  // The recipient and amount are public inputs of the unshield proof, so the
  // relay cannot change where the money goes.
  const call = { kind: "unshield", args: [proof, root, nullifier, asset, to, amount] } as const;
  await screenCall(call, net);
  return call;
}

export async function relayUnshield(net: GloamNetwork, body: Record<string, unknown>) {
  return submitSpend(net, await unshieldCall(net, body));
}

/**
 * A cash out to send later (lib/relay/scheduled): everything relayUnshield
 * checks, plus the dry run, but nothing is sent. Refuses now what would fail
 * later: a spent note, a stale root, a bad proof, a blocked recipient.
 */
export async function checkUnshieldForLater(net: GloamNetwork, body: Record<string, unknown>): Promise<UnshieldCall> {
  const call = await unshieldCall(net, body);
  await precheckSpend(net, call.args[1], call.args[2]);
  // The dry run from an account that can send it, as the send itself will be (one empty key is skipped).
  const [account] = await fundedRelayAccounts(net, "Cashing out later needs the Gloam relay, which is off right now.");
  try {
    await relayPublicClient(net).estimateContractGas({ address: net.pool!, abi: relayPoolAbi, functionName: "unshield", args: call.args, account });
  } catch (e) {
    throw explain(e, "Could not check this cash out. Try again.", "check_failed");
  }
  return call;
}

/** Sends a scheduled cash out now, through the same checks and lock as any relayed one. */
export async function sendUnshieldNow(net: GloamNetwork, body: Record<string, unknown>): Promise<Hex> {
  return submitSpend(net, await unshieldCall(net, body));
}

/**
 * Reads what a scheduled cash out needs at send time: is the note spent, does
 * the vault know the root. Both at one block, so answers from two nodes a
 * block apart can't call a cash out that landed unsent. Throws when either
 * can't be read (a node without that block yet too): the job counts as unread.
 */
export async function readSpendState(net: GloamNetwork, root: Hex, nullifier: Hex): Promise<{ spent: boolean; knownRoot: boolean }> {
  const pub = relayPublicClient(net);
  const blockNumber = await pub.getBlockNumber({ cacheTime: 0 });
  const [spent, knownRoot] = await Promise.all([
    pub.readContract({ address: net.pool!, abi: relayPoolAbi, functionName: "spent", args: [nullifier], blockNumber }),
    pub.readContract({ address: net.pool!, abi: relayPoolAbi, functionName: "isKnownRoot", args: [root], blockNumber }),
  ]);
  return { spent: Boolean(spent), knownRoot: Boolean(knownRoot) };
}

function asRoute(v: unknown): PoolKey[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 2) throw new RelayError("Invalid swap route.");
  return v.map((k) => {
    const r = (k ?? {}) as Record<string, unknown>;
    const fee = Number(r.fee);
    const tickSpacing = Number(r.tickSpacing);
    if (!Number.isInteger(fee) || fee < 0 || fee > 16_777_215) throw new RelayError("Invalid swap route.");
    if (!Number.isInteger(tickSpacing) || Math.abs(tickSpacing) > 8_388_607) throw new RelayError("Invalid swap route.");
    return {
      currency0: asAddress(r.currency0, "swap route"),
      currency1: asAddress(r.currency1, "swap route"),
      fee,
      tickSpacing,
      hooks: asAddress(r.hooks, "swap route"),
    };
  });
}

function asSwapDeposit(v: unknown): SwapDeposit {
  const d = (v ?? {}) as Record<string, unknown>;
  return {
    proof: asProof(d.proof),
    commitment: asBytes32(d.commitment, "commitment"),
    asset: asAddress(d.asset, "asset"),
    amount: asAmount(d.amount),
  };
}

const erc20BalanceAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

/**
 * A private swap through the vault (lib/vaultSwap). The note's unshield proof
 * names the swap's escrow as `to`, an address the router derives from the new
 * note, the refund note and the route, so the relay (or anyone who copies the
 * call) cannot change where the money goes or what lands. Only the chain's
 * router, only the vault's own assets, only a route the app builds, and the
 * same lock, root check and dry run as any spend. A note already spent is
 * refused, unless its money is waiting at this swap's escrow: then the call
 * puts it back as the refund note. That call (lib/vaultSwapRun
 * finishVaultSwapRefund) carries only the refund note's proof; the spend's
 * proof and root and the new note's proof are placeholders the router never
 * reads on that path, so the root is not checked for it.
 */
export async function relayVaultSwap(net: GloamNetwork, body: Record<string, unknown>) {
  const router = vaultSwapRouter(net.chainId);
  if (!router) throw new RelayError("Private swaps are not live on this network yet.", 400, "no_swap");
  const s = (body.spend ?? {}) as Record<string, unknown>;
  const spend: SwapSpend = {
    proof: asProof(s.proof),
    root: asBytes32(s.root, "root"),
    nullifier: asBytes32(s.nullifier, "nullifier"),
    asset: asAddress(s.asset, "asset"),
    amount: asAmount(s.amount),
  };
  const deposit = asSwapDeposit(body.deposit);
  const refund = asSwapDeposit(body.refund);
  if (spend.asset.toLowerCase() === deposit.asset.toLowerCase()) throw new RelayError("Pick two different assets.");
  if (!isSwapAsset(net.chainId, spend.asset) || !isSwapAsset(net.chainId, deposit.asset)) {
    throw new RelayError("This asset cannot be swapped here.", 400, "swap_asset");
  }
  if (refund.asset.toLowerCase() !== spend.asset.toLowerCase() || refund.amount > spend.amount) {
    throw new RelayError("Invalid refund note.");
  }
  const route = asRoute(body.route);
  if (!isKnownRoute(net.chainId, spend.asset, deposit.asset, route)) {
    throw new RelayError(REVERT_MESSAGES.BadRoute, 400, "BadRoute");
  }
  const routeBytes = encodeRoute(route);
  const pub = relayPublicClient(net);
  // A new note that is already in the vault would revert after the proof checks.
  const seen = await pub.readContract({ address: net.pool!, abi: relayPoolAbi, functionName: "commitmentSeen", args: [deposit.commitment] });
  if (seen) throw new RelayError(REVERT_MESSAGES.DuplicateCommitment, 409, "DuplicateCommitment");

  const precheck = async () => {
    const [spent, known] = await Promise.all([
      pub.readContract({ address: net.pool!, abi: relayPoolAbi, functionName: "spent", args: [spend.nullifier] }),
      pub.readContract({ address: net.pool!, abi: relayPoolAbi, functionName: "isKnownRoot", args: [spend.root] }),
    ]);
    if (!spent) {
      if (!known) throw new RelayError(REVERT_MESSAGES.UnknownRoot, 409, "UnknownRoot");
      return;
    }
    // spent: only worth a send if this swap's money is waiting at its escrow (the refund)
    const escrow = await pub.readContract({
      address: router,
      abi: vaultSwapAbi,
      functionName: "escrowFor",
      args: [
        spend.asset,
        {
          nullifier: spend.nullifier,
          amountIn: spend.amount,
          outCommitment: deposit.commitment,
          assetOut: deposit.asset,
          amountOut: deposit.amount,
          refundCommitment: refund.commitment,
          refundAmount: refund.amount,
          routeHash: keccak256(routeBytes),
        },
      ],
    });
    const waiting = await pub.readContract({ address: spend.asset, abi: erc20BalanceAbi, functionName: "balanceOf", args: [escrow] });
    if (waiting < refund.amount) throw new RelayError(REVERT_MESSAGES.AlreadySpent, 409, "AlreadySpent");
  };
  return submitSpend(net, { kind: "swap", router, args: [spend, deposit, refund, routeBytes] }, precheck);
}

/**
 * `body.ticket` is the payment's memo ticket (memoTicket) from the transfer's
 * response. `requester` is `key:<id>` for the partner API, which gets its own
 * few messages per payment; the app's route passes none, so no IP is ever
 * kept next to a payment.
 */
export async function relayMemo(net: GloamNetwork, body: Record<string, unknown>, requester?: string) {
  if (!net.payMemo) throw new RelayError("Payment messages are not live on this network yet.", 400, "no_memo");
  const commitment = asBytes32(body.paymentCommitment, "payment");
  const memo = asMemo(body.memo);
  // Only relay memos for payments that really landed in the pool.
  const seen = (await relayPublicClient(net).readContract({
    address: net.pool!,
    abi: relayPoolAbi,
    functionName: "commitmentSeen",
    args: [commitment],
  })) as boolean;
  if (!seen) throw new RelayError("That payment is not in the vault yet. Wait for it to confirm.", 409, "not_seen");
  // The memo board takes any number of messages per payment, and each relayed
  // one is gas the relay pays. The payer (with the ticket) and each partner key
  // get a few of their own; everyone else shares one small allowance, which a
  // stranger can use up but never the payer's. Keys name the payment and who
  // holds it, never an IP, and use no ":" (lib/mcpRemote/rateLimit reads a key
  // with colons as an IPv6 address and keeps only its first four groups).
  const payment = `memo|${net.chainId}|${commitment.toLowerCase()}`;
  const now = Date.now();
  const hit = memoTicketOk(net.chainId, commitment, body.ticket)
    ? await hitRateLimit(`${payment}|payer`, "relay-memo", MEMOS_PER_PAYMENT, now, 86_400)
    : requester?.startsWith("key:")
      ? await hitRateLimit(`${payment}|key|${requester.slice(4).replace(/:/g, "|")}`, "relay-memo", MEMOS_PER_PAYMENT, now, 86_400)
      : await hitRateLimit(payment, "relay-memo-all", MEMOS_PER_PAYMENT_ALL, now, 86_400);
  if (!hit.allowed) {
    throw new RelayError("A message for this payment was already sent.", 409, "memo_sent");
  }
  return submit(net, { kind: "memo", args: [commitment, memo] });
}

/**
 * Two cheap reads before the dry run, on every send and cash out, so a spent
 * note or a stale root is refused without running the proof check (the pool
 * verifies the proof before it reads `spent`).
 */
async function precheckSpend(net: GloamNetwork, root: Hex, nullifier: Hex) {
  const pub = relayPublicClient(net);
  const [spent, known] = await Promise.all([
    pub.readContract({ address: net.pool!, abi: relayPoolAbi, functionName: "spent", args: [nullifier] }),
    pub.readContract({ address: net.pool!, abi: relayPoolAbi, functionName: "isKnownRoot", args: [root] }),
  ]);
  if (spent) throw new RelayError(REVERT_MESSAGES.AlreadySpent, 409, "AlreadySpent");
  if (!known) throw new RelayError(REVERT_MESSAGES.UnknownRoot, 409, "UnknownRoot");
}

// ---------------------------------------------------------------- status

export type RelayNetworkStatus = {
  chainId: number;
  key: string;
  enabled: boolean;
  relayer: Address | null;
  memo: boolean;
  lowBalance: boolean;
};

/** Relay balance reads kept briefly, so a public status poll is not an RPC call each time. */
const BALANCE_TTL_MS = 30_000;
const RELAY_RESERVE_GAS = 2n * 2_400_000n;
const balances = new Map<string, { at: number; empty: boolean }>();

/** Tempo has no native coin: fees are paid in the account's chosen stablecoin, else PathUSD. */
const TEMPO_FEE_MANAGER = "0xfeec000000000000000000000000000000000000" as Address;
const TEMPO_PATH_USD = "0x20c0000000000000000000000000000000000000" as Address;
/** 0.50 in a 6-decimal USD fee token: enough for a couple more private transfers. */
const TEMPO_FEE_RESERVE = 500_000n;
const tempoFeeAbi = [
  { name: "userTokens", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const isTempoChain = (chainId: number) => chainId === 42431 || chainId === 4217;

/** Whether this relay account can no longer pay for a send on `net`. */
async function relayEmpty(net: GloamNetwork, account: PrivateKeyAccount): Promise<boolean> {
  const id = `${net.chainId}:${account.address}`;
  const hit = balances.get(id);
  if (hit && Date.now() - hit.at < BALANCE_TTL_MS) return hit.empty;
  try {
    const client = relayPublicClient(net);
    const read = async (): Promise<boolean> => {
      if (isTempoChain(net.chainId)) {
        const chosen = await client.readContract({ address: TEMPO_FEE_MANAGER, abi: tempoFeeAbi, functionName: "userTokens", args: [account.address] });
        const token = chosen && chosen !== "0x0000000000000000000000000000000000000000" ? chosen : TEMPO_PATH_USD;
        const balance = await client.readContract({ address: token, abi: tempoFeeAbi, functionName: "balanceOf", args: [account.address] });
        return balance < TEMPO_FEE_RESERVE;
      }
      const [balance, gasPrice] = await Promise.all([client.getBalance({ address: account.address }), client.getGasPrice()]);
      // can't pay for a couple more private transfers (about 1.8M gas each)
      return balance < gasPrice * RELAY_RESERVE_GAS;
    };
    // a slow RPC must not hold up the status the app checks before every relayed send
    const empty = await Promise.race([
      read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("relay status: slow rpc")), 3_000)),
    ]);
    balances.set(id, { at: Date.now(), empty });
    if (empty) console.warn("gloam_relay_low_balance", JSON.stringify({ chainId: net.chainId, relayer: account.address }));
    return empty;
  } catch {
    /* status is best effort */
    return false;
  }
}

export async function relayStatus(): Promise<RelayNetworkStatus[]> {
  const accounts = relayerAccounts();
  const account = accounts[0] ?? null;
  return Promise.all(
    relayNetworks().map(async (net) => {
      // low = no account left that can pay for a send here
      const empties = await Promise.all(accounts.map((a) => relayEmpty(net, a)));
      const lowBalance = accounts.length > 0 && empties.every(Boolean);
      return {
        chainId: net.chainId,
        key: net.key,
        enabled: accounts.length > 0 && !lowBalance,
        relayer: account?.address ?? null,
        memo: Boolean(net.payMemo),
        lowBalance,
      };
    })
  );
}
