/**
 * Self-test: the recovery backup as this browser keeps it (lib/recovery),
 * against a stand-in /api/recovery.
 *
 *  - "Turn off and delete" while a save is on its way: the delete waits for
 *    the save, so the backup stays deleted and recovery stays off (before the
 *    fix the save could land after the delete and bring both back)
 *  - a note saved while it turns off, or after, starts no save
 *  - a delete that fails leaves recovery on, still saving
 *
 * Runs the app's own storage code with an in-memory localStorage and
 * IndexedDB. Nothing leaves the process.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-recovery-sync.mts
 */
import assert from "node:assert/strict";
import { localStorage } from "./browser-shim.mjs";
import type { LocalNote } from "../src/lib/shield";

const win = globalThis.window as unknown as Record<string, unknown>;
win.setTimeout = setTimeout;
win.clearTimeout = clearTimeout;

// The stand-in backup service: GET, PUT and DELETE on /api/recovery.
const backups = new Map<string, { c: string; n: number; t: number }>();
const log: string[] = [];
let holdPut: Promise<void> | null = null;
let failDelete = false;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  if (method === "GET") {
    const id = new URL(String(url), "https://gloam.trade").searchParams.get("id")!;
    const b = backups.get(id);
    return b ? Response.json({ data: b }) : Response.json({ error: { message: "none" } }, { status: 404 });
  }
  const body = JSON.parse(String(init!.body)) as { id: string; c?: string; n?: number };
  if (method === "PUT") {
    log.push("put sent");
    if (holdPut) await holdPut;
    const t = Date.now();
    backups.set(body.id, { c: body.c!, n: body.n!, t });
    log.push("put saved");
    return Response.json({ data: { n: body.n, t } });
  }
  if (method === "DELETE") {
    log.push("delete");
    if (failDelete) return Response.json({ error: { message: "The backup service failed." } }, { status: 500 });
    backups.delete(body.id);
    return Response.json({ ok: true });
  }
  throw new Error(`unexpected ${method}`);
}) as typeof fetch;

const recovery = await import("../src/lib/recovery");
const vault = await import("../src/lib/noteVault");
const { connectRecovery, backupNow, turnOffRecovery, recoveryState, keysFromSecret } = recovery;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 200 && !ok(); i++) await sleep(10);
  assert.ok(ok(), what);
}
const saveANote = (id: string) =>
  vault.setAllNotes([
    ...vault.getAllNotes(),
    { id, secret: `0x${"11".repeat(31)}`, status: "open" } as unknown as LocalNote,
  ]);

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const keys = await keysFromSecret("wallet", crypto.getRandomValues(new Uint8Array(32)));

await test("turn off and delete waits for the save on its way, and the backup stays gone", async () => {
  await connectRecovery(keys, null);
  assert.ok(backups.has(keys.id) && recoveryState().on, "on, with a backup");

  let release!: () => void;
  holdPut = new Promise((r) => (release = r));
  const saving = backupNow();
  await until(() => log.at(-1) === "put sent", "a save is on its way");
  const off = turnOffRecovery({ deleteBackup: true });
  // a note saved meanwhile starts nothing
  saveANote("n-during");
  await sleep(50);
  assert.equal(log.at(-1), "put sent", "the delete waits for the save");
  release();
  await off;
  await saving;
  holdPut = null;
  assert.deepEqual(log.slice(-3), ["put sent", "put saved", "delete"], "save, then delete");
  assert.equal(backups.has(keys.id), false, "the backup stays deleted");
  assert.equal(recoveryState().on, false, "recovery stays off");
  assert.equal(localStorage.getItem("gloam.recovery.v1"), null, "and its settings are gone from this browser");
});

await test("after turning off, nothing saves again", async () => {
  const before = log.length;
  saveANote("n-after");
  await backupNow();
  await sleep(2_700); // past the 2.5 s a change waits before it is saved
  assert.equal(log.length, before, "no save");
  assert.equal(backups.has(keys.id), false);
  assert.equal(recoveryState().on, false);
});

await test("a delete that fails leaves recovery on, and it keeps saving", async () => {
  await connectRecovery(keys, null);
  assert.ok(backups.has(keys.id) && recoveryState().on);
  failDelete = true;
  await assert.rejects(turnOffRecovery({ deleteBackup: true }), /backup service failed/);
  failDelete = false;
  assert.ok(recoveryState().on, "still on");
  const before = log.filter((l) => l === "put saved").length;
  await backupNow();
  assert.equal(log.filter((l) => l === "put saved").length, before + 1, "still saving");
  await turnOffRecovery({ deleteBackup: true });
  assert.equal(backups.has(keys.id), false);
});

console.log(`\nrecovery sync: ${passed} passed`);
