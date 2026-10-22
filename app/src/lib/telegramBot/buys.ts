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
 *
 * Each buy goes out as the $GLOAM token image (the one on CoinGecko) with the
 * text as its caption. If the photo can't be sent, the same text goes out as
 * a plain post, so a buy is never lost.
 */
import { GLOAM_TOKEN } from "./knowledge";
import { TOPIC } from "./rules";
import { buysLastBlock, setBuysLastBlock, takeBuysSlot } from "./store";
import { CAPTION_MAX, sendMessage, sendPhoto } from "./telegram";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const EXPLORER = "robin.etherscan.io";
/** Checks at least this far apart; with MAX_POSTS that stays under Telegram's 20 posts a minute in a group. */
export const BUY_CHECK_SEC = 30;
/** Blocks read per check; Robinhood Chain makes about 10 a second. */
const MAX_RANGE = 20_000;
/** Further behind than this (the bot was off), it skips ahead instead of posting old buys. */
const MAX_LAG = 60_000;
/** Posts per check. Any more wait for the next check, so every buy gets its own post. */
const MAX_POSTS = 10;

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

/** The $GLOAM token image, as CoinGecko shows it: the mark in ink on paper. */
export const BUY_IMAGE = "https://www.gloam.trade/brand/kit/gloam-avatar-paper.png";

/** The image once Telegram holds it, so later buys don't make it fetch the URL again. Per server instance. */
let buyImageId: string | null = null;

/**
 * Posts one buy: the token image with the text as its caption, or the text on
 * its own if the photo fails. Returns true when either went out.
 */
export async function postBuy(groupId: number, topic: number, text: string): Promise<boolean> {
  if (text.length <= CAPTION_MAX) {
    let sent = await sendPhoto(groupId, buyImageId ?? BUY_IMAGE, text, { threadId: topic });
    // a stale file_id (another bot token, a cleared file): try the URL once
    if (!sent && buyImageId) {
      buyImageId = null;
      sent = await sendPhoto(groupId, BUY_IMAGE, text, { threadId: topic });
    }
    if (sent) {
      if (sent.fileId) buyImageId = sent.fileId;
      return true;
    }
  }
  return (await sendMessage(groupId, text, { threadId: topic })) !== null;
}

/** The group's Buys topic, unless the env names another. */
function buysTopic(): number {
  const fromEnv = Number(process.env.TELEGRAM_BUYS_TOPIC ?? "");
  return Number.isSafeInteger(fromEnv) && fromEnv > 0 ? fromEnv : TOPIC.buys;
}

/**
 * The buys to post now, oldest first: up to `max`, but never splitting a block,
 * so the next check can start at the following block without posting one twice.
 * `until` is the last block taken when some are left over, else null.
 */
export function pickBuys<T extends { block: number }>(buys: T[], max: number): { take: T[]; until: number | null } {
  if (buys.length <= max) return { take: buys, until: null };
  let n = max;
  while (n < buys.length && buys[n]!.block === buys[n - 1]!.block) n++;
  return n < buys.length ? { take: buys.slice(0, n), until: buys[n - 1]!.block } : { take: buys, until: null };
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
    const net = new Map<string, { amount: number; block: number }>();
    for (const l of outs) {
      const cur = net.get(l.transactionHash);
      net.set(l.transactionHash, { amount: (cur?.amount ?? 0) + Number(BigInt(l.data)) / 1e18, block: parseInt(l.blockNumber, 16) });
    }
    for (const l of ins) {
      const cur = net.get(l.transactionHash);
      if (cur) cur.amount -= Number(BigInt(l.data)) / 1e18;
    }
    const found = pickBuys([...net].filter(([, v]) => v.amount > 0.01).map(([tx, v]) => ({ tx, ...v })), MAX_POSTS);
    let posted = 0;
    if (found.take.length) {
      const topic = buysTopic();
      const m = await market();
      const price = m?.price ?? null;
      const floor = minUsd();
      for (const { tx, amount } of found.take) {
        const usd = price !== null ? amount * price : null;
        if (usd !== null && usd < floor) continue;
        const t = await rpc<{ from: string }>("eth_getTransactionByHash", [tx]);
        const b: Buy = { amount, usd, buyer: t?.from ?? "0x0000000000000000000000000000000000000000", tx, price, marketCap: m?.marketCap ?? null };
        if (await postBuy(groupId, topic, buyText(b))) posted++;
      }
    }
    // with buys left over, the next check starts right after the last block posted
    if (found.until !== null) {
      await setBuysLastBlock(found.until);
      return posted;
    }
    await setBuysLastBlock(to);
    return posted;
  } catch (e) {
    console.error("telegram: buy check failed", e instanceof Error ? e.message : "unknown");
    return 0;
  }
}
