/**
 * Tester applications for the private testers group (gloam.trade/testers).
 * Server only.
 *
 * Stored in the partner program's store (lib/partnersKv: Upstash Redis in
 * production, in-process locally) under their own prefix. One application per
 * EVM address; applying again with the same address returns the first one.
 *
 * An application holds a name, Telegram and X handles, the network the person
 * wants to test, their device and wallet, a short note, and the EVM address
 * tester rewards are paid to (privately, through Gloam). No IP address is kept
 * with it; the rate limit holds a hashed IP for up to two hours.
 */
import { randomUUID } from "crypto";
import { getAddress, isAddress } from "viem";
import { jsonOf, kv } from "./partnersKv";

const PREFIX = "gloam:testers:v1:";
const LIST = `${PREFIX}list`;
const MAX_APPLICATIONS = 5_000;
/** Paid tester spots, unless GLOAM_TESTERS_CAP says otherwise. Later applicants join as volunteers. */
const DEFAULT_CAP = 31;

const recordKey = (id: string) => `${PREFIX}app:${id}`;
const addressKey = (address: string) => `${PREFIX}addr:${address.toLowerCase()}`;

export const TESTER_NETWORKS = ["both", "tempo", "robinhood"] as const;
export type TesterNetwork = (typeof TESTER_NETWORKS)[number];

export type TesterApplication = {
  id: string;
  name: string;
  telegram: string;
  x: string | null;
  address: `0x${string}`;
  network: TesterNetwork;
  setup: string | null;
  note: string | null;
  /** One of the paid spots. Applications saved before this field existed were all paid. */
  paid?: boolean;
  createdAt: number;
};

export type TesterInput = Omit<TesterApplication, "id" | "createdAt" | "paid">;

/** Paid unless it was saved as a volunteer. */
export function isPaidTester(a: TesterApplication): boolean {
  return a.paid !== false;
}

/** A field the applicant needs to fix, with a message they can act on. */
export class TesterInputError extends Error {
  constructor(
    readonly field: keyof TesterInput,
    message: string,
  ) {
    super(message);
    this.name = "TesterInputError";
  }
}

/** Trimmed single-line text without control characters, cut to `max`. */
function text(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** A handle typed as `@name`, `name` or a profile link, reduced to `name`. */
function bareHandle(v: unknown): string {
  return text(v, 120)
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?(t\.me|telegram\.me|x\.com|twitter\.com)\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
}

export function parseTesterInput(raw: unknown): TesterInput {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const name = text(b.name, 80);
  if (!name) throw new TesterInputError("name", "Add your name.");

  const telegram = bareHandle(b.telegram);
  if (!/^[A-Za-z0-9_]{4,32}$/.test(telegram)) {
    throw new TesterInputError("telegram", "Add your Telegram username, like @yourname. We let you into the group with it.");
  }

  const xRaw = bareHandle(b.x);
  if (xRaw && !/^[A-Za-z0-9_]{1,15}$/.test(xRaw)) {
    throw new TesterInputError("x", "That X handle doesn't look right. Use the part after x.com/.");
  }

  const addressRaw = text(b.address, 64);
  if (!isAddress(addressRaw, { strict: false })) {
    throw new TesterInputError("address", "Add an EVM address that starts with 0x and has 42 characters.");
  }

  const network = TESTER_NETWORKS.includes(b.network as TesterNetwork) ? (b.network as TesterNetwork) : "both";

  return {
    name,
    telegram,
    x: xRaw || null,
    address: getAddress(addressRaw),
    network,
    setup: text(b.setup, 120) || null,
    note: text(b.note, 400) || null,
  };
}

async function readApplication(id: string): Promise<TesterApplication | null> {
  const [raw] = await kv([["GET", recordKey(id)]]);
  return jsonOf<TesterApplication>(raw);
}

async function applicationFor(address: string): Promise<TesterApplication | null> {
  const [id] = await kv([["GET", addressKey(address)]]);
  return typeof id === "string" ? readApplication(id) : null;
}

/** How many paid tester spots there are. */
export function testersCap(): number {
  const n = Number(process.env.GLOAM_TESTERS_CAP);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CAP;
}

/** Paid spots still open. */
export async function paidSpotsLeft(): Promise<number> {
  const cap = testersCap();
  const [ids] = await kv([["LRANGE", LIST, 0, cap - 1]]);
  return Math.max(0, cap - (Array.isArray(ids) ? ids.length : 0));
}

/**
 * Saves an application. When the address already applied, nothing is
 * overwritten and the first application comes back with `duplicate: true`.
 * The first `testersCap()` applications are paid spots; later ones are volunteers.
 */
export async function saveTesterApplication(
  input: TesterInput,
): Promise<{ application: TesterApplication; duplicate: boolean }> {
  const earlier = await applicationFor(input.address);
  if (earlier) return { application: earlier, duplicate: true };

  const application: TesterApplication = { id: randomUUID(), ...input, createdAt: Date.now() };
  const [claimed] = await kv([["SET", addressKey(input.address), application.id, "NX"]]);
  if (claimed === null) {
    const existing = await applicationFor(input.address);
    if (existing) return { application: existing, duplicate: true };
    // the address was claimed but its record never landed: take it over
    await kv([["SET", addressKey(input.address), application.id]]);
  }

  // the list length right after the push is this application's place in line
  const [place] = await kv([["LPUSH", LIST, application.id]]);
  application.paid = Number(place) <= testersCap();
  await kv([
    ["SET", recordKey(application.id), JSON.stringify(application)],
    ["LTRIM", LIST, 0, MAX_APPLICATIONS - 1],
  ]);
  return { application, duplicate: false };
}

/** Applications, newest first. */
/**
 * Applications, newest first. Who is paid comes from the order people applied
 * in: the oldest `testersCap()` are the paid spots, everyone after is a
 * volunteer. That also covers applications saved before the paid flag existed.
 */
export async function listTesterApplications(limit = MAX_APPLICATIONS): Promise<TesterApplication[]> {
  const [ids] = await kv([["LRANGE", LIST, 0, limit - 1]]);
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const raws = await kv(ids.map((id) => ["GET", recordKey(String(id))]));
  const apps = raws.map((r) => jsonOf<TesterApplication>(r)).filter((a): a is TesterApplication => a !== null);
  const cap = testersCap();
  return apps.map((a, i) => ({ ...a, paid: apps.length - 1 - i < cap }));
}

/** The testers group invite, shown only after someone applies. Unset until the group exists. */
export function testersGroupUrl(): string | null {
  const url = process.env.GLOAM_TESTERS_TELEGRAM_URL?.trim();
  return url && /^https:\/\/t\.me\/\S+$/.test(url) ? url : null;
}

const NETWORK_LABEL: Record<TesterNetwork, string> = {
  both: "Both",
  tempo: "Tempo",
  robinhood: "Robinhood Chain",
};

export function testerNetworkLabel(n: TesterNetwork): string {
  return NETWORK_LABEL[n] ?? n;
}

/** A spreadsheet of applications. Cells that start like a formula are quoted as text. */
export function testersCsv(apps: TesterApplication[]): string {
  const cell = (v: string | null) => {
    let s = v ?? "";
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ["Applied (UTC)", "Spot", "Name", "Telegram username", "X handle", "EVM address", "Network", "Device and wallet", "Note"];
  const rows = apps.map((a) =>
    [
      new Date(a.createdAt).toISOString().replace("T", " ").slice(0, 16),
      isPaidTester(a) ? "Paid" : "Volunteer",
      a.name,
      a.telegram,
      a.x,
      a.address,
      testerNetworkLabel(a.network),
      a.setup,
      a.note,
    ].map(cell),
  );
  return [header.map(cell), ...rows].map((r) => r.join(",")).join("\r\n") + "\r\n";
}
