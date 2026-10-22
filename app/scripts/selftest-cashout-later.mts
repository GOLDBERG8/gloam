/**
 * Self-test: the private cash-out upgrade.
 *
 * Cash out later (lib/relay/scheduled): the cron's job runner against the
 * in-memory store and a fake chain. Covers a due job, one not due yet, a root
 * the vault forgot, a note already spent, a re-run after a send (never twice),
 * a send whose reply was lost, a relay holding the spend in flight, a refusal
 * that can never succeed, a passing failure and the give-up after it, an
 * unreadable node, another run holding the lock, cancelling, and that a job
 * done with drops its proof. Then the browser side: what each job status
 * means for the note (nextMark), and that a waiting cash out is out of the
 * balance while one that came back is spendable again.
 *
 * A different amount (lib/cashOutSplit): the recent-amount match, Round it,
 * and the rule for keeping the split's notes when the first step may have
 * gone out.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-cashout-later.mts
 */
import assert from "node:assert/strict";
import "./browser-shim.mjs";
import type { Address, Hex } from "viem";

const {
  DELAY_WINDOWS,
  GIVE_UP_AFTER_MS,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  SENDING_STALE_MS,
  cancelJob,
  drawSendAfter,
  jobView,
  memoryJobStore,
  runDueJobs,
} = await import("../src/lib/relay/scheduled");
const { nextMark } = await import("../src/lib/cashOutLater");
const { matchesRecentIncoming, roundDownToWhole, splitMaybeSent } = await import("../src/lib/cashOutSplit");
const { activeSpendableNotes, cashOutPending, saveLocalNote } = await import("../src/lib/shield");
const { getActiveNetwork } = await import("../src/lib/networks");
const { getAllNotes } = await import("../src/lib/noteVault");
const { RelaySubmitError } = await import("../src/lib/relay/client");
type CashOutJob = import("../src/lib/relay/scheduled").CashOutJob;
type ChainView = import("../src/lib/relay/scheduled").ChainView;
type LocalNote = import("../src/lib/shield").LocalNote;

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const T0 = 1_800_000_000_000;
const ASSET = "0x5fc5360d0400a0fd7f72d4d3ad5e65e8ee9cb3d4" as Address;
const TO = "0x1111111111111111111111111111111111111111" as Address;
const hex32 = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

let seq = 0;
function job(over: Partial<CashOutJob> = {}): CashOutJob {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`,
    chainId: 4663,
    proof: "0xabcdef",
    root: hex32(1000 + seq),
    nullifier: hex32(seq),
    asset: ASSET,
    to: TO,
    amount: "5000000",
    createdAt: T0 - 60_000,
    sendAfter: T0 - 1,
    status: "scheduled",
    attempts: 0,
    updatedAt: T0 - 60_000,
    ...over,
  };
}

class SendError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
  }
}

/** A chain and relay that follow the pool's rules: a nullifier is spent once, an old root is refused. */
function fakeChain() {
  const spent = new Set<string>();
  const known = new Set<string>();
  const sends: string[] = [];
  let clock = T0;
  let nextSend: ((j: CashOutJob) => Hex) | null = null;
  let readFails = false;
  return {
    spent,
    known,
    sends,
    set now(t: number) {
      clock = t;
    },
    get now() {
      return clock;
    },
    failNextSend(f: (j: CashOutJob) => Hex) {
      nextSend = f;
    },
    set readFails(v: boolean) {
      readFails = v;
    },
    deps: {
      now: () => clock,
      readChain: async (j: CashOutJob): Promise<ChainView> => {
        if (readFails) throw new Error("node down");
        return { spent: spent.has(j.nullifier), knownRoot: known.has(j.root) };
      },
      send: async (j: CashOutJob): Promise<Hex> => {
        sends.push(j.id);
        if (nextSend) {
          const f = nextSend;
          nextSend = null;
          return f(j);
        }
        if (spent.has(j.nullifier)) throw new SendError("already spent", "AlreadySpent");
        if (!known.has(j.root)) throw new SendError("unknown root", "UnknownRoot");
        spent.add(j.nullifier);
        return hex32(0xbeef);
      },
    },
  };
}

async function setup(...jobs: CashOutJob[]) {
  const store = memoryJobStore();
  const chain = fakeChain();
  for (const j of jobs) {
    await store.put(j);
    chain.known.add(j.root);
  }
  return { store, chain };
}

// ---------------------------------------------------------------- send time

await test("send time is drawn inside the window, never right away", () => {
  for (const w of ["hour", "6h"] as const) {
    const lo = drawSendAfter(T0, w, () => 0);
    const hi = drawSendAfter(T0, w, () => 0.999999999);
    assert.equal(lo, T0 + MIN_DELAY_MS);
    assert.ok(hi < T0 + DELAY_WINDOWS[w] && hi > T0 + DELAY_WINDOWS[w] - 1000);
    for (let i = 0; i < 500; i++) {
      const t = drawSendAfter(T0, w);
      assert.ok(t >= T0 + MIN_DELAY_MS && t < T0 + DELAY_WINDOWS[w]);
    }
  }
  assert.equal(DELAY_WINDOWS["6h"], MAX_DELAY_MS);
  assert.equal(MAX_DELAY_MS, 6 * 60 * 60 * 1000);
});

// ---------------------------------------------------------------- the runner

await test("a due job is sent once and recorded with its hash", async () => {
  const j = job();
  const { store, chain } = await setup(j);
  const out = await runDueJobs(store, chain.deps);
  assert.deepEqual(out, [{ id: j.id, status: "sent" }]);
  const after = (await store.get(j.id))!;
  assert.equal(after.status, "sent");
  assert.equal(after.hash, hex32(0xbeef));
  assert.equal(after.attempts, 1);
  assert.equal(after.proof, "0x", "a sent job drops its proof");
  assert.equal(chain.sends.length, 1);
});

await test("a job not due yet is left alone", async () => {
  const j = job({ sendAfter: T0 + 60_000 });
  const { store, chain } = await setup(j);
  assert.deepEqual(await runDueJobs(store, chain.deps), []);
  assert.equal((await store.get(j.id))!.status, "scheduled");
  assert.equal(chain.sends.length, 0);
  chain.now = T0 + 60_000;
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "sent" }]);
});

await test("a root the vault forgot expires the job and sends nothing", async () => {
  const j = job();
  const { store, chain } = await setup(j);
  chain.known.delete(j.root);
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "expired" }]);
  const after = (await store.get(j.id))!;
  assert.equal(after.proof, "0x");
  assert.ok(after.reason);
  assert.equal(chain.sends.length, 0);
});

await test("a note already spent elsewhere is marked spent, not sent", async () => {
  const j = job();
  const { store, chain } = await setup(j);
  chain.spent.add(j.nullifier);
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "spent" }]);
  assert.equal(chain.sends.length, 0);
});

await test("re-running after a send never sends again", async () => {
  const j = job();
  const { store, chain } = await setup(j);
  await runDueJobs(store, chain.deps);
  chain.now = T0 + 10 * 60_000;
  assert.deepEqual(await runDueJobs(store, chain.deps), []);
  // even if the record were put back in the queue by mistake
  await store.put({ ...(await store.get(j.id))!, status: "scheduled", proof: "0xabcdef" });
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "sent" }]);
  assert.equal(chain.sends.length, 1, "the chain read found it spent: no second send");
});

await test("a send that went out but lost its reply settles as sent from the chain", async () => {
  const j = job();
  const { store, chain } = await setup(j);
  chain.failNextSend((x) => {
    chain.spent.add(x.nullifier); // it landed
    throw new SendError("timeout", "rpc");
  });
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "scheduled" }]);
  chain.now = T0 + 60_000;
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "spent" }]);
  assert.equal(chain.sends.length, 1);
});

await test("a crash mid-send is read back from the chain, not sent twice", async () => {
  // the run died after marking "sending" and after the transaction went out
  const j = job({ status: "sending", attempts: 1, updatedAt: T0 - 1_000 });
  const { store, chain } = await setup(j);
  chain.spent.add(j.nullifier);
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "skipped" }], "fresh 'sending' is left to its run");
  chain.now = T0 + SENDING_STALE_MS + 1;
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "sent" }]);
  assert.equal(chain.sends.length, 0);
});

await test("a stale 'sending' that never went out is sent once", async () => {
  const j = job({ status: "sending", attempts: 1, updatedAt: T0 - SENDING_STALE_MS - 1 });
  const { store, chain } = await setup(j);
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "sent" }]);
  assert.equal(chain.sends.length, 1);
  assert.equal((await store.get(j.id))!.attempts, 2);
});

await test("a spend the relay holds in flight stays 'sending' and is read again later", async () => {
  const j = job();
  const { store, chain } = await setup(j);
  chain.failNextSend(() => {
    throw new SendError("already being sent", "in_flight");
  });
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "sending" }]);
  chain.now = T0 + 60_000;
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "skipped" }]);
  chain.now = T0 + SENDING_STALE_MS + 60_000;
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "sent" }]);
  assert.equal(chain.sends.length, 2);
});

await test("a refusal that can never succeed fails at once and drops the proof", async () => {
  for (const code of ["screened", "asset_policy", "vault_recipient", "InvalidProof"]) {
    const j = job();
    const { store, chain } = await setup(j);
    chain.failNextSend(() => {
      throw new SendError("refused", code);
    });
    assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "failed" }], code);
    assert.equal((await store.get(j.id))!.proof, "0x");
  }
});

await test("the relay's own spent / old-root answers settle the job", async () => {
  const a = job();
  const b = job();
  const { store, chain } = await setup(a, b);
  chain.failNextSend(() => {
    throw new SendError("spent", "AlreadySpent");
  });
  await runDueJobs(store, chain.deps, 1);
  assert.equal((await store.get(a.id))!.status, "spent");
  chain.failNextSend(() => {
    throw new SendError("old root", "UnknownRoot");
  });
  await runDueJobs(store, chain.deps, 1);
  assert.equal((await store.get(b.id))!.status, "expired");
});

await test("a passing failure retries, then gives up when long overdue", async () => {
  const j = job();
  const { store, chain } = await setup(j);
  chain.failNextSend(() => {
    throw new SendError("busy", "busy");
  });
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "scheduled" }]);
  assert.ok((await store.get(j.id))!.reason);
  chain.now = j.sendAfter + GIVE_UP_AFTER_MS + 1;
  chain.failNextSend(() => {
    throw new SendError("busy", "busy");
  });
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "failed" }]);
  assert.equal(chain.sends.length, 2);
});

await test("an unreadable node sends nothing and tries again", async () => {
  const j = job();
  const { store, chain } = await setup(j);
  chain.readFails = true;
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "scheduled" }]);
  chain.now = j.sendAfter + GIVE_UP_AFTER_MS + 1;
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "failed" }]);
  assert.equal(chain.sends.length, 0);
});

await test("a job another run holds is skipped", async () => {
  const j = job();
  const { store, chain } = await setup(j);
  const release = (await store.lock(j.id, 90))!;
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "skipped" }]);
  await release();
  assert.deepEqual(await runDueJobs(store, chain.deps), [{ id: j.id, status: "sent" }]);
});

await test("jobs go out oldest first, and a run stops taking new ones past its budget", async () => {
  const late = job({ sendAfter: T0 - 10 });
  const early = job({ sendAfter: T0 - 500 });
  const { store, chain } = await setup(late, early);
  const out = await runDueJobs(store, chain.deps);
  assert.deepEqual(out.map((r) => r.id), [early.id, late.id]);

  const a = job();
  const b = job();
  const s2 = await setup(a, b);
  let t = T0;
  const slow = { ...s2.chain.deps, now: () => (t += 30_000) };
  const out2 = await runDueJobs(s2.store, slow, 20, 40_000);
  assert.equal(out2.length, 1, "the second job waits for the next pass");
});

await test("a job record that is gone is taken out of the queue", async () => {
  const ghost = job();
  const { store, chain } = await setup(ghost);
  const forgot: string[] = [];
  const lost = {
    ...store,
    get: async () => null,
    forget: async (id: string) => {
      forgot.push(id);
      await store.forget(id);
    },
  };
  assert.deepEqual(await runDueJobs(lost, chain.deps), [{ id: ghost.id, status: "skipped" }]);
  assert.deepEqual(forgot, [ghost.id]);
  assert.deepEqual(await store.due(T0, 20), []);
  assert.equal(chain.sends.length, 0);
});

await test("one live job per spend", async () => {
  const j = job();
  const { store } = await setup(j);
  assert.equal(await store.byNullifier(4663, j.nullifier), j.id);
  assert.equal(await store.byNullifier(4663, j.nullifier.toUpperCase().replace("0X", "0x") as Hex), j.id);
  assert.equal(await store.byNullifier(4217, j.nullifier), null);
  await store.put({ ...j, status: "expired" });
  assert.equal(await store.byNullifier(4663, j.nullifier), null);
});

await test("cancel works only before it goes out", async () => {
  const j = job({ sendAfter: T0 + 60_000 });
  const { store, chain } = await setup(j);
  assert.equal(await cancelJob(store, j.id, T0), "cancelled");
  assert.equal((await store.get(j.id))!.proof, "0x");
  chain.now = T0 + 120_000;
  assert.deepEqual(await runDueJobs(store, chain.deps), []);
  assert.equal(chain.sends.length, 0);

  const k = job({ status: "sending" });
  await store.put(k);
  assert.equal(await cancelJob(store, k.id, T0), "sending");
  const held = (await store.lock(k.id, 30))!;
  assert.equal(await cancelJob(store, job().id, T0), null);
  assert.equal(await cancelJob(store, k.id, T0), "sending", "a held lock means a run is sending it");
  await held();
});

await test("what a person can read about a job holds no proof or inputs", async () => {
  const v = jobView(job({ hash: hex32(7), reason: "x" })) as Record<string, unknown>;
  assert.deepEqual(Object.keys(v).sort(), ["chainId", "hash", "id", "reason", "sendAfter", "status", "updatedAt"]);
});

// ---------------------------------------------------------------- the browser side

const mark = { job: "j", at: T0 + 1_000, to: TO, state: "scheduled" as const };
const view = (status: string, over: object = {}) =>
  ({ id: "j", chainId: 4663, sendAfter: T0 + 1_000, status, updatedAt: T0, ...over }) as never;

await test("nextMark: each job status for the note", () => {
  assert.equal(nextMark(mark, view("scheduled")), null);
  assert.deepEqual(nextMark(mark, view("scheduled", { sendAfter: T0 + 5_000 })), { ...mark, at: T0 + 5_000 });
  assert.equal(nextMark(mark, view("sending")), null);
  assert.deepEqual(nextMark(mark, view("sent")), { ...mark, state: "sent" });
  assert.deepEqual(nextMark(mark, view("spent")), { ...mark, state: "sent" });
  assert.deepEqual(nextMark(mark, view("expired")), { ...mark, state: "expired" });
  assert.deepEqual(nextMark(mark, view("failed")), { ...mark, state: "failed" });
  assert.deepEqual(nextMark(mark, view("cancelled")), { ...mark, state: "cancelled" });
  assert.deepEqual(nextMark(mark, "gone"), { ...mark, state: "failed" });
  // sent but the chain never showed the spend: back to the balance after a grace period
  const sentMark = { ...mark, state: "sent" as const };
  assert.equal(nextMark(sentMark, view("sent"), T0 + 60_000), null);
  assert.deepEqual(nextMark(sentMark, view("sent"), T0 + 31 * 60_000), { ...mark, state: "failed" });
});

await test("a waiting cash out is out of the balance; one that came back is spendable", () => {
  const net = getActiveNetwork();
  const base = {
    chainId: net.chainId,
    pool: net.pool!,
    asset: ASSET,
    amountWei: "5000000",
    createdAt: T0,
    bound: true,
    scheme: "poseidon" as const,
    status: "open" as const,
    source: "local" as const,
  };
  const n = (i: number, cashOut?: LocalNote["cashOut"]): LocalNote => ({
    ...base,
    id: `t-${i}`,
    commitment: hex32(500 + i),
    secret: hex32(600 + i),
    nullifier: hex32(700 + i),
    ...(cashOut ? { cashOut } : {}),
  });
  const notes = [
    n(1),
    n(2, { ...mark, state: "scheduled" }),
    n(3, { ...mark, state: "sent" }),
    n(4, { ...mark, state: "expired" }),
    n(5, { ...mark, state: "failed" }),
    n(6, { ...mark, state: "cancelled" }),
  ];
  for (const x of notes) saveLocalNote(x);
  assert.deepEqual(notes.map(cashOutPending), [false, true, true, false, false, false]);
  const ids = activeSpendableNotes(getAllNotes())
    .map((x) => x.id)
    .filter((id) => id.startsWith("t-"))
    .sort();
  assert.deepEqual(ids, ["t-1", "t-4", "t-5", "t-6"]);
});

// ---------------------------------------------------------------- a different amount

await test("Round it rounds down to whole units", () => {
  assert.equal(roundDownToWhole(12_345_678n, 6), 12_000_000n);
  assert.equal(roundDownToWhole(999_999n, 6), 0n);
  assert.equal(roundDownToWhole(5_000_000n, 6), 5_000_000n);
  assert.equal(roundDownToWhole(1_500_000_000_000_000_000n, 18), 1_000_000_000_000_000_000n);
});

await test("an amount within 1% of money that came in the last day is flagged", () => {
  const now = T0;
  const inc = (id: string, amountWei: string, ageMs: number, asset = ASSET) =>
    ({ id, amountWei, asset, createdAt: now - ageMs }) as LocalNote;
  const notes = [inc("dep-1", "100000000", 60_000)];
  assert.equal(matchesRecentIncoming(100_000_000n, notes, ASSET, now), true, "exact");
  assert.equal(matchesRecentIncoming(99_000_000n, notes, ASSET, now), true, "1% under");
  assert.equal(matchesRecentIncoming(101_000_000n, notes, ASSET, now), true, "1% over");
  assert.equal(matchesRecentIncoming(98_900_000n, notes, ASSET, now), false, "past 1%");
  assert.equal(matchesRecentIncoming(100_000_000n, notes, ASSET.toUpperCase(), now), true, "asset case");
  assert.equal(matchesRecentIncoming(100_000_000n, notes, TO, now), false, "another asset");
  assert.equal(matchesRecentIncoming(100_000_000n, [inc("dep-2", "100000000", 25 * 3_600_000)], ASSET, now), false, "older than a day");
  assert.equal(matchesRecentIncoming(100_000_000n, [inc("chg-1", "100000000", 60_000)], ASSET, now), false, "change is not money in");
  assert.equal(matchesRecentIncoming(100_000_000n, [inc("co-1", "100000000", 60_000)], ASSET, now), false, "own split is not money in");
  assert.equal(matchesRecentIncoming(0n, notes, ASSET, now), false);
});

await test("the split keeps its notes unless the first step surely never went out", () => {
  // through the relay: only a clear refusal means nothing went out
  for (const code of ["rpc", "network", "error", "internal", "in_flight"]) {
    assert.equal(splitMaybeSent(new RelaySubmitError("x", code), true), true, code);
  }
  for (const code of ["AlreadySpent", "UnknownRoot", "busy", "rate_limit", "relay_off", "screened"]) {
    assert.equal(splitMaybeSent(new RelaySubmitError("x", code), true), false, code);
  }
  assert.equal(splitMaybeSent(new Error("odd"), true), false, "not a relay answer: thrown before the relay was asked");
  // from the wallet: only a declined prompt or a failure before sending
  const declined = Object.assign(new Error("User rejected the request."), { name: "UserRejectedRequestError" });
  const reverted = Object.assign(new Error("would revert"), { name: "ContractFunctionRevertedError" });
  const timeout = Object.assign(new Error("request timed out"), { name: "TimeoutError" });
  assert.equal(splitMaybeSent(declined, false), false);
  assert.equal(splitMaybeSent(reverted, false), false);
  assert.equal(splitMaybeSent(timeout, false), true);
  assert.equal(splitMaybeSent(new Error("lost"), false), true);
});

console.log(`\n${passed} passed`);
