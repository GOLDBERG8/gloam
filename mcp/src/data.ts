/**
 * Self-contained snapshot of Gloam's testnet surface so the MCP server has no
 * runtime dependency on the web app. Marks are indicative testnet values.
 */

export const CHAIN = {
  name: "Robinhood Chain Testnet",
  chainId: 46630,
  rpc: "https://rpc.testnet.chain.robinhood.com",
  explorer: "https://explorer.testnet.chain.robinhood.com",
} as const;

export type Market = {
  id: string;
  symbol: string;
  name: string;
  kind: "stock" | "crypto";
  /** Indicative testnet mark in USD. */
  mark: number;
};

export const MARKETS: Market[] = [
  { id: "tsla", symbol: "TSLA", name: "Tesla", kind: "stock", mark: 250 },
  { id: "amzn", symbol: "AMZN", name: "Amazon", kind: "stock", mark: 190 },
  { id: "pltr", symbol: "PLTR", name: "Palantir", kind: "stock", mark: 80 },
  { id: "nflx", symbol: "NFLX", name: "Netflix", kind: "stock", mark: 900 },
  { id: "amd", symbol: "AMD", name: "AMD", kind: "stock", mark: 120 },
  { id: "hood", symbol: "HOOD", name: "Robinhood", kind: "stock", mark: 100 },
  { id: "aapl", symbol: "AAPL", name: "Apple", kind: "stock", mark: 230 },
  { id: "nvda", symbol: "NVDA", name: "NVIDIA", kind: "stock", mark: 140 },
  { id: "eth", symbol: "ETH", name: "Ether", kind: "crypto", mark: 3500 },
];

export function findMarket(query: string): Market | undefined {
  const q = query.trim().toLowerCase();
  return MARKETS.find(
    (m) =>
      m.id === q ||
      m.symbol.toLowerCase() === q ||
      m.name.toLowerCase() === q
  );
}

/**
 * Honest privacy posture. The MCP server never claims more than the protocol
 * delivers today (this mirrors Gloam's threat-model honesty).
 */
export const PRIVACY_STATUS = {
  network: "testnet",
  provingKeys: "development keys on testnet; mainnet deploys the 13-contributor ceremony's final keys",
  live: ["shield", "private send", "cash out"],
  disabled: ["sealed swaps (paused pending solvency work)"],
  notLive: ["mainnet", "production keys", "audited contracts"],
  whatIsPublic:
    "The shield deposit and any cash-out are public transactions (amount and address visible). What stays hidden is the link between them, your holdings inside the pool, and the amounts of in-pool sends.",
  anonymitySet:
    "thin on a new pool. Unlinkability is only as strong as the crowd of notes to hide among. Do not treat a cash-out as fully private until the pool has real volume.",
  execution:
    "gloam_execute_shield performs a real private deposit (mints a note, generates the Groth16 proof server-side, and broadcasts shieldBound) when GLOAM_AGENT_PRIVATE_KEY is set. Sealed-swap execution stays a plan until swaps are re-enabled.",
} as const;
