/**
 * Daily claim-link totals (see lib/funnel). One small hash per UTC day, kept a
 * year. Nothing but four counters lives here, each also kept per side
 * ("mainnet:link_claimed"). Counts sent before the side was (21 Oct 2026,
 * evening) have none and are read as testnet.
 */
import { kv } from "@/lib/partnersKv";
import { FUNNEL_EVENTS, type FunnelEnv, type FunnelEvent } from "@/lib/funnel";

const PREFIX = "gloam:funnel:v1:";
const TTL_SEC = 400 * 24 * 60 * 60;

export type FunnelCounts = Record<FunnelEvent, number>;

/** One day: every count together, then split into mainnet and testnet. */
export type FunnelDay = { day: string } & FunnelCounts & { mainnet: FunnelCounts; testnet: FunnelCounts };

const zero = (): FunnelCounts => ({ link_created: 0, link_opened: 0, link_claimed: 0, claimer_sent: 0 });

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isFunnelEvent(v: unknown): v is FunnelEvent {
  return typeof v === "string" && (FUNNEL_EVENTS as readonly string[]).includes(v);
}

export async function addFunnel(e: FunnelEvent, env?: FunnelEnv, now = Date.now()): Promise<void> {
  const key = `${PREFIX}${utcDay(now)}`;
  await kv([
    ["HINCRBY", key, e, 1],
    ...(env ? [["HINCRBY", key, `${env}:${e}`, 1]] : []),
    ["EXPIRE", key, TTL_SEC],
  ]);
}

/** The last `days` UTC days, oldest first, zeros where nothing was counted. */
export async function readFunnel(days = 14, now = Date.now()): Promise<FunnelDay[]> {
  const list = Array.from({ length: days }, (_, i) => utcDay(now - (days - 1 - i) * 86_400_000));
  const res = await kv(list.map((d) => ["HGETALL", `${PREFIX}${d}`]));
  return list.map((day, i) => {
    const flat = Array.isArray(res[i]) ? (res[i] as unknown[]) : [];
    const all = zero();
    const mainnet = zero();
    for (let j = 0; j + 1 < flat.length; j += 2) {
      const k = String(flat[j]);
      const v = Number(flat[j + 1]) || 0;
      if (isFunnelEvent(k)) all[k] = v;
      const [side, e] = k.split(":");
      if (isFunnelEvent(e) && side === "mainnet") mainnet[e] = v;
    }
    // Untagged counts (before the split) belong to the testnets.
    const testnet = zero();
    for (const e of FUNNEL_EVENTS) testnet[e] = Math.max(0, all[e] - mainnet[e]);
    return { day, ...all, mainnet, testnet };
  });
}

/** Totals over the rows. */
export function sumFunnel(rows: FunnelDay[]): Record<FunnelEvent, number> {
  const out = { link_created: 0, link_opened: 0, link_claimed: 0, claimer_sent: 0 };
  for (const r of rows) for (const e of FUNNEL_EVENTS) out[e] += r[e];
  return out;
}
