import { NextResponse } from "next/server";
import { formatUnits, isAddress, parseUnits } from "viem";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import { getNetwork, isNetworkKey } from "@/lib/networks";
import {
  BRIDGE_DESTINATIONS,
  BRIDGE_MAX_USD,
  BRIDGE_MIN_USD,
  bridgeChain,
  bridgeToken,
  swapSource,
  validRefundAddress,
  type BridgeQuote,
} from "@/lib/bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RELAY_API = "https://api.relay.link";
/** Quotes per IP per minute. Each one makes a fresh deposit address at Relay. */
const RATE_LIMIT = 12;

const ADDRESS_NAME: Record<string, string> = { svm: "Solana", tvm: "Tron", bvm: "Bitcoin" };

function fail(status: number, message: string, headers?: HeadersInit) {
  return NextResponse.json({ ok: false, error: { message } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Gloam's optional cut of a bridge, set in env. Off unless both values are valid. */
function appFees(): { recipient: string; fee: string }[] | undefined {
  const bps = Number(process.env.BRIDGE_FEE_BPS ?? "");
  const recipient = process.env.BRIDGE_FEE_RECIPIENT ?? "";
  if (!Number.isInteger(bps) || bps <= 0 || bps > 100 || !isAddress(recipient)) return undefined;
  return [{ recipient, fee: String(bps) }];
}

/**
 * A one-time Relay deposit address: { chainId, symbol, network, amount, recipient, refundTo? }.
 * The person sends `amount` of that token to the returned address and Relay
 * delivers the network's stablecoin to `recipient`. We keep nothing.
 */
export async function POST(req: Request) {
  const rate = await hitRateLimit(clientIp(req), "bridge-quote", RATE_LIMIT);
  if (!rate.allowed) return fail(429, "Too many tries. Wait a minute.", { "Retry-After": String(rate.retryAfterSec) });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "Send the details as JSON.");
  }

  if (typeof body.network !== "string" || !isNetworkKey(body.network)) return fail(400, "Pick Robinhood Chain or Tempo.");
  const network = getNetwork(body.network);
  const dest = BRIDGE_DESTINATIONS[network.family];
  const swap = swapSource(network);
  const chain = swap && Number(body.chainId) === swap.id ? swap : bridgeChain(Number(body.chainId));
  const token = chain && typeof body.symbol === "string" ? bridgeToken(chain, body.symbol) : null;
  if (!chain || !token) return fail(400, "Pick where the money is coming from.");

  const recipient = typeof body.recipient === "string" ? body.recipient : "";
  if (!isAddress(recipient)) return fail(400, "Connect a wallet to receive the money.");

  const amountText = typeof body.amount === "string" ? body.amount.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(amountText) || !(Number(amountText) > 0)) return fail(400, "Enter an amount.");
  if (token.stable && (Number(amountText) < BRIDGE_MIN_USD || Number(amountText) > BRIDGE_MAX_USD)) {
    return fail(400, `Enter an amount from ${BRIDGE_MIN_USD} to ${BRIDGE_MAX_USD.toLocaleString("en-US")}.`);
  }
  let amount: bigint;
  try {
    amount = parseUnits(amountText, token.decimals);
  } catch {
    return fail(400, "That amount has too many decimals.");
  }

  // Refunds go back to the sender's own address on the source chain. On an
  // EVM chain that is the same address as the connected wallet.
  const refundTo = chain.kind === "evm" ? recipient : typeof body.refundTo === "string" ? body.refundTo.trim() : "";
  if (!validRefundAddress(chain.kind, refundTo)) {
    return fail(400, `Add your ${ADDRESS_NAME[chain.kind] ?? chain.name} address, so a failed transfer can be sent back to you.`);
  }

  const apiKey = process.env.RELAY_API_KEY;
  if (chain.needsKey && !apiKey) return fail(400, `${chain.name} transfers aren't switched on yet.`);

  let res: Response;
  try {
    res = await fetch(`${RELAY_API}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
      body: JSON.stringify({
        // A swap is signed by the person's own wallet, so Relay builds it for that wallet.
        user: chain.swap ? recipient : chain.kind === "evm" ? "0x000000000000000000000000000000000000dEaD" : refundTo,
        recipient,
        originChainId: chain.id,
        destinationChainId: dest.chainId,
        originCurrency: token.address,
        destinationCurrency: dest.token.address,
        amount: amount.toString(),
        tradeType: "EXACT_INPUT",
        useDepositAddress: !chain.swap,
        refundTo,
        appFees: appFees(),
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    return fail(502, "Couldn't reach the bridge. Try again.");
  }

  const data = (await res.json().catch(() => null)) as Record<string, any> | null;
  const step = data?.steps?.[0];
  const out = data?.details?.currencyOut;
  if (!res.ok || (!chain.swap && !step?.depositAddress) || !step?.requestId || !out) {
    const msg = typeof data?.message === "string" ? data.message : "";
    return fail(502, /amount|too (low|small)|insufficient/i.test(msg) ? "That amount is too small to bridge. Try a little more." : "The bridge couldn't make a route right now. Try again.");
  }

  const usdIn = Number(data?.details?.currencyIn?.amountUsd ?? NaN);
  if (Number.isFinite(usdIn) && (usdIn < BRIDGE_MIN_USD || usdIn > BRIDGE_MAX_USD)) {
    return fail(400, `Bridge between $${BRIDGE_MIN_USD} and $${BRIDGE_MAX_USD.toLocaleString("en-US")} at a time. That's about $${usdIn.toFixed(2)}.`);
  }

  // The swap the wallet will sign: one plain transaction on this chain, sending
  // exactly the amount asked for. Anything else is refused rather than signed.
  let tx: BridgeQuote["tx"] = null;
  if (chain.swap) {
    const item = step.items?.[0]?.data;
    const ok =
      data?.steps?.length === 1 &&
      step.kind === "transaction" &&
      step.items?.length === 1 &&
      item &&
      Number(item.chainId) === chain.id &&
      typeof item.to === "string" &&
      isAddress(item.to) &&
      typeof item.data === "string" &&
      /^0x[0-9a-fA-F]*$/.test(item.data) &&
      BigInt(item.value ?? 0) === amount;
    if (!ok) return fail(502, "The swap couldn't make a route right now. Try again.");
    tx = { to: item.to, data: item.data, value: amount.toString(), chainId: chain.id };
  }

  const feeUsd = ["relayer", "app"].reduce((sum, k) => sum + Number(data?.fees?.[k]?.amountUsd ?? 0), 0);
  const quote: BridgeQuote = {
    requestId: String(step.requestId),
    depositAddress: chain.swap ? "" : String(step.depositAddress),
    tx,
    send: {
      amount: amountText,
      symbol: token.symbol,
      chain: chain.name,
      chainId: chain.id,
      logo: token.logo,
      usd: Number.isFinite(usdIn) ? Math.round(usdIn * 100) / 100 : null,
    },
    receive: {
      amount: String(out.amountFormatted ?? formatUnits(BigInt(out.amount ?? 0), dest.token.decimals)),
      minimum: formatUnits(BigInt(out.minimumAmount ?? out.amount ?? 0), dest.token.decimals),
      symbol: dest.token.symbol,
      chain: dest.chain,
      logo: dest.token.logo,
    },
    feeUsd: Math.round(feeUsd * 100) / 100,
    timeSec: Number(data?.details?.timeEstimate ?? 0),
    bitcoin: chain.kind === "bvm",
  };
  return NextResponse.json({ ok: true, data: quote }, { headers: { "Cache-Control": "no-store" } });
}
