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
 * The code for a URL, made only of letters, digits and "=", the characters
 * every chat app keeps inside a link. Telegram ended an auto-link at the dot
 * in "gloam1.eyJ...", WhatsApp at the %2E that replaced it and then at a
 * hyphen, which cut shared links to "gloam1". So the dot after the prefix is
 * written "=", and in the body "-", "_" and "." are written "=1", "=2" and
 * "=3" (a code never has "=" of its own). codeFromLinkText reads it back, and
 * older links ("." , %2E or "-" after the prefix) still read.
 */
function linkSafe(code: string): string {
  const c = code.trim();
  const m = c.match(/^(gloam1e|gloam2t|gloam1)\.([A-Za-z0-9_\-.]+)$/);
  if (m) return `${m[1]}=${m[2]!.replace(/[-_.]/g, (ch) => LINK_ESCAPE[ch]!)}`;
  return encodeURIComponent(c).replace(/\./g, "%2E");
}

const LINK_ESCAPE: Record<string, string> = { "-": "=1", _: "=2", ".": "=3" };
const LINK_UNESCAPE: Record<string, string> = { "1": "-", "2": "_", "3": "." };

/**
 * A code as a link wrote it, back to the code: "gloam1=..." with its escapes,
 * or the older "gloam1-..." (a link written that way never escaped its body).
 * Anything else comes back as it was.
 */
export function codeFromLinkText(s: string): string {
  const eq = s.match(/^(gloam1e|gloam2t|gloam1)=(.*)$/s);
  if (eq) return `${eq[1]}.${eq[2]!.replace(/=([123])/g, (_, d: string) => LINK_UNESCAPE[d]!)}`;
  return s.replace(/^(gloam1e|gloam2t|gloam1)-/, "$1.");
}

/** The in-app claim screen for a code, which the /claim page sends people to. */
export function appClaimPath(code: string, networkKey: string): string {
  return `/app/vault?tab=move&mode=receive&net=${encodeURIComponent(networkKey)}#claim=${linkSafe(code)}`;
}

/** The code from a "#claim=" fragment, or null. */
export function codeFromHash(hash: string): string | null {
  if (!hash.startsWith("#claim=")) return null;
  try {
    const code = codeFromLinkText(decodeURIComponent(hash.slice("#claim=".length)).trim());
    return code || null;
  } catch {
    return null;
  }
}
