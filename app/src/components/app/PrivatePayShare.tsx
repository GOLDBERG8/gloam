"use client";

import { useState } from "react";
import { privatePayShareText, xIntentUrl } from "@/lib/firstPayment";
import { track } from "@/lib/track";

const FILE_NAME = "gloam-paid-privately.png";

/**
 * The share step after a private payment: a post for X and an optional image.
 * Neither carries the amount, who was paid, or any address. On a phone the
 * image goes to the share sheet; elsewhere it is saved as a file.
 */
export function PrivatePayShare({
  chainId,
  networkLabel,
  testnet = true,
}: {
  chainId: number;
  networkLabel: string;
  /** A mainnet payment's post and image do not say testnet. */
  testnet?: boolean;
}) {
  const text = privatePayShareText(testnet);
  const [shareSheet] = useState(() => {
    if (typeof navigator === "undefined" || typeof window === "undefined") return false;
    try {
      const probe = new File([""], FILE_NAME, { type: "image/png" });
      return (
        typeof navigator.share === "function" &&
        Boolean(navigator.canShare?.({ files: [probe] })) &&
        window.matchMedia("(pointer: coarse)").matches
      );
    } catch {
      return false;
    }
  });
  const [image, setImage] = useState<"idle" | "working" | "done" | "error">("idle");

  async function onImage() {
    if (image === "working") return;
    setImage("working");
    try {
      const { renderPaidPrivatelyCard } = await import("@/lib/shareCard");
      const blob = await renderPaidPrivatelyCard({
        dark: document.documentElement.getAttribute("data-theme") === "dark",
        networkLabel,
        testnet,
      });
      const file = new File([blob], FILE_NAME, { type: "image/png" });
      if (shareSheet) {
        try {
          await navigator.share({ files: [file], text });
        } catch (e) {
          // Closing the sheet is not an error.
          if (e instanceof DOMException && e.name === "AbortError") {
            setImage("idle");
            return;
          }
          throw e;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = FILE_NAME;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      track("private_pay_share", { via: "image", chainId });
      setImage("done");
    } catch {
      setImage("error");
    }
  }

  return (
    <div>
      <p className="text-[14px] text-foreground">Share that you paid privately</p>
      <p className="mx-auto mt-1 max-w-[34ch] text-[13px] leading-relaxed text-mute">
        The post leaves out the amount, who you paid and your address.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-1">
        <a
          href={xIntentUrl(text)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("private_pay_share", { via: "x", chainId })}
          className="btn btn-quiet btn-sm"
        >
          <XMark />
          Post on X
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <button
          type="button"
          onClick={() => void onImage()}
          disabled={image === "working"}
          className="btn btn-quiet btn-sm"
        >
          <ImageIcon />
          {image === "working"
            ? "Making image…"
            : shareSheet
              ? "Share image"
              : image === "done"
                ? "Image saved"
                : "Save image"}
        </button>
      </div>
      <p aria-live="polite" className="mt-1 text-[12px] text-mute">
        {image === "error" ? "Could not make the image here. The post still works." : ""}
      </p>
    </div>
  );
}

function XMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.17h1.7L7.4 4.73H5.58l11.09 14.44Z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="5" width="17" height="14" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m4 16.5 4.6-4.4a1.5 1.5 0 0 1 2.1 0L15 16.5m-1.5-1.5 1.9-1.8a1.5 1.5 0 0 1 2.1 0L20 15.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
