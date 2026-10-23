"use client";

/**
 * Runtime network selection. Holds the active Gloam network in React state,
 * persisted to localStorage so a reload keeps the choice. A visitor who never
 * picked one starts on defaultNetworkKey(): Robinhood Chain testnet until
 * mainnet is live, a mainnet after.
 *
 * This is the switch the app reads to know which chain to talk to. It does not
 * itself rewire the existing Robinhood write path (that stays the default);
 * consumers opt in by reading `useNetwork()` as they are migrated off the
 * build-time PRODUCT_CHAIN constants.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_NETWORK_KEY,
  defaultNetworkKey,
  getNetwork,
  isNetworkKey,
  type GloamNetwork,
  type NetworkKey,
} from "@/lib/networks";

const STORAGE_KEY = "gloam.network";

interface NetworkContextValue {
  network: GloamNetwork;
  networkKey: NetworkKey;
  setNetworkKey: (key: NetworkKey) => void;
  /**
   * False on the first render, before this browser's choice (or the mainnet
   * default) is read. The server can't know it, so labels that name the network
   * (testnet or mainnet) show a neutral placeholder until then, not a guess.
   */
  settled: boolean;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

function readStored(): NetworkKey {
  if (typeof window === "undefined") return DEFAULT_NETWORK_KEY;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (isNetworkKey(v)) return v;
  } catch {
    /* private mode / blocked storage */
  }
  return defaultNetworkKey();
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  // Start from the default for a stable first render, then hydrate from storage
  // on mount to avoid an SSR/client mismatch.
  const [networkKey, setKey] = useState<NetworkKey>(DEFAULT_NETWORK_KEY);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const stored = readStored();
    if (stored !== networkKey) setKey(stored);
    setSettled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-tab sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isNetworkKey(e.newValue)) {
        setKey(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setNetworkKey = (key: NetworkKey) => {
    setKey(key);
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* ignore */
    }
  };

  const value = useMemo<NetworkContextValue>(
    () => ({ network: getNetwork(networkKey), networkKey, setNetworkKey, settled }),
    [networkKey, settled]
  );

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

/** Read the active network. Safe outside a provider: falls back to the default. */
export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (ctx) return ctx;
  return {
    network: getNetwork(DEFAULT_NETWORK_KEY),
    networkKey: DEFAULT_NETWORK_KEY,
    setNetworkKey: () => {},
    settled: true,
  };
}
