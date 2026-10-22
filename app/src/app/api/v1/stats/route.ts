import { ApiError, withApiKey } from "@/lib/partnersApi";
import { fetchOnchainMetrics } from "@/lib/onchainMetrics";
import { getNetwork } from "@/lib/networks";
import { MAINNET_LAUNCH_ISO } from "@/lib/mainnet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Public vault figures per network, as /transparency shows them: what each
 * vault holds, and counts of deposits, private transfers, cash outs and payment
 * messages. Aggregates only; no wallet lists. Cached about a minute.
 */
export async function GET(req: Request) {
  return withApiKey(req, async () => {
    let m;
    try {
      m = await fetchOnchainMetrics();
    } catch {
      throw new ApiError(503, "unavailable", "Could not read the vaults right now. Try again shortly.");
    }
    return {
      data: {
        asOf: m.asOf,
        ageSec: m.ageSec,
        prices: m.prices,
        networks: m.networks.map((n) => ({
          network: n.key,
          label: n.label,
          testnet: n.testnet ?? getNetwork(n.key).testnet,
          chainId: n.chainId,
          pool: n.pool,
          vaultSince: n.vaultSince,
          // Counts start here: the public launch on mainnet, the vault's deploy on a testnet. Holdings are live.
          countedSince: (n.testnet ?? getNetwork(n.key).testnet) ? n.vaultSince : Math.floor(Date.parse(MAINNET_LAUNCH_ISO) / 1000),
          scannedTo: n.scannedTo,
          deposits: n.deposits,
          transfers: n.transfers,
          cashouts: n.cashouts,
          memos: n.memos,
          heldUsd: n.heldUsd,
          unpriced: n.unpriced,
          assets: n.assets.map((a) => ({ asset: a.asset, symbol: a.symbol, stable: a.stable, held: a.held, heldUsd: a.heldUsd })),
          firstActivity: n.firstActivity,
          lastActivity: n.lastActivity,
          // the chain read's own error stays in the server logs, never in the response
          error: n.error ? "read_failed" : null,
        })),
        combined: {
          deposits: m.combined.deposits,
          transfers: m.combined.transfers,
          cashouts: m.combined.cashouts,
          memos: m.combined.memos,
          heldUsd: m.combined.heldUsd,
          unpriced: m.combined.unpriced,
        },
        combinedIncludesTestnets: true,
        // real money only; `combined` above also counts the testnets
        ...(m.mainnet
          ? {
              mainnet: {
                deposits: m.mainnet.deposits,
                transfers: m.mainnet.transfers,
                cashouts: m.mainnet.cashouts,
                memos: m.mainnet.memos,
                heldUsd: m.mainnet.heldUsd,
                unpriced: m.mainnet.unpriced,
              },
            }
          : {}),
      },
    };
  });
}
