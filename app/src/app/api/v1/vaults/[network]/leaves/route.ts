import { after } from "next/server";
import { ApiError, withApiKey } from "@/lib/partnersApi";
import { isNetworkKey, networkKeyChoices } from "@/lib/networks";
import { getLeafSnapshot } from "@/lib/leafIndexServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The vault's public leaf list (the same as /api/vault-leaves): every
 * commitment in insertion order with its leaf index, block and tx. Rebuild the
 * tree from it and check the root against the pool's isKnownRoot before use.
 */
export async function GET(req: Request, ctx: { params: Promise<{ network: string }> }) {
  return withApiKey(req, async () => {
    const { network } = await ctx.params;
    if (!isNetworkKey(network)) throw new ApiError(404, "unknown_network", `network must be ${networkKeyChoices()}.`);
    let snap;
    try {
      snap = await getLeafSnapshot(network, (task) => after(task));
    } catch {
      throw new ApiError(503, "unavailable", "Could not read the vault right now. Try again shortly.");
    }
    if (!snap) throw new ApiError(404, "no_live_pool", "There is no live vault on that network.");
    return { data: snap };
  });
}
