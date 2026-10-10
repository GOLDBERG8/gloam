/**
 * Self-test: securing a claimed payment (lib/claimSweep) and its bookkeeping.
 *
 * Runs the app's own code (note store, sweep, reconcile) against an in-memory
 * pool that follows ShieldPoolPoseidon.transfer's rules (known root, nullifier
 * spent once, both outputs inserted); proofs are not checked here, the SDK's
 * sweep self-test proves one for real. Covers: a clean secure, the payer
 * spending it back first, a closed wallet prompt and a retry, a relay that
 * sent the move but lost its reply, a receipt that timed out, a payment not in
 * the vault yet, and the wrong network. Throughout, the balance must never
 * count the money twice or lose it.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-claim-sweep.mts
 */
import assert from "node:assert/strict";
import "./browser-shim.mjs";
import type { Address, Hex } from "viem";
import {
  IncrementalMerkleTreePoseidon,
  fieldToHex,
  hexToField,
  noteCommitmentPoseidon,
  noteNullifierPoseidon,
  randomSecretField,
  type PoseidonMerklePath,
} from "@gloamtrade/sdk";

const { getActiveNetwork } = await import("../src/lib/networks");
const { getAllNotes } = await import("../src/lib/noteVault");
const { activeSpendableNotes, saveLocalNote } = await import("../src/lib/shield");
const { claimNoteId, isUnsecuredClaim, reconcileClaims, secureClaim } = await import("../src/lib/claimSweep");
type LocalNote = import("../src/lib/shield").LocalNote;
type ClaimEnv = import("../src/lib/claimSweep").ClaimEnv;

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const net = getActiveNetwork();
const POOL = net.pool as Address;
const ASSET = "0x00000000000000000000000000000000000000ee" as Address;
const ME = "0x1111111111111111111111111111111111111111" as Address;
const lc = (h: string) => h.toLowerCase();

/** The vault, following transfer's rules. `hold` queues a transfer instead of applying it. */
function mockPool() {
  const tree = new IncrementalMerkleTreePoseidon();
  const index = new Map<string, number>();
  const roots = new Set<string>();
  const spent = new Set<string>();
  const receipts = new Map<string, "success" | "reverted">();
  let n = 0;
  async function insert(c: Hex) {
    index.set(lc(c), await tree.insert(hexToField(c)));
    roots.add(lc(fieldToHex(tree.currentRoot)));
  }
  async function apply(args: readonly [Hex, Hex, Hex, readonly [Hex, Hex]]) {
    const [, root, nullifier, outs] = args;
    const ok = roots.has(lc(root)) && !spent.has(lc(nullifier)) && outs.every((c) => !index.has(lc(c)));
    if (ok) {
      spent.add(lc(nullifier));
      for (const c of outs) await insert(c);
    }
    return ok;
  }
  return {
    insert,
    spent,
    index,
    async transfer(args: readonly [Hex, Hex, Hex, readonly [Hex, Hex]]): Promise<Hex> {
      const hash = `0x${(++n).toString(16).padStart(64, "0")}` as Hex;
      receipts.set(hash, (await apply(args)) ? "success" : "reverted");
      return hash;
    },
    apply,
    env(over: Partial<ClaimEnv> = {}): ClaimEnv {
      return {
        chainId: net.chainId,
        pool: POOL,
        chain: {
          isSpent: async (nf) => spent.has(lc(nf)),
          isCommitmentSeen: async (c) => index.has(lc(c)),
          pathForCommitment: async (c) => {
            const i = index.get(lc(c));
            return i == null ? null : ((await tree.path(i)) as PoseidonMerklePath);
          },
          waitForReceipt: async (h) => ({ status: receipts.get(h) ?? "reverted" }),
        },
        prove: async () => ({ proofBytes: "0xdeadbeef" }),
        relay: (t) => this.transfer([t.proof, t.root, t.nullifier, t.commitments]),
        leafIndexOf: async (c) => index.get(lc(c)),
        ...over,
      };
    },
  };
}

/** A payment someone made to us: in the pool, and claimed into this browser. */
async function claimed(pool: ReturnType<typeof mockPool>, amount: bigint, opts: { inPool?: boolean } = {}) {
  const secret = await randomSecretField();
  const commitment = fieldToHex(await noteCommitmentPoseidon(secret, amount, ASSET));
  const nullifier = fieldToHex(await noteNullifierPoseidon(secret, hexToField(commitment)));
  if (opts.inPool !== false) await pool.insert(commitment);
  const note: LocalNote = {
    id: claimNoteId(),
    chainId: net.chainId,
    pool: POOL,
    asset: ASSET,
    amountWei: amount.toString(),
    commitment,
    secret: fieldToHex(secret),
    nullifier,
    bound: true,
    scheme: "poseidon",
    from: ME,
    createdAt: Date.now(),
    status: "open",
    source: "local",
    note: "Invoice 042",
  };
  saveLocalNote(note);
  await new Promise((r) => setTimeout(r, 2)); // distinct ids
  return note;
}

/** What the balance counts for notes tied to this claim (the claim and its fresh notes). */
function counted(claim: LocalNote): LocalNote[] {
  return activeSpendableNotes(getAllNotes()).filter(
    (n) => n.id === claim.id || n.sweptFrom?.id === claim.id
  );
}
function byId(id: string) {
  return getAllNotes().find((n) => n.id === id)!;
}
function freshOf(claim: LocalNote) {
  return getAllNotes().filter((n) => n.sweptFrom?.id === claim.id);
}
const total = (ns: LocalNote[]) => ns.reduce((s, n) => s + BigInt(n.amountWei), 0n);

const noWallet = async (): Promise<Hex> => {
  throw new Error("wallet should not be used");
};

await test("secure through the relay: the money moves to a fresh note only we know", async () => {
  const pool = mockPool();
  const claim = await claimed(pool, 25_000_000n);
  assert.equal(isUnsecuredClaim(claim), true);
  const stages: string[] = [];
  const r = await secureClaim(
    { note: claim, relay: true, sendWithWallet: noWallet, onStage: (s) => stages.push(s) },
    pool.env()
  );
  assert.equal(r.status, "swept");
  assert.equal(r.final, true);
  assert.equal(pool.spent.has(lc(claim.nullifier!)), true, "the claimed note is spent by the move");
  const [fresh] = freshOf(claim);
  assert.ok(fresh, "fresh note saved");
  assert.equal(fresh.sweepPending, false);
  assert.equal(fresh.amountWei, claim.amountWei);
  assert.notEqual(lc(fresh.secret), lc(claim.secret), "a new secret the payer never saw");
  assert.equal(fresh.leafIndex, pool.index.get(lc(fresh.commitment)));
  assert.equal(fresh.note, "Invoice 042", "the payer's note stays with the money");
  assert.equal(byId(claim.id).status, "recovered");
  assert.equal(byId(claim.id).secured, true);
  assert.equal(isUnsecuredClaim(byId(claim.id)), false);
  assert.deepEqual(counted(claim).map((n) => n.id), [fresh.id]);
  assert.equal(total(counted(claim)), 25_000_000n);
  assert.ok(stages.some((s) => /relay/.test(s)));
});

await test("payer spends it back first: the claim is dropped, nothing counted", async () => {
  const pool = mockPool();
  const claim = await claimed(pool, 7_000_000n);
  // The payer knows the secret and moves it before we secure.
  pool.spent.add(lc(claim.nullifier!));
  const r = await secureClaim({ note: claim, relay: true, sendWithWallet: noWallet }, pool.env());
  assert.equal(r.status, "already_spent");
  assert.equal(r.final, false);
  assert.equal(byId(claim.id).status, "recovered");
  assert.equal(byId(claim.id).secured, undefined);
  assert.equal(freshOf(claim).length, 0, "nothing proved or saved for a spent note");
  assert.equal(total(counted(claim)), 0n);
});

await test("wallet prompt closed, then a retry through the relay", async () => {
  const pool = mockPool();
  const claim = await claimed(pool, 3_000_000n);
  const r1 = await secureClaim(
    {
      note: claim,
      relay: false,
      sendWithWallet: async () => {
        throw new Error("User rejected the request.");
      },
    },
    pool.env()
  );
  assert.equal(r1.status, "failed");
  assert.match(r1.reason ?? "", /rejected/);
  assert.equal(isUnsecuredClaim(byId(claim.id)), true, "still the claimed note, still flagged");
  assert.equal(freshOf(claim).length, 1);
  assert.equal(freshOf(claim)[0]!.sweepPending, true, "kept, but not counted");
  assert.equal(total(counted(claim)), 3_000_000n, "counted once, as the claimed note");

  const r2 = await secureClaim({ note: byId(claim.id), relay: true, sendWithWallet: noWallet }, pool.env());
  assert.equal(r2.status, "swept");
  assert.equal(total(counted(claim)), 3_000_000n, "counted once, as the fresh note");
  // The first attempt's note can never land now: reconcile retires it.
  assert.equal(await reconcileClaims(pool.env()), true);
  const fresh = freshOf(claim);
  assert.equal(fresh.filter((n) => n.status !== "recovered").length, 1);
  assert.equal(fresh.filter((n) => n.sweepPending).length, 0);
  assert.equal(total(counted(claim)), 3_000_000n);
  assert.equal(await reconcileClaims(pool.env()), false, "nothing left to settle");
});

await test("relay sent the move but lost its reply: it lands later and counts", async () => {
  const pool = mockPool();
  const claim = await claimed(pool, 9_000_000n);
  let held: readonly [Hex, Hex, Hex, readonly [Hex, Hex]] | null = null;
  const r = await secureClaim(
    { note: claim, relay: true, sendWithWallet: noWallet },
    pool.env({
      relay: async (t) => {
        held = [t.proof, t.root, t.nullifier, t.commitments];
        throw new Error("Could not reach the relay. Check your connection.");
      },
    })
  );
  // Nothing has landed yet, so the sweep reports it as not gone through...
  assert.equal(r.status, "failed");
  // ...but the fresh note is kept: the relay may still have sent it.
  const [pending] = freshOf(claim);
  assert.equal(pending!.sweepPending, true);
  assert.equal(total(counted(claim)), 9_000_000n, "still counted once, as the claimed note");

  assert.equal(await reconcileClaims(pool.env()), false, "not landed yet: stays pending");
  assert.ok(held);
  assert.equal(await pool.apply(held!), true, "the relay's transaction lands");

  assert.equal(await reconcileClaims(pool.env()), true);
  const fresh = byId(pending!.id);
  assert.equal(fresh.sweepPending, false);
  assert.equal(fresh.status, "open");
  assert.equal(fresh.leafIndex, pool.index.get(lc(fresh.commitment)));
  assert.equal(byId(claim.id).secured, true);
  assert.equal(byId(claim.id).status, "recovered");
  assert.deepEqual(counted(claim).map((n) => n.id), [fresh.id]);
  assert.equal(total(counted(claim)), 9_000_000n);
});

await test("retry after a lost reply that landed meanwhile: secured, no second move", async () => {
  const pool = mockPool();
  const claim = await claimed(pool, 6_000_000n);
  // First try: the relay sends it, the reply is lost, and it lands later.
  const r1 = await secureClaim(
    { note: claim, relay: true, sendWithWallet: noWallet },
    pool.env({
      relay: async (t) => {
        await pool.apply([t.proof, t.root, t.nullifier, t.commitments]);
        throw new Error("Could not reach the relay. Check your connection.");
      },
      chain: {
        ...pool.env().chain,
        // The chain has not shown it yet when the sweep looks.
        isCommitmentSeen: async () => false,
        isSpent: async () => false,
      },
    })
  );
  assert.equal(r1.status, "failed");
  assert.equal(isUnsecuredClaim(byId(claim.id)), true);
  // The person presses Secure again.
  let sent = 0;
  const r2 = await secureClaim(
    { note: byId(claim.id), relay: true, sendWithWallet: noWallet },
    pool.env({
      relay: async (t) => {
        sent++;
        return pool.transfer([t.proof, t.root, t.nullifier, t.commitments]);
      },
    })
  );
  assert.equal(r2.status, "swept", "reported as secured, not as taken back");
  assert.equal(sent, 0, "no second move sent");
  assert.equal(byId(claim.id).secured, true);
  assert.equal(total(counted(claim)), 6_000_000n);
});

await test("receipt timed out: pending until the chain shows it", async () => {
  const pool = mockPool();
  const claim = await claimed(pool, 4_000_000n);
  let held: readonly [Hex, Hex, Hex, readonly [Hex, Hex]] | null = null;
  const base = pool.env();
  const r = await secureClaim(
    { note: claim, relay: true, sendWithWallet: noWallet },
    {
      ...base,
      relay: async (t) => {
        held = [t.proof, t.root, t.nullifier, t.commitments];
        return `0x${"ab".repeat(32)}` as Hex;
      },
      chain: {
        ...base.chain,
        waitForReceipt: async () => {
          throw new Error("Timed out while waiting for transaction");
        },
      },
    }
  );
  assert.equal(r.status, "unconfirmed");
  assert.equal(freshOf(claim)[0]!.sweepPending, true);
  assert.equal(total(counted(claim)), 4_000_000n);
  await pool.apply(held!);
  assert.equal(await reconcileClaims(pool.env()), true);
  assert.equal(byId(claim.id).secured, true);
  assert.equal(total(counted(claim)), 4_000_000n);
});

await test("payment not in the vault yet: nothing sent, still flagged", async () => {
  const pool = mockPool();
  const claim = await claimed(pool, 1_000_000n, { inPool: false });
  const r = await secureClaim({ note: claim, relay: true, sendWithWallet: noWallet }, pool.env());
  assert.equal(r.status, "not_settled");
  assert.equal(freshOf(claim).length, 0);
  assert.equal(isUnsecuredClaim(byId(claim.id)), true);
  assert.equal(total(counted(claim)), 1_000_000n);
});

await test("a claim on another network is refused before anything runs", async () => {
  const pool = mockPool();
  const claim = await claimed(pool, 1_000_000n);
  await assert.rejects(
    secureClaim({ note: claim, relay: true, sendWithWallet: noWallet }, pool.env({ chainId: 1 })),
    /Switch to the network/
  );
  assert.equal(freshOf(claim).length, 0);
});

await test("a wrong amount is caught before anything is sent", async () => {
  const pool = mockPool();
  const claim = await claimed(pool, 2_000_000n);
  const lying = { ...claim, amountWei: "20000000" };
  const r = await secureClaim({ note: lying, relay: true, sendWithWallet: noWallet }, pool.env());
  assert.equal(r.status, "bad_note");
  assert.equal(freshOf(claim).length, 0);
});

// The note store's writes land on disk encrypted, never as plaintext.
await new Promise((r) => setTimeout(r, 50));
const stored = localStorage.getItem("gloam.shield.notes.v1") ?? "";
assert.ok(stored.startsWith("gloamenc1:"), "notes stored encrypted");

console.log(`\n${passed} claim-sweep checks passed`);
