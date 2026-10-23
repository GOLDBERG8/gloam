/**
 * People using Gloam: how many different wallets use the app, counted without
 * ever keeping a list of them.
 *
 * The app tells /api/people the connected address and which actions it did,
 * from a fixed list. The server turns the address into a one-way code with a
 * secret key and adds that code to a few Redis HyperLogLog counters
 * (lib/peopleStore). A HyperLogLog keeps only registers that estimate how many
 * different codes went in: no address, no code, no list. The request carries
 * nothing else: no amount, note, claim code, transaction or recipient.
 *
 * Timing: a connect goes out right away. Actions wait in this browser and go
 * out together a few minutes later (or on the next visit), so a request never
 * lines up with the relay call that made a payment. Each action counts once
 * per wallet per UTC day; this browser remembers what it already sent, the
 * server never learns that.
 *
 * Not counted in the recording demo. Testnets are counted apart from mainnet.
 * Runs without the cookie banner, like the claim-link totals (lib/funnel),
 * because nothing it stores can say who did what; the privacy and cookie
 * pages say so.
 */
import { readDemo } from "./demoFlag";
import { getActiveNetwork } from "./networks";

/** What a wallet did, as the app reports it. */
export type PersonAction = "connect" | "claim" | "deposit" | "send" | "swap" | "cashout" | "payroll" | "request";

export const PERSON_ACTIONS: readonly PersonAction[] = ["connect", "claim", "deposit", "send", "swap", "cashout", "payroll", "request"];

export type PeopleEnv = "mainnet" | "testnet";

export function isPersonAction(v: unknown): v is PersonAction {
  return typeof v === "string" && (PERSON_ACTIONS as readonly string[]).includes(v);
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isWalletAddress(v: unknown): v is string {
  return typeof v === "string" && ADDRESS.test(v) && !/^0x0{40}$/.test(v);
}

const KEY = "gloam.people.v1";
/** Actions go out this long after they happen, picked at random each time. */
const DELAY_MIN_MS = 2 * 60_000;
const DELAY_MAX_MS = 10 * 60_000;
const MAX_SENT = 300;
const MAX_QUEUE = 20;

type Queued = { w: string; env: PeopleEnv; a: PersonAction[]; due: number };
type Local = { day: string; sent: string[]; queue: Queued[] };

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function load(now: number): Local {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Local | null;
    if (v && Array.isArray(v.sent) && Array.isArray(v.queue)) {
      // a new UTC day starts the once-a-day memory over; anything still waiting stays
      return v.day === utcDay(now) ? v : { day: utcDay(now), sent: [], queue: v.queue };
    }
  } catch {
    /* fall through */
  }
  return { day: utcDay(now), sent: [], queue: [] };
}

function save(v: Local) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private window: counts still go out, they just may repeat */
  }
}

/** A short local fingerprint, so the same wallet and action count once a day. Never sent anywhere. */
function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function envOf(testnet?: boolean): PeopleEnv | null {
  if (typeof testnet === "boolean") return testnet ? "testnet" : "mainnet";
  try {
    return getActiveNetwork().testnet ? "testnet" : "mainnet";
  } catch {
    return null;
  }
}

function post(item: { w: string; env: PeopleEnv; a: PersonAction[] }): boolean {
  try {
    const body = JSON.stringify({ w: item.w, env: item.env, a: item.a });
    if (navigator.sendBeacon?.("/api/people", new Blob([body], { type: "application/json" }))) return true;
    void fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Sends what is due, then waits for the next one. */
function flush(now = Date.now()) {
  if (typeof window === "undefined") return;
  timer = null;
  const v = load(now);
  const keep: Queued[] = [];
  for (const item of v.queue) {
    if (item.due > now || !post(item)) keep.push(item);
  }
  v.queue = keep;
  save(v);
  schedule(v, now);
}

function schedule(v: Local, now: number) {
  if (timer || v.queue.length === 0) return;
  const next = Math.min(...v.queue.map((q) => q.due));
  // something left over from an earlier visit goes out a little after the page opens, not on load
  const wait = Math.max(next - now, 5_000 + Math.floor(Math.random() * 25_000));
  timer = setTimeout(() => flush(), wait);
}

function delay(): number {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));
}

/**
 * Count this wallet as someone using Gloam. `testnet` is the network the action
 * happened on; left out, the one the app is on.
 */
export function countPerson(action: PersonAction, address: string | null | undefined, testnet?: boolean) {
  if (typeof window === "undefined" || !isWalletAddress(address) || readDemo()) return;
  const env = envOf(testnet);
  if (!env) return;
  const now = Date.now();
  const v = load(now);
  const w = address.toLowerCase();
  const f = fingerprint(`${v.day}|${env}|${w}|${action}`);
  if (v.sent.includes(f)) return;
  v.sent = [f, ...v.sent].slice(0, MAX_SENT);
  if (action === "connect") {
    save(v);
    post({ w, env, a: ["connect"] });
    return;
  }
  const held = v.queue.find((q) => q.w === w && q.env === env);
  if (held) {
    if (!held.a.includes(action)) held.a.push(action);
  } else {
    v.queue = [...v.queue, { w, env, a: [action], due: now + delay() }].slice(-MAX_QUEUE);
  }
  save(v);
  schedule(v, now);
}

/** Picks up anything still waiting from an earlier visit. Call once when the app opens. */
export function resumePeopleCounts() {
  if (typeof window === "undefined" || readDemo()) return;
  schedule(load(Date.now()), Date.now());
}
