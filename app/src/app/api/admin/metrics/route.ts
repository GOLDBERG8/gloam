import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { fetchOnchainMetrics } from "@/lib/onchainMetrics";
import { readTractionSummary } from "@/lib/tractionStore";
import { readFunnel } from "@/lib/funnelStore";
import {
  isTestnetOpen,
  testnetOpensAtMs,
  testnetForceOpen,
} from "@/lib/testnetLaunch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The bridge's own cut, as api/bridge/quote reads it: on only with a valid rate and recipient. */
function bridgeFeeBps(): number | null {
  const bps = Number(process.env.BRIDGE_FEE_BPS ?? "");
  const recipient = process.env.BRIDGE_FEE_RECIPIENT ?? "";
  return Number.isInteger(bps) && bps > 0 && bps <= 100 && isAddress(recipient) ? bps : null;
}

/**
 * Admin metrics: on-chain figures for both networks (cached about a minute,
 * see lib/onchainMetrics) plus the product event summary. `?fresh=1` skips the
 * snapshot cache (still at most one chain read per 15s).
 */
export async function GET(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const force = new URL(req.url).searchParams.get("fresh") === "1";
  const [onchain, product, claimLinks] = await Promise.all([
    fetchOnchainMetrics({ force }).catch((e) => {
      console.error("gloam_admin_metrics", e instanceof Error ? e.message : "unknown");
      return { error: "Could not read the chains. The details are in the server logs." };
    }),
    readTractionSummary().catch(() => ({
      backend: "memory" as const,
      totalEvents: 0,
      counters: {},
      dims: {},
      daily: [],
      recent: [],
    })),
    readFunnel(14).catch(() => []),
  ]);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    launch: {
      open: isTestnetOpen(),
      forceOpen: testnetForceOpen(),
      opensAt: new Date(testnetOpensAtMs()).toISOString(),
      opensAtMs: testnetOpensAtMs(),
    },
    onchain,
    product,
    claimLinks,
    revenueConfig: { bridgeFeeBps: bridgeFeeBps() },
  });
}
