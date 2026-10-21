/**
 * The agent's private notes, kept inside this server.
 *
 * A note is a bearer secret: whoever knows its secret can spend it. So the
 * secrets never go to the agent. Tools hand out short handles ("n-k3x9p2qw7m")
 * plus non-secret facts (network, asset, amount, status, the tx that created
 * it), and take handles back. The secrets live here, in a local JSON file
 * encrypted with AES-256-GCM:
 *
 *   path  GLOAM_NOTE_STORE, or ~/.gloam/notes.<agent>.json
 *   key   GLOAM_NOTE_KEY (32 random bytes in hex), or, when that is unset,
 *         derived from GLOAM_AGENT_PRIVATE_KEY with HKDF-SHA256 under a Gloam
 *         note-store label, so it is never the signing key itself
 *
 * The whole store is one ciphertext (amounts and counts are hidden too), bound
 * to the agent id. Writes take the same kind of lock as the spending log, so two
 * calls or two processes cannot lose each other's notes. A store that does not
 * decrypt is never overwritten: it holds the only copy of the money.
 *
 * Each note is unspent, pending (being created, or the input of a spend in
 * flight) or spent. The server also keeps its receive key here, the private half
 * of the gloamr1. tag that x402 payments to this server are sealed to.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatUnits, type Address, type Hex } from "viem";
import type { ReceiveKey } from "@gloamtrade/sdk";
import { withFileLock } from "./fileLock.js";
import type { NetworkKey } from "./networks.js";

type Env = Record<string, string | undefined>;

export type NoteStatus = "unspent" | "pending" | "spent";
/** Where the note came from: a shield, the change of a payment, or a payment this server received and swept. */
export type NoteOrigin = "shield" | "change" | "received";
export type KeySource = "GLOAM_NOTE_KEY" | "signer";

export type StoredNote = {
  handle: string;
  network: NetworkKey;
  chainId: number;
  pool: Address;
  asset: Address;
  symbol: string;
  decimals: number;
  amountWei: string;
  secret: Hex;
  commitment: Hex;
  nullifier: Hex;
  status: NoteStatus;
  /** Only while pending: being created, or the input of a spend in flight. */
  pending?: "create" | "spend";
  origin: NoteOrigin;
  createdTx: Hex | null;
  spentTx?: Hex | null;
  /** Received notes: the nullifier of the payment note this was swept from (stops a replayed payment). */
  sweptFrom?: Hex;
  /** What the note is for, e.g. the resource a received payment paid for. */
  label?: string;
  createdAt: string;
  updatedAt: string;
};

export type NewNote = Omit<StoredNote, "handle" | "createdAt" | "updatedAt">;

type StoreData = { notes: StoredNote[]; receiveKey: ReceiveKey | null };

type StoreFile = {
  format: "gloam-note-store";
  version: 1;
  agent: string;
  keySource: KeySource;
  cipher: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
};

const SALT = Buffer.from("gloam/note-store");
const INFO = "gloam-note-store-v1";
const HANDLE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function agentId(env: Env = process.env): string {
  return env.GLOAM_AGENT_ID?.trim() || "default";
}

export function noteStorePath(agent: string, env: Env = process.env): string {
  return env.GLOAM_NOTE_STORE?.trim() || join(homedir(), ".gloam", `notes.${agent.replace(/[^\w.-]+/g, "_")}.json`);
}

/** The store key: GLOAM_NOTE_KEY, else derived from the signer key. Throws with a plain reason when neither works. */
export function noteStoreKey(env: Env = process.env): { key: Buffer; source: KeySource } {
  const raw = env.GLOAM_NOTE_KEY?.trim();
  if (raw) {
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error("GLOAM_NOTE_KEY must be 32 random bytes in hex (make one with: openssl rand -hex 32).");
    }
    const ikm = Buffer.from(raw.replace(/^0x/, ""), "hex");
    return { key: Buffer.from(hkdfSync("sha256", ikm, SALT, `${INFO}:GLOAM_NOTE_KEY`, 32)), source: "GLOAM_NOTE_KEY" };
  }
  const pk = env.GLOAM_AGENT_PRIVATE_KEY?.trim();
  if (pk && /^(0x)?[0-9a-fA-F]{64}$/.test(pk)) {
    const ikm = Buffer.from(pk.replace(/^0x/, ""), "hex");
    return { key: Buffer.from(hkdfSync("sha256", ikm, SALT, `${INFO}:signer`, 32)), source: "signer" };
  }
  throw new Error(
    "There is no key for the note store. Set GLOAM_NOTE_KEY (32 random bytes in hex: openssl rand -hex 32), or GLOAM_AGENT_PRIVATE_KEY to derive one from the signer."
  );
}

function newHandle(): string {
  const bytes = randomBytes(10);
  return "n-" + Array.from(bytes, (b) => HANDLE_ALPHABET[b % HANDLE_ALPHABET.length]).join("");
}

export class NoteStore {
  constructor(
    readonly path: string,
    readonly agent: string,
    private readonly key: Buffer,
    readonly keySource: KeySource
  ) {}

  private aad(): Buffer {
    return Buffer.from(`${INFO}:${this.agent}`);
  }

  /** Decrypt the store. Missing file: empty. Anything unreadable throws and nothing is written. */
  read(): StoreData {
    if (!existsSync(this.path)) return { notes: [], receiveKey: null };
    const unusable = (why: string) =>
      new Error(
        `The note store at ${this.path} cannot be opened: ${why}. It holds the only copy of this agent's private balance, so it is never overwritten. Restore the key it was written with, or move the file away to start a new store.`
      );
    let file: StoreFile;
    try {
      file = JSON.parse(readFileSync(this.path, "utf8")) as StoreFile;
    } catch {
      throw unusable("it is not valid JSON");
    }
    if (file?.format !== "gloam-note-store" || file.version !== 1) throw unusable("it is not a Gloam note store");
    if (file.agent !== this.agent) throw unusable(`it belongs to agent "${file.agent}", not "${this.agent}"`);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(file.iv, "base64"));
      decipher.setAAD(this.aad());
      decipher.setAuthTag(Buffer.from(file.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(file.data, "base64")), decipher.final()]);
      const data = JSON.parse(plain.toString("utf8")) as Partial<StoreData>;
      return { notes: Array.isArray(data.notes) ? data.notes : [], receiveKey: data.receiveKey ?? null };
    } catch {
      const hint =
        file.keySource !== this.keySource
          ? `it was written with ${file.keySource === "signer" ? "a key derived from the signer" : "GLOAM_NOTE_KEY"}, and the server is now using ${this.keySource === "signer" ? "a key derived from the signer" : "GLOAM_NOTE_KEY"}`
          : "the key does not match (or the file was changed)";
      throw unusable(hint);
    }
  }

  private write(data: StoreData) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad());
    const enc = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
    const file: StoreFile = {
      format: "gloam-note-store",
      version: 1,
      agent: this.agent,
      keySource: this.keySource,
      cipher: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: enc.toString("base64"),
    };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  /** Read, change and write back under the lock. */
  private mutate<T>(fn: (data: StoreData) => T): T {
    return withFileLock(this.path, "note store", () => {
      const data = this.read();
      const out = fn(data);
      this.write(data);
      return out;
    });
  }

  list(): StoredNote[] {
    return this.read().notes;
  }

  get(handle: string): StoredNote | undefined {
    return this.list().find((n) => n.handle === handle);
  }

  add(note: NewNote): StoredNote {
    return this.mutate((d) => {
      const now = new Date().toISOString();
      let handle = newHandle();
      while (d.notes.some((n) => n.handle === handle)) handle = newHandle();
      const stored: StoredNote = { ...note, handle, createdAt: now, updatedAt: now };
      d.notes.push(stored);
      return stored;
    });
  }

  /** Change one note. Returns the updated note, or undefined if the handle is unknown. */
  update(handle: string, patch: Partial<Omit<StoredNote, "handle" | "secret" | "commitment" | "nullifier">>): StoredNote | undefined {
    return this.mutate((d) => {
      const i = d.notes.findIndex((n) => n.handle === handle);
      if (i < 0) return undefined;
      const next: StoredNote = { ...d.notes[i]!, ...patch, updatedAt: new Date().toISOString() };
      if (next.status !== "pending") delete next.pending;
      d.notes[i] = next;
      return next;
    });
  }

  /** Forget a note whose creating transaction never happened (a rollback). */
  remove(handle: string) {
    this.mutate((d) => {
      d.notes = d.notes.filter((n) => n.handle !== handle);
    });
  }

  /**
   * Take an unspent note for a spend: under the lock, check it is still unspent
   * and passes `check`, then mark it pending so a second call cannot spend it too.
   */
  reserveForSpend(handle: string, check: (n: StoredNote) => string | null = () => null): StoredNote {
    return this.mutate((d) => {
      const i = d.notes.findIndex((n) => n.handle === handle);
      const note = d.notes[i];
      if (!note) throw new Error(`There is no note "${handle}". Call gloam_list_notes for this agent's notes.`);
      if (note.status !== "unspent") {
        throw new Error(`Note ${handle} is ${note.status === "pending" ? "in use by a transaction that has not confirmed" : "already spent"}.`);
      }
      const why = check(note);
      if (why) throw new Error(why);
      const next: StoredNote = { ...note, status: "pending", pending: "spend", updatedAt: new Date().toISOString() };
      d.notes[i] = next;
      return next;
    });
  }

  receiveKey(): ReceiveKey | null {
    return this.read().receiveKey;
  }

  /** Save a receive key unless one is already there; returns the one in the store. */
  keepReceiveKey(key: ReceiveKey): ReceiveKey {
    return this.mutate((d) => {
      if (!d.receiveKey) d.receiveKey = key;
      return d.receiveKey;
    });
  }
}

/** Open this agent's note store (throws with a plain reason when there is no usable key). */
export function openNoteStore(env: Env = process.env): NoteStore {
  const agent = agentId(env);
  const { key, source } = noteStoreKey(env);
  return new NoteStore(noteStorePath(agent, env), agent, key, source);
}

// ------------------------------------------------------------------ what the agent may see

/** A note as the agent sees it: a handle and public facts, never the secret, commitment or nullifier. */
export function noteView(n: StoredNote) {
  return {
    handle: n.handle,
    network: n.network,
    asset: n.asset,
    symbol: n.symbol,
    amount: formatUnits(BigInt(n.amountWei), n.decimals),
    amountWei: n.amountWei,
    status: n.status,
    ...(n.pending ? { pending: n.pending } : {}),
    origin: n.origin,
    createdTx: n.createdTx,
    ...(n.spentTx ? { spentTx: n.spentTx } : {}),
    ...(n.label ? { label: n.label } : {}),
    createdAt: n.createdAt,
  };
}

/** Private balance per network and asset: what is spendable now and what is still confirming. */
export function balances(notes: StoredNote[]) {
  const by = new Map<string, { network: string; asset: Address; symbol: string; decimals: number; unspent: bigint; pending: bigint; notes: number }>();
  for (const n of notes) {
    if (n.status === "spent") continue;
    if (n.status === "pending" && n.pending === "spend") continue;
    const k = `${n.chainId}:${n.asset.toLowerCase()}`;
    const cur = by.get(k) ?? { network: n.network, asset: n.asset, symbol: n.symbol, decimals: n.decimals, unspent: 0n, pending: 0n, notes: 0 };
    if (n.status === "unspent") {
      cur.unspent += BigInt(n.amountWei);
      cur.notes += 1;
    } else cur.pending += BigInt(n.amountWei);
    by.set(k, cur);
  }
  return [...by.values()].map((b) => ({
    network: b.network,
    asset: b.asset,
    symbol: b.symbol,
    spendable: formatUnits(b.unspent, b.decimals),
    confirming: formatUnits(b.pending, b.decimals),
    notes: b.notes,
  }));
}
