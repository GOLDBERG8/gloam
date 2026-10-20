import { ApiError, jsonBody, withApiKey } from "@/lib/partnersApi";
import { isLocalHost } from "@/lib/apiKeys";
import { requestHost } from "@/lib/partnersAuth";
import { isNetworkKey, networkKeyChoices } from "@/lib/networks";
import {
  buildPaymentRequestLink,
  cleanRequestText,
  findRequestAsset,
  isValidRequestTag,
  normalizeRequestAmount,
  REQUEST_NAME_MAX,
  REQUEST_NOTE_MAX,
} from "@/lib/paymentRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Make a payment request link: { to: "gloamr1...", network: "robinhood" | "tempo",
 * asset: "USDG" | "0x...", amount?: "12.50", note?, name? }. The details ride
 * after the # of the link, so the payer's browser never sends them to a
 * server. This endpoint builds the link and keeps nothing.
 */
export async function POST(req: Request) {
  return withApiKey(req, async () => {
    const body = await jsonBody(req);
    if (typeof body.to !== "string" || !isValidRequestTag(body.to)) {
      throw new ApiError(400, "bad_tag", "to must be a complete Gloam address (gloamr1...).");
    }
    const network = body.network ?? "robinhood";
    if (typeof network !== "string" || !isNetworkKey(network)) {
      throw new ApiError(400, "unknown_network", `network must be ${networkKeyChoices()}.`);
    }
    const asset = typeof body.asset === "string" ? findRequestAsset(network, body.asset) : null;
    if (!asset) throw new ApiError(400, "unknown_asset", "asset must be a token symbol or address Gloam supports on that network.");
    const amountIn = body.amount == null ? "" : String(body.amount);
    const amount = normalizeRequestAmount(amountIn, asset);
    if ("error" in amount) throw new ApiError(400, "bad_amount", amount.error);
    const note = cleanRequestText(typeof body.note === "string" ? body.note : "", REQUEST_NOTE_MAX);
    const name = cleanRequestText(typeof body.name === "string" ? body.name : "", REQUEST_NAME_MAX);
    const host = requestHost(req);
    const origin = isLocalHost(host) ? `http://${host}` : "https://gloam.trade";
    const url = buildPaymentRequestLink({ to: body.to, network, asset, amount: amount.value, note, name }, origin);
    return {
      data: {
        url,
        network,
        asset: { symbol: asset.symbol, address: asset.address, decimals: asset.decimals },
        amount: amount.value || null,
        note: note || null,
        name: name || null,
      },
      status: 201,
    };
  });
}
