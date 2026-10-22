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
 * The code for a URL, made only of characters every chat app keeps inside a
 * link. Its one dot ("gloam1.eyJ...") becomes a hyphen ("gloam1-eyJ..."):
 * Telegram ended an auto-link at the dot, and WhatsApp at the %2E that
 * replaced it, which cut shared links to "gloam1". codeFromHash and the code
 * reader (lib/notePackage) turn it back. Older links with "." or %2E still read.
 */
function linkSafe(code: string): string {
  return encodeURIComponent(code.trim().replace(CODE_DOT, "$1-")).replace(/\./g, "%2E");
}

/** A code's prefix and its separator: "gloam1." in a code, "gloam1-" in a link. */
const CODE_DOT = /^(gloam1e|gloam2t|gloam1)\./;
const LINK_DASH = /^(gloam1e|gloam2t|gloam1)-/;

/** The in-app claim screen for a code, which the /claim page sends people to. */
export function appClaimPath(code: string, networkKey: string): string {
  return `/app/vault?tab=move&mode=receive&net=${encodeURIComponent(networkKey)}#claim=${linkSafe(code)}`;
}

/** The code from a "#claim=" fragment, or null. */
export function codeFromHash(hash: string): string | null {
  if (!hash.startsWith("#claim=")) return null;
  try {
    const code = decodeURIComponent(hash.slice("#claim=".length)).trim().replace(LINK_DASH, "$1.");
    return code || null;
  } catch {
    return null;
  }
}
