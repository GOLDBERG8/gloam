"use client";

import { useSyncExternalStore } from "react";
import { Analytics } from "@vercel/analytics/next";
import { analyticsAllowed } from "@/lib/consent";

/**
 * Vercel Web Analytics (cookieless page views), loaded only after "Accept all".
 * Its script reports location.href, which keeps the part after the #, and proof
 * links (/verify#proof=), claim links and payment request links carry their
 * details there. So both the query string and the # part are cut before
 * anything is sent: Vercel gets the origin and path only.
 */
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("gloam-consent", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("gloam-consent", onChange);
  };
}

export function VercelAnalytics() {
  const enabled = useSyncExternalStore(subscribe, analyticsAllowed, () => false);
  if (!enabled) return null;
  return <Analytics beforeSend={(event) => ({ ...event, url: event.url.split(/[?#]/)[0]! })} />;
}
