import { NextResponse } from "next/server";
import { clientIp } from "@/lib/mcpRemote/rateLimit";
import {
  RelayError,
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

/** Which networks the relay can submit on right now (no secrets). */
export async function GET() {
  const networks = await relayStatus();
  return NextResponse.json({ ok: true, networks }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Submit an already-proven private action through the Gloam relay.
 * Body: { chainId, action: "transfer" | "unshield" | "memo", ...args }
 * Returns { ok: true, hash } as soon as the transaction is sent; the client
 * waits for the receipt itself.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new RelayError("Invalid request.");
    const net = networkForChain(body.chainId);
    const ip = clientIp(req);
    await checkRateLimit(ip);

    let hash: `0x${string}`;
    switch (body.action) {
      case "transfer":
        hash = await relayTransfer(net, body);
        break;
      case "unshield":
        hash = await relayUnshield(net, body);
        break;
      case "memo":
        hash = await relayMemo(net, body, ip);
        break;
      default:
        throw new RelayError("Unknown action.");
    }
    return NextResponse.json({ ok: true, hash });
  } catch (e) {
    if (e instanceof RelayError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.status });
    }
    console.error("gloam_relay", e);
    return NextResponse.json(
      { ok: false, error: "The relay hit an error. Send from your wallet for now.", code: "internal" },
      { status: 500 }
    );
  }
}
