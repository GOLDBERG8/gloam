import { NextResponse } from "next/server";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import { sendSolanaTx } from "@/lib/solanaTx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 12;

function fail(status: number, message: string) {
  return NextResponse.json({ ok: false, error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Sends a Solana transaction the person's wallet signed, for a wallet that can
 * sign but not send (most send it themselves). Body: { tx: base64 }.
 */
export async function POST(req: Request) {
  const rate = await hitRateLimit(clientIp(req), "solana-send", RATE_LIMIT);
  if (!rate.allowed) return fail(429, "Too many tries. Wait a minute.");
  const body = (await req.json().catch(() => null)) as { tx?: unknown } | null;
  const tx = typeof body?.tx === "string" ? body.tx : "";
  if (!tx || tx.length > 4000 || !/^[A-Za-z0-9+/=]+$/.test(tx)) return fail(400, "That transaction isn't valid.");
  const signature = await sendSolanaTx(tx);
  if (!signature) return fail(502, "Couldn't send it to Solana. Try again.");
  return NextResponse.json({ ok: true, data: { signature } }, { headers: { "Cache-Control": "no-store" } });
}
