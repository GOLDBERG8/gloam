/**
 * Self-contained facts the MCP server answers with, so it has no runtime
 * dependency on the web app. CHAIN and MARKETS are the Robinhood Chain TESTNET
 * surface for the trade-planning tools (private trading is not live, and the
 * mainnet pools take payments only); marks are indicative testnet values.
 */

/** Robinhood Chain testnet: where the trade-planning tools and the public test-ETH transfer point. */
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
  network:
    "Mainnet (beta, real money) on Robinhood Chain and Tempo, launched 21 October 2026. The testnets stay up for free practice with test funds.",
  provingKeys:
    "Mainnet verifies the final keys of the 13-contributor trusted setup (drand round 6561386, release ceremony-final). The testnets use single-party dev keys. This server proves with the set of the network it pays on.",
  live: ["shield (deposit)", "private send and private payments (x402 and MPP)", "receiving and sweeping payments", "cash out (in the Gloam app and SDK)"],
  disabled: ["private trading (sealed swaps): off on every network while a new engine is built; the mainnet pools take payments only"],
  notLive: ["private trading", "an external audit (planned; the contracts and circuits were reviewed internally before launch, with no Critical or High findings open)"],
  mainnetLimits:
    "Beta deposit limits: 500 per deposit and 25,000 in total for each stablecoin, 25,000 and 250,000 for GLOAM. Private payments and cash outs are never limited. Raising a limit or adding an asset waits a public 3-day timelock; the owner can lower limits or close deposits at once.",
  fees: "Deposits and private payments are free. Cashing out costs 0.25%.",
  operator:
    "No admin withdraw: notes leave the pool only with an unshield proof. The pool owner is one wallet at launch (a multisig is planned). The Gloam relay, run by the team, only submits already-proven transactions and pays gas; it cannot move or redirect money.",
  whatIsPublic:
    "The shield deposit and any cash-out are public transactions (amount and address visible). What stays hidden is the link between them, your holdings inside the pool, and the amounts and parties of in-pool payments.",
  anonymitySet:
    "thin on a new pool, and the mainnet pools are new. Unlinkability is only as strong as the crowd of notes to hide among. Do not treat a cash-out as fully private until the pool has real volume, and do not cash out the same amount you just deposited.",
  execution:
    "gloam_execute_shield performs a real private deposit (mints a note, generates the Groth16 proof server-side, and broadcasts shieldBound) when GLOAM_AGENT_PRIVATE_KEY is set; on a -mainnet network that is real money. Private trading stays a plan until it is re-enabled.",
} as const;
