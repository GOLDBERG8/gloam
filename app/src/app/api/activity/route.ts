import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";

const EXPLORER_API = "https://explorer.testnet.chain.robinhood.com/api";

export const dynamic = "force-dynamic";

/** Lookups per IP per minute. The app polls every 30 seconds per open tab. */
const PER_IP_PER_MIN = 30;

type TxRow = {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  isError: string;
};

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  const rate = await hitRateLimit(clientIp(req), "activity", PER_IP_PER_MIN);
  if (!rate.allowed) {
    return NextResponse.json(
      { txs: [], error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  try {
    // Cap server fetch; UI paginates client-side (PAGE_SIZE=5)
    const url = `${EXPLORER_API}?module=account&action=txlist&address=${address}&page=1&offset=40&sort=desc`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { txs: [], error: "explorer_unavailable" },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      result?: TxRow[] | string;
    };
    const rows = Array.isArray(data.result) ? data.result : [];
    const txs = rows.map((t) => ({
      hash: t.hash,
      from: t.from,
      to: t.to,
      valueWei: t.value,
      timestamp: Number(t.timeStamp) * 1000,
      ok: t.isError === "0",
    }));

    // public explorer data per address: the CDN answers the 30 s polls
    return NextResponse.json({ txs, address }, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } });
  } catch {
    return NextResponse.json(
      { txs: [], error: "fetch_failed" },
      { status: 502 }
    );
  }
}
