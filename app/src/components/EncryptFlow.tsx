import type { ReactNode } from "react";
import { SealedField } from "@/components/ui/SealedField";

/**
 * The Gloam loop as three zones: a public wallet, the private vault, and a
 * public exit. The boundary is the point, so the middle zone is the only one
 * that carries the sealed signal. Labels stay exact text, never an image.
 */
type Stage = { id: string; label: string; sub: string; detail: string };

const enter: Stage = {
  id: "clear",
  label: "Your wallet",
  sub: "Open balance",
  detail: "A normal wallet. Anyone who knows the address can see what it holds.",
};

const inside: Stage[] = [
  {
    id: "encrypt",
    label: "Shield",
    sub: "Enter the vault",
    detail:
      "You deposit into the Gloam vault. A fingerprint of the deposit is written on-chain; the secret stays in your browser.",
  },
  {
    id: "note",
    label: "Vault note",
    sub: "Private claim",
    detail: "Your browser holds the secret that proves the deposit is yours. Export a backup.",
  },
  {
    id: "move",
    label: "Private rails",
    sub: "Send, swap",
    detail:
      "Private sends settle inside the vault, amount sealed. A private swap trades on a public DEX and lands back in the vault: who swapped stays private, the amounts show.",
  },
];

const exit: Stage = {
  id: "read",
  label: "Cash out",
  sub: "Public exit",
  detail:
    "You prove ownership and the money returns to a wallet. The exit publishes the amount on purpose.",
};

function Row({ s }: { s: Stage }) {
  return (
    <div className="grid gap-1 px-4 py-4 sm:grid-cols-[168px_minmax(0,1fr)] sm:gap-6 sm:px-5">
      <span className="block">
        <span className="block text-[15.5px] leading-snug tracking-[-0.01em] text-foreground">
          {s.label}
        </span>
        <span className="mt-0.5 block text-[12.5px] text-mute">{s.sub}</span>
      </span>
      <span className="block text-[14px] leading-[1.55] text-mute">{s.detail}</span>
    </div>
  );
}

function Zone({
  label,
  sealed = false,
  children,
}: {
  label: string;
  sealed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="gl-tile relative isolate overflow-hidden">
      {sealed && <SealedField tone="soft" />}
      <span className="relative flex items-center gap-2 px-4 pt-4 sm:px-5">
        {sealed && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sealed" />}
        <span className={`t-label ${sealed ? "text-sealed" : ""}`}>{label}</span>
      </span>
      <div className="relative divide-y divide-line">{children}</div>
    </div>
  );
}

function Join() {
  return (
    <span aria-hidden className="flex justify-center py-1.5 text-faint">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 5v14m0 0l-5-5m5 5l5-5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function EncryptFlow() {
  return (
    <figure
      className="my-10 rounded-[22px] border border-line p-2 sm:p-2.5"
      aria-label="Flow from an open wallet, through the private vault, to a public cash out"
    >
      <figcaption className="flex flex-col gap-1 px-3 pb-3.5 pt-3 sm:px-3.5">
        <span className="t-label">How Gloam works</span>
        <span className="text-[13.5px] leading-snug text-mute">
          Wallet, shield, vault note, private send or trade, then cash out only
          when you choose.
        </span>
      </figcaption>
      <Zone label="Public">
        <Row s={enter} />
      </Zone>
      <Join />
      <Zone label="Private, inside the vault" sealed>
        {inside.map((s) => (
          <Row key={s.id} s={s} />
        ))}
      </Zone>
      <Join />
      <Zone label="Public">
        <Row s={exit} />
      </Zone>
    </figure>
  );
}
