"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getConsent, setConsent, type ConsentValue } from "@/lib/consent";
import { readDemo } from "@/lib/demoFlag";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Stays out of the way while recording the demo.
    setVisible(getConsent() === null && !readDemo());
  }, []);

  const accept = (value: ConsentValue) => {
    setConsent(value);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-3 left-3 right-3 z-50 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[380px]"
    >
      <div className="rounded-[20px] border border-line bg-panel/95 p-5 shadow-pop backdrop-blur-xl">
        <p className="text-[14px] text-foreground">Cookies</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-mute">
          We set no ad or tracking cookies. Essential only keeps what the site
          needs to work and counts nothing. Accept all turns on anonymous
          counts with no cookies: page views, visits and app steps.
          See{" "}
          <Link href="/cookies" className="text-foreground underline underline-offset-2">
            Cookies
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-foreground underline underline-offset-2">
            Privacy
          </Link>
          .
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => accept("essential")}
            className="btn btn-ghost btn-sm flex-1"
          >
            Essential only
          </button>
          <button
            type="button"
            onClick={() => accept("all")}
            className="btn btn-ink btn-sm flex-1"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
