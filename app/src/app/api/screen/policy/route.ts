import { NextResponse } from "next/server";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import { poolNotice } from "@/lib/tip403";
import { tip403Applies, tip403AssetStatus } from "@/lib/tip403Server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** An asset's issuer policy is public and the same for everyone; the server keeps it 30 s too. */
const PUBLIC = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" };

// Shared across instances (lib/mcpRemote/rateLimit). Answers are cached per
// asset; this keeps the route from being a free RPC proxy.
const WINDOW_SEC = 10 * 60;
const PER_IP = 120;

/**
 * The TIP-403 issuer policy of a Tempo stablecoin and what it means for the
 * Gloam vault. Public chain data only: no wallet address is asked for.
 *
 * GET /api/screen/policy?chainId=42431&asset=0x20c0...
 *   { ok: true, applies: false }                    not a Tempo TIP-20 asset
 *   { ok: true, applies: true, status: null }       the chain did not answer
 *   { ok: true, applies: true, status, notices }    status: policy id + kind,
 *     paused, poolCanReceive, poolCanSend; notices: the warning per flow, or null
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get("chainId"));
  const asset = url.searchParams.get("asset");
  if (!tip403Applies(chainId, asset)) {
    return NextResponse.json({ ok: true, applies: false }, { headers: PUBLIC });
  }
  if (!(await hitRateLimit(clientIp(req), "screen-policy", PER_IP, Date.now(), WINDOW_SEC)).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests. Wait a few minutes." }, { status: 429, headers: NO_STORE });
  }
  try {
    const status = await tip403AssetStatus(chainId, asset);
    if (!status) return NextResponse.json({ ok: true, applies: false }, { headers: PUBLIC });
    return NextResponse.json(
      {
        ok: true,
        applies: true,
        status,
        notices: { deposit: poolNotice(status, "deposit"), cashout: poolNotice(status, "cashout") },
      },
      { headers: PUBLIC }
    );
  } catch {
    return NextResponse.json({ ok: true, applies: true, status: null }, { headers: NO_STORE });
  }
}
