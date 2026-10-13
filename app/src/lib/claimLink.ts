/**
 * Claim links: gloam.trade/claim?net=<network>#claim=<code>.
 *
 * The code rides in the URL fragment, which browsers never send to a server,
 * so link previews in chat apps and our own server never see it. The /claim
 * page shows the amount and sends the person into the app to claim. Older
 * links (/app/vault?tab=move#claim=...) still open the app directly.
 */
export function claimLinkFor(code: string, networkKey: string, origin = "https://www.gloam.trade"): string {
  return `${origin}/claim?net=${encodeURIComponent(networkKey)}#claim=${encodeURIComponent(code.trim())}`;
}

/** The in-app claim screen for a code, which the /claim page sends people to. */
export function appClaimPath(code: string, networkKey: string): string {
  return `/app/vault?tab=move&mode=receive&net=${encodeURIComponent(networkKey)}#claim=${encodeURIComponent(code.trim())}`;
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
