"use client";

import { useEffect, useState } from "react";
import { MAINNET_LAUNCH_MS, compactRemaining, remainingUntil, type Remaining } from "@/lib/mainnet";

/** The time left to mainnet, ticking once a second. Null until mounted, so the server and the first render agree. */
export function useMainnetRemaining(): Remaining | null {
  const [r, setR] = useState<Remaining | null>(null);
  useEffect(() => {
    const tick = () => setR(remainingUntil(Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return r;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The big countdown: days, hours, minutes, seconds. */
export function CountdownDigits({ onDone }: { onDone?: React.ReactNode }) {
  const r = useMainnetRemaining();
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
