/**
 * Bridges and swaps made through Gloam's Relay panel, for /admin. Server only.
 *
 * Every quote from api/bridge/quote carries the referrer RELAY_REFERRER once
 * RELAY_API_KEY is set: Relay takes a referrer only with a key, and its request
 * history (GET /requests/v3, filtered by that referrer) also needs one. Without
 * a key nothing is tagged, so /admin says so and counts the product events
 * instead. Only requests made after the key went live are ours to count.
 *
 * Relay's answer names each request's wallets; they are dropped here and never
 * reach the page. What is kept: chains, tokens, amounts, dollar values, Relay's
 * fees, the delivery transaction and the time.
 */

import { RELAY_REFERRER } from "./bridge";
import { cacheGetJson, cacheSetJson, lastDays, utcDay } from "./tractionStore";

const RELAY_API = "https://api.relay.link";
/** Relay pages at most 50 requests. */
const PAGE = 50;
/** Pages read per refresh; more than this and the totals say they were cut short. */
const MAX_PAGES = 20;
const DAILY_WINDOW = 30;
const RECENT_KEEP = 25;
const FRESH_MS = 60_000;
const SNAPSHOT_KEY = "gloam:relay:volume:v1";

export type RelayKind = "bridge" | "swap";
export type RelayStage = "done" | "refunded" | "failed" | "pending";

export type RelayRow = {
  kind: RelayKind;
  stage: RelayStage;
  fromChainId: number | null;
  toChainId: number | null;
  inSymbol: string;
  inAmount: string;
  inUsd: number | null;
  outSymbol: string;
  outAmount: string;
  outUsd: number | null;
  /** What Relay charged (gas, its fee and price), in dollars. */
  feeUsd: number;
  /** The delivery transaction, or the deposit when nothing was delivered. */
  tx: string | null;
  /** Unix seconds. */
  ts: number;
};

export type RelayTotals = { count: number; inUsd: number; outUsd: number; feeUsd: number };

export type RelayVolume =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      asOf: string;
      source: "fresh" | "memory" | "redis";
      ageSec: number;
      referrer: string;
      /** Unix seconds of the first tagged request; null with none yet. */
      since: number | null;
      /** True when there were more requests than one refresh reads. */
      truncated: boolean;
      /** Finished requests only. */
      all: Record<RelayKind, RelayTotals>;
      last30: Record<RelayKind, RelayTotals>;
      /** Requests refunded or failed, and still in flight. */
      refunded: number;
      failed: number;
      pending: number;
      bySource: { chainId: number | null; kind: RelayKind; count: number; inUsd: number; feeUsd: number }[];
      /** Per UTC day, oldest first. */
      daily: { day: string; bridges: number; bridgeUsd: number; swaps: number; swapUsd: number; feeUsd: number }[];
      recent: RelayRow[];
    };

function num(v: unknown): number | null {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
}

function stageOf(status: unknown): RelayStage {
  if (status === "success") return "done";
  if (status === "refund" || status === "refunded") return "refunded";
  if (status === "failure" || status === "failed") return "failed";
  return "pending";
}

/** One Relay request, without its wallets. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Relay's response is untyped JSON, read defensively
function toRow(r: any): RelayRow | null {
  const data = r?.data ?? {};
  const meta = data.metadata ?? {};
  const cin = meta.currencyIn ?? {};
  const cout = meta.currencyOut ?? {};
  const inTx = Array.isArray(data.inTxs) ? data.inTxs[0] : undefined;
  const outTx = Array.isArray(data.outTxs) ? data.outTxs[0] : undefined;
  const fromChainId = num(cin.currency?.chainId) ?? num(inTx?.chainId);
  const toChainId = num(cout.currency?.chainId) ?? num(outTx?.chainId);
  const created = Date.parse(String(r?.createdAt ?? ""));
  if (!Number.isFinite(created)) return null;
  const feeUsd = Object.values((data.feesUsd ?? {}) as Record<string, unknown>).reduce<number>((s, v) => s + (num(v) ?? 0), 0);
  return {
    kind: fromChainId != null && fromChainId === toChainId ? "swap" : "bridge",
    stage: stageOf(r?.status),
    fromChainId,
    toChainId,
    inSymbol: String(cin.currency?.symbol ?? ""),
    inAmount: String(cin.amountFormatted ?? ""),
    inUsd: num(cin.amountUsd),
    outSymbol: String(cout.currency?.symbol ?? ""),
    outAmount: String(cout.amountFormatted ?? ""),
    outUsd: num(cout.amountUsd),
    feeUsd: Math.max(0, feeUsd),
    tx: typeof outTx?.hash === "string" ? outTx.hash : typeof inTx?.hash === "string" ? inTx.hash : null,
    ts: Math.floor(created / 1000),
  };
}

function emptyTotals(): Record<RelayKind, RelayTotals> {
  return {
    bridge: { count: 0, inUsd: 0, outUsd: 0, feeUsd: 0 },
    swap: { count: 0, inUsd: 0, outUsd: 0, feeUsd: 0 },
  };
}

async function readAll(apiKey: string): Promise<Extract<RelayVolume, { enabled: true }>> {
  const rows: RelayRow[] = [];
  let continuation: string | null = null;
  let truncated = false;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      truncated = true;
      break;
    }
    const q = new URLSearchParams({ referrer: RELAY_REFERRER, limit: String(PAGE) });
    if (continuation) q.set("continuation", continuation);
    const res = await fetch(`${RELAY_API}/requests/v3?${q}`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Relay's response is untyped JSON
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !Array.isArray(json?.requests)) {
      throw new Error(typeof json?.message === "string" ? json.message.slice(0, 160) : `Relay answered ${res.status}`);
    }
    for (const r of json.requests) {
      const row = toRow(r);
      if (row) rows.push(row);
    }
    continuation = typeof json.continuation === "string" && json.continuation ? json.continuation : null;
    if (!continuation || json.requests.length < PAGE) break;
  }

  const days = lastDays(DAILY_WINDOW);
  const cutoff = Date.parse(`${days[0]}T00:00:00Z`) / 1000;
  const all = emptyTotals();
  const last30 = emptyTotals();
  const daily = new Map(days.map((d) => [d, { day: d, bridges: 0, bridgeUsd: 0, swaps: 0, swapUsd: 0, feeUsd: 0 }]));
  const bySource = new Map<string, { chainId: number | null; kind: RelayKind; count: number; inUsd: number; feeUsd: number }>();
  let refunded = 0;
  let failed = 0;
  let pending = 0;

  for (const r of rows) {
    if (r.stage === "refunded") refunded++;
    if (r.stage === "failed") failed++;
    if (r.stage === "pending") pending++;
    if (r.stage !== "done") continue;
    const usdIn = r.inUsd ?? 0;
    const usdOut = r.outUsd ?? 0;
    for (const t of r.ts >= cutoff ? [all[r.kind], last30[r.kind]] : [all[r.kind]]) {
      t.count++;
      t.inUsd += usdIn;
      t.outUsd += usdOut;
      t.feeUsd += r.feeUsd;
    }
    const key = `${r.kind}:${r.fromChainId}`;
    const s = bySource.get(key) ?? { chainId: r.fromChainId, kind: r.kind, count: 0, inUsd: 0, feeUsd: 0 };
    s.count++;
    s.inUsd += usdIn;
    s.feeUsd += r.feeUsd;
    bySource.set(key, s);
    const d = daily.get(utcDay(r.ts * 1000));
    if (d) {
      if (r.kind === "bridge") {
        d.bridges++;
        d.bridgeUsd += usdIn;
      } else {
        d.swaps++;
        d.swapUsd += usdIn;
      }
      d.feeUsd += r.feeUsd;
    }
  }

  return {
    enabled: true,
    asOf: new Date().toISOString(),
    source: "fresh",
    ageSec: 0,
    referrer: RELAY_REFERRER,
    since: rows.length ? Math.min(...rows.map((r) => r.ts)) : null,
    truncated,
    all,
    last30,
    refunded,
    failed,
    pending,
    bySource: [...bySource.values()].sort((a, b) => b.inUsd - a.inUsd || b.count - a.count),
    daily: [...daily.values()],
    recent: [...rows].sort((a, b) => b.ts - a.ts).slice(0, RECENT_KEEP),
  };
}

type Snapshot = { at: number; data: Extract<RelayVolume, { enabled: true }> };
let snapshot: Snapshot | null = null;
let inflight: Promise<RelayVolume> | null = null;

function aged(s: Snapshot, source: "memory" | "redis"): RelayVolume {
  return { ...s.data, source, ageSec: Math.max(0, Math.round((Date.now() - s.at) / 1000)) };
}

/** Relay volume tagged to Gloam, cached about a minute in memory and Redis. */
export async function fetchRelayVolume(): Promise<RelayVolume> {
  const apiKey = process.env.RELAY_API_KEY?.trim();
  if (!apiKey) {
    return {
      enabled: false,
      reason: "RELAY_API_KEY is not set, so Relay neither tags Gloam's quotes nor shares their history.",
    };
  }
  const now = Date.now();
  if (snapshot && now - snapshot.at < FRESH_MS) return aged(snapshot, "memory");
  const cached = await cacheGetJson<Snapshot>(SNAPSHOT_KEY);
  if (cached?.data && now - cached.at < FRESH_MS) {
    snapshot = cached;
    return aged(cached, "redis");
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await readAll(apiKey);
      snapshot = { at: Date.now(), data };
      await cacheSetJson(SNAPSHOT_KEY, snapshot, 3_600);
      return data;
    } catch (e) {
      // the last good read beats an empty panel
      if (snapshot) return aged(snapshot, "memory");
      throw e;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
