import { MARKET_DEFS, type LiveQuote, type MarketDef } from "./markets";

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
      };
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
};

function formatVol(n: number | undefined) {
  if (!n || !Number.isFinite(n)) return ", ";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function sparkFromCloses(closes: Array<number | null | undefined>): number[] {
  const pts = closes.filter((c): c is number => c != null && Number.isFinite(c));
  if (pts.length < 2) return pts;
  return pts.slice(-30);
}

async function fetchYahoo(symbol: string): Promise<LiveQuote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=3mo`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as YahooChart;
  const result = data.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice;
  if (price == null || !Number.isFinite(price)) return null;
  const prev =
    result?.meta?.previousClose ??
    result?.meta?.chartPreviousClose ??
    price;
  const change24h = prev ? ((price - prev) / prev) * 100 : 0;
  const volumes = result?.indicators?.quote?.[0]?.volume ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const lastVol = [...volumes].reverse().find((v) => v != null && v > 0);
  return {
    mark: price,
    change24h: Number(change24h.toFixed(2)),
    volume: formatVol(lastVol ?? undefined),
    source: "live",
    updatedAt: Date.now(),
    spark: sparkFromCloses(closes),
  };
}

type CgSimple = Record<
  string,
  { usd?: number; usd_24h_change?: number; usd_24h_vol?: number }
>;

async function fetchCoinGeckoSimple(
  ids: string[]
): Promise<Map<string, Omit<LiveQuote, "spark">>> {
  const map = new Map<string, Omit<LiveQuote, "spark">>();
  if (ids.length === 0) return map;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(
    ","
  )}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return map;
  const data = (await res.json()) as CgSimple;
  for (const id of ids) {
    const row = data[id];
    if (!row?.usd) continue;
    map.set(id, {
      mark: row.usd,
      change24h: Number((row.usd_24h_change ?? 0).toFixed(2)),
      volume: formatVol(row.usd_24h_vol),
      source: "live",
      updatedAt: Date.now(),
    });
  }
  return map;
}

async function fetchCoinGeckoSpark(id: string): Promise<number[]> {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { prices?: [number, number][] };
  const prices = data.prices ?? [];
  const step = Math.max(1, Math.floor(prices.length / 30));
  return prices.filter((_, i) => i % step === 0).map((p) => p[1]);
}

function fallbackQuote(def: MarketDef): LiveQuote {
  return {
    mark: def.fallbackMark,
    change24h: 0,
    volume: ", ",
    source: "static",
    updatedAt: Date.now(),
    spark: [],
  };
}

export async function loadLiveMarkets() {
  const cgIds = [
    ...new Set(
      MARKET_DEFS.map((m) => m.coingecko).filter((id): id is string =>
        Boolean(id)
      )
    ),
  ];
  const yahooDefs = MARKET_DEFS.filter((m) => m.yahoo);

  const [cgSimple, ...yahooPairs] = await Promise.all([
    fetchCoinGeckoSimple(cgIds).catch(
      () => new Map<string, Omit<LiveQuote, "spark">>()
    ),
    ...yahooDefs.map(async (m) => {
      const q = await fetchYahoo(m.yahoo!).catch(() => null);
      return [m.id, q] as const;
    }),
  ]);

  const yahooMap = new Map(yahooPairs);

  const sparkMap = new Map<string, number[]>();
  await Promise.all(
    cgIds.map(async (id) => {
      const spark = await fetchCoinGeckoSpark(id).catch(() => [] as number[]);
      sparkMap.set(id, spark);
    })
  );

  return MARKET_DEFS.map((def) => {
    let q: LiveQuote | null = null;
    if (def.yahoo) {
      const y = yahooMap.get(def.id);
      if (y) q = y;
    }
    if (!q && def.coingecko) {
      const base = cgSimple.get(def.coingecko);
      if (base) {
        q = {
          ...base,
          spark: sparkMap.get(def.coingecko) ?? [],
        };
      }
    }
    if (!q) q = fallbackQuote(def);
    return {
      ...def,
      mark: q.mark,
      change24h: q.change24h,
      volume: q.volume,
      source: q.source,
      updatedAt: q.updatedAt,
      spark: q.spark ?? [],
    };
  });
}

/** ETH USD for portfolio dollar conversion */
export async function loadEthUsd(): Promise<number | null> {
  try {
    const map = await fetchCoinGeckoSimple(["ethereum"]);
    return map.get("ethereum")?.mark ?? null;
  } catch {
    return null;
  }
}
