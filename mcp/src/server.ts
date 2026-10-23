/**
 * The Gloam MCP tools.
 *
 * Gives an AI agent private payment tools across Gloam's networks: Robinhood
 * Chain and Tempo, each on mainnet (real money, the ceremony's final keys, beta
 * deposit limits, payments only) and testnet (test funds, dev keys). Tools take
 * a `network` (default: GLOAM_NETWORK, else Robinhood Chain testnet), and the
 * 402 payment tools settle on whatever network the price names. Private trading
 * is not live on any network; the market and trade tools only plan.
 *
 * This exposes read + planning tools that work today, and returns honest
 * "intent" objects for write actions (shield / pay / send) when there is no
 * signer. It never fakes a private fill or settlement.
 *
 * Every tool that moves money (shield, public send, private pay) first passes
 * the owner's spending limits (src/policy.ts, src/spendGuard.ts): allowed
 * tools, assets, recipients, a cap per payment and per rolling day, and an
 * expiry. No limits configured means no spending. The limits are enforced here,
 * off-chain, not by the vault contract.
 *
 * The payment tools speak two 402 dialects with the same private settlement:
 * x402 (scheme gloam-private, X-PAYMENT header) and MPP, the Machine Payments
 * Protocol (WWW-Authenticate: Payment, method "gloam", intent "charge"; see
 * src/mpp.ts and docs/mpp/draft-gloam-charge-00.md).
 *
 * Note secrets never reach the agent. Notes live in an encrypted store inside
 * this server (src/noteStore.ts); tools hand out and take back short handles.
 * Payments are sealed to the payee's receive tag, and a payee settles a
 * received payment by sweeping it into a fresh note before granting access.
 * GLOAM_EXPOSE_NOTE_SECRETS=1 brings back the old secret-passing behavior; it is
 * unsafe and off by default.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatUnits, isAddress, parseEther, parseUnits, type Address, type Hex } from "viem";
import {
  buildShieldBoundIntent,
  artifactProver,
  NATIVE_ASSET,
  buildGloamPaymentRequirements,
  buildGloamPayment,
  verifyGloamPayment,
  verifyPaymentNoteBinding,
  noteFieldProblem,
  encodeRequirements,
  decodeRequirements,
  encodePaymentHeader,
  decodePaymentHeader,
  openGloamPaymentNote,
  sweepReceivedNote,
  generateReceiveKey,
  isReceiveTag,
  isSealedTicket,
  syncTree,
  noteCommitmentPoseidon,
  noteNullifierPoseidon,
  fieldToHex,
  hexToField,
  transferCallArgs,
  POOL_TRANSFER_ABI,
  POOL_STATE_ABI,
  GLOAM_NOT_FINAL,
  GLOAM_VS_ZONE,
  GLOAM_RELAY_URL,
  GLOAM_X402_SCHEME,
  relayIntent,
  GloamRelayError,
  assertDepositAllowed,
  type GloamIntent,
  type GloamPaymentPayload,
  type GloamPaymentRequirements,
  type NoteExport,
  type Prover,
  type RelayOptions,
  type SweepChain,
} from "@gloamtrade/sdk";
import { CHAIN, MARKETS, PRIVACY_STATUS, findMarket } from "./data.js";
import { getPublicClient, getSigner, signerSetup, type Signer } from "./signer.js";
import { checkAccessKey } from "./accessKey.js";
import { packageVersion } from "./version.js";
import { shieldArtifacts, transferArtifacts } from "./artifacts.js";
import {
  allNetworks,
  defaultNetworkKey,
  describeNetwork,
  networkByKey,
  networkByChainId,
  tempoAccessNetwork,
  MCP_NETWORKS,
  NETWORK_KEYS,
  type McpNetwork,
} from "./networks.js";
import { KNOWN_ASSETS, assetLabel, type Spend } from "./policy.js";
import { authorizeSpend, limitsReport, previewSpend, settleSpend, spendingReport } from "./spendGuard.js";
import { balances, noteView, openNoteStore, type NoteStore, type StoredNote } from "./noteStore.js";
import { guardedFetch } from "./safeFetch.js";
import {
  credentialField,
  credentialFromPayment,
  fromPaymentRequirements,
  isExpired,
  parseGloamChargePayload,
  parseGloamChargeRequest,
  parseReceipt,
  payerTransferIntent,
  serializeReceipt,
  termsMismatch,
  validateGloamCharge,
  verifyChallengeId,
  GloamChargeError,
  type GloamChargeReceipt,
  type GloamChargeRequest,
  type PaymentChallenge,
  type ValidatedGloamCharge,
} from "@gloamtrade/mppx-gloam/core";
import {
  cannotPay,
  gloamChallenges,
  looksLikeMpp,
  mppChain,
  mppChallengeFor,
  mppSecret,
  parseMppChallenge,
  parseMppCredential,
  requirementsFromChallenge,
  MPP_DEFAULT_EXPIRES_SECONDS,
} from "./mpp.js";

type Env = Record<string, string | undefined>;
type ChainClient = Signer["publicClient"];

/** Everything the tools touch outside this file, injectable for tests. */
export interface ServerDeps {
  /** Read at call time (limits, relay, keys), except GLOAM_EXPOSE_NOTE_SECRETS, read once at startup. */
  env: Env;
  signer(net: McpNetwork): Signer | null;
  publicClient(net: McpNetwork): ChainClient;
  /** The prover for `net`'s key set: dev keys on testnet, the ceremony's final keys on mainnet. */
  shieldProver(net?: McpNetwork): Promise<Prover>;
  transferProver(net?: McpNetwork): Promise<Prover>;
  syncTree: typeof syncTree;
  relay(intent: GloamIntent, opts: RelayOptions): Promise<Hex>;
  fetch: typeof fetch;
}

function defaultDeps(env: Env): ServerDeps {
  return {
    env,
    signer: (net) => getSigner(net, env),
    publicClient: (net) => getPublicClient(net),
    shieldProver: async (net) => artifactProver(await shieldArtifacts(net?.ceremony ?? "dev")),
    transferProver: async (net) => artifactProver(await transferArtifacts(net?.ceremony ?? "dev")),
    syncTree,
    relay: relayIntent,
    fetch: guardedFetch(env),
  };
}

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
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

const shieldPoolAbi = [
  {
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
  },
] as const;

function text(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof value === "string"
            ? value
            : JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
      },
    ],
  };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function parseRequirements(input: string): GloamPaymentRequirements | null {
  try {
    return decodeRequirements(input);
  } catch {
    try {
      return JSON.parse(input) as GloamPaymentRequirements;
    } catch {
      return null;
    }
  }
}

function parsePayment(input: string): GloamPaymentPayload | null {
  try {
    return decodePaymentHeader(input);
  } catch {
    try {
      return JSON.parse(input) as GloamPaymentPayload;
    } catch {
      return null;
    }
  }
}

/**
 * A price from either 402 dialect: x402 requirements (encoded or JSON) or an
 * MPP gloam challenge (a WWW-Authenticate `Payment …` value). An MPP challenge
 * comes back with its x402-equivalent requirements, so the spend gate and the
 * payment builder treat both the same.
 */
function parsePriced(input: string): { req: GloamPaymentRequirements; mpp: PaymentChallenge | null } | { error: string } {
  if (looksLikeMpp(input)) {
    const ch = parseMppChallenge(input);
    if (!ch) return { error: "That is a Payment challenge, but not a gloam/charge one this server can pay." };
    try {
      return { req: requirementsFromChallenge(ch).req, mpp: ch };
    } catch (e) {
      return { error: errMsg(e) };
    }
  }
  const req = parseRequirements(input);
  return req ? { req, mpp: null } : { error: "Could not parse requirements." };
}

function assetInfo(chainId: number, asset: Address, fallbackDecimals = 18) {
  const known = KNOWN_ASSETS.find((a) => a.chainId === chainId && a.address.toLowerCase() === asset.toLowerCase());
  return { symbol: known?.symbol ?? assetLabel(chainId, asset), decimals: known?.decimals ?? fallbackDecimals };
}

/** A spend reservation with no transaction after this long was never sent (a crash between reserve and broadcast). */
const STUCK_MS = 10 * 60 * 1000;

/** Relay answers that do not prove the transaction stayed unsent: the node may have taken it before the error. */
const RELAY_MAYBE_SENT = ["maybe_sent", "rpc", "network", "error", "internal", "in_flight"];

/**
 * Whether a send that threw may still have put the transaction on chain.
 * Through the relay only a refusal it names (limits, screening, a failed dry
 * run) is sure; a lost connection or an unclear answer is not. A wallet send is
 * judged as before: no hash back, not sent.
 */
function mayHaveSent(err: unknown, viaRelay: boolean): boolean {
  if (!viaRelay) return false;
  return !(err instanceof GloamRelayError) || RELAY_MAYBE_SENT.includes(err.code);
}

const shortTag = (t: string) => (t.length > 30 ? `${t.slice(0, 18)}…${t.slice(-6)}` : t);

const AGENT_WALLET_NOTE =
  "This build does not sign or broadcast. Connect an agent wallet with signing (e.g. Turnkey embedded wallet + policy) to execute this intent. Returned as a plan an agent or human can approve.";

const NO_SIGNER =
  "No signer configured. Set GLOAM_AGENT_PRIVATE_KEY to execute. For limits the protocol enforces on Tempo, make the agent a Tempo access key: npx -y @gloamtrade/mcp authorize-access-key --owner <account> --generate";

const LEGACY_WARNING =
  "GLOAM_EXPOSE_NOTE_SECRETS=1 is set: note secrets are passed to and from the agent. Anyone who reads a secret can spend that money, and spending limits cannot stop that. Turn it off unless you are migrating old notes.";

/** Build a Gloam MCP server. Pass deps to test it without a chain. */
export function createGloamServer(overrides: Partial<ServerDeps> = {}): McpServer {
  const deps: ServerDeps = { ...defaultDeps(overrides.env ?? process.env), ...overrides };
  const env = deps.env;
  /** The network a tool uses when the agent names none. Throws at startup on a GLOAM_NETWORK this build lacks. */
  const defaultNet = defaultNetworkKey(env);
  const networkArg = (what: string) =>
    z
      .enum(NETWORK_KEYS)
      .default(defaultNet)
      .describe(
        `${what} ${NETWORK_KEYS.map((k) => `"${k}"`).join(", ")}. The -mainnet ones are real money (beta deposit limits); "robinhood" and "tempo" are the testnets (test funds). Default here: "${defaultNet}".`
      );
  /** Old behavior: secrets in tool results and arguments. Read once; restart to change. */
  const legacy = env.GLOAM_EXPOSE_NOTE_SECRETS?.trim() === "1";
  const server = new McpServer({ name: "gloam", version: packageVersion() });

  const relayUrl = () =>
    env.GLOAM_RELAY_URL?.trim() || (env.GLOAM_USE_RELAY?.trim() === "1" ? GLOAM_RELAY_URL : "");

  /** Never throws: a broken store must not hide that money already moved. */
  const tryStore = (fn: () => void): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (e) {
      return `Could not update the note store: ${errMsg(e)}`;
    }
  };

  function openStore(): { ok: true; store: NoteStore } | { ok: false; error: string } {
    try {
      const store = openNoteStore(env);
      store.read(); // fail now, before anything is reserved or signed
      return { ok: true, store };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  function sweepChain(client: ChainClient, net: McpNetwork): SweepChain {
    return {
      isSpent: (nullifier) =>
        client.readContract({ address: net.pool, abi: POOL_STATE_ABI, functionName: "isSpent", args: [nullifier] }),
      isCommitmentSeen: (commitment) =>
        client.readContract({ address: net.pool, abi: POOL_STATE_ABI, functionName: "commitmentSeen", args: [commitment] }),
      pathForCommitment: async (commitment) =>
        (await deps.syncTree(client, { pool: net.pool, fromBlock: net.deployBlock })).pathForCommitment(commitment),
      waitForReceipt: async (hash) => ({ status: (await client.waitForTransactionReceipt({ hash })).status }),
    };
  }

  server.registerTool(
    "gloam_info",
    {
      title: "About Gloam",
      description:
        "What Gloam is, which networks it runs on, and what an agent can do with it. Call this first.",
    },
    async () =>
      text({
        what: "Gloam is private stablecoin payments for people and AI agents on Robinhood Chain and Tempo. Hold a private balance, pay and get paid without putting amounts or counterparties on the public chain, and prove one fact to one reader when needed.",
        whyAgentsCareMost:
          "Agents pay for tools and data all day. On a public chain every payment shows who it pays, how much and how often, which leaks the agent's whole strategy. Gloam keeps those payments private.",
        networks: allNetworks().map((n) => ({
          key: n.key,
          network: describeNetwork(n),
          chainId: n.chainId,
          pool: n.pool,
          keys: n.ceremony === "production" ? "the trusted setup's final keys" : "dev keys",
        })),
        defaultNetwork: defaultNet,
        mainnet:
          "Mainnet is beta and moves real money. The mainnet pools take payments only (no private trading), with beta deposit limits of 500 per deposit and 25,000 in total for each stablecoin (25,000 and 250,000 for GLOAM). Deposits and private payments are free; cashing out costs 0.25%. Reviewed internally before launch; an external audit is planned, not done.",
        tools: [
          "gloam_privacy_status: honest privacy posture, what is public vs private (read)",
          "gloam_list_markets: markets for private trading, which is NOT live yet; indicative testnet marks (read)",
          "gloam_quote: indicative quote for a future private trade (read)",
          "gloam_plan_private_trade: plan a private trade; it cannot execute while private trading is off (planning)",
          "gloam_plan_shield: describe a shield before executing (planning)",
          "gloam_execute_shield: REAL private deposit. Mints a note, proves, and broadcasts shieldBound; returns a note handle (execution; needs a signer)",
          "gloam_execute_transfer: sign and broadcast a public transfer of test ETH on Robinhood Chain testnet, for funding (execution; needs a signer)",
          "gloam_list_notes: this server's private notes as handles, and the private balance per asset (read)",
          "gloam_receive_tag: this server's receive tag, for others to pay it privately (read)",
          "gloam_payment_requirements: price an agent resource in a private payment, as x402 requirements and an MPP challenge (server side)",
          "gloam_pay_x402: plan the private payment for a 402 challenge, x402 or MPP (agent side)",
          "gloam_execute_private_pay: REAL private settlement from a note handle: sync, prove, broadcast transfer; returns the X-PAYMENT header, or the Authorization credential for an MPP challenge (execution; needs a signer)",
          "gloam_fetch_paid: fetch a URL and, if it answers 402 with a Gloam price (x402, or MPP method gloam), pay privately and retry, all inside this server (execution; needs a signer)",
          "gloam_verify_payment: open a presented payment (x402 X-PAYMENT or MPP Authorization: Payment), verify it, and sweep it into a fresh note; grant access only when it says so (server side)",
          "gloam_get_limits: this agent's spending limits (read)",
          "gloam_get_spending_report: spent and remaining in the last 24 hours, recent payments and refusals (read)",
        ],
        notes: legacy
          ? LEGACY_WARNING
          : "Note secrets stay inside this server, encrypted. Tools give the agent handles (like n-k3x9p2qw7m) and amounts, never a secret.",
        spendingLimits:
          "Every execute tool that moves money checks the owner's limits first (tools, assets, recipients, per payment, per day, expiry) and logs the spend. The MCP server enforces them, off-chain; the vault contract does not.",
        privatePayments:
          "Agent payments over HTTP 402 (x402, or MPP with the gloam method) settle privately through the Gloam pool, sealed to the payee's receive tag. The payee sweeps each payment into a fresh note before serving, so a payer cannot take it back. Unlike a Tempo Zone, there is no operator that sees the transaction.",
      })
  );

  server.registerTool(
    "gloam_privacy_status",
    {
      title: "Privacy status",
      description:
        "Honest, current privacy posture: what is live, what is not, and how strong the anonymity set is. Agents should check this before assuming a trade is fully private.",
    },
    async () => text(PRIVACY_STATUS)
  );

  server.registerTool(
    "gloam_list_markets",
    {
      title: "List markets",
      description:
        "List the markets planned for private trading on Gloam, with indicative testnet marks. Private trading is not live on any network yet (mainnet takes payments only), so these are for planning.",
      inputSchema: {
        kind: z.enum(["stock", "crypto", "all"]).default("all").describe("Filter by asset kind."),
      },
    },
    async ({ kind }) => {
      const list = kind === "all" ? MARKETS : MARKETS.filter((m) => m.kind === kind);
      return text({
        count: list.length,
        note: "Marks are indicative testnet values. Private trading is not live yet: these markets cannot be traded today.",
        markets: list,
      });
    }
  );

  server.registerTool(
    "gloam_quote",
    {
      title: "Quote a private trade",
      description:
        "Indicative quote for buying or selling a market, plus exactly what stays private and what becomes public.",
      inputSchema: {
        market: z.string().describe("Symbol or id, e.g. TSLA or eth."),
        side: z.enum(["buy", "sell"]),
        usd: z.number().positive().describe("Trade size in USD."),
      },
    },
    async ({ market, side, usd }) => {
      const m = findMarket(market);
      if (!m) return text({ error: `Unknown market "${market}". Call gloam_list_markets.` });
      const units = usd / m.mark;
      return text({
        market: m.symbol,
        side,
        usd,
        estimatedUnits: Number(units.toFixed(6)),
        markUsd: m.mark,
        staysPrivate: ["your size", "your position", "who you are"],
        becomesPublic: ["only that a private trade occurred, not the amount"],
        note: "Indicative only, and private trading is not live yet, so this cannot be executed today. Size privacy depends on the current anonymity set (see gloam_privacy_status).",
      });
    }
  );

  server.registerTool(
    "gloam_plan_private_trade",
    {
      title: "Plan a private trade",
      description:
        "Plan a private trade (never executes). Private trading is not live on any network yet, so this is a plan only.",
      inputSchema: {
        market: z.string().describe("Symbol or id, e.g. TSLA."),
        side: z.enum(["buy", "sell"]),
        usd: z.number().positive(),
        agentAddress: z.string().optional().describe("The agent wallet address that would own the private position."),
      },
    },
    async ({ market, side, usd, agentAddress }) => {
      const m = findMarket(market);
      if (!m) return text({ error: `Unknown market "${market}". Call gloam_list_markets.` });
      return text({
        intent: "private_trade",
        chainId: CHAIN.chainId,
        market: m.symbol,
        side,
        usd,
        estimatedUnits: Number((usd / m.mark).toFixed(6)),
        agentAddress: agentAddress ?? null,
        privacy: "Size and position stay off the public chain.",
        status: "Private trading is switched off on every network while a new engine is built. The mainnet pools take payments only.",
        execution: AGENT_WALLET_NOTE,
      });
    }
  );

  server.registerTool(
    "gloam_plan_shield",
    {
      title: "Plan a shield (deposit to private)",
      description:
        "Describe moving funds into a private balance (shield), the first step before paying privately. To actually shield, use gloam_execute_shield.",
      inputSchema: {
        asset: z.string().default("ETH").describe("Asset to shield, e.g. USDG, USDC.e, or ETH on testnet."),
        usd: z.number().positive().describe("Amount to shield, in USD."),
        agentAddress: z.string().optional(),
      },
    },
    async ({ asset, usd, agentAddress }) =>
      text({
        intent: "shield",
        chainId: CHAIN.chainId,
        asset: asset.toUpperCase(),
        usd,
        agentAddress: agentAddress ?? null,
        result: "Funds enter a private balance. The public chain loses the trail.",
        execution: AGENT_WALLET_NOTE,
      })
  );

  server.registerTool(
    "gloam_execute_shield",
    {
      title: "Execute a private shield",
      description:
        "Deposit into a PRIVATE balance on the chosen Gloam network. Mints a note, generates the Groth16 shield proof server-side with that network's keys, and broadcasts shieldBound() (approving the ERC-20 first when the asset is a token). On mainnet (real money) the pool takes USDG or GLOAM on Robinhood Chain and USDC.e, pathUSD, USDT0 or OUSD on Tempo, at most 500 of a stablecoin (25,000 GLOAM) per deposit during the beta; deposits are free. The note's secret stays inside this server; the agent gets a note handle to pay from later (gloam_execute_private_pay, gloam_list_notes). Requires GLOAM_AGENT_PRIVATE_KEY; without it, returns a plan.",
      inputSchema: {
        amount: z
          .number()
          .positive()
          .describe("Amount to shield into a private balance, in the asset's units (e.g. 25 for 25 USDC.e)."),
        network: networkArg("Which network to shield on:"),
        asset: z
          .string()
          .optional()
          .describe(
            "ERC-20 token address to shield; omit to use the network default (USDG on Robinhood Chain mainnet, USDC.e on Tempo mainnet, PathUSD on Tempo testnet, native ETH on Robinhood Chain testnet)."
          ),
        decimals: z
          .number()
          .int()
          .optional()
          .describe("Decimals of the asset; omit to use the asset's own (6 for the stablecoins, 18 for GLOAM and ETH)."),
      },
    },
    async ({ amount, network, asset, decimals }) => {
      if (asset !== undefined && !isAddress(asset)) {
        return text({ status: "error", error: `"${asset}" is not a valid token address.` });
      }
      const net = networkByKey(network);
      const assetAddr = (asset as Address | undefined) ?? net.defaultAsset;
      const dec = decimals ?? (asset ? assetInfo(net.chainId, assetAddr).decimals : net.defaultAssetDecimals);
      const amountWei = parseUnits(String(amount), dec);
      const isNative = assetAddr.toLowerCase() === NATIVE_ASSET.toLowerCase();
      // Mainnet pools list their assets and cap each deposit during the beta: say so before anything is reserved or signed.
      try {
        assertDepositAllowed(net.chainId, assetAddr, amountWei);
      } catch (e) {
        return text({ status: "error", network: net.key, error: errMsg(e) });
      }
      const spend: Spend = {
        tool: "shield",
        network: net.key,
        chainId: net.chainId,
        asset: assetAddr,
        amountWei,
        recipient: null,
      };
      const signer = deps.signer(net);
      if (!signer) {
        return text({
          status: "no_signer",
          plan: { action: "shield", amount, asset: assetAddr, network: net.key, realMoney: !net.testnet, chainId: net.chainId, pool: net.pool },
          limits: previewSpend(spend, env),
          message: NO_SIGNER,
        });
      }
      // The note must have somewhere safe to live before any money moves.
      const opened = openStore();
      if (!opened.ok) return text({ status: "error", error: opened.error });
      const notes = opened.store;
      const gate = authorizeSpend(spend, env);
      if (!gate.ok) return text(gate.refusal);
      let hash: Hex | undefined;
      let held: StoredNote | undefined;
      try {
        const intent = await buildShieldBoundIntent({
          amountWei,
          asset: assetAddr,
          chainId: net.chainId,
          poolAddress: net.pool,
          prover: await deps.shieldProver(net),
        });
        // Keep the note before anything is broadcast, so a crash mid-flight cannot lose it.
        held = notes.add({
          network: net.key,
          chainId: net.chainId,
          pool: net.pool,
          asset: assetAddr,
          symbol: assetInfo(net.chainId, assetAddr, dec).symbol,
          decimals: dec,
          amountWei: amountWei.toString(),
          secret: intent.note.secret,
          commitment: intent.note.commitment,
          nullifier: intent.note.nullifier,
          status: "pending",
          pending: "create",
          origin: "shield",
          createdTx: null,
        });
        // ERC-20 shields (every mainnet asset, PathUSD on Tempo testnet) approve
        // the pool to pull the tokens before shieldBound; native shields carry value instead.
        let approveHash: Hex | undefined;
        if (!isNative) {
          approveHash = await signer.walletClient.writeContract({
            address: assetAddr,
            abi: erc20Abi,
            functionName: "approve",
            args: [net.pool, amountWei],
          });
          await signer.publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        hash = await signer.walletClient.writeContract({
          address: intent.exec.poolAddress,
          abi: shieldPoolAbi,
          functionName: "shieldBound",
          args: intent.exec.args as readonly [Address, bigint, Hex, Hex],
          value: intent.exec.valueWei,
        });
        const sentHash = hash;
        const storeWarning = tryStore(() => notes.update(held!.handle, { createdTx: sentHash }));
        const receipt = await signer.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          settleSpend(gate, "reverted", { hash });
          tryStore(() => notes.remove(held!.handle));
          return text({ status: "error", error: `Shield reverted (${hash}). Nothing moved.`, hash });
        }
        const logWarning = settleSpend(gate, "sent", { hash });
        let stored: StoredNote = { ...held, status: "unspent", createdTx: hash };
        const confirmWarning = tryStore(() => {
          stored = notes.update(held!.handle, { status: "unspent", createdTx: sentHash }) ?? stored;
        });
        const noteWarning = storeWarning ?? confirmWarning;
        return text({
          status: "confirmed",
          ...(logWarning ? { logWarning } : {}),
          ...(noteWarning ? { noteWarning } : {}),
          network: net.key,
          approveHash,
          hash,
          from: signer.account.address,
          explorer: `${net.explorer}/tx/${hash}`,
          note: legacy
            ? { ...noteView(stored), secret: intent.note.secret, commitment: intent.note.commitment, decimals: dec }
            : noteView(stored),
          ...(legacy
            ? { warning: LEGACY_WARNING }
            : { keep: "Pay from this balance with gloam_execute_private_pay (by note handle, or let the server pick). The secret stays in this server." }),
          privacy:
            "The deposit amount is public. The note hides who can spend it, so future private sends are unlinkable to this deposit.",
        });
      } catch (err) {
        const error = errMsg(err);
        settleSpend(gate, hash ? "unconfirmed" : "failed", { hash, reason: error });
        // Nothing broadcast: forget the note. Broadcast: keep it pending, it may still land.
        if (held && !hash) tryStore(() => notes.remove(held!.handle));
        return text({
          status: "error",
          error,
          ...(hash ? { hash, note: held ? { handle: held.handle, status: "pending" } : undefined, check: "Call gloam_list_notes with refresh to see whether it landed." } : {}),
        });
      }
    }
  );

  server.registerTool(
    "gloam_execute_transfer",
    {
      title: "Execute a transfer (public)",
      description:
        "Send test ETH publicly on Robinhood Chain TESTNET from the agent wallet, for funding while practicing. This is the PUBLIC rail (amount and recipient are visible) and testnet only. For private movement, use gloam_execute_shield and gloam_execute_private_pay. Requires GLOAM_AGENT_PRIVATE_KEY; without it, returns a plan only.",
      inputSchema: {
        to: z.string().describe("Recipient 0x address."),
        eth: z.number().positive().describe("Amount of testnet ETH to send."),
      },
    },
    async ({ to, eth }) => {
      if (!isAddress(to)) {
        return text({ status: "error", error: `"${to}" is not a valid address.` });
      }
      const spend: Spend = {
        tool: "send",
        network: "robinhood",
        chainId: CHAIN.chainId,
        asset: NATIVE_ASSET,
        amountWei: parseEther(String(eth)),
        recipient: to,
      };
      const signer = deps.signer(MCP_NETWORKS.robinhood);
      if (!signer) {
        return text({
          status: "no_signer",
          plan: { action: "transfer", to, eth, chainId: CHAIN.chainId },
          limits: previewSpend(spend, env),
          message: NO_SIGNER,
        });
      }
      const gate = authorizeSpend(spend, env);
      if (!gate.ok) return text(gate.refusal);
      try {
        const hash = await signer.walletClient.sendTransaction({ to: to as Address, value: spend.amountWei });
        const logWarning = settleSpend(gate, "sent", { hash });
        return text({
          status: "submitted",
          ...(logWarning ? { logWarning } : {}),
          hash,
          from: signer.account.address,
          explorer: `${CHAIN.explorer}/tx/${hash}`,
        });
      } catch (err) {
        const error = errMsg(err);
        settleSpend(gate, "failed", { reason: error });
        return text({ status: "error", error });
      }
    }
  );

  // ── notes ───────────────────────────────────────────────────────────────────

  server.registerTool(
    "gloam_list_notes",
    {
      title: "Private notes and balance",
      description:
        "This server's private notes as handles, with network, asset, amount, status (unspent, pending, spent) and the transaction that created each one, plus the spendable private balance per asset. Never shows a secret. Pass refresh to check pending notes against the chain.",
      inputSchema: {
        network: z.enum(NETWORK_KEYS).optional().describe("Only this network."),
        includeSpent: z.boolean().default(false).describe("Also list spent notes."),
        refresh: z.boolean().default(false).describe("Check pending notes on chain first (read-only calls)."),
      },
    },
    async ({ network, includeSpent, refresh }) => {
      const opened = openStore();
      if (!opened.ok) return text({ status: "error", error: opened.error });
      const notes = opened.store;
      const refreshed: string[] = [];
      if (refresh) {
        for (const n of notes.list().filter((x) => x.status === "pending")) {
          const net = networkByChainId(n.chainId);
          if (!net) continue;
          try {
            const client = deps.signer(net)?.publicClient ?? deps.publicClient(net);
            const chain = sweepChain(client, net);
            const failed = async (hash: Hex | null | undefined) =>
              !!hash && (await client.getTransactionReceipt({ hash }).then((r) => r.status === "reverted", () => false));
            if (n.pending === "spend") {
              if (await chain.isSpent(n.nullifier)) {
                notes.update(n.handle, { status: "spent" });
                refreshed.push(`${n.handle}: spent`);
              } else if (n.spentTx ? await failed(n.spentTx) : Date.now() - Date.parse(n.updatedAt) > STUCK_MS) {
                // Never spent on chain, and its spend reverted or was never sent: spendable again.
                // (If a copy is still in flight it will revert: the nullifier spends once.)
                notes.update(n.handle, { status: "unspent", spentTx: null });
                refreshed.push(`${n.handle}: spendable again`);
              }
            } else if (await chain.isCommitmentSeen(n.commitment)) {
              // A payment this server sent is the payee's once it lands, never this server's balance.
              const sent = n.origin === "payment";
              notes.update(n.handle, { status: sent ? "spent" : "unspent" });
              refreshed.push(`${n.handle}: ${sent ? "payment landed" : "confirmed"}`);
            } else if (await failed(n.createdTx)) {
              // Its creating transaction reverted, so the note never existed.
              notes.remove(n.handle);
              refreshed.push(`${n.handle}: removed, its transaction reverted`);
            }
          } catch (e) {
            refreshed.push(`${n.handle}: could not check (${errMsg(e)})`);
          }
        }
      }
      const all = notes.list().filter((n) => !network || n.network === network);
      return text({
        balances: balances(all),
        notes: all.filter((n) => includeSpent || n.status !== "spent").map(noteView),
        ...(refresh ? { refreshed } : {}),
        ...(legacy ? { warning: LEGACY_WARNING } : {}),
        secrets: "Kept encrypted inside this server. Pay with a handle; nobody needs the secret.",
      });
    }
  );

  async function ownReceiveKey(notes: NoteStore) {
    return notes.receiveKey() ?? notes.keepReceiveKey(await generateReceiveKey());
  }

  server.registerTool(
    "gloam_receive_tag",
    {
      title: "This server's receive tag",
      description:
        "The receive tag (gloamr1.…) others pay this server to. Payments sealed to it open only with the key this server keeps. Created on first use. Share it freely: it is a public key, not a secret.",
    },
    async () => {
      const opened = openStore();
      if (!opened.ok) return text({ status: "error", error: opened.error });
      try {
        const key = await ownReceiveKey(opened.store);
        return text({ tag: key.tag, use: "Put this in payTo (gloam_payment_requirements does it for you when payTo is left out)." });
      } catch (e) {
        return text({ status: "error", error: errMsg(e) });
      }
    }
  );

  // ── x402 private agent payments ─────────────────────────────────────────────

  server.registerTool(
    "gloam_payment_requirements",
    {
      title: "Price a resource in private payments (x402 and MPP)",
      description:
        "SERVER side. Build the HTTP 402 price an agent-paid resource returns, settled privately through Gloam: the amount and parties never go public. Returns it in both dialects: x402 requirements (and their encoded form), and an MPP challenge (mpp.wwwAuthenticate, the WWW-Authenticate: Payment value for method gloam, intent charge). payTo defaults to this server's own receive tag. Check what the payer presents with gloam_verify_payment.",
      inputSchema: {
        amount: z.number().positive().describe("Price in the asset's display units, e.g. 0.25."),
        decimals: z
          .number()
          .int()
          .min(0)
          .max(36)
          .optional()
          .describe("Decimals of the settlement asset; omit for the asset's own (6 for the stablecoins)."),
        assetSymbol: z.string().optional().describe("Asset label, e.g. USDC.e; omit for the asset's own symbol."),
        asset: z
          .string()
          .optional()
          .describe(
            "Settlement token address; omit for the network default (USDG on Robinhood Chain mainnet, USDC.e on Tempo mainnet, PathUSD on Tempo testnet, ETH on Robinhood Chain testnet)."
          ),
        payTo: z
          .string()
          .optional()
          .describe("Payee receive tag (gloamr1.…). Omit to be paid to this server's own tag, which gloam_verify_payment can open."),
        resource: z.string().describe("What is being paid for: a URL or an MCP tool id."),
        network: networkArg("Which Gloam network the payer settles on:"),
        realm: z
          .string()
          .optional()
          .describe("MPP protection space for the challenge. Default: the resource URL's host."),
        expiresInSeconds: z
          .number()
          .int()
          .min(60)
          .max(86_400)
          .default(MPP_DEFAULT_EXPIRES_SECONDS)
          .describe("How long the MPP challenge stays valid. Leave room to prove and confirm a payment."),
      },
    },
    async ({ amount, decimals, assetSymbol, asset, payTo, resource, network, realm, expiresInSeconds }) => {
      if (asset !== undefined && !isAddress(asset)) {
        return text({ status: "error", error: `"${asset}" is not a valid token address.` });
      }
      let tag = payTo?.trim();
      if (!tag) {
        const opened = openStore();
        if (!opened.ok) return text({ status: "error", error: `payTo was left out and this server's receive tag is unavailable: ${opened.error}` });
        try {
          tag = (await ownReceiveKey(opened.store)).tag;
        } catch (e) {
          return text({ status: "error", error: errMsg(e) });
        }
      }
      const net = networkByKey(network);
      const settleAsset = (asset as Address | undefined) ?? net.defaultAsset;
      const known = assetInfo(net.chainId, settleAsset, net.defaultAssetDecimals);
      try {
        const req = buildGloamPaymentRequirements({
          amountWei: parseUnits(String(amount), decimals ?? known.decimals),
          asset: settleAsset,
          assetSymbol: assetSymbol ?? known.symbol,
          payTo: tag,
          resource,
          network: net.chainId,
          poolAddress: net.pool,
        });
        // The same price as an MPP challenge. It needs this server's challenge key (MPP_SECRET_KEY, or the note store key).
        let mpp: Record<string, unknown>;
        try {
          const issued = await mppChallengeFor(req, { env, realm, decimals: decimals ?? known.decimals, expiresInSeconds });
          mpp = {
            wwwAuthenticate: issued.wwwAuthenticate,
            challengeId: issued.challenge.id,
            realm: issued.challenge.realm,
            expires: issued.challenge.expires,
            request: issued.challenge.request,
            httpHint:
              "Return HTTP 402 with the header WWW-Authenticate set to wwwAuthenticate and Cache-Control: no-store. The agent retries with Authorization: Payment <credential>; pass that value to gloam_verify_payment and serve only when it says grantAccess, with its paymentReceipt as the Payment-Receipt header.",
          };
        } catch (e) {
          mpp = { error: `No MPP challenge: ${errMsg(e)}` };
        }
        return text({
          network: describeNetwork(net),
          requirements: req,
          encoded: encodeRequirements(req),
          httpHint:
            "Return HTTP 402 with this requirements object; the agent retries with an X-PAYMENT header. Check it with gloam_verify_payment and serve only when it says grantAccess.",
          mpp,
          notVsZone: GLOAM_VS_ZONE.oneLine,
        });
      } catch (e) {
        return text({ status: "error", error: errMsg(e) });
      }
    }
  );

  server.registerTool(
    "gloam_pay_x402",
    {
      title: "Plan a private payment for a 402 challenge",
      description:
        "AGENT side. Given a Gloam 402 price (x402 requirements, or an MPP WWW-Authenticate: Payment challenge with method gloam), describe the private payment the agent would make: a self-custodial private send of the required amount to the payee, sealed to the payee's receive tag, broadcast by this server (no operator or facilitator holds its key). Plans only; to pay, call gloam_execute_private_pay, or gloam_fetch_paid to do the whole request.",
      inputSchema: {
        requirements: z
          .string()
          .describe("Encoded requirements from gloam_payment_requirements (or the raw JSON), or an MPP challenge (the WWW-Authenticate value)."),
        note: z.string().optional().describe("Handle of the note to pay from (gloam_list_notes), if you want a specific one."),
      },
    },
    async ({ requirements, note }) => {
      const priced = parsePriced(requirements);
      if ("error" in priced) return text({ status: "error", error: priced.error });
      const { req, mpp } = priced;
      const netForReq = networkByChainId(Number(req.network));
      const tagOk = isReceiveTag(String(req.payTo ?? ""));
      return text({
        status: "plan",
        intent: "private_pay_x402",
        protocol: mpp ? "mpp" : "x402",
        ...(mpp ? { mpp: { method: mpp.method, intent: mpp.intent, realm: mpp.realm, expires: mpp.expires ?? null, payable: cannotPay(mpp, parseGloamChargeRequest(mpp.request)) ?? "yes" } } : {}),
        network: req.network,
        pay: {
          amountWei: req.maxAmountRequired,
          asset: req.asset,
          assetSymbol: req.assetSymbol,
          payTo: req.payTo,
          pool: req.poolAddress,
        },
        payTo: tagOk
          ? "A receive tag: the payment note will be sealed so only the payee can open it."
          : legacy
            ? "Not a receive tag. With GLOAM_EXPOSE_NOTE_SECRETS=1 the note would go in the header unsealed, readable by anyone who sees it."
            : "Not a receive tag, so this payment would be refused. Ask the payee for its gloamr1. tag.",
        poolStatus: netForReq
          ? `Live: pool ${netForReq.pool} on ${describeNetwork(netForReq)}, chain ${netForReq.chainId}.${
              String(req.poolAddress).toLowerCase() === netForReq.pool.toLowerCase() ? "" : ` These requirements name ${req.poolAddress} instead, so this server will refuse to pay.`
            }`
          : `Chain ${req.network} is not a network this server can pay on.`,
        execute: mpp
          ? "gloam_execute_private_pay({ requirements, note? }) pays and returns the Authorization: Payment credential; gloam_fetch_paid({ url }) also makes the request and the retry."
          : "gloam_execute_private_pay({ requirements, note? }) pays and returns the X-PAYMENT header; gloam_fetch_paid({ url }) also makes the request and the retry.",
        settlement:
          "Self-custodial: this server signs and broadcasts the shielded transfer. Only the payee can open the payment note; the public sees only that a shielded transfer occurred.",
        notVsZone: GLOAM_VS_ZONE,
        sourceNote: note ?? "the smallest note that covers the amount",
      });
    }
  );

  type PayResult =
    | { ok: false; result: Record<string, unknown> }
    | {
        ok: true;
        result: Record<string, unknown>;
        /** The x402 X-PAYMENT header. */
        header: string;
        /** For an MPP challenge: the `Payment …` credential, to send in credentialField(challenge). */
        authorization?: string;
      };

  /**
   * Pay a 402 privately: pick or take a note by handle, pass the spend gate,
   * prove, broadcast, and keep the change. Secrets stay in this function and the
   * note store; the result carries handles and the sealed X-PAYMENT header, plus
   * the MPP credential when `mpp` is the challenge being paid (push mode: this
   * server broadcasts, so limits and the note store work exactly as for x402).
   */
  async function payPrivately(
    req: GloamPaymentRequirements,
    opts: {
      handle?: string;
      issuerTag?: string;
      legacyNote?: { secret: string; amount: number; decimals?: number };
      mpp?: PaymentChallenge;
    }
  ): Promise<PayResult> {
    const fail = (result: Record<string, unknown>): PayResult => ({ ok: false, result });
    if (req.scheme !== GLOAM_X402_SCHEME) return fail({ status: "error", error: `Not a Gloam private payment (scheme "${req.scheme}").` });
    // The requirements name the network to settle on; use it for the signer,
    // tree scan, keys and explorer. A chain this build has no pool for is refused.
    const net = networkByChainId(Number(req.network));
    if (!net) {
      return fail({
        status: "refused",
        code: "unknown_network",
        message: `This price settles on chain ${req.network}, which this server has no Gloam pool for. It pays on: ${NETWORK_KEYS.join(", ")}.`,
      });
    }
    let spend: Spend & { pool?: Address };
    try {
      spend = {
        tool: "pay",
        network: net.key,
        chainId: net.chainId,
        asset: ((req.asset as Address | undefined) ?? NATIVE_ASSET) as Address,
        amountWei: BigInt(String(req.maxAmountRequired)),
        recipient: String(req.payTo ?? ""),
        pool: req.poolAddress as Address,
      };
    } catch {
      return fail({ status: "error", error: "The requirements carry an amount that is not a whole number of base units." });
    }
    const sealed = isReceiveTag(String(req.payTo ?? ""));
    if (!sealed && !legacy) {
      return fail({
        status: "refused",
        code: "payto_not_receive_tag",
        message: `payTo "${shortTag(String(req.payTo ?? ""))}" is not a Gloam receive tag (gloamr1.…). The payment note must be sealed to the payee so only the payee can open it. Ask the payee for its receive tag.`,
      });
    }
    const signer = deps.signer(net);
    if (!signer) {
      return fail({
        status: "no_signer",
        plan: { action: "private_pay_x402", network: net.key, pay: req.maxAmountRequired, asset: req.asset, payTo: req.payTo, pool: req.poolAddress },
        limits: previewSpend(spend, env),
        message: NO_SIGNER,
        notVsZone: GLOAM_VS_ZONE.oneLine,
      });
    }
    const opened = openStore();
    if (!opened.ok) return fail({ status: "error", error: opened.error });
    const notes = opened.store;
    const { symbol, decimals } = assetInfo(net.chainId, spend.asset);
    const fits = (n: StoredNote): string | null => {
      if (n.chainId !== net.chainId || n.pool.toLowerCase() !== String(req.poolAddress).toLowerCase()) {
        return `Note ${n.handle} is on ${n.network}, in a different pool than this payment.`;
      }
      if (n.asset.toLowerCase() !== spend.asset.toLowerCase()) return `Note ${n.handle} holds ${n.symbol}, not ${symbol}.`;
      if (BigInt(n.amountWei) < spend.amountWei) {
        return `Note ${n.handle} holds ${formatUnits(BigInt(n.amountWei), n.decimals)} ${n.symbol}, less than the ${formatUnits(spend.amountWei, decimals)} asked.`;
      }
      return null;
    };

    // Which note pays: a legacy secret, a handle, or the smallest that covers it.
    let input: { secret: Hex; amountWei: bigint; handle: string | null };
    if (opts.legacyNote) {
      const dec = opts.legacyNote.decimals ?? net.defaultAssetDecimals;
      input = { secret: opts.legacyNote.secret as Hex, amountWei: parseUnits(String(opts.legacyNote.amount), dec), handle: null };
    } else {
      let chosen: StoredNote | undefined;
      if (opts.handle) {
        chosen = notes.get(opts.handle);
        if (!chosen) return fail({ status: "error", error: `There is no note "${opts.handle}". Call gloam_list_notes.` });
        if (chosen.status !== "unspent") return fail({ status: "error", error: `Note ${chosen.handle} is ${chosen.status}, not spendable.` });
        const why = fits(chosen);
        if (why) return fail({ status: "error", error: why });
      } else {
        chosen = notes
          .list()
          .filter((n) => n.status === "unspent" && fits(n) === null)
          .sort((a, b) => (BigInt(a.amountWei) < BigInt(b.amountWei) ? -1 : 1))[0];
        if (!chosen) {
          return fail({
            status: "error",
            error: `No single private note on ${net.name} holds ${formatUnits(spend.amountWei, decimals)} ${symbol}. Shield more first (gloam_execute_shield). A payment spends one note; notes are not combined.`,
            balances: balances(notes.list().filter((n) => n.chainId === net.chainId)),
          });
        }
      }
      input = { secret: chosen.secret, amountWei: BigInt(chosen.amountWei), handle: chosen.handle };
    }

    const gate = authorizeSpend(spend, env);
    if (!gate.ok) return fail(gate.refusal);
    if (input.handle) {
      try {
        notes.reserveForSpend(input.handle, fits);
      } catch (e) {
        settleSpend(gate, "failed", { reason: errMsg(e) });
        return fail({ status: "error", error: errMsg(e) });
      }
    }
    const release = () => input.handle && tryStore(() => notes.update(input.handle!, { status: "unspent" }));

    let hash: Hex | undefined;
    let change: StoredNote | undefined;
    let sent: StoredNote | undefined;
    let sending = false;
    let viaRelay = false;
    let header: string | undefined;
    try {
      const asset = spend.asset;
      const commitment = fieldToHex(await noteCommitmentPoseidon(hexToField(input.secret), input.amountWei, asset));
      const synced = await deps.syncTree(signer.publicClient, { pool: req.poolAddress as Address, fromBlock: net.deployBlock });
      const path = await synced.pathForCommitment(commitment);
      if (!path) {
        settleSpend(gate, "failed", { reason: "note not in the pool tree" });
        release();
        return fail({ status: "error", error: "That note is not in the pool tree yet. Shield it first, or wait for the deposit to confirm." });
      }
      const payment = await buildGloamPayment({
        requirements: req,
        senderSecretHex: input.secret,
        senderNoteAmountWei: input.amountWei,
        path,
        prove: await deps.transferProver(net),
        issuerTag: opts.issuerTag,
        legacyUnsealed: legacy && !sealed,
      });
      if (BigInt(payment.changeNote.amountWei) > 0n) {
        change = notes.add({
          network: net.key,
          chainId: net.chainId,
          pool: req.poolAddress as Address,
          asset,
          symbol,
          decimals,
          amountWei: payment.changeNote.amountWei,
          secret: payment.changeNote.secret,
          commitment: payment.changeNote.commitment,
          nullifier: payment.changeNote.nullifier,
          status: "pending",
          pending: "create",
          origin: "change",
          createdTx: null,
          label: `change from paying ${req.resource}`,
        });
      }
      // The payment note is the payee's money once it lands, and only this server
      // can hand it over: keep it from before the send, so a payment that lands
      // with no answer is never lost.
      sent = notes.add({
        network: net.key,
        chainId: net.chainId,
        pool: req.poolAddress as Address,
        asset,
        symbol,
        decimals,
        amountWei: payment.paymentNote.amountWei,
        secret: payment.paymentNote.secret,
        commitment: payment.paymentNote.commitment,
        nullifier: payment.paymentNote.nullifier,
        status: "pending",
        pending: "create",
        origin: "payment",
        createdTx: null,
        label: `payment for ${req.resource}`,
      });
      // The sealed payment, to present if the send has an unclear outcome (no tx hash yet).
      header = encodePaymentHeader(payment.payload);
      // With the Gloam relay the agent's wallet never appears next to the
      // payment (GLOAM_USE_RELAY=1, or GLOAM_RELAY_URL for a self-hosted relay).
      const relay = relayUrl();
      viaRelay = Boolean(relay);
      sending = true;
      hash = relay
        ? await deps.relay(payment.intent, { url: relay })
        : await signer.walletClient.writeContract({
            address: payment.intent.exec.poolAddress,
            abi: POOL_TRANSFER_ABI,
            functionName: "transfer",
            args: transferCallArgs(payment.intent),
          });
      const sentHash = hash;
      const storeWarnings = [
        input.handle ? tryStore(() => notes.update(input.handle!, { spentTx: sentHash })) : undefined,
        change ? tryStore(() => notes.update(change!.handle, { createdTx: sentHash })) : undefined,
        tryStore(() => notes.update(sent!.handle, { createdTx: sentHash })),
      ].filter(Boolean);
      const receipt = await signer.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        settleSpend(gate, "reverted", { hash });
        // A revert usually means nothing moved, unless the note was already spent elsewhere.
        const nullifier = fieldToHex(await noteNullifierPoseidon(hexToField(input.secret), hexToField(commitment)));
        const spentElsewhere = await sweepChain(signer.publicClient, net).isSpent(nullifier).catch(() => false);
        if (spentElsewhere) {
          // Possibly by an earlier copy of this same transfer (a resend), whose change and
          // payment notes landed: keep them pending, gloam_list_notes refresh settles them.
          if (input.handle) tryStore(() => notes.update(input.handle!, { status: "spent", spentTx: null }));
        } else {
          if (change) tryStore(() => notes.remove(change!.handle));
          tryStore(() => notes.remove(sent!.handle));
          release();
        }
        return fail({
          status: "error",
          error: spentElsewhere
            ? `Transfer reverted (${hash}): that note was already spent by another transaction, which may be an earlier copy of this payment.`
            : `Transfer reverted (${hash}). Nothing moved; the note is spendable again.`,
          ...(spentElsewhere
            ? {
                check: "Call gloam_list_notes with refresh. If the change or the payment confirms, this payment went through: retry the request with paymentHeader and do not pay again.",
                paymentHeader: header,
              }
            : {}),
        });
      }
      const logWarning = settleSpend(gate, "sent", { hash });
      if (input.handle) storeWarnings.push(tryStore(() => notes.update(input.handle!, { status: "spent", spentTx: sentHash })));
      let changeView = change ? noteView({ ...change, status: "unspent", createdTx: hash }) : null;
      if (change) {
        storeWarnings.push(
          tryStore(() => {
            const c = notes.update(change!.handle, { status: "unspent", createdTx: sentHash });
            if (c) changeView = noteView(c);
          })
        );
      }
      if (sent) storeWarnings.push(tryStore(() => notes.update(sent!.handle, { status: "spent", createdTx: sentHash })));
      payment.payload.payload.txHash = hash;
      header = encodePaymentHeader(payment.payload);
      // The MPP credential: the same sealed note plus a binding to this one challenge. Never throws past here:
      // the money already moved, so a failure must not be reported as a failed payment.
      let authorization: string | undefined;
      let mppWarning: string | undefined;
      if (opts.mpp) {
        try {
          authorization = (await credentialFromPayment({ challenge: opts.mpp, payment, mode: "push", hash })).authorization;
        } catch (e) {
          mppWarning = `Paid, but the MPP credential could not be built (${errMsg(e)}). The x402 header still carries the payment.`;
        }
      }
      const noteWarning = storeWarnings.filter(Boolean).join(" ") || undefined;
      return {
        ok: true,
        header,
        ...(authorization ? { authorization } : {}),
        result: {
          status: "paid",
          ...(opts.mpp ? { protocol: "mpp" } : {}),
          ...(mppWarning ? { mppWarning } : {}),
          ...(logWarning ? { logWarning } : {}),
          ...(noteWarning ? { noteWarning } : {}),
          network: net.key,
          ...(net.testnet ? {} : { realMoney: true }),
          submittedBy: relay ? "gloam-relay (agent wallet hidden)" : "agent wallet",
          hash,
          explorer: `${net.explorer}/tx/${hash}`,
          paid: { amount: formatUnits(spend.amountWei, decimals), symbol, payTo: shortTag(String(req.payTo)), resource: req.resource },
          sealedToPayee: payment.sealed,
          spentNote: input.handle,
          change: changeView,
          ...(legacy
            ? {
                warning: LEGACY_WARNING,
                paymentNote: { secret: payment.paymentNote.secret, commitment: payment.paymentNote.commitment, amountWei: payment.paymentNote.amountWei },
                persistChangeNote: { secret: payment.changeNote.secret, amountWei: payment.changeNote.amountWei },
              }
            : {}),
          privacy: "The public feed shows a shielded transfer, never the amount or the parties. Only the payee can open the payment note.",
          notVsZone: GLOAM_VS_ZONE.oneLine,
        },
      };
    } catch (err) {
      const error = errMsg(err);
      // A send that threw may still have landed (a relay timeout after the node took it):
      // only a send surely never made frees the note and forgets its outputs.
      const maybeSent = Boolean(hash) || (sending && mayHaveSent(err, viaRelay));
      // Broadcast but unconfirmed still counts against the limit, to be safe.
      settleSpend(gate, maybeSent ? "unconfirmed" : "failed", { hash, reason: error });
      if (!maybeSent) {
        release();
        if (change) tryStore(() => notes.remove(change!.handle));
        if (sent) tryStore(() => notes.remove(sent!.handle));
      }
      return fail({
        status: "error",
        error,
        ...(maybeSent
          ? {
              ...(hash ? { hash } : {}),
              check: "It may have been sent and may still land. Call gloam_list_notes with refresh before paying again: if the payment lands, retry the request with paymentHeader instead of paying again.",
              ...(header ? { paymentHeader: header } : {}),
            }
          : {}),
      });
    }
  }

  const PAY_SHAPE = {
    requirements: z
      .string()
      .describe("Encoded requirements from gloam_payment_requirements (or raw JSON), or an MPP challenge (the WWW-Authenticate: Payment value)."),
    note: z
      .string()
      .optional()
      .describe("Handle of the note to pay from (gloam_list_notes). Omit to use the smallest note that covers the amount."),
    issuerTag: z.string().optional().describe("Optional issuer tag to attach a compliance disclosure."),
    noteSecret: z.string().optional().describe("LEGACY, UNSAFE: the 0x secret of a note held outside this server."),
    noteAmount: z.number().positive().optional().describe("LEGACY: the full amount of that note in the asset's units."),
    decimals: z.number().int().optional().describe("LEGACY: decimals of that note's asset; omit for the network default."),
  };
  const SAFE_PAY_SHAPE = { requirements: PAY_SHAPE.requirements, note: PAY_SHAPE.note, issuerTag: PAY_SHAPE.issuerTag };

  server.registerTool(
    "gloam_execute_private_pay",
    {
      title: "Execute a private payment (x402 or MPP)",
      description:
        "AGENT side, REAL execution. Settle a 402 price privately from a note this server holds: syncs the pool tree, builds the private send to the payee, seals the payment note to the payee's receive tag, generates the Groth16 transfer proof, and broadcasts transfer(). Self-custodial (this server's key signs; no operator holds funds). Returns the X-PAYMENT header for x402 requirements, or for an MPP challenge (method gloam) the Authorization: Payment credential, and the change as a note handle. payTo must be a receive tag. Requires GLOAM_AGENT_PRIVATE_KEY; without it, returns a plan.",
      // The legacy secret fields are only offered when GLOAM_EXPOSE_NOTE_SECRETS=1.
      inputSchema: (legacy ? PAY_SHAPE : SAFE_PAY_SHAPE) as typeof PAY_SHAPE,
    },
    async ({ requirements, note, issuerTag, noteSecret, noteAmount, decimals }) => {
      const priced = parsePriced(requirements);
      if ("error" in priced) return text({ status: "error", error: priced.error });
      const { req, mpp } = priced;
      if (mpp) {
        const why = cannotPay(mpp, parseGloamChargeRequest(mpp.request));
        if (why) return text({ status: "refused", code: "mpp_unpayable", message: why });
      }
      if (legacy && noteSecret && noteAmount === undefined) {
        return text({ status: "error", error: "noteSecret needs noteAmount (the note's full value)." });
      }
      const paid = await payPrivately(req, {
        handle: note,
        issuerTag,
        legacyNote: legacy && noteSecret && noteAmount !== undefined ? { secret: noteSecret, amount: noteAmount, decimals } : undefined,
        mpp: mpp ?? undefined,
      });
      if (!paid.ok) return text(paid.result);
      if (mpp && paid.authorization) {
        const field = credentialField(mpp);
        return text({
          ...paid.result,
          authorization: paid.authorization,
          authorizationField: field,
          next: `Retry the request with the header ${field} set to authorization. The payee sweeps the payment before serving and answers with a Payment-Receipt.`,
        });
      }
      return text({
        ...paid.result,
        paymentHeader: paid.header,
        next: "Retry the request with the header X-PAYMENT set to paymentHeader. The payee sweeps the payment before serving.",
      });
    }
  );

  /** Pull Gloam requirements out of a 402 response: a header, the body, or an x402 `accepts` list. */
  function requirementsFrom402(headers: Headers, body: string): GloamPaymentRequirements | string {
    for (const name of ["x-payment-required", "payment-required"]) {
      const h = headers.get(name);
      if (h?.trim().startsWith("gloamx402req1:")) return decodeRequirements(h.trim());
    }
    const t = body.trim();
    if (t.startsWith("gloamx402req1:")) return decodeRequirements(t);
    let json: unknown;
    try {
      json = JSON.parse(t);
    } catch {
      return "The 402 response carries no Gloam payment requirements.";
    }
    const o = json as Record<string, unknown>;
    const candidates: unknown[] = [o, o.requirements, ...(Array.isArray(o.accepts) ? o.accepts : [])];
    if (typeof o.encoded === "string" && o.encoded.startsWith("gloamx402req1:")) return decodeRequirements(o.encoded);
    for (const c of candidates) {
      if (c && typeof c === "object" && (c as GloamPaymentRequirements).scheme === GLOAM_X402_SCHEME) return c as GloamPaymentRequirements;
    }
    const offered = Array.isArray(o.accepts) ? o.accepts.map((a) => (a as { scheme?: string })?.scheme).filter(Boolean) : [];
    return `The 402 response does not offer a Gloam private payment${offered.length ? ` (it offers: ${offered.join(", ")})` : ""}.`;
  }

  const BODY_LIMIT = 20_000;
  async function readBody(res: Response) {
    const raw = await res.text();
    return {
      httpStatus: res.status,
      contentType: res.headers.get("content-type"),
      body: raw.length > BODY_LIMIT ? `${raw.slice(0, BODY_LIMIT)}… (${raw.length - BODY_LIMIT} more characters)` : raw,
    };
  }

  /** A Payment-Receipt header, decoded, or null. */
  function receiptFrom(res: Response): Record<string, unknown> | null {
    const h = res.headers.get("payment-receipt");
    if (!h) return null;
    try {
      return parseReceipt(h);
    } catch {
      return { raw: h.slice(0, 500), error: "The Payment-Receipt header does not decode." };
    }
  }

  /** The headers that present a payment: an MPP credential in the field its challenge selected, x402 in X-PAYMENT. */
  function presentHeaders(payment: string): Record<string, string> {
    if (looksLikeMpp(payment)) {
      let field = "Authorization";
      try {
        field = credentialField(parseMppCredential(payment).challenge);
      } catch {
        // Not parseable here; the server will say so.
      }
      return { [field.toLowerCase()]: payment.trim() };
    }
    return { "x-payment": payment };
  }

  server.registerTool(
    "gloam_fetch_paid",
    {
      title: "Fetch a paid resource (x402 or MPP, paid privately)",
      description:
        "AGENT side, REAL execution. Request a URL; if it answers 402 with a Gloam private price, pay it privately from this server's notes (same limits as gloam_execute_private_pay), retry, and return the response. Understands both dialects: an MPP challenge (WWW-Authenticate: Payment with method gloam, answered with Authorization: Payment) is preferred when offered, else x402 (X-PAYMENT). The agent never handles a note secret or the payment header unless a retry is needed. Requires GLOAM_AGENT_PRIVATE_KEY to pay.",
      inputSchema: {
        url: z.string().url().describe("http(s) URL of the resource."),
        method: z.enum(["GET", "POST"]).default("GET"),
        body: z.string().optional().describe("Request body for POST."),
        contentType: z.string().optional().describe("Content-Type for the body (default application/json)."),
        note: z.string().optional().describe("Handle of the note to pay from; omit to use the smallest that covers the price."),
        maxAmount: z.number().positive().optional().describe("Refuse if the 402 asks for more than this, in the asset's units."),
        paymentHeader: z
          .string()
          .optional()
          .describe("Present a payment already made (paymentHeader from an earlier result: an X-PAYMENT value or an MPP Payment credential) instead of paying again."),
      },
    },
    async ({ url, method, body, contentType, note, maxAmount, paymentHeader }) => {
      if (!/^https?:\/\//i.test(url)) return text({ status: "error", error: "Only http and https URLs." });
      const request = (payHeaders: Record<string, string> = {}) =>
        deps.fetch(url, {
          method,
          headers: {
            ...(body !== undefined ? { "content-type": contentType ?? "application/json" } : {}),
            ...payHeaders,
          },
          body: method === "POST" ? body : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      let first: Response;
      try {
        first = await request(paymentHeader ? presentHeaders(paymentHeader) : {});
      } catch (e) {
        return text({ status: "error", error: `Request failed: ${errMsg(e)}` });
      }
      if (first.status !== 402) {
        const receipt = paymentHeader ? receiptFrom(first) : null;
        return text({ status: first.ok ? "ok" : "http_error", paid: false, ...(await readBody(first)), ...(receipt ? { paymentReceipt: receipt } : {}) });
      }
      const firstBody = await first.text();
      if (paymentHeader) {
        return text({
          status: "payment_not_accepted",
          message: "The server still asks for payment. It may not have seen the transfer yet; wait a little and retry with the same paymentHeader. Do not pay again until you know it failed.",
          httpStatus: 402,
          body: firstBody.slice(0, BODY_LIMIT),
        });
      }

      // MPP first: a gloam/charge challenge in WWW-Authenticate. Otherwise x402.
      let req: GloamPaymentRequirements | string;
      const mpp = gloamChallenges(first.headers.get("www-authenticate"))[0] ?? null;
      if (mpp) {
        let request: GloamChargeRequest;
        try {
          ({ req, request } = requirementsFromChallenge(mpp));
        } catch (e) {
          return text({ status: "error", httpStatus: 402, error: `The server's gloam challenge is not valid: ${errMsg(e)}` });
        }
        const why = cannotPay(mpp, request);
        if (why) return text({ status: "refused", code: "mpp_unpayable", httpStatus: 402, message: why });
      } else {
        try {
          req = requirementsFrom402(first.headers, firstBody);
        } catch {
          req = "The 402 response carries Gloam requirements that do not decode.";
        }
        if (typeof req === "string") return text({ status: "error", httpStatus: 402, error: req, body: firstBody.slice(0, 2000) });
      }
      if (maxAmount !== undefined) {
        const { symbol, decimals } = assetInfo(Number(req.network), req.asset);
        let asked: bigint;
        try {
          asked = BigInt(String(req.maxAmountRequired));
        } catch {
          return text({ status: "error", error: "The 402 asks for an amount that is not a whole number of base units." });
        }
        if (asked > parseUnits(String(maxAmount), decimals)) {
          return text({
            status: "refused",
            code: "over_max_amount",
            message: `The resource asks ${formatUnits(asked, decimals)} ${symbol}, more than your maxAmount of ${maxAmount}. Not paying.`,
          });
        }
      }
      const paid = await payPrivately(req, { handle: note, ...(mpp ? { mpp } : {}) });
      if (!paid.ok) return text({ ...paid.result, httpStatus: 402, resource: req.resource });
      // What to present: the MPP credential when paying an MPP challenge, else the x402 header.
      const presented = mpp ? paid.authorization : paid.header;
      const retryHeaders: Record<string, string> = mpp
        ? paid.authorization
          ? { [credentialField(mpp).toLowerCase()]: paid.authorization }
          : {}
        : { "x-payment": paid.header };
      if (!presented) {
        return text({
          ...paid.result,
          status: "paid_not_served",
          message: "Paid, but the MPP credential could not be built, so the request was not retried. The payment is not lost: the payee can still open it.",
          paymentHeader: paid.header,
        });
      }
      let second: Response;
      try {
        second = await request(retryHeaders);
      } catch (e) {
        return text({
          ...paid.result,
          status: "paid_not_served",
          message: `Paid, but the retry failed (${errMsg(e)}). Call gloam_fetch_paid again with paymentHeader to present this payment without paying twice.`,
          paymentHeader: presented,
        });
      }
      const served = await readBody(second);
      if (!second.ok) {
        return text({
          ...paid.result,
          status: "paid_not_served",
          message: "Paid, but the server did not serve the resource yet (it may still be confirming the payment). Retry with paymentHeader; do not pay again.",
          paymentHeader: presented,
          ...served,
        });
      }
      const receipt = mpp ? receiptFrom(second) : null;
      return text({
        ...paid.result,
        status: "ok",
        ...served,
        ...(mpp ? { paymentReceipt: receipt } : { paymentResponse: second.headers.get("x-payment-response") }),
      });
    }
  );

  type Reject = (message: string, extra?: Record<string, unknown>) => ReturnType<typeof text>;

  /**
   * The settle tail both dialects share, once a received note has passed its
   * checks: refuse a payment this server already swept, then (pull) submit the
   * payer's transfer, then sweep the note into a fresh one, storing it before the
   * sweep is sent, and grant access only when the sweep confirms.
   */
  async function settleReceived(args: {
    net: McpNetwork;
    notes: NoteStore;
    note: NoteExport;
    paymentNullifier: Hex;
    label: string;
    sealed: boolean;
    verifyView: Record<string, unknown>;
    /** MPP pull mode: the payer's transfer, not yet in the pool, that this server submits first. */
    pull?: ValidatedGloamCharge["transfer"];
    /** MPP: what the receipt names. */
    mpp?: { challengeId: string; externalId?: string };
  }) {
    const { net, notes, note, paymentNullifier, sealed, verifyView } = args;
    // Only canonical fields count: the hash reads them mod p, so amount + p opens the same note.
    const notCanonical = noteFieldProblem(note);
    if (notCanonical || BigInt(note.amountWei) <= 0n) {
      return text({ status: "rejected", grantAccess: false, final: false, message: `The payment note is not a real payment: ${notCanonical ?? "it carries no value."}` });
    }
    const earlier = notes.list().find((n) => n.sweptFrom?.toLowerCase() === paymentNullifier.toLowerCase());
    if (earlier) {
      return text({
        status: "already_settled",
        grantAccess: false,
        final: false,
        message: `This payment was already settled by this server (${earlier.handle}). Do not serve it twice.`,
      });
    }

    const signer = deps.signer(net);
    const relay = relayUrl();
    const { symbol, decimals } = assetInfo(net.chainId, note.asset);
    if (!signer && !relay) {
      return text({
        status: "verified_not_final",
        grantAccess: false,
        final: false,
        finality: GLOAM_NOT_FINAL,
        message: "The payment checks out but this server cannot sweep it: set GLOAM_AGENT_PRIVATE_KEY, or GLOAM_USE_RELAY=1 to sweep through the Gloam relay. Until it is swept, do not grant access.",
        verify: verifyView,
      });
    }
    const client = signer?.publicClient ?? deps.publicClient(net);
    const submit = (intent: GloamIntent) =>
      relay
        ? deps.relay(intent, { url: relay })
        : signer!.walletClient.writeContract({
            address: net.pool,
            abi: POOL_TRANSFER_ABI,
            functionName: "transfer",
            args: transferCallArgs(intent as Parameters<typeof transferCallArgs>[0]),
          });

    // MPP pull: the payer handed over its proven transfer; it has to land before the note can be swept.
    let paymentHash: Hex | null = null;
    if (args.pull) {
      let landed = false;
      try {
        paymentHash = await submit(payerTransferIntent(net.chainId, net.pool, args.pull));
        landed = (await client.waitForTransactionReceipt({ hash: paymentHash })).status === "success";
      } catch {
        landed = false;
      }
      if (!landed) landed = await sweepChain(client, net).isCommitmentSeen(note.commitment).catch(() => false);
      if (!landed) {
        return text({
          status: "rejected",
          grantAccess: false,
          final: false,
          message: "The payer's transfer did not go through (its note may have been spent elsewhere). Nothing was paid.",
          ...(paymentHash ? { hash: paymentHash } : {}),
        });
      }
    }

    let held: StoredNote | undefined;
    // Set when the sweep's send threw in a way that does not prove it stayed unsent.
    let sweepMaybeSent = false;
    try {
      const sweep = await sweepReceivedNote({
        note,
        poolAddress: net.pool,
        chainId: net.chainId,
        prove: await deps.transferProver(net),
        chain: sweepChain(client, net),
        submit: (intent) =>
          submit(intent).catch((e: unknown) => {
            sweepMaybeSent = mayHaveSent(e, Boolean(relay));
            throw e;
          }),
        // The fresh note's secret is the money: store it before the sweep is sent.
        beforeSubmit: (fresh) => {
          held = notes.add({
            network: net.key,
            chainId: net.chainId,
            pool: net.pool,
            asset: fresh.asset,
            symbol,
            decimals,
            amountWei: fresh.amountWei,
            secret: fresh.secret,
            commitment: fresh.commitment,
            nullifier: fresh.nullifier,
            status: "pending",
            pending: "create",
            origin: "received",
            createdTx: null,
            sweptFrom: paymentNullifier,
            label: args.label,
          });
        },
      });
      if (sweep.status === "swept") {
        let received = held ? noteView({ ...held, status: "unspent", createdTx: sweep.hash }) : null;
        const noteWarning = held
          ? tryStore(() => {
              const r = notes.update(held!.handle, { status: "unspent", createdTx: sweep.hash });
              if (r) received = noteView(r);
            })
          : undefined;
        let mppReceipt: Record<string, unknown> = {};
        if (args.mpp && sweep.hash) {
          const receipt: GloamChargeReceipt = {
            status: "success",
            method: "gloam",
            timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
            reference: sweep.hash,
            challengeId: args.mpp.challengeId,
            chainId: net.chainId,
            ...(args.mpp.externalId !== undefined ? { externalId: args.mpp.externalId } : {}),
          };
          mppReceipt = {
            receipt,
            paymentReceipt: serializeReceipt(receipt),
            httpHint: "Serve the resource with the header Payment-Receipt set to paymentReceipt and Cache-Control: private.",
          };
        }
        return text({
          status: "settled",
          grantAccess: true,
          final: true,
          ...(noteWarning ? { noteWarning } : {}),
          message: "Paid and final: the payment now sits in a note only this server knows. Serve the resource.",
          received,
          amount: formatUnits(BigInt(note.amountWei), decimals),
          symbol,
          sealed,
          sweptBy: relay ? "gloam-relay" : "server wallet",
          hash: sweep.hash,
          explorer: sweep.hash ? `${net.explorer}/tx/${sweep.hash}` : null,
          ...(paymentHash ? { paymentSubmittedBy: relay ? "gloam-relay" : "server wallet", paymentHash } : {}),
          ...mppReceipt,
        });
      }
      if (sweep.status === "unconfirmed") {
        if (held && sweep.hash) tryStore(() => notes.update(held!.handle, { createdTx: sweep.hash }));
        return text({
          status: "unconfirmed",
          grantAccess: false,
          final: false,
          message: `${sweep.reason} Check with gloam_list_notes (refresh), then verify again.`,
          hash: sweep.hash,
        });
      }
      if (sweep.status === "failed" && sweepMaybeSent) {
        // The relay may have taken the sweep before its error, and the fresh note is the money if it lands: keep it pending.
        return text({
          status: "unconfirmed",
          grantAccess: false,
          final: false,
          message: "The sweep may have been sent and may still land. Check with gloam_list_notes (refresh), then verify again.",
        });
      }
      if (held) tryStore(() => notes.remove(held!.handle));
      return text({
        status: sweep.status,
        grantAccess: false,
        final: false,
        message: sweep.reason,
        ...(sweep.hash ? { hash: sweep.hash } : {}),
      });
    } catch (e) {
      if (held) tryStore(() => notes.remove(held!.handle));
      return text({ status: "error", grantAccess: false, final: false, error: errMsg(e) });
    }
  }

  /** gloam_verify_payment for an MPP credential (`Payment …`, method gloam, intent charge). */
  async function verifyMpp(payment: string, requirements: string | undefined, reject: Reject) {
    let cred;
    try {
      cred = parseMppCredential(payment);
    } catch (e) {
      return reject(`The credential does not parse: ${errMsg(e)}`, { problem: "malformed-credential" });
    }
    const ch = cred.challenge;
    if (ch.method !== "gloam" || ch.intent !== "charge") {
      return reject(`This server settles gloam/charge, not ${ch.method}/${ch.intent}.`, { problem: "invalid-challenge" });
    }
    let secret: Uint8Array;
    try {
      secret = mppSecret(env);
    } catch (e) {
      return text({ status: "error", grantAccess: false, final: false, error: errMsg(e) });
    }
    if (!(await verifyChallengeId(ch, secret))) {
      return reject("The challenge in this credential was not issued by this server, or was changed.", { problem: "invalid-challenge" });
    }
    if (isExpired(ch)) return reject("The challenge has expired.", { problem: "payment-expired" });
    let request: GloamChargeRequest;
    try {
      request = parseGloamChargeRequest(ch.request);
    } catch (e) {
      return reject(errMsg(e), { problem: "invalid-challenge" });
    }
    // Optionally bind to the price of the resource being served (the challenge alone proves only that this server issued it).
    if (requirements?.trim()) {
      const priced = parsePriced(requirements);
      if ("error" in priced) return text({ status: "error", error: priced.error });
      const expected = priced.mpp ? parseGloamChargeRequest(priced.mpp.request) : fromPaymentRequirements(priced.req);
      const mismatch = termsMismatch(expected, request);
      if (mismatch) return reject(`The credential was issued for a different ${mismatch} than these requirements.`, { problem: "invalid-challenge" });
    }
    const md = request.methodDetails;
    const net = networkByChainId(md.chainId);
    if (!net || md.pool.toLowerCase() !== net.pool.toLowerCase()) {
      return reject(`This challenge names pool ${md.pool} on chain ${md.chainId}, which is not a Gloam pool. Not settling there.`);
    }
    const opened = openStore();
    if (!opened.ok) return text({ status: "error", grantAccess: false, error: opened.error });
    const notes = opened.store;
    const receiveKey = notes.receiveKey();
    if (!receiveKey) return reject("This server has no receive tag yet, so a sealed payment cannot be for it.");
    if (request.recipient.trim() !== receiveKey.tag) {
      return reject("The charge pays a receive tag that is not this server's, so this server cannot open the payment.");
    }
    // A challenge settles one payment: another payment for a challenge already used is refused before it is swept.
    const challengeTag = `(mpp ${ch.id})`;
    // Swept by this server already? Ask before the chain checks, which would only see a spent note.
    try {
      const early = await openGloamPaymentNote(parseGloamChargePayload(cred.payload).ticket, receiveKey);
      const nf = fieldToHex(await noteNullifierPoseidon(hexToField(early.secret), hexToField(early.commitment)));
      const earlier = notes.list().find((n) => n.sweptFrom?.toLowerCase() === nf.toLowerCase());
      if (earlier) {
        return text({
          status: "already_settled",
          grantAccess: false,
          final: false,
          message: `This payment was already settled by this server (${earlier.handle}). Do not serve it twice.`,
        });
      }
    } catch {
      // The full check below explains what is wrong with it.
    }
    const usedBy = notes.list().find((n) => n.origin === "received" && n.label?.endsWith(challengeTag));
    if (usedBy) {
      return reject(`This challenge was already paid and used (${usedBy.handle}). The payer should request the resource again for a fresh challenge.`, {
        problem: "invalid-challenge",
      });
    }
    const client = deps.signer(net)?.publicClient ?? deps.publicClient(net);
    const notUsed = async (): Promise<never> => {
      throw new Error("not used while validating");
    };
    let v: ValidatedGloamCharge;
    try {
      v = await validateGloamCharge({
        challenge: ch,
        payload: cred.payload,
        config: {
          receiveKey,
          chain: mppChain(sweepChain(client, net), (a) => client.getTransactionReceipt(a)),
          prove: notUsed,
          submit: notUsed,
          pools: { [net.chainId]: net.pool },
        },
      });
    } catch (e) {
      if (e instanceof GloamChargeError) {
        return reject(e.message, { problem: e.code, ...(e.retryable ? { retryable: true } : {}) });
      }
      return text({ status: "error", grantAccess: false, final: false, error: errMsg(e) });
    }
    // Do not echo the commitment back: it names the leaf this server now owns.
    const verifyView = { ok: true, reason: null, sealed: true, amountWei: v.note.amountWei, asset: v.note.asset, mode: v.mode };
    return settleReceived({
      net,
      notes,
      note: v.note,
      paymentNullifier: v.paymentNullifier,
      label: `${ch.description ?? ch.realm} ${challengeTag}`,
      sealed: true,
      verifyView,
      ...(v.mode === "pull" && !v.landed ? { pull: v.transfer } : {}),
      mpp: { challengeId: ch.id, ...(request.externalId !== undefined ? { externalId: request.externalId } : {}) },
    });
  }

  server.registerTool(
    "gloam_verify_payment",
    {
      title: "Verify and settle a private payment (x402 or MPP)",
      description:
        "SERVER side. Check a presented payment and make it final: an x402 X-PAYMENT value against its requirements, or an MPP credential (the Authorization: Payment value, method gloam) against the challenge it echoes, which must be one this server issued. Opens the payment note with this server's receive key, checks it binds the required amount and asset in the right pool (and, for MPP, that it is the payment output of a Transferred event and bound to that challenge), then sweeps it into a fresh note only this server knows and waits for that to confirm. Grant access only when the result says grantAccess: true; for MPP, serve with its paymentReceipt as the Payment-Receipt header. A payer creates the payment note, so without the sweep it could spend the money back after being served. Needs GLOAM_AGENT_PRIVATE_KEY or the relay (GLOAM_USE_RELAY=1) to sweep.",
      inputSchema: {
        requirements: z
          .string()
          .optional()
          .describe("The price you issued: x402 requirements (encoded or raw JSON), or the MPP challenge (WWW-Authenticate value). Required for x402. For MPP it is optional, and binds the credential to that exact price."),
        payment: z.string().describe("The X-PAYMENT header value (or raw JSON payload), or the MPP Authorization: Payment value presented by the payer."),
      },
    },
    async ({ requirements, payment }) => {
      const reject: Reject = (message, extra = {}) => text({ status: "rejected", grantAccess: false, final: false, message, ...extra });
      if (looksLikeMpp(payment)) return verifyMpp(payment, requirements, reject);
      if (!requirements) return text({ status: "error", error: "requirements is required for an x402 payment: pass the requirements you issued." });
      const req = parseRequirements(requirements);
      if (!req) return text({ status: "error", error: "Could not parse requirements." });
      const pay = parsePayment(payment);
      if (!pay?.payload?.paymentNote) return text({ status: "error", error: "Could not parse payment." });

      const net = networkByChainId(Number(req.network));
      if (!net || String(req.poolAddress).toLowerCase() !== net.pool.toLowerCase()) {
        return reject(`These requirements name pool ${req.poolAddress} on chain ${req.network}, which is not a Gloam pool. Not settling there.`);
      }
      const opened = openStore();
      if (!opened.ok) return text({ status: "error", grantAccess: false, error: opened.error });
      const notes = opened.store;
      const receiveKey = notes.receiveKey();
      const sealed = isSealedTicket(pay.payload.paymentNote);
      if (sealed && !receiveKey) return reject("This server has no receive tag yet, so a sealed payment cannot be for it.");
      if (sealed && receiveKey && String(req.payTo).trim() !== receiveKey.tag) {
        return reject("payTo in these requirements is not this server's receive tag, so this server cannot open the payment.");
      }
      let note: NoteExport;
      try {
        note = await openGloamPaymentNote(pay.payload.paymentNote, receiveKey ?? undefined);
      } catch (e) {
        return reject(`Could not open the payment note: ${errMsg(e)}`);
      }
      // A note claiming amount + p (or secret + p) opens the same commitment as the real one.
      const notCanonical = noteFieldProblem(note);
      if (notCanonical) return reject(`The payment note is not canonical: ${notCanonical}`);
      if (BigInt(note.amountWei) <= 0n) return reject("The payment note carries no value.");
      const verify = verifyGloamPayment({ requirements: req, payload: pay, note });
      // Do not echo the commitment back: it names the leaf this server now owns.
      const verifyView = { ok: verify.ok, reason: verify.reason, sealed: verify.sealed, amountWei: verify.amountWei, asset: verify.asset };
      if (!verify.ok) return reject(verify.reason ?? "The payment did not verify.", { verify: verifyView });
      // A structural pass alone would trust a lying payer; the amount must bind to the commitment.
      if (!(await verifyPaymentNoteBinding(note))) return reject("The payment note's amount does not bind to its commitment.");
      const paymentNullifier = fieldToHex(await noteNullifierPoseidon(hexToField(note.secret), hexToField(note.commitment)));
      return settleReceived({ net, notes, note, paymentNullifier, label: req.resource, sealed, verifyView });
    }
  );

  // ── spending limits ─────────────────────────────────────────────────────────

  server.registerTool(
    "gloam_get_limits",
    {
      title: "Spending limits",
      description:
        "This agent's spending limits as the owner set them: which money tools it may use, which assets, the cap per payment and per rolling 24 hours, allowed recipients, and when its permission expires. Check this before planning a payment. This MCP server enforces them before it signs (off-chain). When the agent's key is a Tempo access key, the result also has `onchain`: the owner's AccountKeychain authorization (expiry, the remaining periodic limit and call scopes), which the Tempo protocol enforces on every transaction whatever this server does. The vault contract itself does not know about limits.",
    },
    async () => {
      const report = limitsReport(env);
      let setup: ReturnType<typeof signerSetup>;
      try {
        setup = signerSetup(env);
      } catch (e) {
        return text({ ...report, onchain: { error: errMsg(e) } });
      }
      if (setup.mode !== "access-key") return text(report);
      try {
        const tempoNet = tempoAccessNetwork(env);
        const onchain = await checkAccessKey({ owner: setup.owner, keyId: setup.keyAddress, network: tempoNet }, deps.publicClient(tempoNet));
        return text({ ...report, onchain });
      } catch (e) {
        return text({ ...report, onchain: { error: `Could not read the access key's onchain state: ${errMsg(e)}` } });
      }
    }
  );

  server.registerTool(
    "gloam_get_spending_report",
    {
      title: "Spending report",
      description:
        "What this agent has spent in the last 24 hours and how much is left under its daily limit, per asset, plus its most recent payments and any refused attempts. Read from the local spending log this server keeps.",
      inputSchema: {
        recent: z.number().int().min(1).max(50).default(10).describe("How many recent payments to list."),
      },
    },
    async ({ recent }) => text(spendingReport(recent, env))
  );

  return server;
}
