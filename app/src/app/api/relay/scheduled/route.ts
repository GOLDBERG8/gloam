import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import {
  DELAY_WINDOWS,
  REPROVE_MIN_LEAD_MS,
  cancelJob,
  drawSendAfter,
  isLive,
  jobView,
  replaceJobProof,
  sameCashOut,
  scheduleJob,
  type CashOutJob,
  type DelayWindow,
  type ReplaceRefusal,
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
/** Newer proofs handed in per sender per hour, and per job (the app renews each waiting one now and then). */
const REPROVE_PER_HOUR = 60;
const REPROVE_PER_JOB = 6;
/** Why a newer proof was not taken. The old one stays, so the cash out goes out as scheduled either way. */
const REPLACE_REFUSED: Record<ReplaceRefusal, [number, string]> = {
  not_found: [404, "Unknown cash out."],
  not_live: [409, "This cash out is no longer waiting, so its proof stays as it is."],
  too_late: [409, "This cash out goes out in under a minute, so its proof stays as it is."],
  mismatch: [409, "A newer proof must pay the same amount to the same address from the same balance."],
  busy: [409, "The relay is working on this cash out right now. Its proof stays as it is."],
};
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
  // existing: the job already waiting, with the proof it was scheduled with (not the one just sent).
  if (same) return NextResponse.json({ ok: true, existing: true, ...owned(job) }, { headers: NO_STORE });
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
 * { window: "hour" | "6h" | "day" }. It is checked and dry-run now; the send time is
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
      throw new RelayError("Pick within an hour, 6 hours or a day.");
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

function refused(code: ReplaceRefusal) {
  const [status, error] = REPLACE_REFUSED[code];
  return NextResponse.json({ ok: false, error, code }, { status, headers: NO_STORE });
}

/**
 * A newer proof for a waiting cash out: ?id=<job id>, with the same body as
 * scheduling it ({ chainId, proof, root, nullifier, asset, to, amount }). A
 * proof shows roughly when it was made (its root), so the app swaps in a fresh
 * one while it is open. Taken only for the same spend, recipient, amount and
 * asset, while the job is still waiting untouched and more than a minute from
 * its send time, and only after the same checks and dry run as scheduling.
 * The job keeps its id and send time; nothing new is created. Returns the job
 * as { id, sendAfter, to }; a refusal leaves the old proof in place.
 */
export async function PATCH(req: Request) {
  try {
    assertStoreReady();
    const ip = clientIp(req);
    await checkRateLimit(ip);
    if (!(await hitRateLimit(ip, "cashout-later-reprove", REPROVE_PER_HOUR, Date.now(), 3600)).allowed) {
      throw new RelayError("Too many proof updates from this device. Wait a while.", 429, "rate_limit");
    }
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!ID.test(id)) throw new RelayError("Unknown cash out.", 400);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new RelayError("Invalid request.");
    const net = networkForChain(body.chainId);
    const store = scheduledStore();
    // Refused before the dry run when it could never be taken (checked again under the job's lock).
    const before = await store.get(id);
    if (!before) return refused("not_found");
    if (before.status !== "scheduled" || before.attempts > 0 || before.maybeSent) return refused("not_live");
    if (before.sendAfter - Date.now() < REPROVE_MIN_LEAD_MS) return refused("too_late");
    if (!(await hitRateLimit(id, "cashout-later-reprove-job", REPROVE_PER_JOB, Date.now(), 3600)).allowed) {
      throw new RelayError("This cash out's proof was updated too many times. Wait a while.", 429, "rate_limit");
    }
    // Everything scheduling checks: the recipient, screening, an unspent note, a known root, and the dry run.
    const call = await checkUnshieldForLater(net, body);
    const [proof, root, nullifier, asset, to, amount] = call.args;
    const r = await replaceJobProof(
      store,
      id,
      { chainId: net.chainId, proof, root, nullifier, asset, to, amount: amount.toString() },
      Date.now()
    );
    if (!r.ok) return refused(r.code);
    return NextResponse.json({ ok: true, ...owned(r.job) }, { headers: NO_STORE });
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
