"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { TURNKEY_ENABLED } from "./TurnkeyEmbeddedProvider";
import { TurnkeyAutoConnect } from "./TurnkeyAutoConnect";
import { NetworkProvider } from "./NetworkProvider";

export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 8_000,
            refetchOnWindowFocus: false,
            // the RPC transport already retries; stacking three more turns a rate limit into a storm
            retry: 1,
          },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {TURNKEY_ENABLED && <TurnkeyAutoConnect />}
        <NetworkProvider>{children}</NetworkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
