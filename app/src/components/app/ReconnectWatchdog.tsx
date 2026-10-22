"use client";

import { useEffect } from "react";
import { useAccount, useConfig, useConnect } from "wagmi";

/** How long a restore of an earlier wallet session may take before the button comes back. */
const RECONNECT_LIMIT_MS = 6_000;

/**
 * Lives inside WagmiProvider. On load wagmi restores the wallet from the last
 * visit; a WalletConnect session whose relay never answers keeps it restoring
 * for good, which shows "Connecting…" on a disabled button and leaves the
 * visitor stuck. After a few seconds this gives up on the restore so they can
 * connect again. A restore that does finish is left alone, and so is a connect
 * the visitor started.
 *
 * In this app a restore shows as "connecting", not "reconnecting": with ssr and
 * cookie storage, wagmi starts from a blank state, so the restore finds no
 * current session and reports itself as a fresh connect.
 *
 * Renders nothing.
 */
export function ReconnectWatchdog() {
  const { status } = useAccount();
  const { isPending: connectAsked } = useConnect();
  const config = useConfig();
  const restoring = status === "reconnecting" || (status === "connecting" && !connectAsked);

  useEffect(() => {
    if (!restoring) return;
    const t = window.setTimeout(() => {
      config.setState((x) => {
        if (x.status !== "reconnecting" && x.status !== "connecting") return x;
        const live = x.current ? x.connections.get(x.current) : undefined;
        return live && live.accounts.length > 0
          ? { ...x, status: "connected" }
          : { ...x, status: "disconnected", current: null, connections: new Map() };
      });
    }, RECONNECT_LIMIT_MS);
    return () => window.clearTimeout(t);
  }, [restoring, config]);

  return null;
}
