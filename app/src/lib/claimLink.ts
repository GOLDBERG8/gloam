/**
 * Claim links: gloam.trade/claim?net=<network>#claim=<code>.
 *
 * The code rides in the URL fragment, which browsers never send to a server,
 * so link previews in chat apps and our own server never see it. The /claim
 * page shows the amount and sends the person into the app to claim. Older
 * links (/app/vault?tab=move#claim=...) still open the app directly.
 */
export function claimLinkFor(code: string, networkKey: string, origin = "https://www.gloam.trade"): string {
  return `${origin}/claim?net=${encodeURIComponent(networkKey)}#claim=${linkSafe(code)}`;
}

/**
 * The code for a URL. Its dot ("gloam1.eyJ...") is written as %2E: chat apps
 * like Telegram end an auto-link at a dot followed by more text, which cut every
 * shared link to "gloam1". decodeURIComponent turns it back into a dot.
 */
function linkSafe(code: string): string {
  return encodeURIComponent(code.trim()).replace(/\./g, "%2E");
}

/** The in-app claim screen for a code, which the /claim page sends people to. */
export function appClaimPath(code: string, networkKey: string): string {
  return `/app/vault?tab=move&mode=receive&net=${encodeURIComponent(networkKey)}#claim=${linkSafe(code)}`;
}

/** The code from a "#claim=" fragment, or null. */
export function codeFromHash(hash: string): string | null {
  if (!hash.startsWith("#claim=")) return null;
  try {
    const code = decodeURIComponent(hash.slice("#claim=".length)).trim();
    return code || null;
  } catch {
    return null;
  }
}
