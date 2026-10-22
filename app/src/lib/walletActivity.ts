/**
 * A wallet's public activity on a mainnet, read straight from the chain. The
 * mainnet explorers have no account API Gloam can use (Robinhood Chain's
 * refuses the connection, Tempo has none), so Holdings reads it here instead:
 * every Transfer of the network's listed tokens from or to the wallet, since
 * the vault went live. Deposits and cash-outs show up as transfers to and from
 * the vault, which is all the explorer shows of them too.
 *
 * Runs in the browser against the chain's public RPC, the same one the app
 * already reads balances from; the address goes nowhere else. Logs are read in
 * the chain's own spans through the transparency reader's gate (a range error
 * halves the span), newest rows kept, and cached for the tab so a refresh only
 * reads the blocks since.
 *
 * Not here: plain native-coin transfers (they leave no log) and private
 * transfers, which carry no address by design.
 */

import { parseAbiItem, zeroAddress, type Address } from "viem";
import { clientFor, gated, getLogsSafe, logSpan, ranges } from "@/components/transparency/ledger";
import type { ActivityTx } from "@/hooks/useActivity";
import { FEE_MANAGER } from "./feeSponsor";
import { getNetwork, type NetworkKey } from "./networks";
import { shieldTokensFor } from "./tokens";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** Rows kept per wallet, newest first; the feed pages through them five at a time. */
const KEEP = 40;
const CACHE_PREFIX = "gloam_wallet_activity_v2";
/**
 * Robinhood's RPC takes millions of blocks for one token and one address, but
 * only 100k when several token addresses share a query; Tempo caps every query
 * at 100k either way, so there one query covers all its tokens.
 */
const ONE_TOKEN_PER_QUERY = new Set([4663, 46630]);

type Row = ActivityTx & { block: string; logIndex: number };
type Cached = { scannedTo: string; rows: Row[] };

/** Not activity: burns, and Tempo's network fees, which go to its fee manager. */
const NOT_ACTIVITY = new Set([zeroAddress, FEE_MANAGER.toLowerCase()]);

const memory = new Map<string, Cached>();

function cacheKey(key: NetworkKey, pool: string, address: string) {
  return `${CACHE_PREFIX}:${key}:${pool.toLowerCase()}:${address.toLowerCase()}`;
}

function loadCached(k: string): Cached | null {
  const m = memory.get(k);
  if (m) return m;
  try {
    const raw = window.sessionStorage.getItem(k);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    if (!c || typeof c.scannedTo !== "string" || !Array.isArray(c.rows)) return null;
    memory.set(k, c);
    return c;
  } catch {
    return null;
  }
}

function saveCached(k: string, c: Cached) {
  memory.set(k, c);
  try {
    window.sessionStorage.setItem(k, JSON.stringify(c));
  } catch {
    /* storage full or blocked: memory still has it */
  }
}

const inflight = new Map<string, Promise<{ txs: ActivityTx[] }>>();

/** The wallet's token transfers on a mainnet, newest first. Concurrent callers share one read. */
export function readWalletActivity(key: NetworkKey, address: Address): Promise<{ txs: ActivityTx[] }> {
  const n = getNetwork(key);
  if (!n.pool || n.deployBlock == null) return Promise.resolve({ txs: [] });
  const k = cacheKey(key, n.pool, address);
  const running = inflight.get(k);
  if (running) return running;
  const p = read(key, address, k).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

async function read(key: NetworkKey, address: Address, k: string): Promise<{ txs: ActivityTx[] }> {
  const n = getNetwork(key);
  const c = clientFor(n);
  const id = n.chainId;
  const prev = loadCached(k);
  const latest = await gated(id, () => c.getBlockNumber());
  const resume = prev ? BigInt(prev.scannedTo) + 1n : n.deployBlock!;

  const tokens = shieldTokensFor(id);
  const byAddress = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));
  const groups: Address[][] = ONE_TOKEN_PER_QUERY.has(id) ? tokens.map((t) => [t.address]) : [tokens.map((t) => t.address)];
  const spans = resume <= latest ? ranges(resume, latest, logSpan(n)) : [];

  const fresh: Row[] = [];
  await Promise.all(
    groups.flatMap((addresses) =>
      (["from", "to"] as const).flatMap((side) =>
        spans.map(async ([from, to]) => {
          const logs = await getLogsSafe(
            (a, b) =>
              gated(id, () =>
                c.getLogs({
                  address: addresses.length === 1 ? addresses[0] : addresses,
                  event: TRANSFER,
                  args: side === "from" ? { from: address } : { to: address },
                  fromBlock: a,
                  toBlock: b,
                })
              ),
            from,
            to
          );
          for (const l of logs) {
            const token = byAddress.get(l.address.toLowerCase());
            const { from: src, to: dst, value } = l.args;
            if (!token || !src || !dst || value == null || NOT_ACTIVITY.has(dst.toLowerCase())) continue;
            fresh.push({
              id: `${l.transactionHash}:${l.logIndex}`,
              hash: l.transactionHash ?? "",
              from: src,
              to: dst,
              valueWei: value.toString(),
              timestamp: 0,
              ok: true,
              token: { symbol: token.symbol, decimals: token.decimals },
              block: String(l.blockNumber ?? 0n),
              logIndex: l.logIndex ?? 0,
            });
          }
        })
      )
    )
  );

  // A transfer to the wallet itself matches both sides; keep one of each log.
  const seen = new Set<string>();
  const rows = [...fresh, ...(prev?.rows ?? [])]
    .filter((r) => {
      const key = r.id ?? r.hash;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(BigInt(b.block) - BigInt(a.block)) || b.logIndex - a.logIndex)
    .slice(0, KEEP);

  // No block-time lookups: the feed orders rows by block and shows no times,
  // and up to 40 getBlock calls made its first load slow.
  saveCached(k, { scannedTo: String(latest), rows });
  return { txs: rows };
}
