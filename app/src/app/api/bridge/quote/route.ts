import { NextResponse } from "next/server";
import { formatUnits, isAddress, parseUnits } from "viem";
import { clientIp, hitRateLimit } from "@/lib/mcpRemote/rateLimit";
import { isNetworkKey } from "@/lib/networks";
import {
  BRIDGE_DESTINATIONS,
  BRIDGE_MAX,
  BRIDGE_MIN,
  bridgeSource,
  validRefundAddress,
  type BridgeQuote,
} from "@/lib/bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RELAY_API = "https://api.relay.link";
/** Quotes per IP per minute. Each one makes a fresh deposit address at Relay. */
const RATE_LIMIT = 12;

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
 * A one-time Relay deposit address: { source, network, amount, recipient, refundTo? }.
 * The person sends `amount` of the source stablecoin to the returned address
 * and Relay delivers the network's stablecoin to `recipient`. We keep nothing.
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

  const source = typeof body.source === "string" ? bridgeSource(body.source) : null;
  if (!source) return fail(400, "Pick where the money is coming from.");
  if (typeof body.network !== "string" || !isNetworkKey(body.network)) return fail(400, "Pick Robinhood Chain or Tempo.");
  const dest = BRIDGE_DESTINATIONS[body.network];

  const recipient = typeof body.recipient === "string" ? body.recipient : "";
  if (!isAddress(recipient)) return fail(400, "Connect a wallet to receive the money.");

  const amountText = typeof body.amount === "string" ? body.amount.trim() : "";
  const amountNum = Number(amountText);
  if (!/^\d+(\.\d+)?$/.test(amountText) || !(amountNum >= BRIDGE_MIN) || amountNum > BRIDGE_MAX) {
    return fail(400, `Enter an amount from ${BRIDGE_MIN} to ${BRIDGE_MAX.toLocaleString("en-US")}.`);
  }
  let amount: bigint;
  try {
    amount = parseUnits(amountText, source.token.decimals);
  } catch {
    return fail(400, "That amount has too many decimals.");
  }

  // Refunds go back to the sender's own address on the source chain. On an
  // EVM chain that is the same address as the connected wallet.
  const refundTo = source.kind === "evm" ? recipient : typeof body.refundTo === "string" ? body.refundTo.trim() : "";
  if (!validRefundAddress(source.kind, refundTo)) {
    return fail(400, `Add your ${source.chain} address, so a failed transfer can be sent back to you.`);
  }

  const apiKey = process.env.RELAY_API_KEY;
  if (source.needsKey && !apiKey) return fail(400, `${source.chain} transfers aren't switched on yet.`);

  let res: Response;
  try {
    res = await fetch(`${RELAY_API}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
      body: JSON.stringify({
        user: source.kind === "evm" ? "0x000000000000000000000000000000000000dEaD" : refundTo,
        recipient,
        originChainId: source.chainId,
        destinationChainId: dest.chainId,
        originCurrency: source.token.address,
        destinationCurrency: dest.token.address,
        amount: amount.toString(),
        tradeType: "EXACT_INPUT",
        useDepositAddress: true,
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
  if (!res.ok || !step?.depositAddress || !step?.requestId || !out) {
    const msg = typeof data?.message === "string" ? data.message : "";
    return fail(502, /amount/i.test(msg) ? "That amount is too small to bridge. Try a little more." : "The bridge couldn't make a route right now. Try again.");
  }

  const feeUsd = ["relayer", "app"].reduce((sum, k) => sum + Number(data?.fees?.[k]?.amountUsd ?? 0), 0);
  const quote: BridgeQuote = {
    requestId: String(step.requestId),
    depositAddress: String(step.depositAddress),
    send: { amount: amountText, symbol: source.token.symbol, chain: source.chain },
    receive: {
      amount: String(out.amountFormatted ?? formatUnits(BigInt(out.amount ?? 0), dest.token.decimals)),
      minimum: formatUnits(BigInt(out.minimumAmount ?? out.amount ?? 0), dest.token.decimals),
      symbol: dest.token.symbol,
      chain: dest.chain,
    },
    feeUsd: Math.round(feeUsd * 100) / 100,
    timeSec: Number(data?.details?.timeEstimate ?? 0),
  };
  return NextResponse.json({ ok: true, data: quote }, { headers: { "Cache-Control": "no-store" } });
}
