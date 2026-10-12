"use client";

import { Analytics } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics (cookieless page views). Its script reports
 * location.href, which keeps the part after the #, and proof links
 * (/verify#proof=) and payment request links carry their details there. So
 * both the query string and the # part are cut before anything is sent: Vercel
 * gets the origin and path only.
 */
export function VercelAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: event.url.split(/[?#]/)[0]! })} />;
}
