import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import {
  DELAY_WINDOWS,
  cancelJob,
  drawSendAfter,
  isLive,
  jobView,
  sameCashOut,
  scheduleJob,
  type CashOutJob,
  type DelayWindow,
} from "@/lib/relay/scheduled";
import { scheduledStore, scheduledStoreReady } from "@/lib/relay/scheduledStore";
import { RelayError, checkRateLimit, checkUnshieldForLater, networkForChain } from "@/lib/relay/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** New scheduled cash outs per sender per hour. */
const SCHEDULE_PER_HOUR = 20;
/** New scheduled cash outs per spend per hour (asking again for a waiting one returns it). */
const SCHEDULE_PER_SPEND = 6;
/** Status reads per sender per minute (the app checks each job now and then). */
const STATUS_PER_MINUTE = 60;
const NO_STORE = { "Cache-Control": "no-store" };

const ID = /^[0-9a-f-]{36}$/;
const LATER_OFF = "Cashing out later is off right now. Cash out now instead.";

/** Without the shared store, an unknown job is not "gone": say the service is off, never "not found". */
function assertStoreReady() {
  if (!scheduledStoreReady()) throw new RelayError(LATER_OFF, 503, "later_off");
}

/** A job for its owner, with where it pays (the app shows that, not what it asked for). */
function owned(job: CashOutJob) {
  return { ...jobView(job), to: job.to };
}

/** The live job for this spend answered: the same cash out comes back, another one is refused. */
function answerExisting(job: CashOutJob, same: boolean) {
  if (same) return NextResponse.json({ ok: true, ...owned(job) }, { headers: NO_STORE });
  const error =
    job.status === "scheduled" && !job.attempts
      ? "Already scheduled to another address. Cancel it first."
      : "Already going out to another address.";
  return NextResponse.json({ ok: false, error, code: "already_scheduled", job: owned(job) }, { status: 409, headers: NO_STORE });
}

function fail(e: unknown) {
  if (e instanceof RelayError) {
    return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.status, headers: NO_STORE });
  }
  console.error("gloam_cashout_later", e);
  return NextResponse.json(
    { ok: false, error: "Could not schedule this cash out. Cash out now instead, or try again.", code: "internal" },
    { status: 500, headers: NO_STORE }
  );
}

/**
 * Schedule a cash out the relay sends later: the same body as a relayed cash
 * out ({ chainId, proof, root, nullifier, asset, to, amount }) plus
 * { window: "hour" | "6h" }. It is checked and dry-run now; the send time is
 * drawn at random inside the window. Returns { id, sendAfter, to }. Asking
 * again for the same spend returns the job already waiting; asking with
 * another address (or amount) is a 409 already_scheduled with that job.
 */
export async function POST(req: Request) {
  try {
    assertStoreReady();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new RelayError("Invalid request.");
    const window = body.window as DelayWindow;
    if (typeof window !== "string" || !Object.hasOwn(DELAY_WINDOWS, window)) {
      throw new RelayError("Pick within an hour or within 6 hours.");
    }
    const net = networkForChain(body.chainId);
    const ip = clientIp(req);
    await checkRateLimit(ip);
    if (!(await hitRateLimit(ip, "cashout-later", SCHEDULE_PER_HOUR, Date.now(), 3600)).allowed) {
      throw new RelayError("Too many scheduled cash outs from this device. Wait a while.", 429, "rate_limit");
    }

    const store = scheduledStore();
    const call = await checkUnshieldForLater(net, body);
    const [proof, root, nullifier, asset, to, amount] = call.args;
    const want = { to, asset, amount: amount.toString() };
    // One live job per spend: asking again for the same cash out returns the one
    // already waiting; one to another address (or amount) is refused.
    const existingId = await store.byNullifier(net.chainId, nullifier);
    const existing = existingId ? await store.get(existingId) : null;
    if (existing && isLive(existing.status)) return answerExisting(existing, sameCashOut(existing, want));
    const now = Date.now();
    if (!(await hitRateLimit(nullifier, "cashout-later-nf", SCHEDULE_PER_SPEND, now, 3600)).allowed) {
      throw new RelayError("This cash out was scheduled too many times. Wait a while.", 429, "rate_limit");
    }
    const job: CashOutJob = {
      id: randomUUID(),
      chainId: net.chainId,
      proof,
      root,
      nullifier,
      asset,
      to,
      amount: amount.toString(),
      createdAt: now,
      sendAfter: drawSendAfter(now, window),
      status: "scheduled",
      attempts: 0,
      updatedAt: now,
    };
    // Saved in one step; a request for the same spend at the same moment gets this one back.
    const saved = await scheduleJob(store, job);
    if (saved.outcome !== "created") return answerExisting(saved.job, saved.outcome === "existing");
    return NextResponse.json({ ok: true, ...owned(job) }, { headers: NO_STORE });
  } catch (e) {
    return fail(e);
  }
}

/** Where a scheduled cash out stands: ?id=<job id>. No proof or inputs come back. */
export async function GET(req: Request) {
  try {
    assertStoreReady();
    const ip = clientIp(req);
    if (!(await hitRateLimit(ip, "cashout-later-status", STATUS_PER_MINUTE, Date.now(), 60)).allowed) {
      throw new RelayError("Too many checks. Wait a minute.", 429, "rate_limit");
    }
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!ID.test(id)) throw new RelayError("Unknown cash out.", 400);
    const job = await scheduledStore().get(id);
    if (!job) return NextResponse.json({ ok: false, error: "Unknown cash out.", code: "not_found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true, ...jobView(job) }, { headers: NO_STORE });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Cancel a scheduled cash out that has not gone out: ?id=<job id>. The money
 * stays in the vault. Refused ({ ok: false, status: "sending" }) once a run
 * has reached the send.
 */
export async function DELETE(req: Request) {
  try {
    assertStoreReady();
    const ip = clientIp(req);
    if (!(await hitRateLimit(ip, "cashout-later-status", STATUS_PER_MINUTE, Date.now(), 60)).allowed) {
      throw new RelayError("Too many requests. Wait a minute.", 429, "rate_limit");
    }
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!ID.test(id)) throw new RelayError("Unknown cash out.", 400);
    const status = await cancelJob(scheduledStore(), id, Date.now());
    if (status === null) return NextResponse.json({ ok: false, error: "Unknown cash out.", code: "not_found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: status === "cancelled", status }, { headers: NO_STORE });
  } catch (e) {
    return fail(e);
  }
}
