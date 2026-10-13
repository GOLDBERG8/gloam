/**
 * Daily claim-link totals (see lib/funnel). One small hash per UTC day, kept a
 * year. Nothing but four counters lives here.
 */
import { kv } from "@/lib/partnersKv";
import { FUNNEL_EVENTS, type FunnelEvent } from "@/lib/funnel";

const PREFIX = "gloam:funnel:v1:";
const TTL_SEC = 400 * 24 * 60 * 60;

export type FunnelDay = { day: string } & Record<FunnelEvent, number>;

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isFunnelEvent(v: unknown): v is FunnelEvent {
  return typeof v === "string" && (FUNNEL_EVENTS as readonly string[]).includes(v);
}

export async function addFunnel(e: FunnelEvent, now = Date.now()): Promise<void> {
  const key = `${PREFIX}${utcDay(now)}`;
  await kv([
    ["HINCRBY", key, e, 1],
    ["EXPIRE", key, TTL_SEC],
  ]);
}

/** The last `days` UTC days, oldest first, zeros where nothing was counted. */
export async function readFunnel(days = 14, now = Date.now()): Promise<FunnelDay[]> {
  const list = Array.from({ length: days }, (_, i) => utcDay(now - (days - 1 - i) * 86_400_000));
  const res = await kv(list.map((d) => ["HGETALL", `${PREFIX}${d}`]));
  return list.map((day, i) => {
    const flat = Array.isArray(res[i]) ? (res[i] as unknown[]) : [];
    const row = { day } as FunnelDay;
    for (const e of FUNNEL_EVENTS) row[e] = 0;
    for (let j = 0; j + 1 < flat.length; j += 2) {
      const k = String(flat[j]);
      if (isFunnelEvent(k)) row[k] = Number(flat[j + 1]) || 0;
    }
    return row;
  });
}

/** Totals over the rows. */
export function sumFunnel(rows: FunnelDay[]): Record<FunnelEvent, number> {
  const out = { link_created: 0, link_opened: 0, link_claimed: 0, claimer_sent: 0 };
  for (const r of rows) for (const e of FUNNEL_EVENTS) out[e] += r[e];
  return out;
}
