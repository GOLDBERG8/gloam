"use client";

import { useEffect, useRef } from "react";
import { useSwitchChain } from "wagmi";
import { ensureWalletOnChain } from "@/lib/chain";
import { useAppAccount } from "@/lib/demo";
import { isTempoWallet } from "@/lib/tempoWallet";
import { walletDeclined } from "@/lib/walletErrors";
import { useNetwork } from "./NetworkProvider";

const ASKED_KEY = "gloam.autoSwitch";

/** Networks already asked for in this tab, also kept in sessionStorage across reloads. */
const asked = new Set<number>();

function askedBefore(chainId: number): boolean {
  if (asked.has(chainId)) return true;
  try {
    return (window.sessionStorage.getItem(ASKED_KEY) ?? "").split(",").includes(String(chainId));
  } catch {
    return false;
  }
}

function markAsked(chainId: number) {
  asked.add(chainId);
  try {
    const list = new Set((window.sessionStorage.getItem(ASKED_KEY) ?? "").split(",").filter(Boolean));
    list.add(String(chainId));
    window.sessionStorage.setItem(ASKED_KEY, [...list].join(","));
  } catch {
    /* private mode: the in-memory set still stops a second ask in this tab */
  }
}

/**
 * When a wallet connects on another chain than the network picked in Gloam,
 * asks it once to switch, adding the chain if the wallet doesn't know it yet.
 * Once per network per session: a "no" is final, and the "Switch to …"
 * button stays as the way back. Passkey and embedded accounts can't switch,
 * so they are left alone. Renders nothing.
 */
export function AutoSwitchNetwork() {
  const { isConnected, status, chainId, connector, demo } = useAppAccount();
  const { network } = useNetwork();
  const { switchChainAsync } = useSwitchChain();
  const latest = useRef({ chainId, target: network.chainId });
  useEffect(() => {
    latest.current = { chainId, target: network.chainId };
  }, [chainId, network.chainId]);

  const wrong = isConnected && status === "connected" && !demo && chainId !== undefined && chainId !== network.chainId;
  const canSwitch = Boolean(connector) && !isTempoWallet(connector) && connector?.id !== "gloam-turnkey";

  useEffect(() => {
    if (!wrong || !canSwitch || askedBefore(network.chainId)) return;
    const target = network.chainId;
    const chain = network.chain;
    // a moment for a restored session to report its real chain first
    const t = window.setTimeout(() => {
      if (latest.current.target !== target || latest.current.chainId === target || askedBefore(target)) return;
      markAsked(target);
      void (async () => {
        try {
          await switchChainAsync({ chainId: target });
        } catch (e) {
          if (walletDeclined(e)) return;
          // the wallet doesn't know this chain yet: adding it switches to it too
          await ensureWalletOnChain(chain).catch(() => false);
        }
      })();
    }, 1_200);
    return () => window.clearTimeout(t);
  }, [wrong, canSwitch, network.chainId, network.chain, switchChainAsync]);

  return null;
}
