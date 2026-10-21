/**
 * Onchain limits for the agent on Tempo: an access key the owner authorizes in
 * the AccountKeychain precompile, with an expiry, a periodic spending limit per
 * stablecoin and call scopes. The protocol checks these on every transaction the
 * key signs, so they hold even if this server, its host or its key is taken.
 *
 * This module only builds what the owner signs and reads the key's state. It
 * never signs or broadcasts for the owner; the owner's root key never comes here.
 *
 * What the protocol counts (Tempo AccountKeychain spec, TIP-1011): TIP-20
 * transfer, transferWithMemo and increases of approve, made by the key itself.
 * transferFrom is not counted, so an allowance the owner already gave the pool
 * can be spent through shieldBound without touching the limit. The check below
 * reports that allowance; reset it to 0 before relying on the cap.
 */
import { randomBytes } from "node:crypto";
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  isAddressEqual,
  parseUnits,
  toFunctionSelector,
  toFunctionSignature,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { POOL_TRANSFER_ABI } from "@gloamtrade/sdk";
import { MCP_NETWORKS, type McpNetwork } from "./networks.js";
import { KNOWN_ASSETS } from "./policy.js";
import { agentPrivateKey, getPublicClient } from "./signer.js";

type Env = Record<string, string | undefined>;

export const ACCOUNT_KEYCHAIN: Address = "0xaAAAaaAA00000000000000000000000000000000";

/** The precompile functions used here (tempo-std IAccountKeychain.sol). */
export const ACCOUNT_KEYCHAIN_ABI = [
  {
    type: "function",
    name: "authorizeKey",
    stateMutability: "nonpayable",
    inputs: [
      { name: "keyId", type: "address" },
      { name: "signatureType", type: "uint8" },
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "expiry", type: "uint64" },
          { name: "enforceLimits", type: "bool" },
          {
            name: "limits",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "period", type: "uint64" },
            ],
          },
          { name: "allowAnyCalls", type: "bool" },
          {
            name: "allowedCalls",
            type: "tuple[]",
            components: [
              { name: "target", type: "address" },
              {
                name: "selectorRules",
                type: "tuple[]",
                components: [
                  { name: "selector", type: "bytes4" },
                  { name: "recipients", type: "address[]" },
                ],
              },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeKey",
    stateMutability: "nonpayable",
    inputs: [{ name: "keyId", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getKey",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "keyId", type: "address" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "signatureType", type: "uint8" },
          { name: "keyId", type: "address" },
          { name: "expiry", type: "uint64" },
          { name: "enforceLimits", type: "bool" },
          { name: "isRevoked", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getRemainingLimitWithPeriod",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "keyId", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [
      { name: "remaining", type: "uint256" },
      { name: "periodEnd", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "getAllowedCalls",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "keyId", type: "address" },
    ],
    outputs: [
      { name: "isScoped", type: "bool" },
      {
        name: "scopes",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          {
            name: "selectorRules",
            type: "tuple[]",
            components: [
              { name: "selector", type: "bytes4" },
              { name: "recipients", type: "address[]" },
            ],
          },
        ],
      },
    ],
  },
] as const;

const ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const SHIELD_BOUND = {
  type: "function",
  name: "shieldBound",
  stateMutability: "payable",
  inputs: [
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "commitment", type: "bytes32" },
    { name: "proof", type: "bytes" },
  ],
  outputs: [],
} as const;

/** The calls the agent makes on Tempo, and nothing else. */
export const SCOPED_CALLS = {
  approve: "approve(address,uint256)",
  shieldBound: toFunctionSignature(SHIELD_BOUND),
  transfer: toFunctionSignature(POOL_TRANSFER_ABI[0]),
} as const;

const SELECTORS = {
  approve: toFunctionSelector(SCOPED_CALLS.approve),
  shieldBound: toFunctionSelector(SCOPED_CALLS.shieldBound),
  transfer: toFunctionSelector(SCOPED_CALLS.transfer),
};

const SIGNATURE_TYPE_SECP256K1 = 0;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

// ------------------------------------------------------------------ parsing

export interface TempoToken {
  symbol: string;
  address: Address;
  decimals: number;
}

export function tempoTokens(net: McpNetwork = MCP_NETWORKS.tempo): TempoToken[] {
  return KNOWN_ASSETS.filter((a) => a.chainId === net.chainId).map((a) => ({
    symbol: a.symbol,
    address: getAddress(a.address),
    decimals: a.decimals,
  }));
}

export function findTempoToken(nameOrAddress: string, net: McpNetwork = MCP_NETWORKS.tempo): TempoToken {
  const s = nameOrAddress.trim();
  const tokens = tempoTokens(net);
  const hit = isAddress(s, { strict: false })
    ? tokens.find((t) => isAddressEqual(t.address, s as Address))
    : tokens.find((t) => t.symbol.toLowerCase() === s.toLowerCase());
  if (!hit) throw new Error(`Unknown Tempo asset "${s}". Use one of: ${tokens.map((t) => t.symbol).join(", ")}.`);
  return hit;
}

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/** "30m", "24h", "7d", "2w" (or plain seconds) to seconds. */
export function parseDuration(value: string): number {
  const m = /^(\d+)\s*([smhdw]?)$/i.exec(value.trim());
  if (!m || Number(m[1]) <= 0) throw new Error(`Not a duration: "${value}". Use e.g. 1h, 1d, 7d, 30d.`);
  return Number(m[1]) * UNITS[(m[2] || "s").toLowerCase()];
}

/** The limit period in seconds; 0 for a one-time limit ("once"). */
export function parsePeriod(value: string): number {
  const v = value.trim().toLowerCase();
  if (v === "once" || v === "0" || v === "none") return 0;
  return parseDuration(v);
}

/** A duration from now, a date (through the end of that day, UTC) or an ISO time, as unix seconds. */
export function parseExpiry(value: string, nowSec: number): number {
  const v = value.trim();
  let at: number;
  if (/^\d+\s*[smhdw]$/i.test(v)) at = nowSec + parseDuration(v);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) at = Math.floor(Date.parse(`${v}T23:59:59Z`) / 1000);
  else at = Math.floor(Date.parse(v) / 1000);
  if (!Number.isFinite(at)) throw new Error(`Not an expiry: "${value}". Use a duration (30d) or a date (2026-12-31).`);
  if (at <= nowSec) throw new Error(`The expiry ${new Date(at * 1000).toISOString()} is not in the future.`);
  if (BigInt(at) >= MAX_UINT64) throw new Error("The expiry is too far out.");
  return at;
}

export interface TokenLimitInput {
  token: TempoToken;
  /** Base units. */
  amount: bigint;
}

/** "25" (PathUSD) or "AlphaUSD=25"; each token at most once. */
export function parseLimits(values: string[], net: McpNetwork = MCP_NETWORKS.tempo): TokenLimitInput[] {
  const out: TokenLimitInput[] = [];
  for (const raw of values) {
    const eq = raw.indexOf("=");
    const token = findTempoToken(eq === -1 ? net.defaultAssetSymbol : raw.slice(0, eq), net);
    const amountText = (eq === -1 ? raw : raw.slice(eq + 1)).trim();
    if (!/^\d+(\.\d+)?$/.test(amountText)) throw new Error(`Not an amount: "${amountText}".`);
    const amount = parseUnits(amountText, token.decimals);
    if (amount <= 0n) throw new Error(`The limit for ${token.symbol} must be more than 0.`);
    if (amount >= 1n << 128n) throw new Error(`The limit for ${token.symbol} is larger than any TIP-20 supply.`);
    if (out.some((l) => isAddressEqual(l.token.address, token.address))) throw new Error(`${token.symbol} is listed twice.`);
    out.push({ token, amount });
  }
  if (!out.length) throw new Error("Give at least one limit, e.g. --limit 25 (PathUSD) or --limit AlphaUSD=25.");
  return out;
}

// ------------------------------------------------------------------ the plan

export interface AccessKeyPolicy {
  network: McpNetwork;
  owner: Address;
  keyId: Address;
  limits: TokenLimitInput[];
  /** Seconds; 0 = one-time. */
  period: number;
  /** Unix seconds. */
  expiry: number;
}

export interface KeyRestrictions {
  expiry: bigint;
  enforceLimits: boolean;
  limits: { token: Address; amount: bigint; period: bigint }[];
  allowAnyCalls: boolean;
  allowedCalls: { target: Address; selectorRules: { selector: Hex; recipients: Address[] }[] }[];
}

/**
 * Restrictions for the agent key: the caps per token, and calls limited to
 * approving the Gloam pool (as the only spender) for each capped token and to
 * shieldBound and transfer on the pool. Nothing else can be called.
 */
export function keyRestrictions(p: AccessKeyPolicy): KeyRestrictions {
  const pool = getAddress(p.network.pool);
  return {
    expiry: BigInt(p.expiry),
    enforceLimits: true,
    limits: p.limits.map((l) => ({ token: l.token.address, amount: l.amount, period: BigInt(p.period) })),
    allowAnyCalls: false,
    allowedCalls: [
      ...p.limits.map((l) => ({
        target: l.token.address,
        selectorRules: [{ selector: SELECTORS.approve, recipients: [pool] }],
      })),
      {
        target: pool,
        selectorRules: [
          { selector: SELECTORS.shieldBound, recipients: [] },
          { selector: SELECTORS.transfer, recipients: [] },
        ],
      },
    ],
  };
}

export function authorizeKeyCalldata(p: AccessKeyPolicy): Hex {
  return encodeFunctionData({
    abi: ACCOUNT_KEYCHAIN_ABI,
    functionName: "authorizeKey",
    args: [p.keyId, SIGNATURE_TYPE_SECP256K1, keyRestrictions(p)],
  });
}

const AUTHORIZE_SIG =
  "authorizeKey(address,uint8,(uint64,bool,(address,uint256,uint64)[],bool,(address,(bytes4,address[])[])[]))";

function castTuple(r: KeyRestrictions): string {
  const limits = r.limits.map((l) => `(${l.token},${l.amount},${l.period})`).join(",");
  const calls = r.allowedCalls
    .map((c) => `(${c.target},[${c.selectorRules.map((s) => `(${s.selector},[${s.recipients.join(",")}])`).join(",")}])`)
    .join(",");
  return `(${r.expiry},${r.enforceLimits},[${limits}],${r.allowAnyCalls},[${calls}])`;
}

const describePeriod = (s: number) => {
  if (s === 0) return "in total (one-time, does not reset)";
  for (const [unit, n] of [["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (s % n === 0) return s === n ? `every ${unit}` : `every ${s / n} ${unit}s`;
  }
  return `every ${s} seconds`;
};

export interface AccessKeyPlan {
  network: { name: string; chainId: number; rpc: string };
  owner: Address;
  accessKey: Address;
  keyType: "secp256k1";
  expiry: { unix: number; iso: string };
  period: { seconds: number; text: string };
  limits: { symbol: string; token: Address; amount: string; baseUnits: string }[];
  pool: Address;
  allowedCalls: string[];
  restrictions: KeyRestrictions;
  /** Option 1: a Tempo Wallet / Accounts SDK provider request (passkey owners). */
  walletRequest: { method: "wallet_authorizeAccessKey"; params: [Record<string, unknown>] };
  /** Option 2: Foundry, signed by the owner's root key. */
  castCommand: string;
  /** Option 3: the raw call, from the owner's account, for any wallet. */
  transaction: { from: Address; to: Address; value: "0"; data: Hex };
  revokeCommand: string;
}

export function buildAccessKeyPlan(p: AccessKeyPolicy): AccessKeyPlan {
  const r = keyRestrictions(p);
  const pool = getAddress(p.network.pool);
  const rpc = p.network.rpc;
  return {
    network: { name: p.network.name, chainId: p.network.chainId, rpc },
    owner: p.owner,
    accessKey: p.keyId,
    keyType: "secp256k1",
    expiry: { unix: p.expiry, iso: new Date(p.expiry * 1000).toISOString() },
    period: { seconds: p.period, text: describePeriod(p.period) },
    limits: p.limits.map((l) => ({
      symbol: l.token.symbol,
      token: l.token.address,
      amount: formatUnits(l.amount, l.token.decimals),
      baseUnits: l.amount.toString(),
    })),
    pool,
    allowedCalls: [
      ...p.limits.map((l) => `${l.token.symbol}.approve(spender = Gloam pool ${pool}, amount)`),
      `Gloam pool ${pool}: ${SCOPED_CALLS.shieldBound}`,
      `Gloam pool ${pool}: ${SCOPED_CALLS.transfer}`,
    ],
    restrictions: r,
    walletRequest: {
      method: "wallet_authorizeAccessKey",
      params: [
        {
          address: p.keyId,
          keyType: "secp256k1",
          chainId: `0x${p.network.chainId.toString(16)}`,
          expiry: p.expiry,
          limits: p.limits.map((l) => ({
            token: l.token.address,
            limit: `0x${l.amount.toString(16)}`,
            ...(p.period ? { period: p.period } : {}),
          })),
          scopes: [
            ...p.limits.map((l) => ({ address: l.token.address, selector: SCOPED_CALLS.approve, recipients: [pool] })),
            { address: pool, selector: SCOPED_CALLS.shieldBound },
            { address: pool, selector: SCOPED_CALLS.transfer },
          ],
        },
      ],
    },
    castCommand: [
      `cast send ${ACCOUNT_KEYCHAIN}`,
      `  '${AUTHORIZE_SIG}'`,
      `  ${p.keyId} 0`,
      `  '${castTuple(r)}'`,
      `  --rpc-url ${rpc} --interactive`,
    ].join(" \\\n"),
    transaction: { from: p.owner, to: ACCOUNT_KEYCHAIN, value: "0", data: authorizeKeyCalldata(p) },
    revokeCommand: `cast send ${ACCOUNT_KEYCHAIN} 'revokeKey(address)' ${p.keyId} --rpc-url ${rpc} --interactive`,
  };
}

export function formatPlan(plan: AccessKeyPlan): string {
  const L: string[] = [];
  L.push(`Gloam agent access key on ${plan.network.name} (chain ${plan.network.chainId})`);
  L.push("");
  L.push(`  Owner account  ${plan.owner}`);
  L.push(`  Access key     ${plan.accessKey} (secp256k1, held by the Gloam MCP server)`);
  for (const l of plan.limits) L.push(`  Limit          ${l.amount} ${l.symbol} ${plan.period.text}`);
  L.push(`  Expires        ${plan.expiry.iso}`);
  L.push(`  May call       ${plan.allowedCalls[0]}`);
  for (const c of plan.allowedCalls.slice(1)) L.push(`                 ${c}`);
  L.push("");
  L.push("The Tempo protocol enforces all of this on every transaction the key signs. The owner's root key");
  L.push("is not needed by the agent and never leaves the owner. Nothing below has been sent.");
  L.push("");
  L.push("Authorize it from the owner account, one of three ways:");
  L.push("");
  L.push("1. Tempo Wallet or any Tempo Accounts SDK provider (passkey accounts):");
  L.push("");
  L.push(`   await provider.request(${JSON.stringify(plan.walletRequest, null, 2).replace(/\n/g, "\n   ")})`);
  L.push("");
  L.push("2. Foundry, signed by the owner's root key (cast prompts for it; --ledger or --account work too):");
  L.push("");
  L.push(plan.castCommand.replace(/^/gm, "   "));
  L.push("");
  L.push("3. Any wallet that can send a raw call from the owner account:");
  L.push("");
  L.push(`   to:    ${plan.transaction.to}`);
  L.push(`   value: 0`);
  L.push(`   data:  ${plan.transaction.data}`);
  L.push("");
  L.push("Before relying on the cap: the cap counts approvals the key makes, not allowances the owner already");
  L.push("gave. If the owner account ever approved the Gloam pool (the Gloam app approves it once, for any");
  L.push("amount), reset that to 0 from the owner first, or the key can shield up to that allowance:");
  L.push("");
  for (const l of plan.limits)
    L.push(`   cast send ${l.token} 'approve(address,uint256)' ${plan.pool} 0 --rpc-url ${plan.network.rpc} --interactive`);
  L.push("");
  L.push("Then check it (read-only):");
  L.push("");
  L.push(
    `   npx -y @gloamtrade/mcp authorize-access-key --check${plan.network.chainId === MCP_NETWORKS.tempo.chainId ? "" : " --network tempo-mainnet"} --owner ${plan.owner} --key ${plan.accessKey}`
  );
  L.push("");
  L.push("Revoke it at any time from the owner (a revoked key can never be authorized again):");
  L.push("");
  L.push(`   ${plan.revokeCommand}`);
  return L.join("\n");
}

// ------------------------------------------------------------------ status (read-only)

export interface AccessKeyStatus {
  network: string;
  owner: Address;
  accessKey: Address;
  authorized: boolean;
  revoked: boolean;
  expired: boolean;
  expiry: string | null;
  enforceLimits: boolean;
  limits: { symbol: string; token: Address; remaining: string; periodEnd: string | null }[];
  scoped: boolean;
  scopes: { target: Address; selectors: { selector: Hex; recipients: Address[] }[] }[];
  /** Allowance the owner account has given the Gloam pool, per token. Not counted by the cap. */
  poolAllowances: { symbol: string; token: Address; allowance: string }[];
  ok: boolean;
  warnings: string[];
}

type ReadClient = ReturnType<typeof getPublicClient>;

export async function checkAccessKey(
  args: { owner: Address; keyId: Address; network?: McpNetwork; tokens?: TempoToken[]; nowSec?: number },
  client?: ReadClient
): Promise<AccessKeyStatus> {
  const net = args.network ?? MCP_NETWORKS.tempo;
  const c = client ?? getPublicClient(net);
  const tokens = args.tokens ?? tempoTokens(net);
  const now = BigInt(args.nowSec ?? Math.floor(Date.now() / 1000));
  const pool = getAddress(net.pool);

  const [info, allowed, remaining, allowances] = await Promise.all([
    c.readContract({ address: ACCOUNT_KEYCHAIN, abi: ACCOUNT_KEYCHAIN_ABI, functionName: "getKey", args: [args.owner, args.keyId] }),
    c.readContract({ address: ACCOUNT_KEYCHAIN, abi: ACCOUNT_KEYCHAIN_ABI, functionName: "getAllowedCalls", args: [args.owner, args.keyId] }),
    Promise.all(
      tokens.map((t) =>
        c.readContract({
          address: ACCOUNT_KEYCHAIN,
          abi: ACCOUNT_KEYCHAIN_ABI,
          functionName: "getRemainingLimitWithPeriod",
          args: [args.owner, args.keyId, t.address],
        })
      )
    ),
    Promise.all(tokens.map((t) => c.readContract({ address: t.address, abi: ALLOWANCE_ABI, functionName: "allowance", args: [args.owner, pool] }))),
  ]);

  const authorized = info.keyId !== zeroAddress && info.expiry > 0n;
  const expired = authorized && info.expiry <= now;
  const [isScoped, scopes] = allowed;
  const warnings: string[] = [];
  const fmt = (t: TempoToken, v: bigint) => `${formatUnits(v, t.decimals)} ${t.symbol}`;

  if (info.isRevoked) warnings.push("This key was revoked. A revoked key can never be authorized again: make a new key.");
  else if (!authorized) warnings.push("This key is not authorized for the owner account yet. Run authorize-access-key and have the owner send it.");
  else if (expired) warnings.push(`This key expired at ${new Date(Number(info.expiry) * 1000).toISOString()}.`);
  if (authorized && !info.enforceLimits) warnings.push("This key has NO spending limit: the protocol lets it move any amount. Revoke it and authorize one with --limit.");
  if (authorized && !isScoped) {
    warnings.push(
      "This key may call any contract. Allowances the owner gave other contracts can then be spent through them without touching the limit. Revoke it and authorize a scoped one with this tool."
    );
  }
  if (authorized && isScoped) {
    const extra = scopes.filter(
      (s) => !isAddressEqual(s.target, pool) && !tokens.some((t) => isAddressEqual(t.address, s.target))
    );
    if (extra.length) warnings.push(`This key may also call ${extra.map((s) => s.target).join(", ")}, which Gloam does not need.`);
  }
  tokens.forEach((t, i) => {
    const a = allowances[i];
    if (a === 0n) return;
    const amount = a === MAX_UINT256 ? `an unlimited amount of ${t.symbol}` : fmt(t, a);
    warnings.push(
      `The owner account has approved the Gloam pool for ${amount}. The pool can pull that through shieldBound without the key's limit counting it. ` +
        `Reset it from the owner: cast send ${t.address} 'approve(address,uint256)' ${pool} 0 --rpc-url ${net.rpc} --interactive`
    );
  });

  const limited = tokens
    .map((t, i) => ({ t, remaining: remaining[i][0], periodEnd: remaining[i][1] }))
    .filter((x) => authorized && info.enforceLimits && (x.remaining > 0n || x.periodEnd > 0n));

  return {
    network: net.name,
    owner: args.owner,
    accessKey: args.keyId,
    authorized,
    revoked: info.isRevoked,
    expired,
    expiry: authorized ? (info.expiry >= MAX_UINT64 ? "never" : new Date(Number(info.expiry) * 1000).toISOString()) : null,
    enforceLimits: info.enforceLimits,
    limits: limited.map((x) => ({
      symbol: x.t.symbol,
      token: x.t.address,
      remaining: formatUnits(x.remaining, x.t.decimals),
      periodEnd: x.periodEnd > 0n ? new Date(Number(x.periodEnd) * 1000).toISOString() : null,
    })),
    scoped: isScoped,
    scopes: scopes.map((s) => ({
      target: s.target,
      selectors: s.selectorRules.map((r) => ({ selector: r.selector, recipients: [...r.recipients] })),
    })),
    poolAllowances: tokens.map((t, i) => ({ symbol: t.symbol, token: t.address, allowance: formatUnits(allowances[i], t.decimals) })),
    ok: authorized && !expired && !info.isRevoked && info.enforceLimits && isScoped && warnings.length === 0,
    warnings,
  };
}

export function formatStatus(s: AccessKeyStatus): string {
  const L: string[] = [];
  L.push(`Access key ${s.accessKey} for ${s.owner} on ${s.network}`);
  L.push(`  Authorized   ${s.authorized ? "yes" : "no"}${s.revoked ? " (revoked)" : ""}${s.expired ? " (expired)" : ""}`);
  if (s.expiry) L.push(`  Expires      ${s.expiry}`);
  if (s.authorized) {
    L.push(`  Limits       ${s.enforceLimits ? "enforced" : "NONE"}`);
    for (const l of s.limits) L.push(`                 ${l.remaining} ${l.symbol} left${l.periodEnd ? `, resets ${l.periodEnd}` : ""}`);
    L.push(`  Call scopes  ${s.scoped ? `${s.scopes.length} target${s.scopes.length === 1 ? "" : "s"}` : "NONE (any contract)"}`);
  }
  L.push(s.ok ? "  Ready: the protocol enforces the cap, expiry and scopes on this key." : "  Not ready:");
  for (const w of s.warnings) L.push(`  - ${w}`);
  return L.join("\n");
}

// ------------------------------------------------------------------ key generation

/** A fresh agent key and a note-store key. The private key is returned for the caller to store, never printed by this module. */
export function newAgentKey(): { privateKey: Hex; address: Address; noteKey: string } {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address, noteKey: randomBytes(32).toString("hex") };
}

/** The agent key's address from GLOAM_AGENT_PRIVATE_KEY, or null. */
export function keyAddressFromEnv(env: Env): Address | null {
  const key = agentPrivateKey(env);
  return key ? privateKeyToAccount(key).address : null;
}
