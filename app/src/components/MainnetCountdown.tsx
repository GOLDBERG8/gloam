"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  MAINNET_CONFIGURED,
  MAINNET_LAUNCH_MS,
  MAINNET_LAUNCH_SHORT,
  MAINNET_PAGE,
  calendarUrl,
  compactRemaining,
  liveMainnetNames,
  remainingUntil,
  type Remaining,
} from "@/lib/mainnet";
import { AppLink } from "@/components/AppLink";

/** The time left to mainnet, ticking once a second. Null until mounted, so the server and the first render agree. */
export function useMainnetRemaining(): Remaining | null {
  const [r, setR] = useState<Remaining | null>(null);
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const next = remainingUntil(Date.now());
      setR(next);
      if (next.done) window.clearInterval(id); // nothing left to count
    };
    id = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(id);
  }, []);
  return r;
}

/**
 * Whether mainnet is live: the launch time has passed and a mainnet pool is
 * filled in (lib/mainnet.ts). False until mounted, and false after the launch
 * time for as long as no pool is in, so the countdown copy stays as it was.
 */
export function useMainnetLive(): boolean {
  const r = useMainnetRemaining();
  return Boolean(r?.done) && MAINNET_CONFIGURED;
}

/**
 * Copy that depends on whether mainnet is live, for server pages: `before`
 * until mainnet is live (and on the server, so the first render matches),
 * `live` from then on. Before a mainnet pool is filled in it is always `before`.
 */
export function MainnetCopy({ live, before }: { live: React.ReactNode; before: React.ReactNode }) {
  return <>{useMainnetLive() ? live : before}</>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The big countdown: days, hours, minutes, seconds. */
export function CountdownDigits({ onDone, onLive }: { onDone?: React.ReactNode; onLive?: React.ReactNode }) {
  const r = useMainnetRemaining();
  if (r?.done && MAINNET_CONFIGURED && onLive) return <>{onLive}</>;
  if (r?.done && onDone) return <>{onDone}</>;
  const units: [string, string][] = [
    ["Days", r ? pad(r.days) : "--"],
    ["Hours", r ? pad(r.hours) : "--"],
    ["Minutes", r ? pad(r.minutes) : "--"],
    ["Seconds", r ? pad(r.seconds) : "--"],
  ];
  const label = r ? `${r.days} days, ${r.hours} hours and ${r.minutes} minutes to mainnet` : "Countdown to mainnet";
  return (
    <div role="timer" aria-live="off" aria-label={label} className="grid grid-cols-4 gap-2 sm:gap-4">
      {units.map(([name, value]) => (
        <div key={name} className="gl-glass min-w-0 rounded-2xl px-2 pb-3 pt-4 text-center sm:px-4 sm:pb-5 sm:pt-6">
          <p aria-hidden className="tnum text-[clamp(40px,9vw,128px)] font-light leading-none tracking-[-0.04em]">
            {value}
          </p>
          <p aria-hidden className="t-label mt-3 sm:mt-4">
            {name}
          </p>
        </div>
      ))}
    </div>
  );
}

/** "1d 12h 5m" for inline use; empty until mounted. */
export function CountdownCompact() {
  const r = useMainnetRemaining();
  if (!r || r.done) return null;
  return <span className="tnum">{compactRemaining(r)}</span>;
}

/** The launch time in the viewer's own time zone, when it isn't UTC. */
export function LocalLaunchTime() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!zone || zone === "UTC" || zone === "Etc/UTC") return;
      const when = new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(MAINNET_LAUNCH_MS));
      setText(when);
    } catch {
      /* Intl unavailable: UTC alone is fine */
    }
  }, []);
  if (!text) return null;
  return <>Your time: {text}</>;
}

/* ---------- the parts of the page that flip to live ---------- */

/** The countdown page headline. */
export function MainnetHeadline() {
  const live = useMainnetLive();
  return (
    <h1 className="t-display-xl mt-5 max-w-[16ch]">
      {live ? "Gloam is live on mainnet" : "Gloam goes live on mainnet"}
    </h1>
  );
}

/** What replaces the digits once mainnet is live. */
export function MainnetLiveNote() {
  return (
    <div className="flex flex-col gap-3">
      <p className="t-display-l max-w-[22ch]">Private payments, with real money.</p>
      <p className="max-w-[46ch] text-[16px] leading-relaxed text-soft">Live on {liveMainnetNames()}.</p>
    </div>
  );
}

/** Calendar and X before launch; the app and X once live. */
export function MainnetHeroActions() {
  const live = useMainnetLive();
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      {live ? (
        <AppLink href="/app" className="btn btn-ink btn-lg">
          Open the app
        </AppLink>
      ) : (
        <a href={calendarUrl()} target="_blank" rel="noopener noreferrer" className="btn btn-ink btn-lg">
          Add to calendar
        </a>
      )}
      <a href="https://x.com/gloamtrade" target="_blank" rel="noopener noreferrer" className="btn btn-quiet btn-lg">
        Follow on X <span aria-hidden>→</span>
      </a>
    </div>
  );
}

/** The line about the testnet at the foot of the countdown page. */
export function MainnetTestnetLine() {
  const live = useMainnetLive();
  return (
    <p className="max-w-[46ch] text-[15px] leading-relaxed text-soft">
      {live
        ? "The testnet stays open with play money, for trying things first."
        : "Until then, everything works on testnet with play money."}
    </p>
  );
}

/** The homepage hero link: the launch time and countdown, then that mainnet is live. */
export function MainnetPill() {
  const live = useMainnetLive();
  return (
    <Link
      href={MAINNET_PAGE}
      className="gl-glass mb-6 inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] text-foreground transition-colors hover:bg-panel/70"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sealed" />
      {live ? (
        "Mainnet is live"
      ) : (
        <>
          Mainnet {MAINNET_LAUNCH_SHORT}
          <span className="text-mute">
            <CountdownCompact />
          </span>
        </>
      )}
      <span aria-hidden>→</span>
    </Link>
  );
}
