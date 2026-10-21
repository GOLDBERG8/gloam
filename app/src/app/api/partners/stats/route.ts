import type { NextRequest } from "next/server";
import { ApiError, portal, sessionWallet } from "@/lib/partnersApi";
import { getPartnerByOwner, readPartnerStats, STATS_DAYS } from "@/lib/partners";
import { MAINNET_ENABLED } from "@/lib/networks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Volume and would-be commissions for the signed-in partner: totals, by kind,
 * by network, by asset, the last 14 days, and the latest 50 transactions.
 * Partner fees are not collected on any network yet, mainnet included: nothing
 * is charged; fees show what the setting would have earned.
 */
export async function GET(req: NextRequest) {
  return portal(async () => {
    const partner = await getPartnerByOwner(sessionWallet(req));
    if (!partner) throw new ApiError(404, "no_account", "Create your partner account first.");
    const stats = await readPartnerStats(partner.id, { recent: 50 });
    // Where the counts come from: the testnets, plus the mainnets once a mainnet pool is in.
    return {
      data: { ...stats, days: STATS_DAYS, charged: false, network: MAINNET_ENABLED ? "mainnet and testnet" : "testnet" },
    };
  });
}
