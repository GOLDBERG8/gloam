"use client";

import { useEffect, useMemo, useState } from "react";
import { shortAddress } from "@/lib/chain";
import { useNetwork } from "./NetworkProvider";
import { vaultEnvDiagnostics } from "@/lib/config";
import { HASH_SCHEME, isShieldDeployed } from "@/lib/shield";
import { readVaultSealedReadiness } from "@/lib/vaultStatus";
import { useShieldTree } from "@/hooks/useShieldTree";
import { StatusPill } from "./StatusPill";

export function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Always-on vault status, dedicated RH RPC, no wallet required.
 */
export function VaultHealth({ compact = false }: { compact?: boolean }) {
  const { network } = useNetwork();
  const { leafCount, loading: treeLoading, refresh, error: treeError } =
    useShieldTree();
  const [sealed, setSealed] = useState<"checking" | "ready" | "off">("checking");
  const env = useMemo(() => vaultEnvDiagnostics(), []);
  // A mainnet vault is for payments only (no private trade there), so its
  // status never hangs on the private-trade verifier.
  const paymentsOnly = !network.testnet;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isShieldDeployed()) {
        if (!cancelled) setSealed("off");
        return;
      }
      const r = await readVaultSealedReadiness();
      if (!cancelled) setSealed(r.status === "ready" ? "ready" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isShieldDeployed()) return null;

  const recheck = () => {
    void (async () => {
      const r = await readVaultSealedReadiness();
      setSealed(r.status === "ready" ? "ready" : "off");
      await refresh();
    })();
  };

  const syncText = treeLoading
    ? "Syncing…"
    : treeError
      ? "Could not sync"
      : `${leafCount.toLocaleString()} private ${leafCount === 1 ? "balance" : "balances"}`;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-mute">
        <span className="tnum">
          Private vault
          {network.pool ? ` ${shortAddress(network.pool, 4)}` : ""}
          <span className="text-faint"> · </span>
          {syncText}
        </span>
        <span className="flex items-center gap-1">
          <StatusPill tone={paymentsOnly || sealed === "ready" ? "lime" : "mute"} dot>
            {paymentsOnly ? "Payments" : sealed === "ready" ? "Private trade on" : "Vault"}
          </StatusPill>
          <button
            type="button"
            onClick={recheck}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-mute transition-colors hover:bg-surface hover:text-foreground"
          >
            <RefreshIcon />
            Refresh
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] bg-surface p-4 text-[14px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] text-foreground">Private vault</p>
          <p className="tnum mt-1 text-[13px] text-mute">
            {network.pool ? shortAddress(network.pool, 6) : "Not set up"}
            {HASH_SCHEME !== "poseidon" ? ` · ${HASH_SCHEME}` : ""}
            <span className="text-faint"> · </span>
            {syncText}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <StatusPill tone={paymentsOnly || sealed === "ready" ? "lime" : sealed === "checking" ? "mute" : "warn"} dot>
            {paymentsOnly ? "Ready" : sealed === "ready" ? "Ready" : sealed === "checking" ? "Checking" : "Limited"}
          </StatusPill>
          <button
            type="button"
            onClick={recheck}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-mute transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <RefreshIcon />
            Refresh
          </button>
        </div>
      </div>
      <p className="mt-3 max-w-[64ch] text-[13px] leading-relaxed text-mute">
        {paymentsOnly ? (
          <>
            Money stays private while it stays in the vault. Adding to it and
            sending from it keep amounts hidden. Cashing out shows the amount.
          </>
        ) : (
          <>
            Money stays private while it stays in the vault. Adding, sending and
            trading from it keep amounts hidden. Cashing out shows the amount.
          </>
        )}
      </p>
      {network.pool && (
        <p className="tnum mt-3 break-all border-t border-line pt-3 text-[12px] leading-relaxed text-faint">
          {network.pool}
          {" · block "}
          {/* the env block is Robinhood Chain testnet's; a mainnet carries its own */}
          {(paymentsOnly && network.deployBlock !== null ? network.deployBlock : env.deployBlock).toString()}
          {env.remappedFromLegacy || env.deployBlockRemapped
            ? " · remapped from legacy env"
            : ""}
          {" · "}
          <a
            href={network.explorerAddress(network.pool)}
            target="_blank"
            rel="noreferrer"
            className="text-mute underline decoration-line-strong underline-offset-2 transition-colors hover:text-foreground"
          >
            Explorer
          </a>
        </p>
      )}
      {(env.remappedFromLegacy || env.deployBlockRemapped) && (
        <p className="mt-2 rounded-[10px] bg-warn-soft px-3 py-2 text-[12px] leading-relaxed text-warn">
          Vercel still has older env values. The app remaps to the current vault{" "}
          {shortAddress(env.productPool, 4)}. Clean{" "}
          <span className="font-medium">NEXT_PUBLIC_POSEIDON_SHIELD_POOL</span>{" "}
          and the deploy block in Vercel when you can.
        </p>
      )}
    </div>
  );
}
