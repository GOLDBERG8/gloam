"use client";

import { useEffect } from "react";
import { useAccount } from "wagmi";
import { countPerson, resumePeopleCounts } from "@/lib/people";
import { useNetwork } from "./NetworkProvider";

/**
 * Counts the connected wallet, once a day, as someone using Gloam (lib/people),
 * and sends any action counts still waiting from an earlier visit. Renders nothing.
 */
export function PeopleCount() {
  const { address, isConnected } = useAccount();
  const { network } = useNetwork();

  useEffect(() => {
    resumePeopleCounts();
  }, []);

  useEffect(() => {
    if (isConnected && address) countPerson("connect", address, network.testnet);
  }, [isConnected, address, network.testnet]);

  return null;
}
