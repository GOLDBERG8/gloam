/**
 * Self-test: the note store (lib/noteVault) never loses a note it was asked to
 * keep. Review findings 2 and 3, 23 Oct 2026:
 *   2. a save the browser refuses (storage full, private mode) rejects, so a
 *      deposit waiting on it is never sent; a write that doesn't read back the
 *      same counts as refused too.
 *   3. two tabs saving at once both keep their notes, with and without Web
 *      Locks; a note one tab removed is not brought back by the other, a note
 *      one tab spent is not reopened by the other's stale copy, and a sync
 *      from disk never drops a note still waiting to be written.
 * Each "tab" is its own copy of the module (its own memory) over one shared
 * localStorage and IndexedDB, like two tabs of one browser.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-note-vault.mts
 */
import assert from "node:assert/strict";
import { localStorage, resetBrowser } from "./browser-shim.mjs";

type Vault = typeof import("../src/lib/noteVault");
type LocalNote = import("../src/lib/shield").LocalNote;

let tabs = 0;
/** A fresh tab: its own module memory, the shared storage. */
async function openTab(): Promise<Vault> {
  const v = (await import(`../src/lib/noteVault.ts?tab=${++tabs}`)) as Vault;
  await v.unlockNoteVault();
  return v;
}

const note = (id: string): LocalNote =>
  ({
    id,
    chainId: 4663,
    pool: "0x39e28cde55cab798874746ac52cb4b5cc99a0194",
    asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    amountWei: "1000000",
    commitment: `0x${id.padStart(64, "0")}`,
    secret: `0x${"ab".repeat(31)}${id.length.toString(16).padStart(2, "0")}`,
    nullifier: "0x",
    bound: true,
    scheme: "poseidon",
    createdAt: 1,
    status: "open",
    source: "local",
  }) as unknown as LocalNote;

const ids = (v: Vault) => v.getAllNotes().map((n) => n.id).sort();

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  resetBrowser();
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const g = globalThis as { navigator?: unknown };

/** A Web Locks stand-in: one holder per name at a time, in order. */
function installLocks() {
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request<T>(name: string, fn: () => Promise<T>): Promise<T> {
          const prev = queues.get(name) ?? Promise.resolve();
          const run = prev.then(fn, fn);
          queues.set(name, run.catch(() => undefined));
          return run;
        },
      },
    },
  });
}
function removeLocks() {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: undefined });
}

await test("a save the browser refuses rejects, and the deposit waiting on it is never sent", async () => {
  const tab = await openTab();
  await tab.setAllNotes([note("kept")]);
  const realSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (k: string, v: string) => {
    if (k === tab.NOTES_KEY) throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
    realSet(k, v);
  };
  let sent = false;
  const deposit = async () => {
    await tab.setAllNotes([note("new"), ...tab.getAllNotes()]);
    sent = true; // stands in for the wallet prompt
  };
  await assert.rejects(deposit(), (e: unknown) => e instanceof tab.NoteSaveError && /Free up some space/.test((e as Error).message));
  assert.equal(sent, false, "nothing is sent");
  localStorage.setItem = realSet;
  const reloaded = await openTab();
  assert.deepEqual(ids(reloaded), ["kept"], "the older note is still on disk");
});

await test("a write that doesn't read back the same counts as refused", async () => {
  const tab = await openTab();
  const realSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (k: string, v: string) => {
    if (k !== tab.NOTES_KEY) realSet(k, v); // silently dropped
  };
  await assert.rejects(tab.setAllNotes([note("lost")]), (e: unknown) => e instanceof tab.NoteSaveError);
  localStorage.setItem = realSet;
});

for (const locks of [true, false]) {
  const how = locks ? "with Web Locks" : "without Web Locks (re-read before write)";
  await test(`two tabs saving at once both keep their notes, ${how}`, async () => {
    if (locks) installLocks();
    else removeLocks();
    const a = await openTab();
    const b = await openTab();
    await Promise.all([a.setAllNotes([note("from-a")]), b.setAllNotes([note("from-b")])]);
    const fresh = await openTab();
    assert.deepEqual(ids(fresh), ["from-a", "from-b"], "both notes survive a reload");
    // each tab also sees the other's note after its own write
    await a.setAllNotes([...a.getAllNotes(), note("a-2")]);
    assert.ok(ids(a).includes("from-b"));
    const again = await openTab();
    assert.deepEqual(ids(again), ["a-2", "from-a", "from-b"]);
    removeLocks();
  });
}

await test("a note one tab removed is not brought back by another tab's save", async () => {
  installLocks();
  const a = await openTab();
  const b = await openTab();
  await a.setAllNotes([note("unsent"), note("keep")]);
  await b.setAllNotes([...b.getAllNotes(), note("b-1")]);
  assert.ok(ids(b).includes("unsent"), "b picked it up");
  await a.setAllNotes(a.getAllNotes().filter((n) => n.id !== "unsent")); // e.g. dropUnsentNote
  await b.setAllNotes([...b.getAllNotes(), note("b-2")]); // b still holds the old copy in memory
  const fresh = await openTab();
  assert.deepEqual(ids(fresh), ["b-1", "b-2", "keep"]);
  // saving it again on purpose brings it back
  await a.setAllNotes([...a.getAllNotes(), note("unsent")]);
  assert.ok(ids(await openTab()).includes("unsent"));
  removeLocks();
});

await test("a note another tab marked spent is not reopened by this tab's stale copy", async () => {
  installLocks();
  const a = await openTab();
  const b = await openTab();
  await a.setAllNotes([note("x")]);
  await b.setAllNotes([...b.getAllNotes(), note("b-1")]);
  assert.equal(b.getAllNotes().find((n) => n.id === "x")?.status, "open", "b holds x as open");
  // a spends x (payroll, a send): only a knows yet
  await a.setAllNotes(a.getAllNotes().map((n) => (n.id === "x" ? { ...n, status: "recovered" as const } : n)));
  await b.setAllNotes([...b.getAllNotes(), note("b-2")]);
  const fresh = await openTab();
  assert.equal(fresh.getAllNotes().find((n) => n.id === "x")?.status, "recovered", "still spent on disk");
  assert.equal(b.getAllNotes().find((n) => n.id === "x")?.status, "recovered", "and b now knows");
  // a change b makes itself still wins
  await b.setAllNotes(b.getAllNotes().map((n) => (n.id === "b-1" ? { ...n, leafIndex: 7 } : n)));
  assert.equal((await openTab()).getAllNotes().find((n) => n.id === "b-1")?.leafIndex, 7);
  removeLocks();
});

await test("a sync from another tab while a save waits never drops the new note", async () => {
  installLocks();
  const a = await openTab();
  const b = await openTab();
  await b.setAllNotes([note("from-b")]);
  // hold the write lock, so a's save waits while a re-reads the disk
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const held = (globalThis.navigator as unknown as { locks: { request: (n: string, f: () => Promise<void>) => Promise<void> } }).locks.request(
    "gloam-notes-write",
    () => gate
  );
  const saving = a.setAllNotes([...a.getAllNotes(), note("deposit")]);
  await a.syncFromDisk(); // the storage event from b's write
  assert.deepEqual(ids(a), ["deposit", "from-b"], "the unsaved note stays in memory");
  release();
  await held;
  await saving;
  assert.deepEqual(ids(await openTab()), ["deposit", "from-b"], "and reaches the disk");
  removeLocks();
});

console.log(`\nnote vault: ${passed} passed`);
void g;
