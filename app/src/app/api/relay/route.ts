import { NextResponse } from "next/server";
import { clientIp } from "@/lib/mcpRemote/rateLimit";
import {
  RelayError,
  checkRateLimit,
  memoTicket,
  networkForChain,
  relayMemo,
  relayStatus,
  relayTransfer,
  relayUnshield,
  relayVaultSwap,
} from "@/lib/relay/server";

export const runtime = "nodejs";
// a send can wait its turn in the relay's queue (lib/relay/inflight) before it goes out
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Which networks the relay can submit on right now (no secrets). */
export async function GET() {
  const networks = await relayStatus();
  // public and the same for everyone: the CDN answers the app's checks, the relay's balance reads stay rare
  return NextResponse.json({ ok: true, networks }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } });
}

/**
 * Submit an already-proven private action through the Gloam relay.
 * Body: { chainId, action: "transfer" | "unshield" | "memo" | "swap", ...args }
 * Returns { ok: true, hash } as soon as the transaction is sent; the client
 * waits for the receipt itself. A transfer also returns `memoTicket` for its
 * payment (commitments[0]), null when the relay has no memo secret: sent back
 * as `ticket` with that payment's memo, it gets the payer's own few messages.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new RelayError("Invalid request.");
    const net = networkForChain(body.chainId);
    await checkRateLimit(clientIp(req));

    let hash: `0x${string}`;
    switch (body.action) {
      case "transfer": {
        hash = await relayTransfer(net, body);
        // relayTransfer checked commitments[0] is a bytes32
        const payment = (body.commitments as string[])[0]!;
        return NextResponse.json({ ok: true, hash, memoTicket: memoTicket(net.chainId, payment) });
      }
      case "unshield":
        hash = await relayUnshield(net, body);
        break;
      case "memo":
        hash = await relayMemo(net, body);
        break;
      case "swap":
        hash = await relayVaultSwap(net, body);
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
