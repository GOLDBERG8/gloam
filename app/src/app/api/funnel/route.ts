import { NextResponse } from "next/server";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import { addFunnel, isFunnelEvent } from "@/lib/funnelStore";

/** A busy session sends one or two; the rest is noise. */
const PER_IP_PER_MIN = 20;

/**
 * Claim-link counts (lib/funnel). The body is one event name from a fixed list
 * and nothing else is read or kept: no cookie, no id, no IP, no user agent.
 * Each call adds 1 to today's total.
 */
export async function POST(req: Request) {
  const rate = await hitRateLimit(clientIp(req), "funnel", PER_IP_PER_MIN);
  if (!rate.allowed) return new NextResponse(null, { status: 429 });
  let e: unknown;
  try {
    const text = await req.text();
    if (text.length > 200) return new NextResponse(null, { status: 413 });
    e = (JSON.parse(text) as { e?: unknown }).e;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!isFunnelEvent(e)) return new NextResponse(null, { status: 400 });
  try {
    await addFunnel(e);
  } catch {
    // counting is best effort
  }
  return new NextResponse(null, { status: 204 });
}
