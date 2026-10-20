"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { isShieldDeployed } from "@/lib/shield";
import { readPoolDeposited } from "@/lib/vaultStatus";

/**
 * Pool inventory for an asset (`deposited[asset]`).
 * Uses dedicated RH RPC, works with wallet disconnected or on another chain.
 */
export function usePoolDeposited(asset: Address | undefined | null) {
  const [deposited, setDeposited] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  const refetch = useCallback(async () => {
    if (!isShieldDeployed() || !asset) {
      setDeposited(null);
      return;
    }
    setIsLoading(true);
    setIsError(false);
    try {
      const d = await readPoolDeposited(asset);
      setDeposited(d);
      if (d === null) setIsError(true);
    } catch {
      setIsError(true);
      setDeposited(null);
    } finally {
      setIsLoading(false);
    }
  }, [asset]);

  useEffect(() => {
    void refetch();
    // a hidden tab skips its turn; coming back reads at once
    const t = setInterval(() => {
      if (!document.hidden) void refetch();
    }, 12_000);
    const onShow = () => {
      if (!document.hidden) void refetch();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refetch]);

  return {
    deposited,
    isLoading,
    isError,
    refetch,
  };
}
