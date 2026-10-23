/**
 * Self-test: fresh proofs for waiting cash outs (lib/cashOutReprove).
 *
 * A waiting cash out's proof shows roughly when it was made (its root). While
 * the app is open it makes a fresh proof of the same cash out and the relay
 * swaps it into the same job. Covers when one is due (every so often, once
 * more in the last stretch, never within a minute of the send, never when the
 * vault has no newer root), what a swap changes on the note (only the mark's
 * root and time), and every way it can fail with the old proof kept: a refusal,
 * an unreachable relay, a failed proof, a slow proof, a mark that moved on, the
 * person proving something themselves, and another network. Plus scheduling
 * records the root only for a job made with this proof.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-cashout-reprove.mts
 */
import assert from "node:assert/strict";
import "./browser-shim.mjs";
import type { Address, Hex } from "viem";

const { LAST_STRETCH_MS, REFRESH_EVERY_MS, REPROVE_MIN_LEAD_MS, refreshWaitingProofs, reproveDue } = await import(
  "../src/lib/cashOutReprove"
);
const { scheduleNoteCashOut } = await import("../src/lib/cashOutLater");
const { saveLocalNote } = await import("../src/lib/shield");
const { getAllNotes } = await import("../src/lib/noteVault");
const { getActiveNetwork } = await import("../src/lib/networks");
type LocalNote = import("../src/lib/shield").LocalNote;
type CashOutMark = import("../src/lib/shield").CashOutMark;
type ReproveEnv = import("../src/lib/cashOutReprove").ReproveEnv;
type CashOutCall = import("../src/lib/cashOutProof").CashOutCall;
type ReplaceProofResult = import("../src/lib/cashOutLater").ReplaceProofResult;
type PoseidonMerklePath = import("../src/lib/merklePoseidon").PoseidonMerklePath;

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const ASSET = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as Address;
const TO = "0x1111111111111111111111111111111111111111" as Address;
const hex32 = (n: number | bigint) => `0x${BigInt(n).toString(16).padStart(64, "0")}` as Hex;
const OLD_ROOT = hex32(0x100);
const NEW_ROOT = hex32(0x200);

const mark = (over: Partial<CashOutMark> = {}): CashOutMark => ({
  job: "job",
  at: T0 + 3 * 3_600_000,
  to: TO,
  state: "scheduled",
  root: OLD_ROOT,
  provenAt: T0 - 30 * MIN,
  ...over,
});

// ---------------------------------------------------------------- when it is due

await test("due every so often while waiting, against a newer root", () => {
  assert.equal(reproveDue(mark(), T0, NEW_ROOT), true);
  assert.equal(reproveDue(mark({ provenAt: T0 - REFRESH_EVERY_MS + 1 }), T0, NEW_ROOT), false, "renewed a moment ago");
  assert.equal(reproveDue(mark({ provenAt: T0 - REFRESH_EVERY_MS }), T0, NEW_ROOT), true);
  assert.equal(reproveDue(mark({ provenAt: undefined, root: undefined }), T0, NEW_ROOT), true, "an older mark knows neither: due");
  assert.equal(reproveDue(mark({ root: NEW_ROOT }), T0, NEW_ROOT), false, "the vault has not moved: same root");
  assert.equal(reproveDue(mark({ root: NEW_ROOT.toUpperCase().replace("0X", "0x") as Hex }), T0, NEW_ROOT), false, "case");
  assert.equal(reproveDue(mark(), T0, null), true, "root not known here: still renewed");
  for (const state of ["sent", "expired", "failed", "cancelled"] as const) assert.equal(reproveDue(mark({ state }), T0, NEW_ROOT), false, state);
});

await test("once more in the last stretch before the send, never within a minute of it", () => {
  const at = T0 + 10 * MIN;
  // proven before the stretch began: due once now, even if renewed recently
  assert.equal(reproveDue(mark({ at, provenAt: at - LAST_STRETCH_MS - 1 }), T0, NEW_ROOT), true);
  assert.equal(reproveDue(mark({ at, provenAt: T0 - 2 * MIN - (LAST_STRETCH_MS - 10 * MIN) }), T0, NEW_ROOT), true);
  // already renewed inside the stretch: not again
  assert.equal(reproveDue(mark({ at, provenAt: at - LAST_STRETCH_MS + 1 }), T0, NEW_ROOT), false);
  // under a minute away, or past: never
  assert.equal(reproveDue(mark({ at: T0 + REPROVE_MIN_LEAD_MS - 1, provenAt: 0 }), T0, NEW_ROOT), false);
  assert.equal(reproveDue(mark({ at: T0 - 1, provenAt: 0 }), T0, NEW_ROOT), false);
  assert.equal(reproveDue(mark({ at: T0 + REPROVE_MIN_LEAD_MS, provenAt: 0 }), T0, NEW_ROOT), true, "exactly a minute: still");
});

// ---------------------------------------------------------------- a run

const net = getActiveNetwork();
let seq = 0;
function waiting(over: Partial<CashOutMark> = {}, note: Partial<LocalNote> = {}): LocalNote {
  seq++;
  const n: LocalNote = {
    id: `rp-${seq}`,
    chainId: net.chainId,
    pool: net.pool!,
    asset: ASSET,
    amountWei: "5000000",
    commitment: hex32(0x1000 + seq),
    secret: hex32(0x2000 + seq),
    nullifier: hex32(0x3000 + seq),
    createdAt: T0,
    bound: true,
    scheme: "poseidon",
    status: "open",
    source: "local",
    cashOut: mark({ job: `job-${seq}`, ...over }),
    ...note,
  };
  saveLocalNote(n);
  return n;
}
const byId = (id: string) => getAllNotes().find((n) => n.id === id)!;
/** Only this test's notes are left waiting: earlier ones are moved off the board. */
function clearBoard() {
  for (const n of getAllNotes()) if (n.cashOut?.state === "scheduled") saveLocalNote({ ...n, cashOut: { ...n.cashOut, state: "sent" } });
}

type Fake = {
  env: ReproveEnv;
  proved: string[];
  replaced: { job: string; call: CashOutCall }[];
  clock: { now: number };
};
function fake(over: Partial<ReproveEnv> = {}, answer?: (job: string, call: CashOutCall) => ReplaceProofResult | Promise<ReplaceProofResult>): Fake {
  const clock = { now: T0 };
  const proved: string[] = [];
  const replaced: { job: string; call: CashOutCall }[] = [];
  const env: ReproveEnv = {
    chainId: net.chainId,
    pool: net.pool!,
    now: () => clock.now,
    pathOf: async () => ({ leafIndex: 1, leaf: 1n, pathElements: [], pathIndices: [], root: BigInt(NEW_ROOT) }) as PoseidonMerklePath,
    prove: async (n, to, path, chainId) => {
      proved.push(n.id);
      return { chainId, proof: "0xabcd" as Hex, root: hex32(path.root), nullifier: n.nullifier!, asset: n.asset, to, amount: BigInt(n.amountWei) };
    },
    replace: async (job, call) => {
      replaced.push({ job, call });
      if (answer) return answer(job, call);
      return { status: "replaced", job: { id: job, chainId: call.chainId, sendAfter: byJob(job).cashOut!.at, status: "scheduled", updatedAt: clock.now, to: call.to } };
    },
    busy: () => false,
    ...over,
  };
  return { env, proved, replaced, clock };
}
const byJob = (job: string) => getAllNotes().find((n) => n.cashOut?.job === job)!;

await test("a waiting cash out gets a fresh proof of the same cash out: only the mark's root and time change", async () => {
  clearBoard();
  const n = waiting();
  const f = fake();
  const out = await refreshWaitingProofs(f.env);
  assert.deepEqual(out, { replaced: 1, kept: 0, skipped: 0 });
  assert.equal(f.replaced.length, 1);
  const { job, call } = f.replaced[0]!;
  assert.equal(job, n.cashOut!.job, "the same job");
  assert.deepEqual([call.to, call.amount, call.asset, call.nullifier], [TO, 5_000_000n, ASSET, n.nullifier], "the same cash out");
  const after = byId(n.id).cashOut!;
  assert.deepEqual(after, { ...n.cashOut!, root: NEW_ROOT, provenAt: T0 }, "same job, time, address and state");
  assert.equal(byId(n.id).status, "open");
  // run again at once: the vault has not moved, nothing to do
  const again = fake();
  assert.deepEqual(await refreshWaitingProofs(again.env), { replaced: 0, kept: 0, skipped: 1 });
  assert.equal(again.proved.length, 0, "no proof made for nothing");
});

await test("soonest first, and several in one run, each its own job", async () => {
  clearBoard();
  const later = waiting({ at: T0 + 5 * 3_600_000 });
  const sooner = waiting({ at: T0 + 2 * 3_600_000 });
  const f = fake();
  assert.equal((await refreshWaitingProofs(f.env)).replaced, 2);
  assert.deepEqual(f.proved, [sooner.id, later.id]);
  assert.deepEqual(f.replaced.map((r) => r.job), [sooner.cashOut!.job, later.cashOut!.job]);
});

await test("a refused swap keeps the old proof, and the job is not asked again for a while", async () => {
  clearBoard();
  const n = waiting();
  const before = byId(n.id).cashOut!;
  const f = fake({}, () => ({ status: "kept", code: "busy" }));
  assert.deepEqual(await refreshWaitingProofs(f.env), { replaced: 0, kept: 1, skipped: 0 });
  assert.deepEqual(byId(n.id).cashOut, before);
  const again = fake();
  again.clock.now = T0 + REFRESH_EVERY_MS - 1;
  assert.equal((await refreshWaitingProofs(again.env)).replaced, 0, "not asked again so soon");
  assert.equal(again.proved.length, 0);
  again.clock.now = T0 + REFRESH_EVERY_MS;
  assert.equal((await refreshWaitingProofs(again.env)).replaced, 1, "later it is");
});

await test("a relay that can't be asked stops the run with every old proof kept", async () => {
  clearBoard();
  const a = waiting();
  const b = waiting({ at: a.cashOut!.at + MIN });
  const f = fake({}, () => null);
  assert.deepEqual(await refreshWaitingProofs(f.env), { replaced: 0, kept: 0, skipped: 0 });
  assert.equal(f.replaced.length, 1, "stopped after the first");
  assert.deepEqual([byId(a.id).cashOut, byId(b.id).cashOut], [a.cashOut, b.cashOut]);
  const thrown = fake({ replace: async () => Promise.reject(new Error("offline")) });
  assert.equal((await refreshWaitingProofs(thrown.env)).replaced, 0);
  assert.deepEqual(byId(a.id).cashOut, a.cashOut);
});

await test("a failed or slow proof hands nothing in; the old proof stays", async () => {
  clearBoard();
  const n = waiting({ at: T0 + 10 * MIN, provenAt: 0 });
  const failing = fake({ prove: async () => Promise.reject(new Error("prover crashed")) });
  assert.deepEqual(await refreshWaitingProofs(failing.env), { replaced: 0, kept: 0, skipped: 1 });
  assert.equal(failing.replaced.length, 0);
  // the proof took long enough that the send is now under a minute away
  const slow = fake();
  const prove = slow.env.prove;
  slow.env.prove = async (...args) => {
    slow.clock.now = n.cashOut!.at - REPROVE_MIN_LEAD_MS + 1;
    return prove(...args);
  };
  assert.deepEqual(await refreshWaitingProofs(slow.env), { replaced: 0, kept: 0, skipped: 1 });
  assert.equal(slow.replaced.length, 0);
  assert.deepEqual(byId(n.id).cashOut, n.cashOut);
});

await test("a mark that moved on while proving is left as it is now", async () => {
  clearBoard();
  const n = waiting();
  const f = fake({}, (job, call) => {
    // cancelled in another tab while this one was proving
    saveLocalNote({ ...byId(n.id), cashOut: { ...byId(n.id).cashOut!, state: "cancelled" } });
    return { status: "replaced", job: { id: job, chainId: call.chainId, sendAfter: n.cashOut!.at, status: "scheduled", updatedAt: T0, to: TO } };
  });
  await refreshWaitingProofs(f.env);
  assert.equal(byId(n.id).cashOut!.state, "cancelled");
  assert.equal(byId(n.id).cashOut!.root, OLD_ROOT, "not overwritten with a waiting mark");
});

await test("never while the person is proving something, never another network's, never under a minute away", async () => {
  clearBoard();
  waiting();
  const busy = fake({ busy: () => true });
  assert.deepEqual(await refreshWaitingProofs(busy.env), { replaced: 0, kept: 0, skipped: 0 });
  assert.equal(busy.proved.length, 0);
  clearBoard();
  waiting({}, { chainId: 999 });
  waiting({ at: T0 + 30_000 });
  const f = fake();
  const out = await refreshWaitingProofs(f.env);
  assert.equal(out.replaced, 0);
  assert.equal(f.proved.length, 0);
  // no vault on this network: nothing at all
  assert.deepEqual(await refreshWaitingProofs(fake({ pool: null }).env), { replaced: 0, kept: 0, skipped: 0 });
});

await test("one run at a time in a tab", async () => {
  clearBoard();
  waiting();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = fake({ prove: async (n, to, path, chainId) => (await gate, { chainId, proof: "0x01" as Hex, root: NEW_ROOT, nullifier: n.nullifier!, asset: n.asset, to, amount: BigInt(n.amountWei) }) });
  const a = refreshWaitingProofs(f.env);
  const b = refreshWaitingProofs(fake().env);
  assert.equal(a, b, "the second call joins the first");
  release();
  assert.equal((await a).replaced, 1);
});

// ---------------------------------------------------------------- scheduling records the root

await test("scheduling records the proof's root for a job made with it, not for one already waiting", async () => {
  const replies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const reply = replies.shift() ?? {};
    return new Response(
      JSON.stringify({ ok: true, id: "00000000-0000-4000-8000-000000000001", chainId: body.chainId, sendAfter: T0 + 3_600_000, status: "scheduled", updatedAt: T0, to: body.to, ...reply }),
      { status: 200 }
    );
  }) as typeof fetch;
  const n = waiting({}, { cashOut: undefined });
  const call: CashOutCall = { chainId: net.chainId, proof: "0x01", root: NEW_ROOT, nullifier: n.nullifier!, asset: ASSET, to: TO, amount: 5_000_000n };
  await scheduleNoteCashOut(n, call, "6h");
  const made = byId(n.id).cashOut!;
  assert.equal(made.root, NEW_ROOT);
  assert.equal(typeof made.provenAt, "number");
  const m = waiting({}, { cashOut: undefined });
  replies.push({ existing: true });
  await scheduleNoteCashOut(m, { ...call, nullifier: m.nullifier! }, "6h");
  const existing = byId(m.id).cashOut!;
  assert.equal(existing.root, undefined, "the relay's proof is the one it was scheduled with");
  assert.equal(existing.provenAt, undefined);
});

console.log(`\n${passed} passed`);
