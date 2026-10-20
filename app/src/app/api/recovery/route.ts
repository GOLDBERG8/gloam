import { NextResponse } from "next/server";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import { KvUnavailableError } from "@/lib/partnersKv";
import { RecoveryError, backupExists, deleteBackup, isHex64, readBackup, writeBackup } from "@/lib/recoveryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Requests per IP per minute. */
const RATE_LIMIT = 60;
/**
 * New backups per IP per day. A person makes one per sign-in method; each can
 * hold about 500 KB, so this keeps the store from being filled with junk.
 */
// per IP, and mobile carriers put many people behind one address
const NEW_BACKUPS_PER_DAY = 50;
const MAX_BODY = 600_000;

function fail(status: number, message: string, headers?: HeadersInit) {
  return NextResponse.json({ ok: false, error: { message } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function ok(data: unknown) {
  return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
}

async function limited(req: Request) {
  const rate = await hitRateLimit(clientIp(req), "recovery", RATE_LIMIT);
  return rate.allowed ? null : fail(429, "Too many tries. Wait a minute.", { "Retry-After": String(rate.retryAfterSec) });
}

function handle(e: unknown) {
  if (e instanceof RecoveryError) return fail(e.status, e.message);
  if (e instanceof KvUnavailableError) return fail(503, "Backups are paused for a moment. Try again shortly.");
  return fail(500, "The backup service failed. Try again.");
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Fetch an encrypted backup by its id. The ciphertext is useless without the key. */
export async function GET(req: Request) {
  const blocked = await limited(req);
  if (blocked) return blocked;
  const id = new URL(req.url).searchParams.get("id");
  if (!isHex64(id)) return fail(400, "Bad backup id.");
  try {
    const backup = await readBackup(id);
    if (!backup) return fail(404, "No backup found.");
    return ok(backup);
  } catch (e) {
    return handle(e);
  }
}

/** Save or replace an encrypted backup. */
export async function PUT(req: Request) {
  const blocked = await limited(req);
  if (blocked) return blocked;
  const body = await readBody(req);
  if (!body) return fail(400, "Bad request.");
  const { id, write, c, n } = body;
  if (!isHex64(id) || !isHex64(write)) return fail(400, "Bad backup id.");
  try {
    if (!(await backupExists(id))) {
      const daily = await hitRateLimit(clientIp(req), "recovery-new", NEW_BACKUPS_PER_DAY, Date.now(), 86_400);
      if (!daily.allowed) {
        return fail(429, "Too many new backups from this connection today. Try again tomorrow.", {
          "Retry-After": String(daily.retryAfterSec),
        });
      }
    }
    return ok(await writeBackup({ id, write, c: c as string, n: Number(n) }));
  } catch (e) {
    return handle(e);
  }
}

/** Delete an encrypted backup. */
export async function DELETE(req: Request) {
  const blocked = await limited(req);
  if (blocked) return blocked;
  const body = await readBody(req);
  if (!body) return fail(400, "Bad request.");
  const { id, write } = body;
  if (!isHex64(id) || !isHex64(write)) return fail(400, "Bad backup id.");
  try {
    await deleteBackup(id, write);
    return ok({ deleted: true });
  } catch (e) {
    return handle(e);
  }
}
