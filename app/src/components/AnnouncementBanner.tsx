"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppLink } from "./AppLink";
import { CountdownCompact, useMainnetLive, useMainnetRemaining } from "./MainnetCountdown";
import { MAINNET_LAUNCH_SHORT, MAINNET_PAGE, liveMainnetNames } from "@/lib/mainnet";

const KEY = "gloam:announce-dismissed:mainnet-v1";
// Its own key, so someone who closed the countdown still hears that mainnet is live.
const LIVE_KEY = "gloam:announce-dismissed:mainnet-live-v1";

// Keep the launch note on marketing + docs; stay out of the working app and the countdown page itself.
const HIDDEN_ON = ["/app", "/admin", "/verify", "/pitch", "/claim", MAINNET_PAGE];

/** Slim site-wide mainnet countdown, then the news that mainnet is live. Dismissible per browser. */
export function AnnouncementBanner() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState<{ countdown: boolean; live: boolean }>({ countdown: false, live: false });
  const remaining = useMainnetRemaining();
  const live = useMainnetLive();

  useEffect(() => {
    try {
      setDismissed({ countdown: localStorage.getItem(KEY) === "1", live: localStorage.getItem(LIVE_KEY) === "1" });
    } catch {
      /* storage unavailable */
    }
  }, []);

  if (live ? dismissed.live : dismissed.countdown) return null;
  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  const dismiss = () => {
    try {
      localStorage.setItem(live ? LIVE_KEY : KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed((d) => (live ? { ...d, live: true } : { ...d, countdown: true }));
  };

  return (
    <div className="relative z-[60] w-full border-b border-transparent bg-[#0b0c0e] text-white dark:border-line dark:bg-[#111214]">
      <div className="mx-auto flex max-w-[1400px] items-center justify-center gap-3 px-4 py-2 sm:px-7">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8fd3ad]" />
        <p className="min-w-0 truncate text-[13px] leading-tight">
          {live ? (
            <>
              <span className="font-medium">Gloam is live on mainnet.</span>{" "}
              <span className="text-white/60">Private payments with real money on {liveMainnetNames()}.</span>
            </>
          ) : remaining?.done ? (
            <span className="font-medium">Gloam mainnet is rolling out now.</span>
          ) : (
            <>
              <span className="font-medium">Mainnet goes live {MAINNET_LAUNCH_SHORT}.</span>{" "}
              {remaining && (
                <span className="text-white/60">
                  In <CountdownCompact />
                </span>
              )}
            </>
          )}
        </p>
        {live ? (
          <AppLink href="/app" className="shrink-0 text-[13px] font-medium text-[#8fd3ad] underline-offset-4 hover:underline">
            Open the app
          </AppLink>
        ) : (
          <Link
            href={MAINNET_PAGE}
            className="shrink-0 text-[13px] font-medium text-[#8fd3ad] underline-offset-4 hover:underline"
          >
            See the countdown
          </Link>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="absolute right-2 grid h-8 w-8 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white sm:right-4"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M2.5 2.5l7 7M9.5 2.5l-7 7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
