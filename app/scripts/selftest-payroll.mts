/**
 * Self-test: the payroll engine (lib/payroll) never writes off a payment that
 * could still land, and only calls a row paid when the pool holds that row's
 * own payment.
 *
 * Runs the app's own engine, note store and run store against an in-memory
 * pool that follows ShieldPool.transfer's rules (known root, nullifier spent
 * once, both outputs inserted, a duplicate commitment refused); proofs are not
 * checked here. Covers: a receipt that timed out and lands later, a retry past
 * the wait window (the same payment again, so only one copy can land), the
 * original landing while the retry is out, a good receipt for some other
 * transaction, the note spent by another payment (the only case its codes
 * go), a wallet prompt turned down, a relay that sent it but lost its reply,
 * and the store: unsettled runs are never pruned and come back from a backup.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-payroll.mts
 */
import assert from "node:assert/strict";
import { countEvents, resetBrowser } from "./browser-shim.mjs";
import type { Address, Hex, PublicClient } from "viem";
import {
  IncrementalMerkleTreePoseidon,
  fieldToHex,
  hexToField,
  noteCommitmentPoseidon,
  noteNullifierPoseidon,
  randomSecretField,
} from "@gloamtrade/sdk";

const { getActiveNetwork } = await import("../src/lib/networks");
const { getAllNotes } = await import("../src/lib/noteVault");
const { saveLocalNote } = await import("../src/lib/shield");
const { decodeNotePackage } = await import("../src/lib/notePackage");
const { loadBatches, newBatch, runPayroll, saveBatch } = await import("../src/lib/payroll");
const { PAYROLL_SAVED_EVENT, pendingPayrollRuns, restorePayrollRuns } = await import("../src/lib/payrollStore");
type LocalNote = import("../src/lib/shield").LocalNote;
type PayrollBatch = import("../src/lib/payroll").PayrollBatch;
type PayrollEngineDeps = import("../src/lib/payroll").PayrollEngineDeps;
type SyncedTree = import("../src/lib/treeSync").SyncedTree;

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const net = getActiveNetwork();
const POOL = net.pool as Address;
const ASSET = "0x00000000000000000000000000000000000000ee" as Address;
const lc = (h: string) => h.toLowerCase();
let people = 0;
/** A fresh employer per test, so each test sees only its own notes. */
const employer = () => `0x${(++people).toString(16).padStart(40, "a")}` as Address;

type Transfer = { root: Hex; nullifier: Hex; commitments: readonly [Hex, Hex] };

/** The vault, following transfer's rules. A held transfer is sent but not mined yet. */
function mockPool() {
  const tree = new IncrementalMerkleTreePoseidon();
  const index = new Map<string, number>();
  const roots = new Set<string>();
  const spent = new Set<string>();
  const receipts = new Map<string, "success" | "reverted">();
  const held = new Map<string, Transfer>();
  let n = 0;
  const nextHash = () => `0x${(++n).toString(16).padStart(64, "0")}` as Hex;
  async function insert(c: Hex) {
    index.set(lc(c), await tree.insert(hexToField(c)));
    roots.add(lc(fieldToHex(tree.currentRoot)));
  }
  async function apply(t: Transfer) {
    const ok =
      roots.has(lc(t.root)) && !spent.has(lc(t.nullifier)) && t.commitments.every((c) => !index.has(lc(c)));
    if (ok) {
      spent.add(lc(t.nullifier));
      for (const c of t.commitments) await insert(c);
    }
    return ok;
  }
  const pool = {
    insert,
    index,
    spent,
    receipts,
    /** Sent and mined at once. */
    async land(t: Transfer): Promise<Hex> {
      const hash = nextHash();
      receipts.set(hash, (await apply(t)) ? "success" : "reverted");
      return hash;
    },
    /** Sent, still waiting to be mined. */
    hold(t: Transfer): Hex {
      const hash = nextHash();
      held.set(hash, t);
      return hash;
    },
    async mine(hash: Hex) {
      const t = held.get(hash)!;
      held.delete(hash);
      receipts.set(hash, (await apply(t)) ? "success" : "reverted");
    },
    /** Some other transaction that went through. */
    unrelatedSuccess(): Hex {
      const hash = nextHash();
      receipts.set(hash, "success");
      return hash;
    },
    client: {
      readContract: async ({ functionName, args }: { functionName: string; args: [Hex] }) => {
        if (functionName === "isSpent") return spent.has(lc(args[0]));
        if (functionName === "commitmentSeen") return index.has(lc(args[0]));
        throw new Error(`unexpected read ${functionName}`);
      },
      getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        const status = receipts.get(hash);
        if (!status) throw new Error("Transaction receipt could not be found.");
        return { status };
      },
    } as unknown as PublicClient,
    /** Like waitForTransactionReceipt: a transfer that is not mined times out. */
    waitForTx: async (hash: Hex) => {
      const status = receipts.get(hash);
      if (!status) throw new Error("Timed out while waiting for transaction.");
      return status;
    },
    syncTree: async () =>
      ({
        scheme: "poseidon",
        leaves: [],
        root: fieldToHex(tree.currentRoot),
        leafCount: index.size,
        indexByCommitment: new Map(index),
        pathForLeaf: (i: number) => tree.path(i),
      }) as unknown as SyncedTree,
  };
  return pool;
}
type Pool = ReturnType<typeof mockPool>;

/** Engine deps over the mock pool. Every transfer handed out is kept in `sent`. */
function deps(pool: Pool, send: (t: Transfer) => Promise<Hex> | Hex, sent: Transfer[] = []): PayrollEngineDeps {
  return {
    client: pool.client,
    submitTransfer: async (a) => {
      const t = { root: a.root, nullifier: a.nullifier, commitments: a.commitments };
      sent.push(t);
      return send(t);
    },
    submitMemo: null,
    waitForTx: pool.waitForTx,
    onUpdate: () => {},
    shouldStop: () => false,
    syncTree: pool.syncTree,
    prove: async () => ({ proofBytes: "0xdeadbeef" }),
  };
}

/** Money the employer added privately: in the pool and in this browser. */
async function fund(pool: Pool, owner: Address, amount: bigint, id: string): Promise<LocalNote> {
  const secret = await randomSecretField();
  const commitment = fieldToHex(await noteCommitmentPoseidon(secret, amount, ASSET));
  const nullifier = fieldToHex(await noteNullifierPoseidon(secret, hexToField(commitment)));
  await pool.insert(commitment);
  const note: LocalNote = {
    id,
    chainId: net.chainId,
    pool: POOL,
    asset: ASSET,
    amountWei: amount.toString(),
    commitment,
    secret: fieldToHex(secret),
    nullifier,
    bound: true,
    scheme: "poseidon",
    from: owner,
    createdAt: Date.now(),
    status: "open",
    source: "local",
  };
  saveLocalNote(note);
  return note;
}

function runFor(owner: Address, amounts: bigint[]): PayrollBatch {
  return newBatch({
    title: "October",
    chainId: net.chainId,
    pool: POOL,
    asset: ASSET,
    employer: owner,
    relay: true,
    rows: amounts.map((amount, i) => ({
      line: i + 1,
      name: `Person ${i + 1}`,
      recipient: "",
      kind: "link" as const,
      amountInput: amount.toString(),
      amount,
      note: "",
      error: null,
    })),
  });
}

/** The run as stored, as a reload of the page would find it. */
async function stored(id: string): Promise<PayrollBatch> {
  const b = (await loadBatches(net.chainId, POOL)).find((x) => x.id === id);
  assert.ok(b, "the run is stored");
  return b;
}

/** The run as stored, its last send pushed past the ten-minute wait. */
async function storedLater(id: string): Promise<PayrollBatch> {
  const b = await stored(id);
  for (const r of b.rows) if (r.sentAt) r.sentAt -= 11 * 60_000;
  await saveBatch(b);
  return b;
}

const byId = (id: string) => getAllNotes().find((n) => n.id === id)!;
const nothingSent = async (): Promise<Hex> => assert.fail("nothing should be sent");

await test("a receipt that times out is still checking, never failed, and keeps every code", async () => {
  const pool = mockPool();
  const me = employer();
  const spend = await fund(pool, me, 5_000n, "dep-a");
  const run = runFor(me, [1_200n]);
  let first: Hex | undefined;
  await runPayroll(run, deps(pool, (t) => (first = pool.hold(t))));
  const [row] = run.rows;
  assert.equal(run.status, "paused");
  assert.equal(row.status, "unconfirmed");
  assert.match(row.error ?? "", /hasn't confirmed/);
  assert.ok(row.ticket && row.paymentSecret && row.changeSecret && row.spendNullifier, "codes and secrets kept");
  assert.equal(byId(row.changeNoteId!).status, "open", "the change is kept");
  assert.equal(byId(spend.id).status, "open");
  assert.ok((await pendingPayrollRuns()).some((b) => b.id === run.id), "the backup carries this run");

  // It lands after the run stopped waiting: resuming settles it, sending nothing.
  await pool.mine(first!);
  const again = await stored(run.id);
  await runPayroll(again, deps(pool, nothingSent));
  const paid = again.rows[0];
  assert.equal(paid.status, "paid");
  assert.equal(again.status, "done");
  assert.equal(paid.ticket, row.ticket, "the payee's code is the one that landed");
  const pack = await decodeNotePackage(paid.ticket!);
  assert.ok(pool.index.has(lc(pack.commitment)), "the code opens a payment in the pool");
  assert.equal(byId(spend.id).status, "recovered");
  assert.equal(byId(paid.changeNoteId!).leafIndex, pool.index.get(lc(byId(paid.changeNoteId!).commitment)));
  assert.equal((await pendingPayrollRuns()).some((b) => b.id === run.id), false, "settled runs leave the backup");
});

await test("past the wait, a retry sends the very same payment, so it can only land once", async () => {
  const pool = mockPool();
  const me = employer();
  await fund(pool, me, 5_000n, "dep-b");
  const run = runFor(me, [1_000n]);
  const sent: Transfer[] = [];
  let first: Hex | undefined;
  await runPayroll(run, deps(pool, (t) => (first = pool.hold(t)), sent));
  const before = { ...run.rows[0] };
  assert.equal(before.status, "unconfirmed");

  // Still not mined ten minutes on, and others have used the vault since: the
  // retry spends the same note into the same outputs, against today's root.
  await pool.insert(fieldToHex(await randomSecretField()));
  const later = await storedLater(run.id);
  await runPayroll(later, deps(pool, (t) => pool.land(t), sent));
  const row = later.rows[0];
  assert.equal(row.status, "paid");
  assert.equal(sent.length, 2);
  assert.equal(lc(sent[1].nullifier), lc(sent[0].nullifier), "the same note");
  assert.deepEqual(sent[1].commitments.map(lc), sent[0].commitments.map(lc), "the same payment and change");
  assert.notEqual(lc(sent[1].root), lc(sent[0].root), "proven against the vault as it is now");
  assert.equal(row.ticket, before.ticket);
  assert.equal(row.paymentSecret, before.paymentSecret);

  // The first copy turns up late: it cannot land a second time.
  await pool.mine(first!);
  assert.equal(pool.receipts.get(first!), "reverted");
  assert.ok(pool.index.has(lc(row.paymentCommitment!)));
});

await test("the original lands while the retry is out: paid with the row's own payment", async () => {
  const pool = mockPool();
  const me = employer();
  await fund(pool, me, 5_000n, "dep-c");
  const run = runFor(me, [2_000n]);
  let first: Hex | undefined;
  await runPayroll(run, deps(pool, (t) => (first = pool.hold(t))));
  const later = await storedLater(run.id);
  let retry: Hex | undefined;
  await runPayroll(
    later,
    deps(pool, async (t) => {
      await pool.mine(first!);
      return (retry = await pool.land(t));
    })
  );
  const row = later.rows[0];
  assert.equal(pool.receipts.get(first!), "success");
  assert.equal(pool.receipts.get(retry!), "reverted");
  assert.equal(row.status, "paid");
  assert.ok(pool.index.has(lc(row.paymentCommitment!)));
  const pack = await decodeNotePackage(row.ticket!);
  assert.equal(lc(pack.commitment), lc(row.paymentCommitment!), "the code the payee gets is the payment that landed");
});

await test("a good receipt alone is not paid: the pool must hold this row's payment", async () => {
  const pool = mockPool();
  const me = employer();
  await fund(pool, me, 5_000n, "dep-d");
  const run = runFor(me, [700n]);
  await runPayroll(run, deps(pool, () => pool.unrelatedSuccess()));
  const [row] = run.rows;
  assert.equal(row.status, "unconfirmed");
  assert.equal(pool.index.has(lc(row.paymentCommitment!)), false);
  assert.ok(row.ticket && row.paymentSecret, "codes kept");
});

await test("the note went into another payment: only then do its codes go, and a fresh payment goes out", async () => {
  const pool = mockPool();
  const me = employer();
  const small = await fund(pool, me, 5_000n, "dep-e1");
  await fund(pool, me, 9_000n, "dep-e2");
  const run = runFor(me, [1_000n]);
  let first: Hex | undefined;
  await runPayroll(run, deps(pool, (t) => (first = pool.hold(t))));
  const old = { ...run.rows[0] };
  assert.equal(old.spendNoteId, small.id);

  // Another tab spent that note elsewhere: this payment can never land now.
  pool.spent.add(lc(old.spendNullifier!));
  const again = await stored(run.id);
  await runPayroll(again, deps(pool, (t) => pool.land(t)));
  const row = again.rows[0];
  assert.equal(row.status, "paid");
  assert.equal(row.spendNoteId, "dep-e2");
  assert.notEqual(lc(row.paymentCommitment!), lc(old.paymentCommitment!));
  assert.equal(byId(old.changeNoteId!).status, "recovered", "the dead change leaves the balance");
  assert.equal(byId(small.id).status, "recovered");
  await pool.mine(first!);
  assert.equal(pool.receipts.get(first!), "reverted");
});

await test("turned down in the wallet before it ever went out: nothing kept, the row waits", async () => {
  const pool = mockPool();
  const me = employer();
  await fund(pool, me, 5_000n, "dep-f");
  const run = runFor(me, [1_500n]);
  await runPayroll(
    run,
    deps(pool, () => {
      const e = new Error("User rejected the request.");
      e.name = "UserRejectedRequestError";
      throw e;
    })
  );
  const [row] = run.rows;
  assert.equal(run.status, "paused");
  assert.equal(row.status, "queued");
  assert.equal(row.spendNullifier, undefined, "a payment that never went out is dropped");
  const changes = getAllNotes().filter((n) => n.id.startsWith(`chg-pr-${row.id}-`));
  assert.ok(changes.length === 1 && changes[0].status === "recovered", "its change never counts");

  const again = await stored(run.id);
  await runPayroll(again, deps(pool, (t) => pool.land(t)));
  assert.equal(again.rows[0].status, "paid");
});

await test("a relay that sent it but lost its reply: paid once the pool shows it", async () => {
  const pool = mockPool();
  const me = employer();
  await fund(pool, me, 5_000n, "dep-g");
  const run = runFor(me, [900n]);
  await runPayroll(
    run,
    deps(pool, async (t) => {
      await pool.land(t);
      throw new Error("Could not reach the relay. Check your connection.");
    })
  );
  assert.equal(run.rows[0].status, "paid");
  assert.equal(run.status, "done");
});

await test("a run holding a payment that may land is never pruned", async () => {
  const pool = mockPool();
  const me = employer();
  await fund(pool, me, 5_000n, "dep-h");
  const run = runFor(me, [800n]);
  await runPayroll(run, deps(pool, (t) => pool.hold(t)));
  assert.equal(run.rows[0].status, "unconfirmed");
  const saves = countEvents(PAYROLL_SAVED_EVENT);
  for (let i = 0; i < 35; i++) await saveBatch({ ...runFor(me, [1n]), id: `pr-done-${i}`, createdAt: Date.now() + i + 1, status: "done" });
  assert.ok(saves() >= 35, "every write tells the backup");
  const kept = await loadBatches(net.chainId, POOL);
  assert.ok(kept.some((b) => b.id === run.id), "the unsettled run survives 35 newer runs");
  assert.equal(kept.filter((b) => b.id.startsWith("pr-done-")).length, 30);
});

await test("a backup brings an unsettled run back on a new device, under the wallet signed in there", async () => {
  const runs = await pendingPayrollRuns();
  assert.ok(runs.length >= 1);
  const restored = JSON.parse(JSON.stringify(runs)) as unknown;
  resetBrowser();
  const owner = employer();
  assert.equal(await restorePayrollRuns(restored, owner), runs.length);
  const back = await loadBatches(net.chainId, POOL);
  assert.equal(back.length, runs.length);
  assert.ok(back.every((b) => b.employer === owner));
  assert.ok(back.every((b) => b.rows.some((r) => r.ticket && r.paymentSecret)), "codes and secrets came back");
  assert.equal(await restorePayrollRuns(restored, owner), 0, "a run already here is kept as it is");
  assert.equal(await restorePayrollRuns([{ junk: true }, null, "x"], owner), 0);
});

console.log(`\n${passed} payroll checks passed`);
