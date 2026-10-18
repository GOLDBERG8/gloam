"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";
import { useReducedMotion } from "@/components/useReducedMotion";

/** The $GLOAM launch film, light or dark to match the site. Plays muted; controls unmute it. */
export function TokenFilm() {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const suffix = theme === "dark" ? "-dark" : "";
  const src = `/media/gloam-token${suffix}.mp4`;
  const ref = useRef<HTMLVideoElement>(null);

  // Reduced motion: never autoplay. The reader starts it from the controls.
  useEffect(() => {
    if (reduced) ref.current?.pause();
  }, [reduced, src]);

  return (
    <video
      ref={ref}
      key={src}
      className="block aspect-video w-full rounded-[14px] bg-panel"
      src={src}
      poster={`/media/gloam-token-poster${suffix}.jpg`}
      autoPlay={!reduced}
      muted
      loop
      playsInline
      controls
      preload="metadata"
      aria-label="The $GLOAM launch film"
    />
  );
}

/** The contract address with a copy button. Wraps instead of overflowing. */
export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy contract address ${address}`}
      className="group flex min-h-12 w-full min-w-0 items-center gap-3 rounded-xl border border-line bg-panel py-1.5 pl-4 pr-1.5 text-left text-[14px] text-foreground transition-colors hover:border-line-strong sm:text-[15px]"
    >
      <span className="tnum min-w-0 flex-1 py-1 leading-snug [overflow-wrap:anywhere]">{address}</span>
      <span
        className={`inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors ${
          copied ? "text-sealed" : "text-mute group-hover:bg-surface group-hover:text-foreground"
        }`}
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        )}
        <span aria-live="polite" className="max-sm:sr-only">
          {copied ? "Copied" : "Copy"}
        </span>
      </span>
    </button>
  );
}
