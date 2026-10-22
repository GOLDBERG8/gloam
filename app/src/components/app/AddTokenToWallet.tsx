"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useWatchAsset } from "wagmi";
import { allNetworks, getNetwork, networkName } from "@/lib/networks";
import { knownTokens } from "@/lib/tokens";
import { isNativeAsset } from "@/lib/shield";
import { walletDeclined } from "@/lib/walletErrors";
import { tokenLogoPath } from "./TokenLogo";

/**
 * After a cash out: wallets list only the tokens they know, so money that
 * landed can look missing. To the connected wallet, one tap adds the token to
 * its list (wallet_watchAsset); to another address, the token address to
 * import there.
 */
export function AddTokenToWallet({ chainId, asset, to }: { chainId: number; asset: Address; to: Address }) {
  const { address } = useAccount();
  const { watchAssetAsync, isPending } = useWatchAsset();
  const [added, setAdded] = useState<"idle" | "added" | "failed">("idle");
  const [copied, setCopied] = useState(false);
  const token = knownTokens(chainId).find((t) => t.address.toLowerCase() === asset.toLowerCase());
  if (!token || isNativeAsset(asset)) return null;
  const net = allNetworks().find((n) => n.chainId === chainId) ?? getNetwork("robinhood-mainnet");
  const chainName = networkName(net);
  const mine = Boolean(address && to.toLowerCase() === address.toLowerCase());

  async function onAdd() {
    try {
      const logo = tokenLogoPath(token!.id);
      await watchAssetAsync({
        type: "ERC20",
        options: {
          address: token!.address,
          symbol: token!.symbol,
          decimals: token!.decimals,
          ...(logo ? { image: new URL(logo, window.location.origin).toString() } : {}),
        },
      });
      setAdded("added");
    } catch (e) {
      // closed the prompt: the button stays; anything else: show the address to import by hand
      if (!walletDeclined(e)) setAdded("failed");
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(token!.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the address is on screen to select */
    }
  }

  const manual = (
    <>
      <p className="mx-auto mt-1 max-w-[36ch] text-[13px] leading-relaxed text-mute">
        {mine
          ? `If it doesn't show, switch the wallet to ${chainName} and import ${token.symbol} with this address:`
          : `Import ${token.symbol} in that wallet to see it. Switch it to ${chainName}, then import this address:`}
      </p>
      <div className="mx-auto mt-3 flex max-w-full items-center justify-center gap-2">
        <code className="tnum min-w-0 truncate rounded-lg bg-surface px-2.5 py-1.5 text-[12px] text-foreground">
          {token.address}
        </code>
        <button type="button" onClick={() => void onCopy()} className="btn btn-quiet btn-sm shrink-0">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </>
  );

  return (
    <div>
      <p className="text-[14px] text-foreground">
        {added === "added" ? `${token.symbol} is in your wallet's list` : `See your ${token.symbol} in the wallet`}
      </p>
      {added === "added" ? (
        <p className="mx-auto mt-1 max-w-[34ch] text-[13px] leading-relaxed text-mute">
          It shows there now, on {chainName}.
        </p>
      ) : mine && added === "idle" ? (
        <>
          <p className="mx-auto mt-1 max-w-[34ch] text-[13px] leading-relaxed text-mute">
            Wallets only list tokens they know. Add {token.symbol} so the money shows up.
          </p>
          <div className="mt-3 flex justify-center">
            <button type="button" onClick={() => void onAdd()} disabled={isPending} className="btn btn-quiet btn-sm">
              {isPending ? "Check your wallet…" : `Add ${token.symbol} to your wallet`}
            </button>
          </div>
        </>
      ) : (
        manual
      )}
    </div>
  );
}
