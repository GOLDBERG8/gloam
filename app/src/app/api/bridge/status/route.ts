import { NextResponse } from "next/server";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import type { BridgeStage, BridgeStatus } from "@/lib/bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RELAY_API = "https://api.relay.link";
/** Status checks per IP per minute. The panel asks every 5 seconds. */
const RATE_LIMIT = 30;

function fail(status: number, message: string) {
  return NextResponse.json({ ok: false, error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Relay's status words, folded into the few the panel shows. */
function stageOf(status: string): BridgeStage {
  if (status === "success") return "done";
  if (status === "refund" || status === "refunded") return "refunded";
  if (status === "failure" || status === "failed") return "failed";
  if (status === "waiting") return "waiting";
  return "moving";
}

/** Where a bridge stands: ?requestId=0x… from the quote. */
export async function GET(req: Request) {
  const rate = await hitRateLimit(clientIp(req), "bridge-status", RATE_LIMIT);
  if (!rate.allowed) return fail(429, "Too many checks. Wait a minute.");

  const requestId = new URL(req.url).searchParams.get("requestId") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(requestId)) return fail(400, "Unknown transfer.");

  const apiKey = process.env.RELAY_API_KEY;
  let data: Record<string, any> | null = null;
  try {
    const res = await fetch(`${RELAY_API}/intents/status/v3?requestId=${requestId}`, {
      headers: apiKey ? { "x-api-key": apiKey } : {},
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    data = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!res.ok || typeof data?.status !== "string") return fail(502, "Couldn't check the transfer. Trying again.");
  } catch {
    return fail(502, "Couldn't check the transfer. Trying again.");
  }

  const outTx = Array.isArray(data?.txHashes) && typeof data.txHashes[0] === "string" ? data.txHashes[0] : null;
  const status: BridgeStatus = { stage: stageOf(data!.status), outTx };
  return NextResponse.json({ ok: true, data: status }, { headers: { "Cache-Control": "no-store" } });
}
