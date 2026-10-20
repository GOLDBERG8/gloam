import { ApiError, jsonBody, requireKeyEnv, withApiKey } from "@/lib/partnersApi";
import { keyEnvForNetwork } from "@/lib/apiKeys";
import { recordActivity, type ActivityKind, type ActivityRecord } from "@/lib/partners";
import {
  asAddress,
  asAmount,
  checkRateLimit,
  networkForChain,
  relayMemo,
  relayStatus,
  relayTransfer,
  relayUnshield,
} from "@/lib/relay/server";

export const runtime = "nodejs";
// a send can wait its turn in the relay's queue (lib/relay/inflight) before it goes out
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Relay readiness per network (same as /api/relay, behind a key). */
export async function GET(req: Request) {
  return withApiKey(req, async () => ({ data: { networks: await relayStatus() } }));
}

type Attribution =
  | { recorded: true; kind: ActivityKind; activity: ActivityRecord }
  | { recorded: false; kind: ActivityKind | null; reason: "not_billable" | "duplicate" | "storage_error" };

/**
 * Submit an already-proven private action through the Gloam relay, attributed
 * to your partner account. Body is the same as /api/relay:
 *   { chainId, action: "transfer", proof, root, nullifier, commitments: [c0, c1] }
 *   { chainId, action: "unshield", proof, root, nullifier, asset, to, amount }
 *   { chainId, action: "memo", paymentCommitment, memo }
 * The relay checks, screens and dry-runs exactly as it does for the app
 * (lib/relay/server); this route adds the key, the limits and the accounting.
 */
export async function POST(req: Request) {
  return withApiKey(req, async ({ key, partner }) => {
    const body = await jsonBody(req);
    const net = networkForChain(body.chainId);
    requireKeyEnv(key, keyEnvForNetwork(net), net.label);
    // The relay's own per-sender cap, with the key as the sender (the network cap applies when it sends).
    await checkRateLimit(`key:${key.id}`);

    let hash: `0x${string}`;
    let kind: ActivityKind | null = null;
    let edge: { asset: `0x${string}`; amount: bigint } | null = null;
    switch (body.action) {
      case "transfer":
        hash = await relayTransfer(net, body);
        kind = "private_payment";
        break;
      case "unshield":
        hash = await relayUnshield(net, body);
        kind = "cash_out";
        // Public inputs of the cash-out proof, already validated by the relay.
        edge = { asset: asAddress(body.asset, "asset"), amount: asAmount(body.amount) };
        break;
      case "memo":
        hash = await relayMemo(net, body, `key:${key.id}`);
        break;
      default:
        throw new ApiError(400, "bad_action", 'action must be "transfer", "unshield" or "memo".');
    }

    let attribution: Attribution;
    if (!kind) {
      attribution = { recorded: false, kind: null, reason: "not_billable" };
    } else {
      try {
        const r = await recordActivity({ partner, keyId: key.id, network: net, kind, txHash: hash, edge });
        attribution = r.recorded ? { recorded: true, kind, activity: r.record } : { recorded: false, kind, reason: r.reason };
      } catch (e) {
        // The transaction is already sent: never fail the response over accounting.
        console.error("gloam_api_attribution", e);
        attribution = { recorded: false, kind, reason: "storage_error" };
      }
    }
    return { data: { hash, chainId: net.chainId, network: net.key, action: body.action, attribution, charged: false } };
  });
}
