import { ApiError, withApiKey } from "@/lib/partnersApi";
import { isNetworkKey, networkKeyChoices } from "@/lib/networks";
import { vaultStatuses } from "../../_lib/vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vault status on one network: robinhood or tempo. */
export async function GET(req: Request, ctx: { params: Promise<{ network: string }> }) {
  return withApiKey(req, async () => {
    const { network } = await ctx.params;
    if (!isNetworkKey(network)) throw new ApiError(404, "unknown_network", `network must be ${networkKeyChoices()}.`);
    const [vault] = await vaultStatuses(network);
    return { data: { vault } };
  });
}
