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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
    (notes[0]?.asset as Address | undefined) ??
    null;
  const toAsset: Address | null =
    (toPick && payAsset && !same(toPick, payAsset) ? toPick : null) ??
    assets.find((a) => payAsset && !same(a, payAsset)) ??
    null;
  const [amountInput, setAmountInput] = useState("");

  const held = payAsset ? holdings.get(payAsset.toLowerCase()) : undefined;
  const typed = amountInput.trim() && payAsset ? parseAssetAmount(amountInput.trim(), payAsset) : null;
  const amountBad = amountInput.trim() !== "" && (typed === null || typed <= 0n);
  const overTotal = typed !== null && held != null && typed > held.total;
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

  // A fresh quote whenever what is being swapped changes (after a short pause while typing).
  const quoteKey =
    note && toAsset && feeBps != null && amount !== null ? `${note.id}|${toAsset}|${amount}|${feeBps}` : null;
  useEffect(() => {
    if (!quoteKey || !note || !toAsset || feeBps == null || amount === null || busy) return;
    let live = true;
    const t = window.setTimeout(() => {
      setQuoting(true);
      setQuoteError(null);
      const key = quoteKey;
      planVaultSwap(getRhPublicClient(), network.chainId, { assetIn: note.asset, assetOut: toAsset, amountIn: amount, feeBps })
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

  // One label for the main button, the first thing that stops the swap.
  const button: { label: ReactNode; ready: boolean } = busy
    ? {
        label: (
          <>
            <Spinner />
            <span className="truncate">{status ?? "Swapping…"}</span>
          </>
        ),
        ready: false,
      }
    : !amountInput.trim()
      ? { label: "Enter an amount", ready: false }
      : amountBad
        ? { label: "Enter a valid amount", ready: false }
        : overTotal
          ? { label: "Insufficient private balance", ready: false }
          : overNote && held && payAsset
            ? { label: `Up to ${formatAssetLabel(held.largest, payAsset)} in one swap`, ready: false }
            : waitingQuote || quoting
              ? {
                  label: (
                    <>
                      <Spinner />
                      Getting a price
                    </>
                  ),
                  ready: false,
                }
              : quoteError
                ? { label: "No price for this amount", ready: false }
                : overRoom
                  ? { label: "Too large for the vault right now", ready: false }
                  : relayOk === false
                    ? { label: "The Gloam relay is off", ready: false }
                    : shownPlan && relayOk === true
                      ? { label: "Swap privately", ready: true }
                      : { label: "Swap privately", ready: false };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="gl-card mx-auto w-full min-w-0 max-w-[560px] p-3 sm:p-4 lg:mx-0">
        <div className="flex items-center justify-between gap-3 px-2 pb-3 pt-1">
          <p className="t-title text-foreground">Swap</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sealed-soft px-2.5 py-1 text-[12px] font-medium text-sealed">
            <LockIcon />
            Private
          </span>
        </div>

        {!isConnected || !address ? (
          <div className="space-y-3 rounded-[18px] bg-surface p-5">
            <p className="text-[14px] leading-relaxed text-soft">
              Connect the wallet you use with Gloam to swap from your private balance.
            </p>
            <WalletMenu />
          </div>
        ) : !notes.length ? (
          <div className="rounded-[18px] bg-surface p-5 text-[14px] leading-relaxed text-soft">
            Nothing to swap yet. Add {assets.map(assetLabel).join(" or ")} to your private balance first.
          </div>
        ) : (
          <>
            {/* You pay */}
            <div className="rounded-[18px] bg-surface p-4 focus-within:ring-1 focus-within:ring-line-strong">
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
              <div className="mt-2 flex items-center gap-3">
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
                  className="tnum w-0 min-w-0 flex-1 bg-transparent text-[28px] font-light sm:text-[34px] leading-tight tracking-[-0.02em] text-foreground outline-none placeholder:text-faint disabled:opacity-60"
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
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="tnum text-[12.5px] text-mute">{payUsd != null ? fmtUsd(payUsd) : " "}</span>
                <div className="flex gap-1.5" role="group" aria-label="Amount presets">
                  {[25, 50, 75, 100].map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={busy || !held}
                      onClick={() => setShare(p)}
                      className="min-h-8 rounded-full border border-line bg-panel px-2.5 text-[12px] font-medium text-soft transition-colors hover:border-line-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 disabled:opacity-50"
                    >
                      {p === 100 ? "Max" : `${p}%`}
                    </button>
                  ))}
                </div>
              </div>
              {held && payAsset && held.notes.length > 1 && held.largest < held.total && (
                <p className="mt-2 text-[12px] leading-relaxed text-mute">
                  Up to {formatAssetLabel(held.largest, payAsset)} in one swap. Your balance is in {held.notes.length} parts, and
                  a swap spends one.
                </p>
              )}
            </div>

            {/* Flip */}
            <div className="relative z-[1] -my-3 flex justify-center">
              <button
                type="button"
                onClick={flip}
                disabled={!canFlip}
                aria-label="Switch what you pay and what you receive"
                title={canFlip ? "Switch" : "You need a private balance in the other token to switch"}
                className="grid h-10 w-10 place-items-center rounded-full border border-line bg-panel text-foreground shadow-card ring-4 ring-panel transition-transform hover:rotate-180 focus-visible:outline-none focus-visible:ring-foreground/20 disabled:text-faint disabled:hover:rotate-0 motion-reduce:transition-none"
              >
                <FlipIcon />
              </button>
            </div>

            {/* You receive */}
            <div className="rounded-[18px] bg-surface p-4" aria-live="polite">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-mute">You receive</span>
                {toAsset && holdings.get(toAsset.toLowerCase()) && (
                  <span className="tnum truncate text-[12.5px] text-mute">
                    Private balance {formatAssetAmount(holdings.get(toAsset.toLowerCase())!.total, toAsset)}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {(waitingQuote || quoting) && !shownPlan ? (
                    <span
                      className="block h-[42px] w-36 rounded-lg bg-surface-2 motion-safe:animate-pulse"
                      aria-label="Getting a price"
                    />
                  ) : (
                    <p
                      className={`tnum truncate text-[28px] font-light sm:text-[34px] leading-tight tracking-[-0.02em] ${
                        shownPlan ? "text-foreground" : "text-faint"
                      }`}
                    >
                      {shownPlan && toAsset ? formatAssetAmount(shownPlan.amountOut, toAsset) : "0"}
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
              <p className="tnum mt-2 text-[12.5px] text-mute">{getUsd != null ? fmtUsd(getUsd) : " "}</p>
            </div>

            {/* Rate and details */}
            {shownPlan && payAsset && toAsset && amount !== null && (
              <div className="mt-3 rounded-[18px] border border-line px-4">
                <div className="flex min-h-12 items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setInverse((v) => !v)}
                    className="tnum min-w-0 truncate text-left text-[13px] text-soft hover:text-foreground focus-visible:outline-none focus-visible:underline"
                    aria-label="Flip the rate"
                  >
                    {rateLine(amount, payAsset, shownPlan.amountOut, toAsset, inverse)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDetails((v) => !v)}
                    aria-expanded={showDetails}
                    className="inline-flex min-h-10 shrink-0 items-center gap-1 text-[13px] text-mute hover:text-foreground focus-visible:outline-none focus-visible:underline"
                  >
                    Details
                    <Chevron open={showDetails} />
                  </button>
                </div>
                {showDetails && (
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
                )}
              </div>
            )}

            {(quoteError || overRoom || relayOk === false || (note && amount !== null && amount < BigInt(note.amountWei))) && (
              <div className="mt-3 space-y-2 px-1 text-[12.5px] leading-relaxed">
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
              className="btn btn-ink btn-lg btn-block mt-3"
            >
              {button.label}
            </button>

            {error && (
              <p role="alert" className="mt-3 break-words rounded-xl bg-danger-soft px-4 py-3 text-[13.5px] leading-relaxed text-danger">
                {error}
              </p>
            )}
            {done && (
              <p className="mt-3 rounded-xl bg-sealed-soft px-4 py-3 text-[13.5px] leading-relaxed text-foreground">{done}</p>
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
    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
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
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-panel pl-1.5 pr-3 text-[15px] font-medium text-foreground shadow-card transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 disabled:opacity-60"
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
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center p-[16px] sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="swap-picker-title"
    >
      <button type="button" className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div className="relative z-[1] max-h-[min(80dvh,560px)] w-full max-w-[400px] overflow-y-auto rounded-[24px] bg-panel p-5 shadow-pop sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="swap-picker-title" className="text-[20px] font-light tracking-[-0.01em] text-foreground">
            {mode === "pay" ? "Pay with" : "Receive"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 grid h-10 w-10 place-items-center rounded-full text-mute transition-colors hover:bg-surface hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="mt-1 text-[13px] text-mute">
          {mode === "pay" ? "From your private balance." : "Lands in your private balance."}
        </p>
        <ul className="mt-4 space-y-1">
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
                  onClick={() => onPick(a)}
                  aria-current={isCurrent ? "true" : undefined}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-[14px] px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 disabled:cursor-not-allowed disabled:opacity-50 ${
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

/** What stays private, what is public, and what happens if a swap can't finish. Kept in full. */
function PrivacyNotes({ venue }: { venue: string }) {
  return (
    <div className="gl-card min-w-0 p-5 text-[13px] leading-relaxed text-soft">
      <p className="t-title text-foreground">What stays private</p>
      <ul className="mt-3 space-y-2">
        <li>Who swapped. The Gloam relay sends it, so your wallet never shows.</li>
        <li>Which balance it came from, and where the new one goes next.</li>
      </ul>
      <p className="t-title mt-5 text-foreground">What is public</p>
      <ul className="mt-3 space-y-2">
        <li>The two amounts and the two tokens, as with any trade on {venue}.</li>
        <li>
          The amount you swap, too: swapping exactly what you added links back to that deposit. Swap a different
          amount.
        </li>
        <li>And cashing out exactly what you got can be matched to this swap. Send it on or cash out a different amount.</li>
      </ul>
      <p className="t-title mt-5 text-foreground">If it can&apos;t finish</p>
      <p className="mt-3">
        Once a swap is sent, anyone can make it fail on purpose by sending its first step on its own. Then the money
        comes back to your private balance by itself, less up to 1%: the vault&apos;s cash-out fee and a safety margin
        that goes to the Gloam treasury.
      </p>
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
      className={`shrink-0 text-mute transition-transform ${open ? "rotate-180" : ""}`}
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
