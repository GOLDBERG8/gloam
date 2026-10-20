"use client";

/**
 * Who pays network fees on Tempo, and in what.
 *
 * Tempo has no gas coin: every fee is paid in a USD stablecoin. Gloam makes
 * sure someone holding only OUSD can deposit and cash out. Which path applies
 * depends on how they signed in:
 *
 * 1. Passkey (Tempo Wallet). Every transaction Gloam sends is sponsored: the
 *    wallet asks Tempo's fee payer service to co-sign as fee payer, so the user
 *    pays nothing. If sponsorship is switched off (or the sponsor refuses), the
 *    Tempo Wallet still picks a fee token the user actually holds and that the
 *    fee AMM can settle, so PathUSD is never required.
 *
 * 2. Browser wallet (MetaMask, Rabby, ...). These only send standard Ethereum
 *    transactions, which have no fee payer field, so sponsorship is impossible.
 *    Tempo then charges the account's chosen fee token (FeeManager
 *    `setUserToken`), else PathUSD. When an account has no choice set and not
 *    enough PathUSD, Gloam first asks the wallet to set OUSD (or another held
 *    stablecoin) as its fee token, then sends the original transaction. That
 *    one-time `setUserToken` call pays its own fee in the token it sets, so it
 *    works with zero PathUSD.
 *
 * Path 2 is wired into the browser wallet connector (`tempoFeeAware` in
 * lib/wagmi.ts) so call sites do not change. Path 1 lives in lib/tempoWallet.ts.
 *
 * Path 2 covers Tempo mainnet too, once its pool is filled in: there the
 * candidates are the mainnet pool's stablecoins (USDC.e, USDT0, OUSD after
 * pathUSD). Path 1 (passkeys) is Moderato only.
 */

import {
  createPublicClient,
  encodeFunctionData,
  http,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import type { CreateConnectorFn } from "wagmi";
import { NETWORK_KEYS, tempoMainnet, tempoTestnet } from "./networks";
import { TEMPO_MAINNET_TOKENS, TEMPO_STABLE_TOKENS, type OnchainToken } from "./tokens";

/** Tempo Moderato, where passkeys (Tempo Wallet) and sponsored fees live. */
export const TEMPO_CHAIN_ID = tempoTestnet.id;
export const TEMPO_RPC_URL = tempoTestnet.rpcUrls.default.http[0];

/**
 * The Tempo chains whose browser-wallet sends get a fee token first, with the
 * stablecoins Gloam lists there: Moderato always, mainnet once its pool is in.
 */
const FEE_CHAINS = new Map<number, { chain: Chain; tokens: OnchainToken[] }>([
  [tempoTestnet.id, { chain: tempoTestnet, tokens: TEMPO_STABLE_TOKENS }],
  ...(NETWORK_KEYS.includes("tempo-mainnet")
    ? ([[tempoMainnet.id, { chain: tempoMainnet, tokens: TEMPO_MAINNET_TOKENS }]] as const)
    : []),
]);

/** A Tempo chain Gloam pays fees on with a fee token (Moderato, or mainnet once live). */
export function isTempoFeeChain(chainId: number | undefined): boolean {
  return chainId !== undefined && FEE_CHAINS.has(chainId);
}

// ------------------------------------------------------------------ sponsor

/** Tempo's public Moderato fee payer. No API key; testnet only. */
export const DEFAULT_TEMPO_FEE_PAYER = "https://sponsor.moderato.tempo.xyz";

/**
 * NEXT_PUBLIC_TEMPO_FEE_PAYER: unset uses Tempo's public testnet sponsor, a URL
 * (absolute, or a same-origin path like `/api/sponsor`) points at our own, and
 * `off` turns sponsorship off (passkey users then pay from their own stablecoins).
 */
function readFeePayerUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_TEMPO_FEE_PAYER?.trim();
  if (!raw) return DEFAULT_TEMPO_FEE_PAYER;
  if (/^(off|false|0|none|disabled)$/i.test(raw)) return null;
  return raw;
}

export const TEMPO_FEE_PAYER_URL = readFeePayerUrl();
/** Whether passkey (Tempo Wallet) transactions on Tempo are sponsored. */
export const TEMPO_SPONSORED = TEMPO_FEE_PAYER_URL !== null;

// ------------------------------------------------------------------ fee token

/** Tempo FeeManager precompile (fee token preferences). */
export const FEE_MANAGER: Address = "0xfeec000000000000000000000000000000000000";
export const PATH_USD: Address = "0x20c0000000000000000000000000000000000000";

const OUSD_TOKEN = TEMPO_STABLE_TOKENS.find((t) => t.id === "ousd")!;
export const OUSD: Address = OUSD_TOKEN.address as Address;

export const feeManagerAbi = [
  {
    name: "userTokens",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address", name: "user" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "setUserToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "token" }],
    outputs: [],
  },
] as const;

const balanceOfAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address", name: "account" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** TIP-20 calls whose own token pays the fee when no preference is set. */
const SELF_PAYING_SELECTORS = new Set<string>([
  toFunctionSelector("transfer(address,uint256)"),
  toFunctionSelector("transferWithMemo(address,uint256,bytes32)"),
]);

const clients = new Map<number, PublicClient>();
function tempoClient(chainId: number = TEMPO_CHAIN_ID): PublicClient {
  const hit = clients.get(chainId);
  if (hit) return hit;
  const chain = FEE_CHAINS.get(chainId)?.chain ?? tempoTestnet;
  const c = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  }) as PublicClient;
  clients.set(chainId, c);
  return c;
}

function sameAddress(a: string | undefined | null, b: string | undefined | null) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/** Symbol for a Tempo stablecoin address, if it is one we list (on `chainId` first). */
export function tempoStableSymbol(token: string | null | undefined, chainId: number = TEMPO_CHAIN_ID): string | null {
  const lists = [FEE_CHAINS.get(chainId)?.tokens ?? [], TEMPO_STABLE_TOKENS, TEMPO_MAINNET_TOKENS];
  for (const list of lists) {
    const hit = list.find((t) => sameAddress(t.address, token));
    if (hit) return hit.symbol;
  }
  return null;
}

/** The account's fee token preference on Tempo, or null when none is set. */
export async function readFeeToken(address: Address, chainId: number = TEMPO_CHAIN_ID): Promise<Address | null> {
  const token = await tempoClient(chainId).readContract({
    address: FEE_MANAGER,
    abi: feeManagerAbi,
    functionName: "userTokens",
    args: [address],
  });
  return sameAddress(token, zeroAddress) ? null : token;
}

/** Calldata for FeeManager.setUserToken(token), OUSD by default. */
export function setFeeTokenData(token: Address = OUSD): Hex {
  return encodeFunctionData({
    abi: feeManagerAbi,
    functionName: "setUserToken",
    args: [token],
  });
}

/**
 * A generous fee budget: 5M gas at twice the current price, floored at one
 * cent. Fees are in attodollars per gas; TIP-20 units are microdollars (1e-6),
 * so microdollars = gas * price / 1e12.
 */
function feeBudget(gasPrice: bigint): bigint {
  const budget = (5_000_000n * gasPrice * 2n) / 10n ** 12n;
  return budget > 10_000n ? budget : 10_000n;
}

export type FeeTokenPlan =
  | { action: "none"; reason: "preference-set" | "pathusd-covers" | "no-funds" }
  | { action: "set"; token: Address; symbol: string };

/**
 * Decides whether a browser wallet needs a fee token set before it can send on
 * Tempo: only when it has no preference and its PathUSD cannot cover a fee.
 * On Moderato it prefers OUSD, then any other listed stablecoin that covers the
 * budget; on mainnet it goes down the pool's list (USDC.e, USDT0, OUSD).
 */
export async function planFeeToken(address: Address, chainId: number = TEMPO_CHAIN_ID): Promise<FeeTokenPlan> {
  const c = tempoClient(chainId);
  if (await readFeeToken(address, chainId)) return { action: "none", reason: "preference-set" };
  const candidates: OnchainToken[] =
    chainId === TEMPO_CHAIN_ID
      ? [OUSD_TOKEN, ...TEMPO_STABLE_TOKENS.filter((t) => t.id !== "ousd")]
      : (FEE_CHAINS.get(chainId)?.tokens ?? []);
  const [gasPrice, ...balances] = await Promise.all([
    c.getGasPrice(),
    ...candidates.map((t) =>
      c.readContract({
        address: t.address as Address,
        abi: balanceOfAbi,
        functionName: "balanceOf",
        args: [address],
      })
    ),
  ]);
  const need = feeBudget(gasPrice);
  const pathIdx = candidates.findIndex((t) => sameAddress(t.address, PATH_USD));
  if (pathIdx >= 0 && balances[pathIdx] >= need) {
    return { action: "none", reason: "pathusd-covers" };
  }
  for (let i = 0; i < candidates.length; i++) {
    if (i === pathIdx) continue;
    if (balances[i] >= need) {
      return { action: "set", token: candidates[i].address as Address, symbol: candidates[i].symbol };
    }
  }
  return { action: "none", reason: "no-funds" };
}

// ------------------------------------------------------------------ browser wallets

type RequestArgs = { method: string; params?: unknown };
type Eip1193Like = { request: (args: RequestArgs) => Promise<unknown> };
type TxParams = { from?: string; to?: string; data?: string; input?: string; chainId?: string | number };

/** Accounts known to have a fee token set this session, per chain (no need to re-read). */
const settled = new Set<string>();
const pending = new Map<string, Promise<void>>();

/** The Tempo chain a transaction goes to, or null when it is not one Gloam handles fees on. */
async function tempoTxChain(provider: Eip1193Like, tx: TxParams): Promise<number | null> {
  if (tx.chainId !== undefined && tx.chainId !== null) {
    const id = Number(tx.chainId);
    return isTempoFeeChain(id) ? id : null;
  }
  const raw = await provider.request({ method: "eth_chainId" }).catch(() => null);
  if (raw === null) return null;
  const id = Number(raw);
  return isTempoFeeChain(id) ? id : null;
}

/** True for transactions that already settle their own fee token question. */
function skipsFeeCheck(tx: TxParams): boolean {
  if (sameAddress(tx.to, FEE_MANAGER)) return true;
  const data = (tx.data ?? tx.input ?? "").toLowerCase();
  const isStable = [...TEMPO_STABLE_TOKENS, ...TEMPO_MAINNET_TOKENS].some((t) => sameAddress(t.address, tx.to));
  return isStable && SELF_PAYING_SELECTORS.has(data.slice(0, 10));
}

async function ensureFeeToken(provider: Eip1193Like, from: Address, chainId: number): Promise<void> {
  // Moderato keeps its old key, so nothing changes for it.
  const key = chainId === TEMPO_CHAIN_ID ? from.toLowerCase() : `${chainId}:${from.toLowerCase()}`;
  if (settled.has(key)) return;
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const run = (async () => {
    // A read failure must not block the user's transaction; fall through.
    const plan = await planFeeToken(from, chainId).catch(() => null);
    if (!plan) return;
    if (plan.action === "none") {
      if (plan.reason === "preference-set") settled.add(key);
      return;
    }
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: FEE_MANAGER,
          data: setFeeTokenData(plan.token),
          chainId: `0x${chainId.toString(16)}`,
        },
      ],
    })) as Hex;
    const receipt = await tempoClient(chainId).waitForTransactionReceipt({
      hash,
      timeout: 90_000,
    });
    if (receipt.status !== "success") {
      throw new Error(`Could not set ${plan.symbol} as this wallet's fee token on Tempo.`);
    }
    settled.add(key);
  })().finally(() => pending.delete(key));
  pending.set(key, run);
  return run;
}

const wrapped = new WeakMap<object, unknown>();

/**
 * Wraps a browser wallet's EIP-1193 provider so a Tempo transaction from an
 * account with no fee token and no PathUSD first sets one (see the header).
 * Everything else, including every Robinhood Chain request, passes through.
 */
export function withTempoFeeToken<P>(provider: P): P {
  if (!provider || typeof provider !== "object") return provider;
  const target = provider as unknown as Eip1193Like & object;
  const hit = wrapped.get(target);
  if (hit) return hit as P;
  const request = async (args: RequestArgs) => {
    if (args.method === "eth_sendTransaction" || args.method === "wallet_sendTransaction") {
      const tx = (Array.isArray(args.params) ? args.params[0] : undefined) as TxParams | undefined;
      const chainId = tx?.from && !skipsFeeCheck(tx) ? await tempoTxChain(target, tx) : null;
      if (tx?.from && chainId !== null) {
        await ensureFeeToken(target, tx.from as Address, chainId);
      }
    }
    return target.request(args);
  };
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop === "request") return request;
      const v = Reflect.get(t, prop, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  wrapped.set(target, proxy);
  return proxy as unknown as P;
}

/**
 * Applies `withTempoFeeToken` to a wagmi connector (the injected one). Its own
 * methods reach the provider through `this.getProvider()`, so overriding
 * getProvider covers connect, reconnect and every transaction.
 */
export function tempoFeeAware<C extends CreateConnectorFn>(connectorFn: C): C {
  const fn: CreateConnectorFn = (config) => {
    const connector = connectorFn(config);
    return {
      ...connector,
      async getProvider(parameters?: { chainId?: number | undefined }) {
        return withTempoFeeToken(await connector.getProvider(parameters));
      },
    };
  };
  return fn as C;
}
