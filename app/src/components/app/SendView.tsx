"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { formatEther, isAddress } from "viem";
import { formatEth, shortAddress } from "@/lib/chain";
import {
  useAppAccount,
  useAppBalance,
  useAppSendTransaction,
  useAppTxReceipt,
} from "@/lib/demo";
import { useNetwork } from "./NetworkProvider";
import { safeParseEther } from "@/lib/amount";
import { maxNativeSend } from "@/lib/nativeSend";
import { getRhPublicClient } from "@/lib/rhClient";
import { amountTextError } from "@/lib/amountText";
import { useEthPrice } from "@/hooks/useLiveMarkets";
import { useTradingSettings } from "@/hooks/useTradingSettings";
import { formatUsd } from "@/lib/markets";
import { WalletMenu } from "./WalletMenu";
import { SuccessModal } from "./SuccessModal";

export function SendView() {
  const { address, isConnected, chainId, demo } = useAppAccount();
  const { network } = useNetwork();
  const onProduct = chainId === network.chainId;
  const { ethUsd } = useEthPrice();
  const { settings } = useTradingSettings();
  const { data: bal, refetch } = useAppBalance({
    address,
    chainId: network.chainId,
    enabled: Boolean(address),
  });

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sentAmount, setSentAmount] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [estimatingMax, setEstimatingMax] = useState(false);
  const maxVersion = useRef(0);
  useEffect(() => () => { ++maxVersion.current; }, [address, chainId, network.chainId, to]);

  async function fillMax() {
    if (!address || !onProduct || !bal) return;
    if (!isAddress(to)) {
      setFormError("Enter the recipient first so the network fee can be estimated.");
      return;
    }
    const version = ++maxVersion.current;
    setEstimatingMax(true);
    setFormError(null);
    try {
      const value = demo ? bal.value : await maxNativeSend(getRhPublicClient(), address, to);
      if (version === maxVersion.current) setAmount(formatEther(value));
    } catch (error) {
      if (version === maxVersion.current) {
        setFormError(error instanceof Error ? error.message : "Could not estimate Max. Try again.");
      }
    } finally {
      setEstimatingMax(false);
    }
  }

  const {
    sendTransaction,
    data: hash,
    isPending,
    error: sendError,
    reset,
  } = useAppSendTransaction();

  const { isLoading: confirming, isSuccess } = useAppTxReceipt({
    hash,
    chainId: network.chainId,
  });

  const handledHash = useRef<string | null>(null);

  useEffect(() => {
    if (!isSuccess || !hash) return;
    if (handledHash.current === hash) return;
    handledHash.current = hash;
    void refetch();
    if (settings.confirmSends) setShowSuccess(true);
  }, [isSuccess, hash, refetch, settings.confirmSends]);

  function validate(): string | null {
    if (!isConnected || !onProduct) {
      return network.testnet ? "Connect and switch to testnet." : `Connect and switch to ${network.label}.`;
    }
    if (!isAddress(to)) return "Enter a valid address.";
    const value = safeParseEther(amount || "0");
    if (value === null) return "Invalid amount.";
    if (value <= BigInt(0)) return "Amount must be greater than zero.";
    if (bal && value > bal.value) return network.testnet ? "Not enough testnet ETH." : "Not enough ETH.";
    return null;
  }

  function executeSend() {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    const value = safeParseEther(amount);
    if (value === null) {
      setFormError("Invalid amount.");
      return;
    }
    setFormError(null);
    setShowPreview(false);
    reset();
    setShowSuccess(false);
    handledHash.current = null;
    setSentAmount(amount);
    setSentTo(to);
    sendTransaction({
      to: to as `0x${string}`,
      value,
      chainId: network.chainId,
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);

    // Fast send: go straight to wallet (still needs one signature, non-custodial)
    if (settings.fastSend) {
      executeSend();
      return;
    }
    setShowPreview(true);
  }

  const balanceText = bal ? formatEth(bal.value, 6) : "0";
  const amtNum = Number(amount);
  // "1,25" or "-1" is refused out loud, never quietly turned into 125 or 1
  const amountProblem = amountTextError(amount, 18);
  const usdHint =
    ethUsd && Number.isFinite(amtNum) && amtNum > 0
      ? formatUsd(amtNum * ethUsd)
      : null;
  const validPreview = !validate() && isAddress(to) && amtNum > 0;

  const connectedOk = isConnected && onProduct;
  const busy = isPending || confirming || estimatingMax;

  // Tempo has no native coin to send (its nodes report a placeholder balance),
  // so money there is stablecoins, which move privately from Move.
  if (network.family === "tempo") {
    return (
      <div className="gl-card p-5 sm:p-7">
        <h2 className="t-title text-foreground">Send on Tempo</h2>
        <p className="mt-1 max-w-[56ch] text-[14px] leading-relaxed text-mute">
          Tempo has no native coin to send. Money on Tempo is stablecoins like OUSD:
          add them to your private balance and pay from Move, or send them from your
          wallet app.
        </p>
        <Link href="/app/vault?tab=move&mode=pay" className="btn btn-ink mt-5 inline-flex">
          Pay privately
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={onSubmit} className="gl-card min-w-0 p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="t-title text-foreground">Send from your wallet</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-mute">
                A regular transfer to any 0x address on {network.label}.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12px] text-mute">
              <EyeIcon />
              Public
            </span>
          </div>

          <div className="gl-inputcard mt-6 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <label htmlFor="send-amount" className="text-mute">
                You send
              </label>
              <button
                type="button"
                disabled={!isConnected || !onProduct || !bal || estimatingMax || busy}
                onClick={() => void fillMax()}
                title="Max leaves an estimated network-fee reserve."
                className="tnum -my-2 inline-flex min-h-10 items-center gap-1.5 text-mute transition-colors hover:text-foreground disabled:opacity-45"
              >
                Balance {isConnected && onProduct ? balanceText : "0"} ETH
                <span className="font-medium text-foreground">{estimatingMax ? "Estimating…" : "Max"}</span>
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <input
                id="send-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(e) => { ++maxVersion.current; setAmount(e.target.value); }}
                className="tnum min-w-0 flex-1 bg-transparent text-[40px] font-light leading-[1.15] tracking-[-0.02em] text-foreground outline-none! placeholder:text-faint sm:text-[46px]"
                aria-label="Amount to send"
              />
              <span className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-panel pl-1.5 pr-4 text-[15px] font-medium text-foreground shadow-card">
                <EthMark />
                ETH
              </span>
            </div>
            <p className={`tnum mt-1 min-h-5 text-[13px] ${amountProblem ? "text-danger" : "text-mute"}`} role={amountProblem ? "alert" : undefined}>
              {amountProblem ?? (usdHint ? `≈ ${usdHint}` : " ")}
            </p>
          </div>

          <div className="mt-5">
            <label htmlFor="send-to" className="text-[13px] text-mute">
              To
            </label>
            <input
              id="send-to"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              className="gl-input tnum mt-2"
            />
          </div>

          {validPreview && (
            <dl className="mt-5 divide-y divide-line rounded-[16px] border border-line px-4 text-[14px]">
              <div className="flex min-h-11 items-center justify-between gap-4 py-2">
                <dt className="text-mute">Sending</dt>
                <dd className="tnum text-right text-foreground">
                  {amount} ETH
                  {usdHint ? <span className="text-mute">, {usdHint}</span> : null}
                </dd>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-4 py-2">
                <dt className="text-mute">To</dt>
                <dd className="tnum text-foreground">{shortAddress(to, 6)}</dd>
              </div>
            </dl>
          )}

          <div className="mt-6">
            {!connectedOk ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-surface px-4 py-3">
                <p className="text-[14px] text-mute">
                  {!isConnected
                    ? "Connect a wallet to send."
                    : `Switch to ${network.label} to send.`}
                </p>
                <WalletMenu />
              </div>
            ) : (
              <button
                type="submit"
                disabled={busy}
                className="btn btn-ink btn-lg btn-block"
              >
                {busy && <Spinner />}
                {isPending
                  ? "Confirm in wallet…"
                  : confirming
                    ? "Sending…"
                    : settings.fastSend
                      ? "Send now"
                      : "Review and send"}
              </button>
            )}
          </div>

          {(formError || sendError) && (
            <p
              role="alert"
              className="mt-4 break-words rounded-xl bg-danger-soft px-4 py-3 text-[13.5px] leading-relaxed text-danger"
            >
              {formError || sendError?.message.slice(0, 160)}
            </p>
          )}
          {hash && !isSuccess && (
            <p className="mt-4 flex items-center justify-center gap-2 text-[13.5px] text-mute">
              Submitted.
              <a
                href={network.explorerTx(hash)}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                View transaction
              </a>
            </p>
          )}
        </form>

        <aside className="space-y-4">
          <div className="gl-card p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-mute">What the explorer shows</p>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-mute">
                <EyeIcon />
                Everything
              </span>
            </div>
            <dl className="mt-3 divide-y divide-line text-[14px]">
              <div className="flex h-11 items-center justify-between gap-3">
                <dt className="text-mute">From</dt>
                <dd className="tnum truncate text-foreground">
                  {address ? shortAddress(address, 4) : "Your wallet"}
                </dd>
              </div>
              <div className="flex h-11 items-center justify-between gap-3">
                <dt className="text-mute">To</dt>
                <dd className="tnum truncate text-foreground">
                  {isAddress(to) ? shortAddress(to, 4) : "Their wallet"}
                </dd>
              </div>
              <div className="flex h-11 items-center justify-between gap-3">
                <dt className="text-mute">Amount</dt>
                <dd className="tnum truncate text-foreground">
                  {amtNum > 0 ? `${amount} ETH` : "The full amount"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[12.5px] leading-relaxed text-mute">
              A public send is a normal transfer. Anyone can see who sent what to
              whom.
            </p>
          </div>

          <div className="gl-card p-5">
            <p className="text-[15px] text-foreground">Want it private?</p>
            <p className="mt-1 text-[13px] leading-relaxed text-mute">
              Pay from your private balance and the amount and the person you pay
              stay off the public record.
            </p>
            <Link href="/app/vault?tab=move" className="btn btn-ghost btn-sm mt-4">
              Pay privately
            </Link>
          </div>
        </aside>
      </div>

      {showPreview &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-[16px] sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-review-title"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              aria-label="Close"
              onClick={() => setShowPreview(false)}
            />
            <div className="relative z-[1] max-h-[min(90dvh,640px)] w-full max-w-[400px] overflow-y-auto rounded-[24px] bg-panel p-6 shadow-pop sm:p-8">
              <p className="t-label">Review</p>
              <h2
                id="send-review-title"
                className="mt-2 text-[28px] font-light leading-[1.12] tracking-[-0.018em] text-foreground"
              >
                Confirm send
              </h2>
              <dl className="mt-6 divide-y divide-line border-y border-line text-[14px]">
                <div className="flex min-h-12 items-center justify-between gap-4 py-2">
                  <dt className="text-mute">Amount</dt>
                  <dd className="tnum text-right text-foreground">
                    {amount} ETH
                    {usdHint ? <span className="ml-1 text-mute">({usdHint})</span> : null}
                  </dd>
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 py-2">
                  <dt className="text-mute">To</dt>
                  <dd className="tnum text-foreground">{shortAddress(to, 6)}</dd>
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 py-2">
                  <dt className="text-mute">Network</dt>
                  <dd className="text-foreground">{network.label}</dd>
                </div>
              </dl>
              <p className="mt-4 text-[12.5px] leading-relaxed text-mute">
                This is a public transfer. The amount and both addresses show on
                the explorer.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={executeSend}
                  className="btn btn-ink btn-lg btn-block"
                >
                  Confirm in wallet
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreview(false)}
                  className="btn btn-quiet btn-block"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <SuccessModal
        open={showSuccess && Boolean(hash)}
        title="Sent"
        body={
          <>
            <p>
              <span className="tnum font-medium text-foreground">
                {sentAmount || "0"} ETH
              </span>{" "}
              to{" "}
              <span className="tnum text-foreground">
                {sentTo ? shortAddress(sentTo, 5) : ""}
              </span>
            </p>
            <p className="mt-2">{network.testnet ? "Settled on testnet." : `Settled on ${network.label}.`}</p>
          </>
        }
        primaryHref={hash ? network.explorerTx(hash) : undefined}
        primaryLabel="View on explorer"
        secondaryLabel="Send more"
        onClose={() => {
          setShowSuccess(false);
          setAmount("");
        }}
      />
    </>
  );
}

function Spinner() {
  return (
    <span
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80 motion-reduce:animate-none"
      aria-hidden
    />
  );
}

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** The ETH mark, monochrome on an ink squircle (flips in dark mode). */
function EthMark({ size = 30 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-[30%] bg-ink text-on-ink"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <path d="M12 2.5l6 9.75-6 3.5-6-3.5 6-9.75z" fill="currentColor" />
        <path d="M6 13.6l6 3.5 6-3.5-6 8.4-6-8.4z" fill="currentColor" opacity="0.7" />
      </svg>
    </span>
  );
}
