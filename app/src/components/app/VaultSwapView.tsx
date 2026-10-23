"use client";

/**
 * Swap inside the private balance (lib/vaultSwap, lib/vaultSwapRun), laid out
 * like a standard swap: a "You pay" card, a flip button, a "You receive" card,
 * a rate line and the details underneath. Shown only where a vault swap router
 * is deployed. Who swapped stays private; the amounts show on chain, like any
 * DEX trade, and the copy says so.
 *
 * A swap spends one private note. The note is picked from the amount: the one
 * that matches it exactly, else the smallest that covers it (the rest is set
 * aside privately first). More than the largest note takes a second swap.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { useAppAccount } from "@/lib/demo";
import { useLocalShieldNotes } from "@/hooks/useLocalShieldNotes";
import { getRhPublicClient } from "@/lib/rhClient";
import { relayFor } from "@/lib/relay/client";
import { isUnsecuredClaim } from "@/lib/claimSweep";
import { freshPath } from "@/lib/cashOutSplit";
import {
  assetDecimals,
  assetLabel,
  formatAssetAmount,
  formatAssetLabel,
  formatFeePercent,
  parseAssetAmount,
  shieldPoolAbi,
  withdrawFeeOf,
  type LocalNote,
} from "@/lib/shield";
import { knownTokens, type OnchainToken } from "@/lib/tokens";
import { VAULT_SWAP_ASSETS, planVaultSwap, swapBufferBps, vaultSwapRouter, type SwapPlan } from "@/lib/vaultSwap";
import { SWAP_REFUNDED, runVaultSwap } from "@/lib/vaultSwapRun";
import type { PoseidonMerklePath } from "@/lib/merklePoseidon";
import { useNetwork } from "./NetworkProvider";
import { TokenLogo } from "./TokenLogo";
import { WalletMenu } from "./WalletMenu";

const limitAbi = [
  {
    type: "function",
    name: "depositLimit",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "perDeposit", type: "uint128" },
      { name: "total", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "deposited",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const noopSubscribe = () => () => {};
const ZERO = "0x0000000000000000000000000000000000000000";

/** The token record for an asset on this chain (logo id, name, CoinGecko id). */
function tokenFor(chainId: number, asset: string): OnchainToken | undefined {
  return knownTokens(chainId).find((t) => same(t.address, asset));
}

/** A raw amount as a plain decimal string an input can hold (no grouping), cut to `maxFrac` places. */
function plainAmount(raw: bigint, asset: string, maxFrac = 6): string {
  const s = formatUnits(raw, assetDecimals(asset));
  const [a, b = ""] = s.split(".");
  const frac = b.slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${a}.${frac}` : a!;
}

/** Big amount sizes (phone / from sm up), stepping down as digits grow so a long number never clips. */
function amountSize(text: string): string {
  const n = text.length;
  const phone = n <= 6 ? "text-[32px]" : n <= 8 ? "text-[27px]" : n <= 10 ? "text-[23px]" : n <= 13 ? "text-[19px]" : "text-[16px]";
  const wide = n <= 8 ? "sm:text-[40px]" : n <= 11 ? "sm:text-[33px]" : n <= 14 ? "sm:text-[27px]" : "sm:text-[22px]";
  return `${phone} ${wide}`;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
function fmtUsd(n: number): string {
  if (n > 0 && n < 0.01) return "<$0.01";
  return usd.format(n);
}

/** USD marks: stablecoins at $1, tokens with a CoinGecko id at its live price. Null while unknown. */
const geckoCache = new Map<string, number>();
function useUsdMarks(chainId: number, assets: readonly Address[]): Record<string, number | null> {
  const [tick, setTick] = useState(0);
  const tokens = useMemo(() => assets.map((a) => tokenFor(chainId, a)), [assets, chainId]);
  useEffect(() => {
    const ids = [...new Set(tokens.map((t) => t?.coingecko).filter((x): x is string => Boolean(x)))].filter(
      (id) => !geckoCache.has(id)
    );
    if (!ids.length) return;
    let live = true;
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Record<string, { usd?: number }> | null) => {
        for (const id of ids) {
          const v = j?.[id]?.usd;
          if (typeof v === "number" && v > 0) geckoCache.set(id, v);
        }
        if (live) setTick((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tokens]);
  return useMemo(() => {
    void tick;
    const out: Record<string, number | null> = {};
    assets.forEach((a, i) => {
      const t = tokens[i];
      out[a.toLowerCase()] = t?.kind === "stablecoin" ? 1 : t?.coingecko ? (geckoCache.get(t.coingecko) ?? null) : null;
    });
    return out;
  }, [assets, tokens, tick]);
}

export function VaultSwapView() {
  const { network } = useNetwork();
  const { address, isConnected } = useAppAccount();
  const router = vaultSwapRouter(network.chainId);
  const assets = useMemo(() => VAULT_SWAP_ASSETS[network.chainId] ?? [], [network.chainId]);
  const { open, refresh: refreshNotes } = useLocalShieldNotes(address);
  const marks = useUsdMarks(network.chainId, assets);

  // Notes a swap can spend: this vault's, in a swap asset, with their secret.
  // A claimed payment the payer could still take back is secured first, in Pay.
  const notes = useMemo(
    () =>
      open
        .filter(
          (n) =>
            n.chainId === network.chainId &&
            network.pool != null &&
            same(n.pool, network.pool) &&
            n.bound &&
            (!n.scheme || n.scheme === "poseidon") &&
            assets.some((a) => same(a, n.asset)) &&
            !isUnsecuredClaim(n)
        )
        .sort((a, b) => (BigInt(a.amountWei) > BigInt(b.amountWei) ? -1 : 1)),
    [open, network.chainId, network.pool, assets]
  );

  // Per asset: the private balance in all, and the most one swap can take (the largest note).
  const holdings = useMemo(() => {
    const m = new Map<string, { total: bigint; largest: bigint; notes: LocalNote[] }>();
    for (const n of notes) {
      const k = n.asset.toLowerCase();
      const v = BigInt(n.amountWei);
      const h = m.get(k) ?? { total: 0n, largest: 0n, notes: [] };
      h.total += v;
      if (v > h.largest) h.largest = v;
      h.notes.push(n);
      m.set(k, h);
    }
    return m;
  }, [notes]);

  const [payPick, setPayPick] = useState<Address | null>(null);
  const [toPick, setToPick] = useState<Address | null>(null);
  const payAsset: Address | null =
    (payPick && holdings.has(payPick.toLowerCase()) ? payPick : null) ??
    // The first held token in the list's order (the dollar first), not the
    // largest raw amount: 18-decimal GLOAM would always outrank 6-decimal USDG.
    assets.find((a) => holdings.has(a.toLowerCase())) ??
    assets[0] ??
    null;
  const toAsset: Address | null =
    (toPick && payAsset && !same(toPick, payAsset) ? toPick : null) ??
    assets.find((a) => payAsset && !same(a, payAsset)) ??
    null;
  const [amountInput, setAmountInput] = useState("");

  const held = payAsset ? holdings.get(payAsset.toLowerCase()) : undefined;
  const typed = amountInput.trim() && payAsset ? parseAssetAmount(amountInput.trim(), payAsset) : null;
  const amountBad = amountInput.trim() !== "" && (typed === null || typed <= 0n);
  // Nothing held counts as too little: a price still shows, the swap does not.
  const overTotal = typed !== null && !amountBad && (held == null || typed > held.total);
  const overNote = typed !== null && held != null && !overTotal && typed > held.largest;
  const amount = typed !== null && !amountBad && !overTotal && !overNote ? typed : null;

  // The note this swap spends: an exact match first, else the smallest that covers it.
  const note: LocalNote | null = useMemo(() => {
    if (!held || amount === null) return null;
    const exact = held.notes.find((n) => BigInt(n.amountWei) === amount);
    if (exact) return exact;
    const covering = held.notes.filter((n) => BigInt(n.amountWei) >= amount);
    return covering.length ? covering[covering.length - 1]! : null;
  }, [held, amount]);

  const { data: feeRead } = useReadContract({
    address: network.pool ?? undefined,
    abi: shieldPoolAbi,
    functionName: "withdrawFeeBps",
    chainId: network.chainId,
    query: { enabled: Boolean(network.pool) },
  });
  const feeBps = typeof feeRead === "number" ? feeRead : null;
  const { data: limit } = useReadContract({
    address: network.pool ?? undefined,
    abi: limitAbi,
    functionName: "depositLimit",
    args: toAsset ? [toAsset] : undefined,
    chainId: network.chainId,
    query: { enabled: Boolean(network.pool && toAsset) },
  });
  const { data: inVault } = useReadContract({
    address: network.pool ?? undefined,
    abi: limitAbi,
    functionName: "deposited",
    args: toAsset ? [toAsset] : undefined,
    chainId: network.chainId,
    query: { enabled: Boolean(network.pool && toAsset) },
  });

  const [relayOk, setRelayOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void relayFor(network.chainId).then((r) => live && setRelayOk(Boolean(r?.enabled)));
    return () => {
      live = false;
    };
  }, [network.chainId]);

  // A quote counts only for the exact swap it was asked for (quoteKey), so a
  // stale one can never be sent for a newer amount.
  const [quote, setQuote] = useState<{ key: string; plan: SwapPlan } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [inverse, setInverse] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [picker, setPicker] = useState<"pay" | "receive" | null>(null);
  // The flip button turns half a circle on each flip.
  const [turns, setTurns] = useState(0);

  // A fresh quote whenever what is being swapped changes (after a short pause while
  // typing). Any valid amount gets a price, even more than the balance holds, so
  // people can see the rate before they add money; the button still says why the
  // swap can't go. A price depends only on the tokens, the amount and the fee.
  const quoteAmount = typed !== null && !amountBad ? typed : null;
  const quoteKey =
    payAsset && toAsset && feeBps != null && quoteAmount !== null ? `${payAsset}|${toAsset}|${quoteAmount}|${feeBps}` : null;
  useEffect(() => {
    if (!quoteKey || !payAsset || !toAsset || feeBps == null || quoteAmount === null || busy) return;
    let live = true;
    const t = window.setTimeout(() => {
      setQuoting(true);
      setQuoteError(null);
      const key = quoteKey;
      planVaultSwap(getRhPublicClient(), network.chainId, { assetIn: payAsset, assetOut: toAsset, amountIn: quoteAmount, feeBps })
        .then((p) => live && setQuote({ key, plan: p }))
        .catch((e) => {
          if (!live) return;
          setQuote(null);
          setQuoteError(e instanceof Error ? e.message : "Could not get a price. Try again.");
        })
        .finally(() => live && setQuoting(false));
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quoteKey names everything the quote reads
  }, [quoteKey, network.chainId, busy]);
  const shownPlan = quote && quoteKey && quote.key === quoteKey ? quote.plan : null;
  const waitingQuote = Boolean(quoteKey) && !shownPlan && !quoteError;

  // The vault's beta deposit limits apply to what lands.
  const room =
    limit && typeof inVault === "bigint"
      ? (() => {
          const [per, total] = limit;
          const left = total > inVault ? total - inVault : 0n;
          return per < left ? per : left;
        })()
      : null;
  const overRoom = Boolean(shownPlan && room != null && shownPlan.amountOut > room);

  if (!router) return null;

  async function onSwap() {
    if (!note || !toAsset || !shownPlan || !address || amount === null) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { outNote, refunded } = await runVaultSwap({
        network,
        router: router!,
        note,
        amount,
        assetOut: toAsset,
        plan: shownPlan,
        owner: address as Address,
        pathFor: async (n) => ((await freshPath(n.commitment))?.path as PoseidonMerklePath | undefined) ?? null,
        onStatus: setStatus,
      });
      setDone(
        refunded ? SWAP_REFUNDED : `Swapped. ${formatAssetLabel(outNote.amountWei, outNote.asset)} is in your private balance.`
      );
      setAmountInput("");
      setQuote(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The swap failed. Nothing moved.");
    } finally {
      setBusy(false);
      setStatus(null);
      refreshNotes();
    }
  }

  function pickPay(a: Address) {
    if (toAsset && same(a, toAsset)) setToPick(payAsset);
    setPayPick(a);
    setAmountInput("");
    setQuote(null);
    setDone(null);
  }
  function pickReceive(a: Address) {
    if (payAsset && same(a, payAsset)) {
      if (toAsset && holdings.has(toAsset.toLowerCase())) {
        setPayPick(toAsset);
        setAmountInput("");
      } else return;
    }
    setToPick(a);
    setQuote(null);
    setDone(null);
  }
  // Flip: what you receive becomes what you pay, when there is a private balance in it.
  const canFlip = Boolean(toAsset && holdings.has(toAsset.toLowerCase())) && !busy;
  function flip() {
    if (!canFlip || !toAsset || !payAsset) return;
    const next = shownPlan ? plainAmount(shownPlan.amountOut, toAsset) : "";
    setTurns((t) => t + 1);
    setPayPick(toAsset);
    setToPick(payAsset);
    setAmountInput(next);
    setQuote(null);
    setDone(null);
  }
  function setShare(pct: number) {
    if (!held || !payAsset) return;
    const v = pct === 100 ? held.largest : (held.largest * BigInt(pct)) / 100n;
    setAmountInput(plainAmount(v, payAsset, assetDecimals(payAsset)));
    setDone(null);
  }

  const venue = network.chainId === 4217 ? "Tempo's stablecoin exchange" : "Uniswap on Robinhood Chain";
  const payUsd = payAsset && typed !== null && typed > 0n ? usdOf(typed, payAsset, marks) : null;
  const getUsd = shownPlan && toAsset ? usdOf(shownPlan.amountOut, toAsset, marks) : null;
  const receiveText = shownPlan && toAsset ? formatAssetAmount(shownPlan.amountOut, toAsset) : "0";

  // One label for the main button, the first thing that stops the swap.
  const button: { key: string; label: ReactNode; ready: boolean } = busy
    ? {
        key: `busy-${status ?? ""}`,
        label: (
          <>
            <Spinner />
            <span className="truncate">{status ?? "Swapping…"}</span>
          </>
        ),
        ready: false,
      }
    : !amountInput.trim()
      ? { key: "empty", label: "Enter an amount", ready: false }
      : amountBad
        ? { key: "bad", label: "Enter a valid amount", ready: false }
        : overTotal
          ? { key: "over", label: "Insufficient private balance", ready: false }
          : overNote && held && payAsset
            ? { key: "note", label: `Up to ${formatAssetLabel(held.largest, payAsset)} in one swap`, ready: false }
            : waitingQuote || quoting
              ? {
                  key: "quoting",
                  label: (
                    <>
                      <Spinner />
                      Getting a price
                    </>
                  ),
                  ready: false,
                }
              : quoteError
                ? { key: "noprice", label: "No price for this amount", ready: false }
                : overRoom
                  ? { key: "room", label: "Too large for the vault right now", ready: false }
                  : relayOk === false
                    ? { key: "relay", label: "The Gloam relay is off", ready: false }
                    : { key: "swap", label: "Swap privately", ready: Boolean(shownPlan && relayOk === true) };

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[520px] flex-col gap-4 lg:mx-0">
      <div className="gl-card w-full min-w-0 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 px-1 pb-5">
          <p className="t-title text-foreground">Swap</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sealed-soft px-2.5 py-1 text-[12px] font-medium text-sealed">
            <LockIcon />
            Private
          </span>
        </div>

        {!isConnected || !address ? (
          <div className="space-y-4 rounded-[20px] bg-surface p-6">
            <p className="text-[14px] leading-relaxed text-soft">
              Connect the wallet you use with Gloam to swap from your private balance.
            </p>
            <WalletMenu />
          </div>
        ) : (
          <>
            {/* You pay */}
            <div className="gl-inputcard p-5 sm:p-6">
              <div key={`pay-${payAsset ?? ""}`} className="gl-settle">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="swap-amount" className="text-[13px] text-mute">
                  You pay
                </label>
                {held && payAsset && (
                  <span className="tnum truncate text-[12.5px] text-mute">
                    Private balance {formatAssetAmount(held.total, payAsset)}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input
                  id="swap-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={amountInput}
                  disabled={busy}
                  onChange={(e) => {
                    setAmountInput(e.target.value.replace(/[^\d.,]/g, ""));
                    setDone(null);
                  }}
                  size={1}
                  className={`gl-amount tnum w-0 min-w-0 flex-1 bg-transparent font-light leading-tight tracking-[-0.02em] text-foreground outline-none placeholder:text-faint disabled:opacity-60 ${amountSize(
                    amountInput || "0"
                  )}`}
                />
                {payAsset && (
                  <TokenPill
                    chainId={network.chainId}
                    asset={payAsset}
                    disabled={busy}
                    onClick={() => setPicker("pay")}
                    label="Choose the token you pay with"
                  />
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="tnum text-[13px] text-mute">{payUsd != null ? fmtUsd(payUsd) : " "}</span>
                <div className="flex gap-2" role="group" aria-label="Amount presets">
                  {[25, 50, 75, 100].map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={busy || !held}
                      onClick={() => setShare(p)}
                      className="gl-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15"
                    >
                      {p === 100 ? "Max" : `${p}%`}
                    </button>
                  ))}
                </div>
              </div>
              {held && payAsset && held.notes.length > 1 && held.largest < held.total && (
                <p className="mt-4 text-[12.5px] leading-[1.6] text-mute">
                  Up to {formatAssetLabel(held.largest, payAsset)} in one swap. Your balance is in {held.notes.length} parts, and
                  a swap spends one.
                </p>
              )}
              </div>
            </div>

            {/* Flip */}
            <div className="relative z-[1] flex h-2 items-center justify-center">
              <button
                type="button"
                onClick={flip}
                disabled={!canFlip}
                aria-label="Switch what you pay and what you receive"
                title={canFlip ? "Switch" : "You need a private balance in the other token to switch"}
                className="gl-press grid h-11 w-11 place-items-center rounded-full border border-line bg-panel text-foreground shadow-card ring-[5px] ring-panel hover:border-line-strong focus-visible:outline-none focus-visible:ring-foreground/20 disabled:text-faint"
              >
                <span
                  className="inline-grid transition-transform duration-300 ease-[cubic-bezier(0.34,1.22,0.64,1)] motion-reduce:transition-none"
                  style={{ transform: `rotate(${turns * 180}deg)` }}
                >
                  <FlipIcon />
                </span>
              </button>
            </div>

            {/* You receive */}
            <div className="rounded-[20px] bg-surface p-5 sm:p-6" aria-live="polite">
              <div key={`get-${toAsset ?? ""}`} className="gl-settle">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-mute">You receive</span>
                {toAsset && holdings.get(toAsset.toLowerCase()) && (
                  <span className="tnum truncate text-[12.5px] text-mute">
                    Private balance {formatAssetAmount(holdings.get(toAsset.toLowerCase())!.total, toAsset)}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {(waitingQuote || quoting) && !shownPlan ? (
                    <span className="gl-skeleton block h-[40px] w-40 sm:h-[48px]" aria-label="Getting a price" />
                  ) : (
                    <p
                      key={shownPlan ? shownPlan.amountOut.toString() : "none"}
                      className={`gl-settle gl-amount tnum truncate font-light leading-tight tracking-[-0.02em] ${amountSize(
                        receiveText
                      )} ${shownPlan ? "text-foreground" : "text-faint"}`}
                    >
                      {receiveText}
                    </p>
                  )}
                </div>
                {toAsset && (
                  <TokenPill
                    chainId={network.chainId}
                    asset={toAsset}
                    disabled={busy}
                    onClick={() => setPicker("receive")}
                    label="Choose the token you receive"
                  />
                )}
              </div>
              <p key={getUsd != null ? fmtUsd(getUsd) : "none"} className="gl-settle-fast tnum mt-4 text-[13px] text-mute">
                {getUsd != null ? fmtUsd(getUsd) : " "}
              </p>
              </div>
            </div>

            {/* Rate and details */}
            {shownPlan && payAsset && toAsset && amount !== null && (
              <div className="gl-settle mt-4 rounded-[18px] border border-line px-5">
                <div className="flex min-h-[52px] items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setInverse((v) => !v)}
                    className="tnum min-w-0 truncate text-left text-[13px] text-soft transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline"
                    aria-label="Flip the rate"
                  >
                    <span key={`${inverse}-${shownPlan.amountOut}`} className="gl-settle-fast inline-block">
                      {rateLine(amount, payAsset, shownPlan.amountOut, toAsset, inverse)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDetails((v) => !v)}
                    aria-expanded={showDetails}
                    className="inline-flex min-h-10 shrink-0 items-center gap-1 text-[13px] text-mute transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline"
                  >
                    Details
                    <Chevron open={showDetails} />
                  </button>
                </div>
                <div className="gl-collapse" data-open={showDetails} aria-hidden={!showDetails}>
                  <div>
                  <dl className="divide-y divide-line border-t border-line pb-1 text-[13px]">
                    <Row term="You receive exactly">{formatAssetLabel(shownPlan.amountOut, toAsset)}</Row>
                    <Row term={`Vault fee (${formatFeePercent(feeBps ?? 0)})`}>
                      {formatAssetLabel(withdrawFeeOf(amount, feeBps ?? 0), payAsset)}
                    </Row>
                    <Row term={`Price buffer (${formatFeePercent(swapBufferBps(network.chainId))})`}>
                      about {formatAssetLabel(shownPlan.leftover, payAsset)} to the treasury
                    </Row>
                    <Row term="Route">{routeLine(network.chainId, payAsset, shownPlan, venue)}</Row>
                    <Row term="Sent by">The Gloam relay, not your wallet</Row>
                  </dl>
                  </div>
                </div>
              </div>
            )}

            {(!notes.length || quoteError || overRoom || relayOk === false || (note && amount !== null && amount < BigInt(note.amountWei))) && (
              <div className="gl-settle mt-4 space-y-2.5 px-1 text-[12.5px] leading-[1.6]">
                {!notes.length && (
                  <p className="text-mute">
                    You can check prices now. To swap, add {assets.map(assetLabel).join(" or ")} to your private balance first, in Add.
                  </p>
                )}
                {quoteError && <p className="text-warn">{quoteError}</p>}
                {overRoom && room != null && toAsset && (
                  <p className="text-warn">The vault takes at most {formatAssetLabel(room, toAsset)} right now. Swap a smaller amount.</p>
                )}
                {relayOk === false && (
                  <p className="text-warn">Swaps go through the Gloam relay, so your wallet never shows. It is off right now; try again soon.</p>
                )}
                {note && amount !== null && amount < BigInt(note.amountWei) && !quoteError && (
                  <p className="text-mute">The rest stays in your private balance: it is set aside privately first.</p>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={!button.ready || busy}
              onClick={() => void onSwap()}
              className="btn btn-ink btn-lg btn-block mt-5 h-[52px]"
            >
              <span key={button.key} className="gl-settle-fast inline-flex min-w-0 items-center gap-2">
                {button.label}
              </span>
            </button>

            {error && (
              <p role="alert" className="gl-settle mt-4 break-words rounded-[14px] bg-danger-soft px-4 py-3.5 text-[13.5px] leading-relaxed text-danger">
                {error}
              </p>
            )}
            {done && (
              <p className="gl-settle mt-4 rounded-[14px] bg-sealed-soft px-4 py-3.5 text-[13.5px] leading-relaxed text-foreground">{done}</p>
            )}
          </>
        )}
      </div>

      <PrivacyNotes venue={venue} />

      {picker && (
        <TokenPicker
          chainId={network.chainId}
          assets={assets}
          mode={picker}
          current={picker === "pay" ? payAsset : toAsset}
          other={picker === "pay" ? toAsset : payAsset}
          holdings={holdings}
          onPick={(a) => {
            if (picker === "pay") pickPay(a);
            else pickReceive(a);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function usdOf(raw: bigint, asset: string, marks: Record<string, number | null>): number | null {
  const m = marks[asset.toLowerCase()];
  if (m == null) return null;
  return Number(formatUnits(raw, assetDecimals(asset))) * m;
}

/** "1 USDG ≈ 0.4446 GLOAM", what the swap gives for each unit paid (fees included). */
function rateLine(amountIn: bigint, assetIn: string, amountOut: bigint, assetOut: string, inverse: boolean): string {
  const a = Number(formatUnits(amountIn, assetDecimals(assetIn)));
  const b = Number(formatUnits(amountOut, assetDecimals(assetOut)));
  if (!(a > 0) || !(b > 0)) return "";
  const [from, to, r] = inverse ? [assetOut, assetIn, a / b] : [assetIn, assetOut, b / a];
  const digits = r >= 100 ? 2 : r >= 1 ? 4 : 6;
  return `1 ${assetLabel(from)} ≈ ${r.toLocaleString("en-US", { maximumFractionDigits: digits })} ${assetLabel(to)}`;
}

/** "USDG → ETH → GLOAM on Uniswap on Robinhood Chain": the hops the swap takes. */
function routeLine(chainId: number, assetIn: string, plan: SwapPlan, venue: string): string {
  if (!plan.route.length) return `Direct on ${venue}`;
  const path = [assetIn];
  let at = assetIn.toLowerCase();
  for (const hop of plan.route) {
    const c0 = String(hop.currency0).toLowerCase();
    const next = c0 === at ? String(hop.currency1) : String(hop.currency0);
    path.push(next);
    at = next.toLowerCase();
  }
  const names = path.map((a) => (same(a, ZERO) ? "ETH" : (tokenFor(chainId, a)?.symbol ?? assetLabel(a))));
  return `${names.join(" → ")} on ${venue}`;
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-2.5">
      <dt className="text-mute">{term}</dt>
      <dd className="tnum min-w-0 text-right text-foreground">{children}</dd>
    </div>
  );
}

function TokenPill({
  chainId,
  asset,
  onClick,
  disabled,
  label,
}: {
  chainId: number;
  asset: Address;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  const t = tokenFor(chainId, asset);
  const symbol = t?.symbol ?? assetLabel(asset);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label}, now ${symbol}`}
      className="gl-press inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-panel pl-1.5 pr-3 text-[15px] font-medium text-foreground shadow-card hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 disabled:opacity-60"
    >
      <TokenLogo id={t?.id ?? symbol.toLowerCase()} symbol={symbol} size={30} />
      {symbol}
      <Chevron open={false} />
    </button>
  );
}

function TokenPicker({
  chainId,
  assets,
  mode,
  current,
  other,
  holdings,
  onPick,
  onClose,
}: {
  chainId: number;
  assets: readonly Address[];
  mode: "pay" | "receive";
  current: Address | null;
  other: Address | null;
  holdings: Map<string, { total: bigint; largest: bigint; notes: LocalNote[] }>;
  onPick: (a: Address) => void;
  onClose: () => void;
}) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const first = useRef<HTMLButtonElement>(null);
  // Closing plays the sheet out first (instantly with reduced motion), then
  // hands over to the parent.
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const leave = useCallback((then: () => void) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return then();
    setLeaving(true);
    window.setTimeout(then, 170);
  }, []);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && leave(onClose);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, leave]);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center p-[16px] sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="swap-picker-title"
    >
      <button
        type="button"
        data-leaving={leaving}
        className="gl-backdrop absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-label="Close"
        onClick={() => leave(onClose)}
      />
      <div
        data-leaving={leaving}
        className="gl-sheet relative z-[1] max-h-[min(80dvh,560px)] w-full max-w-[400px] overflow-y-auto rounded-[24px] bg-panel p-6 shadow-pop sm:p-7"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="swap-picker-title" className="text-[20px] font-light tracking-[-0.01em] text-foreground">
            {mode === "pay" ? "Pay with" : "Receive"}
          </h2>
          <button
            type="button"
            onClick={() => leave(onClose)}
            aria-label="Close"
            className="gl-press -mr-2 grid h-10 w-10 place-items-center rounded-full text-mute hover:bg-surface hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="mt-1 text-[13px] text-mute">
          {mode === "pay" ? "From your private balance." : "Lands in your private balance."}
        </p>
        <ul className="mt-5 space-y-1.5">
          {assets.map((a, i) => {
            const t = tokenFor(chainId, a);
            const symbol = t?.symbol ?? assetLabel(a);
            const h = holdings.get(a.toLowerCase());
            const isCurrent = current != null && same(a, current);
            const blocked = mode === "pay" ? !h : false;
            const isOther = other != null && same(a, other);
            return (
              <li key={a}>
                <button
                  ref={i === 0 ? first : undefined}
                  type="button"
                  disabled={blocked}
                  onClick={() => leave(() => onPick(a))}
                  aria-current={isCurrent ? "true" : undefined}
                  className={`gl-press flex min-h-[60px] w-full items-center gap-3 rounded-[16px] px-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 disabled:cursor-not-allowed disabled:opacity-50 ${
                    isCurrent ? "bg-surface" : "hover:bg-surface"
                  }`}
                >
                  <TokenLogo id={t?.id ?? symbol.toLowerCase()} symbol={symbol} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium leading-tight text-foreground">{symbol}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] leading-tight text-mute">
                      {t?.name ?? symbol}
                      {isOther ? (mode === "pay" ? " · now receiving" : " · now paying") : ""}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-right text-[13px] text-soft">
                    {h ? formatAssetAmount(h.total, a) : mode === "pay" ? "None" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body
  );
}

/**
 * What stays private, what is public, and what happens if a swap can't finish.
 * Kept in full, folded under the swap: the one-line summary always shows.
 */
function PrivacyNotes({ venue }: { venue: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gl-card min-w-0 text-[13.5px] leading-[1.65] text-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center justify-between gap-4 rounded-[inherit] px-5 py-4 text-left transition-colors duration-200 hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 sm:px-6"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 font-medium text-foreground">
            <LockIcon />
            What stays private
          </span>
          <span className="mt-1 block text-[13px] text-mute">
            Who swapped stays private. The amounts and tokens are public, like any trade on {venue}.
          </span>
        </span>
        <Chevron open={open} />
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-line px-5 pb-6 pt-5 sm:px-6">
            <p className="font-medium text-foreground">Private</p>
            <ul className="mt-2 space-y-2">
              <li>Who swapped. The Gloam relay sends it, so your wallet never shows.</li>
              <li>Which balance it came from, and where the new one goes next.</li>
            </ul>
            <p className="mt-5 font-medium text-foreground">Public</p>
            <ul className="mt-2 space-y-2">
              <li>The two amounts and the two tokens, as with any trade on {venue}.</li>
              <li>
                The amount you swap, too: swapping exactly what you added links back to that deposit. Swap a different
                amount.
              </li>
              <li>And cashing out exactly what you got can be matched to this swap. Send it on or cash out a different amount.</li>
            </ul>
            <p className="mt-5 font-medium text-foreground">If it can&apos;t finish</p>
            <p className="mt-2">
              Once a swap is sent, anyone can make it fail on purpose by sending its first step on its own. Then the money
              comes back to your private balance by itself, less up to 1%: the vault&apos;s cash-out fee and a safety margin
              that goes to the Gloam treasury.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent opacity-70 motion-safe:animate-spin"
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`shrink-0 text-mute transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
    >
      <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 4v15m0 0-4-4m4 4 4-4M16 20V5m0 0-4 4m4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
