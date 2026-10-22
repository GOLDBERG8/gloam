import { NextResponse } from "next/server";
import { webhookSecretOk } from "@/lib/telegramBot/rules";
import { runDueJobs } from "@/lib/relay/scheduled";
import { scheduledStore, scheduledStoreReady } from "@/lib/relay/scheduledStore";
import { networkForChain, readSpendState, sendUnshieldNow } from "@/lib/relay/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sends the scheduled cash outs that are due (lib/relay/scheduled). Vercel's
 * cron calls it every minute (vercel.json) with `Authorization: Bearer
 * <CRON_SECRET>`; without CRON_SECRET nothing gets in.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !webhookSecretOk(req.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Without the shared store there is nothing to run: never treat that as "no jobs".
  if (!scheduledStoreReady()) return NextResponse.json({ ok: false, code: "later_off" }, { status: 503 });
  const results = await runDueJobs(scheduledStore(), {
    now: () => Date.now(),
    readChain: (job) => readSpendState(networkForChain(job.chainId), job.root, job.nullifier),
    send: (job) =>
      sendUnshieldNow(networkForChain(job.chainId), {
        proof: job.proof,
        root: job.root,
        nullifier: job.nullifier,
        asset: job.asset,
        to: job.to,
        amount: job.amount,
      }),
  });
  // counts only: no ids, amounts or addresses in the logs
  const tally: Record<string, number> = {};
  for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
  if (results.length) console.info("gloam_cashout_later_run", JSON.stringify(tally));
  return NextResponse.json({ ok: true, data: tally });
}
