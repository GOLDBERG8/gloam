"use client";

/**
 * Sidebar network switch. Lists every Gloam network and lets the user pick the
 * active one. Live networks are selectable; `planned` ones render disabled with
 * a "Soon" badge, so the multichain roadmap is visible and honest without
 * offering a chain that cannot take writes yet. It auto-enables a network the
 * moment `networks.ts` marks it live. Full width of its container: the sidebar
 * on desktop (where the list flies out to the right so the notes have room),
 * the sheet on mobile (where it drops down).
 */
import { useEffect, useRef, useState } from "react";
import { MAINNET_ENABLED, allNetworks, isNetworkWritable } from "@/lib/networks";
import { useNetwork } from "./NetworkProvider";
import { TokenLogo } from "./TokenLogo";

export function NetworkSelector() {
  const { network, setNetworkKey } = useNetwork();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nets = allNetworks();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Network: ${network.label}. Change network`}
        className={`flex h-[52px] w-full items-center gap-3 rounded-full pl-2 pr-4 text-left text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 ${
          open ? "bg-surface-2" : "bg-surface"
        }`}
      >
        <TokenLogo id={network.family} symbol={network.label} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium leading-tight">
            {network.label}
          </span>
          <span className="mt-0.5 block truncate text-[12px] leading-tight text-mute">
            {network.testnet ? (MAINNET_ENABLED ? "Testnet · test funds" : "Testnet") : "Mainnet · real money"}
          </span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className={`shrink-0 text-mute transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="m7 10 5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Select network"
          className="absolute left-0 right-0 top-full z-50 mt-2 rounded-[18px] border border-line bg-panel p-1.5 shadow-pop [.gl-sidebar_&]:left-full [.gl-sidebar_&]:right-auto [.gl-sidebar_&]:top-0 [.gl-sidebar_&]:ml-5 [.gl-sidebar_&]:mt-0 [.gl-sidebar_&]:w-[300px]"
        >
          <p className="t-label px-2.5 pb-1.5 pt-2">Network</p>
          {nets.map((n) => {
            const active = n.key === network.key;
            const writable = isNetworkWritable(n);
            return (
              <button
                key={n.key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={!writable}
                onClick={() => {
                  if (!writable) return;
                  setNetworkKey(n.key);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${
                  writable ? "hover:bg-surface" : "cursor-not-allowed opacity-60"
                } ${active ? "bg-surface" : ""}`}
              >
                <TokenLogo id={n.family} symbol={n.label} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-foreground">
                      {n.label}
                    </span>
                    {n.status === "planned" && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-mute">
                        Soon
                      </span>
                    )}
                    {/* Once a mainnet is listed, every row says which money it is. */}
                    {MAINNET_ENABLED &&
                      (n.testnet ? (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-mute">
                          Testnet
                        </span>
                      ) : (
                        <span className="rounded-full bg-sealed-soft px-2 py-0.5 text-[11px] font-medium text-sealed">
                          Mainnet
                        </span>
                      ))}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-mute">
                    {n.note}
                  </span>
                </span>
                {active && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                    className="mt-1.5 shrink-0 text-foreground"
                  >
                    <path
                      d="m5.5 12.5 4 4 9-9"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
