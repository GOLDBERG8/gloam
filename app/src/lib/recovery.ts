/**
 * Recovery: get your private balance back on any device by signing in.
 *
 * This browser keeps an encrypted copy of its private balance (the notes it
 * can spend, plus its receive keys) on Gloam's server. The key comes from one
 * of two places:
 *  - a wallet signature over a fixed message. A browser wallet signs the same
 *    message the same way every time, so the same wallet always rebuilds the
 *    same key. Checked by signing twice when recovery is turned on.
 *  - a passkey's PRF output, which works with any wallet (Tempo Wallet too)
 *    and follows the user wherever their passkeys sync.
 * From that secret, HKDF derives the backup id (where the copy is filed), a
 * write token (to replace or delete it) and the AES-GCM key. The server only
 * ever sees the id, the token's hash and ciphertext.
 */
import { hexToBytes, keccak256, type Address, type Hex } from "viem";
import { readDemo } from "./demoFlag";
import { getAllNotes, onNotesSaved, openJson, sealJson, setAllNotes } from "./noteVault";
import { PROMPT_DID_NOT_OPEN } from "./passkey";
import { RECEIVE_IDENTITY_EVENT, exportReceiveKeys, importReceiveKeys } from "./receiveTag";
import type { LocalNote } from "./shield";

export const RECOVERY_MESSAGE = [
  "Gloam recovery key",
  "",
  "Signing creates the key that backs up and restores your private balance on gloam.trade. It costs nothing and sends nothing.",
  "",
  "Only sign this on gloam.trade. Anyone with this signature could open your backup.",
  "",
  "Version 1",
].join("\n");

export type RecoverySource = "wallet" | "passkey";

export type RecoveryKeys = {
  source: RecoverySource;
  /** Where the backup is filed (hex). */
  id: string;
  /** Proves the right to replace or delete it (hex). */
  write: string;
  /** AES-256-GCM key (base64). */
  key: string;
};

export type RecoveryErrorCode = "cancelled" | "unsupported" | "notfound" | "failed";

export class RecoveryError extends Error {
  constructor(
    message: string,
    readonly code: RecoveryErrorCode = "failed",
  ) {
    super(message);
    this.name = "RecoveryError";
  }
}

/* ------------------------------------------------------------ bytes */

const enc = new TextEncoder();

function ab(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------ keys */

const HKDF_SALT = enc.encode("gloam/recovery/v1");

async function hkdf(secret: Uint8Array, info: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", ab(secret), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: enc.encode(info) },
    base,
    256,
  );
  return new Uint8Array(bits);
}

export async function keysFromSecret(source: RecoverySource, secret: Uint8Array): Promise<RecoveryKeys> {
  const [id, write, key] = await Promise.all([
    hkdf(secret, "backup id"),
    hkdf(secret, "write token"),
    hkdf(secret, "backup key"),
  ]);
  return { source, id: toHex(id), write: toHex(write), key: toB64(key) };
}

/**
 * The secret inside a wallet signature of RECOVERY_MESSAGE, or null when the
 * signature can't serve as a key (smart accounts and passkey wallets sign
 * differently every time, or in a different format).
 */
export function walletSecret(signature: Hex): Uint8Array | null {
  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(signature);
  } catch {
    return null;
  }
  if (bytes.length !== 65) return null;
  // r and s only: wallets disagree on how they write v, never on r and s.
  return hexToBytes(keccak256(bytes.slice(0, 64)));
}

/* ------------------------------------------------------------ passkey */

/** One rpId for gloam.trade and www.gloam.trade, so a passkey works on both. */
function recoveryRpId(): string {
  const h = window.location.hostname;
  return h === "gloam.trade" || h.endsWith(".gloam.trade") ? "gloam.trade" : h;
}

async function prfSalt(): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("gloam/recovery/prf/v1")));
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

const NO_PRF =
  "This browser or passkey can't create a recovery key. Use Chrome, Safari or Edge with a passkey saved to your Google or Apple account, or use your wallet.";

/** A passkey call that fails this fast never showed a prompt: the browser refused it outright. */
const NO_PROMPT_MS = 1_000;

function passkeyError(e: unknown, ms = Infinity): RecoveryError {
  if (e instanceof RecoveryError) return e;
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" && ms < NO_PROMPT_MS) return new RecoveryError(PROMPT_DID_NOT_OPEN, "unsupported");
  if (name === "NotAllowedError" || name === "AbortError") {
    return new RecoveryError("The passkey prompt was closed. Nothing changed.", "cancelled");
  }
  if (name === "NotSupportedError") return new RecoveryError(NO_PRF, "unsupported");
  if (name === "SecurityError") {
    return new RecoveryError("Passkeys don't work on this address. Open Gloam on gloam.trade.", "failed");
  }
  return new RecoveryError("The passkey didn't respond. Nothing changed. Try again.", "failed");
}

function prfOutput(cred: PublicKeyCredential | null): Uint8Array | null {
  const first = cred?.getClientExtensionResults().prf?.results?.first;
  if (!first) return null;
  return first instanceof ArrayBuffer ? new Uint8Array(first) : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
}

async function passkeyGet(rpId: string, salt: Uint8Array<ArrayBuffer>, credentialId?: ArrayBuffer): Promise<Uint8Array> {
  let cred: PublicKeyCredential | null;
  const t0 = Date.now();
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId,
        userVerification: "required",
        timeout: 120_000,
        ...(credentialId ? { allowCredentials: [{ type: "public-key" as const, id: credentialId }] } : {}),
        extensions: { prf: { eval: { first: salt } } },
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw passkeyError(e, Date.now() - t0);
  }
  if (!cred) throw new RecoveryError("The passkey prompt was closed. Nothing changed.", "cancelled");
  const out = prfOutput(cred);
  if (!out) throw new RecoveryError(NO_PRF, "unsupported");
  return out;
}

/**
 * The secret from a recovery passkey. "create" makes a new passkey (and may
 * need one more prompt to read its secret); "use" lets the person pick the
 * passkey they made before, on any device it synced to.
 */
export async function passkeySecret(mode: "create" | "use"): Promise<Uint8Array> {
  if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials) {
    throw new RecoveryError(NO_PRF, "unsupported");
  }
  const rpId = recoveryRpId();
  const salt = await prfSalt();
  if (mode === "use") return passkeyGet(rpId, salt);

  let cred: PublicKeyCredential | null;
  const t0 = Date.now();
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { id: rpId, name: "Gloam" },
        user: { id: randomBytes(16), name: "Gloam recovery", displayName: "Gloam recovery" },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } },
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw passkeyError(e, Date.now() - t0);
  }
  if (!cred) throw new RecoveryError("The passkey prompt was closed. Nothing changed.", "cancelled");
  const direct = prfOutput(cred);
  if (direct) return direct;
  if (cred.getClientExtensionResults().prf?.enabled === false) throw new RecoveryError(NO_PRF, "unsupported");
  // Many authenticators only return the secret on sign-in, not at creation.
  return passkeyGet(rpId, salt, cred.rawId);
}

/* ------------------------------------------------------------ backup payload */

type ReceiveKeys = ReturnType<typeof exportReceiveKeys>;

type Payload = {
  v: 1;
  savedAt: number;
  notes: LocalNote[];
  receive: ReceiveKeys;
};

function spendable(n: LocalNote): boolean {
  return n.status !== "recovered" && Boolean(n.secret) && n.secret !== "0x" && !n.id.startsWith("pay-");
}

function collect(): Payload {
  return { v: 1, savedAt: Date.now(), notes: getAllNotes().filter(spendable), receive: exportReceiveKeys() };
}

async function aesKey(keys: RecoveryKeys): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64(keys.key), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(keys: RecoveryKeys, payload: Payload): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(keys.id) },
      await aesKey(keys),
      enc.encode(JSON.stringify(payload)),
    ),
  );
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return toB64(out);
}

async function open(keys: RecoveryKeys, blob: string): Promise<Payload> {
  try {
    const raw = fromB64(blob);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(keys.id) },
      await aesKey(keys),
      raw.slice(12),
    );
    const p = JSON.parse(new TextDecoder().decode(plain)) as Payload;
    if (p?.v !== 1 || !Array.isArray(p.notes)) throw new Error("bad payload");
    return p;
  } catch {
    throw new RecoveryError("This key doesn't open the saved backup.", "failed");
  }
}

/**
 * Adds restored notes this browser doesn't have yet. With `owner`, restored
 * notes are shown under that wallet (the one signed in now). Returns how many
 * were added.
 */
function mergeNotes(restored: LocalNote[], owner?: string | null): number {
  const local = getAllNotes();
  const ids = new Set(local.map((n) => n.id));
  const commitments = new Set(local.map((n) => `${n.chainId}:${n.commitment.toLowerCase()}`));
  const added: LocalNote[] = [];
  for (const n of restored) {
    if (!n?.id || !n.secret || n.secret === "0x" || !n.commitment || !n.amountWei) continue;
    if (n.id.startsWith("pay-") || n.status === "recovered") continue;
    if (ids.has(n.id) || commitments.has(`${n.chainId}:${n.commitment.toLowerCase()}`)) continue;
    added.push({ ...n, from: owner ? (owner as Address) : n.from, status: "open", source: "local" });
  }
  if (added.length) setAllNotes([...added, ...local]);
  return added.length;
}

/* ------------------------------------------------------------ server */

type Remote = { c: string; n: number; t: number };

async function errorText(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return json?.error?.message ?? `The backup service answered ${res.status}.`;
}

async function fetchRemote(id: string): Promise<Remote | null> {
  let res: Response;
  try {
    res = await fetch(`/api/recovery?id=${id}`, { cache: "no-store" });
  } catch {
    throw new RecoveryError("No connection. Check your internet and try again.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new RecoveryError(await errorText(res));
  const json = (await res.json()) as { data: Remote };
  return json.data;
}

/* ------------------------------------------------------------ state */

const CONFIG_KEY = "gloam.recovery.v1";

type Config = RecoveryKeys & { n: number; savedAt: number | null };

export type RecoveryState = {
  /** The saved settings have been read. */
  ready: boolean;
  on: boolean;
  source: RecoverySource | null;
  /** When the backup last saved. */
  savedAt: number | null;
  busy: boolean;
  error: string | null;
};

let config: Config | null = null;
let loading: Promise<Config | null> | null = null;
let state: RecoveryState = { ready: false, on: false, source: null, savedAt: null, busy: false, error: null };
const subscribers = new Set<() => void>();

function setState(patch: Partial<RecoveryState>) {
  state = { ...state, ...patch };
  for (const fn of subscribers) fn();
}

export function recoveryState(): RecoveryState {
  return state;
}

const SERVER_STATE: RecoveryState = { ready: false, on: false, source: null, savedAt: null, busy: false, error: null };
export function recoveryServerState(): RecoveryState {
  return SERVER_STATE;
}

export function subscribeRecovery(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function loadConfig(): Promise<Config | null> {
  return (loading ??= (async () => {
    config = await openJson<Config>(localStorage.getItem(CONFIG_KEY));
    setState({ ready: true, on: Boolean(config), source: config?.source ?? null, savedAt: config?.savedAt ?? null });
    return config;
  })());
}

async function saveConfig(next: Config | null) {
  config = next;
  if (next) localStorage.setItem(CONFIG_KEY, await sealJson(next));
  else localStorage.removeItem(CONFIG_KEY);
  setState({ on: Boolean(next), source: next?.source ?? null, savedAt: next?.savedAt ?? null });
}

/* ------------------------------------------------------------ sync */

/** Saves this browser's private balance to the backup. One retry after a conflict. */
async function upload(c: Config): Promise<void> {
  let current = c;
  for (let attempt = 0; attempt < 2; attempt++) {
    const blob = await seal(current, collect());
    let res: Response;
    try {
      res = await fetch("/api/recovery", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, write: current.write, c: blob, n: current.n + 1 }),
      });
    } catch {
      throw new RecoveryError("No connection. Your balance is safe here and backs up when you're back online.");
    }
    if (res.ok) {
      const { data } = (await res.json()) as { data: { n: number; t: number } };
      await saveConfig({ ...current, n: data.n, savedAt: data.t });
      return;
    }
    if (res.status === 409 && attempt === 0) {
      // Another device saved first: take in what it has, then save on top.
      const remote = await fetchRemote(current.id);
      if (remote) {
        const p = await open(current, remote.c);
        mergeNotes(p.notes);
        importReceiveKeys({ current: null, previous: [p.receive?.current, ...(p.receive?.previous ?? [])] });
        current = { ...current, n: remote.n };
        continue;
      }
    }
    throw new RecoveryError(await errorText(res));
  }
}

let timer: number | undefined;
let running = false;
let again = false;

async function runSync() {
  const c = config ?? (await loadConfig());
  if (!c) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setState({ busy: true, error: null });
  try {
    await upload(c);
  } catch (e) {
    setState({ error: e instanceof Error ? e.message : "The backup didn't save. It will try again." });
  } finally {
    running = false;
    setState({ busy: false });
    if (again) {
      again = false;
      schedule();
    }
  }
}

function schedule() {
  if (!config) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void runSync(), 2500);
}

let started = false;

/** Keep the backup current from now on. Safe to call more than once. */
export function startRecoverySync() {
  if (started || typeof window === "undefined" || readDemo()) return;
  started = true;
  onNotesSaved(schedule);
  window.addEventListener(RECEIVE_IDENTITY_EVENT, schedule);
  void loadConfig();
}

/** Save now (the "Back up now" button). */
export function backupNow(): Promise<void> {
  return runSync();
}

/**
 * Turns recovery on with these keys. A backup that already exists for them
 * (made on another device) is merged in first, so turning it on also restores.
 * With `mustExist`, a missing backup is an error ("restore" rather than
 * "turn on"). Returns how many notes came back.
 */
export async function connectRecovery(
  keys: RecoveryKeys,
  owner: string | null | undefined,
  { mustExist = false }: { mustExist?: boolean } = {},
): Promise<number> {
  startRecoverySync();
  await loadConfig();
  setState({ busy: true, error: null });
  try {
    const remote = await fetchRemote(keys.id);
    if (!remote && mustExist) {
      throw new RecoveryError(
        keys.source === "wallet"
          ? "No backup found for this wallet. Turn on recovery on the device that has your balance first."
          : "No backup found for this passkey. Turn on recovery on the device that has your balance first.",
        "notfound",
      );
    }
    let added = 0;
    if (remote) {
      const p = await open(keys, remote.c);
      added = mergeNotes(p.notes, owner);
      importReceiveKeys(p.receive);
    }
    const next: Config = { ...keys, n: remote?.n ?? 0, savedAt: remote?.t ?? null };
    await saveConfig(next);
    await upload(next);
    return added;
  } finally {
    setState({ busy: false });
  }
}

/** Turns recovery off on this browser, and deletes the saved backup when asked. */
export async function turnOffRecovery({ deleteBackup }: { deleteBackup: boolean }): Promise<void> {
  const c = config ?? (await loadConfig());
  if (c && deleteBackup) {
    const res = await fetch("/api/recovery", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, write: c.write }),
    }).catch(() => null);
    if (!res?.ok) throw new RecoveryError(res ? await errorText(res) : "No connection. Try again.");
  }
  window.clearTimeout(timer);
  await saveConfig(null);
  setState({ error: null });
}
