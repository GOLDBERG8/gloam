/**
 * Robinhood Chain testnet stock tokens (from public explorer / faucet).
 * Balances are real onchain. USD marks use live equity prices.
 */
export type OnchainToken = {
  id: string;
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  yahoo: string;
  kind: "stock" | "stablecoin";
};

export const TESTNET_STOCK_TOKENS: OnchainToken[] = [
  {
    id: "tsla",
    symbol: "TSLA",
    name: "Tesla",
    address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
    decimals: 18,
    yahoo: "TSLA",
    kind: "stock",
  },
  {
    id: "amzn",
    symbol: "AMZN",
    name: "Amazon",
    address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
    decimals: 18,
    yahoo: "AMZN",
    kind: "stock",
  },
  {
    id: "pltr",
    symbol: "PLTR",
    name: "Palantir",
    address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0",
    decimals: 18,
    yahoo: "PLTR",
    kind: "stock",
  },
  {
    id: "nflx",
    symbol: "NFLX",
    name: "Netflix",
    address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",
    decimals: 18,
    yahoo: "NFLX",
    kind: "stock",
  },
  {
    id: "amd",
    symbol: "AMD",
    name: "AMD",
    address: "0x71178BAc73cBeb415514eB542a8995b82669778d",
    decimals: 18,
    yahoo: "AMD",
    kind: "stock",
  },
];

/**
 * Tempo Moderato faucet stablecoins (6 decimals), from tempo_fundAddress, OUSD first. These
 * are what Gloam shields on Tempo, since Tempo blocks native msg.value.
 */
export const TEMPO_STABLE_TOKENS: OnchainToken[] = [
  // OpenUSD (Open Standard), Tempo's recommended stablecoin; same address on mainnet and Moderato.
  { id: "ousd", symbol: "OUSD", name: "Open USD", address: "0x20c0000000000000000000006a37da5c996874be", decimals: 6, yahoo: "", kind: "stablecoin" },
  { id: "pathusd", symbol: "PathUSD", name: "Path USD", address: "0x20c0000000000000000000000000000000000000", decimals: 6, yahoo: "", kind: "stablecoin" },
  { id: "alphausd", symbol: "AlphaUSD", name: "Alpha USD", address: "0x20c0000000000000000000000000000000000001", decimals: 6, yahoo: "", kind: "stablecoin" },
  { id: "betausd", symbol: "BetaUSD", name: "Beta USD", address: "0x20c0000000000000000000000000000000000002", decimals: 6, yahoo: "", kind: "stablecoin" },
  { id: "thetausd", symbol: "ThetaUSD", name: "Theta USD", address: "0x20c0000000000000000000000000000000000003", decimals: 6, yahoo: "", kind: "stablecoin" },
];

/**
 * Paxos Global Dollar (USDG) on Robinhood Chain testnet, from Paxos's testnet docs
 * (docs.paxos.com/guides/stablecoin/usdg/testnet); test USDG from faucet.paxos.com.
 * The stablecoin Gloam leads with on Robinhood Chain (payroll, private pay).
 */
export const RH_STABLE_TOKENS: OnchainToken[] = [
  { id: "usdg", symbol: "USDG", name: "Global Dollar", address: "0x7E955252E15c84f5768B83c41a71F9eba181802F", decimals: 6, yahoo: "", kind: "stablecoin" },
];

export const PAXOS_FAUCET_URL = "https://faucet.paxos.com/";

/** ERC-20 tokens shieldable on a given chain (stablecoins first). */
export function shieldTokensFor(chainId: number): OnchainToken[] {
  return chainId === 42431 ? TEMPO_STABLE_TOKENS : [...RH_STABLE_TOKENS, ...TESTNET_STOCK_TOKENS];
}

/** Tempo (42431) blocks native msg.value; shields there go through ERC-20 only. */
export function supportsNativeShield(chainId: number): boolean {
  // Tempo (testnet 42431, mainnet 4217) has no native coin to shield
  return chainId !== 42431 && chainId !== 4217;
}

export const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
