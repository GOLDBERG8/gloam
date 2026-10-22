/* eslint-disable @typescript-eslint/no-explicit-any -- Relay's status JSON is read field by field below */
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

/** Relay's status words, folded into the few the panel shows. An id Relay doesn't know yet is still waiting. */
function stageOf(status: string): BridgeStage {
  if (status === "success") return "done";
  if (status === "refund" || status === "refunded") return "refunded";
  if (status === "failure" || status === "failed") return "failed";
  if (status === "waiting" || status === "unknown") return "waiting";
  return "moving";
}

/**
 * An open deposit address is filled under a new request when what arrives
 * differs from the quote (an exchange takes its fee off, say), while the
 * quoted request stays waiting. The newest request on the address tells.
 */
async function byDepositAddress(address: string, apiKey: string): Promise<BridgeStatus | null> {
  try {
    const res = await fetch(`${RELAY_API}/requests/v3?depositAddress=${encodeURIComponent(address)}&limit=5`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    type Found = { status?: unknown; data?: { outTxs?: { hash?: unknown; txHash?: unknown }[] } };
    const data = (await res.json().catch(() => null)) as { requests?: Found[] } | null;
    const moved = (data?.requests ?? []).find((r) => typeof r?.status === "string" && r.status !== "waiting");
    if (!res.ok || !moved) return null;
    const out = moved.data?.outTxs?.[0]?.hash ?? moved.data?.outTxs?.[0]?.txHash;
    return { stage: stageOf(String(moved.status)), outTx: typeof out === "string" ? out : null };
  } catch {
    return null;
  }
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
  let status: BridgeStatus = { stage: stageOf(data!.status), outTx };
  const depositAddress = new URL(req.url).searchParams.get("depositAddress") ?? "";
  if (status.stage === "waiting" && apiKey && /^[A-Za-z0-9]{25,64}$/.test(depositAddress)) {
    status = (await byDepositAddress(depositAddress, apiKey)) ?? status;
  }
  return NextResponse.json({ ok: true, data: status }, { headers: { "Cache-Control": "no-store" } });
}
