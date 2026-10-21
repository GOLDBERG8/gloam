/**
 * The public ledger behind /transparency: everything anyone can read about a
 * Gloam vault straight from the chain, with no keys and no Gloam server.
 *
 * - Holdings: balanceOf(vault) for each listed token, plus the native balance
 *   where the chain has one.
 * - Counts: Shielded / Transferred / Unshielded (and SealedSwapped) logs from
 *   the vault, PaymentMemo logs from the payment-message board, all since the
 *   vault's deploy block.
 * - Recent activity: the newest of those logs. Deposits and cash-outs carry a
 *   public token and amount by design; transfers and trades carry neither.
 *
 * Logs are read in bounded chunks (the network's own getLogs limit, halved on
 * a range error), a few at a time, from public RPCs. Results are cached in
 * memory and sessionStorage, and a refresh only reads the blocks since.
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  toEventSelector,
  type Address,
  type PublicClient,
} from "viem";
import { getNetwork, type GloamNetwork, type NetworkKey } from "@/lib/networks";
import { erc20BalanceOfAbi, shieldTokensFor, supportsNativeShield } from "@/lib/tokens";

export type ActivityKind = "deposit" | "transfer" | "cashout" | "trade";

export type PublicEvent = {
  kind: ActivityKind;
  block: string;
  logIndex: number;
  tx: string;
  /** Deposits and cash-outs only: public by design. */
  asset?: Address;
  amount?: string;
  /** Unix seconds; 0 while unknown. */
  ts: number;
};

export type VaultHolding = {
  id: string;
  symbol: string;
  /** null = the chain's native coin */
  address: Address | null;
  decimals: number;
  stable: boolean;
  /** Raw units held by the vault. */
  raw: string;
};

export type Ledger = {
  network: NetworkKey;
  pool: Address;
  memo: Address | null;
  fromBlock: string;
  scannedTo: string;
  /** Unix seconds of the vault's deploy block (0 if unknown). */
  startTs: number;
  counts: {
    deposits: number;
    transfers: number;
    cashouts: number;
    trades: number;
    memos: number;
  };
  /** Newest first. */
  recent: PublicEvent[];
  holdings: VaultHolding[];
  /** ms since epoch */
  checkedAt: number;
  /** How long the last read took, in ms. */
  tookMs: number;
  /** Blocks read by the last pass. */
  blocksRead: string;
};

const RECENT_KEEP = 12;
/** Requests in flight per chain. Tempo's public RPC answers 429 to bursts. */
const PARALLEL: Record<number, number> = { 46630: 4, 42431: 3, 4663: 2, 4217: 3 };
/**
 * First span to ask for per getLogs. Robinhood's public RPC takes millions of
 * blocks in one call (the vault's whole history today); Tempo caps at 100k.
 * A range error splits the span in half either way.
 */
const SPAN: Record<number, bigint> = { 46630: 4_000_000n, 4663: 4_000_000n };
/** The first getLogs span for a network: SPAN where set, else its own limit. */
export function logSpan(n: GloamNetwork): bigint {
  return SPAN[n.chainId] ?? n.logRange;
}
const FRESH_MS = 30_000;
const CACHE_PREFIX = "gloam_transparency_v1";

const POOL_EVENTS = [
  parseAbiItem(
    "event Shielded(bytes32 indexed commitment, address indexed asset, uint256 amount, uint256 leafIndex, address indexed from)"
  ),
  parseAbiItem("event Transferred(bytes32 indexed nullifier, bytes32[2] newCommitments)"),
  parseAbiItem(
    "event Unshielded(bytes32 indexed nullifier, address indexed asset, address indexed to, uint256 amount)"
  ),
  parseAbiItem(
    "event SealedSwapped(bytes32 indexed nullifier, address indexed assetIn, address indexed assetOut, bytes32 newCommitmentOut, bytes32 newCommitmentChange)"
  ),
] as const;

/** Both board versions: the first also indexed the poster. */
const MEMO_TOPICS = new Set([
  toEventSelector("PaymentMemo(bytes32,address,bytes)"),
  toEventSelector("PaymentMemo(bytes32,bytes)"),
]);

// ------------------------------------------------------------------ clients

const clients = new Map<number, PublicClient>();

export function clientFor(n: GloamNetwork): PublicClient {
  const hit = clients.get(n.chainId);
  if (hit) return hit;
  const c = createPublicClient({
    chain: n.chain,
    // viem retries 429s, 5xx and timeouts with exponential backoff (0.5s, 1s, 2s, 4s).
    transport: http(n.chain.rpcUrls.default.http[0], { timeout: 20_000, retryCount: 4, retryDelay: 500 }),
  });
  clients.set(n.chainId, c);
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const gates = new Map<number, { active: number; waiting: (() => void)[] }>();

/** Every RPC call for a chain goes through here, so at most PARALLEL run at once. */
export async function gated<T>(chainId: number, call: () => Promise<T>): Promise<T> {
  let g = gates.get(chainId);
  if (!g) {
    g = { active: 0, waiting: [] };
    gates.set(chainId, g);
  }
  const max = PARALLEL[chainId] ?? 3;
  while (g.active >= max) await new Promise<void>((r) => g.waiting.push(r));
  g.active++;
  try {
    return await call();
  } finally {
    g.active--;
    g.waiting.shift()?.();
  }
}

/** Runs tasks in index order; the chain gate decides how many are in flight. */
async function runAll<T>(count: number, run: (i: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: count }, (_, i) => run(i)));
}

function errText(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { details?: unknown; shortMessage?: unknown; message?: unknown };
    return String(o.details ?? o.shortMessage ?? o.message ?? e);
  }
  return String(e);
}

/** The node refusing a span as too wide or too big (not a rate limit). */
const RANGE_ERROR =
  /block range|range (is )?too|exceeds? (the )?max|max(imum)? block|more than \d+ (results|logs)|too many (results|logs)|response size|query timeout|limit exceeded/i;

function isRateLimit(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return status === 429 || /429|too many requests|rate ?limit/i.test(errText(e));
}

/**
 * getLogs for one range: retries transient failures, and splits the range in
 * half when the node says it is too wide or returns too much.
 */
export async function getLogsSafe<T>(
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  depth = 0
): Promise<T[]> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchRange(from, to);
    } catch (e) {
      last = e;
      if (!isRateLimit(e) && RANGE_ERROR.test(errText(e)) && to > from && depth < 8) {
        const mid = from + (to - from) / 2n;
        const a = await getLogsSafe(fetchRange, from, mid, depth + 1);
        const b = await getLogsSafe(fetchRange, mid + 1n, to, depth + 1);
        return [...a, ...b];
      }
      await sleep(1500 * (attempt + 1));
    }
  }
  throw last;
}

export function ranges(from: bigint, to: bigint, step: bigint): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += step) {
    out.push([s, s + step - 1n > to ? to : s + step - 1n]);
  }
  return out;
}

function hexTs(v: unknown): number {
  try {
    if (typeof v === "string" || typeof v === "bigint") return Number(BigInt(v));
  } catch {
    /* ignore */
  }
  return 0;
}

// ------------------------------------------------------------------ cache

const memory = new Map<NetworkKey, Ledger>();

function cacheKey(n: GloamNetwork) {
  return `${CACHE_PREFIX}:${n.key}:${(n.pool ?? "").toLowerCase()}`;
}

/** The last ledger read in this tab, if any (memory first, then sessionStorage). */
export function cachedLedger(key: NetworkKey): Ledger | null {
  const n = getNetwork(key);
  const m = memory.get(key);
  if (m && m.pool.toLowerCase() === n.pool?.toLowerCase()) return m;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey(n));
    if (!raw) return null;
    const l = JSON.parse(raw) as Ledger;
    if (l?.network !== key || !Array.isArray(l.recent) || !l.counts) return null;
    memory.set(key, l);
    return l;
  } catch {
    return null;
  }
}

function saveLedger(n: GloamNetwork, l: Ledger) {
  memory.set(n.key, l);
  try {
    window.sessionStorage.setItem(cacheKey(n), JSON.stringify(l));
  } catch {
    /* storage full or blocked: memory still has it */
  }
}

// ------------------------------------------------------------------ read

type Progress = (fraction: number) => void;

const inflight = new Map<NetworkKey, { promise: Promise<Ledger>; listeners: Set<Progress> }>();

/**
 * Reads (or refreshes) the public ledger for one network. Concurrent callers
 * share one read. A ledger read in the last 30s is returned as is unless
 * `force` is set.
 */
export function loadLedger(
  key: NetworkKey,
  opts: { onProgress?: Progress; force?: boolean } = {}
): Promise<Ledger> {
  const running = inflight.get(key);
  if (running) {
    if (opts.onProgress) running.listeners.add(opts.onProgress);
    return running.promise;
  }
  const prev = cachedLedger(key);
  if (prev && !opts.force && Date.now() - prev.checkedAt < FRESH_MS) {
    return Promise.resolve(prev);
  }
  const listeners = new Set<Progress>(opts.onProgress ? [opts.onProgress] : []);
  const promise = readLedger(key, prev, (f) => listeners.forEach((l) => l(f))).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, { promise, listeners });
  return promise;
}

async function readLedger(key: NetworkKey, prev: Ledger | null, progress: Progress): Promise<Ledger> {
  const n = getNetwork(key);
  if (!n.pool || n.deployBlock == null) throw new Error(`${n.label} has no vault yet.`);
  const vault = n.pool;
  const started = performance.now();
  const c = clientFor(n);

  const id = n.chainId;
  const latest = await gated(id, () => c.getBlockNumber());
  const fromBlock = n.deployBlock;
  const resume = prev && BigInt(prev.scannedTo) >= fromBlock ? BigInt(prev.scannedTo) + 1n : fromBlock;
  const memo = n.payMemo;
  const memoFrom = memo ? (memo.deployBlock > fromBlock ? memo.deployBlock : fromBlock) : 0n;
  const memoResume = resume > memoFrom ? resume : memoFrom;

  const span = SPAN[n.chainId] ?? n.logRange;
  const poolRanges = resume <= latest ? ranges(resume, latest, span) : [];
  const memoRanges = memo && memoResume <= latest ? ranges(memoResume, latest, span) : [];
  const total = poolRanges.length + memoRanges.length + 1; // +1: balances
  let done = 0;
  const tick = () => progress(Math.min(1, ++done / total));
  progress(0);

  const [poolLogs, memoCounts, holdings, startTs] = await Promise.all([
    runAll(poolRanges.length, async (i) => {
      const [a, b] = poolRanges[i];
      const logs = await getLogsSafe(
        (from, to) =>
          gated(id, () => c.getLogs({ address: vault, events: POOL_EVENTS, fromBlock: from, toBlock: to })),
        a,
        b
      );
      tick();
      return logs;
    }),
    memo
      ? runAll(memoRanges.length, async (i) => {
          const [a, b] = memoRanges[i];
          const logs = await getLogsSafe(
            (from, to) => gated(id, () => c.getLogs({ address: memo.address, fromBlock: from, toBlock: to })),
            a,
            b
          );
          tick();
          return logs.filter((l) => l.topics[0] && MEMO_TOPICS.has(l.topics[0])).length;
        })
      : Promise.resolve([] as number[]),
    readHoldings(n, c, vault).then((h) => {
      tick();
      return h;
    }),
    prev?.startTs
      ? Promise.resolve(prev.startTs)
      : gated(id, () => c.getBlock({ blockNumber: fromBlock }))
          .then((b) => Number(b.timestamp))
          .catch(() => 0),
  ]);

  const counts = prev
    ? { ...prev.counts }
    : { deposits: 0, transfers: 0, cashouts: 0, trades: 0, memos: 0 };
  counts.memos += memoCounts.reduce((a, b) => a + b, 0);

  const fresh: PublicEvent[] = [];
  for (const log of poolLogs.flat()) {
    const base = {
      block: String(log.blockNumber ?? 0n),
      logIndex: log.logIndex ?? 0,
      tx: log.transactionHash ?? "",
      ts: hexTs((log as { blockTimestamp?: unknown }).blockTimestamp),
    };
    switch (log.eventName) {
      case "Shielded":
        counts.deposits++;
        fresh.push({ ...base, kind: "deposit", asset: log.args.asset, amount: String(log.args.amount ?? 0n) });
        break;
      case "Unshielded":
        counts.cashouts++;
        fresh.push({ ...base, kind: "cashout", asset: log.args.asset, amount: String(log.args.amount ?? 0n) });
        break;
      case "Transferred":
        counts.transfers++;
        fresh.push({ ...base, kind: "transfer" });
        break;
      case "SealedSwapped":
        counts.trades++;
        fresh.push({ ...base, kind: "trade" });
        break;
    }
  }

  const recent = [...fresh, ...(prev?.recent ?? [])]
    .sort((a, b) => {
      const d = BigInt(b.block) - BigInt(a.block);
      return d !== 0n ? (d > 0n ? 1 : -1) : b.logIndex - a.logIndex;
    })
    .slice(0, RECENT_KEEP);

  // Times for the rows shown. Tempo puts them on the log; Robinhood needs the block.
  const missing = [...new Set(recent.filter((e) => !e.ts).map((e) => e.block))];
  const times = new Map<string, number>();
  await runAll(missing.length, async (i) => {
    try {
      const b = await gated(id, () => c.getBlock({ blockNumber: BigInt(missing[i]) }));
      times.set(missing[i], Number(b.timestamp));
    } catch {
      /* shown as a block number instead */
    }
  });
  const timed = recent.map((e) => (e.ts ? e : { ...e, ts: times.get(e.block) ?? 0 }));

  const ledger: Ledger = {
    network: key,
    pool: vault,
    memo: memo?.address ?? null,
    fromBlock: String(fromBlock),
    scannedTo: String(latest),
    startTs,
    counts,
    recent: timed,
    holdings,
    checkedAt: Date.now(),
    tookMs: Math.round(performance.now() - started),
    blocksRead: String(latest >= resume ? latest - resume + 1n : 0n),
  };
  saveLedger(n, ledger);
  progress(1);
  return ledger;
}

async function readHoldings(n: GloamNetwork, c: PublicClient, vault: Address): Promise<VaultHolding[]> {
  const tokens = shieldTokensFor(n.chainId);
  const rows: Promise<VaultHolding>[] = tokens.map(async (t) => ({
    id: t.id,
    symbol: t.symbol,
    address: t.address,
    decimals: t.decimals,
    stable: t.kind === "stablecoin",
    raw: String(
      await gated(n.chainId, () =>
        c.readContract({
          address: t.address,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [vault],
        })
      )
    ),
  }));
  if (supportsNativeShield(n.chainId)) {
    rows.push(
      gated(n.chainId, () => c.getBalance({ address: vault })).then((v) => ({
        id: "native",
        symbol: n.primaryAsset.symbol,
        address: null,
        decimals: n.primaryAsset.decimals,
        stable: false,
        raw: String(v),
      }))
    );
  }
  return Promise.all(rows);
}
