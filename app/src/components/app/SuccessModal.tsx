"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { SealedField } from "@/components/ui/SealedField";

const noopSubscribe = () => () => {};

/**
 * Success dialog portaled to document.body so AppShell `.rise` transforms
 * cannot pin fixed positioning mid-page. A calm receipt: the sealed field glows
 * in the corner, one green check says it is done.
 */
export function SuccessModal({
  open,
  title,
  body,
  primaryHref,
  primaryLabel,
  secondaryLabel = "Done",
  footer,
  detail,
  hold,
  onClose,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  /** Optional extra step under the actions (e.g. sharing a private payment). */
  footer?: React.ReactNode;
  /** Full-width content between the message and the buttons (e.g. a claim code to save). */
  detail?: React.ReactNode;
  /** While set, the dialog cannot be closed and the close button shows this instead. */
  hold?: string | null;
  onClose: () => void;
}) {
  // nothing closes the dialog while something on it must be done first
  const close = useCallback(() => {
    if (!hold) onClose();
  }, [hold, onClose]);
  const reduce = useReducedMotion();
  // Portals need document.body, so render only on the client.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!open || !mounted) return null;

  const external =
    primaryHref?.startsWith("http") || primaryHref?.startsWith("https");

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-[16px] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="success-title"
    >
      <motion.button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-label="Close"
        onClick={close}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      />
      <motion.div
        className="relative z-[1] w-full max-w-[400px] overflow-hidden rounded-[24px] bg-panel shadow-pop"
        initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
      >
        <SealedField tone="soft" />
        <div className="relative max-h-[min(88dvh,680px)] overflow-y-auto overflow-x-hidden px-6 pb-6 pt-9 text-center sm:px-8 sm:pb-8">
          <motion.div
            className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-sealed-soft text-sealed"
            initial={reduce ? false : { scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              type: "spring",
              stiffness: 420,
              damping: 22,
              delay: 0.04,
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
              <motion.path
                d="M5 12.5l4.5 4.5L19 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduce ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{
                  duration: 0.45,
                  delay: 0.14,
                  ease: [0.22, 1, 0.36, 1],
                }}
              />
            </svg>
          </motion.div>

          <p className="t-label mt-6">Confirmed</p>
          <h2
            id="success-title"
            className="mt-2 text-balance text-[28px] font-light leading-[1.12] tracking-[-0.018em] text-foreground"
          >
            {title}
          </h2>
          <div className="mx-auto mt-3 max-w-[34ch] text-[14px] leading-relaxed text-mute">
            {body}
          </div>
          {detail && <div className="mt-5 text-left">{detail}</div>}

          <div className="mt-8 flex gap-2 max-sm:flex-col">
            {primaryHref &&
              primaryLabel &&
              (external ? (
                <a
                  href={primaryHref}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ink sm:flex-1"
                >
                  {primaryLabel}
                </a>
              ) : (
                <Link href={primaryHref} onClick={close} className="btn btn-ink sm:flex-1">
                  {primaryLabel}
                </Link>
              ))}
            <button type="button" onClick={close} disabled={Boolean(hold)} className="btn btn-ghost sm:flex-1">
              {hold ?? secondaryLabel}
            </button>
          </div>
          {footer && <div className="mt-6 border-t border-line pt-5">{footer}</div>}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
