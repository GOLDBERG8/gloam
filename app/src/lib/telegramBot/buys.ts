/**
 * $GLOAM buy alerts in the group's Buys topic. Every token leaving the Uniswap
 * v4 PoolManager on Robinhood Chain is someone buying (the launch liquidity is
 * locked, so nothing else takes $GLOAM out), so the helper reads those
 * transfers, adds them up per transaction, and posts each buy with its rough
 * dollar value from DEX Screener. No model call, no price talk beyond the
 * value of the buy.
 *
 * It runs after Telegram updates (at most every BUY_CHECK_SEC) and from the
 * once-a-minute cron at /api/telegram/buys. The first run starts at the
 * current block, so it never posts old buys. Every buy is posted, whatever its
 * size (TELEGRAM_BUY_MIN_USD sets a floor). TELEGRAM_BUY_ALERTS=0 turns it
 * off; TELEGRAM_BUYS_TOPIC overrides the Buys topic.
 */
import { GLOAM_TOKEN } from "./knowledge";
import { TOPIC } from "./rules";
import { buysLastBlock, setBuysLastBlock, takeBuysSlot } from "./store";
import { sendMessage } from "./telegram";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const EXPLORER = "robin.etherscan.io";
export const BUY_CHECK_SEC = 20;
/** Blocks read per check; Robinhood Chain makes about 10 a second. */
const MAX_RANGE = 20_000;
/** Further behind than this (the bot was off), it skips ahead instead of posting old buys. */
const MAX_LAG = 60_000;
const MAX_POSTS = 8;

type Log = { transactionHash: string; blockNumber: string; data: string; topics: string[] };

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = (await res.json()) as { result?: T; error?: unknown };
    return j.error ? null : (j.result ?? null);
  } catch {
    return null;
  }
}

type Market = { price: number; marketCap: number | null };

/** $GLOAM's price and market cap, from the deepest pool on DEX Screener. */
async function market(): Promise<Market | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${GLOAM_TOKEN.address}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    const j = (await res.json()) as { pairs?: { priceUsd?: string; marketCap?: number; fdv?: number; liquidity?: { usd?: number } }[] };
    const best = [...(j.pairs ?? [])].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const price = Number(best?.priceUsd);
    if (!Number.isFinite(price) || price <= 0) return null;
    const cap = Number(best?.marketCap ?? best?.fdv);
    return { price, marketCap: Number.isFinite(cap) && cap > 0 ? cap : null };
  } catch {
    return null;
  }
}

export function buyAlertsOn(): boolean {
  return !/^(0|false|no|off)$/i.test(process.env.TELEGRAM_BUY_ALERTS?.trim() ?? "");
}

function minUsd(): number {
  const n = Number(process.env.TELEGRAM_BUY_MIN_USD ?? "");
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

const compact = (n: number) => (n >= 1e6 ? `${fmt(n / 1e6, 2)}M` : n >= 1e3 ? `${fmt(n / 1e3, 1)}K` : fmt(n));

type Buy = { amount: number; usd: number | null; buyer: string; tx: string; price?: number | null; marketCap?: number | null };

/** One buy, spaced like the helper's other posts. */
export function buyText(b: Buy): string {
  const value = b.usd !== null ? `, about $${fmt(b.usd, b.usd < 100 ? 2 : 0)}` : "";
  const stats = [b.price ? `Price $${b.price.toFixed(b.price < 1 ? 4 : 2)}` : "", b.marketCap ? `Market cap $${compact(b.marketCap)}` : ""].filter(Boolean).join("\n");
  return [`New $GLOAM buy`, `${fmt(b.amount)} GLOAM${value}\nBuyer ${short(b.buyer)}`, stats, `Tx: ${EXPLORER}/tx/${b.tx}\nChart: ${GLOAM_TOKEN.chart}`]
    .filter(Boolean)
    .join("\n\n");
}

/** The group's Buys topic, unless the env names another. */
function buysTopic(): number {
  const fromEnv = Number(process.env.TELEGRAM_BUYS_TOPIC ?? "");
  return Number.isSafeInteger(fromEnv) && fromEnv > 0 ? fromEnv : TOPIC.buys;
}

/** Checks for new buys and posts them. Returns how many it posted. Never throws. */
export async function pollBuys(groupId: number, force = false): Promise<number> {
  if (!buyAlertsOn()) return 0;
  try {
    if (!force && !(await takeBuysSlot(BUY_CHECK_SEC))) return 0;
    const headHex = await rpc<string>("eth_blockNumber", []);
    if (!headHex) return 0;
    const head = parseInt(headHex, 16);
    const last = await buysLastBlock();
    if (last === null || head - last > MAX_LAG) {
      await setBuysLastBlock(head);
      return 0;
    }
    if (head <= last) return 0;
    const from = last + 1;
    const to = Math.min(head, from + MAX_RANGE - 1);
    const pm = `0x${POOL_MANAGER.slice(2).padStart(64, "0")}`;
    const range = { address: GLOAM_TOKEN.address, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` };
    const [outs, ins] = await Promise.all([
      rpc<Log[]>("eth_getLogs", [{ ...range, topics: [TRANSFER, pm] }]),
      rpc<Log[]>("eth_getLogs", [{ ...range, topics: [TRANSFER, null, pm] }]),
    ]);
    if (!outs || !ins) return 0;
    // net per transaction: an arbitrage moves $GLOAM in and out of the pools at once and is not a buy
    const net = new Map<string, number>();
    for (const l of outs) net.set(l.transactionHash, (net.get(l.transactionHash) ?? 0) + Number(BigInt(l.data)) / 1e18);
    for (const l of ins) if (net.has(l.transactionHash)) net.set(l.transactionHash, net.get(l.transactionHash)! - Number(BigInt(l.data)) / 1e18);
    const byTx = new Map([...net].filter(([, a]) => a > 0.01));
    let posted = 0;
    if (byTx.size) {
      const topic = buysTopic();
      const m = await market();
      const price = m?.price ?? null;
      const floor = minUsd();
      const buys: Buy[] = [];
      for (const [tx, amount] of byTx) {
        const usd = price !== null ? amount * price : null;
        if (usd !== null && usd < floor) continue;
        const t = await rpc<{ from: string }>("eth_getTransactionByHash", [tx]);
        buys.push({ amount, usd, buyer: t?.from ?? "0x0000000000000000000000000000000000000000", tx, price, marketCap: m?.marketCap ?? null });
      }
      for (const b of buys.slice(0, MAX_POSTS)) if (await sendMessage(groupId, buyText(b), { threadId: topic })) posted++;
      if (buys.length > MAX_POSTS) {
        await sendMessage(groupId, `And ${buys.length - MAX_POSTS} more buys just now.\n\nChart: ${GLOAM_TOKEN.chart}`, { threadId: topic });
      }
    }
    await setBuysLastBlock(to);
    return posted;
  } catch (e) {
    console.error("telegram: buy check failed", e instanceof Error ? e.message : "unknown");
    return 0;
  }
}
