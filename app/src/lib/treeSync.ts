/**
 * Rebuild ShieldPool Merkle tree from on-chain insertions:
 *   - Shielded → one leaf (commitment)
 *   - Transferred → two leaves (payment, change) in that order
 *   - SealedSwapped → two leaves (out, change) in that order
 *
 * Private send only emits Transferred; private trade only SealedSwapped, * ignoring either makes root mismatch after those txs.
 *
 * Where the leaves come from, fastest first:
 *   1. This browser's own copy (memory, then localStorage).
 *   2. Cold start, or an own copy too old to check quickly: the public leaf
 *      list from /api/vault-leaves, one request.
 *   3. Otherwise, or if a copy fails its check: walk the pool's logs from its
 *      deploy block over RPC.
 * A copy (1 or 2) is used only if the tree rebuilt from it has exactly the
 * pool's on-chain root at the copy's last block; whatever came after is read
 * from the chain in the same round trip. The tree is always built here, and
 * the server is never told which notes are this wallet's: the request is the
 * same for everyone.
 */

import type { Address, Hex, PublicClient } from "viem";
import { HASH_SCHEME, shieldPoolAbi } from "./shield";
import { getActiveNetwork, type GloamNetwork } from "./networks";
import { IncrementalMerkleTree } from "./merkle";
import { IncrementalMerkleTreePoseidon } from "./merklePoseidon";
import type { MerklePath } from "./merkle";
import type { PoseidonMerklePath } from "./merklePoseidon";
import { fieldToHex, getPoseidon, hexToField } from "./poseidon";
import { readDemo } from "./demoFlag";
import { demoSyncedTree } from "./demo/chain";
import {
  decodeInserts,
  leafCountOf,
  parseLeafSnapshot,
  sortInserts,
  walkInserts,
  walkTuning,
  type RawInsert,
  type WalkTuning,
} from "./leafIndex";

export type ChainLeaf = {
  leafIndex: number;
  commitment: Hex;
  /** shield | transfer (pay/change) | sealed swap out/change (also "transfer") */
  kind: "shield" | "transfer";
  asset?: Address;
  amount?: bigint;
  from?: Address;
  txHash?: Hex;
  blockNumber?: bigint;
  logIndex?: number;
};

export type SyncedTree = {
  scheme: "keccak" | "poseidon";
  leaves: ChainLeaf[];
  root: Hex;
  leafCount: number;
  /** Look up leaf index by commitment hex */
  indexByCommitment: Map<string, number>;
  pathForLeaf: (
    leafIndex: number
  ) => Promise<MerklePath | PoseidonMerklePath | null>;
  /**
   * True when the sync itself confirmed `root` equals the pool's currentRoot()
   * at the block it synced to, so callers need not ask the chain again.
   */
  verified?: boolean;
};

type OrderedInsert = {
  commitment: Hex;
  kind: "shield" | "transfer";
  asset?: Address;
  amount?: bigint;
  from?: Address;
  txHash?: Hex;
  blockNumber: bigint;
  logIndex: number;
  /** order within same log (0,1 for transfer pair) */
  subIndex: number;
};

// ------------------------------------------------------------------ caches

/** Every insert up to and including `toBlock`; `at` = when saved (ms). */
type PoolLogCache = { toBlock: string; items: RawInsert[]; at?: number };

/**
 * Incremental, persisted log cache per pool. After the first sync every sync
 * (page loads, each payroll payment) only reads blocks since the last one.
 * Concurrent callers share one sync.
 */
const memCache = new Map<string, PoolLogCache>();
const inflight = new Map<string, Promise<SyncedTree | null>>();
const STORE_PREFIX = "gloam.tree.v1:";
/** Give up on /api/vault-leaves after this long and walk the chain instead. */
const SNAPSHOT_TIMEOUT_MS = 6_000;
/**
 * How old an own copy can be before the server's is tried first. A copy is
 * checked against the pool's root at its last block: Robinhood's public RPC
 * keeps only about ten minutes of past state (older needs a slower check), and
 * a Tempo log read spans 100k blocks (about 18 hours).
 */
const OWN_COPY_FRESH_MS: Record<number, number> = {
  46630: 8 * 60_000,
  42431: 6 * 3_600_000,
  4663: 8 * 60_000,
  4217: 6 * 3_600_000,
};
const OWN_COPY_FRESH_DEFAULT_MS = 8 * 60_000;

function readPersisted(key: string): PoolLogCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as PoolLogCache;
    return v && typeof v.toBlock === "string" && Array.isArray(v.items) ? v : null;
  } catch {
    return null;
  }
}

function writePersisted(key: string, cache: PoolLogCache) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify(cache));
  } catch {
    /* quota or private mode: in-memory cache still works */
  }
}

function dropCache(key: string) {
  memCache.delete(key);
  try {
    window.localStorage.removeItem(STORE_PREFIX + key);
  } catch {
    /* ignore */
  }
}

let poseidonWarm: Promise<unknown> | null = null;

/** Load the Poseidon hasher once, early, so it is ready when the leaves arrive. */
function warmPoseidon(): Promise<unknown> | null {
  if (HASH_SCHEME !== "poseidon") return null;
  poseidonWarm ??= getPoseidon().catch(() => {
    poseidonWarm = null;
  });
  return poseidonWarm;
}

/**
 * Load the hasher once the reads are on the wire: loading it holds the main
 * thread for a moment, which would otherwise delay sending them.
 */
function warmPoseidonSoon() {
  if (HASH_SCHEME === "poseidon" && !poseidonWarm) setTimeout(() => void warmPoseidon(), 0);
}

/** Drop this browser's copy for the active pool (the next sync starts over). */
export function resetTreeCache() {
  const net = getActiveNetwork();
  if (!net.pool) return;
  dropCache(`${net.chainId}:${net.pool.toLowerCase()}`);
}

/**
 * The public leaf list from /api/vault-leaves, or null if it is unavailable,
 * slow, malformed or for another pool. Sends only the network name.
 */
async function fetchLeafSnapshot(net: GloamNetwork, pool: Address): Promise<PoolLogCache | null> {
  if (typeof window === "undefined" || typeof fetch !== "function") return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SNAPSHOT_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/vault-leaves?network=${net.key}`, {
      signal: ctrl.signal,
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const snap = parseLeafSnapshot(await res.json(), net.chainId, pool);
    return snap ? { toBlock: snap.toBlock, items: snap.items, at: snap.at } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ sync

export function syncShieldTree(client: PublicClient): Promise<SyncedTree | null> {
  // Recording demo: the pretend wallet's tree, nothing read from the chain.
  if (readDemo()) return Promise.resolve(demoSyncedTree());
  const net = getActiveNetwork();
  const pool = net.pool;
  if (!pool) return Promise.resolve(null);
  const key = `${net.chainId}:${pool.toLowerCase()}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = syncOnce(client, key, net, pool).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** The pool's root at `block`, or null when the node cannot serve state there. */
async function rootAt(client: PublicClient, pool: Address, block: bigint): Promise<Hex | null> {
  try {
    return (await client.readContract({
      address: pool,
      abi: shieldPoolAbi,
      functionName: "currentRoot",
      blockNumber: block,
    })) as Hex;
  } catch {
    return null;
  }
}

function sameHex(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/**
 * Fallback check when the node cannot serve state at a past block: a root the
 * pool has produced, with a leaf count not behind the pool's.
 */
async function knownAndCurrent(client: PublicClient, pool: Address, tree: SyncedTree): Promise<boolean> {
  try {
    const [known, next] = await Promise.all([
      client.readContract({ address: pool, abi: shieldPoolAbi, functionName: "isKnownRoot", args: [tree.root] }),
      client.readContract({ address: pool, abi: shieldPoolAbi, functionName: "nextIndex" }),
    ]);
    return Boolean(known) && BigInt(tree.leafCount) >= (next as bigint);
  } catch {
    return false;
  }
}

/**
 * Inserts after `from - 1` up to the chain head, in one read where the node
 * allows it. If it does not (the gap is wider than one read, or `from` is past
 * this node's head), walk to the head block number read at the start of sync.
 */
async function readTail(
  client: PublicClient,
  pool: Address,
  from: bigint,
  tuning: WalkTuning,
  latest: Promise<bigint>
): Promise<RawInsert[]> {
  try {
    const logs = await client.getLogs({ address: pool, fromBlock: from, toBlock: "latest" });
    return sortInserts(decodeInserts(logs));
  } catch {
    const head = await latest;
    return from > head ? [] : walkInserts(client, pool, from, head, tuning);
  }
}

/**
 * Use a saved copy (own or the server's) if it checks out: the root of its
 * leaves must be the pool's root at the copy's toBlock, read alongside the
 * inserts since. When nothing was inserted since, the tree is the pool's
 * current one; otherwise the full root is checked at the newest insert's block.
 * Null when the copy does not match the pool; throws when the chain could not
 * be read (the copy may still be good).
 */
async function fromBase(
  client: PublicClient,
  pool: Address,
  base: PoolLogCache,
  tuning: WalkTuning,
  latest: Promise<bigint>
): Promise<{ tree: SyncedTree; cache: PoolLogCache } | null> {
  const baseTo = BigInt(base.toBlock);
  const prefix = base.items.filter((r) => BigInt(r.bn) <= baseTo);
  const baseRootP = rootAt(client, pool, baseTo);
  const tailP = readTail(client, pool, baseTo + 1n, tuning, latest);
  warmPoseidonSoon();
  const tail = await tailP;
  const items = prefix.concat(tail);
  try {
    const { tree, checkpointRoot } = await buildTree(items, leafCountOf(prefix));
    const baseRoot = await baseRootP;
    const lastBn = tail.length ? BigInt(tail[tail.length - 1]!.bn) : baseTo;
    if (baseRoot) {
      if (!sameHex(baseRoot, checkpointRoot)) return null;
      if (tail.length === 0) {
        tree.verified = true;
      } else {
        const root = await rootAt(client, pool, lastBn);
        if (root && !sameHex(root, tree.root)) return null;
        tree.verified = Boolean(root);
      }
    } else if (!(await knownAndCurrent(client, pool, tree))) {
      return null;
    }
    const head = await latest.catch(() => null);
    const toBlock = head != null && head > lastBn ? head : lastBn;
    return { tree, cache: { toBlock: toBlock.toString(), items, at: Date.now() } };
  } catch {
    return null;
  }
}

async function syncOnce(
  client: PublicClient,
  key: string,
  net: GloamNetwork,
  pool: Address
): Promise<SyncedTree | null> {
  const deployBlock = net.deployBlock ?? 0n;
  const tuning = walkTuning(net.chainId, net.logRange);
  const local = memCache.get(key) ?? readPersisted(key);
  // Only fallbacks wait on the head; reading it now also opens the connection.
  const latest = client.getBlockNumber({ cacheTime: 0 });
  latest.catch(() => undefined);

  type Source = { load: () => Promise<PoolLogCache | null>; own?: boolean };
  let serverCopy: Promise<PoolLogCache | null> | null = null;
  const server: Source = { load: () => (serverCopy ??= fetchLeafSnapshot(net, pool)) };
  const sources: Source[] = [server];
  if (local) {
    const own: Source = { load: async () => local, own: true };
    const maxAge = OWN_COPY_FRESH_MS[net.chainId] ?? OWN_COPY_FRESH_DEFAULT_MS;
    const fresh = local.at != null && Date.now() - local.at < maxAge;
    if (fresh) sources.unshift(own);
    else sources.push(own);
  }
  if (sources[0] === server) void server.load();

  for (const src of sources) {
    const base = await src.load();
    if (!base) continue;
    const done = await fromBase(client, pool, base, tuning, latest).catch(() => undefined);
    if (done) {
      memCache.set(key, done.cache);
      writePersisted(key, done.cache);
      return done.tree;
    }
    // A saved copy that no longer adds up: never start from it again.
    if (done === null && src.own) dropCache(key);
  }

  // Ground truth: every insert since the pool was deployed.
  const head = await latest;
  const onchainRoot = rootAt(client, pool, head);
  const itemsP = walkInserts(client, pool, deployBlock, head, tuning);
  warmPoseidonSoon();
  const items = await itemsP;
  const { tree } = await buildTree(items);
  // Matched here, callers can skip their own check; otherwise they still make it.
  if (sameHex(await onchainRoot, tree.root)) tree.verified = true;
  const cache = { toBlock: head.toString(), items, at: Date.now() };
  memCache.set(key, cache);
  writePersisted(key, cache);
  return tree;
}

/**
 * Rebuild the tree from inserts. `checkpointRoot` is the root after the first
 * `checkpointAt` leaves (the saved copy's part), for checking that copy.
 */
async function buildTree(
  items: RawInsert[],
  checkpointAt = -1
): Promise<{ tree: SyncedTree; checkpointRoot: Hex | null }> {
  const inserts: OrderedInsert[] = [];
  for (const r of items) {
    const blockNumber = BigInt(r.bn);
    r.c.forEach((commitment, subIndex) => {
      inserts.push({
        commitment,
        kind: r.k === "s" ? "shield" : "transfer",
        asset: r.k === "s" ? r.a : subIndex === 0 ? r.a : undefined,
        amount: r.k === "s" && r.v != null ? BigInt(r.v) : undefined,
        from: r.k === "s" ? r.f : undefined,
        txHash: r.tx,
        blockNumber,
        logIndex: r.li,
        subIndex,
      });
    });
  }

  inserts.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber)
      return a.blockNumber < b.blockNumber ? -1 : 1;
    if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
    return a.subIndex - b.subIndex;
  });

  const leaves: ChainLeaf[] = [];
  const indexByCommitment = new Map<string, number>();

  if (HASH_SCHEME === "poseidon") {
    await warmPoseidon();
    const tree = new IncrementalMerkleTreePoseidon();
    await tree.init();
    let checkpointRoot: Hex | null = checkpointAt === 0 ? fieldToHex(tree.currentRoot) : null;
    for (const ins of inserts) {
      const leafIndex = tree.nextIndex;
      await tree.insert(hexToField(ins.commitment));
      if (tree.nextIndex === checkpointAt) checkpointRoot = fieldToHex(tree.currentRoot);
      leaves.push({
        leafIndex,
        commitment: ins.commitment,
        kind: ins.kind,
        asset: ins.asset,
        amount: ins.amount,
        from: ins.from,
        txHash: ins.txHash,
        blockNumber: ins.blockNumber,
        logIndex: ins.logIndex,
      });
      indexByCommitment.set(ins.commitment.toLowerCase(), leafIndex);
    }
    return {
      checkpointRoot,
      tree: {
        scheme: "poseidon",
        leaves,
        root: fieldToHex(tree.currentRoot),
        leafCount: tree.nextIndex,
        indexByCommitment,
        pathForLeaf: async (i) => {
          try {
            return await tree.path(i);
          } catch {
            return null;
          }
        },
      },
    };
  }

  const tree = new IncrementalMerkleTree();
  let checkpointRoot: Hex | null = checkpointAt === 0 ? tree.currentRoot : null;
  for (const ins of inserts) {
    const leafIndex = tree.nextIndex;
    tree.insert(ins.commitment);
    if (tree.nextIndex === checkpointAt) checkpointRoot = tree.currentRoot;
    leaves.push({
      leafIndex,
      commitment: ins.commitment,
      kind: ins.kind,
      asset: ins.asset,
      amount: ins.amount,
      from: ins.from,
      txHash: ins.txHash,
      blockNumber: ins.blockNumber,
      logIndex: ins.logIndex,
    });
    indexByCommitment.set(ins.commitment.toLowerCase(), leafIndex);
  }

  return {
    checkpointRoot,
    tree: {
      scheme: "keccak",
      leaves,
      root: tree.currentRoot,
      leafCount: tree.nextIndex,
      indexByCommitment,
      pathForLeaf: async (i) => {
        try {
          return tree.path(i);
        } catch {
          return null;
        }
      },
    },
  };
}

export async function assertTreeMatchesChain(
  client: PublicClient,
  synced: SyncedTree
): Promise<boolean> {
  if (readDemo()) return true;
  const pool = getActiveNetwork().pool;
  if (!pool) return false;
  const onchain = (await client.readContract({
    address: pool,
    abi: shieldPoolAbi,
    functionName: "currentRoot",
  })) as Hex;
  return onchain.toLowerCase() === synced.root.toLowerCase();
}
