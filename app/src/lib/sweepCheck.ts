/**
 * Before a cash out: does the address look like money sent to it gets taken?
 *
 * Two reads, both public:
 *  - delegated: the address hands control to a contract (EIP-7702: its code is
 *    0xef0100 followed by the contract's address). Many smart wallets do this
 *    on purpose, so the known ones are left out; any other is worth a note.
 *  - swept: money of this token that recently reached the address left again
 *    within a few blocks, in a transaction another account sent. No person
 *    moves money that fast; a sweeper holding the wallet's key does. This is
 *    what happened to a giveaway winner on 22 Oct 2026: the cash out landed
 *    and was gone 7 blocks (under a second) later.
 *
 * Every read fails open: an RPC error means no warning, never a blocked cash out.
 */
import { parseAbiItem, type Address, type Hex } from "viem";
import { getLogsSafe } from "./logRange";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/**
 * Smart-account contracts wallets delegate to on purpose. Each is verified on
 * Ethereum (Sourcify exact match) and has the same code on Robinhood Chain;
 * MetaMask's differs there only in its per-chain EIP-712 immutables.
 */
const KNOWN_DELEGATES = new Set([
  "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b", // MetaMask EIP7702StatelessDeleGator
  "0x5a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d", // Ambire AmbireAccount7702
  "0x000000009b1d0af20d8c6d0a44e162d11f9b8f00", // Uniswap Wallet CaliburEntry
  "0x4cd241e8d1510e30b2076397afc7508ae59c66c9", // eth-infinitism Simple7702Account
]);

/** Left within this many blocks of arriving: about 2 seconds on Robinhood Chain, 11 on Tempo. */
const SWEEP_BLOCKS = BigInt(20);
/** The most recent arrivals looked at. */
const MAX_INBOUND = 3;

/**
 * How far back to look for arrivals: one query of `chunk` blocks, or several
 * where the node caps the range (Tempo's RPC allows 100,000 blocks a query).
 * About 6 days on Robinhood Chain and 2.5 on Tempo.
 */
function lookback(chainId: number): { chunk: bigint; chunks: number } {
  if (chainId === 4217 || chainId === 42431) return { chunk: BigInt(100_000), chunks: 4 };
  return { chunk: BigInt(5_000_000), chunks: 1 };
}

export type SweepCheck = {
  /** Delegated (EIP-7702) to a contract that is not a known wallet. */
  delegated: { delegate: Address } | null;
  /** Money that arrived here left again within seconds, sent by another account. */
  swept: { evidenceTx: Hex } | null;
};

export const SWEEP_CLEAN: SweepCheck = { delegated: null, swept: null };

/** The reads it needs, so a test can hand in a client that fails. */
export type SweepReader = {
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  getBlockNumber(): Promise<bigint>;
  getLogs(args: {
    address: Address;
    event: typeof TRANSFER;
    args: { from?: Address; to?: Address };
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<{ blockNumber: bigint | null; transactionHash: Hex | null }[]>;
  getTransaction(args: { hash: Hex }): Promise<{ from: Address }>;
};

/** The contract an EIP-7702 account delegates to, or null for any other code. */
export function delegateOf(code: Hex | undefined): Address | null {
  if (!code || !code.toLowerCase().startsWith("0xef0100") || code.length !== 2 + 46) return null;
  return `0x${code.slice(8)}` as Address;
}

async function delegatedCheck(client: SweepReader, address: Address): Promise<SweepCheck["delegated"]> {
  try {
    const delegate = delegateOf(await client.getCode({ address }));
    if (!delegate || KNOWN_DELEGATES.has(delegate.toLowerCase())) return null;
    return { delegate };
  } catch {
    return null;
  }
}

async function sweptCheck(
  client: SweepReader,
  chainId: number,
  address: Address,
  token: Address,
  head?: bigint
): Promise<SweepCheck["swept"]> {
  try {
    const to = head ?? (await client.getBlockNumber());
    const { chunk, chunks } = lookback(chainId);
    const inbound: { blockNumber: bigint; transactionHash: Hex }[] = [];
    // newest first, until there are enough arrivals to look at
    for (let i = 0, end = to; i < chunks && inbound.length < MAX_INBOUND && end > BigInt(0); i++) {
      const start = end > chunk ? end - chunk + BigInt(1) : BigInt(0);
      const logs = await getLogsSafe(
        (f, t) => client.getLogs({ address: token, event: TRANSFER, args: { to: address }, fromBlock: f, toBlock: t }),
        start,
        end
      );
      for (const l of logs) {
        if (l.blockNumber != null && l.transactionHash) inbound.push({ blockNumber: l.blockNumber, transactionHash: l.transactionHash });
      }
      end = start - BigInt(1);
    }
    const recent = inbound.sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1)).slice(0, MAX_INBOUND);
    for (const arrival of recent) {
      const out = await client.getLogs({
        address: token,
        event: TRANSFER,
        args: { from: address },
        fromBlock: arrival.blockNumber,
        toBlock: arrival.blockNumber + SWEEP_BLOCKS,
      });
      for (const l of out) {
        // the same transaction both paid in and out: a contract passing it on, not a sweep
        if (!l.transactionHash || l.transactionHash === arrival.transactionHash) continue;
        const tx = await client.getTransaction({ hash: l.transactionHash });
        if (tx.from.toLowerCase() !== address.toLowerCase()) return { evidenceTx: l.transactionHash };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Checks `address` before a cash out of `token` (null: the chain's native coin,
 * whose moves leave no Transfer log, so only the delegation is read).
 * `head` pins the newest block looked at (tests).
 */
export async function checkSweep(
  client: SweepReader,
  chainId: number,
  address: Address,
  token: Address | null,
  opts: { head?: bigint } = {}
): Promise<SweepCheck> {
  const [delegated, swept] = await Promise.all([
    delegatedCheck(client, address),
    token ? sweptCheck(client, chainId, address, token, opts.head) : Promise.resolve(null),
  ]);
  return { delegated, swept };
}
