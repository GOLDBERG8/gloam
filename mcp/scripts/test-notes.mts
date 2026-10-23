/**
 * Note custody tests: the encrypted note store, its lock, and the tools that
 * use it, driven through a real MCP client over an in-memory transport.
 *
 *   pnpm --filter @gloamtrade/mcp test
 *
 * No chain: a mock pool applies shieldBound and transfer with the contract's
 * rules (known root, nullifier spent once, fresh commitments), and proofs are
 * stubbed. Covers: encryption at rest, wrong keys, the lock across processes,
 * shield -> pay -> verify (sweep) end to end, replays, a payer spending a
 * payment back, the x402 fetch round trip, the legacy flag, that limits still
 * gate before any proving, and that no tool result ever carries a secret.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Hex } from "viem";
import {
  IncrementalMerkleTreePoseidon,
  buildPrivateSendIntent,
  decodePaymentHeader,
  decodeRequirements,
  encodePaymentHeader,
  encodeNotePackage,
  encodeRequirements,
  fieldToHex,
  FIELD_PRIME,
  hexToField,
  openGloamPaymentNote,
  sealToReceiveTag,
  GLOAM_NETWORKS,
  GLOAM_VS_ZONE,
  TEMPO_PATHUSD,
} from "@gloamtrade/sdk";
import { createGloamServer, type ServerDeps } from "../src/server.js";
import type { Signer } from "../src/signer.js";
import { NoteStore, noteStoreKey, openNoteStore, type NewNote } from "../src/noteStore.js";

type Env = Record<string, string | undefined>;
const TEMPO = GLOAM_NETWORKS.tempo;
const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);

function sampleNote(over: Partial<NewNote> = {}): NewNote {
  return {
    network: "tempo",
    chainId: TEMPO.chainId,
    pool: TEMPO.pool,
    asset: TEMPO_PATHUSD,
    symbol: "PathUSD",
    decimals: 6,
    amountWei: "1234567",
    secret: `0x${"5e".repeat(31)}` as Hex,
    commitment: `0x${"c0".repeat(32)}` as Hex,
    nullifier: `0x${"0f".repeat(32)}` as Hex,
    status: "unspent",
    origin: "shield",
    createdTx: null,
    ...over,
  };
}

const tmp = () => mkdtempSync(join(tmpdir(), "gloam-notes-"));

// ------------------------------------------------------------------ child modes (lock races)

if (process.argv.includes("--add-notes") || process.argv.includes("--reserve")) {
  const env = JSON.parse(process.env.TEST_ENV!) as Env;
  const store = openNoteStore(env);
  if (process.argv.includes("--add-notes")) {
    for (let i = 0; i < 5; i++) store.add(sampleNote({ label: `${process.pid}-${i}` }));
    process.stdout.write("ok");
  } else {
    try {
      store.reserveForSpend(process.env.TEST_HANDLE!);
      process.stdout.write("ok");
    } catch {
      process.stdout.write("refused");
    }
  }
} else {
  // ---------------------------------------------------------------- the store

  test("the note store is encrypted at rest and opens only with its key", () => {
    const dir = tmp();
    const env: Env = { GLOAM_AGENT_ID: "bot", GLOAM_NOTE_KEY: KEY_A, GLOAM_NOTE_STORE: join(dir, "notes.json") };
    const store = openNoteStore(env);
    const added = store.add(sampleNote());
    assert.match(added.handle, /^n-[a-z2-9]{10}$/);
    assert.ok(!added.handle.includes("5e5e"), "the handle is not derived from the secret");

    const raw = readFileSync(env.GLOAM_NOTE_STORE!, "utf8");
    const file = JSON.parse(raw);
    assert.equal(file.format, "gloam-note-store");
    assert.equal(file.cipher, "aes-256-gcm");
    assert.equal(file.keySource, "GLOAM_NOTE_KEY");
    for (const leak of ["5e5e5e", "c0c0c0", "0f0f0f", "1234567", "unspent", "PathUSD", added.handle]) {
      assert.ok(!raw.includes(leak), `the file on disk does not show ${leak}`);
    }
    assert.equal(statSync(env.GLOAM_NOTE_STORE!).mode & 0o777, 0o600, "only the owner can read the file");

    // Same key: everything comes back.
    const again = openNoteStore(env).get(added.handle);
    assert.equal(again?.secret, sampleNote().secret);
    assert.equal(again?.amountWei, "1234567");

    // Wrong key: refused, and the file is never overwritten.
    const wrong = openNoteStore({ ...env, GLOAM_NOTE_KEY: KEY_B });
    assert.throws(() => wrong.list(), /cannot be opened: the key does not match/);
    assert.throws(() => wrong.add(sampleNote()), /never overwritten/);
    assert.equal(readFileSync(env.GLOAM_NOTE_STORE!, "utf8"), raw, "a failed write leaves the store untouched");

    // A tampered file does not decrypt.
    const tampered = { ...file, data: Buffer.from("x".repeat(40)).toString("base64") };
    writeFileSync(env.GLOAM_NOTE_STORE!, JSON.stringify(tampered));
    assert.throws(() => openNoteStore(env).list(), /cannot be opened/);
    writeFileSync(env.GLOAM_NOTE_STORE!, raw);

    // The store is bound to its agent.
    const other = join(dir, "other.json");
    copyFileSync(env.GLOAM_NOTE_STORE!, other);
    assert.throws(() => openNoteStore({ ...env, GLOAM_AGENT_ID: "mallory", GLOAM_NOTE_STORE: other }).list(), /belongs to agent "bot"/);
  });

  test("the store key: GLOAM_NOTE_KEY, else derived from the signer, never missing", () => {
    const pk = `0x${"11".repeat(32)}`;
    const a = noteStoreKey({ GLOAM_AGENT_PRIVATE_KEY: pk });
    const b = noteStoreKey({ GLOAM_AGENT_PRIVATE_KEY: pk });
    assert.equal(a.source, "signer");
    assert.ok(a.key.equals(b.key), "derivation is stable");
    assert.ok(!a.key.equals(Buffer.from("11".repeat(32), "hex")), "the store key is not the signing key");
    const n = noteStoreKey({ GLOAM_AGENT_PRIVATE_KEY: pk, GLOAM_NOTE_KEY: KEY_A });
    assert.equal(n.source, "GLOAM_NOTE_KEY");
    assert.ok(!n.key.equals(a.key));
    assert.throws(() => noteStoreKey({ GLOAM_NOTE_KEY: "correct horse battery staple" }), /32 random bytes in hex/);
    assert.throws(() => noteStoreKey({}), /no key for the note store/);

    // Switching key source explains itself.
    const dir = tmp();
    const env: Env = { GLOAM_AGENT_PRIVATE_KEY: pk, GLOAM_NOTE_STORE: join(dir, "n.json") };
    openNoteStore(env).add(sampleNote());
    assert.throws(() => openNoteStore({ ...env, GLOAM_NOTE_KEY: KEY_A }).list(), /written with a key derived from the signer/);
  });

  test("a note is reserved for one spend at a time", () => {
    const env: Env = { GLOAM_NOTE_KEY: KEY_A, GLOAM_NOTE_STORE: join(tmp(), "n.json") };
    const store = openNoteStore(env);
    const { handle } = store.add(sampleNote());
    const r = store.reserveForSpend(handle);
    assert.equal(r.status, "pending");
    assert.equal(r.pending, "spend");
    assert.throws(() => store.reserveForSpend(handle), /in use by a transaction/);
    store.update(handle, { status: "unspent" });
    assert.equal(store.get(handle)?.pending, undefined, "pending is cleared with the status");
    assert.throws(() => store.reserveForSpend(handle, () => "too small"), /too small/);
    assert.equal(store.get(handle)?.status, "unspent", "a failed check reserves nothing");
    store.update(handle, { status: "spent" });
    assert.throws(() => store.reserveForSpend(handle), /already spent/);
    assert.throws(() => store.reserveForSpend("n-nope"), /no note "n-nope"/);
  });

  const runChildren = (mode: string, env: Env, n: number, extra: Env = {}) => {
    const self = fileURLToPath(import.meta.url);
    const tsx = join(fileURLToPath(new URL("..", import.meta.url)), "node_modules", ".bin", "tsx");
    return Promise.all(
      Array.from(
        { length: n },
        () =>
          new Promise<string>((resolve, reject) => {
            const child = spawn(tsx, [self, mode], { env: { ...process.env, ...extra, TEST_ENV: JSON.stringify(env) } });
            let out = "";
            child.stdout.on("data", (d) => (out += d));
            child.on("error", reject);
            child.on("close", () => resolve(out.trim()));
          })
      )
    );
  };

  test("parallel server processes never lose a note or double-reserve one (the store is locked)", async () => {
    const env: Env = { GLOAM_NOTE_KEY: KEY_A, GLOAM_NOTE_STORE: join(tmp(), "n.json") };
    const adds = await runChildren("--add-notes", env, 6);
    assert.deepEqual(adds, Array(6).fill("ok"));
    const notes = openNoteStore(env).list();
    assert.equal(notes.length, 30, "6 processes x 5 notes, none lost");
    assert.equal(new Set(notes.map((n) => n.handle)).size, 30, "handles are unique");

    const { handle } = openNoteStore(env).add(sampleNote());
    const races = await runChildren("--reserve", env, 6, { TEST_HANDLE: handle });
    assert.equal(races.filter((r) => r === "ok").length, 1, races.join(","));
  });

  // ---------------------------------------------------------------- the tools, over MCP

  /** A pool that follows the contract's rules for shieldBound and transfer. */
  function mockChain() {
    const tree = new IncrementalMerkleTreePoseidon();
    const index = new Map<string, number>();
    const roots = new Set<string>();
    const spent = new Set<string>();
    const receipts = new Map<string, "success" | "reverted">();
    const calls: string[] = [];
    let n = 0;
    const lc = (h: string) => h.toLowerCase();
    const insert = async (c: string) => {
      index.set(lc(c), await tree.insert(hexToField(c)));
      roots.add(lc(fieldToHex(tree.currentRoot)));
    };
    async function apply(fn: string, args: readonly unknown[]): Promise<Hex> {
      const hash = `0x${(++n).toString(16).padStart(64, "0")}` as Hex;
      let ok = true;
      if (fn === "shieldBound") {
        const c = String(args[2]);
        ok = !index.has(lc(c));
        if (ok) await insert(c);
      } else if (fn === "transfer") {
        const [, root, nullifier, outs] = args as [Hex, Hex, Hex, Hex[]];
        ok = roots.has(lc(root)) && !spent.has(lc(nullifier)) && outs.every((c) => !index.has(lc(c)));
        if (ok) {
          spent.add(lc(nullifier));
          for (const c of outs) await insert(c);
        }
      }
      receipts.set(hash, ok ? "success" : "reverted");
      return hash;
    }
    const publicClient = {
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({ status: receipts.get(hash) ?? "reverted", from: "0x0000000000000000000000000000000000000abc" }),
      getTransactionReceipt: async ({ hash }: { hash: Hex }) => ({ status: receipts.get(hash) ?? "reverted" }),
      readContract: async ({ functionName, args }: { functionName: string; args: [Hex] }) =>
        functionName === "isSpent" ? spent.has(lc(args[0])) : index.has(lc(args[0])),
    };
    const walletClient = {
      writeContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
        calls.push(functionName);
        return apply(functionName, args);
      },
      sendTransaction: async () => {
        calls.push("send");
        return apply("send", []);
      },
    };
    const syncTree = async () => ({
      pathForCommitment: async (c: Hex) => (index.has(lc(c)) ? tree.path(index.get(lc(c))!) : null),
    });
    return { publicClient, walletClient, syncTree, calls, apply, path: (c: Hex) => tree.path(index.get(lc(c))!) };
  }

  type Chain = ReturnType<typeof mockChain>;

  function makeDeps(chain: Chain, env: Env, extra: Partial<ServerDeps> = {}) {
    const proofs = { count: 0 };
    const prover = async () => {
      proofs.count++;
      return { proofBytes: "0xdeadbeef" as Hex };
    };
    const deps: Partial<ServerDeps> = {
      env,
      signer: (net) =>
        env.GLOAM_AGENT_PRIVATE_KEY
          ? ({ account: { address: "0x0000000000000000000000000000000000000abc" }, network: net, walletClient: chain.walletClient, publicClient: chain.publicClient } as unknown as Signer)
          : null,
      publicClient: () => chain.publicClient as unknown as Signer["publicClient"],
      shieldProver: async () => prover,
      transferProver: async () => prover,
      syncTree: chain.syncTree as unknown as ServerDeps["syncTree"],
      relay: async (intent) => chain.apply("transfer", intent.exec!.args),
      ...extra,
    };
    return { deps, proofs };
  }

  /** Every tool result text this test has seen, for the secret scan. */
  const seen: string[] = [];

  async function connect(deps: Partial<ServerDeps>) {
    const server = createGloamServer(deps);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "gloam-test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      const raw = (r.content as { type: string; text: string }[])[0]!.text;
      seen.push(raw);
      return JSON.parse(raw);
    };
    return { call, client };
  }

  function partyEnv(name: string, dir: string, over: Env = {}): Env {
    return {
      GLOAM_AGENT_ID: name,
      GLOAM_AGENT_PRIVATE_KEY: `0x${(name === "payer" ? "11" : "22").repeat(32)}`,
      GLOAM_NOTE_STORE: join(dir, `${name}-notes.json`),
      GLOAM_SPEND_LOG: join(dir, `${name}-log.json`),
      ...over,
    };
  }

  const PAYER_LIMITS: Env = {
    GLOAM_LIMIT_ASSETS: "PathUSD",
    GLOAM_LIMIT_MAX_PER_PAYMENT: "10",
    GLOAM_LIMIT_MAX_PER_DAY: "50",
    GLOAM_LIMIT_RECIPIENTS: "any",
    GLOAM_LIMIT_TOOLS: "pay,shield",
  };

  /** Every secret either party holds: note secrets (hex and decimal), receive keys, and the payment notes in flight. */
  function secretsOf(envs: Env[], extra: string[] = []): string[] {
    const out: string[] = [...extra];
    for (const env of envs) {
      const data = openNoteStore(env);
      for (const n of data.list()) out.push(n.secret.slice(2).toLowerCase(), hexToField(n.secret).toString());
      const rk = data.receiveKey();
      if (rk?.privateJwk.d) out.push(rk.privateJwk.d);
    }
    return out.filter((s) => s.length >= 20);
  }

  function assertNoSecrets(secrets: string[]) {
    for (const raw of seen) {
      const low = raw.toLowerCase();
      for (const s of secrets) assert.ok(!low.includes(s.toLowerCase()), `a tool result leaked a secret: ${raw.slice(0, 200)}`);
    }
  }

  test("shield -> pay -> verify: handles only, sealed to the payee, swept before access", async () => {
    const dir = tmp();
    const chain = mockChain();
    const payerEnv = partyEnv("payer", dir, PAYER_LIMITS);
    const payeeEnv = partyEnv("payee", dir, { GLOAM_LIMITS: "off" });
    const payer = makeDeps(chain, payerEnv);
    const payee = makeDeps(chain, payeeEnv);
    const P = await connect(payer.deps);
    const S = await connect(payee.deps);
    const paymentSecrets: string[] = [];

    // The agent shields and gets a handle, not a secret.
    const shield = await P.call("gloam_execute_shield", { amount: 10, network: "tempo" });
    assert.equal(shield.status, "confirmed", JSON.stringify(shield));
    assert.match(shield.note.handle, /^n-/);
    assert.equal(shield.note.secret, undefined);
    assert.equal(shield.note.commitment, undefined);
    assert.equal(shield.note.amount, "10");
    assert.deepEqual(chain.calls, ["approve", "shieldBound"]);
    const stored = openNoteStore(payerEnv).get(shield.note.handle)!;
    assert.equal(stored.status, "unspent");
    assert.equal(stored.createdTx, shield.hash);

    const list = await P.call("gloam_list_notes", {});
    assert.equal(list.balances[0].spendable, "10");
    assert.equal(list.notes[0].handle, shield.note.handle);

    // The payee prices a resource to its own receive tag.
    const tag = await S.call("gloam_receive_tag");
    assert.match(tag.tag, /^gloamr1\./);
    const priced = await S.call("gloam_payment_requirements", {
      amount: 3, decimals: 6, assetSymbol: "PathUSD", asset: TEMPO_PATHUSD, resource: "https://api.example/answer", network: "tempo",
    });
    assert.equal(priced.requirements.payTo, tag.tag);

    // The agent pays by handle (here: lets the server pick).
    const paid = await P.call("gloam_execute_private_pay", { requirements: priced.encoded });
    assert.equal(paid.status, "paid", JSON.stringify(paid));
    assert.equal(paid.sealedToPayee, true);
    assert.equal(paid.spentNote, shield.note.handle);
    assert.equal(paid.change.amount, "7");
    assert.equal(paid.paymentNote, undefined);
    assert.equal(paid.persistChangeNote, undefined);
    assert.match(paid.paymentHeader, /^gloamx402pay1:/);
    assert.match(decodePaymentHeader(paid.paymentHeader).payload.paymentNote, /^gloam2t\./);
    const payerStore = openNoteStore(payerEnv);
    assert.equal(payerStore.get(shield.note.handle)?.status, "spent");
    assert.equal(payerStore.get(paid.change.handle)?.status, "unspent");
    const opened = await openGloamPaymentNote(decodePaymentHeader(paid.paymentHeader).payload.paymentNote, openNoteStore(payeeEnv).receiveKey()!);
    paymentSecrets.push(opened.secret.slice(2), hexToField(opened.secret).toString());

    // The payee verifies: opens, checks, sweeps, and only then grants access.
    const v = await S.call("gloam_verify_payment", { requirements: priced.encoded, payment: paid.paymentHeader });
    assert.equal(v.status, "settled", JSON.stringify(v));
    assert.equal(v.grantAccess, true);
    assert.equal(v.final, true);
    assert.equal(v.received.amount, "3");
    assert.equal(v.received.origin, "received");
    const received = openNoteStore(payeeEnv).get(v.received.handle)!;
    assert.equal(received.status, "unspent");
    assert.notEqual(received.secret, opened.secret, "the payee's money sits under a secret the payer never saw");

    // The same header again: refused, not served twice.
    const replay = await S.call("gloam_verify_payment", { requirements: priced.encoded, payment: paid.paymentHeader });
    assert.equal(replay.status, "already_settled");
    assert.equal(replay.grantAccess, false);

    // The payer now cannot spend the payment back: the pool refuses the nullifier.
    const back = await buildPrivateSendIntent({
      secretHex: opened.secret, amountInWei: 3_000_000n, amountPayWei: 3_000_000n, asset: TEMPO_PATHUSD,
      path: await chain.path(opened.commitment), prove: async () => ({ proofBytes: "0x00" }), poolAddress: TEMPO.pool, chainId: TEMPO.chainId,
    });
    const h = await chain.apply("transfer", back.exec.args);
    assert.equal((await chain.publicClient.waitForTransactionReceipt({ hash: h })).status, "reverted");

    // A payer that spends the payment back BEFORE the sweep gets nothing.
    const paid2 = await P.call("gloam_execute_private_pay", { requirements: priced.encoded, note: paid.change.handle });
    assert.equal(paid2.status, "paid", JSON.stringify(paid2));
    const note2 = await openGloamPaymentNote(decodePaymentHeader(paid2.paymentHeader).payload.paymentNote, openNoteStore(payeeEnv).receiveKey()!);
    paymentSecrets.push(note2.secret.slice(2), hexToField(note2.secret).toString());
    const steal = await buildPrivateSendIntent({
      secretHex: note2.secret, amountInWei: 3_000_000n, amountPayWei: 3_000_000n, asset: TEMPO_PATHUSD,
      path: await chain.path(note2.commitment), prove: async () => ({ proofBytes: "0x00" }), poolAddress: TEMPO.pool, chainId: TEMPO.chainId,
    });
    await chain.apply("transfer", steal.exec.args);
    const before = openNoteStore(payeeEnv).list().length;
    const v2 = await S.call("gloam_verify_payment", { requirements: priced.encoded, payment: paid2.paymentHeader });
    assert.equal(v2.status, "already_spent", JSON.stringify(v2));
    assert.equal(v2.grantAccess, false);
    assert.match(v2.message, /do not grant access/);
    assert.equal(openNoteStore(payeeEnv).list().length, before, "nothing stored for a payment that was taken back");

    // No tool result, on either side, ever carried a secret.
    assertNoSecrets(secretsOf([payerEnv, payeeEnv], paymentSecrets));
  });

  test("a payment note claiming amount + p is refused, not settled", async () => {
    const dir = tmp();
    const chain = mockChain();
    const payerEnv = partyEnv("payer", dir, PAYER_LIMITS);
    const payeeEnv = partyEnv("payee", dir, { GLOAM_LIMITS: "off" });
    const P = await connect(makeDeps(chain, payerEnv).deps);
    const S = await connect(makeDeps(chain, payeeEnv).deps);
    const cheap = await S.call("gloam_payment_requirements", {
      amount: 1, decimals: 6, assetSymbol: "PathUSD", asset: TEMPO_PATHUSD, resource: "cheap", network: "tempo",
    });
    const dear = await S.call("gloam_payment_requirements", {
      amount: 5, decimals: 6, assetSymbol: "PathUSD", asset: TEMPO_PATHUSD, resource: "dear", network: "tempo",
    });
    await P.call("gloam_execute_shield", { amount: 5, network: "tempo" });
    const paid = await P.call("gloam_execute_private_pay", { requirements: cheap.encoded });
    assert.equal(paid.status, "paid", JSON.stringify(paid));

    // The payer re-seals its real 1 PathUSD payment note as 1 + p: Poseidon reads the
    // amount mod p, so it opens the same commitment, which is this transfer's output.
    const payload = decodePaymentHeader(paid.paymentHeader);
    const tag = (await S.call("gloam_receive_tag")).tag;
    const real = await openGloamPaymentNote(payload.payload.paymentNote, openNoteStore(payeeEnv).receiveKey()!);
    const forged = encodeNotePackage({ pool: TEMPO.pool, asset: real.asset, amountWei: (BigInt(real.amountWei) + FIELD_PRIME).toString(), secret: real.secret, commitment: real.commitment });
    payload.payload.paymentNote = await sealToReceiveTag(forged, tag);
    const before = openNoteStore(payeeEnv).list().length;
    const v = await S.call("gloam_verify_payment", { requirements: dear.encoded, payment: encodePaymentHeader(payload) });
    assert.equal(v.grantAccess, false, JSON.stringify(v));
    assert.equal(v.status, "rejected", JSON.stringify(v));
    assert.equal(openNoteStore(payeeEnv).list().length, before, "nothing is swept or stored for it");

    // The honest note still settles the price it really paid.
    const ok = await S.call("gloam_verify_payment", { requirements: cheap.encoded, payment: paid.paymentHeader });
    assert.equal(ok.status, "settled", JSON.stringify(ok));
    assert.equal(ok.received.amount, "1");
  });

  test("limits still gate before any proving or signing, and refusals leave notes untouched", async () => {
    const dir = tmp();
    const chain = mockChain();
    const payeeEnv = partyEnv("payee", dir, { GLOAM_LIMITS: "off" });
    const S = await connect(makeDeps(chain, payeeEnv).deps);
    const priced = await S.call("gloam_payment_requirements", {
      amount: 6, decimals: 6, assetSymbol: "PathUSD", asset: TEMPO_PATHUSD, resource: "r", network: "tempo",
    });

    // No limits at all: the shield is refused and no note is minted.
    const unlimitedEnv = partyEnv("payer", dir);
    const u = makeDeps(chain, unlimitedEnv);
    const U = await connect(u.deps);
    const refusedShield = await U.call("gloam_execute_shield", { amount: 10, network: "tempo" });
    assert.equal(refusedShield.status, "refused");
    assert.equal(refusedShield.code, "limits_unset");
    assert.equal(u.proofs.count, 0, "nothing proved");
    assert.deepEqual(chain.calls, [], "nothing signed");
    assert.equal(openNoteStore(unlimitedEnv).list().length, 0, "no note minted");

    // With limits: a payment over the per-payment cap is refused before proving.
    const payerEnv = partyEnv("payer2", dir, PAYER_LIMITS);
    const p = makeDeps(chain, payerEnv);
    const P = await connect(p.deps);
    const shield = await P.call("gloam_execute_shield", { amount: 10, network: "tempo" });
    assert.equal(shield.status, "confirmed");
    // The owner tightens the cap; the env is read on every call, so it applies at once.
    payerEnv.GLOAM_LIMIT_MAX_PER_PAYMENT = "5";
    const proofsBefore = p.proofs.count;
    const over = await P.call("gloam_execute_private_pay", { requirements: priced.encoded });
    assert.equal(over.status, "refused");
    assert.equal(over.code, "over_per_payment");
    assert.equal(p.proofs.count, proofsBefore, "refused before proving");
    assert.equal(openNoteStore(payerEnv).get(shield.note.handle)?.status, "unspent", "the note is not reserved by a refusal");

    // A payTo that is not a receive tag is refused before the gate and the prover.
    const req = decodeRequirements(priced.encoded);
    const untagged = { ...req, payTo: "gloam:rcpt:someone", maxAmountRequired: "1000000", privacy: GLOAM_VS_ZONE };
    const bad = await P.call("gloam_execute_private_pay", { requirements: JSON.stringify(untagged) });
    assert.equal(bad.status, "refused");
    assert.equal(bad.code, "payto_not_receive_tag");
    assert.match(bad.message, /receive tag/);
    assert.equal(p.proofs.count, proofsBefore);

    // Asking the payee side for requirements with a non-tag payTo is an error too.
    const badReq = await S.call("gloam_payment_requirements", { amount: 1, payTo: "gloam:rcpt:x", resource: "r" });
    assert.equal(badReq.status, "error");
    assert.match(badReq.error, /must be a Gloam receive tag/);
  });

  test("a payee that cannot sweep says the payment is not final; with the relay it settles", async () => {
    const dir = tmp();
    const chain = mockChain();
    const payerEnv = partyEnv("payer", dir, PAYER_LIMITS);
    const P = await connect(makeDeps(chain, payerEnv).deps);
    // A payee with no signer: its store key comes from GLOAM_NOTE_KEY.
    const payeeEnv: Env = { GLOAM_AGENT_ID: "shop", GLOAM_NOTE_KEY: KEY_B, GLOAM_NOTE_STORE: join(dir, "shop.json") };
    const S = await connect(makeDeps(chain, payeeEnv).deps);
    const priced = await S.call("gloam_payment_requirements", {
      amount: 2, decimals: 6, assetSymbol: "PathUSD", asset: TEMPO_PATHUSD, resource: "r", network: "tempo",
    });
    await P.call("gloam_execute_shield", { amount: 5, network: "tempo" });
    const paid = await P.call("gloam_execute_private_pay", { requirements: priced.encoded });
    assert.equal(paid.status, "paid", JSON.stringify(paid));

    const v = await S.call("gloam_verify_payment", { requirements: priced.encoded, payment: paid.paymentHeader });
    assert.equal(v.status, "verified_not_final");
    assert.equal(v.grantAccess, false);
    assert.equal(v.final, false);
    assert.match(v.finality, /spend the money back/);

    const R = await connect(makeDeps(chain, { ...payeeEnv, GLOAM_USE_RELAY: "1" }).deps);
    const settled = await R.call("gloam_verify_payment", { requirements: priced.encoded, payment: paid.paymentHeader });
    assert.equal(settled.status, "settled", JSON.stringify(settled));
    assert.equal(settled.sweptBy, "gloam-relay");
    assert.equal(settled.grantAccess, true);

    // A requirements object pointing at some other pool is not settled at all.
    const req = decodeRequirements(priced.encoded);
    const fake = encodeRequirements({ ...req, poolAddress: "0x000000000000000000000000000000000000dEaD" });
    const wrongPool = await R.call("gloam_verify_payment", { requirements: fake, payment: paid.paymentHeader });
    assert.equal(wrongPool.status, "rejected");
    assert.equal(wrongPool.grantAccess, false);

    assertNoSecrets(secretsOf([payerEnv, payeeEnv]));
  });

  test("gloam_fetch_paid: the whole 402 round trip stays inside the server", async () => {
    const dir = tmp();
    const chain = mockChain();
    const payeeEnv = partyEnv("payee", dir, { GLOAM_LIMITS: "off" });
    const S = await connect(makeDeps(chain, payeeEnv).deps);
    const priced = await S.call("gloam_payment_requirements", {
      amount: 1, decimals: 6, assetSymbol: "PathUSD", asset: TEMPO_PATHUSD, resource: "https://api.example/answer", network: "tempo",
    });
    // A resource server that prices in x402 and serves only after its own Gloam MCP says grantAccess.
    const requests: (string | null)[] = [];
    const resourceServer = (async (_url: string, init?: RequestInit) => {
      const xPayment = new Headers(init?.headers).get("x-payment");
      requests.push(xPayment);
      if (!xPayment) {
        return new Response(JSON.stringify({ x402Version: 1, error: "payment required", accepts: [{ scheme: "exact" }, priced.requirements] }), {
          status: 402,
          headers: { "content-type": "application/json" },
        });
      }
      const v = await S.call("gloam_verify_payment", { requirements: priced.encoded, payment: xPayment });
      return v.grantAccess
        ? new Response("the answer is 42", { status: 200, headers: { "x-payment-response": "settled" } })
        : new Response(JSON.stringify(v), { status: 402 });
    }) as typeof fetch;

    const payerEnv = partyEnv("payer", dir, PAYER_LIMITS);
    const P = await connect(makeDeps(chain, payerEnv, { fetch: resourceServer }).deps);
    await P.call("gloam_execute_shield", { amount: 5, network: "tempo" });

    const tooMuch = await P.call("gloam_fetch_paid", { url: "https://api.example/answer", maxAmount: 0.5 });
    assert.equal(tooMuch.status, "refused");
    assert.equal(tooMuch.code, "over_max_amount");

    const r = await P.call("gloam_fetch_paid", { url: "https://api.example/answer" });
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.equal(r.httpStatus, 200);
    assert.equal(r.body, "the answer is 42");
    assert.equal(r.paid.amount, "1");
    assert.equal(r.paymentResponse, "settled");
    assert.equal(r.paymentHeader, undefined, "a served request does not hand the header to the agent");
    assert.equal(requests.at(-1)?.startsWith("gloamx402pay1:"), true, "the retry carried the payment");

    const free = await P.call("gloam_fetch_paid", { url: "https://api.example/answer", paymentHeader: requests.at(-1)! });
    assert.equal(free.status, "payment_not_accepted", "a spent header is not accepted twice");

    assertNoSecrets(secretsOf([payerEnv, payeeEnv]));
  });

  test("GLOAM_EXPOSE_NOTE_SECRETS=1 brings back secrets, and only then", async () => {
    const dir = tmp();
    const chain = mockChain();

    const safeEnv = partyEnv("payer", dir, PAYER_LIMITS);
    const safe = await connect(makeDeps(chain, safeEnv).deps);
    const tools = await safe.client.listTools();
    const pay = tools.tools.find((t) => t.name === "gloam_execute_private_pay")!;
    assert.ok(!("noteSecret" in (pay.inputSchema.properties ?? {})), "no secret argument by default");
    assert.ok("note" in (pay.inputSchema.properties ?? {}), "pay takes a note handle");
    for (const t of ["gloam_list_notes", "gloam_receive_tag", "gloam_fetch_paid"]) assert.ok(tools.tools.some((x) => x.name === t), `${t} is offered`);

    const legacyEnv = partyEnv("old", dir, { ...PAYER_LIMITS, GLOAM_EXPOSE_NOTE_SECRETS: "1" });
    const old = await connect(makeDeps(chain, legacyEnv).deps);
    const oldTools = await old.client.listTools();
    const oldPay = oldTools.tools.find((t) => t.name === "gloam_execute_private_pay")!;
    assert.ok("noteSecret" in (oldPay.inputSchema.properties ?? {}), "legacy mode accepts a secret");
    const shield = await old.call("gloam_execute_shield", { amount: 4, network: "tempo" });
    assert.equal(shield.status, "confirmed");
    assert.equal(shield.note.secret, openNoteStore(legacyEnv).get(shield.note.handle)?.secret, "legacy mode returns the secret");
    assert.match(shield.warning, /unsafe|spend that money/i);

    const payeeEnv = partyEnv("payee", dir, { GLOAM_LIMITS: "off" });
    const S = await connect(makeDeps(chain, payeeEnv).deps);
    const priced = await S.call("gloam_payment_requirements", {
      amount: 1, decimals: 6, assetSymbol: "PathUSD", asset: TEMPO_PATHUSD, resource: "r", network: "tempo",
    });
    const paid = await old.call("gloam_execute_private_pay", { requirements: priced.encoded, noteSecret: shield.note.secret, noteAmount: 4 });
    assert.equal(paid.status, "paid", JSON.stringify(paid));
    assert.ok(paid.paymentNote.secret && paid.persistChangeNote.secret, "legacy mode returns payment and change secrets");
    assert.equal(paid.sealedToPayee, true, "the header is still sealed to a receive tag");
    // The scan used above is not vacuous: legacy mode leaks on purpose, and it is caught.
    assert.throws(() => assertNoSecrets(secretsOf([legacyEnv])), /leaked a secret/);
  });
}
