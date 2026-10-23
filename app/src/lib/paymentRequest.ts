/**
 * Payment requests: a link that asks someone to pay your Gloam address.
 *
 *   https://gloam.trade/app/vault?tab=move&mode=pay#to=gloamr1.…&amount=1250
 *     &asset=0x…&note=Invoice+042&chain=robinhood&name=Robin
 *
 * The link only pre-fills the private send form on the payer's side. Nothing
 * about a request is posted on chain. The details sit in the URL fragment
 * (after #), which browsers never send to a server or put in a referrer, so
 * they stay between the two people who share the link. The same fields are
 * also read from the query string, so hand-made `?to=…&amount=…` links work.
 * The payer still checks the details and presses send, and every field is
 * validated before it is used. The note then travels inside the payment
 * itself, sealed so only the payee can read it (lib/paymentNote).
 */

import { zeroAddress, type Address } from "viem";
import { getNetwork, isNetworkKey, type NetworkKey } from "./networks";
import { PAYMENT_NOTE_MAX, cleanText } from "./paymentNote";
import { RECEIVE_TAG_PREFIX } from "./receiveTag";
import { readAmountText } from "./amountText";
import { shieldTokensFor, supportsNativeShield } from "./tokens";

/** Same cap as the private note the payment carries (lib/paymentNote). */
export const REQUEST_NOTE_MAX = PAYMENT_NOTE_MAX;
export const REQUEST_NAME_MAX = 40;

/** A token someone can ask to be paid in, on one network. */
export type RequestAsset = {
  /** Token id from lib/tokens (for TokenLogo), or "native". */
  id: string;
  symbol: string;
  /** ERC-20 address, or the zero address for the chain's native coin. */
  address: Address;
  decimals: number;
  native: boolean;
  stable: boolean;
};

/** Tokens a request can name on a network: stablecoins first, then the rest. */
export function requestAssetsFor(key: NetworkKey): RequestAsset[] {
  const n = getNetwork(key);
  const tokens = shieldTokensFor(n.chainId);
  const toAsset = (t: (typeof tokens)[number]): RequestAsset => ({
    id: t.id,
    symbol: t.symbol,
    address: t.address,
    decimals: t.decimals,
    native: false,
    stable: t.kind === "stablecoin",
  });
  const native: RequestAsset[] = supportsNativeShield(n.chainId)
    ? [
        {
          id: "native",
          symbol: n.primaryAsset.symbol,
          address: zeroAddress,
          decimals: n.primaryAsset.decimals,
          native: true,
          stable: false,
        },
      ]
    : [];
  return [
    ...tokens.filter((t) => t.kind === "stablecoin").map(toAsset),
    ...native,
    ...tokens.filter((t) => t.kind !== "stablecoin").map(toAsset),
  ];
}

/** Looks a token up by address or symbol (either case) on one network. */
export function findRequestAsset(key: NetworkKey, raw: string): RequestAsset | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  return (
    requestAssetsFor(key).find(
      (a) => a.address.toLowerCase() === v || a.symbol.toLowerCase() === v
    ) ?? null
  );
}

/**
 * Why a payment code can't be claimed on this network, or null when it can.
 * Both mainnet vaults sit at the same address, so the vault alone can't tell
 * a Robinhood Chain code from a Tempo one; the asset can. A code claimed on
 * the wrong one would sit in the balance as "not settled".
 */
export function claimNetworkProblem(
  network: { key: NetworkKey; pool: string | null },
  pack: { pool?: string; asset: string }
): string | null {
  if (pack.pool && network.pool && pack.pool.toLowerCase() !== network.pool.toLowerCase()) {
    return "This payment is for a different vault or network.";
  }
  const asset = pack.asset.trim().toLowerCase();
  if (!requestAssetsFor(network.key).some((a) => a.address.toLowerCase() === asset)) {
    return "This payment is on a different network. Switch network, then claim it again.";
  }
  return null;
}

const TAG_BODY = /^[A-Za-z0-9_-]{40,400}$/;

/** A complete-looking Gloam address (gloamr1.<base64url key>). */
export function isValidRequestTag(input: string): boolean {
  const t = input.trim();
  return t.startsWith(RECEIVE_TAG_PREFIX) && TAG_BODY.test(t.slice(RECEIVE_TAG_PREFIX.length));
}

/**
 * Checks a typed amount. Empty is allowed (the payer then chooses). Returns the
 * amount as a plain decimal string ("1250", "12.5") or a message to show.
 */
export function normalizeRequestAmount(
  input: string,
  asset: Pick<RequestAsset, "decimals" | "symbol">
): { value: string } | { error: string } {
  const read = readAmountText(input);
  if (!read.ok) return { error: read.error };
  const s = read.text;
  if (!s) return { value: "" };
  const [rawInt, rawFrac = ""] = s.split(".");
  if (rawFrac.length > asset.decimals) {
    return {
      error: `${asset.symbol} goes to ${asset.decimals} decimal places at most.`,
    };
  }
  const int = rawInt.replace(/^0+(?=\d)/, "") || "0";
  const frac = rawFrac.replace(/0+$/, "");
  if (int.length > 15) return { error: "That amount is too large." };
  if (/^0*$/.test(int) && !frac) {
    return { error: "Enter an amount above zero, or leave it empty." };
  }
  return { value: frac ? `${int}.${frac}` : int };
}

/** "1250.5" → "1,250.5" without losing any decimals. */
export function formatRequestAmount(amount: string): string {
  const [int, frac] = amount.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Drops control and direction-override characters, squeezes spaces, caps length. */
export function cleanRequestText(raw: string | null | undefined, max: number): string {
  return cleanText(raw, max);
}

export type PaymentRequestDraft = {
  to: string;
  network: NetworkKey;
  asset: RequestAsset;
  /** Normalized decimal, or "" to let the payer choose. */
  amount: string;
  note?: string;
  name?: string;
};

/**
 * The shareable link. `origin` is the site the link opens (gloam.trade in
 * production). Only the tab and mode go in the query; the request rides in the
 * fragment so no server sees it.
 */
export function buildPaymentRequestLink(
  draft: PaymentRequestDraft,
  origin = "https://gloam.trade"
): string {
  const p = new URLSearchParams();
  p.set("to", draft.to.trim());
  if (draft.amount) p.set("amount", draft.amount);
  p.set("asset", draft.asset.address);
  const note = cleanRequestText(draft.note, REQUEST_NOTE_MAX);
  if (note) p.set("note", note);
  p.set("chain", draft.network);
  const name = cleanRequestText(draft.name, REQUEST_NAME_MAX);
  if (name) p.set("name", name);
  return `${origin.replace(/\/+$/, "")}/app/vault?tab=move&mode=pay#${p.toString()}`;
}

/** Request fields from a URL: the fragment first, then the query string. */
export function requestParamsFrom(search: string, hash: string): URLSearchParams {
  const out = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const frag = hash.startsWith("#") ? hash.slice(1) : hash;
  // Claim links also use the fragment (#claim=…); those are not requests.
  if (frag && !frag.startsWith("claim=")) {
    for (const [k, v] of new URLSearchParams(frag)) out.set(k, v);
  }
  return out;
}

/** A request read back from a link. Bad fields are dropped and explained in `problems`. */
export type PaymentRequest = {
  /** Valid Gloam address to pay, or null when the link's one was missing or broken. */
  to: string | null;
  /** Network the link names, or null when it names none (or an unknown one). */
  network: NetworkKey | null;
  asset: RequestAsset | null;
  /** Normalized decimal, or null when absent or invalid. */
  amount: string | null;
  note: string | null;
  name: string | null;
  /** Plain-language reasons a field was left out. */
  problems: string[];
};

/**
 * Reads a request from the vault URL's search params. Returns null when the
 * URL carries no request. `fallback` is the network to resolve the token on
 * when the link names none.
 */
export function readPaymentRequest(
  params: URLSearchParams | { get(name: string): string | null },
  fallback: NetworkKey
): PaymentRequest | null {
  const rawTo = params.get("to");
  const rawAmount = params.get("amount");
  if (rawTo === null && rawAmount === null) return null;

  const problems: string[] = [];

  const rawChain = params.get("chain");
  let network: NetworkKey | null = null;
  if (rawChain) {
    if (isNetworkKey(rawChain)) network = rawChain;
    else problems.push("This link names a network Gloam does not run on, so check it with the person who sent it.");
  }
  const onNet = network ?? fallback;

  let to: string | null = null;
  if (!rawTo?.trim()) {
    problems.push("This link has no Gloam address in it. Ask them to send it again.");
  } else if (isValidRequestTag(rawTo)) {
    to = rawTo.trim();
  } else {
    problems.push("The Gloam address in this link is not complete, so it was left out. Ask them to send the link again.");
  }

  let asset: RequestAsset | null = null;
  const rawAsset = params.get("asset");
  if (rawAsset?.trim()) {
    asset = findRequestAsset(onNet, rawAsset);
    if (!asset) {
      problems.push(`This link asks for a token Gloam does not support on ${getNetwork(onNet).label}.`);
    }
  }

  // An amount means nothing without its token: "5" could be 5 USDG or 5 ETH,
  // so it is only filled in when the link names a token Gloam knows.
  let amount: string | null = null;
  if (rawAmount?.trim() && !asset) {
    if (!rawAsset?.trim()) problems.push("This link has an amount but no token, so the amount was left blank.");
  } else if (rawAmount?.trim() && asset) {
    const r = normalizeRequestAmount(rawAmount, asset);
    if ("value" in r && r.value) amount = r.value;
    else problems.push("The amount in this link is not a valid number, so it was left blank.");
  }

  return {
    to,
    network,
    asset,
    amount,
    note: cleanRequestText(params.get("note"), REQUEST_NOTE_MAX) || null,
    name: cleanRequestText(params.get("name"), REQUEST_NAME_MAX) || null,
    problems,
  };
}

/** "1,250 USDG", "USDG", or "" when the request names neither. */
export function requestAmountLabel(r: Pick<PaymentRequest, "amount" | "asset">): string {
  if (r.amount) return `${formatRequestAmount(r.amount)}${r.asset ? ` ${r.asset.symbol}` : ""}`;
  return r.asset?.symbol ?? "";
}
