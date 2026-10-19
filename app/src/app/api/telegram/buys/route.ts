import { NextResponse } from "next/server";
import { botConfig } from "@/lib/telegramBot/bot";
import { pollBuys } from "@/lib/telegramBot/buys";
import { webhookSecretOk } from "@/lib/telegramBot/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Checks for new $GLOAM buys and posts them in the Buys topic, for an outside
 * cron (every minute or so) when the group is quiet. Sends
 * `Authorization: Bearer <CRON_SECRET>`; without CRON_SECRET nothing gets in.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !webhookSecretOk(req.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const posted = await pollBuys(botConfig().groupId);
  return NextResponse.json({ ok: true, data: { posted } });
}
