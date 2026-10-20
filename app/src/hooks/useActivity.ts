"use client";

import { useQuery } from "@tanstack/react-query";
import { useDemoActivity } from "@/lib/demo";

export type ActivityTx = {
  hash: string;
  from: string;
  to: string;
  valueWei: string;
  timestamp: number;
  ok: boolean;
};

async function fetchActivity(address: string, mainnetChainId?: number) {
  // A testnet asks exactly as before; a mainnet names its chain.
  const chain = mainnetChainId ? `&chainId=${mainnetChainId}` : "";
  const res = await fetch(
    `/api/activity?address=${encodeURIComponent(address)}${chain}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("activity_failed");
  return res.json() as Promise<{ txs: ActivityTx[] }>;
}

/** The wallet's public history; pass a mainnet's chain id to read that chain instead of the testnet. */
export function useActivity(address: string | undefined, mainnetChainId?: number) {
  // Recording demo: the pretend wallet's history, nothing fetched.
  const demo = useDemoActivity();
  const query = useQuery({
    queryKey: mainnetChainId ? ["activity", address, mainnetChainId] : ["activity", address],
    queryFn: () => fetchActivity(address!, mainnetChainId),
    enabled: Boolean(address) && !demo,
    staleTime: 12_000,
    refetchInterval: 30_000,
  });
  return demo ?? query;
}
