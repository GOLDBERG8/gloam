/**
 * On-chain traction for /admin, read from both networks' current vaults. This
 * is the source of truth for deposits, private transfers, cash-outs, payment
 * messages, depositor wallets and value held. Server only.
 *
 * What it reads, per network (lib/networks):
 * - Every log of the vault since its deploy block. Queries are address-only and
 *   decoded here: Robinhood's RPC caps queries with several event topics at 100k
 *   blocks but takes an address-only query over millions; Tempo caps every
 *   query at 100k (`logRange`).
 * - PaymentMemo logs on the payment-message board since the vault's deploy.
 * - balanceOf(vault) for each listed token, plus the native balance where the
 *   chain shields its native coin.
 *
 * Every RPC call goes through a per-chain gate (a few in flight, spaced out on
 * Tempo, whose RPC answers 429 to bursts) and is retried. Reads are incremental:
 * each network keeps what it has read (memory, then Redis) and a refresh only
 * reads the blocks since. The finished snapshot is cached for a minute in memory
 * and Redis so loading /admin never hammers the RPCs.
 */

import {
  createPublicClient,
  formatUnits,
  parseAbi,
  parseEventLogs,
  toEventSelector,
  type Address,
  type Log,
  type PublicClient,
} from "viem";
import { getNetwork, NETWORK_KEYS, type GloamNetwork, type NetworkKey } from "./networks";
import { erc20BalanceOfAbi, shieldTokensFor, supportsNativeShield } from "./tokens";
import { loadEthUsd, loadLiveMarkets } from "./live-quotes";
import { cacheGetJson, cacheSetJson, lastDays, utcDay } from "./tractionStore";
import { serverTransport } from "@/lib/serverRpc";

export type ActivityKind = "deposit" | "transfer" | "cashout" | "trade";

export type AssetRow = {
  /** Token address, or "native" for the chain's own coin. */
  asset: string;
  symbol: string;
  stable: boolean;
  /** Held by the vault now, in whole units; null when the read failed. */
  held: string | null;
  heldUsd: number | null;
  deposited: string;
  depositCount: number;
  cashedOut: string;
  cashoutCount: number;
};

export type DayRow = {
  /** UTC, YYYY-MM-DD */
  day: string;
  deposits: number;
  transfers: number;
  cashouts: number;
  trades: number;
  /** Wallets that deposited or received a cash-out that day. */
  activeWallets: number;
};

export type RecentRow = {
  network: NetworkKey;
  kind: ActivityKind;
  tx: string;
  block: string;
  /** Unix seconds; 0 while unknown. */
  ts: number;
  /** Depositor or cash-out recipient; transfers and trades have none. */
  wallet: string | null;
  detail: string;
};

export type NetworkMetrics = {
  key: NetworkKey;
  label: string;
  chainId: number;
  pool: string;
  memo: string | null;
  deployBlock: string;
  scannedTo: string;
  /** Chain head at the last read; null when that read failed. */
  latestBlock: string | null;
  /** True while a long backlog is still being read over several passes. */
  catchingUp: boolean;
  deposits: number;
  transfers: number;
  cashouts: number;
  trades: number;
  memos: number;
  /** Unique wallets that deposited. */
  depositors: number;
  /** Unique wallets that received a cash-out. */
  cashoutWallets: number;
  /** Depositors and cash-out recipients together. */
  activeWallets: number;
  /** Sum of the priced holdings. */
  heldUsd: number;
  /** Symbols held with no price (counted out of heldUsd). */
  unpriced: string[];
  assets: AssetRow[];
  /** Unix seconds of the first and last pool activity; null with none yet. */
  firstActivity: number | null;
  lastActivity: number | null;
  /** Unix seconds of the vault's deploy block. */
  vaultSince: number | null;
  daily: DayRow[];
  topDepositors: { address: string; deposits: number; lastTs: number }[];
  recent: RecentRow[];
  /** Blocks read by the last pass, and how long it took. */
  blocksRead: string;
  readMs: number;
  /** Set when the last read failed; the figures are then the last ones read. */
  error: string | null;
};

export type OnchainMetrics = {
  asOf: string;
  /** Where this snapshot came from: read just now, or a cached one. */
  source: "fresh" | "memory" | "redis";
  ageSec: number;
  prices: { ethUsd: number | null; stocks: "live" | "unpriced" };
  networks: NetworkMetrics[];
  combined: {
    deposits: number;
    transfers: number;
    cashouts: number;
    trades: number;
    memos: number;
    depositors: number;
    activeWallets: number;
    heldUsd: number;
    unpriced: string[];
    firstActivity: number | null;
    lastActivity: number | null;
    daily: DayRow[];
  };
  /** Both networks, newest first. */
  recent: RecentRow[];
};

/* ------------------------------------------------------------------ config */

/** Requests in flight per chain. */
const PARALLEL: Record<number, number> = { 46630: 4, 42431: 3 };
/** Minimum gap between request starts per chain, ms. */
const SPACING_MS: Record<number, number> = { 46630: 0, 42431: 120 };
/** First span per address-only getLogs; a range error halves it. Else `logRange`. */
const SPAN: Record<number, bigint> = { 46630: 5_000_000n };
/** getLogs spans per address per pass; the rest of a backlog waits for the next pass. */
const MAX_SPANS_PER_PASS = 40n;
/** Timestamps fetched per pass where the RPC does not put them on the log. */
const MAX_BLOCK_FETCH = 250;
const DAILY_WINDOW = 14;
const RECENT_KEEP = 25;

const SNAPSHOT_FRESH_MS = 60_000;
const FORCE_MIN_GAP_MS = 15_000;
const SNAPSHOT_KEY = "gloam:onchain:snapshot:v1";
const STATE_PREFIX = "gloam:onchain:state:v1";
const STATE_TTL_SEC = 14 * 86_400;
const PRICE_TTL_MS = 5 * 60_000;

const POOL_ABI = parseAbi([
  "event Shielded(bytes32 indexed commitment, address indexed asset, uint256 amount, uint256 leafIndex, address indexed from)",
  "event Transferred(bytes32 indexed nullifier, bytes32[2] newCommitments)",
  "event Unshielded(bytes32 indexed nullifier, address indexed asset, address indexed to, uint256 amount)",
  "event SealedSwapped(bytes32 indexed nullifier, address indexed assetIn, address indexed assetOut, bytes32 newCommitmentOut, bytes32 newCommitmentChange)",
]);

/** Both board versions: the first also indexed the poster. */
const MEMO_TOPICS = new Set([
  toEventSelector("PaymentMemo(bytes32,address,bytes)"),
  toEventSelector("PaymentMemo(bytes32,bytes)"),
]);

const NATIVE = "native";
const ZERO = "0x0000000000000000000000000000000000000000";

/* ------------------------------------------------------------------ state */

/** Compact pool event as kept between reads. */
type ChainEvent = {
  k: ActivityKind;
  b: number;
  i: number;
  ts: number;
  tx: string;
  /** Depositor (from) or cash-out recipient (to), lowercase. */
  w?: string;
  /** Asset, lowercase; "native" for the chain's coin. */
  a?: string;
  /** Raw amount. */
  v?: string;
};

type ScanState = {
  v: 1;
  pool: string;
  scannedTo: number;
  memoScannedTo: number;
  memos: number;
  startTs: number;
  /** Oldest first. */
  events: ChainEvent[];
};

const states = new Map<NetworkKey, ScanState>();

function stateKey(n: GloamNetwork) {
  return `${STATE_PREFIX}:${n.key}:${(n.pool ?? "").toLowerCase()}`;
}

async function loadState(n: GloamNetwork): Promise<ScanState | null> {
  const pool = (n.pool ?? "").toLowerCase();
  const m = states.get(n.key);
  if (m && m.pool === pool) return m;
  const r = await cacheGetJson<ScanState>(stateKey(n));
  if (r && r.v === 1 && r.pool === pool && Array.isArray(r.events)) {
    states.set(n.key, r);
    return r;
  }
  return null;
}

async function saveState(n: GloamNetwork, s: ScanState) {
  states.set(n.key, s);
  await cacheSetJson(stateKey(n), s, STATE_TTL_SEC);
}

/* ------------------------------------------------------------------ rpc */

const clients = new Map<number, PublicClient>();

function clientFor(n: GloamNetwork): PublicClient {
  const hit = clients.get(n.chainId);
  if (hit) return hit;
  const c = createPublicClient({
    chain: n.chain,
    // viem retries 429s, 5xx and timeouts with backoff (0.5s, 1s, 2s, 4s).
    transport: serverTransport(n, { timeout: 20_000, retryCount: 4, retryDelay: 500 }),
  });
  clients.set(n.chainId, c);
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const gates = new Map<number, { active: number; waiting: (() => void)[]; lastStart: number }>();

/** Every RPC call for a chain goes through here: at most PARALLEL at once, SPACING_MS apart. */
async function gated<T>(chainId: number, call: () => Promise<T>): Promise<T> {
  let g = gates.get(chainId);
  if (!g) {
    g = { active: 0, waiting: [], lastStart: 0 };
    gates.set(chainId, g);
  }
  const max = PARALLEL[chainId] ?? 2;
  while (g.active >= max) await new Promise<void>((r) => g.waiting.push(r));
  g.active++;
  try {
    const gap = SPACING_MS[chainId] ?? 0;
    const wait = g.lastStart + gap - Date.now();
    g.lastStart = Math.max(Date.now(), g.lastStart + gap);
    if (wait > 0) await sleep(wait);
    return await call();
  } finally {
    g.active--;
    g.waiting.shift()?.();
  }
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
  /block range|range (is )?too|exceeds? (the )?max|max(imum)? block|only \d+ are allowed|more than \d+ (results|logs)|too many (results|logs)|response size|query timeout|limit exceeded/i;

function isRateLimit(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return status === 429 || /429|too many requests|rate ?limit/i.test(errText(e));
}

/** getLogs for one range: retries transient failures, halves the range when the node says it is too wide. */
async function getLogsSafe(
  fetchRange: (from: bigint, to: bigint) => Promise<Log[]>,
  from: bigint,
  to: bigint,
  depth = 0
): Promise<Log[]> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchRange(from, to);
    } catch (e) {
      last = e;
      if (!isRateLimit(e) && RANGE_ERROR.test(errText(e)) && to > from && depth < 10) {
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

function ranges(from: bigint, to: bigint, step: bigint): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += step) out.push([s, s + step - 1n > to ? to : s + step - 1n]);
  return out;
}

/** Every log an address emitted in [from, to], in spans the chain accepts. */
async function addressLogs(n: GloamNetwork, address: Address, from: bigint, to: bigint): Promise<Log[]> {
  if (from > to) return [];
  const c = clientFor(n);
  const span = SPAN[n.chainId] ?? n.logRange;
  const parts = await Promise.all(
    ranges(from, to, span).map(([a, b]) =>
      getLogsSafe((x, y) => gated(n.chainId, () => c.getLogs({ address, fromBlock: x, toBlock: y })), a, b)
    )
  );
  return parts.flat();
}

function hexTs(v: unknown): number {
  try {
    if (typeof v === "string" || typeof v === "bigint" || typeof v === "number") return Number(BigInt(v));
  } catch {
    /* ignore */
  }
  return 0;
}

/* ------------------------------------------------------------------ assets */

type AssetInfo = { symbol: string; decimals: number; stable: boolean };

function assetInfo(n: GloamNetwork, asset: string): AssetInfo {
  if (asset === NATIVE) return { symbol: n.primaryAsset.symbol, decimals: n.primaryAsset.decimals, stable: false };
  const t = shieldTokensFor(n.chainId).find((x) => x.address.toLowerCase() === asset);
  if (t) return { symbol: t.symbol, decimals: t.decimals, stable: t.kind === "stablecoin" };
  return { symbol: `${asset.slice(0, 6)}…${asset.slice(-4)}`, decimals: 18, stable: false };
}

function fmtUnits(raw: bigint, info: AssetInfo): string {
  const s = formatUnits(raw, info.decimals);
  const [i, f = ""] = s.split(".");
  const keep = info.stable ? 2 : 6;
  const frac = f.slice(0, keep).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i;
}

type Prices = { at: number; ethUsd: number | null; marks: Map<string, number>; stocks: "live" | "unpriced" };
let priceCache: Prices | null = null;
const PRICE_KEY = "gloam:onchain:prices:v1";

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), sleep(ms).then(() => fallback)]);
}

/**
 * ETH from CoinGecko, the stock tokens from live equity marks (the same source
 * as /api/markets, static fallbacks left out). Stablecoins count as $1. Cached
 * five minutes in memory and Redis; both upstreams are slow, so this starts
 * alongside the chain reads.
 */
async function loadPrices(): Promise<Prices> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache;
  const stored = await cacheGetJson<{ at: number; ethUsd: number | null; marks: [string, number][] }>(PRICE_KEY);
  if (stored && Date.now() - stored.at < PRICE_TTL_MS) {
    priceCache = { at: stored.at, ethUsd: stored.ethUsd, marks: new Map(stored.marks), stocks: stored.marks.length ? "live" : "unpriced" };
    return priceCache;
  }
  const [ethUsd, markets] = await Promise.all([
    withTimeout(loadEthUsd(), 15_000, null),
    withTimeout(loadLiveMarkets(), 25_000, []),
  ]);
  const marks = new Map<string, number>();
  for (const m of markets) {
    if (m.address && m.source === "live" && m.mark > 0) marks.set(m.address.toLowerCase(), m.mark);
  }
  const prev = priceCache;
  priceCache = {
    at: Date.now(),
    ethUsd: ethUsd ?? prev?.ethUsd ?? null,
    marks: marks.size ? marks : (prev?.marks ?? marks),
    stocks: marks.size || prev?.marks.size ? "live" : "unpriced",
  };
  if (ethUsd != null || marks.size) {
    await cacheSetJson(PRICE_KEY, { at: priceCache.at, ethUsd: priceCache.ethUsd, marks: [...priceCache.marks] }, PRICE_TTL_MS / 1000);
  }
  return priceCache;
}

function usdOf(n: GloamNetwork, asset: string, units: number, info: AssetInfo, prices: Prices): number | null {
  if (info.stable) return units;
  if (asset === NATIVE) return n.primaryAsset.symbol === "ETH" && prices.ethUsd != null ? units * prices.ethUsd : null;
  const mark = prices.marks.get(asset);
  return mark != null ? units * mark : null;
}

/* ------------------------------------------------------------------ read */

type Holding = { asset: string; raw: bigint | null };

async function readHoldings(n: GloamNetwork, vault: Address): Promise<Holding[]> {
  const c = clientFor(n);
  const rows: Promise<Holding>[] = shieldTokensFor(n.chainId).map(async (t) => ({
    asset: t.address.toLowerCase(),
    raw: await gated(n.chainId, () =>
      c.readContract({ address: t.address, abi: erc20BalanceOfAbi, functionName: "balanceOf", args: [vault] })
    ).catch(() => null),
  }));
  if (supportsNativeShield(n.chainId)) {
    rows.push(
      gated(n.chainId, () => c.getBalance({ address: vault }))
        .then((raw) => ({ asset: NATIVE, raw }))
        .catch(() => ({ asset: NATIVE, raw: null }))
    );
  }
  return Promise.all(rows);
}

/** Reads the blocks since the last pass into the network's state. */
async function scan(
  n: GloamNetwork,
  prev: ScanState | null
): Promise<{ state: ScanState; blocksRead: bigint; latest: bigint }> {
  if (!n.pool || n.deployBlock == null) throw new Error(`${n.label} has no vault yet`);
  const c = clientFor(n);
  const vault = n.pool;
  const latest = await gated(n.chainId, () => c.getBlockNumber());
  const deploy = n.deployBlock;

  const from = prev ? BigInt(prev.scannedTo) + 1n : deploy;
  const memo = n.payMemo;
  const memoStart = memo ? (memo.deployBlock > deploy ? memo.deployBlock : deploy) : 0n;
  const memoFrom = prev && prev.memoScannedTo > 0 ? BigInt(prev.memoScannedTo) + 1n : memoStart;
  // A long backlog is read over several passes so one request stays well inside its time limit.
  const span = SPAN[n.chainId] ?? n.logRange;
  const capTo = (start: bigint) => {
    const end = start + span * MAX_SPANS_PER_PASS - 1n;
    return end < latest ? end : latest;
  };
  const poolTo = capTo(from);
  const memoTo = capTo(memoFrom);

  const [poolLogs, memoLogs, startTs] = await Promise.all([
    addressLogs(n, vault, from, poolTo),
    memo ? addressLogs(n, memo.address, memoFrom, memoTo) : Promise.resolve([] as Log[]),
    prev?.startTs
      ? Promise.resolve(prev.startTs)
      : gated(n.chainId, () => c.getBlock({ blockNumber: deploy }))
          .then((b) => Number(b.timestamp))
          .catch(() => 0),
  ]);

  const fresh: ChainEvent[] = [];
  for (const log of parseEventLogs({ abi: POOL_ABI, logs: poolLogs })) {
    const base = {
      b: Number(log.blockNumber ?? 0n),
      i: log.logIndex ?? 0,
      tx: log.transactionHash ?? "",
      ts: hexTs((log as { blockTimestamp?: unknown }).blockTimestamp),
    };
    const asset = (a: Address | undefined) => (!a || a.toLowerCase() === ZERO ? NATIVE : a.toLowerCase());
    switch (log.eventName) {
      case "Shielded":
        fresh.push({ ...base, k: "deposit", w: log.args.from?.toLowerCase(), a: asset(log.args.asset), v: String(log.args.amount ?? 0n) });
        break;
      case "Unshielded":
        fresh.push({ ...base, k: "cashout", w: log.args.to?.toLowerCase(), a: asset(log.args.asset), v: String(log.args.amount ?? 0n) });
        break;
      case "Transferred":
        fresh.push({ ...base, k: "transfer" });
        break;
      case "SealedSwapped":
        fresh.push({ ...base, k: "trade" });
        break;
    }
  }
  const memos = memoLogs.filter((l) => l.topics[0] && MEMO_TOPICS.has(l.topics[0])).length;

  const events = [...(prev?.events ?? []), ...fresh].sort((x, y) => x.b - y.b || x.i - y.i);

  // Robinhood leaves blockTimestamp at 0 on logs; read those blocks (newest first, capped per pass).
  const missing = [...new Set(events.filter((e) => !e.ts).map((e) => e.b))].sort((x, y) => y - x).slice(0, MAX_BLOCK_FETCH);
  if (missing.length) {
    const times = new Map<number, number>();
    await Promise.all(
      missing.map((b) =>
        gated(n.chainId, () => c.getBlock({ blockNumber: BigInt(b) }))
          .then((blk) => times.set(b, Number(blk.timestamp)))
          .catch(() => undefined)
      )
    );
    for (const e of events) if (!e.ts) e.ts = times.get(e.b) ?? 0;
  }

  return {
    state: {
      v: 1,
      pool: vault.toLowerCase(),
      scannedTo: Number(poolTo < from ? from - 1n : poolTo),
      memoScannedTo: memo ? Number(memoTo < memoFrom ? memoFrom - 1n : memoTo) : 0,
      memos: (prev?.memos ?? 0) + memos,
      startTs,
      events,
    },
    blocksRead: poolTo >= from ? poolTo - from + 1n : 0n,
    latest,
  };
}

/* ------------------------------------------------------------------ figures */

function dailyRows(sources: ChainEvent[][], days: string[]): DayRow[] {
  const rows = new Map(days.map((d) => [d, { day: d, deposits: 0, transfers: 0, cashouts: 0, trades: 0, wallets: new Set<string>() }]));
  for (const events of sources) {
    for (const e of events) {
      if (!e.ts) continue;
      const r = rows.get(utcDay(e.ts * 1000));
      if (!r) continue;
      if (e.k === "deposit") r.deposits++;
      else if (e.k === "transfer") r.transfers++;
      else if (e.k === "cashout") r.cashouts++;
      else r.trades++;
      if (e.w) r.wallets.add(e.w);
    }
  }
  return days.map((d) => {
    const { wallets, ...rest } = rows.get(d)!;
    return { ...rest, activeWallets: wallets.size };
  });
}

function recentRows(n: GloamNetwork, events: ChainEvent[]): RecentRow[] {
  return events
    .slice(-RECENT_KEEP)
    .reverse()
    .map((e) => {
      let detail = e.k === "transfer" ? "Private transfer" : "Private trade";
      if ((e.k === "deposit" || e.k === "cashout") && e.a) {
        const info = assetInfo(n, e.a);
        detail = `${fmtUnits(BigInt(e.v ?? "0"), info)} ${info.symbol}`;
      }
      return { network: n.key, kind: e.k, tx: e.tx, block: String(e.b), ts: e.ts, wallet: e.w ?? null, detail };
    });
}

function figures(
  n: GloamNetwork,
  s: ScanState,
  holdings: Holding[] | null,
  prices: Prices,
  days: string[],
  extra: { blocksRead: bigint; latest: bigint | null; readMs: number; error: string | null }
): NetworkMetrics {
  const counts = { deposit: 0, transfer: 0, cashout: 0, trade: 0 };
  const depositors = new Map<string, { deposits: number; lastTs: number }>();
  const cashoutWallets = new Set<string>();
  const flows = new Map<string, { inRaw: bigint; inCount: number; outRaw: bigint; outCount: number }>();
  let first: number | null = null;
  let last: number | null = null;

  for (const e of s.events) {
    counts[e.k]++;
    if (e.ts) {
      first = first == null ? e.ts : Math.min(first, e.ts);
      last = last == null ? e.ts : Math.max(last, e.ts);
    }
    if (e.k === "deposit" && e.w) {
      const d = depositors.get(e.w) ?? { deposits: 0, lastTs: 0 };
      d.deposits++;
      d.lastTs = Math.max(d.lastTs, e.ts);
      depositors.set(e.w, d);
    }
    if (e.k === "cashout" && e.w) cashoutWallets.add(e.w);
    if ((e.k === "deposit" || e.k === "cashout") && e.a) {
      const f = flows.get(e.a) ?? { inRaw: 0n, inCount: 0, outRaw: 0n, outCount: 0 };
      if (e.k === "deposit") {
        f.inRaw += BigInt(e.v ?? "0");
        f.inCount++;
      } else {
        f.outRaw += BigInt(e.v ?? "0");
        f.outCount++;
      }
      flows.set(e.a, f);
    }
  }

  // One row per listed asset that is held or has moved; listed order (stables first).
  const order = [
    ...(supportsNativeShield(n.chainId) ? [NATIVE] : []),
    ...shieldTokensFor(n.chainId).map((t) => t.address.toLowerCase()),
  ];
  for (const a of flows.keys()) if (!order.includes(a)) order.push(a);
  const heldBy = new Map((holdings ?? []).map((h) => [h.asset, h.raw]));

  let heldUsd = 0;
  const unpriced: string[] = [];
  const assets: AssetRow[] = [];
  for (const a of order) {
    const info = assetInfo(n, a);
    const raw = heldBy.has(a) ? heldBy.get(a)! : null;
    const f = flows.get(a);
    if (!f && (raw == null || raw === 0n)) continue;
    let usd: number | null = null;
    if (raw != null && raw > 0n) {
      usd = usdOf(n, a, Number(formatUnits(raw, info.decimals)), info, prices);
      if (usd == null) unpriced.push(info.symbol);
      else heldUsd += usd;
    } else if (raw === 0n) {
      usd = 0;
    }
    assets.push({
      asset: a,
      symbol: info.symbol,
      stable: info.stable,
      held: raw == null ? null : fmtUnits(raw, info),
      heldUsd: usd,
      deposited: fmtUnits(f?.inRaw ?? 0n, info),
      depositCount: f?.inCount ?? 0,
      cashedOut: fmtUnits(f?.outRaw ?? 0n, info),
      cashoutCount: f?.outCount ?? 0,
    });
  }

  const active = new Set([...depositors.keys(), ...cashoutWallets]);

  return {
    key: n.key,
    label: n.label,
    chainId: n.chainId,
    pool: n.pool ?? "",
    memo: n.payMemo?.address ?? null,
    deployBlock: String(n.deployBlock ?? 0n),
    scannedTo: String(s.scannedTo),
    latestBlock: extra.latest == null ? null : String(extra.latest),
    catchingUp: extra.latest != null && BigInt(s.scannedTo) < extra.latest,
    deposits: counts.deposit,
    transfers: counts.transfer,
    cashouts: counts.cashout,
    trades: counts.trade,
    memos: s.memos,
    depositors: depositors.size,
    cashoutWallets: cashoutWallets.size,
    activeWallets: active.size,
    heldUsd,
    unpriced,
    assets,
    firstActivity: first,
    lastActivity: last,
    vaultSince: s.startTs || null,
    daily: dailyRows([s.events], days),
    topDepositors: [...depositors.entries()]
      .map(([address, d]) => ({ address, ...d }))
      .sort((x, y) => y.deposits - x.deposits || y.lastTs - x.lastTs)
      .slice(0, 25),
    recent: recentRows(n, s.events),
    blocksRead: String(extra.blocksRead),
    readMs: extra.readMs,
    error: extra.error,
  };
}

function emptyState(n: GloamNetwork): ScanState {
  return { v: 1, pool: (n.pool ?? "").toLowerCase(), scannedTo: Number(n.deployBlock ?? 0n), memoScannedTo: 0, memos: 0, startTs: 0, events: [] };
}

/** Scans one network and reads its holdings. On failure keeps the last state read, with the error. */
async function readNetwork(n: GloamNetwork, days: string[]) {
  const started = Date.now();
  const prev = await loadState(n);
  try {
    const [{ state, blocksRead, latest }, holdings] = await Promise.all([scan(n, prev), readHoldings(n, n.pool as Address)]);
    await saveState(n, state);
    const readMs = Date.now() - started;
    const extra = { blocksRead, latest, readMs, error: null };
    return { state, holdings, metrics: (p: Prices) => figures(n, state, holdings, p, days, extra) };
  } catch (e) {
    const state = prev ?? emptyState(n);
    const msg = errText(e).split("\n")[0].slice(0, 160);
    console.warn("gloam_onchain_read", n.key, msg);
    const readMs = Date.now() - started;
    const extra = { blocksRead: 0n, latest: null, readMs, error: msg };
    return { state, holdings: null, metrics: (p: Prices) => figures(n, state, null, p, days, extra) };
  }
}

async function readAll(): Promise<OnchainMetrics> {
  const days = lastDays(DAILY_WINDOW);
  const nets = NETWORK_KEYS.map(getNetwork).filter((n) => n.status === "live" && n.pool && n.deployBlock != null);
  const pricing = loadPrices();
  const reads = await Promise.all(nets.map((n) => readNetwork(n, days)));
  const prices = await pricing;
  const networks = reads.map((r) => r.metrics(prices));

  const allEvents = reads.map((r) => r.state.events);
  const depositors = new Set<string>();
  const active = new Set<string>();
  for (const events of allEvents) {
    for (const e of events) {
      if (!e.w) continue;
      active.add(e.w);
      if (e.k === "deposit") depositors.add(e.w);
    }
  }
  const sum = (f: (m: NetworkMetrics) => number) => networks.reduce((a, m) => a + f(m), 0);
  const firsts = networks.map((m) => m.firstActivity).filter((x): x is number => x != null);
  const lasts = networks.map((m) => m.lastActivity).filter((x): x is number => x != null);

  return {
    asOf: new Date().toISOString(),
    source: "fresh",
    ageSec: 0,
    prices: { ethUsd: prices.ethUsd, stocks: prices.stocks },
    networks,
    combined: {
      deposits: sum((m) => m.deposits),
      transfers: sum((m) => m.transfers),
      cashouts: sum((m) => m.cashouts),
      trades: sum((m) => m.trades),
      memos: sum((m) => m.memos),
      depositors: depositors.size,
      activeWallets: active.size,
      heldUsd: sum((m) => m.heldUsd),
      unpriced: networks.flatMap((m) => m.unpriced.map((s) => `${s} (${m.label})`)),
      firstActivity: firsts.length ? Math.min(...firsts) : null,
      lastActivity: lasts.length ? Math.max(...lasts) : null,
      daily: dailyRows(allEvents, days),
    },
    recent: networks
      .flatMap((m) => m.recent)
      .sort((a, b) => b.ts - a.ts || Number(b.block) - Number(a.block))
      .slice(0, RECENT_KEEP),
  };
}

/* ------------------------------------------------------------------ cache */

let snapshot: { at: number; data: OnchainMetrics } | null = null;
let inflight: Promise<OnchainMetrics> | null = null;

function aged(data: OnchainMetrics, source: OnchainMetrics["source"], at: number): OnchainMetrics {
  return { ...data, source, ageSec: Math.max(0, Math.round((Date.now() - at) / 1000)) };
}

/**
 * Both networks' on-chain figures. Served from a snapshot under a minute old
 * (memory, then Redis) unless `force`; a forced read still waits 15s since the
 * last one. Concurrent callers share one read.
 */
export async function fetchOnchainMetrics(opts: { force?: boolean } = {}): Promise<OnchainMetrics> {
  const now = Date.now();
  if (snapshot) {
    const age = now - snapshot.at;
    if (age < (opts.force ? FORCE_MIN_GAP_MS : SNAPSHOT_FRESH_MS)) return aged(snapshot.data, "memory", snapshot.at);
  }
  if (!opts.force) {
    const r = await cacheGetJson<{ at: number; data: OnchainMetrics }>(SNAPSHOT_KEY);
    if (r?.data && now - r.at < SNAPSHOT_FRESH_MS) {
      snapshot = r;
      return aged(r.data, "redis", r.at);
    }
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await readAll();
      const at = Date.now();
      snapshot = { at, data };
      await cacheSetJson(SNAPSHOT_KEY, snapshot, 3_600);
      return data;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
