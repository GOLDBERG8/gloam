"use client";

import { useEffect } from "react";
import { useAccount, useConfig } from "wagmi";

/** How long a restore of an earlier wallet session may take before the button comes back. */
const RECONNECT_LIMIT_MS = 6_000;

/**
 * Lives inside WagmiProvider. On load wagmi restores the wallet from the last
 * visit; a WalletConnect session whose relay never answers keeps it
 * "reconnecting" for good, which shows "Connecting…" on a disabled button and
 * leaves the visitor stuck. After a few seconds this gives up on the restore
 * so they can connect again. A restore that does finish is left alone.
 * Renders nothing.
 */
export function ReconnectWatchdog() {
  const { status } = useAccount();
  const config = useConfig();

  useEffect(() => {
    if (status !== "reconnecting") return;
    const t = window.setTimeout(() => {
      config.setState((x) => {
        if (x.status !== "reconnecting") return x;
        const live = x.current ? x.connections.get(x.current) : undefined;
        return live && live.accounts.length > 0 ? { ...x, status: "connected" } : { ...x, status: "disconnected", current: null };
      });
    }, RECONNECT_LIMIT_MS);
    return () => window.clearTimeout(t);
  }, [status, config]);

  return null;
}
