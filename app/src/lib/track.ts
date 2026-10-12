/**
 * Product analytics → POST /api/collect → traction store + /admin.
 *
 * Nothing is sent unless the visitor chose "Accept all" in the cookie banner:
 * no product events, no pageviews. "Essential only", or no choice yet, counts
 * nothing.
 */

import { analyticsAllowed } from "@/lib/consent";
import { readDemo } from "@/lib/demoFlag";

export type TrackPayload = {
  t: string;
  path?: string;
  ref?: string | null;
  meta?: Record<string, string | number | boolean | null>;
  ts?: number;
};

function send(body: TrackPayload) {
  if (typeof window === "undefined") return;
  try {
    const json = JSON.stringify(body);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/collect",
        new Blob([json], { type: "application/json" }),
      );
      return;
    }
    void fetch("/api/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
}

/** Product / funnel events, only after "Accept all" (anonymous, no cookies). */
export function track(
  event: string,
  meta?: TrackPayload["meta"],
  _opts?: { requireConsent?: boolean },
) {
  void _opts; // kept so older callers compile; every event needs consent now
  if (typeof window === "undefined") return;
  if (!analyticsAllowed()) return;
  // Recording demo: pretend activity never counts toward real traction.
  if (readDemo()) return;

  send({
    t: event,
    path: window.location.pathname,
    ref: document.referrer || null,
    meta: meta ?? undefined,
    ts: Date.now(),
  });
}

/** Marketing pageviews, only after "Accept all". */
export function trackPageview() {
  track("pageview", undefined, { requireConsent: true });
}
