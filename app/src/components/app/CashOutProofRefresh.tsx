"use client";

/**
 * Renews the proofs of cash outs waiting with the relay while the app is open
 * (lib/cashOutReprove), on any app page: a little after it opens, when the tab
 * comes back into view, and every couple of minutes while it is in view.
 * Draws nothing. A vault still locked behind its passkey is left alone: this
 * never asks for the unlock.
 */
import { useEffect } from "react";
import { reconcileCashOuts } from "@/lib/cashOutLater";
import { refreshWaitingProofs } from "@/lib/cashOutReprove";
import { dataKeyLocked, unlockNoteVault } from "@/lib/noteVault";
import { useNetwork } from "./NetworkProvider";

const FIRST_AFTER_MS = 8_000;
const EVERY_MS = 2 * 60_000;

export function CashOutProofRefresh() {
  const { networkKey } = useNetwork();
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped || document.visibilityState !== "visible" || dataKeyLocked()) return;
      try {
        await unlockNoteVault();
        // Jobs that already went out or came back are settled first, so none is proven for nothing.
        await reconcileCashOuts().catch(() => false);
        if (!stopped) await refreshWaitingProofs();
      } catch {
        /* the old proofs stay; a later tick tries again */
      }
    };
    const first = window.setTimeout(() => void tick(), FIRST_AFTER_MS);
    const every = window.setInterval(() => void tick(), EVERY_MS);
    const onShow = () => void tick();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [networkKey]);
  return null;
}
