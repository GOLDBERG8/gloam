"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useChainId,
} from "wagmi";
import { ensureRhTestnetWallet, ensureWalletOnChain, shortAddress } from "@/lib/chain";
import { isTempoWallet } from "@/lib/tempoWallet";
import { useNetwork } from "./NetworkProvider";

const noSubscribe = () => () => {};

export function ConnectButton({ className = "" }: { className?: string }) {
  const { address, isConnected, isConnecting, connector: current } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { network } = useNetwork();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  // False on the server and first paint, true once hydrated.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [netErr, setNetErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) return;
    void import("@/lib/track").then(({ track }) => {
      track("wallet_connect", { chainId });
    });
  }, [isConnected, address, chainId]);

  async function onSwitch() {
    setNetErr(null);
    setBusy(true);
    try {
      try {
        await switchChain({ chainId: network.chainId });
      } catch {
        // testnets keep their old fallback; a mainnet adds its own chain
        await (network.testnet ? ensureRhTestnetWallet() : ensureWalletOnChain(network.chain));
        await switchChain({ chainId: network.chainId });
      }
    } catch (e) {
      setNetErr(
        e instanceof Error ? e.message.slice(0, 140) : "Could not switch network"
      );
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        className={`btn btn-ghost ${className}`}
      >
        Connect
      </button>
    );
  }

  if (isConnected && address) {
    const wrong = chainId !== network.chainId;
    // Passkey (Tempo Wallet) accounts live on Tempo only; switching cannot work.
    if (wrong && isTempoWallet(current)) {
      return (
        <div className={className}>
          <button type="button" onClick={() => disconnect()} className="btn btn-ink">
            Disconnect passkey
          </button>
          <p className="mt-2 max-w-[16rem] text-[12px] leading-snug text-mute">
            Passkey accounts are on Tempo. {network.label} needs a browser wallet.
          </p>
        </div>
      );
    }
    if (wrong) {
      return (
        <div className={className}>
          <button
            type="button"
            onClick={onSwitch}
            disabled={switching || busy}
            className="btn btn-ink"
          >
            {switching || busy ? "Switching…" : `Switch to ${network.label}`}
          </button>
          {netErr && (
            <p className="mt-2 max-w-[16rem] text-[12px] leading-snug text-danger">
              {netErr}
            </p>
          )}
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="tnum inline-flex items-center gap-2 text-[13px] text-mute max-sm:hidden">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden />
          {shortAddress(address)}
        </span>
        <button
          type="button"
          onClick={() => disconnect()}
          className="btn btn-ghost btn-sm"
        >
          Disconnect
        </button>
      </div>
    );
  }

  const connector = connectors.find((c) => !isTempoWallet(c)) ?? connectors[0];
  // On Tempo, Tempo Wallet sign-in comes first (account or passkey, fees sponsored).
  const passkey =
    network.key === "tempo" ? connectors.find((c) => isTempoWallet(c)) : undefined;

  return (
    <div className={className}>
      {passkey && (
        <button
          type="button"
          onClick={() => connect({ connector: passkey })}
          disabled={isPending || isConnecting}
          className="btn btn-ink mb-2"
        >
          Sign in
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          void import("@/lib/track").then(({ track }) => {
            track("wallet_connect_click");
          });
          if (connector) connect({ connector });
        }}
        disabled={!connector || isPending || isConnecting}
        className={passkey ? "btn btn-ghost" : "btn btn-ink"}
      >
        {isPending || isConnecting
          ? "Connecting…"
          : passkey
            ? "Use a browser wallet"
            : "Connect wallet"}
      </button>
      {error && (
        <p className="mt-2 max-w-[14rem] text-[12px] leading-snug text-danger">
          {error.message.slice(0, 120)}
        </p>
      )}
    </div>
  );
}
