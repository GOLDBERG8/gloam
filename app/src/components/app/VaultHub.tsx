"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore } from "react";
import { ShieldView } from "./ShieldView";
import { TradeView } from "./TradeView";
import { SendView } from "./SendView";
import { MoveView } from "./MoveView";
import { useNetwork } from "./NetworkProvider";

/**
 * The Vault hub, one surface for every money move. A calm segmented track picks
 * the action and the active view gets the full width below it. The URL (?tab=)
 * drives which action shows, so links and the old /app/shield, /app/move and
 * /app/send redirects keep working.
 */
const TABS = [
  { id: "shield", label: "Add", hint: "Move money into your private balance" },
  { id: "move", label: "Pay", hint: "Send privately, receive, cash out" },
  {
    id: "trade",
    label: "Trade",
    hint: "Trade with the size kept private",
    stocksOnly: true,
  },
  {
    id: "send",
    label: "Public send",
    hint: "A regular transfer from your wallet",
    // Sends the chain's native coin. Tempo has none to send (no native value
    // transfers), so on Tempo payments go through Pay.
    robinhoodOnly: true,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

const noopSubscribe = () => () => {};

function PanelSkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" aria-busy="true">
      <div className="gl-card h-[420px] motion-safe:animate-pulse" />
      <div className="gl-card h-[220px] motion-safe:animate-pulse" />
    </div>
  );
}

export function VaultHub() {
  const router = useRouter();
  const sp = useSearchParams();
  const { network } = useNetwork();
  // The views read the saved network and wallet, which only exist in the
  // browser. Render them once hydrated so server and client HTML always match.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // Tokenized-stock trading only exists on Robinhood Chain testnet (the mainnet
  // pools take payments only), and native-coin sends only on Robinhood Chain,
  // so those tabs drop out elsewhere (same rule as Markets in the shell).
  const isTempo = hydrated && network.family === "tempo";
  const noStocks = hydrated && !network.stocks;
  const tabs = TABS.filter(
    (t) =>
      !("robinhoodOnly" in t && t.robinhoodOnly && isTempo) &&
      !("stocksOnly" in t && t.stocksOnly && noStocks)
  );

  const raw = sp.get("tab");
  const tab: TabId = (tabs.some((t) => t.id === raw) ? raw : "shield") as TabId;

  function select(id: TabId) {
    const params = new URLSearchParams(Array.from(sp.entries()));
    params.set("tab", id);
    params.delete("mode");
    router.replace(`/app/vault?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Vault actions"
        className="inline-flex max-w-full rounded-full bg-surface-2 p-1 max-sm:flex max-sm:w-full dark:bg-panel dark:ring-1 dark:ring-line"
      >
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              id={`vault-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="vault-panel"
              title={t.hint}
              onClick={() => select(t.id)}
              className={`h-10 whitespace-nowrap rounded-full px-[18px] text-[14px] transition-colors duration-200 max-sm:flex-auto max-sm:px-3 ${
                active
                  ? "bg-panel font-medium text-foreground shadow-card dark:bg-surface-2"
                  : "text-mute hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <Suspense fallback={<PanelSkeleton />}>
        <div
          id="vault-panel"
          role="tabpanel"
          aria-labelledby={`vault-tab-${tab}`}
          className="min-w-0"
        >
          {!hydrated ? (
            <PanelSkeleton />
          ) : (
            <>
              {tab === "shield" && <ShieldView />}
              {tab === "trade" && <TradeView />}
              {tab === "send" && <SendView />}
              {tab === "move" && <MoveView />}
            </>
          )}
        </div>
      </Suspense>
    </div>
  );
}
