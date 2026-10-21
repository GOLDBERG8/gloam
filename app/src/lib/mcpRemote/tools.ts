/**
 * Tools of the hosted MCP server (www.gloam.trade/mcp). Read and plan only:
 * nothing here signs, holds funds or takes a key. Names match the local
 * server (mcp/src/server.ts) where they overlap (gloam_info).
 *
 * Inputs are plain JSON Schema checked by hand, so the app needs no schema
 * library. Every call is screened for secrets first (./safety).
 */
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { faucetFor } from "@/lib/faucet";
import { MAINNET_ENABLED, getNetwork, NETWORK_KEYS, isNetworkKey, type NetworkKey } from "@/lib/networks";
import { fetchOnchainMetrics } from "@/lib/onchainMetrics";
import {
  buildPaymentRequestLink,
  cleanRequestText,
  findRequestAsset,
  isValidRequestTag,
  normalizeRequestAmount,
  requestAssetsFor,
  REQUEST_NAME_MAX,
  REQUEST_NOTE_MAX,
} from "@/lib/paymentRequest";
import { LEGACY_DISCLOSURE } from "@/lib/disclosure";
import { MAX_PROOF_TEXT, ProofInputError, verifyProofText, type ApiVerifyResult } from "@/lib/proofsServer";
import { hitRateLimit } from "./rateLimit";
import { findSecret, secretWarning } from "./safety";

export const SITE = "https://www.gloam.trade";
export const MCP_URL = `${SITE}/mcp`;
export const LOCAL_SERVER = "npx -y @gloamtrade/mcp";

/** Per IP, per minute, for the tools that do real work. */
const VERIFY_PER_MINUTE = 20;
const STATS_TIMEOUT_MS = 45_000;

export type ToolContext = {
  /** Origin for links this server makes: the site in production, the request's origin on localhost. */
  origin: string;
  ip: string;
};

type Args = Record<string, unknown>;

class ArgError extends Error {}

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function optString(args: Args, key: string, max: number): string | undefined {
  const v = args[key];
  if (v == null || v === "") return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") throw new ArgError(`${key} must be text.`);
  if (v.length > max) throw new ArgError(`${key} is too long (at most ${max} characters).`);
  return v;
}

/** The network names a caller may pass: the testnets, then each mainnet once its pool is in. */
const NETWORK_CHOICES: NetworkKey[] = ["tempo", "robinhood", ...NETWORK_KEYS.filter((k) => !getNetwork(k).testnet)];

function quotedChoices(): string {
  const q = NETWORK_CHOICES.map((k) => `"${k}"`);
  return q.length > 1 ? `${q.slice(0, -1).join(", ")} or ${q[q.length - 1]}` : q.join("");
}

function optNetwork(args: Args, fallback: NetworkKey | null = null): NetworkKey | null {
  const v = optString(args, "network", 32)?.trim().toLowerCase();
  if (v === undefined || v === "all") return fallback;
  if (!isNetworkKey(v)) throw new ArgError(`network must be ${quotedChoices()}.`);
  return v;
}

function optEnum<T extends string>(args: Args, key: string, values: readonly T[], fallback: T): T {
  const v = optString(args, key, 64)?.trim().toLowerCase();
  if (v === undefined) return fallback;
  if (!(values as readonly string[]).includes(v)) throw new ArgError(`${key} must be one of: ${values.join(", ")}.`);
  return v as T;
}

const TESTNET_PROP_TEXT =
  'Gloam network: "tempo" (Tempo Moderato testnet, private stablecoin payments) or "robinhood" (Robinhood Chain testnet).';

const MAINNET_PROP_TEXT: Partial<Record<NetworkKey, string>> = {
  "tempo-mainnet": '"tempo-mainnet" (Tempo mainnet, real money: USDC.e, pathUSD, USDT0, OUSD)',
  "robinhood-mainnet": '"robinhood-mainnet" (Robinhood Chain mainnet, real money: USDG and GLOAM)',
};

const NETWORK_PROP = {
  type: "string",
  enum: NETWORK_CHOICES,
  description: MAINNET_ENABLED
    ? `Gloam network: ${NETWORK_CHOICES.filter((k) => !getNetwork(k).testnet)
        .map((k) => MAINNET_PROP_TEXT[k])
        .join(", ")}, or a testnet with play money: "tempo" (Tempo Moderato) or "robinhood" (Robinhood Chain testnet).`
    : TESTNET_PROP_TEXT,
} as const;

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

/** "Leave out for both" until a mainnet is listed next to the two testnets. */
const LEAVE_OUT = MAINNET_ENABLED ? "Leave out for every network." : "Leave out for both.";

/** Where Gloam runs, as one honest line. Testnets only until a mainnet pool is filled in. */
const STATUS = MAINNET_ENABLED
  ? `Mainnet, real money: ${NETWORK_KEYS.filter((k) => !getNetwork(k).testnet)
      .map((k) => `${getNetwork(k).label} (${getNetwork(k).chainId})`)
      .join(" and ")}, with the trusted setup's final keys (13 contributors) and beta deposit limits. Deposits and private payments are free; a cash out costs 0.25%. Beta software: reviewed internally before launch, external audit planned. Testnets, play money: Tempo Moderato (42431) and Robinhood Chain testnet (46630), with development keys. Private trade (sealed swaps) is paused until its solvency accounting lands.`
  : "Testnet only: Tempo Moderato (42431) and Robinhood Chain testnet (46630). Testnet proofs use development keys; the production ceremony is done (13 contributors) and mainnet deploys its final keys. Private trade (sealed swaps) is paused until its solvency accounting lands.";

const WHAT_IS_PUBLIC =
  "Deposits and cash outs are public transactions (wallet, asset and amount show on chain). What stays private is everything in between: balances inside the vault, the amounts and parties of private sends, and the link between a deposit and a later cash out.";

const ANONYMITY =
  "Privacy is only as strong as the crowd of notes in the vault. The testnet vaults are young, so do not treat a cash out as unlinkable yet.";

const MAINNET_ANONYMITY =
  "Privacy is only as strong as the crowd of notes in the vault. The mainnet vaults are new, so do not treat a cash out as unlinkable yet.";

function appLinks(origin: string) {
  return {
    app: `${origin}/app`,
    deposit: `${origin}/app/vault?tab=shield`,
    receive: `${origin}/app/vault?tab=move&mode=receive`,
    verify: `${origin}/verify`,
    transparency: `${origin}/transparency`,
    docs: `${origin}/docs`,
    agentDocs: `${origin}/docs/agents`,
  };
}

// ---------------------------------------------------------------- tool list

export const TOOLS: Tool[] = [
  {
    name: "gloam_info",
    title: "About Gloam",
    description:
      "What Gloam is, what this hosted server can do, and where to go to sign or spend. Call this first. This server only reads and plans: it never holds funds and never takes a private key, recovery phrase or note secret.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "About Gloam", ...READ, openWorldHint: false },
  },
  {
    name: "gloam_networks",
    title: "Networks and assets",
    description: MAINNET_ENABLED
      ? "The networks Gloam runs on, mainnets first, with each vault (pool) address, the assets you can deposit (on mainnet: USDC.e, pathUSD, USDT0 and OUSD on Tempo, USDG and GLOAM on Robinhood Chain; on testnet: OUSD and PathUSD on Tempo, USDG and ETH on Robinhood Chain), explorers, RPCs and the testnet faucets."
      : "The networks Gloam runs on, with each vault (pool) address, the assets you can deposit (OUSD and PathUSD on Tempo, USDG and ETH on Robinhood Chain), explorers, RPCs and faucets.",
    inputSchema: {
      type: "object",
      properties: { network: { ...NETWORK_PROP, description: `${NETWORK_PROP.description} ${LEAVE_OUT}` } },
    },
    annotations: { title: "Networks and assets", ...READ, openWorldHint: false },
  },
  {
    name: "gloam_vault_stats",
    title: "Vault stats",
    description:
      "Public totals for each Gloam vault, read from the chain: what it holds, and counts of deposits, private transfers, cash outs and payment messages. Totals only, no wallets. Cached about a minute.",
    inputSchema: {
      type: "object",
      properties: { network: { ...NETWORK_PROP, description: `${NETWORK_PROP.description} ${LEAVE_OUT}` } },
    },
    annotations: { title: "Vault stats", ...READ, openWorldHint: true },
  },
  {
    name: "gloam_create_payment_request",
    title: "Create a payment request link",
    description:
      "Make a link that asks someone to pay your Gloam address privately. It opens Pay in the Gloam app with the address, amount, asset and note filled in; the payer checks and sends. The details ride after the # of the link, so the payer's browser never sends them to a server. Needs your public Gloam address (gloamr1.…), never a key.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Your Gloam address to be paid at, gloamr1.… (public; find it in the app under Receive)." },
        network: { ...NETWORK_PROP, default: "robinhood" },
        asset: {
          type: "string",
          description: "Token symbol or address, e.g. USDG on Robinhood Chain, OUSD or PathUSD on Tempo. Default: the network's main stablecoin.",
        },
        amount: { type: "string", description: 'Amount in whole units, e.g. "12.50". Leave out to let the payer choose.' },
        note: { type: "string", description: `A reference the payer sees, e.g. "Invoice 042" (up to ${REQUEST_NOTE_MAX} characters).` },
        name: { type: "string", description: `Your name as the payer should see it (up to ${REQUEST_NAME_MAX} characters).` },
      },
      required: ["to"],
    },
    annotations: { title: "Create a payment request link", ...READ, openWorldHint: false },
  },
  {
    name: "gloam_verify_proof",
    title: "Verify a Gloam proof",
    description:
      "Check a Gloam proof someone shared with you: proof of funds (gloamfunds1:), proof of payment (gloampay1:), payroll total (gloamroll1:) or exact balance (gloambal1:). Runs the same checks as gloam.trade/verify on the server: the zero-knowledge proof, that it was made on Gloam's vault, who it is for, expiry, and the live vault state. A proof of payment shows a private payment was made, not who paid whom; a payroll total shows a run of payments the prover funded, not who was paid. The older gloamdisc1 balance disclosure is never verified: anyone can copy one from a public deposit. Proofs are meant to be shared; they hold no secrets.",
    inputSchema: {
      type: "object",
      properties: { proof: { type: "string", description: "The full proof text, starting gloamfunds1:, gloampay1:, gloamroll1:, gloambal1: or gloamdisc1:." } },
      required: ["proof"],
    },
    annotations: { title: "Verify a Gloam proof", ...READ, openWorldHint: true },
  },
  {
    name: "gloam_plan_deposit",
    title: "Plan a private deposit",
    description:
      "Plan a deposit into a private Gloam balance (a shield): the steps, what becomes public and what stays private, and the app link to do it. Does not sign or send anything; you sign in your own wallet in the app.",
    inputSchema: {
      type: "object",
      properties: {
        network: { ...NETWORK_PROP, default: "tempo" },
        asset: { type: "string", description: "Token symbol or address. Default: the network's main stablecoin (OUSD on Tempo, USDG on Robinhood Chain)." },
        amount: { type: "string", description: 'Amount in whole units, e.g. "25".' },
      },
    },
    annotations: { title: "Plan a private deposit", ...READ, openWorldHint: false },
  },
  {
    name: "gloam_mpp_how_to",
    title: "Private payments over MPP",
    description:
      "How to pay or charge privately over MPP (the Machine Payments Protocol, HTTP 402) with the gloam method from @gloamtrade/mppx-gloam, with code. A charge settles as a private transfer in a Gloam vault: the chain sees no amount, asset, payer or payee.",
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["pay", "charge", "both"],
          default: "both",
          description: '"charge" to get paid for an API or tool, "pay" for an agent or app paying one, "both" for both.',
        },
        network: { ...NETWORK_PROP, default: "tempo" },
      },
    },
    annotations: { title: "Private payments over MPP", ...READ, openWorldHint: false },
  },
  {
    name: "gloam_connect_full_agent",
    title: "Connect the full Gloam agent",
    description:
      "Commands to install the local Gloam MCP server, which can sign and pay (shield, private pay, x402 and MPP, spending limits) with keys kept on your machine: Claude Code, Codex, Cursor, VS Code, Claude Desktop and any MCP client, plus the plugin marketplace cryptoduke01/gloam-plugins.",
    inputSchema: {
      type: "object",
      properties: {
        client: {
          type: "string",
          enum: ["claude-code", "codex", "cursor", "vscode", "claude-desktop", "gemini", "all"],
          default: "all",
          description: "Which app to show commands for.",
        },
      },
    },
    annotations: { title: "Connect the full Gloam agent", ...READ, openWorldHint: false },
  },
];

// ---------------------------------------------------------------- handlers

function info(ctx: ToolContext) {
  return {
    what: "Gloam is the privacy layer for onchain finance: shielded balances, private payments and proofs you choose to share, for people and AI agents. Private stablecoin payments on Tempo, and private balances on Robinhood Chain.",
    wantItDoneForYou: {
      agent: `Add the local Gloam server (${LOCAL_SERVER}) to this AI client and give it a capped spending key. Then the agent can deposit, pay privately and check proofs end to end, inside limits you set. gloam_connect_full_agent has the one-line setup.`,
      oneLink: "Or ask for a link per action: a payment request link opens Pay in the app already filled in, so you only check it and sign.",
    },
    thisServer: {
      url: MCP_URL,
      does: "Reads and plans. No account, no install.",
      keys: "Never holds funds, never signs, and never takes a private key, recovery phrase or Gloam note secret. A tool call that looks like it holds one is refused.",
      toSignOrSpend: `Use the Gloam app (${ctx.origin}/app) in your own wallet, or the local MCP server (${LOCAL_SERVER}), which keeps keys on your machine.`,
    },
    tools: [
      "gloam_info: this overview",
      "gloam_networks: networks, vault addresses, assets, explorers and faucets",
      "gloam_vault_stats: public vault totals (holdings, deposits, private transfers, cash outs)",
      "gloam_create_payment_request: a link that asks someone to pay your Gloam address privately",
      "gloam_verify_proof: check a proof of funds, proof of payment, payroll total or exact balance",
      "gloam_plan_deposit: steps and app link for a private deposit",
      "gloam_mpp_how_to: pay or charge privately over MPP (HTTP 402), with code",
      "gloam_connect_full_agent: install the local server that can sign and pay, with spending limits",
    ],
    status: STATUS,
    whatIsPublic: WHAT_IS_PUBLIC,
    links: { ...appLinks(ctx.origin), github: "https://github.com/cryptoduke01/gloam", email: "hello@gloam.trade" },
  };
}

function networkView(key: NetworkKey, origin: string) {
  const n = getNetwork(key);
  const faucet = faucetFor(key);
  const assets = requestAssetsFor(key);
  return {
    network: n.key,
    label: n.label,
    chainId: n.chainId,
    testnet: n.chain.testnet === true,
    status: n.status,
    note: n.note,
    rpc: n.chain.rpcUrls.default.http[0] ?? null,
    explorer: n.chain.blockExplorers?.default.url ?? null,
    pool: n.pool,
    poolExplorer: n.pool ? n.explorerAddress(n.pool) : null,
    deployBlock: n.deployBlock?.toString() ?? null,
    paymentMessageBoard: n.payMemo?.address ?? null,
    gas: n.family === "tempo" ? "Paid in stablecoins; Tempo has no gas coin. Deposits are tokens only." : "ETH",
    mainStablecoin: assets.find((a) => a.stable)?.symbol ?? null,
    assets: assets.map((a) => ({
      symbol: a.symbol,
      address: a.native ? null : a.address,
      decimals: a.decimals,
      stablecoin: a.stable,
      native: a.native,
    })),
    // a mainnet holds real money: no faucet
    faucet: faucet
      ? {
          url: faucet.url.startsWith("/") ? `${origin}${faucet.url}` : faucet.url,
          gives: faucet.assets,
          how: faucet.blurb,
          ...(key === "robinhood" ? { usdg: "Test USDG: https://faucet.paxos.com/" } : {}),
        }
      : null,
  };
}

function networks(args: Args, ctx: ToolContext) {
  const only = optNetwork(args);
  const keys = only ? [only] : NETWORK_KEYS;
  return {
    networks: keys.map((k) => networkView(k, ctx.origin)),
    status: STATUS,
  };
}

async function vaultStats(args: Args, ctx: ToolContext): Promise<CallToolResult> {
  const only = optNetwork(args);
  let m: Awaited<ReturnType<typeof fetchOnchainMetrics>>;
  try {
    m = await Promise.race([
      fetchOnchainMetrics(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), STATS_TIMEOUT_MS)),
    ]);
  } catch {
    return fail(`Could not read the vaults right now. Try again in a minute, or see ${ctx.origin}/transparency.`);
  }
  const nets = m.networks.filter((n) => !only || n.key === only);
  return ok({
    asOf: m.asOf,
    ageSec: m.ageSec,
    networks: nets.map((n) => ({
      network: n.key,
      label: n.label,
      testnet: n.testnet ?? getNetwork(n.key).testnet,
      chainId: n.chainId,
      pool: n.pool,
      vaultSince: n.vaultSince ? new Date(n.vaultSince * 1000).toISOString() : null,
      heldUsd: Math.round(n.heldUsd * 100) / 100,
      unpriced: n.unpriced,
      holdings: n.assets.map((a) => ({ symbol: a.symbol, stablecoin: a.stable, held: a.held, heldUsd: a.heldUsd })),
      deposits: n.deposits,
      privateTransfers: n.transfers,
      cashouts: n.cashouts,
      paymentMessages: n.memos,
      firstActivity: n.firstActivity ? new Date(n.firstActivity * 1000).toISOString() : null,
      lastActivity: n.lastActivity ? new Date(n.lastActivity * 1000).toISOString() : null,
      stillCatchingUp: n.catchingUp,
      readError: n.error ? "The last read of this network failed; these figures are from the read before it." : null,
    })),
    ...(only
      ? {}
      : {
          combined: {
            heldUsd: Math.round(m.combined.heldUsd * 100) / 100,
            deposits: m.combined.deposits,
            privateTransfers: m.combined.transfers,
            cashouts: m.combined.cashouts,
            paymentMessages: m.combined.memos,
          },
          ...(m.mainnet
            ? {
                mainnet: {
                  heldUsd: Math.round(m.mainnet.heldUsd * 100) / 100,
                  deposits: m.mainnet.deposits,
                  privateTransfers: m.mainnet.transfers,
                  cashouts: m.mainnet.cashouts,
                  paymentMessages: m.mainnet.memos,
                },
              }
            : {}),
        }),
    about:
      "Vault-level totals anyone can read from public nodes, the same figures as /transparency. Amounts of private transfers and who holds what inside a vault are not public, and are not here.",
    transparency: `${ctx.origin}/transparency`,
  });
}

function paymentRequest(args: Args, ctx: ToolContext): CallToolResult {
  const to = optString(args, "to", 600)?.trim();
  if (!to || !isValidRequestTag(to)) {
    return fail(
      `to must be your full Gloam address, starting gloamr1. It is public and safe to share. Find it in the app under Receive: ${ctx.origin}/app/vault?tab=move&mode=receive`
    );
  }
  const network = optNetwork(args, "robinhood")!;
  const label = getNetwork(network).label;
  const assetIn = optString(args, "asset", 64)?.trim();
  const asset = assetIn ? findRequestAsset(network, assetIn) : (requestAssetsFor(network).find((a) => a.stable) ?? null);
  if (!asset) {
    const names = requestAssetsFor(network).map((a) => a.symbol).join(", ");
    return fail(`Gloam does not support "${assetIn}" on ${label}. Use one of: ${names}.`);
  }
  const amount = normalizeRequestAmount(optString(args, "amount", 40) ?? "", asset);
  if ("error" in amount) return fail(amount.error);
  const note = cleanRequestText(optString(args, "note", 400) ?? "", REQUEST_NOTE_MAX);
  const name = cleanRequestText(optString(args, "name", 200) ?? "", REQUEST_NAME_MAX);
  const url = buildPaymentRequestLink({ to, network, asset, amount: amount.value, note, name }, ctx.origin);
  return ok({
    url,
    network,
    asset: { symbol: asset.symbol, address: asset.native ? null : asset.address, decimals: asset.decimals },
    amount: amount.value || null,
    note: note || null,
    name: name || null,
    howItWorks:
      "Send the link to the payer. It opens Pay in the Gloam app with these details filled in; they check them and press send, from their own wallet. The payment is private, and the note travels inside it, sealed so only you can read it.",
    privacy:
      `The details sit after the # in the link, so the payer's browser never sends them to a server, and nothing about the request goes on chain. This server built the link from what you sent and kept nothing. To make a request without any server seeing it, use the app: ${ctx.origin}/app/vault?tab=move&mode=receive`,
  });
}

function verdict(r: ApiVerifyResult): string {
  if (r.format === "gloamdisc1") return `Not verified. ${LEGACY_DISCLOSURE}`;
  if (r.ok) return "Valid. Every check passed.";
  if (r.expired) return "Expired. The proof may have been valid, but its holder set an expiry that has passed. Ask for a new one.";
  const failed = r.checks.filter((c) => c.state === "fail").map((c) => c.label);
  if (failed.length) return `Not valid. Failed: ${failed.join("; ")}.`;
  const unknown = r.checks.filter((c) => c.state === "unknown").map((c) => c.label);
  if (unknown.length) return `Not confirmed. Could not confirm: ${unknown.join("; ")}.`;
  return "Not valid.";
}

async function verifyProof(args: Args, ctx: ToolContext): Promise<CallToolResult> {
  const proof = optString(args, "proof", MAX_PROOF_TEXT)?.trim();
  if (!proof) return fail("Paste the full proof text, starting gloamfunds1:, gloampay1:, gloamroll1: or gloambal1:.");
  const rl = await hitRateLimit(ctx.ip, "verify", VERIFY_PER_MINUTE);
  if (!rl.allowed) return fail(`Too many proofs checked from here in the last minute. Try again in ${rl.retryAfterSec} seconds.`);
  let r: ApiVerifyResult;
  try {
    r = await verifyProofText(proof);
  } catch (e) {
    if (e instanceof ProofInputError) return fail(`${e.message} Proofs start gloamfunds1:, gloampay1:, gloamroll1: or gloambal1:.`);
    return fail(`Could not check this proof right now. Try again, or check it in the browser at ${ctx.origin}/verify.`);
  }
  return ok({
    ok: r.ok,
    verdict: verdict(r),
    kind: r.kind,
    format: r.format,
    expired: r.expired,
    checks: r.checks,
    paidAt: r.paidAt ? new Date(r.paidAt * 1000).toISOString() : null,
    paidBetween: r.paidBetween ? r.paidBetween.map((t) => new Date(t * 1000).toISOString()) : null,
    claims: r.claims,
    checkInBrowser: `${ctx.origin}/verify`,
  });
}

function planDeposit(args: Args, ctx: ToolContext): CallToolResult {
  const network = optNetwork(args, "tempo")!;
  const n = getNetwork(network);
  const assetIn = optString(args, "asset", 64)?.trim();
  const asset = assetIn ? findRequestAsset(network, assetIn) : (requestAssetsFor(network).find((a) => a.stable) ?? null);
  if (!asset) {
    const names = requestAssetsFor(network).map((a) => a.symbol).join(", ");
    return fail(`Gloam does not take "${assetIn}" on ${n.label}. Use one of: ${names}.`);
  }
  const amountIn = optString(args, "amount", 40) ?? "";
  const amount = normalizeRequestAmount(amountIn, asset);
  if ("error" in amount) return fail(amount.error);
  const how = amount.value ? `${amount.value} ${asset.symbol}` : asset.symbol;
  const faucet = faucetFor(network);
  const faucetUrl = faucet ? (faucet.url.startsWith("/") ? `${ctx.origin}${faucet.url}` : faucet.url) : null;
  const steps = [
    faucetUrl
      ? `Get test funds: ${faucetUrl}${network === "robinhood" && asset.symbol === "USDG" ? " (test USDG: https://faucet.paxos.com/)" : ""}.`
      : `Have the ${asset.symbol} in your own wallet on ${n.label}. This is mainnet: real money, with beta deposit limits the app shows before you sign.`,
    n.testnet
      ? `Open ${ctx.origin}/app/vault?tab=shield, connect a wallet (or sign in with a passkey), and choose ${n.label} in the network menu.`
      : `Open ${ctx.origin}/app/vault?tab=shield, connect a wallet, and choose ${n.label} mainnet in the network menu.`,
    `Pick ${asset.symbol} and enter ${amount.value ? amount.value : "the amount"}.`,
    ...(asset.native ? [] : [`Approve ${asset.symbol} for the Gloam vault: one signature in your wallet.`]),
    `Your browser makes a zero-knowledge proof that the deposit matches a new private note, then you sign one transaction to the vault (${n.pool}).`,
    `The note's secret is made in your browser and kept there, encrypted. Back it up from Settings (${ctx.origin}/app/settings): Gloam cannot recover it for you.`,
  ];
  return ok({
    plan: `Deposit ${how} into a private balance on ${n.label}${n.testnet ? "" : " mainnet"}`,
    network,
    chainId: n.chainId,
    asset: { symbol: asset.symbol, address: asset.native ? null : asset.address, decimals: asset.decimals },
    amount: amount.value || null,
    vault: n.pool,
    vaultExplorer: n.pool ? n.explorerAddress(n.pool) : null,
    signing: "This server does not sign or send anything. You sign in your own wallet, in the app.",
    steps: steps.map((s, i) => `${i + 1}. ${s}`),
    appLink: `${ctx.origin}/app/vault?tab=shield`,
    whatIsPublic: WHAT_IS_PUBLIC,
    anonymity: n.testnet ? ANONYMITY : MAINNET_ANONYMITY,
    checks:
      n.family === "tempo"
        ? "Before you sign, the app checks the depositing wallet against the OFAC sanctions list and the stablecoin's TIP-403 transfer policy."
        : "Before you sign, the app checks the depositing wallet against the OFAC sanctions list.",
    fasterWay: `Rather not click through it? Add the local server (${LOCAL_SERVER}) with a capped key and the agent can make this deposit for you with gloam_execute_shield, inside limits you set. See gloam_connect_full_agent.`,
    status: STATUS,
  });
}

const OUSD = "0x20c0000000000000000000006a37da5c996874be";
const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";

function mppHowTo(args: Args): CallToolResult {
  const role = optEnum(args, "role", ["pay", "charge", "both"] as const, "both");
  const network = optNetwork(args, "tempo")!;
  const n = getNetwork(network);
  // The SDK's GLOAM_NETWORKS names the testnet vaults by chain ("tempo", "robinhood").
  const family = n.family;
  // A mainnet gets the SDK 0.1.0 snippets: mainnetNetwork() for its vault and the final keys for proofs.
  if (!n.testnet) return mppHowToMainnet(role, network);
  const currencyLine =
    family === "tempo"
      ? `      network: "tempo",                                   // PathUSD by default; for OUSD add:\n      // currency: "${OUSD}", decimals: 6,`
      : `      network: "robinhood",                               // ETH by default; for USDG:\n      currency: "${USDG}", decimals: 6,`;
  const charge = {
    steps: [
      "Make a receive key once with generateReceiveKey() from @gloamtrade/sdk and keep it on the server. Its tag (gloamr1.…) is what payers pay to; the key itself never leaves your server.",
      "Add the gloam method to mppx. Routes answer 402 with a WWW-Authenticate: Payment challenge, then check the payer's credential.",
      "Before serving, the server sweeps the payment into a fresh note only it knows (save that note in beforeSubmit: it is the money). Until the sweep confirms, the payer could spend the payment back, so access waits for it.",
    ],
    code: `import { Mppx } from "mppx/server";
import { gloam } from "@gloamtrade/mppx-gloam/server";
import { gloamChargeChainFromClient } from "@gloamtrade/mppx-gloam/core";
import { artifactProver, relayIntent, GLOAM_NETWORKS } from "@gloamtrade/sdk";

const net = GLOAM_NETWORKS.${family};
const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  methods: [
    gloam({
${currencyLine}
      receiveKey,                                         // from generateReceiveKey(), stored server side
      chain: gloamChargeChainFromClient(publicClient, { pool: net.pool, fromBlock: net.deployBlock }),
      prove: artifactProver({ wasm: "transfer.wasm", zkey: "transfer_final.zkey" }),
      submit: (intent) => relayIntent(intent),            // or your own wallet
      beforeSubmit: (freshNote) => saveNote(freshNote),   // persist before the sweep goes out
    }),
  ],
});

export async function handler(request: Request) {
  const r = await mppx.charge({ amount: "0.01" })(request);
  if (r.status === 402) return r.challenge;
  return r.withReceipt(Response.json({ answer: 42 }));
}`,
  };
  const pay = {
    steps: [
      "The payer needs a private note in the same vault and asset (deposit first: see gloam_plan_deposit).",
      "Add the gloam method to an mppx client. On a 402 it checks the vault is Gloam's and the price is inside your policy, proves a private transfer to the payee's tag, and retries with Authorization: Payment.",
      'mode "pull" lets the server broadcast your transfer, so you need no gas and the server learns nothing about your wallet; "push" broadcasts it yourself or through the Gloam relay.',
    ],
    code: `import { Mppx } from "mppx/client";
import { gloam } from "@gloamtrade/mppx-gloam/client";
import { artifactProver, relayIntent } from "@gloamtrade/sdk";

const mppx = Mppx.create({
  polyfill: false,
  methods: [
    gloam({
      getNote: ({ amountWei, currency }) => wallet.noteCovering(amountWei, currency), // { secret, amountWei, path }
      prove: artifactProver({ wasm: "transfer.wasm", zkey: "transfer_final.zkey" }),
      mode: "auto",                                       // pull when offered, else push
      submit: (intent) => relayIntent(intent),            // only needed for push
      policy: { maxAmountWei: 50_000n },                  // refuse anything bigger, before proving
      beforeSubmit: (built) => wallet.keep(built.changeNote),
    }),
  ],
});

const res = await mppx.fetch("https://api.example.com/answer");`,
  };
  return ok({
    ...MPP_HEAD,
    network,
    install: "npm i mppx @gloamtrade/mppx-gloam @gloamtrade/sdk",
    ...(role !== "pay" ? { charge } : {}),
    ...(role !== "charge" ? { pay } : {}),
    ...MPP_TAIL,
    status: STATUS,
  });
}

const MPP_HEAD = {
  what: "MPP (mpp.dev) is HTTP 402 for machines: a server answers WWW-Authenticate: Payment, the client pays and retries with Authorization: Payment, and gets a Payment-Receipt. Other MPP methods settle in public. The gloam method pays with a private transfer inside a Gloam vault, sealed to the payee's receive tag.",
  whatIsPublic: "The chain sees shielded transfers: a nullifier and two commitments each. No amount, asset, payer or payee.",
};

const MPP_TAIL = {
  withoutMppx:
    "@gloamtrade/mppx-gloam/core has the whole method with no mppx dependency: createGloamPaywall on the server, createGloamChargeCredential with parsePaymentChallenges on the client.",
  noCode: `The local Gloam MCP server (${LOCAL_SERVER}) does this with no code: gloam_payment_requirements prices a resource as an MPP challenge (and x402), gloam_fetch_paid fetches a URL and pays a Gloam 402 privately, gloam_verify_payment checks a payment and sweeps it before you serve. It signs with its own key under spending limits. See gloam_connect_full_agent.`,
  keys: "Keys, receive keys and notes stay in your own code or the local server. Never paste them into a chat or this hosted server.",
  links: {
    package: "https://www.npmjs.com/package/@gloamtrade/mppx-gloam",
    readme: "https://github.com/cryptoduke01/gloam/tree/main/packages/mppx-gloam",
    spec: "https://github.com/cryptoduke01/gloam/blob/main/docs/mpp/draft-gloam-charge-00.md",
  },
};

/**
 * MPP on a mainnet, with the SDK 0.1.0 API: mainnetNetwork() gives the vault
 * (null until its pool is published), and proofs use the trusted setup's final
 * keys through circuitArtifactUrls(), never the testnet's development keys.
 */
function mppHowToMainnet(role: "pay" | "charge" | "both", network: NetworkKey): CallToolResult {
  const n = getNetwork(network);
  const family = n.family;
  const name = family === "tempo" ? "Tempo" : "Robinhood Chain";
  const asset =
    family === "tempo"
      ? { import: "TEMPO_USDCE", line: "      currency: TEMPO_USDCE, decimals: 6,                 // or TEMPO_PATHUSD, TEMPO_USDT0, TEMPO_OUSD" }
      : { import: "RH_MAINNET_USDG", line: "      currency: RH_MAINNET_USDG, decimals: 6,             // or GLOAM_TOKEN with decimals: 18" };
  const netLines = `const net = mainnetNetwork("${family}");                   // null until the pool is published
if (!net) throw new Error("${name} mainnet pool not published yet");`;
  const charge = {
    steps: [
      "Make a receive key once with generateReceiveKey() from @gloamtrade/sdk and keep it on the server. Its tag (gloamr1.…) is what payers pay to; the key itself never leaves your server.",
      "Add the gloam method to mppx. Routes answer 402 with a WWW-Authenticate: Payment challenge, then check the payer's credential.",
      "Before serving, the server sweeps the payment into a fresh note only it knows (save that note in beforeSubmit: it is the money). Until the sweep confirms, the payer could spend the payment back, so access waits for it.",
      "The sweep is a mainnet proof, so it must use the final keys: circuitArtifactUrls(\"transfer\", net.chainId).",
    ],
    code: `import { Mppx } from "mppx/server";
import { gloam } from "@gloamtrade/mppx-gloam/server";
import { gloamChargeChainFromClient } from "@gloamtrade/mppx-gloam/core";
import { artifactProver, circuitArtifactUrls, mainnetNetwork, relayIntent, ${asset.import} } from "@gloamtrade/sdk";

${netLines}
const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  methods: [
    gloam({
      network: net.chainId,                               // ${name} mainnet (${n.chainId}), real money
${asset.line}
      pools: { [net.chainId]: net.pool },                 // Gloam's mainnet vault
      receiveKey,                                         // from generateReceiveKey(), stored server side
      chain: gloamChargeChainFromClient(publicClient, { pool: net.pool, fromBlock: net.deployBlock }),
      prove: artifactProver(circuitArtifactUrls("transfer", net.chainId)), // the final keys
      submit: (intent) => relayIntent(intent),            // or your own wallet
      beforeSubmit: (freshNote) => saveNote(freshNote),   // persist before the sweep goes out
    }),
  ],
});

export async function handler(request: Request) {
  const r = await mppx.charge({ amount: "0.01" })(request);
  if (r.status === 402) return r.challenge;
  return r.withReceipt(Response.json({ answer: 42 }));
}`,
  };
  const pay = {
    steps: [
      `The payer needs a private note in the same ${name} mainnet vault and asset (deposit first: see gloam_plan_deposit). Deposits are capped during the beta.`,
      "Add the gloam method to an mppx client. On a 402 it checks the vault is Gloam's and the price is inside your policy, proves a private transfer to the payee's tag, and retries with Authorization: Payment.",
      'mode "pull" lets the server broadcast your transfer, so you need no gas and the server learns nothing about your wallet; "push" broadcasts it yourself or through the Gloam relay.',
      "Mainnet proofs must use the final keys: circuitArtifactUrls(\"transfer\", net.chainId).",
    ],
    code: `import { Mppx } from "mppx/client";
import { gloam } from "@gloamtrade/mppx-gloam/client";
import { artifactProver, circuitArtifactUrls, mainnetNetwork, relayIntent } from "@gloamtrade/sdk";

${netLines}
const mppx = Mppx.create({
  polyfill: false,
  methods: [
    gloam({
      getNote: ({ amountWei, currency }) => wallet.noteCovering(amountWei, currency), // { secret, amountWei, path }
      prove: artifactProver(circuitArtifactUrls("transfer", net.chainId)), // the final keys
      pools: { [net.chainId]: net.pool },                 // pay only into Gloam's mainnet vault
      mode: "auto",                                       // pull when offered, else push
      submit: (intent) => relayIntent(intent),            // only needed for push
      policy: { maxAmountWei: 50_000n },                  // refuse anything bigger, before proving
      beforeSubmit: (built) => wallet.keep(built.changeNote),
    }),
  ],
});

const res = await mppx.fetch("https://api.example.com/answer");`,
  };
  return ok({
    ...MPP_HEAD,
    network,
    mainnet: `${name} mainnet: real money, beta software with deposit limits. mainnetNetwork("${family}") in @gloamtrade/sdk 0.1.0 returns this vault (pool ${n.pool}, deploy block ${n.deployBlock}, chain ${n.chainId}); getGloamNetwork("${network}") is the same network by key. GLOAM_NETWORKS.${family} stays the testnet.`,
    install: "npm i mppx @gloamtrade/mppx-gloam@^0.1.0 @gloamtrade/sdk@^0.1.0",
    ...(role !== "pay" ? { charge } : {}),
    ...(role !== "charge" ? { pay } : {}),
    ...MPP_TAIL,
    status: STATUS,
  });
}

const CURSOR_DEEPLINK =
  "cursor://anysphere.cursor-deeplink/mcp/install?name=gloam&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBnbG9hbXRyYWRlL21jcCJdfQ==";

function connectFullAgent(args: Args): CallToolResult {
  const client = optEnum(
    args,
    "client",
    ["claude-code", "codex", "cursor", "vscode", "claude-desktop", "gemini", "all"] as const,
    "all"
  );
  const local = {
    "claude-code": {
      server: "claude mcp add gloam -- npx -y @gloamtrade/mcp",
      plugin: ["claude plugin marketplace add cryptoduke01/gloam-plugins", "claude plugin install gloam@gloam"],
      setup: "Then run /gloam:gloam-setup to give the agent a capped key.",
    },
    codex: {
      server: "codex mcp add gloam -- npx -y @gloamtrade/mcp",
      plugin: ["codex plugin marketplace add cryptoduke01/gloam-plugins", "codex plugin add gloam@gloam"],
    },
    cursor: {
      install: CURSOR_DEEPLINK,
      config: '~/.cursor/mcp.json: { "mcpServers": { "gloam": { "command": "npx", "args": ["-y", "@gloamtrade/mcp"] } } }',
    },
    vscode: {
      server: `code --add-mcp '{"name":"gloam","command":"npx","args":["-y","@gloamtrade/mcp"]}'`,
    },
    "claude-desktop": {
      config: 'claude_desktop_config.json: { "mcpServers": { "gloam": { "command": "npx", "args": ["-y", "@gloamtrade/mcp"] } } }',
    },
    gemini: {
      config: '~/.gemini/settings.json: { "mcpServers": { "gloam": { "command": "npx", "args": ["-y", "@gloamtrade/mcp"] } } }',
    },
  } as const;
  const chosen = client === "all" ? local : { [client]: local[client] };
  return ok({
    why: "This hosted server reads and plans. The local server also signs and pays: shield, private pay, x402 and MPP (gloam_fetch_paid, gloam_verify_payment), with note secrets kept encrypted on your machine and spending limits checked before anything is signed.",
    localServer: LOCAL_SERVER,
    commands: chosen,
    pluginMarketplace: {
      repo: "https://github.com/cryptoduke01/gloam-plugins",
      adds: "The local server plus two skills: gloam (pay, get paid and check limits safely) and gloam-setup (connect, and give the agent a capped Tempo access key).",
      skillsOnly: ["gh skill install cryptoduke01/gloam-plugins gloam", "gh skill install cryptoduke01/gloam-plugins gloam-setup"],
    },
    letItSpend: [
      "Out of the box the local server only reads and plans too. Nothing is signed until it has a key.",
      "Recommended: a Tempo access key with an expiry, a spending limit per period and call scopes, enforced by Tempo on every transaction:",
      "npx -y @gloamtrade/mcp authorize-access-key --owner 0xYOUR_TEMPO_ACCOUNT --generate --limit 10 --period 1d --expires 30d",
      "Authorize it from the owner wallet, then check it: npx -y @gloamtrade/mcp authorize-access-key --check --owner 0xYOUR_TEMPO_ACCOUNT",
      "Settings live in ~/.gloam/agent.env (mode 600). Never paste a key into a chat.",
    ],
    hostedServer: {
      url: MCP_URL,
      claude: "Settings, Connectors, Add custom connector, paste the URL.",
      chatgpt: "Settings, Apps and connectors: turn on developer mode, then create a connector with the URL and no authentication.",
      claudeCode: `claude mcp add --transport http gloam-hosted ${MCP_URL}`,
      cursor: `~/.cursor/mcp.json: { "mcpServers": { "gloam-hosted": { "url": "${MCP_URL}" } } }`,
      vscode: `code --add-mcp '{"name":"gloam-hosted","type":"http","url":"${MCP_URL}"}'`,
      codex: `~/.codex/config.toml: [mcp_servers.gloam-hosted] url = "${MCP_URL}"`,
    },
    docs: `${SITE}/docs/agents`,
    readme: "https://github.com/cryptoduke01/gloam/tree/main/mcp",
  });
}

/** Runs a tool. Secrets are refused before any tool runs. */
export async function callTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const secret = findSecret(rawArgs);
  if (secret) return fail(secretWarning(secret));
  const args: Args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? (rawArgs as Args) : {};
  try {
    switch (name) {
      case "gloam_info":
        return ok(info(ctx));
      case "gloam_networks":
        return ok(networks(args, ctx));
      case "gloam_vault_stats":
        return await vaultStats(args, ctx);
      case "gloam_create_payment_request":
        return paymentRequest(args, ctx);
      case "gloam_verify_proof":
        return await verifyProof(args, ctx);
      case "gloam_plan_deposit":
        return planDeposit(args, ctx);
      case "gloam_mpp_how_to":
        return mppHowTo(args);
      case "gloam_connect_full_agent":
        return connectFullAgent(args);
      default:
        return fail(`Unknown tool "${name}". Call gloam_info to see what this server can do.`);
    }
  } catch (e) {
    if (e instanceof ArgError) return fail(e.message);
    return fail("Something went wrong on Gloam's side. Try again shortly.");
  }
}
