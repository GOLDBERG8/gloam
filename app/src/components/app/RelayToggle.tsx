"use client";

import { useNetwork } from "./NetworkProvider";

/** "Hide my wallet" switch for relayed submission. */
export function RelayToggle({
  available,
  on,
  onChange,
  compact = false,
}: {
  available: boolean;
  on: boolean;
  onChange: (v: boolean) => void;
  compact?: boolean;
}) {
  const { network } = useNetwork();
  if (!available) {
    return (
      <p
        className={`text-[12.5px] leading-relaxed text-mute ${
          compact ? "" : "text-center"
        }`}
      >
        Your wallet will show as the sender. The relay that hides it is offline
        right now.
      </p>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="group flex w-full items-center gap-4 rounded-[14px] bg-surface px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-foreground">
          Hide my wallet
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-mute">
          {on
            ? `Gloam sends it for you, so your wallet never shows up next to it.${network.testnet ? " Free on testnet." : ""}`
            : "Off. Your wallet will show as the sender of each payment."}
        </span>
      </span>
      <span
        aria-hidden
        className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 ${
          on ? "bg-sealed" : "bg-line-strong"
        }`}
      >
        <span
          className={`absolute left-0.5 h-5 w-5 rounded-full bg-panel shadow-sm transition-transform duration-200 motion-reduce:transition-none dark:bg-foreground ${
            on ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}
