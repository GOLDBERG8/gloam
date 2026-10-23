"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { track } from "@/lib/track";
import { PaymentNoteLine } from "./PaymentNote";

/**
 * What a claimed and secured payment can do next, shown in Pay right after the
 * claim. The first claim in this browser gets the full step (lib/afterClaim):
 * the amount, two main actions (send some privately, get paid privately) and
 * a smaller Swap and Cash out. Later claims get one compact line with the same
 * actions. Clicks count by event name only: no amount, token or address.
 */
export function AfterClaimNext({
  full,
  amountLabel,
  text,
  note,
  swapHref,
  onSend,
  onGetPaid,
  onCashOut,
}: {
  /** The first claim in this browser: the full step, not the compact line. */
  full: boolean;
  /** What was claimed, e.g. "1,250 USDG". */
  amountLabel: string;
  /** The compact line's sentence. */
  text: string;
  /** The payer's private note, if the payment carried one. */
  note?: string;
  /** Vault > Swap, or null where this network or token has no swap. */
  swapHref: string | null;
  onSend: () => void;
  onGetPaid: () => void;
  onCashOut: () => void;
}) {
  const ref = useRef<HTMLElement & HTMLDivElement>(null);

  // A claim link opens Pay scrolled down to the claim form, so bring the result
  // into view and move focus to it, once, when it appears.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, []);

  const send = () => {
    track("after_claim_send");
    onSend();
  };
  const getPaid = () => {
    track("after_claim_get_paid");
    onGetPaid();
  };
  const cashOut = () => {
    track("after_claim_cash_out");
    onCashOut();
  };

  if (!full) {
    return (
      <div
        ref={ref}
        tabIndex={-1}
        aria-live="polite"
        className="mt-5 flex scroll-mt-24 items-start gap-3 rounded-xl bg-sealed-soft px-4 py-3 text-[13.5px] leading-relaxed text-foreground outline-none"
      >
        <span className="mt-0.5 text-sealed" aria-hidden>
          <CheckIcon />
        </span>
        <span className="min-w-0">
          <span className="block">{text}</span>
          {note && <PaymentNoteLine note={note} label="Their note" className="mt-1 text-soft" />}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-4">
            <InlineAction onClick={send}>Send privately</InlineAction>
            <InlineAction onClick={getPaid}>Get paid privately</InlineAction>
            {swapHref && (
              <Link href={swapHref} onClick={() => track("after_claim_swap")} className={INLINE_ACTION}>
                Swap
              </Link>
            )}
            <InlineAction onClick={cashOut}>Cash out</InlineAction>
          </span>
        </span>
      </div>
    );
  }

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="after-claim-done"
      className="mt-5 scroll-mt-24 border-b border-line pb-7 outline-none"
    >
      <div className="rounded-[18px] bg-sealed-soft px-5 py-5 sm:px-6 sm:py-6">
        <p id="after-claim-done" className="flex items-center gap-2 text-[13.5px] font-medium text-sealed">
          <CheckIcon />
          Claimed and secured
        </p>
        <p className="tnum mt-3 text-[34px] font-light leading-none tracking-[-0.022em] text-foreground sm:text-[40px]">
          {amountLabel}
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-soft">
          This balance is private. Only you can see or spend it.
        </p>
        {note && <PaymentNoteLine note={note} label="Their note" className="mt-2 text-[13px] text-soft" />}
      </div>

      <h3 className="mt-7 text-[15px] font-medium text-foreground">What you can do now</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ActionTile
          onClick={send}
          icon={<ArrowIcon dir="out" />}
          title="Send some privately"
          hint="Pay anyone with a link or their Gloam address."
        />
        <ActionTile
          onClick={getPaid}
          icon={<ArrowIcon dir="in" />}
          title="Get paid privately"
          hint="Share your Gloam address or a request link, so people can pay you like this."
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {swapHref && (
          <Link href={swapHref} onClick={() => track("after_claim_swap")} className="btn btn-ghost btn-sm">
            Swap
          </Link>
        )}
        <button type="button" onClick={cashOut} className="btn btn-ghost btn-sm">
          Cash out
        </button>
      </div>

      <p className="mt-4 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
        <span className="mt-[3px] shrink-0 text-sealed" aria-hidden>
          <LockIcon />
        </span>
        Gloam never asks you to buy gas or share your seed phrase. Everything happens here on gloam.trade.
      </p>
    </section>
  );
}

const INLINE_ACTION =
  "inline-flex min-h-8 items-center rounded-sm text-[13px] font-medium text-foreground underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-foreground";

function InlineAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={INLINE_ACTION}>
      {children}
    </button>
  );
}

function ActionTile({
  onClick,
  icon,
  title,
  hint,
}: {
  onClick: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-3.5 rounded-[16px] border border-line bg-panel p-4 text-left transition-colors duration-200 hover:border-line-strong hover:bg-surface sm:flex-col sm:gap-0 sm:p-5"
    >
      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-foreground transition-colors duration-200 group-hover:bg-panel"
      >
        {icon}
      </span>
      <span className="min-w-0 sm:mt-4">
        <span className="block text-[15px] font-medium text-foreground">{title}</span>
        <span className="mt-1 block text-[13px] leading-relaxed text-mute">{hint}</span>
      </span>
    </button>
  );
}

function ArrowIcon({ dir }: { dir: "out" | "in" }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={dir === "out" ? "M7 17L17 7M9 7h8v8" : "M17 7L7 17M15 17H7V9"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
