import { NextResponse } from "next/server";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import { isPersonAction, isWalletAddress, PERSON_ACTIONS, type PersonAction } from "@/lib/people";
import { addPerson } from "@/lib/peopleStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A wallet sends a connect and one batch of actions a day; the rest is noise. */
const PER_IP_PER_MIN = 20;
const PER_IP_PER_HOUR = 60;
const MAX_BODY = 300;

const done = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * People using Gloam (lib/people, lib/peopleStore). The body is exactly
 * { w: address, env: "mainnet" | "testnet", a: [action names] } and nothing
 * else: a body with any other field (an amount, a note, a code, a hash) is
 * refused. The address is turned into a one-way code and added to the
 * counters; it is never stored, logged or sent anywhere.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  // shared across instances (not a local bucket), so a count is harder to pad
  const [minute, hour] = await Promise.all([
    hitRateLimit(ip, "people", PER_IP_PER_MIN),
    hitRateLimit(ip, "people-hour", PER_IP_PER_HOUR, Date.now(), 3_600),
  ]);
  if (!minute.allowed || !hour.allowed) return done(429);

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return done(413);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return done(400);
    body = parsed as Record<string, unknown>;
  } catch {
    return done(400);
  }
  const keys = Object.keys(body);
  if (keys.some((k) => k !== "w" && k !== "env" && k !== "a")) return done(400);
  const { w, env, a } = body;
  if (!isWalletAddress(w)) return done(400);
  if (env !== "mainnet" && env !== "testnet") return done(400);
  if (!Array.isArray(a) || a.length === 0 || a.length > PERSON_ACTIONS.length || !a.every(isPersonAction)) return done(400);
  const actions = [...new Set(a as PersonAction[])];

  // A recording-demo build (lib/demoFlag) plays everything back in the browser; none of it is a person.
  if (process.env.NEXT_PUBLIC_GLOAM_DEMO === "1") return done(204);

  try {
    await addPerson(w, actions, env);
  } catch {
    // counting is best effort, and the failure never names the wallet
  }
  return done(204);
}
