/*
 * The recording demo's pretend chain (switch in lib/demoFlag.ts). One funded
 * wallet per network: its private notes, its public balances, what the
 * explorer shows about it, and every "transaction" it sends. Held in memory and
 * mirrored to sessionStorage, so a reload mid-take keeps the story going.
 *
 * Nothing here signs, proves or sends anything. No React and no wagmi either,
 * so plain lib code (the note vault, the prover, the relay client) can route
 * here as well as the app's hooks.
 */

import { parseUnits, zeroAddress, type Address, type Hex } from "viem";
import type { ActivityTx } from "@/hooks/useActivity";
import { DEMO_STATE_KEY } from "@/lib/demoFlag";
import { getNetwork, type GloamNetwork, type NetworkKey } from "@/lib/networks";
import type { LocalNote } from "@/lib/shield";
import { RH_STABLE_TOKENS, TEMPO_STABLE_TOKENS, TESTNET_STOCK_TOKENS } from "@/lib/tokens";

export const DEMO_ADDRESS: Address = "0x7A3f9C21b8e04d6f5a009D2E8b4F0C3D61e9B5a7";

/** How long each step holds on screen (ms), before a little jitter. */
export const DEMO_MS = {
  /** Signing in the wallet. */
  wallet: 900,
  /** Building a proof in the browser. */
  proof: 1900,
  /** Handing a proven action to the relay. */
  relay: 1000,
  /** A transaction landing. */
  confirm: 1100,
  /** Checking a shared proof, then finding its balance. */
  verify: 900,
  lookup: 700,
  /** The Tempo faucet. */
  faucet: 1400,
} as const;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A step's time with some wobble, so a run reads as work, not a metronome. */
export function jitter(ms: number): number {
  return Math.round(ms * (0.85 + Math.random() * 0.3));
}

export function randomHex(bytes: number): Hex {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}` as Hex;
}

/** Random 32 bytes that are always a valid circuit field element. */
export function randomField(): Hex {
  return `0x00${randomHex(31).slice(2)}` as Hex;
}

// ------------------------------------------------------------------ seed

type Seed = {
  /** Private notes: symbol, amount, days ago, and whether it is change from a payment. */
  notes: [string, string, number, boolean?][];
  /** Public wallet balances. */
  wallet: [string, string][];
  /** What the explorer shows, newest first: a vault deposit (with any native value), money in, or an approval. */
  activity: (["vault", string, number] | ["in", string, number] | ["approve", string, number])[];
  /** A private payment waiting under Pay, Receive: symbol, amount, and the payer's private note. */
  incoming: [string, string, string?];
  /** Private balances already in the vault (the tree size). */
  leaves: number;
};

/** Demo recordings run on the testnets only. */
const SEEDS: Partial<Record<NetworkKey, Seed>> = {
  robinhood: {
    // USDG 48,250 over three notes, sized so the sample payroll is covered.
    notes: [
      ["USDG", "30000", 21],
      ["ETH", "1.5", 16],
      ["TSLA", "6", 12],
      ["USDG", "12000", 9],
      ["ETH", "0.9", 6],
      ["AMZN", "10", 5],
      ["USDG", "6250", 3, true],
    ],
    wallet: [
      ["ETH", "1.2"],
      ["USDG", "5000"],
      ["AMD", "40"],
      ["TSLA", "3"],
      ["PLTR", "25"],
      ["AMZN", "5"],
      ["NFLX", "2"],
    ],
    activity: [
      ["vault", "0", 3],
      ["vault", "0", 5],
      ["vault", "0.9", 6],
      ["vault", "0", 9],
      ["vault", "0", 12],
      ["in", "2.5", 14],
      ["vault", "1.5", 16],
      ["vault", "0", 21],
      ["approve", "USDG", 21],
      ["in", "4", 25],
    ],
    incoming: ["USDG", "1250", "Invoice 042"],
    leaves: 1284,
  },
  tempo: {
    // OUSD is the main stablecoin here: 25,000 over three notes, again sized so
    // the sample payroll is covered. PathUSD is a smaller second balance.
    notes: [
      ["OUSD", "15000", 19],
      ["PathUSD", "2400", 11],
      ["OUSD", "6500", 8],
      ["PathUSD", "1100", 4],
      ["OUSD", "3500", 2, true],
    ],
    wallet: [
      ["USD", "1000"],
      ["OUSD", "4000"],
      ["PathUSD", "1250"],
    ],
    activity: [
      ["vault", "0", 2],
      ["vault", "0", 4],
      ["vault", "0", 8],
      ["vault", "0", 11],
      ["approve", "PathUSD", 11],
      ["vault", "0", 19],
      ["approve", "OUSD", 19],
    ],
    incoming: ["OUSD", "800", "Invoice 017"],
    leaves: 312,
  },
};

/** Where the seeded wallet's outside money came from (an exchange, say). */
const FUNDER: Address = "0x8c41f0A7d52e3b9ce1002A4d2b7c95E3a0d4f1C6";
const DAY = 86_400_000;
const TOKENS = [...RH_STABLE_TOKENS, ...TESTNET_STOCK_TOKENS, ...TEMPO_STABLE_TOKENS];

function assetOf(net: GloamNetwork, symbol: string): { address: Address; decimals: number } {
  if (symbol === net.primaryAsset.symbol) return { address: zeroAddress, decimals: 18 };
  const t = TOKENS.find((x) => x.symbol === symbol);
  if (!t) throw new Error(`demo: unknown asset ${symbol}`);
  return { address: t.address, decimals: t.decimals };
}

function makeNote(args: {
  id: string;
  chainId: number;
  pool: Address;
  asset: Address;
  amount: bigint;
  createdAt: number;
  leafIndex: number;
}): LocalNote {
  return {
    id: args.id,
    chainId: args.chainId,
    pool: args.pool,
    asset: args.asset,
    amountWei: args.amount.toString(),
    commitment: randomField(),
    secret: randomField(),
    nullifier: randomField(),
    bound: true,
    scheme: "poseidon",
    leafIndex: args.leafIndex,
    txHash: randomHex(32),
    from: DEMO_ADDRESS,
    createdAt: args.createdAt,
    status: "open",
    source: "local",
  };
}

/** A payment someone sent this wallet, waiting to be claimed. */
export type DemoIncoming = {
  asset: Address;
  amountWei: string;
  secret: Hex;
  commitment: Hex;
  leafIndex: number;
  /** The payer's private note, sealed inside the payment like a real one. */
  note?: string;
  /** The encrypted memo, once built for this browser's Gloam address. */
  tag?: string;
  ticket?: string;
};

type ChainState = {
  /** Public balances by lowercased asset, in raw units. */
  wallet: Record<string, string>;
  activity: ActivityTx[];
  /** Next free leaf in the vault tree. */
  nextLeaf: number;
  incoming: DemoIncoming;
  /** Payments this wallet sent, by lowercased commitment: their leaf, so a claim link can be claimed (or taken back). */
  sent?: Record<string, number>;
};

/** A cash out the pretend relay holds for later (lib/cashOutLater in a demo). */
export type DemoCashOutJob = {
  id: string;
  chainId: number;
  nullifier: Hex;
  asset: Address;
  to: Address;
  /** Base units, as a decimal string. */
  amount: string;
  sendAfter: number;
  status: "scheduled" | "sent" | "cancelled";
  updatedAt: number;
  hash?: Hex;
};

type DemoState = { notes: LocalNote[]; chains: Record<number, ChainState>; jobs?: Record<string, DemoCashOutJob> };

function seed(): DemoState {
  const now = Date.now();
  const notes: LocalNote[] = [];
  const chains: Record<number, ChainState> = {};
  for (const key of Object.keys(SEEDS) as NetworkKey[]) {
    const net = getNetwork(key);
    const s = SEEDS[key];
    if (!s) continue;
    if (!net.pool) continue;
    const pool = net.pool;
    // Spread the wallet's leaves through the recent part of the tree.
    let leaf = s.leaves - 180;
    s.notes.forEach(([symbol, amount, days, change], i) => {
      const a = assetOf(net, symbol);
      leaf += 11 + ((i * 37) % 23);
      notes.push(
        makeNote({
          id: `${change ? "chg-" : ""}demo-${key}-${i}`,
          chainId: net.chainId,
          pool,
          asset: a.address,
          amount: parseUnits(amount, a.decimals),
          createdAt: now - days * DAY - i * 3_600_000,
          leafIndex: leaf,
        })
      );
    });
    const wallet: Record<string, string> = {};
    for (const [symbol, amount] of s.wallet) {
      const a = assetOf(net, symbol);
      wallet[a.address.toLowerCase()] = parseUnits(amount, a.decimals).toString();
    }
    const activity: ActivityTx[] = s.activity.map(([kind, v, days]) => ({
      hash: randomHex(32),
      from: kind === "in" ? FUNDER : DEMO_ADDRESS,
      to: kind === "vault" ? pool : kind === "in" ? DEMO_ADDRESS : assetOf(net, v).address,
      valueWei: kind === "approve" ? "0" : parseUnits(v, 18).toString(),
      timestamp: now - days * DAY,
      ok: true,
    }));
    const [inSymbol, inAmount, inNote] = s.incoming;
    const inAsset = assetOf(net, inSymbol);
    chains[net.chainId] = {
      wallet,
      activity,
      nextLeaf: s.leaves,
      incoming: {
        asset: inAsset.address,
        amountWei: parseUnits(inAmount, inAsset.decimals).toString(),
        secret: randomField(),
        commitment: randomField(),
        leafIndex: s.leaves - 4,
        ...(inNote ? { note: inNote } : {}),
      },
    };
  }
  return { notes, chains };
}

// ------------------------------------------------------------------ storage

let cache: DemoState | null = null;
let version = 0;
const listeners = new Set<() => void>();

/** The stored copy: null when absent, undefined when storage is unavailable. */
function readStored(): string | null | undefined {
  try {
    return window.sessionStorage.getItem(DEMO_STATE_KEY);
  } catch {
    return undefined;
  }
}

function parse(raw: string): DemoState | null {
  try {
    const s = JSON.parse(raw) as DemoState;
    return Array.isArray(s?.notes) && s.chains && typeof s.chains === "object" ? s : null;
  } catch {
    return null;
  }
}

function persist() {
  try {
    window.sessionStorage.setItem(DEMO_STATE_KEY, JSON.stringify(cache));
  } catch {
    /* in-memory still works */
  }
}

function state(): DemoState {
  const stored = readStored();
  // No stored copy while one is cached means the demo was just switched (again): start over.
  if (cache && stored !== null) return cache;
  cache = (stored && parse(stored)) || seed();
  persist();
  return cache;
}

function chain(chainId: number): ChainState | null {
  return state().chains[chainId] ?? null;
}

function changed() {
  version++;
  persist();
  for (const fn of listeners) fn();
}

export function subscribeDemo(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Bumps on every change, for useSyncExternalStore. */
export function demoVersion(): number {
  return version;
}

// ------------------------------------------------------------------ notes

/** Every private note, on both networks (the note vault scopes them). */
export function demoNotes(): LocalNote[] {
  return state().notes;
}

/** The note vault's write path. A newly landed note takes the next leaf, as the pool would give it. */
export function setDemoNotes(next: LocalNote[]) {
  const s = state();
  s.notes = next.map((n) => {
    const c = s.chains[n.chainId];
    if (n.leafIndex != null || !n.txHash || n.status === "recovered" || !c) return n;
    return { ...n, leafIndex: c.nextLeaf++ };
  });
  changed();
}

/** Private balances in the vault tree. */
export function demoLeafCount(chainId: number): number {
  return chain(chainId)?.nextLeaf ?? 0;
}

/** Where a commitment sits in the tree, a payment waiting to be claimed included. */
export function demoLeafIndex(chainId: number, commitment: string): number | null {
  const c = commitment.toLowerCase();
  const note = state().notes.find((n) => n.chainId === chainId && n.commitment.toLowerCase() === c);
  if (note?.leafIndex != null) return note.leafIndex;
  const sent = chain(chainId)?.sent?.[c];
  if (sent != null) return sent;
  const incoming = chain(chainId)?.incoming;
  return incoming && incoming.commitment.toLowerCase() === c ? incoming.leafIndex : null;
}

/** Leaves of payments this wallet sent (claim links it may claim back). */
export function demoSentLeaves(chainId: number): [string, number][] {
  return Object.entries(chain(chainId)?.sent ?? {});
}

/** What opens a leaf: the secret, amount and asset behind it. */
export function demoLeafOpening(
  chainId: number,
  leafIndex: number
): { secret: Hex; amountWei: string; asset: Address } | null {
  const note = state().notes.find((n) => n.chainId === chainId && n.leafIndex === leafIndex);
  if (note) return note;
  // A note of this wallet's that landed in a transfer and has not taken its leaf yet (a split's two notes).
  const sent = Object.entries(chain(chainId)?.sent ?? {}).find(([, leaf]) => leaf === leafIndex)?.[0];
  const own = sent ? state().notes.find((n) => n.chainId === chainId && n.commitment.toLowerCase() === sent) : undefined;
  if (own) return own;
  const incoming = chain(chainId)?.incoming;
  return incoming?.leafIndex === leafIndex ? incoming : null;
}

/** The payment waiting for this wallet, until it has been claimed. */
export function demoIncoming(chainId: number): DemoIncoming | null {
  const incoming = chain(chainId)?.incoming;
  if (!incoming) return null;
  const c = incoming.commitment.toLowerCase();
  return state().notes.some((n) => n.commitment.toLowerCase() === c) ? null : incoming;
}

export function setDemoIncomingTicket(chainId: number, tag: string, ticket: string) {
  const c = chain(chainId);
  if (!c) return;
  c.incoming = { ...c.incoming, tag, ticket };
  changed();
}

/**
 * Pays amounts out of the private balance the way payroll funds them: the
 * smallest note that covers each, with the change kept as a new note.
 */
export function spendDemoNotes(chainId: number, asset: Address, amounts: bigint[]) {
  const s = state();
  const c = s.chains[chainId];
  if (!c) return;
  const a = asset.toLowerCase();
  for (const amt of amounts) {
    const note = s.notes
      .filter(
        (n) =>
          n.chainId === chainId &&
          n.status !== "recovered" &&
          n.asset.toLowerCase() === a &&
          BigInt(n.amountWei) >= amt
      )
      .sort((x, y) => (BigInt(x.amountWei) < BigInt(y.amountWei) ? -1 : 1))[0];
    if (!note) continue;
    s.notes = s.notes.map((n) => (n.id === note.id ? { ...n, status: "recovered" as const } : n));
    const change = BigInt(note.amountWei) - amt;
    if (change > 0n) {
      s.notes = [
        makeNote({
          id: `chg-${Date.now()}-${c.nextLeaf}`,
          chainId,
          pool: note.pool,
          asset: note.asset,
          amount: change,
          createdAt: Date.now(),
          leafIndex: c.nextLeaf++,
        }),
        ...s.notes,
      ];
    }
  }
  changed();
}

// ------------------------------------------------------------------ cash out later

export function demoCashOutJobs(): DemoCashOutJob[] {
  return Object.values(state().jobs ?? {});
}

export function demoCashOutJob(id: string): DemoCashOutJob | null {
  return state().jobs?.[id] ?? null;
}

export function putDemoCashOutJob(job: DemoCashOutJob) {
  const s = state();
  s.jobs = { ...s.jobs, [job.id]: job };
  changed();
}

/**
 * A due job goes out: the money leaves the vault as the chain would show it
 * (the note it spends is spent, and a cash out to the pretend wallet lands
 * there). Returns the job as it stands now.
 */
export function settleDueDemoCashOut(id: string, now = Date.now()): DemoCashOutJob | null {
  const s = state();
  const job = s.jobs?.[id];
  if (!job || job.status !== "scheduled" || job.sendAfter > now) return job ?? null;
  const sent: DemoCashOutJob = { ...job, status: "sent", updatedAt: now, hash: randomHex(32) };
  s.jobs = { ...s.jobs, [id]: sent };
  s.notes = s.notes.map((n) => (n.cashOut?.job === id ? { ...n, status: "recovered" as const } : n));
  if (job.to.toLowerCase() === DEMO_ADDRESS.toLowerCase()) applyWallet(job.chainId, [[job.asset, BigInt(job.amount)]]);
  changed();
  return sent;
}

// ------------------------------------------------------------------ public side

export function demoWalletBalance(chainId: number, asset: Address): bigint {
  return BigInt(chain(chainId)?.wallet[asset.toLowerCase()] ?? "0");
}

/** What the explorer shows about the wallet, newest first. */
export function demoActivity(chainId: number): ActivityTx[] {
  return chain(chainId)?.activity ?? [];
}

/** The vault's holdings of an asset: well above what this wallet could cash out. */
export function demoPoolDeposited(chainId: number, asset: Address): bigint {
  const a = asset.toLowerCase();
  const mine = state()
    .notes.filter((n) => n.chainId === chainId && n.status !== "recovered" && n.asset.toLowerCase() === a)
    .reduce((sum, n) => sum + BigInt(n.amountWei), 0n);
  return mine * 7n;
}

export function creditDemoWallet(chainId: number, entries: [Address, bigint][]) {
  applyWallet(chainId, entries);
  changed();
}

function applyWallet(chainId: number, entries: [Address, bigint][]) {
  const c = chain(chainId);
  if (!c) return;
  for (const [asset, delta] of entries) {
    const k = asset.toLowerCase();
    const next = BigInt(c.wallet[k] ?? "0") + delta;
    c.wallet[k] = (next > 0n ? next : 0n).toString();
  }
}

// ------------------------------------------------------------------ transactions

export type DemoTxEffect = {
  /** Public balance changes as [asset, signed amount]. */
  wallet?: [Address, bigint][];
  /** Set when the wallet signed it, so the explorer lists it (relayed ones stay off). */
  activity?: { to: Address; valueWei: bigint };
  /** Commitments of payments it sent, which take the next leaves as the pool would give them. */
  sent?: Hex[];
};

const txs = new Map<string, "pending" | "confirmed">();

/** Sends a pretend transaction: pending now, landed (with its effect) a moment later. */
export function submitDemoTx(chainId: number, effect: DemoTxEffect = {}): Hex {
  const hash = randomHex(32);
  txs.set(hash, "pending");
  version++;
  for (const fn of listeners) fn();
  setTimeout(() => {
    applyWallet(chainId, effect.wallet ?? []);
    const c = chain(chainId);
    if (c && effect.sent?.length) {
      c.sent = { ...c.sent };
      for (const commitment of effect.sent) c.sent[commitment.toLowerCase()] = c.nextLeaf++;
    }
    if (c && effect.activity) {
      c.activity = [
        {
          hash,
          from: DEMO_ADDRESS,
          to: effect.activity.to,
          valueWei: effect.activity.valueWei.toString(),
          timestamp: Date.now(),
          ok: true,
        },
        ...c.activity,
      ];
    }
    txs.set(hash, "confirmed");
    changed();
  }, jitter(DEMO_MS.confirm));
  return hash;
}

export function demoTxStatus(hash: string): "pending" | "confirmed" | undefined {
  return txs.get(hash.toLowerCase());
}

/** What a wallet-signed call does to the pretend wallet. */
export function demoWriteEffect(call: {
  to: Address;
  functionName?: string;
  args?: readonly unknown[];
  value?: bigint;
}): DemoTxEffect {
  const args = call.args ?? [];
  const activity = { to: call.to, valueWei: call.value ?? 0n };
  switch (call.functionName) {
    case "shield":
    case "shieldBound":
      return { wallet: [[args[0] as Address, -(args[1] as bigint)]], activity };
    case "unshield":
      return { wallet: [[args[3] as Address, args[5] as bigint]], activity };
    case "transfer":
      // newCommitments[0] is the payment; the change lands with its note.
      return { activity, sent: [(args[3] as readonly Hex[])[0]] };
    case undefined:
      // A plain send of the native coin.
      return { wallet: [[zeroAddress, -(call.value ?? 0n)]], activity };
    default:
      return { activity };
  }
}
