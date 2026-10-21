import { NextResponse } from "next/server";
import { isMainnetLive } from "@/lib/mainnet";

export const dynamic = "force-dynamic";

/**
 * RH mainnet memes (DexScreener) stay off: the mainnet pools are for payments,
 * and the Markets page is a Robinhood Chain testnet product.
 * Endpoint kept so clients don't 404, returns empty + honest meta.
 */
export async function GET() {
  return NextResponse.json({
    memes: [],
    meta: {
      chain: "robinhood-testnet",
      count: 0,
      note: isMainnetLive()
        ? "Memes are paused. No mainnet market data is mixed in."
        : "Memes paused while product is testnet-only. No mainnet data mixed in.",
      fetchedAt: Date.now(),
    },
  });
}
