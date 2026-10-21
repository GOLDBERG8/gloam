"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import {
  BRIDGE_CHAINS,
  BRIDGE_DESTINATIONS,
  BRIDGE_MAX_USD,
  BRIDGE_MIN_USD,
  SWAP_GAS_RESERVE_WEI,
  chainLogo,
  swapSource,
  type BridgeChain,
  type BridgeQuote,
  type BridgeStatus,
} from "@/lib/bridge";
import { useAppBalance, useAppSendTransaction, useAppTxReceipt } from "@/lib/demo";
import { MAINNET_ENABLED, type GloamChainId } from "@/lib/networks";
import { useNetwork } from "./NetworkProvider";

const noopSubscribe = () => () => {};

/** Solana needs a Relay API key on the server, so it stays off until that is set. */
const CHAINS = BRIDGE_CHAINS.filter((c) => !c.needsKey || process.env.NEXT_PUBLIC_BRIDGE_SOLANA === "1");
/** The few logos the card shows before "+N more". */
const FEATURED = [1, 8453, 792703809, 56, 8253038, 42161, 728126428];

const ADDRESS_NAME: Record<string, string> = { svm: "Solana", tvm: "Tron", bvm: "Bitcoin" };

type Stage =
  | { kind: "form"; error: string | null }
  | { kind: "loading" }
  | { kind: "address"; quote: BridgeQuote; qr: string | null };

/** A chain's logo, with its dark-theme version when Relay ships one. */
function ChainLogo({ id, size = 24, className = "" }: { id: number; size?: number; className?: string }) {
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden rounded-full ${className}`} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- small local logos */}
      <img src={chainLogo(id)} alt="" width={size} height={size} className="h-full w-full object-cover dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- small local logos */}
      <img src={chainLogo(id, true)} alt="" width={size} height={size} className="hidden h-full w-full object-cover dark:block" />
    </span>
  );
}

function TokenMark({ src, size = 20 }: { src: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small local logos
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full" style={{ width: size, height: size }} />
  );
}

/**
 * "Money on another chain?" on the add-money screen: opens the bridge panel.
 * `onArrived` gets the delivered amount so the screen can fill it in.
 */
export function BridgeInCard({ recipient, onArrived }: { recipient?: string; onArrived?: (amount: string) => void }) {
  const { network } = useNetwork();
  const dest = BRIDGE_DESTINATIONS[network.family];
  const swap = swapSource(network);
  const [open, setOpen] = useState(false);
  const featured = FEATURED.filter((id) => CHAINS.some((c) => c.id === id));

  return (
    <div className="gl-card p-5">
      <p className="text-[13px] text-mute">Money on another chain?</p>
      <div className="mt-3 flex items-center">
        {featured.map((id, i) => (
          <ChainLogo key={id} id={id} size={28} className={`ring-2 ring-panel ${i > 0 ? "-ml-2" : ""}`} />
        ))}
        <span className="ml-2.5 text-[12.5px] text-mute">+{CHAINS.length - featured.length} more</span>
      </div>
      <p className="mt-3 text-[14px] leading-relaxed text-foreground">
        Bring money over from {CHAINS.length} chains, or straight from an exchange.
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-mute">
        It lands in your wallet on {dest.chain} as {dest.token.symbol}. Then you add it here privately.
        {swap && ` Holding ${swap.tokens[0]!.symbol} on ${swap.name}? Swap it to ${dest.token.symbol} here too.`}
      </p>
      <button type="button" disabled={!recipient} onClick={() => setOpen(true)} className="btn btn-ghost btn-sm mt-4">
        {recipient ? "Bring money over" : "Connect a wallet first"}
      </button>
      {recipient && (
        <BridgeSheet
          open={open}
          recipient={recipient}
          onClose={() => setOpen(false)}
          onArrived={(amount) => {
            setOpen(false);
            onArrived?.(amount);
          }}
        />
      )}
    </div>
  );
}

/**
 * "Swap to USDG" beside the gas coin in Holdings, on a chain where Relay swaps
 * it in place. Renders nothing elsewhere.
 */
export function SwapToStableButton({ recipient, onArrived }: { recipient?: string; onArrived?: (amount: string) => void }) {
  const { network } = useNetwork();
  const swap = swapSource(network);
  const [open, setOpen] = useState(false);
  if (!swap || !recipient) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm">
        Swap to {BRIDGE_DESTINATIONS[network.family].token.symbol}
      </button>
      <BridgeSheet
        open={open}
        recipient={recipient}
        startOnSwap
        onClose={() => setOpen(false)}
        onArrived={(amount) => {
          setOpen(false);
          onArrived?.(amount);
        }}
      />
    </>
  );
}

function BridgeSheet({
  open,
  recipient,
  startOnSwap = false,
  onClose,
  onArrived,
}: {
  open: boolean;
  recipient: string;
  /** Open on the same-chain swap instead of the first bridge chain. */
  startOnSwap?: boolean;
  onClose: () => void;
  onArrived: (amount: string) => void;
}) {
  const { network } = useNetwork();
  const dest = BRIDGE_DESTINATIONS[network.family];
  const swap = swapSource(network);
  // The swap on this chain comes first: it is the cheapest way in for ETH already here.
  const chains = useMemo(() => (swap ? [swap, ...CHAINS] : CHAINS), [swap]);
  const reduce = useReducedMotion();
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [chosen, setChain] = useState<BridgeChain>(() => (startOnSwap && swap) || chains[0]!);
  // A network switch can leave the old chain's swap picked; the first entry stands in for it.
  const chain = chosen.swap && chosen.id !== swap?.id ? chains[0]! : chosen;
  const [symbol, setSymbol] = useState(() => ((startOnSwap && swap) || chains[0]!).tokens[0]!.symbol);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "form", error: null });
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const token = chain.tokens.find((t) => t.symbol === symbol) ?? chain.tokens[0]!;

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chains;
    return chains.filter((c) => c.name.toLowerCase().includes(q) || c.tokens.some((t) => t.symbol.toLowerCase().includes(q)));
  }, [search, chains]);

  // The swap: the wallet's ETH on this chain, the transaction it signs, and its receipt.
  const swapping = Boolean(chain.swap);
  const { data: gasCoin } = useAppBalance({
    address: recipient as Address,
    chainId: (swap?.id ?? network.chainId) as GloamChainId,
    enabled: open && swapping,
  });
  const send = useAppSendTransaction();
  const receipt = useAppTxReceipt({ hash: send.data, chainId: (swap?.id ?? network.chainId) as GloamChainId });
  const resetSend = send.reset;

  const reset = useCallback(() => {
    setStage({ kind: "form", error: null });
    setStatus(null);
    resetSend();
  }, [resetSend]);

  // A live price for the swap while the amount is typed, refreshed every 20 seconds,
  // so the rate and fees show before review. It is the same quote the review uses.
  const [preview, setPreview] = useState<{ amount: string; at: number; quote: BridgeQuote | null; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  const pricing = open && swapping && stage.kind === "form" && /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0;
  useEffect(() => {
    if (!pricing) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/bridge/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chainId: chain.id, symbol: token.symbol, network: network.key, amount, recipient }),
          signal: ctrl.signal,
        });
        const json = (await res.json()) as { ok: boolean; data?: BridgeQuote; error?: { message: string } };
        setPreview({
          amount,
          at: Date.now(),
          quote: json.ok && json.data ? json.data : null,
          error: json.ok ? null : (json.error?.message ?? "No price right now. Try again."),
        });
      } catch {
        if (!ctrl.signal.aborted) setPreview({ amount, at: Date.now(), quote: null, error: "Couldn't get a price. Check your connection." });
      }
    }, 400);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [pricing, amount, chain.id, token.symbol, network.key, recipient, tick]);
  useEffect(() => {
    if (!pricing) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 20_000);
    return () => window.clearInterval(t);
  }, [pricing]);
  const live = preview && preview.amount === amount ? preview : null;


  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picking) setPicking(false);
      else onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, picking]);

  // Follow the transfer while the address is on screen and it isn't finished.
  const requestId = stage.kind === "address" && !stage.quote.tx ? stage.quote.requestId : null;
  const finished = status?.stage === "done" || status?.stage === "failed" || status?.stage === "refunded";
  useEffect(() => {
    if (!open || !requestId || finished) return;
    let live = true;
    const check = async () => {
      try {
        const res = await fetch(`/api/bridge/status?requestId=${requestId}`, { cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; data?: BridgeStatus };
        if (live && json.ok && json.data) setStatus(json.data);
      } catch {
        /* the next check tries again */
      }
    };
    void check();
    const t = window.setInterval(check, 5000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [open, requestId, finished]);

  function pick(c: BridgeChain) {
    setChain(c);
    setSymbol(c.tokens[0]!.symbol);
    setRefundTo("");
    setAmount("");
    setSearch("");
    setPicking(false);
  }

  async function getAddress(e: React.FormEvent) {
    e.preventDefault();
    // A swap price from the last few seconds is the review: no second wait.
    if (swapping && live?.quote && Date.now() - live.at < 25_000) {
      setStage({ kind: "address", quote: live.quote, qr: null });
      return;
    }
    setStage({ kind: "loading" });
    setStatus(null);
    try {
      const res = await fetch("/api/bridge/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: chain.id, symbol: token.symbol, network: network.key, amount, recipient, refundTo }),
      });
      const json = (await res.json()) as { ok: boolean; data?: BridgeQuote; error?: { message: string } };
      if (!json.ok || !json.data) {
        setStage({ kind: "form", error: json.error?.message ?? "Something went wrong. Try again." });
        return;
      }
      const quote = json.data;
      setStage({ kind: "address", quote, qr: null });
      if (quote.tx) return;
      void import("qrcode")
        .then((QR) => QR.toDataURL(quote.depositAddress, { margin: 1, width: 400, errorCorrectionLevel: "M" }))
        .then((qr) => setStage((s) => (s.kind === "address" && s.quote.requestId === quote.requestId ? { ...s, qr } : s)))
        .catch(() => {
          /* the address and copy button still work */
        });
    } catch {
      setStage({ kind: "form", error: "Couldn't reach the bridge. Check your connection and try again." });
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the address is selectable text */
    }
  }

  function signSwap(quote: BridgeQuote) {
    if (!quote.tx) return;
    send.sendTransaction({
      to: quote.tx.to as Address,
      data: quote.tx.data as Hex,
      value: BigInt(quote.tx.value),
      chainId: quote.tx.chainId as GloamChainId,
    });
  }

  if (!open || !mounted) return null;

  const amountNum = Number(amount);
  const amountWei = (() => {
    try {
      return /^\d+(\.\d+)?$/.test(amount) ? parseUnits(amount, token.decimals) : null;
    } catch {
      return null;
    }
  })();
  const overBalance = swapping && gasCoin != null && amountWei != null && amountWei > gasCoin.value;
  const maxWei = gasCoin != null && gasCoin.value > SWAP_GAS_RESERVE_WEI ? gasCoin.value - SWAP_GAS_RESERVE_WEI : BigInt(0);
  const amountOk = (token.stable ? amountNum >= BRIDGE_MIN_USD && amountNum <= BRIDGE_MAX_USD : amountNum > 0) && !overBalance;
  const refundOk = chain.kind === "evm" || refundTo.trim().length > 20;
  const refundName = ADDRESS_NAME[chain.kind] ?? chain.name;

  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bridge-title"
    >
      <motion.button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      />
      <motion.div
        className="relative z-[1] max-h-[92dvh] w-full max-w-[440px] overflow-y-auto rounded-t-[24px] bg-panel px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-6 shadow-pop sm:rounded-[24px] sm:px-7 sm:pb-7"
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="bridge-title" className="text-[20px] font-medium tracking-[-0.01em] text-foreground">
              {picking ? "Where is the money?" : swapping ? `Swap to ${dest.token.symbol}` : "Bring money over"}
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-mute">
              {picking
                ? `${CHAINS.length} chains. Sending from an exchange works too: pick the chain you withdraw on.`
                : swapping
                  ? `Swap ${token.symbol} for ${dest.token.symbol} in your wallet on ${dest.chain}.`
                  : `From another chain or an exchange, into your wallet on ${dest.chain}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={picking ? () => setPicking(false) : onClose}
            aria-label={picking ? "Back" : "Close"}
            className="-mr-2 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-mute transition-colors hover:bg-surface hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {network.chain.testnet && !picking && (
          <p className="mt-4 rounded-2xl bg-surface px-4 py-3 text-[12.5px] leading-relaxed text-soft">
            {MAINNET_ENABLED ? (
              <>
                Preview. This moves real money to {dest.chain} mainnet, not to this testnet. Switch to {dest.chain} mainnet
                to add it privately.
              </>
            ) : (
              <>
                Preview. This moves real money to {dest.chain} mainnet. The private balance there opens when Gloam goes to
                mainnet.
              </>
            )}
          </p>
        )}

        {picking && (
          <div className="mt-5">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chains or tokens"
              aria-label="Search chains or tokens"
              className="h-12 w-full rounded-xl border border-line bg-panel px-3.5 text-[15px] text-foreground outline-none placeholder:text-faint focus:border-foreground/40"
            />
            <ul className="mt-3 grid gap-1">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    aria-current={c.id === chain.id ? "true" : undefined}
                    className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors hover:bg-surface ${
                      c.id === chain.id ? "bg-surface" : ""
                    }`}
                  >
                    <ChainLogo id={c.id} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] text-foreground">{c.name}</span>
                      <span className="block truncate text-[12.5px] text-mute">
                        {c.swap
                          ? `Swap ${c.tokens.map((t) => t.symbol).join(", ")} to ${dest.token.symbol}, in this wallet`
                          : c.tokens.map((t) => t.symbol).join(", ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="rounded-2xl bg-surface px-4 py-4 text-[13.5px] text-mute">No chain matches that. Try another name.</li>
              )}
            </ul>
          </div>
        )}

        {!picking && stage.kind !== "address" && (
          <form onSubmit={getAddress} className="mt-5 grid gap-4">
            <div>
              <p className="text-[13px] text-mute">From</p>
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="mt-1.5 flex h-14 w-full items-center gap-3 rounded-xl border border-line px-3.5 text-left transition-colors hover:bg-surface"
              >
                <ChainLogo id={chain.id} size={28} />
                <span className="min-w-0 flex-1 text-[15px] text-foreground">{chain.name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="text-mute">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {chain.tokens.length > 1 && (
              <div role="radiogroup" aria-label="Token" className="flex flex-wrap gap-2">
                {chain.tokens.map((t) => (
                  <button
                    key={t.symbol}
                    type="button"
                    role="radio"
                    aria-checked={t.symbol === token.symbol}
                    onClick={() => {
                      setSymbol(t.symbol);
                      setAmount("");
                    }}
                    className={`inline-flex h-10 items-center gap-2 rounded-full border pl-1.5 pr-3.5 text-[14px] transition-colors ${
                      t.symbol === token.symbol ? "border-foreground text-foreground" : "border-line text-soft hover:bg-surface"
                    }`}
                  >
                    <TokenMark src={t.logo} size={26} />
                    {t.symbol}
                  </button>
                ))}
              </div>
            )}

            <div>
              <label htmlFor="bridge-amount" className="text-[13px] text-mute">
                Amount
              </label>
              <div className="mt-1.5 flex h-12 items-center gap-2 rounded-xl border border-line px-3.5 focus-within:border-foreground/40">
                <input
                  id="bridge-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  className="tnum min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none! placeholder:text-faint"
                />
                {swapping && live?.quote?.send.usd != null && (
                  <span className="tnum shrink-0 text-[13px] text-mute">${fmtMoney(live.quote.send.usd)}</span>
                )}
                <TokenMark src={token.logo} size={20} />
                <span className="text-[14px] text-mute">{token.symbol}</span>
              </div>
              {swapping && gasCoin != null && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="tnum text-[12px] text-mute">
                    In your wallet: {trimAmount(formatUnits(gasCoin.value, token.decimals))} {token.symbol}
                  </span>
                  <div role="group" aria-label="Amount shortcuts" className="flex gap-1.5">
                    {[25, 50, 75, 100].map((pct) => {
                      const wei = pct === 100 ? maxWei : (gasCoin.value * BigInt(pct)) / BigInt(100);
                      const pick = wei > maxWei ? maxWei : wei;
                      return (
                        <button
                          key={pct}
                          type="button"
                          disabled={pick === BigInt(0)}
                          onClick={() => setAmount(trimAmount(formatUnits(pick, token.decimals)))}
                          className="h-9 rounded-full border border-line px-3 text-[12.5px] text-soft transition-colors hover:bg-surface hover:text-foreground disabled:opacity-40"
                        >
                          {pct === 100 ? "Max" : `${pct}%`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className={`mt-1.5 text-[12px] ${overBalance ? "text-danger" : "text-mute"}`}>
                {overBalance
                  ? `That's more ${token.symbol} than this wallet holds.`
                  : token.stable
                    ? `From ${BRIDGE_MIN_USD} to ${BRIDGE_MAX_USD.toLocaleString("en-US")} ${token.symbol}.`
                    : swapping
                      ? `Keep a little ${token.symbol} for network fees. It arrives as ${dest.token.symbol} in this wallet.`
                      : `Up to about $${BRIDGE_MAX_USD.toLocaleString("en-US")} worth. It arrives as ${dest.token.symbol}.`}
              </p>
            </div>

            {swapping && amountNum > 0 && !overBalance && (
              live?.error ? (
                <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-[13px] leading-relaxed text-danger">
                  {live.error}
                </p>
              ) : (
                <SwapPrice quote={live?.quote ?? null} from={token.symbol} to={dest.token.symbol} />
              )
            )}

            {chain.kind !== "evm" && (
              <div>
                <label htmlFor="bridge-refund" className="text-[13px] text-mute">
                  Your {refundName} address
                </label>
                <input
                  id="bridge-refund"
                  autoComplete="off"
                  spellCheck={false}
                  value={refundTo}
                  onChange={(e) => setRefundTo(e.target.value.trim())}
                  className="tnum mt-1.5 h-12 w-full rounded-xl border border-line bg-panel px-3.5 text-[14px] text-foreground outline-none focus:border-foreground/40"
                />
                <p className="mt-1.5 text-[12px] text-mute">If the transfer fails, the money goes back here.</p>
              </div>
            )}

            {stage.kind === "form" && stage.error && (
              <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-[13px] leading-relaxed text-danger">
                {stage.error}
              </p>
            )}

            <button
              type="submit"
              disabled={!amountOk || !refundOk || stage.kind === "loading"}
              className="btn btn-ink btn-lg btn-block"
            >
              {stage.kind === "loading"
                ? swapping
                  ? "Getting a price…"
                  : "Getting an address…"
                : swapping
                  ? "Review the swap"
                  : "Get a deposit address"}
            </button>
            <p className="text-center text-[12px] leading-relaxed text-mute">
              {swapping ? "Swapping is public, like any deposit." : "Bridging is public, like any deposit."} Powered by Relay.
            </p>
          </form>
        )}

        {!picking && stage.kind === "address" && stage.quote.tx && (
          <SwapReview
            quote={stage.quote}
            hash={send.data}
            pending={send.isPending}
            error={send.error}
            landed={receipt.isSuccess}
            waitFailed={receipt.isError}
            onSign={() => signSwap(stage.quote)}
            onArrived={onArrived}
            onReset={reset}
          />
        )}

        {!picking && stage.kind === "address" && !stage.quote.tx && (
          <div className="mt-5" aria-live="polite">
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] leading-relaxed text-foreground">
              Send exactly
              <TokenMark src={stage.quote.send.logo} size={18} />
              <span className="tnum font-medium">
                {stage.quote.send.amount} {stage.quote.send.symbol}
              </span>
              on
              <ChainLogo id={stage.quote.send.chainId} size={18} />
              {stage.quote.send.chain}
              {stage.quote.send.usd !== null && !stage.quote.send.symbol.startsWith("USD") && (
                <span className="tnum text-mute">(about ${stage.quote.send.usd.toFixed(2)})</span>
              )}
            </p>

            {stage.qr && (
              // eslint-disable-next-line @next/next/no-img-element -- a local data URL
              <img
                src={stage.qr}
                alt={`Deposit address on ${stage.quote.send.chain}`}
                width={200}
                height={200}
                className="mx-auto mt-4 aspect-square w-full max-w-[200px] rounded-2xl bg-white p-2"
              />
            )}

            <button
              type="button"
              onClick={() => void copy(stage.quote.depositAddress)}
              className="mt-4 flex w-full items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-left transition-colors hover:bg-surface"
            >
              <span className="tnum min-w-0 flex-1 break-all text-[13.5px] text-foreground">{stage.quote.depositAddress}</span>
              <span className="shrink-0 text-[13px] font-medium text-foreground">{copied ? "Copied" : "Copy"}</span>
            </button>

            <dl className="mt-4 divide-y divide-line text-[14px]">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <dt className="text-mute">You get about</dt>
                <dd className="tnum flex items-center gap-1.5 text-right text-foreground">
                  <TokenMark src={stage.quote.receive.logo} size={18} />
                  {Number(stage.quote.receive.amount).toFixed(2)} {stage.quote.receive.symbol}
                </dd>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3">
                <dt className="text-mute">At least</dt>
                <dd className="tnum text-right text-foreground">
                  {Number(stage.quote.receive.minimum).toFixed(2)} {stage.quote.receive.symbol}
                </dd>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3">
                <dt className="text-mute">Bridge fee</dt>
                <dd className="tnum text-right text-foreground">about ${stage.quote.feeUsd.toFixed(2)}</dd>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3">
                <dt className="text-mute">Arrives</dt>
                <dd className="text-right text-foreground">
                  {stage.quote.bitcoin
                    ? "After Bitcoin confirms, usually 10 to 30 min"
                    : stage.quote.timeSec > 0 && stage.quote.timeSec < 60
                      ? "In under a minute"
                      : `In about ${Math.max(1, Math.round(stage.quote.timeSec / 60))} min`}
                </dd>
              </div>
            </dl>

            <p className="mt-3 text-[12.5px] leading-relaxed text-mute">
              Send only {stage.quote.send.symbol} on {stage.quote.send.chain}, and use this address for this transfer
              only. Sending from an exchange works too.
            </p>

            <StatusLine status={status} quote={stage.quote} />

            {status?.stage === "done" ? (
              <button
                type="button"
                onClick={() => onArrived(Number(stage.quote.receive.amount).toFixed(2))}
                className="btn btn-ink btn-lg btn-block mt-4"
              >
                Add it privately
              </button>
            ) : (
              <button type="button" onClick={reset} className="btn btn-ghost btn-sm mt-4">
                Start over
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}

function StatusLine({ status, quote }: { status: BridgeStatus | null; quote: BridgeQuote }) {
  const stage = status?.stage ?? "waiting";
  const text =
    stage === "waiting"
      ? `Waiting for your ${quote.send.symbol}…`
      : stage === "moving"
        ? `Received. Sending it to ${quote.receive.chain}…`
        : stage === "done"
          ? `Arrived in your wallet on ${quote.receive.chain}.`
          : stage === "refunded"
            ? `Sent back to your ${quote.send.chain} address.`
            : `The transfer didn't go through. Relay returns the money to your ${quote.send.chain} address.`;
  const tone = stage === "done" ? "text-sealed" : stage === "failed" || stage === "refunded" ? "text-danger" : "text-foreground";
  return (
    <p className={`mt-4 flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3 text-[13.5px] ${tone}`}>
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${
          stage === "done" ? "bg-sealed" : stage === "failed" || stage === "refunded" ? "bg-danger" : "animate-pulse bg-foreground/50"
        }`}
      />
      {text}
    </p>
  );
}

/** At most six decimals, trailing zeros dropped, rounded down so Max never asks for more than is there. */
function trimAmount(text: string): string {
  const [whole, frac = ""] = text.split(".");
  const f = frac.slice(0, 6).replace(/0+$/, "");
  return f ? `${whole}.${f}` : whole!;
}

/** Two decimals, rounded down, so "Add it privately" never asks for more than arrived. */
function floor2(text: string): string {
  return (Math.floor(Number(text) * 100) / 100).toFixed(2);
}

function SwapReview({
  quote,
  hash,
  pending,
  error,
  landed,
  waitFailed,
  onSign,
  onArrived,
  onReset,
}: {
  quote: BridgeQuote;
  hash: Hex | undefined;
  pending: boolean;
  error: Error | null;
  landed: boolean;
  waitFailed: boolean;
  onSign: () => void;
  onArrived: (amount: string) => void;
  onReset: () => void;
}) {
  const cancelled = error && /reject|denied|cancel/i.test(error.message);
  const line = landed
    ? `Swapped. Your ${quote.receive.symbol} is in your wallet on ${quote.receive.chain}.`
    : waitFailed
      ? "Sent. It's taking a while to confirm; check your wallet's activity."
      : hash
        ? "Swapping…"
        : pending
          ? "Confirm the swap in your wallet…"
          : null;
  return (
    <div className="mt-5" aria-live="polite">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] leading-relaxed text-foreground">
        Swap
        <TokenMark src={quote.send.logo} size={18} />
        <span className="tnum font-medium">
          {quote.send.amount} {quote.send.symbol}
        </span>
        on
        <ChainLogo id={quote.send.chainId} size={18} />
        {quote.send.chain}
        {quote.send.usd !== null && <span className="tnum text-mute">(about ${quote.send.usd.toFixed(2)})</span>}
      </p>

      <dl className="mt-4 divide-y divide-line text-[14px]">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <dt className="text-mute">You get about</dt>
          <dd className="tnum flex items-center gap-1.5 text-right text-foreground">
            <TokenMark src={quote.receive.logo} size={18} />
            {Number(quote.receive.amount).toFixed(2)} {quote.receive.symbol}
          </dd>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <dt className="text-mute">Rate</dt>
          <dd className="tnum text-right text-foreground">{rateLine(quote)}</dd>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <dt className="text-mute">At least</dt>
          <dd className="tnum text-right text-foreground">
            {Number(quote.receive.minimum).toFixed(2)} {quote.receive.symbol}
          </dd>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <dt className="text-mute">Swap fee</dt>
          <dd className="tnum text-right text-foreground">
            {quote.feeUsd < 0.01 ? "Under a cent" : `about $${quote.feeUsd.toFixed(2)}`}
          </dd>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <dt className="text-mute">Network fee</dt>
          <dd className="text-right text-foreground">A few cents of {quote.send.symbol}</dd>
        </div>
      </dl>

      {line && (
        <p
          className={`mt-4 flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3 text-[13.5px] ${
            landed ? "text-sealed" : "text-foreground"
          }`}
        >
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${landed ? "bg-sealed" : "animate-pulse bg-foreground/50"}`}
          />
          {line}
        </p>
      )}

      {error && !hash && (
        <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-[13px] leading-relaxed text-danger">
          {cancelled ? "You cancelled it in your wallet. Nothing moved." : error.message.split("\n")[0]}
        </p>
      )}

      {landed ? (
        <button
          type="button"
          onClick={() => onArrived(floor2(quote.receive.minimum))}
          className="btn btn-ink btn-lg btn-block mt-4"
        >
          Add it privately
        </button>
      ) : (
        <>
          {!hash && (
            <button type="button" onClick={onSign} disabled={pending} className="btn btn-ink btn-lg btn-block mt-4">
              {pending ? "Waiting for your wallet…" : "Swap in your wallet"}
            </button>
          )}
          {!pending && !hash && (
            <button type="button" onClick={onReset} className="btn btn-ghost btn-sm mt-3">
              Start over
            </button>
          )}
        </>
      )}
      {!hash && (
        <p className="mt-3 text-[12px] leading-relaxed text-mute">
          Prices move. If a minute passes before you sign, start over for a fresh price.
        </p>
      )}
    </div>
  );
}

/** Dollars with cents and thousands separators. */
function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1 ETH = 2,504.83 USDG", from what a quote sends and returns. */
function rateLine(q: BridgeQuote): string {
  const rate = Number(q.receive.amount) / Number(q.send.amount);
  return Number.isFinite(rate) && rate > 0 ? `1 ${q.send.symbol} = ${fmtMoney(rate)} ${q.receive.symbol}` : "";
}

/** The live price under the swap amount: what arrives, the rate and the fees. */
function SwapPrice({ quote, from, to }: { quote: BridgeQuote | null; from: string; to: string }) {
  const wait = <span aria-hidden className="inline-block h-3.5 w-20 animate-pulse rounded bg-foreground/10" />;
  const rows: [string, React.ReactNode][] = [
    [
      "You get about",
      quote ? (
        <span className="flex items-center gap-1.5 font-medium">
          <TokenMark src={quote.receive.logo} size={16} />
          {fmtMoney(Number(quote.receive.amount))} {to}
        </span>
      ) : (
        wait
      ),
    ],
    ["Rate", quote ? rateLine(quote) : wait],
    ["At least", quote ? `${fmtMoney(Number(quote.receive.minimum))} ${to}` : wait],
    ["Swap fee", quote ? (quote.feeUsd < 0.01 ? "Under a cent" : `about $${fmtMoney(quote.feeUsd)}`) : wait],
    ["Network fee", `A few cents of ${from}`],
  ];
  return (
    <dl className="divide-y divide-line rounded-2xl bg-surface px-4 text-[13.5px]" aria-live="polite" aria-busy={!quote}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-h-10 items-center justify-between gap-3">
          <dt className="text-mute">{k}</dt>
          <dd className="tnum text-right text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
