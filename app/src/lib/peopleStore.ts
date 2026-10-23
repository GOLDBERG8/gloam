/**
 * People using Gloam (see lib/people): one-way counts of different wallets,
 * kept in Redis HyperLogLogs. Server only.
 *
 * A wallet becomes HMAC-SHA256(GLOAM_METRICS_SALT, its lowercase address), and
 * that code is added with PFADD to:
 *   gloam:people:v1:<side>:all             everyone, all time
 *   gloam:people:v1:<side>:act:<action>    each action, all time
 *   gloam:people:v1:<side>:day:<UTC day>   everyone that day, kept 35 days
 * where <side> is mainnet or testnet. A HyperLogLog keeps registers, not the
 * codes it was given, so no address or lookup-able code is stored. Days are
 * the finest grain kept, and per action there is only an all-time count.
 *
 * Besides what the app reports, the public wallets in the vault's own events
 * are added as they are read (lib/onchainMetrics): depositors count as people
 * who deposited, and cash-out destinations get a count of their own that is
 * not added to everyone, since one person can cash out to several addresses.
 *
 * Without GLOAM_METRICS_SALT (at least 32 characters) nothing is counted. The
 * salt is a server variable, so a browser bundle never has it.
 */
import { createHmac } from "crypto";
import { kv, kvBackend, type KvBackend, type KvCommand } from "./partnersKv";
import { PERSON_ACTIONS, type PeopleEnv, type PersonAction } from "./people";

const PREFIX = "gloam:people:v1:";
const DAY_TTL_SEC = 35 * 86_400;
const MIN_SALT = 32;
/** Elements per PFADD when adding chain wallets. */
const CHUNK = 500;
/** UTC days the admin shows one by one. */
export const PEOPLE_DAYS = 14;

/** Counts only the server adds, from the chain. */
export type ChainOnlyCount = "cashout_to";

export type PeopleSide = {
  /** Different wallets, all time. */
  all: number;
  /** Everyone plus the wallets cash outs went to. */
  allWithCashoutTo: number;
  /** So far this UTC day. */
  today: number;
  /** The last 7 and 30 UTC days, today included. */
  d7: number;
  d30: number;
  byAction: Record<PersonAction | ChainOnlyCount, number>;
  /** Oldest first. */
  daily: { day: string; people: number }[];
};

export type PeopleSummary = {
  configured: boolean;
  backend: KvBackend;
  /** When counting started (ms), or null before the first count. */
  since: number | null;
  mainnet: PeopleSide;
  testnet: PeopleSide;
  error?: string;
};

function salt(): string | null {
  const s = process.env.GLOAM_METRICS_SALT?.trim();
  return s && s.length >= MIN_SALT ? s : null;
}

export function peopleConfigured(): boolean {
  return salt() !== null;
}

/** The one-way code for a wallet. Same wallet, same code; never reversible without the salt. */
export function personCode(secret: string, address: string): string {
  return createHmac("sha256", secret).update(`gloam-people-v1|${address.trim().toLowerCase()}`).digest("hex");
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const days = (n: number, now: number) => Array.from({ length: n }, (_, i) => utcDay(now - (n - 1 - i) * 86_400_000));

const keyAll = (env: PeopleEnv) => `${PREFIX}${env}:all`;
const keyAct = (env: PeopleEnv, a: PersonAction | ChainOnlyCount) => `${PREFIX}${env}:act:${a}`;
const keyDay = (env: PeopleEnv, day: string) => `${PREFIX}${env}:day:${day}`;
const KEY_SINCE = `${PREFIX}since`;

/**
 * Counts one wallet for the actions it did. False when counting is off (no
 * salt) or nothing was asked; throws when the store fails.
 */
export async function addPerson(address: string, actions: PersonAction[], env: PeopleEnv, now = Date.now()): Promise<boolean> {
  const secret = salt();
  if (!secret || actions.length === 0) return false;
  const code = personCode(secret, address);
  const day = keyDay(env, utcDay(now));
  await kv([
    ["PFADD", keyAll(env), code],
    ...actions.map((a) => ["PFADD", keyAct(env, a), code]),
    ["PFADD", day, code],
    ["EXPIRE", day, DAY_TTL_SEC],
    ["SET", KEY_SINCE, String(now), "NX"],
  ]);
  return true;
}

/** A public wallet seen in a vault's events. */
export type ChainWallet = { kind: "deposit" | "cashout"; wallet: string; ts: number; block: number };

/** The highest block each vault's wallets were added up to, per instance; Redis keeps it across them. */
const marks = new Map<string, number>();
const markKey = (network: string, pool: string) => `${PREFIX}chainmark:${network}:${pool.toLowerCase()}`;

/**
 * Adds the public wallets from a vault's events: depositors to everyone, to
 * "deposit" and to their day; cash-out destinations to their own count. Only
 * blocks after the last ones added. Best effort; does nothing without a salt.
 */
export async function addChainPeople(
  vaults: { network: string; pool: string; testnet: boolean; wallets: ChainWallet[] }[],
  now = Date.now()
): Promise<void> {
  const secret = salt();
  if (!secret) return;
  const oldest = utcDay(now - 30 * 86_400_000);
  for (const v of vaults) {
    const mk = markKey(v.network, v.pool);
    let mark = marks.get(mk);
    if (mark === undefined) {
      const [stored] = await kv([["GET", mk]]);
      mark = Number(stored) || 0;
    }
    // an event whose time is not read yet waits, with everything after it, for a later pass
    const unknown = Math.min(Infinity, ...v.wallets.filter((w) => !w.ts).map((w) => w.block));
    const fresh = v.wallets.filter((w) => w.block > mark! && w.block < unknown && w.wallet);
    if (fresh.length === 0) {
      marks.set(mk, mark);
      continue;
    }
    const env: PeopleEnv = v.testnet ? "testnet" : "mainnet";
    const deposit = new Set<string>();
    const cashoutTo = new Set<string>();
    const byDay = new Map<string, Set<string>>();
    for (const w of fresh) {
      const code = personCode(secret, w.wallet);
      if (w.kind === "cashout") {
        cashoutTo.add(code);
        continue;
      }
      deposit.add(code);
      const day = w.ts ? utcDay(w.ts * 1000) : null;
      if (day && day >= oldest) {
        const s = byDay.get(day) ?? new Set<string>();
        s.add(code);
        byDay.set(day, s);
      }
    }
    const cmds: KvCommand[] = [];
    const pfadd = (key: string, codes: Set<string>) => {
      const list = [...codes];
      for (let i = 0; i < list.length; i += CHUNK) cmds.push(["PFADD", key, ...list.slice(i, i + CHUNK)]);
    };
    pfadd(keyAll(env), deposit);
    pfadd(keyAct(env, "deposit"), deposit);
    pfadd(keyAct(env, "cashout_to"), cashoutTo);
    for (const [day, codes] of byDay) {
      pfadd(keyDay(env, day), codes);
      cmds.push(["EXPIRE", keyDay(env, day), DAY_TTL_SEC]);
    }
    const top = Math.max(...fresh.map((w) => w.block));
    cmds.push(["SET", mk, String(top)], ["SET", KEY_SINCE, String(now), "NX"]);
    await kv(cmds);
    marks.set(mk, top);
  }
}

const COUNTED: (PersonAction | ChainOnlyCount)[] = [...PERSON_ACTIONS, "cashout_to"];

function emptySide(now: number): PeopleSide {
  return {
    all: 0,
    allWithCashoutTo: 0,
    today: 0,
    d7: 0,
    d30: 0,
    byAction: Object.fromEntries(COUNTED.map((a) => [a, 0])) as PeopleSide["byAction"],
    daily: days(PEOPLE_DAYS, now).map((day) => ({ day, people: 0 })),
  };
}

/** Both sides' counts, read in one round trip. */
export async function readPeople(now = Date.now()): Promise<PeopleSummary> {
  const configured = peopleConfigured();
  const backend = kvBackend();
  const empty = { configured, backend, since: null, mainnet: emptySide(now), testnet: emptySide(now) };
  if (backend === "none") return empty;
  const last30 = days(30, now);
  const shown = days(PEOPLE_DAYS, now);
  const sideCmds = (env: PeopleEnv): KvCommand[] => [
    ["PFCOUNT", keyAll(env)],
    ["PFCOUNT", keyAll(env), keyAct(env, "cashout_to")],
    ...COUNTED.map((a) => ["PFCOUNT", keyAct(env, a)]),
    ["PFCOUNT", keyDay(env, last30.at(-1)!)],
    ["PFCOUNT", ...last30.slice(-7).map((d) => keyDay(env, d))],
    ["PFCOUNT", ...last30.map((d) => keyDay(env, d))],
    ...shown.map((d) => ["PFCOUNT", keyDay(env, d)]),
  ];
  const per = sideCmds("mainnet").length;
  try {
    const res = await kv([...sideCmds("mainnet"), ...sideCmds("testnet"), ["GET", KEY_SINCE]]);
    const side = (offset: number): PeopleSide => {
      const num = (i: number) => Number(res[offset + i]) || 0;
      let i = 0;
      const all = num(i++);
      const allWithCashoutTo = num(i++);
      const byAction = {} as PeopleSide["byAction"];
      for (const a of COUNTED) byAction[a] = num(i++);
      const today = num(i++);
      const d7 = num(i++);
      const d30 = num(i++);
      const daily = shown.map((day) => ({ day, people: num(i++) }));
      return { all, allWithCashoutTo, today, d7, d30, byAction, daily };
    };
    const since = Number(res.at(-1));
    return { configured, backend, since: Number.isFinite(since) && since > 0 ? since : null, mainnet: side(0), testnet: side(per) };
  } catch {
    return { ...empty, error: "Could not read the people counts." };
  }
}
