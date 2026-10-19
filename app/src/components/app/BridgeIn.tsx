"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  BRIDGE_DESTINATIONS,
  BRIDGE_MAX,
  BRIDGE_MIN,
  BRIDGE_SOURCES,
  bridgeSource,
  type BridgeQuote,
  type BridgeStatus,
} from "@/lib/bridge";
import { useNetwork } from "./NetworkProvider";

const noopSubscribe = () => () => {};

/** Solana needs a Relay API key on the server, so it stays off until that is set. */
const SOURCES = BRIDGE_SOURCES.filter((s) => !s.needsKey || process.env.NEXT_PUBLIC_BRIDGE_SOLANA === "1");

type Stage =
  | { kind: "form"; error: string | null }
  | { kind: "loading" }
  | { kind: "address"; quote: BridgeQuote; qr: string | null };

/**
 * "Money on another chain?" on the add-money screen: opens the bridge panel.
 * `onArrived` gets the delivered amount so the screen can fill it in.
 */
export function BridgeInCard({ recipient, onArrived }: { recipient?: string; onArrived?: (amount: string) => void }) {
  const { network } = useNetwork();
  const dest = BRIDGE_DESTINATIONS[network.key];
  const [open, setOpen] = useState(false);

  return (
    <div className="gl-card p-5">
      <p className="text-[13px] text-mute">Money on another chain?</p>
      <p className="mt-2 text-[14px] leading-relaxed text-foreground">
        Bring USDC or USDT over from Base, Ethereum, Tron and more, or straight from an exchange.
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-mute">
        It lands in your wallet on {dest.chain} as {dest.token.symbol}. Then you add it here privately.
      </p>
      <button
        type="button"
        disabled={!recipient}
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-sm mt-4"
      >
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

function BridgeSheet({
  open,
  recipient,
  onClose,
  onArrived,
}: {
  open: boolean;
  recipient: string;
  onClose: () => void;
  onArrived: (amount: string) => void;
}) {
  const { network } = useNetwork();
  const dest = BRIDGE_DESTINATIONS[network.key];
  const reduce = useReducedMotion();
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [sourceKey, setSourceKey] = useState(SOURCES[0]!.key);
  const [amount, setAmount] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "form", error: null });
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const source = bridgeSource(sourceKey) ?? SOURCES[0]!;

  const reset = useCallback(() => {
    setStage({ kind: "form", error: null });
    setStatus(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Follow the transfer while the address is on screen and it isn't finished.
  const requestId = stage.kind === "address" ? stage.quote.requestId : null;
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

  async function getAddress(e: React.FormEvent) {
    e.preventDefault();
    setStage({ kind: "loading" });
    setStatus(null);
    try {
      const res = await fetch("/api/bridge/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: source.key, network: network.key, amount, recipient, refundTo }),
      });
      const json = (await res.json()) as { ok: boolean; data?: BridgeQuote; error?: { message: string } };
      if (!json.ok || !json.data) {
        setStage({ kind: "form", error: json.error?.message ?? "Something went wrong. Try again." });
        return;
      }
      const quote = json.data;
      setStage({ kind: "address", quote, qr: null });
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

  if (!open || !mounted) return null;

  const amountNum = Number(amount);
  const amountOk = amountNum >= BRIDGE_MIN && amountNum <= BRIDGE_MAX;
  const refundOk = source.kind === "evm" || refundTo.trim().length > 20;

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
              Bring money over
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-mute">
              From another chain or an exchange, into your wallet on {dest.chain}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-mute transition-colors hover:bg-surface hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {network.chain.testnet && (
          <p className="mt-4 rounded-2xl bg-surface px-4 py-3 text-[12.5px] leading-relaxed text-soft">
            Preview. This moves real money to {dest.chain} mainnet. The private balance there opens when Gloam goes to
            mainnet.
          </p>
        )}

        {stage.kind !== "address" && (
          <form onSubmit={getAddress} className="mt-5 grid gap-4">
            <div>
              <label htmlFor="bridge-source" className="text-[13px] text-mute">
                From
              </label>
              <select
                id="bridge-source"
                value={sourceKey}
                onChange={(e) => {
                  setSourceKey(e.target.value);
                  setRefundTo("");
                }}
                className="mt-1.5 h-12 w-full rounded-xl border border-line bg-panel px-3.5 text-[15px] text-foreground outline-none focus:border-foreground/40"
              >
                {SOURCES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.token.symbol} on {s.chain}
                  </option>
                ))}
              </select>
            </div>

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
                <span className="text-[14px] text-mute">{source.token.symbol}</span>
              </div>
              <p className="mt-1.5 text-[12px] text-mute">
                From {BRIDGE_MIN} to {BRIDGE_MAX.toLocaleString("en-US")} {source.token.symbol}.
              </p>
            </div>

            {source.kind !== "evm" && (
              <div>
                <label htmlFor="bridge-refund" className="text-[13px] text-mute">
                  Your {source.chain} address
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
              {stage.kind === "loading" ? "Getting an address…" : "Get a deposit address"}
            </button>
            <p className="text-center text-[12px] leading-relaxed text-mute">
              Bridging is public, like any deposit. Powered by Relay.
            </p>
          </form>
        )}

        {stage.kind === "address" && (
          <div className="mt-5" aria-live="polite">
            <p className="text-[14px] leading-relaxed text-foreground">
              Send exactly{" "}
              <span className="tnum font-medium">
                {stage.quote.send.amount} {stage.quote.send.symbol}
              </span>{" "}
              on {stage.quote.send.chain} to this address.
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
                <dd className="tnum text-right text-foreground">
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
                  {stage.quote.timeSec > 0 && stage.quote.timeSec < 60
                    ? "In under a minute"
                    : `In about ${Math.max(1, Math.round(stage.quote.timeSec / 60))} min`}{" "}
                  on {stage.quote.receive.chain}
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
