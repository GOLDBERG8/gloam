"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  assertTreeMatchesChain,
  syncShieldTree,
  type SyncedTree,
} from "@/lib/treeSync";
import { getRhPublicClient } from "@/lib/rhClient";
import { isShieldDeployed } from "@/lib/shield";
import type { MerklePath } from "@/lib/merkle";
import type { PoseidonMerklePath } from "@/lib/merklePoseidon";

/**
 * Vault Merkle tree, uses dedicated RH RPC (not wallet network).
 */
export function useShieldTree() {
  const [synced, setSynced] = useState<SyncedTree | null>(null);
  const [matchesChain, setMatchesChain] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a failed sync tries again by itself a few times (1 s, 3 s, 9 s, with jitter)
  const retries = useRef(0);
  const retryTimer = useRef<number | null>(null);

  const refresh = useCallback(async (auto = false) => {
    if (!auto) retries.current = 0;
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    if (!isShieldDeployed()) {
      setSynced(null);
      setMatchesChain(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const publicClient = getRhPublicClient();
      const tree = await syncShieldTree(publicClient);
      setSynced(tree);
      if (tree) {
        // The sync already matched the root to the pool at the synced block.
        const ok = tree.verified || (await assertTreeMatchesChain(publicClient, tree));
        setMatchesChain(ok);
        if (!ok) {
          setError("Rebuilt tree root does not match pool.currentRoot()");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tree sync failed");
      setSynced(null);
      setMatchesChain(null);
      if (retries.current < 3) {
        const wait = 1_000 * 3 ** retries.current + Math.random() * 500;
        retries.current++;
        retryTimer.current = window.setTimeout(() => void refresh(true), wait);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Start on the next microtask so the effect body itself sets no state.
    void Promise.resolve().then(() => refresh());
    return () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [refresh]);

  async function pathForLeaf(
    leafIndex: number
  ): Promise<MerklePath | PoseidonMerklePath | null> {
    if (!synced) return null;
    return synced.pathForLeaf(leafIndex);
  }

  function leafIndexForCommitment(commitment?: string | null): number | null {
    if (!synced || !commitment) return null;
    const i = synced.indexByCommitment.get(commitment.toLowerCase());
    return i === undefined ? null : i;
  }

  return {
    synced,
    matchesChain,
    loading,
    error,
    refresh,
    pathForLeaf,
    leafIndexForCommitment,
    leafCount: synced?.leafCount ?? 0,
    root: synced?.root ?? null,
    scheme: synced?.scheme ?? null,
  };
}
