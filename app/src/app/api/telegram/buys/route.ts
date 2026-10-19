import { NextResponse } from "next/server";
import { botConfig } from "@/lib/telegramBot/bot";
import { pollBuys } from "@/lib/telegramBot/buys";
import { webhookSecretOk } from "@/lib/telegramBot/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Checks for new $GLOAM buys and posts them in the Buys topic, so they still go
 * up when the group is quiet. Vercel's cron calls it every minute (vercel.json)
 * with `Authorization: Bearer <CRON_SECRET>`; without CRON_SECRET nothing gets in.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !webhookSecretOk(req.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const posted = await pollBuys(botConfig().groupId);
  return NextResponse.json({ ok: true, data: { posted } });
}
