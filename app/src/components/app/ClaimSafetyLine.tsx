/**
 * The quiet line beside a Claim button (the /claim page and Pay > Receive):
 * what claiming never asks for, said before anyone taps. `free` when the
 * Gloam relay is up, because then the relay pays the network fee; without it
 * the wallet pays that fee itself, so the line says so instead of "free".
 */
export function ClaimSafetyLine({
  free,
  centered = false,
  className = "",
}: {
  free: boolean;
  /** Centred under the button, as on the /claim page; otherwise the app's lock line. */
  centered?: boolean;
  className?: string;
}) {
  const text = free
    ? "Free to claim. No gas, no seed phrase, nothing to buy. Only on gloam.trade."
    : "No seed phrase, nothing to buy. Your wallet pays only the network fee. Only on gloam.trade.";
  if (centered) {
    return (
      <p className={`text-center text-[12.5px] leading-relaxed text-soft ${className}`}>
        <span className="mr-1.5 inline-block align-[-1px] text-sealed" aria-hidden>
          <LockGlyph />
        </span>
        {text}
      </p>
    );
  }
  return (
    <p className={`flex items-start gap-2 text-[12.5px] leading-relaxed text-mute ${className}`}>
      <span className="mt-[3px] shrink-0 text-sealed" aria-hidden>
        <LockGlyph />
      </span>
      {text}
    </p>
  );
}

function LockGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
