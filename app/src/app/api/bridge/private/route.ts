/* eslint-disable @typescript-eslint/no-explicit-any -- Relay's quote JSON is read field by field and checked below */
import { NextResponse } from "next/server";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import { getNetwork, isNetworkKey } from "@/lib/networks";
import {
  BRIDGE_DESTINATIONS,
  BRIDGE_MIN_USD,
  RELAY_REFERRER,
  bridgeChain,
  bridgeToken,
  privateBridgeable,
  validRefundAddress,
  type PrivateBridgeQuote,
} from "@/lib/bridge";
import { buildSolanaTx, type RelaySolanaInstruction } from "@/lib/solanaTx";
import { screenAddresses } from "@/lib/screeningServer";
import { SCREEN_BLOCKED_MESSAGE } from "@/lib/screening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RELAY_API = "https://api.relay.link";
/** Orders per IP per minute. Each one is a fresh Relay order and a Solana simulation. */
const RATE_LIMIT = 12;

const POOL_ABI = parseAbi([
  "function shieldBound(address asset, uint256 amount, bytes32 commitment, bytes proof)",
  "function depositLimitsOn() view returns (bool)",
  "function depositLimit(address asset) view returns (uint128 perDeposit, uint128 total)",
  "function deposited(address asset) view returns (uint256)",
  "function commitmentSeen(bytes32 commitment) view returns (bool)",
  "function shieldVerifier() view returns (address)",
]);
const VERIFIER_ABI = parseAbi(["function verify(bytes proof, uint256[] publicInputs) view returns (bool)"]);
const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

function fail(status: number, message: string) {
  return NextResponse.json({ ok: false, error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Gloam's optional cut of a bridge, set in env. Off unless both values are valid. */
function appFees(): { recipient: string; fee: string }[] | undefined {
  const bps = Number(process.env.BRIDGE_FEE_BPS ?? "");
  const recipient = process.env.BRIDGE_FEE_RECIPIENT ?? "";
  if (!Number.isInteger(bps) || bps <= 0 || bps > 100 || !isAddress(recipient)) return undefined;
  return [{ recipient, fee: String(bps) }];
}

const units = (v: bigint, decimals: number) =>
  Number(formatUnits(v, decimals)).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * A Relay order that pays from a Solana wallet straight into the private
 * balance: { chainId, symbol, network, amount, recipient, sender, commitment, proof }.
 *
 * `amount` is what lands privately, in the network's stablecoin. The browser
 * made the note and its shield proof for exactly that amount; the order is
 * EXACT_OUTPUT, so Relay delivers exactly that to its router, which approves
 * the vault and calls shieldBound with the proof. If that call can't run,
 * Relay sends the stablecoin to `recipient` instead. Nothing here holds money
 * or a secret: the commitment and proof are public by design.
 */
export async function POST(req: Request) {
  const rate = await hitRateLimit(clientIp(req), "bridge-private", RATE_LIMIT);
  if (!rate.allowed) return fail(429, "Too many tries. Wait a minute.");

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "Send the details as JSON.");
  }

  if (typeof body.network !== "string" || !isNetworkKey(body.network)) return fail(400, "Pick Robinhood Chain or Tempo.");
  const network = getNetwork(body.network);
  if (network.chain.testnet || !network.pool) return fail(400, "Bringing money in privately works on mainnet.");
  const dest = BRIDGE_DESTINATIONS[network.family];
  const asset = dest.token.address as Address;

  const chain = bridgeChain(Number(body.chainId));
  const token = chain && typeof body.symbol === "string" ? bridgeToken(chain, body.symbol) : null;
  if (!chain || !token || !privateBridgeable(chain)) return fail(400, "Pick where the money is coming from.");

  const recipient = typeof body.recipient === "string" ? body.recipient : "";
  if (!isAddress(recipient)) return fail(400, "Connect a wallet to receive the money.");
  const sender = typeof body.sender === "string" ? body.sender.trim() : "";
  if (!validRefundAddress(chain.kind, sender)) return fail(400, "Connect your Solana wallet.");

  const amountText = typeof body.amount === "string" ? body.amount.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(amountText) || Number(amountText) < BRIDGE_MIN_USD) {
    return fail(400, `Enter an amount of at least ${BRIDGE_MIN_USD} ${dest.token.symbol}, in whole cents.`);
  }
  const amount = parseUnits(amountText, dest.token.decimals);

  const commitment = typeof body.commitment === "string" ? body.commitment : "";
  const proof = typeof body.proof === "string" ? body.proof : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(commitment) || /^0x0+$/.test(commitment) || !/^0x[0-9a-fA-F]{512}$/.test(proof)) {
    return fail(400, "The private deposit wasn't prepared right. Try again.");
  }

  const screen = await screenAddresses([recipient], { chainId: network.chainId, asset, flow: "deposit" });
  if (!screen.allowed) return fail(403, screen.message ?? SCREEN_BLOCKED_MESSAGE);

  // The vault's own checks, read before anyone pays: room under the beta
  // limits, a commitment it hasn't seen, and a proof its verifier accepts.
  const client = createPublicClient({ chain: network.chain, transport: http(network.chain.rpcUrls.default.http[0]) });
  const pool = network.pool as Address;
  try {
    const [limitsOn, limit, deposited, seen, verifier] = await Promise.all([
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "depositLimitsOn" }),
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "depositLimit", args: [asset] }),
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "deposited", args: [asset] }),
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "commitmentSeen", args: [commitment as Hex] }),
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "shieldVerifier" }),
    ]);
    if (limitsOn) {
      const [perDeposit, total] = limit;
      if (amount > perDeposit) {
        return fail(400, `During the beta, one private deposit can be up to ${units(perDeposit, dest.token.decimals)} ${dest.token.symbol}.`);
      }
      if (deposited + amount > total) {
        const room = total > deposited ? total - deposited : BigInt(0);
        return fail(400, room > BigInt(0)
          ? `The vault has room for ${units(room, dest.token.decimals)} ${dest.token.symbol} more during the beta.`
          : `The vault is at its beta limit for ${dest.token.symbol}. Try again later.`);
      }
    }
    if (seen) return fail(400, "That private deposit was already used. Start over.");
    const valid = await client.readContract({
      address: verifier,
      abi: VERIFIER_ABI,
      functionName: "verify",
      args: [proof as Hex, [BigInt(commitment), amount, BigInt(asset)]],
    });
    if (!valid) return fail(400, "The private deposit wasn't prepared right. Try again.");
  } catch {
    return fail(502, `Couldn't reach ${dest.chain}. Try again.`);
  }

  const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [pool, amount] });
  const shieldData = encodeFunctionData({
    abi: POOL_ABI,
    functionName: "shieldBound",
    args: [asset, amount, commitment as Hex, proof as Hex],
  });

  const apiKey = process.env.RELAY_API_KEY;
  let data: Record<string, any> | null = null;
  try {
    const res = await fetch(`${RELAY_API}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
      body: JSON.stringify({
        user: sender,
        recipient,
        refundTo: sender,
        originChainId: chain.id,
        destinationChainId: dest.chainId,
        originCurrency: token.address,
        destinationCurrency: asset,
        amount: amount.toString(),
        tradeType: "EXACT_OUTPUT",
        useDepositAddress: false,
        txs: [
          { to: asset, value: "0", data: approveData },
          { to: pool, value: "0", data: shieldData },
        ],
        appFees: appFees(),
        ...(apiKey ? { referrer: RELAY_REFERRER } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    data = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!res.ok) {
      const msg = typeof data?.message === "string" ? data.message : "";
      return fail(502, /amount|too (low|small)|insufficient/i.test(msg) ? "That amount is too small to bridge. Try a little more." : "The bridge couldn't make a route right now. Try again.");
    }
  } catch {
    return fail(502, "Couldn't reach the bridge. Try again.");
  }

  // The order must do exactly what was asked: pay this amount of the vault's
  // stablecoin on this chain and run these two calls. Anything else is refused
  // rather than signed.
  const step = data?.steps?.[0];
  const item = step?.items?.[0]?.data;
  const out = data?.details?.currencyOut;
  const output = data?.protocol?.v2?.orderData?.output;
  const calls: string[] = Array.isArray(output?.calls) ? output.calls.map((c: unknown) => String(c).toLowerCase()) : [];
  const ok =
    data?.steps?.length === 1 &&
    step?.kind === "transaction" &&
    typeof step?.requestId === "string" &&
    step?.items?.length === 1 &&
    Array.isArray(item?.instructions) &&
    item.instructions.length > 0 &&
    Array.isArray(item?.addressLookupTableAddresses) &&
    Number(out?.currency?.chainId) === dest.chainId &&
    String(out?.currency?.address ?? "").toLowerCase() === asset.toLowerCase() &&
    BigInt(out?.amount ?? -1) === amount &&
    calls.length === 2 &&
    calls[0]!.includes(approveData.slice(2).toLowerCase()) &&
    calls[1]!.includes(shieldData.slice(2).toLowerCase()) &&
    Array.isArray(output?.payments) &&
    output.payments.every((p: Record<string, unknown>) => String(p?.currency).toLowerCase() === asset.toLowerCase() && BigInt(String(p?.minimumAmount ?? -1)) === amount);
  if (!ok) return fail(502, "The bridge couldn't make a route right now. Try again.");

  const usdIn = Number(data?.details?.currencyIn?.amountUsd ?? NaN);
  const sendAmount = String(data?.details?.currencyIn?.amountFormatted ?? "");
  // A route that costs far more than it delivers is refused, whatever the reason.
  if (Number.isFinite(usdIn) && usdIn > Number(amountText) * 1.1 + 2) {
    return fail(502, "Bridge fees are unusually high right now. Try again in a minute.");
  }

  const built = await buildSolanaTx(
    sender,
    item.instructions as RelaySolanaInstruction[],
    (item.addressLookupTableAddresses as unknown[]).map(String)
  );
  if (!built.ok) {
    return fail(
      built.reason === "funds" ? 400 : 502,
      built.reason === "funds"
        ? `That wallet doesn't hold enough for this. It needs ${sendAmount} ${token.symbol}, plus a little SOL for the network fee.`
        : built.reason === "rpc"
          ? "Couldn't reach Solana. Try again."
          : "The bridge couldn't make a route right now. Try again."
    );
  }

  const feeUsd = ["relayer", "app"].reduce((sum, k) => sum + Number(data?.fees?.[k]?.amountUsd ?? 0), 0);
  const quote: PrivateBridgeQuote = {
    requestId: String(step.requestId),
    solanaTx: built.tx,
    send: {
      amount: sendAmount,
      symbol: token.symbol,
      chain: chain.name,
      chainId: chain.id,
      logo: token.logo,
      usd: Number.isFinite(usdIn) ? Math.round(usdIn * 100) / 100 : null,
    },
    receive: { amount: amountText, symbol: dest.token.symbol, chain: dest.chain, logo: dest.token.logo },
    feeUsd: Math.round(feeUsd * 100) / 100,
    timeSec: Number(data?.details?.timeEstimate ?? 0),
  };
  return NextResponse.json({ ok: true, data: quote }, { headers: { "Cache-Control": "no-store" } });
}
