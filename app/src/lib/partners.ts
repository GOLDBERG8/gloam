/**
 * The Gloam partner program: partner accounts, fee settings, and the
 * accounting of what each partner's API key brought in. Server only.
 *
 * How fees can work, honestly:
 *  - A private payment hides its amount from everyone, the relay included. So
 *    a partner's fee on one can only be a flat amount per payment.
 *  - Deposits and cash outs cross between a public wallet and the vault, so
 *    their amount is public, and a fee can be a share of it (basis points).
 *  - Collecting a fee for real needs a fee output inside the circuits and the
 *    vault contract, which the mainnet pools do not have yet. So nothing is
 *    charged on any network, mainnet or testnet: this file records what each
 *    partner's key brought in and the fee that would have applied under the
 *    partner's setting at the time. The only fee taken on mainnet is Gloam's
 *    own 0.25% on cash outs, kept by the pool.
 *
 * What is recorded per transaction: network, kind, tx hash, time, and for
 * public edges only the asset and amount (both already on chain). Never a note,
 * a secret, a recipient of a private send, or a private amount.
 *
 * Storage (lib/partnersKv), all under gloam:partners:v1:
 *   partner:<id>            partner record (JSON)
 *   owner:<address>         partner id for a wallet (one account per wallet)
 *   partners                set of partner ids
 *   tx:<chainId>:<hash>     partner id that a transaction is attributed to
 *   events:<id>             newest-first list of activity records (capped)
 *   stats:<id> / stats:all  running counters (see STAT_FIELDS below)
 *   day:<id|all>:<YYYY-MM-DD>  per-day counters, kept 120 days
 */
import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { loadEthUsd } from "./live-quotes";
import { getNetwork, isNetworkKey, NETWORK_KEYS, type GloamNetwork, type NetworkKey } from "./networks";
import { cleanText } from "./paymentNote";
import { hashNumbers, jsonOf, k, kv, kv1 } from "./partnersKv";
import { randomId } from "./apiKeys";
import { shieldTokensFor, supportsNativeShield } from "./tokens";

// ---------------------------------------------------------------- fees

export type PartnerFees = {
  /** Flat fee per private payment, in US cents. */
  privatePaymentCents: number;
  /** Share of each cash out, in basis points (1 bp = 0.01%). */
  cashoutBps: number;
  /** Share of each deposit, in basis points. */
  depositBps: number;
};

export const FEE_LIMITS: Record<keyof PartnerFees, { min: number; max: number }> = {
  privatePaymentCents: { min: 0, max: 100 },
  cashoutBps: { min: 0, max: 100 },
  depositBps: { min: 0, max: 100 },
};

export const DEFAULT_FEES: PartnerFees = { privatePaymentCents: 0, cashoutBps: 0, depositBps: 0 };

export class PartnerError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "bad_request"
  ) {
    super(message);
  }
}

/** Whole numbers inside FEE_LIMITS, or a plain-language reason. */
export function validateFees(input: unknown, base: PartnerFees = DEFAULT_FEES): PartnerFees {
  if (input == null) return { ...base };
  if (typeof input !== "object") throw new PartnerError("Fees must be an object.", 400, "bad_fees");
  const raw = input as Record<string, unknown>;
  const out: PartnerFees = { ...base };
  for (const field of Object.keys(FEE_LIMITS) as (keyof PartnerFees)[]) {
    if (raw[field] === undefined) continue;
    const v = typeof raw[field] === "string" && raw[field] !== "" ? Number(raw[field]) : raw[field];
    const { min, max } = FEE_LIMITS[field];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
      const what =
        field === "privatePaymentCents"
          ? `The fee per private payment must be a whole number of cents from ${min} to ${max}.`
          : `The ${field === "cashoutBps" ? "cash out" : "deposit"} fee must be a whole number of basis points from ${min} to ${max} (${max / 100}%).`;
      throw new PartnerError(what, 400, "bad_fees");
    }
    out[field] = v;
  }
  return out;
}

export type EdgeAmount = {
  /** Smallest units, as on chain. */
  amount: bigint;
  decimals: number;
  /** USD per whole token, in micro-dollars; null when there is no price. */
  priceMicros: bigint | null;
};

export type Commission = {
  /** Would-be fee in micro-dollars, null when a public edge has no price. */
  feeUsdMicros: bigint | null;
  /** Would-be fee in the transaction's own token (smallest units); public edges only. */
  feeToken: bigint | null;
  /** USD value of a public edge in micro-dollars; null for private payments or no price. */
  volumeUsdMicros: bigint | null;
};

export type ActivityKind = "private_payment" | "cash_out" | "deposit";
export const ACTIVITY_KINDS: ActivityKind[] = ["private_payment", "cash_out", "deposit"];

/** The fee a partner's setting puts on one transaction. Pure; rounds down. */
export function commissionFor(kind: ActivityKind, fees: PartnerFees, edge?: EdgeAmount | null): Commission {
  if (kind === "private_payment") {
    return { feeUsdMicros: BigInt(fees.privatePaymentCents) * 10_000n, feeToken: null, volumeUsdMicros: null };
  }
  if (!edge || edge.amount < 0n) return { feeUsdMicros: null, feeToken: null, volumeUsdMicros: null };
  const bps = BigInt(kind === "cash_out" ? fees.cashoutBps : fees.depositBps);
  const feeToken = (edge.amount * bps) / 10_000n;
  if (edge.priceMicros == null) return { feeUsdMicros: null, feeToken, volumeUsdMicros: null };
  const volumeUsdMicros = (edge.amount * edge.priceMicros) / 10n ** BigInt(edge.decimals);
  return { feeUsdMicros: (volumeUsdMicros * bps) / 10_000n, feeToken, volumeUsdMicros };
}

/** Smallest units to micro-units (six decimals), so token sums fit a 64-bit counter. */
export function toMicroUnits(raw: bigint, decimals: number): bigint {
  return decimals >= 6 ? raw / 10n ** BigInt(decimals - 6) : raw * 10n ** BigInt(6 - decimals);
}

/** "$0.05 per private payment", "0.25% of each cash out". */
export function describeFee(kind: ActivityKind, fees: PartnerFees): string {
  if (kind === "private_payment") return `$${(fees.privatePaymentCents / 100).toFixed(2)} per private payment`;
  const bps = kind === "cash_out" ? fees.cashoutBps : fees.depositBps;
  return `${(bps / 100).toFixed(2)}% of each ${kind === "cash_out" ? "cash out" : "deposit"}`;
}

// ---------------------------------------------------------------- assets + prices

export type AssetInfo = { symbol: string; decimals: number; stable: boolean };

/** A public-edge asset Gloam knows on a network: listed tokens, plus the native coin where it shields. */
export function assetInfo(net: GloamNetwork, asset: Address): AssetInfo | null {
  const a = asset.toLowerCase();
  if (a === zeroAddress) {
    return supportsNativeShield(net.chainId)
      ? { symbol: net.primaryAsset.symbol, decimals: net.primaryAsset.decimals, stable: false }
      : null;
  }
  const t = shieldTokensFor(net.chainId).find((x) => x.address.toLowerCase() === a);
  return t ? { symbol: t.symbol, decimals: t.decimals, stable: t.kind === "stablecoin" } : null;
}

let ethPrice: { at: number; micros: bigint | null } | null = null;

/**
 * USD per whole token in micro-dollars, at the time of the transaction.
 * Stablecoins count as $1; ETH from the price feed the app already uses
 * (cached five minutes); stock tokens and unknown tokens are left unpriced.
 */
export async function priceMicrosFor(info: AssetInfo | null): Promise<bigint | null> {
  if (!info) return null;
  if (info.stable) return 1_000_000n;
  if (info.symbol !== "ETH") return null;
  if (!ethPrice || Date.now() - ethPrice.at > 5 * 60_000) {
    const usd = await loadEthUsd().catch(() => null);
    ethPrice = { at: Date.now(), micros: usd && usd > 0 ? BigInt(Math.round(usd * 1e6)) : null };
  }
  return ethPrice.micros;
}

// ---------------------------------------------------------------- partners

export type PayoutAddresses = Partial<Record<NetworkKey, Address>>;

export type Partner = {
  id: string;
  /** The wallet that signs in, lowercase. */
  owner: Address;
  name: string;
  website: string | null;
  /** Where fees would be paid, per network. */
  payout: PayoutAddresses;
  fees: PartnerFees;
  createdAt: number;
  updatedAt: number;
};

export const PARTNER_NAME_MAX = 60;

export function cleanPartnerName(raw: unknown): string {
  return cleanText(typeof raw === "string" ? raw : "", PARTNER_NAME_MAX);
}

/** An http(s) URL, normalized, or null for empty. Throws on anything else. */
export function cleanWebsite(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") throw new PartnerError("The website must be a link.", 400, "bad_website");
  const s = raw.trim();
  if (!s) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new PartnerError("That website does not look like a link.", 400, "bad_website");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PartnerError("The website must start with https://.", 400, "bad_website");
  }
  if (url.username || url.password || !url.hostname.includes(".")) {
    throw new PartnerError("That website does not look like a link.", 400, "bad_website");
  }
  const out = url.toString().replace(/\/$/, "");
  if (out.length > 200) throw new PartnerError("That link is too long.", 400, "bad_website");
  return out;
}

/** Checksummed payout addresses per known network. Empty strings clear one. */
export function validatePayout(input: unknown, base: PayoutAddresses = {}): PayoutAddresses {
  if (input == null) return { ...base };
  if (typeof input !== "object") throw new PartnerError("Payout addresses must be an object.", 400, "bad_payout");
  const out: PayoutAddresses = { ...base };
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isNetworkKey(key)) throw new PartnerError(`Unknown network "${key.slice(0, 24)}".`, 400, "bad_payout");
    if (value === null || value === "") {
      delete out[key];
      continue;
    }
    if (typeof value !== "string" || !isAddress(value.trim(), { strict: false }) || value.trim().toLowerCase() === zeroAddress) {
      throw new PartnerError(`The ${getNetwork(key).label} payout address is not a valid wallet address.`, 400, "bad_payout");
    }
    out[key] = getAddress(value.trim());
  }
  return out;
}

export async function getPartner(id: string): Promise<Partner | null> {
  if (!/^ptr_[A-Za-z0-9]{6,32}$/.test(id)) return null;
  return jsonOf<Partner>(await kv1(["GET", k("partner", id)]));
}

export async function getPartnerByOwner(owner: string): Promise<Partner | null> {
  const id = await kv1(["GET", k("owner", owner.toLowerCase())]);
  return typeof id === "string" ? getPartner(id) : null;
}

export type PartnerInput = {
  name?: unknown;
  website?: unknown;
  payout?: unknown;
  fees?: unknown;
};

/** Creates the wallet's partner account, or updates it. */
export async function upsertPartner(owner: Address, input: PartnerInput): Promise<Partner> {
  const existing = await getPartnerByOwner(owner);
  const now = Date.now();
  const name = input.name === undefined && existing ? existing.name : cleanPartnerName(input.name);
  if (name.length < 2) throw new PartnerError("Add your app's name (at least two characters).", 400, "bad_name");
  const website = input.website === undefined && existing ? existing.website : cleanWebsite(input.website);
  const payout = validatePayout(input.payout, existing?.payout ?? {});
  const fees = validateFees(input.fees, existing?.fees ?? DEFAULT_FEES);

  if (existing) {
    const next: Partner = { ...existing, name, website, payout, fees, updatedAt: now };
    await kv1(["SET", k("partner", existing.id), JSON.stringify(next)]);
    return next;
  }
  const partner: Partner = {
    id: randomId("ptr"),
    owner: owner.toLowerCase() as Address,
    name,
    website,
    payout,
    fees,
    createdAt: now,
    updatedAt: now,
  };
  const [claimed] = await kv([["SET", k("owner", partner.owner), partner.id, "NX"]]);
  if (claimed !== "OK") {
    // Two tabs signed up at once: keep the first account.
    const first = await getPartnerByOwner(owner);
    if (first) return first;
    throw new PartnerError("Could not create the account. Try again.", 500, "internal");
  }
  await kv([
    ["SET", k("partner", partner.id), JSON.stringify(partner)],
    ["SADD", k("partners"), partner.id],
  ]);
  return partner;
}

export async function listPartners(): Promise<Partner[]> {
  const ids = (await kv1(["SMEMBERS", k("partners")])) as string[];
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const raw = await kv(ids.map((id) => ["GET", k("partner", id)]));
  return raw
    .map((r) => jsonOf<Partner>(r))
    .filter((p): p is Partner => Boolean(p))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------- accounting

export type ActivityRecord = {
  id: string;
  kind: ActivityKind;
  network: NetworkKey;
  chainId: number;
  txHash: Hex;
  /** ms since epoch, when Gloam recorded it. */
  ts: number;
  /** The API key that brought it in. */
  keyId: string | null;
  /** Public edges only (deposits, cash outs): what is already on chain. */
  asset: Address | null;
  symbol: string | null;
  decimals: number | null;
  /** Smallest units. */
  amount: string | null;
  volumeUsd: number | null;
  /** Would-be fee in USD (null when a public edge has no price). */
  feeUsd: number | null;
  /** Would-be fee in the transaction's own token, smallest units (public edges). */
  feeToken: string | null;
  /** The setting that produced the fee, e.g. "0.25% of each cash out". */
  feeBasis: string;
};

const EVENTS_MAX = 200;
const DAY_TTL_SEC = 120 * 86_400;
const TX_TTL_SEC = 400 * 86_400;

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const micros = (v: bigint | null): number | null => (v == null ? null : Number(v) / 1e6);

/**
 * Attribute one transaction to a partner and count it. A transaction can be
 * attributed once, to one partner (first claim wins); a second claim returns
 * `duplicate`. Prices are read at the time of recording.
 */
export async function recordActivity(args: {
  partner: Partner;
  keyId: string | null;
  network: GloamNetwork;
  kind: ActivityKind;
  txHash: Hex;
  /** Public edges: the asset and amount the chain shows. */
  edge?: { asset: Address; amount: bigint } | null;
  now?: number;
}): Promise<{ recorded: true; record: ActivityRecord } | { recorded: false; reason: "duplicate" }> {
  const { partner, network: net, kind } = args;
  const now = args.now ?? Date.now();
  const txHash = args.txHash.toLowerCase() as Hex;
  const [claim] = await kv([["SET", k("tx", net.chainId, txHash), partner.id, "NX", "EX", TX_TTL_SEC]]);
  if (claim !== "OK") return { recorded: false, reason: "duplicate" };

  let info: AssetInfo | null = null;
  let edgeAmount: EdgeAmount | null = null;
  if (kind !== "private_payment" && args.edge) {
    info = assetInfo(net, args.edge.asset);
    edgeAmount = {
      amount: args.edge.amount,
      decimals: info?.decimals ?? 18,
      priceMicros: await priceMicrosFor(info),
    };
  }
  const c = commissionFor(kind, partner.fees, edgeAmount);

  const record: ActivityRecord = {
    id: randomId("act"),
    kind,
    network: net.key,
    chainId: net.chainId,
    txHash,
    ts: now,
    keyId: args.keyId,
    asset: kind === "private_payment" || !args.edge ? null : (getAddress(args.edge.asset) as Address),
    symbol: info?.symbol ?? null,
    decimals: info?.decimals ?? null,
    amount: kind === "private_payment" || !args.edge ? null : args.edge.amount.toString(),
    volumeUsd: micros(c.volumeUsdMicros),
    feeUsd: micros(c.feeUsdMicros),
    feeToken: c.feeToken == null ? null : c.feeToken.toString(),
    feeBasis: describeFee(kind, partner.fees),
  };

  const day = utcDay(now);
  const incr: [string, bigint | number][] = [
    [`n:${kind}`, 1],
    [`n:${net.key}:${kind}`, 1],
  ];
  if (c.feeUsdMicros != null) incr.push([`fee:${kind}`, c.feeUsdMicros]);
  if (kind !== "private_payment") {
    if (c.volumeUsdMicros != null) incr.push([`usd:${kind}`, c.volumeUsdMicros]);
    else incr.push([`unpriced:${kind}`, 1]);
    if (args.edge && info) {
      const tag = `${net.chainId}:${args.edge.asset.toLowerCase()}`;
      incr.push([`vt:${tag}:${kind}`, toMicroUnits(args.edge.amount, info.decimals)]);
      if (c.feeToken != null) incr.push([`ft:${tag}:${kind}`, toMicroUnits(c.feeToken, info.decimals)]);
    }
  }
  const dayIncr = incr.filter(([f]) => !f.startsWith("vt:") && !f.startsWith("ft:") && !/^n:[a-z]+:/.test(f));

  const cmds: (string | number)[][] = [
    ["LPUSH", k("events", partner.id), JSON.stringify(record)],
    ["LTRIM", k("events", partner.id), 0, EVENTS_MAX - 1],
  ];
  for (const scope of [partner.id, "all"]) {
    for (const [f, v] of incr) cmds.push(["HINCRBY", k("stats", scope), f, v.toString()]);
    cmds.push(["HSET", k("stats", scope), "last", now]);
    const dayKey = k("day", scope, day);
    for (const [f, v] of dayIncr) cmds.push(["HINCRBY", dayKey, f, v.toString()]);
    cmds.push(["EXPIRE", dayKey, DAY_TTL_SEC]);
  }
  await kv(cmds);
  return { recorded: true, record };
}

/** Who a transaction is attributed to, if anyone. */
export async function attributedTo(chainId: number, txHash: string): Promise<string | null> {
  const v = await kv1(["GET", k("tx", chainId, txHash.toLowerCase())]);
  return typeof v === "string" ? v : null;
}

export type KindTotals = { count: number; volumeUsd: number; commissionUsd: number; unpriced: number };

export type AssetTotals = {
  network: NetworkKey;
  chainId: number;
  asset: Address;
  symbol: string;
  /** Whole tokens, as decimal strings (six places at most). */
  volume: string;
  commission: string;
};

export type DayTotals = {
  day: string;
  privatePayments: number;
  cashOuts: number;
  deposits: number;
  volumeUsd: number;
  commissionUsd: number;
};

export type PartnerStats = {
  totals: {
    privatePayments: number;
    cashOuts: number;
    deposits: number;
    /** USD of priced deposits and cash outs. */
    publicVolumeUsd: number;
    /** Would-be commissions in USD, every kind, priced only. */
    commissionUsd: number;
    /** Deposits and cash outs with no USD price (counted, not valued). */
    unpriced: number;
  };
  byKind: Record<ActivityKind, KindTotals>;
  byNetwork: Record<NetworkKey, Record<ActivityKind, number>>;
  byAsset: AssetTotals[];
  daily: DayTotals[];
  lastActivity: number | null;
};

function microString(v: number): string {
  const neg = v < 0;
  const s = Math.abs(Math.trunc(v)).toString().padStart(7, "0");
  const out = `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, "");
  return (neg ? "-" : "") + (out || "0");
}

export function lastDays(n: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(utcDay(now - i * 86_400_000));
  return out;
}

/** Turns a stats hash (and day hashes) into totals. Pure, for tests. */
export function summarizeStats(
  stats: Record<string, number>,
  days: { day: string; counters: Record<string, number> }[]
): PartnerStats {
  const byKind = {} as Record<ActivityKind, KindTotals>;
  for (const kind of ACTIVITY_KINDS) {
    byKind[kind] = {
      count: stats[`n:${kind}`] ?? 0,
      volumeUsd: (stats[`usd:${kind}`] ?? 0) / 1e6,
      commissionUsd: (stats[`fee:${kind}`] ?? 0) / 1e6,
      unpriced: stats[`unpriced:${kind}`] ?? 0,
    };
  }
  const byNetwork = {} as Record<NetworkKey, Record<ActivityKind, number>>;
  for (const net of NETWORK_KEYS) {
    byNetwork[net] = { private_payment: 0, cash_out: 0, deposit: 0 };
    for (const kind of ACTIVITY_KINDS) byNetwork[net][kind] = stats[`n:${net}:${kind}`] ?? 0;
  }

  const assets = new Map<string, { volume: number; commission: number }>();
  for (const [field, v] of Object.entries(stats)) {
    const m = /^(vt|ft):(\d+):(0x[0-9a-f]{40}):[a-z_]+$/.exec(field);
    if (!m) continue;
    const key = `${m[2]}:${m[3]}`;
    const row = assets.get(key) ?? { volume: 0, commission: 0 };
    if (m[1] === "vt") row.volume += v;
    else row.commission += v;
    assets.set(key, row);
  }
  const byAsset: AssetTotals[] = [];
  for (const [key, row] of assets) {
    const [chain, asset] = key.split(":") as [string, Address];
    const net = NETWORK_KEYS.map(getNetwork).find((n) => String(n.chainId) === chain);
    if (!net) continue;
    byAsset.push({
      network: net.key,
      chainId: net.chainId,
      asset: getAddress(asset),
      symbol: assetInfo(net, asset)?.symbol ?? `${asset.slice(0, 6)}…${asset.slice(-4)}`,
      volume: microString(row.volume),
      commission: microString(row.commission),
    });
  }
  byAsset.sort((a, b) => Number(b.volume) - Number(a.volume));

  const daily: DayTotals[] = days.map(({ day, counters: c }) => ({
    day,
    privatePayments: c["n:private_payment"] ?? 0,
    cashOuts: c["n:cash_out"] ?? 0,
    deposits: c["n:deposit"] ?? 0,
    volumeUsd: ((c["usd:cash_out"] ?? 0) + (c["usd:deposit"] ?? 0)) / 1e6,
    commissionUsd: ACTIVITY_KINDS.reduce((s, kind) => s + (c[`fee:${kind}`] ?? 0), 0) / 1e6,
  }));

  return {
    totals: {
      privatePayments: byKind.private_payment.count,
      cashOuts: byKind.cash_out.count,
      deposits: byKind.deposit.count,
      publicVolumeUsd: byKind.cash_out.volumeUsd + byKind.deposit.volumeUsd,
      commissionUsd: ACTIVITY_KINDS.reduce((s, kind) => s + byKind[kind].commissionUsd, 0),
      unpriced: byKind.cash_out.unpriced + byKind.deposit.unpriced,
    },
    byKind,
    byNetwork,
    byAsset,
    daily,
    lastActivity: stats.last ? stats.last : null,
  };
}

export const STATS_DAYS = 14;

/** Totals, last 14 days, and (optionally) the most recent activity for one partner, or "all". */
export async function readPartnerStats(
  scope: string,
  opts: { recent?: number } = {}
): Promise<PartnerStats & { recent: ActivityRecord[] }> {
  const days = lastDays(STATS_DAYS);
  const recentN = scope === "all" ? 0 : Math.max(0, Math.min(opts.recent ?? 0, EVENTS_MAX));
  const cmds: (string | number)[][] = [["HGETALL", k("stats", scope)], ...days.map((d) => ["HGETALL", k("day", scope, d)])];
  if (recentN > 0) cmds.push(["LRANGE", k("events", scope), 0, recentN - 1]);
  const res = await kv(cmds);
  const stats = hashNumbers(res[0]);
  const dayRows = days.map((day, i) => ({ day, counters: hashNumbers(res[i + 1]) }));
  const recentRaw = recentN > 0 ? (res[days.length + 1] as unknown[]) : [];
  const recent = (Array.isArray(recentRaw) ? recentRaw : [])
    .map((r) => jsonOf<ActivityRecord>(r))
    .filter((r): r is ActivityRecord => Boolean(r));
  return { ...summarizeStats(stats, dayRows), recent };
}

/** Every partner's all-time stats in one round trip, for the admin list. */
export async function readAllPartnerTotals(ids: string[]): Promise<Record<string, PartnerStats["totals"] & { lastActivity: number | null }>> {
  if (ids.length === 0) return {};
  const res = await kv(ids.map((id) => ["HGETALL", k("stats", id)]));
  const out: Record<string, PartnerStats["totals"] & { lastActivity: number | null }> = {};
  ids.forEach((id, i) => {
    const s = summarizeStats(hashNumbers(res[i]), []);
    out[id] = { ...s.totals, lastActivity: s.lastActivity };
  });
  return out;
}

/** What a partner's own record looks like over the wire. */
export function partnerView(p: Partner) {
  return {
    id: p.id,
    owner: getAddress(p.owner),
    name: p.name,
    website: p.website,
    payout: p.payout,
    fees: p.fees,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
