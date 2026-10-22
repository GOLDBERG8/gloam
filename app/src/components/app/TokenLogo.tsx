"use client";

import { useState } from "react";

/**
 * Ticker/token logo. Renders a real image from /brand/logos/<id>.png when one is
 * present, and otherwise a quiet monochrome monogram tile. The tile shade is
 * picked deterministically from the symbol (three steps of ink over the panel),
 * so each market keeps a stable identity in light and dark without colour.
 */
const TILE_SHADES = [
  "color-mix(in srgb, var(--ink) 7%, var(--panel))",
  "color-mix(in srgb, var(--ink) 12%, var(--panel))",
  "color-mix(in srgb, var(--ink) 18%, var(--panel))",
];

function tileShade(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TILE_SHADES[h % TILE_SHADES.length];
}

/**
 * Ids with a real brand mark shipped in /public/brand/logos as `<id>.png`.
 * Anything not in the set (or SPECIAL) falls back to a monogram, so no 404.
 */
const PNG_LOGO_IDS = new Set([
  // onchain-tradeable
  "tsla", "amzn", "pltr", "nflx", "amd",
  // watchlist (Aumo app-icon set + FMP)
  "hood", "aapl", "nvda", "msft", "googl", "meta", "coin",
  "goog", "avgo", "orcl", "crm", "adbe", "intc", "qcom", "mu", "ibm", "csco",
  "dis", "uber", "abnb", "shop", "pypl", "sbux", "nke", "mcd", "ko", "wmt",
  "cost", "jpm", "v", "ma", "mstr", "gme", "rblx", "rddt", "snap", "f",
  "rivn", "baba", "spot",
  // stablecoins
  "usdg", "usdce", "usdt0",
  // networks
  "robinhood",
  // gas coin
  "eth",
]);

/** Round marks (a full disc): shown as a circle with no plate, so no white corners. */
const DISC_LOGO_IDS = new Set(["usdg", "usdce", "eth", "avgo", "mstr", "sbux"]);

const SPECIAL_LOGOS: Record<string, string> = {
  tempo: "/brand/logos/tempo.svg",
  // Robinhood Chain's own app icon: a full tile, so no white plate shows
  robinhood: "/brand/chains/4663.png",
  ousd: "/brand/logos/ousd.svg",
  pathusd: "/brand/logos/pathusd.svg",
  alphausd: "/brand/logos/alphausd.svg",
  betausd: "/brand/logos/betausd.svg",
  thetausd: "/brand/logos/thetausd.svg",
  // $GLOAM: the Gloam mark
  gloam: "/brand/kit/gloam-avatar-ink.png",
};

/** The logo file for a token id, or undefined when it has none (a monogram shows instead). */
export function tokenLogoPath(id: string): string | undefined {
  return resolveLogo(id);
}

function resolveLogo(id: string): string | undefined {
  const key = id.toLowerCase();
  if (SPECIAL_LOGOS[key]) return SPECIAL_LOGOS[key];
  if (PNG_LOGO_IDS.has(key)) return `/brand/logos/${key}.png`;
  return undefined;
}

export function TokenLogo({
  id,
  symbol,
  size = 34,
  logoSrc,
  className = "",
}: {
  id: string;
  symbol: string;
  size?: number;
  /** Real logo path. When omitted, a monogram tile is shown (no 404 request). */
  logoSrc?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const ticker = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const label = ticker.slice(0, 4);
  const bg = tileShade(symbol || id);
  // Scale the ticker to fit the tile: shorter tickers read larger.
  const fontRatio =
    label.length <= 2 ? 0.38 : label.length === 3 ? 0.3 : 0.25;
  const src = logoSrc ?? resolveLogo(id);

  if (src && !broken && DISC_LOGO_IDS.has(id.toLowerCase())) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${symbol} logo`}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  if (src && !broken) {
    // Brand marks keep a white plate (some ship transparent with dark ink), the
    // one allowed literal colour: it is part of the logo, not the theme.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${symbol} logo`}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-[22%] border border-line bg-white object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-[22%] border border-line font-medium text-foreground ${className}`}
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: Math.round(size * fontRatio),
        letterSpacing: "-0.02em",
      }}
      title={symbol}
    >
      {label}
    </span>
  );
}
