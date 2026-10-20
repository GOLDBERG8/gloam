/**
 * ShieldPool, RH testnet.
 * keccak Phase-1 live pool OR Poseidon Phase-2 (env NEXT_PUBLIC_POSEIDON_SHIELD_POOL).
 */

import { formatUnits, parseUnits, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { RH_STABLE_TOKENS, TEMPO_STABLE_TOKENS, TESTNET_STOCK_TOKENS } from "./tokens";
import { getActiveNetwork } from "./networks";
import { makeBoundNote } from "./note";
import { getAllNotes, setAllNotes } from "./noteVault";
import { walkLogs, walkTuning } from "./leafIndex";
import {
  activeHashScheme,
  activePoolAddress,
  activeShieldDeployBlock,
  type HashScheme,
} from "./config";

/** Live keccak RH testnet deploy */
export const TESTNET_SHIELD_POOL =
  "0x2BD98196D90AB45D58843B4c8B8809aa34343d35" as const satisfies Address;

/** getLogs from pool deploy block (sealed Poseidon default; rejects stale A488 env) */
export const SHIELD_DEPLOY_BLOCK = activeShieldDeployBlock();

export const HASH_SCHEME: HashScheme = activeHashScheme();

export const SHIELD_POOL_ADDRESS: Address | null = activePoolAddress();

/** Native ETH in the pool (asset address zero) */
export const NATIVE_ASSET = zeroAddress;

export const shieldPoolAbi = [
  {
    type: "function",
    name: "shield",
    stateMutability: "payable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "commitment", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "shieldBound",
    stateMutability: "payable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "commitment", type: "bytes32" },
      { name: "proof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "shieldVerifier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "commitmentSeen",
    stateMutability: "view",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "currentRoot",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "nextIndex",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposited",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  // Beta deposit limits (ShieldPoolCore). Pools deployed before them lack these
  // reads, so a failed read means no limits.
  {
    type: "function",
    name: "depositLimitsOn",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "depositLimit",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "perDeposit", type: "uint128" },
      { name: "total", type: "uint128" },
    ],
  },
  { type: "error", name: "OverDepositLimit", inputs: [] },
  // Cash-out fee (ShieldPoolCore, mainnet). Pools deployed before it lack these
  // reads, so a failed read means no fee.
  {
    type: "function",
    name: "withdrawFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "feeRecipient",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "feesOwed",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_WITHDRAW_FEE_BPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "verifier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "isSpent",
    stateMutability: "view",
    inputs: [{ name: "nullifier", type: "bytes32" }],
    outputs: [{ type: "bool" }],
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
    name: "sealedSwap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "root", type: "bytes32" },
      { name: "nullifier", type: "bytes32" },
      { name: "newCommitmentOut", type: "bytes32" },
      { name: "newCommitmentChange", type: "bytes32" },
      { name: "assetIn", type: "address" },
      { name: "assetOut", type: "address" },
      { name: "amountOutMin", type: "uint256" },
      { name: "rateIn", type: "uint256" },
      { name: "rateOut", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sealedSwapVerifier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "setSealedSwapVerifier",
    stateMutability: "nonpayable",
    inputs: [{ name: "verifier_", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "PROOF_LAYOUT_VERSION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "HASH_SCHEME",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "verifier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "isKnownRoot",
    stateMutability: "view",
    inputs: [{ name: "root", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "Shielded",
    inputs: [
      { name: "commitment", type: "bytes32", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "leafIndex", type: "uint256", indexed: false },
      { name: "from", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Unshielded",
    inputs: [
      { name: "nullifier", type: "bytes32", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Transferred",
    inputs: [
      { name: "nullifier", type: "bytes32", indexed: true },
      { name: "newCommitments", type: "bytes32[2]", indexed: false },
    ],
  },
] as const;

/** RH L2 gas headroom */
/** Poseidon verify + tree insert, 500k was tight; unshield/transfer need headroom */
export const SHIELD_GAS_LIMIT = 1_500_000n;
/** A private transfer verifies a proof and inserts two notes: about 1.75M on Robinhood Chain. */
export const TRANSFER_GAS_LIMIT = 2_400_000n;
// shieldBound also verifies a Groth16 proof on-chain (~250k extra).
export const SHIELD_BOUND_GAS_LIMIT = 1_900_000n;
/** Sealed swap proof verify is heavier */
export const SEALED_SWAP_GAS_LIMIT = 2_500_000n;
export const APPROVE_GAS_LIMIT = 120_000n;

/**
 * The fixed limits above are sized for Robinhood Chain. Tempo meters gas very
 * differently (a fresh account's approve takes about 534k), and some wallets use
 * the app's number as-is, so on Tempo the wallet estimates instead.
 */
export function gasFor(chainId: number, limit: bigint): bigint | undefined {
  return chainId === 42431 || chainId === 4217 ? undefined : limit;
}

export function isShieldDeployed(): boolean {
  return Boolean(SHIELD_POOL_ADDRESS);
}

/**
 * The chain + pool the app is pointed at right now. Notes are scoped to both:
 * a Tempo note must never show (or be spent) on Robinhood, and a note from a
 * superseded pool deploy is not spendable in the current one.
 */
function activeScope(): { chainId: number; pool: string | null } {
  const n = getActiveNetwork();
  return { chainId: n.chainId, pool: n.pool ? n.pool.toLowerCase() : null };
}

function inActiveScope(
  n: Pick<LocalNote, "chainId" | "pool">,
  scope = activeScope()
): boolean {
  if (n.chainId !== scope.chainId) return false;
  if (scope.pool && n.pool && n.pool.toLowerCase() !== scope.pool) return false;
  return true;
}

const KNOWN_TOKENS = [...RH_STABLE_TOKENS, ...TESTNET_STOCK_TOKENS, ...TEMPO_STABLE_TOKENS];

export function isNativeAsset(asset: string) {
  return !asset || asset.toLowerCase() === NATIVE_ASSET.toLowerCase();
}

export function assetLabel(asset: string): string {
  if (isNativeAsset(asset)) return getActiveNetwork().primaryAsset.symbol;
  const t = KNOWN_TOKENS.find(
    (x) => x.address.toLowerCase() === asset.toLowerCase()
  );
  return t?.symbol ?? shortAsset(asset);
}

export function assetDecimals(asset: string): number {
  if (isNativeAsset(asset)) return 18;
  const t = KNOWN_TOKENS.find(
    (x) => x.address.toLowerCase() === asset.toLowerCase()
  );
  return t?.decimals ?? 18;
}

/** Human amount for a raw note value, using the asset's real decimals (PathUSD 6, ETH 18). */
export function formatAssetAmount(raw: bigint | string, asset: string, maxFrac = 6): string {
  let v: bigint;
  try {
    v = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  } catch {
    return String(raw);
  }
  if (v === 0n) return "0";
  const n = Number(formatUnits(v, assetDecimals(asset)));
  if (!Number.isFinite(n)) return formatUnits(v, assetDecimals(asset));
  const floor = 1 / 10 ** Math.min(maxFrac, 4);
  if (n > 0 && n < floor) return `<${floor}`;
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}

/** "12.5 PathUSD" style label for a raw amount. */
export function formatAssetLabel(raw: bigint | string, asset: string): string {
  return `${formatAssetAmount(raw, asset)} ${assetLabel(asset)}`;
}

/**
 * The cash-out fee the pool keeps from `amount` at `bps` basis points. Same
 * math as ShieldPoolCore.unshield: floor(amount * bps / 10_000).
 */
export function withdrawFeeOf(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps <= 0) return 0n;
  return (amount * BigInt(bps)) / 10_000n;
}

/** "0.25%" for 25 bps, "1%" for 100. */
export function formatFeePercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** Parse a typed amount into raw units for this asset (null when invalid). */
export function parseAssetAmount(input: string, asset: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!s || !/^\d*\.?\d+$/.test(s)) return null;
  const decimals = assetDecimals(asset);
  const [a, b = ""] = s.split(".");
  if (b.length > decimals) return null;
  try {
    return parseUnits(b ? `${a || "0"}.${b}` : a, decimals);
  } catch {
    return null;
  }
}

function shortAsset(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Bound note for shield(), keccak scheme (legacy live pool).
 * Poseidon notes: use makeBoundNotePoseidon from notePoseidon.ts
 */
export function makeNoteMaterial(
  amount: bigint,
  asset: Address = NATIVE_ASSET
): { secret: Hex; commitment: Hex; nullifier: Hex } {
  return makeBoundNote(amount, asset);
}

export type LocalNote = {
  id: string;
  chainId: number;
  pool: Address;
  asset: Address;
  amountWei: string;
  commitment: Hex;
  /** Empty when reconstructed from chain only */
  secret: Hex;
  /** Precomputed for unshield when secret is known */
  nullifier?: Hex;
  /** true when commitment binds secret+amount+asset */
  bound?: boolean;
  /** poseidon = circuit-compatible; keccak = live Phase-1 */
  scheme?: HashScheme;
  leafIndex?: number;
  txHash?: Hex;
  from?: Address;
  createdAt: number;
  status?: "open" | "recovered";
  /** local = browser secret; chain = public Shielded event */
  source?: "local" | "chain";
  /**
   * The payer's private note on a received payment ("Invoice 042"), from the
   * payment itself (lib/paymentNote). Kept with the note's secret, so it is
   * encrypted at rest; never part of a proof.
   */
  note?: string;
  /**
   * A claimed payment (`imp-` id) that has been secured: moved into a fresh
   * note only this browser knows, so the payer can no longer spend it
   * (lib/claimSweep). The claimed note itself is spent by that move.
   */
  secured?: boolean;
  /** On the fresh note from securing a claim: the claimed note it came from. */
  sweptFrom?: { id: string; nullifier: Hex };
  /**
   * The move into this note was sent (or may have been) but has not been seen
   * on chain yet. Not counted in the balance until it lands; kept, never
   * dropped, because it may still land (lib/claimSweep reconciles it).
   */
  sweepPending?: boolean;
};

export function confirmedNotes(notes: LocalNote[]): LocalNote[] {
  return notes.filter((n) => Boolean(n.txHash) && n.status !== "recovered");
}

/**
 * Notes you can still spend (have a local secret).
 * Includes imports (no txHash yet) and confirmed shields/transfers.
 * Excludes recovered and chain-history-only rows without a secret.
 * Excludes historic sender payment rows (id pay-*), and a secured claim's
 * fresh note until its move lands (the claimed note still counts until then).
 */
export function activeSpendableNotes(notes: LocalNote[]): LocalNote[] {
  return notes.filter((n) => holdsSecret(n) && !n.sweepPending);
}

/** Not spent, and this browser has its secret (a pending secured claim too). */
function holdsSecret(n: LocalNote): boolean {
  return (
    n.status !== "recovered" &&
    !n.id.startsWith("pay-") &&
    Boolean(n.secret) &&
    n.secret !== "0x" &&
    n.secret.length > 10
  );
}

/**
 * Retire payment notes wrongly saved on the sender (pre-audit bug).
 * Safe to call on every load.
 */
export function purgeSenderPaymentNotes(): boolean {
  if (typeof window === "undefined") return false;
  const all = getAllNotes();
  let changed = false;
  const next = all.map((n) => {
    if (n?.id?.startsWith("pay-") && n.status !== "recovered") {
      changed = true;
      return { ...n, status: "recovered" as const };
    }
    return n;
  });
  if (changed) setAllNotes(next);
  return changed;
}

export type NotesBackup = {
  v: 1;
  type: "gloam-notes-backup";
  exportedAt: number;
  chainId: number;
  notes: LocalNote[];
};

/** Export spendable notes (secrets!) for device backup. */
export function exportNotesBackup(address?: string | null): NotesBackup {
  purgeSenderPaymentNotes();
  // A secured claim's pending note goes too: its move may still land.
  const notes = loadLocalNotes(address).filter(holdsSecret);
  return {
    v: 1,
    type: "gloam-notes-backup",
    exportedAt: Date.now(),
    chainId: activeScope().chainId,
    notes,
  };
}

/** Merge a backup into local storage. Returns how many notes were added/updated. */
export function importNotesBackup(
  raw: string,
  address?: string | null
): { ok: true; count: number } | { ok: false; error: string } {
  try {
    const data = JSON.parse(raw) as NotesBackup;
    if (data?.type !== "gloam-notes-backup" || data.v !== 1) {
      return { ok: false, error: "Not a Gloam notes backup." };
    }
    const scope = activeScope();
    if (data.chainId !== scope.chainId) {
      return { ok: false, error: "Backup is for a different network. Switch networks and try again." };
    }
    if (!Array.isArray(data.notes)) {
      return { ok: false, error: "Backup has no notes." };
    }
    let count = 0;
    for (const n of data.notes) {
      if (!n?.secret || !n?.commitment || !n?.amountWei) continue;
      if (n.chainId !== scope.chainId) continue;
      if (n.id?.startsWith("pay-")) continue;
      const note: LocalNote = {
        ...n,
        from: (address as Address | undefined) ?? n.from,
        status: n.status === "recovered" ? "recovered" : "open",
        source: "local",
        bound: n.bound ?? true,
      };
      if (note.status === "recovered") continue;
      saveLocalNote(note);
      count++;
    }
    return { ok: true, count };
  } catch {
    return { ok: false, error: "Could not parse backup JSON." };
  }
}

/** ETH only (native asset), spendable notes only */
export function sumEthWei(notes: LocalNote[]): bigint {
  return activeSpendableNotes(notes)
    .filter((n) => isNativeAsset(n.asset))
    .reduce((s, n) => s + BigInt(n.amountWei || "0"), BigInt(0));
}

/** @deprecated use sumEthWei */
export function sumNoteWei(notes: LocalNote[]): bigint {
  return sumEthWei(notes);
}

export function sumByAsset(notes: LocalNote[]): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const n of activeSpendableNotes(notes)) {
    const k = n.asset.toLowerCase();
    m.set(k, (m.get(k) ?? BigInt(0)) + BigInt(n.amountWei || "0"));
  }
  return m;
}

export function markAllNotesRecovered(
  address?: string | null,
  asset?: Address | null
) {
  if (typeof window === "undefined") return;
  const lower = address?.toLowerCase();
  const assetLower = asset?.toLowerCase();
  const scope = activeScope();
  const next = getAllNotes().map((n) => {
    if (!inActiveScope(n, scope)) return n;
    if (lower && n.from && n.from.toLowerCase() !== lower) return n;
    if (!n.txHash) return n;
    if (assetLower && n.asset.toLowerCase() !== assetLower) return n;
    return { ...n, status: "recovered" as const };
  });
  setAllNotes(next);
}

export function loadLocalNotes(address?: string | null): LocalNote[] {
  if (typeof window === "undefined") return [];
  const scope = activeScope();
  const filtered = getAllNotes().filter((n) => inActiveScope(n, scope));
  if (!address) return filtered;
  const lower = address.toLowerCase();
  return filtered.filter((n) => !n.from || n.from.toLowerCase() === lower);
}

/** Spent/history rows kept for the activity view. Spendable notes are never trimmed. */
const MAX_HISTORY_NOTES = 200;

export function saveLocalNote(note: LocalNote) {
  if (typeof window === "undefined") return;
  const next = [note, ...getAllNotes().filter((n) => n.id !== note.id)];
  // Never drop a note that can still be spent (that would lose the money);
  // only trim spent or chain-only history rows once there are too many.
  let history = 0;
  const kept = next.filter((n) => {
    const spendable =
      n.status !== "recovered" && Boolean(n.secret) && n.secret !== "0x";
    if (spendable) return true;
    history++;
    return history <= MAX_HISTORY_NOTES;
  });
  setAllNotes(kept);
}

export function updateLocalNote(
  id: string,
  patch: Partial<Pick<LocalNote, "leafIndex" | "txHash" | "status" | "secured" | "sweepPending">>
) {
  if (typeof window === "undefined") return;
  const next = getAllNotes().map((n) => (n.id === id ? { ...n, ...patch } : n));
  setAllNotes(next);
}

/**
 * Drop a note saved ahead of a send that never went out (the wallet refused it).
 * Only a note still waiting to land and with no transaction is dropped.
 */
export function dropUnsentNote(id: string) {
  if (typeof window === "undefined") return;
  const next = getAllNotes().filter((n) => !(n.id === id && n.sweepPending && !n.txHash));
  setAllNotes(next);
}

/** Clear ghost balances after cash-out / private send when nullifier was spent. */
export function markNoteRecovered(id: string) {
  updateLocalNote(id, { status: "recovered" });
}

/** Merge browser notes with on-chain Shielded events (prefer local secrets). */
export function mergeNotes(
  local: LocalNote[],
  chain: LocalNote[]
): LocalNote[] {
  const byCommit = new Map<string, LocalNote>();

  for (const n of chain) {
    byCommit.set(n.commitment.toLowerCase(), n);
  }
  for (const n of local) {
    const k = n.commitment.toLowerCase();
    const existing = byCommit.get(k);
    if (!existing) {
      byCommit.set(k, { ...n, source: n.source ?? "local" });
      continue;
    }
    byCommit.set(k, {
      ...existing,
      ...n,
      secret: n.secret && n.secret !== "0x" ? n.secret : existing.secret,
      source: "local",
      status: n.status === "recovered" ? "recovered" : existing.status,
      leafIndex: n.leafIndex ?? existing.leafIndex,
      txHash: n.txHash ?? existing.txHash,
    });
  }

  return [...byCommit.values()].sort(
    (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
  );
}

/** Pull Shielded events for a wallet (amounts public on deposit edge). */
export async function fetchChainShieldNotes(
  client: PublicClient,
  from: Address
): Promise<LocalNote[]> {
  const net = getActiveNetwork();
  const pool = net.pool;
  if (!pool) return [];
  const deployBlock = net.deployBlock ?? SHIELD_DEPLOY_BLOCK;
  try {
    const latest = await client.getBlockNumber();
    const logs: {
      args?: {
        commitment?: Hex;
        asset?: Address;
        amount?: bigint;
        leafIndex?: bigint;
        from?: Address;
      };
      transactionHash?: Hex | null;
    }[] = [];
    // this wallet's deposits only, in the chain's widest ranges and a few at a time
    // (lib/leafIndex): a handful of calls on Robinhood Chain instead of one per 100k blocks
    const found = await walkLogs(client, pool, deployBlock, latest, walkTuning(net.chainId, net.logRange), {
      event: {
        type: "event",
        name: "Shielded",
        inputs: [
          { name: "commitment", type: "bytes32", indexed: true },
          { name: "asset", type: "address", indexed: true },
          { name: "amount", type: "uint256", indexed: false },
          { name: "leafIndex", type: "uint256", indexed: false },
          { name: "from", type: "address", indexed: true },
        ],
      },
      args: { from },
    });
    logs.push(...(found as unknown as typeof logs));

    return logs.map((log, i) => {
      const args = log.args ?? {};
      const commitment = (args.commitment ??
        "0x0000000000000000000000000000000000000000000000000000000000000000") as Hex;
      return {
        id: `chain-${log.transactionHash ?? i}-${args.leafIndex ?? i}`,
        chainId: net.chainId,
        pool,
        asset: (args.asset ?? NATIVE_ASSET) as Address,
        amountWei: (args.amount ?? BigInt(0)).toString(),
        commitment,
        // chain-only row, no spend secret (placeholder, not a key)
        secret: "0x" as Hex,
        leafIndex:
          args.leafIndex != null ? Number(args.leafIndex) : undefined,
        txHash: (log.transactionHash ?? undefined) as Hex | undefined,
        from: (args.from ?? from) as Address,
        createdAt: Date.now() - i,
        status: "open" as const,
        source: "chain" as const,
      };
    });
  } catch {
    return [];
  }
}
