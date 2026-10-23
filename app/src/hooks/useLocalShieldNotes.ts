"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { getRhPublicClient } from "@/lib/rhClient";
import { useDemoLive } from "@/lib/demo";
import { readDemo } from "@/lib/demoFlag";
import { unlockNoteVault, syncFromDisk, NOTES_KEY } from "@/lib/noteVault";
import { reconcileClaims, reconcileUnfunded } from "@/lib/claimSweep";
import { reconcileCashOuts } from "@/lib/cashOutLater";
import {
  activeSpendableNotes,
  confirmedNotes,
  unfundedClaims,
  fetchChainShieldNotes,
  loadLocalNotes,
  markNoteRecovered,
  mergeNotes,
  purgeSenderPaymentNotes,
  shieldPoolAbi,
  sumByAsset,
  sumEthWei,
  type LocalNote,
} from "@/lib/shield";
import { useNetwork } from "@/components/app/NetworkProvider";

/**
 * Local notes + chain history. Balance only counts notes with a local secret
 * that are not spent on-chain.
 *
 * Uses dedicated RH RPC, not the wallet network.
 */
export function useLocalShieldNotes(address?: string | null) {
  const { network } = useNetwork();
  // Recording demo: the pretend wallet's notes are read on every render, so a
  // network switch or a change made in another view shows straight away.
  const demo = useDemoLive();
  const [local, setLocal] = useState<LocalNote[]>([]);
  const [chain, setChain] = useState<LocalNote[]>([]);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const lastFocusSync = useRef(0);

  const refreshLocal = useCallback(() => {
    purgeSenderPaymentNotes();
    setLocal(loadLocalNotes(address));
    setReady(true);
  }, [address]);

  const reconcileSpent = useCallback(
    async (notes: LocalNote[]) => {
      if (!network.pool) return;
      const publicClient = getRhPublicClient();
      const candidates = notes.filter(
        (n) =>
          n.nullifier &&
          n.nullifier !== "0x" &&
          n.status !== "recovered" &&
          n.secret &&
          n.secret !== "0x"
      );
      let any = false;
      for (const n of candidates) {
        try {
          const spent = (await publicClient.readContract({
            address: network.pool,
            abi: shieldPoolAbi,
            functionName: "isSpent",
            args: [n.nullifier as Hex],
          })) as boolean;
          if (spent) {
            markNoteRecovered(n.id);
            any = true;
          }
        } catch {
          /* ignore */
        }
      }
      if (any) {
        setLocal(loadLocalNotes(address));
      }
    },
    [address, network.pool]
  );

  const syncChain = useCallback(async () => {
    // Recording demo: the pretend wallet has no chain history to merge in.
    if (!address || !network.pool || readDemo()) {
      setChain([]);
      return;
    }
    setSyncing(true);
    try {
      // Claimed payments that reached the vault since, then secured claims and
      // cash-out splits whose move landed (or never can) since last time.
      if (await reconcileUnfunded().catch(() => false)) setLocal(loadLocalNotes(address));
      if (await reconcileClaims().catch(() => false)) setLocal(loadLocalNotes(address));
      const publicClient = getRhPublicClient();
      const rows = await fetchChainShieldNotes(
        publicClient,
        address as Address
      );
      setChain(rows);
      const merged = mergeNotes(loadLocalNotes(address), rows);
      await reconcileSpent(merged);
      // Scheduled cash outs, after spent notes are retired: one that came back
      // unsent (and is unspent on its chain) makes its note spendable again.
      if (await reconcileCashOuts().catch(() => false)) setLocal(loadLocalNotes(address));
      // Ghost-note cleanup: only wipe local ETH if pool ETH inventory is zero
      try {
        const ethInPool = (await publicClient.readContract({
          address: network.pool,
          abi: shieldPoolAbi,
          functionName: "deposited",
          args: ["0x0000000000000000000000000000000000000000"],
        })) as bigint;
        if (ethInPool === BigInt(0)) {
          const locals = loadLocalNotes(address);
          for (const n of locals) {
            if (
              n.status !== "recovered" &&
              (!n.asset ||
                n.asset === "0x0000000000000000000000000000000000000000")
            ) {
              markNoteRecovered(n.id);
            }
          }
          setLocal(loadLocalNotes(address));
        }
      } catch {
        /* ignore */
      }
    } finally {
      setSyncing(false);
    }
  }, [address, reconcileSpent, network.pool]);

  const refresh = useCallback(() => {
    refreshLocal();
    void syncChain();
  }, [refreshLocal, syncChain]);

  useEffect(() => {
    let cancelled = false;
    // Show any legacy plaintext immediately, then decrypt the vault and re-read.
    refreshLocal();
    void unlockNoteVault().then(() => {
      if (!cancelled) refreshLocal();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshLocal]);

  useEffect(() => {
    void syncChain();
  }, [syncChain]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === NOTES_KEY) void syncFromDisk().then(refreshLocal);
    };
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusSync.current < 15_000) {
        refreshLocal();
        return;
      }
      lastFocusSync.current = now;
      refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, refreshLocal]);

  const demoLocal = demo ? loadLocalNotes(address) : null;
  const merged = useMemo(
    () => mergeNotes(demoLocal ?? local, chain),
    [demoLocal, local, chain]
  );
  const open = useMemo(
    () => activeSpendableNotes(merged),
    [merged]
  );
  /** Claimed payments the vault hasn't shown yet: listed, never in `open` or the totals. */
  const waiting = useMemo(() => unfundedClaims(merged), [merged]);
  const confirmed = useMemo(() => confirmedNotes(merged), [merged]);
  const byAsset = useMemo(() => sumByAsset(open), [open]);
  const shieldedWei = useMemo(() => sumEthWei(open), [open]);

  return {
    local,
    chain,
    merged,
    open,
    waiting,
    confirmed,
    byAsset,
    shieldedWei,
    ready,
    syncing,
    refresh,
    refreshLocal,
  };
}
