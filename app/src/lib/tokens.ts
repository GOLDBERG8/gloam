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
  /** A tokenized stock, a dollar stablecoin, or another token ($GLOAM). */
  kind: "stock" | "stablecoin" | "token";
  /** CoinGecko's id, for a live USD price where the markets feed has none. */
  coingecko?: string;
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

/**
 * Robinhood Chain mainnet (4663): exactly what the mainnet pool lists, USDG
 * and $GLOAM. Native ETH is not listed there, so it can't be added privately.
 * Beta limits: 500 USDG per deposit / 25,000 in total; 25,000 GLOAM per
 * deposit / 250,000 in total (the app reads them from the pool, see ShieldView).
 */
export const RH_MAINNET_TOKENS: OnchainToken[] = [
  { id: "usdg", symbol: "USDG", name: "Global Dollar", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, yahoo: "", kind: "stablecoin" },
  { id: "gloam", symbol: "GLOAM", name: "Gloam", address: "0xDcD885F5c60b3aD49F6D58718696417314e8724d", decimals: 18, yahoo: "", kind: "token", coingecko: "gloam" },
];

/**
 * Tempo mainnet (4217): the four TIP-20 stablecoins the mainnet pool lists, 6
 * decimals each. Beta limits: 500 per deposit / 25,000 in total for each.
 */
export const TEMPO_MAINNET_TOKENS: OnchainToken[] = [
  { id: "usdce", symbol: "USDC.e", name: "Bridged USDC", address: "0x20c000000000000000000000b9537d11c60e8b50", decimals: 6, yahoo: "", kind: "stablecoin" },
  { id: "pathusd", symbol: "pathUSD", name: "Path USD", address: "0x20c0000000000000000000000000000000000000", decimals: 6, yahoo: "", kind: "stablecoin" },
  { id: "usdt0", symbol: "USDT0", name: "USDT0", address: "0x20c00000000000000000000014f22ca97301eb73", decimals: 6, yahoo: "", kind: "stablecoin" },
  { id: "ousd", symbol: "OUSD", name: "Open USD", address: "0x20c0000000000000000000006a37da5c996874be", decimals: 6, yahoo: "", kind: "stablecoin" },
];

/** ERC-20 tokens shieldable on a given chain (stablecoins first). */
export function shieldTokensFor(chainId: number): OnchainToken[] {
  if (chainId === 4663) return RH_MAINNET_TOKENS;
  if (chainId === 4217) return TEMPO_MAINNET_TOKENS;
  return chainId === 42431 ? TEMPO_STABLE_TOKENS : [...RH_STABLE_TOKENS, ...TESTNET_STOCK_TOKENS];
}

/**
 * Every listed token on one chain, or on all of them when no chain is given,
 * for naming an asset by its address. Chain first, because an address can be
 * listed on more than one chain (pathUSD and OUSD sit at the same address on
 * Tempo mainnet and Moderato).
 */
export function knownTokens(chainId?: number): OnchainToken[] {
  const all = [
    ...RH_STABLE_TOKENS,
    ...TESTNET_STOCK_TOKENS,
    ...TEMPO_STABLE_TOKENS,
    ...RH_MAINNET_TOKENS,
    ...TEMPO_MAINNET_TOKENS,
  ];
  return chainId === undefined ? all : [...shieldTokensFor(chainId), ...all];
}

/**
 * Whether the chain's native coin can be added privately. Tempo (testnet 42431,
 * mainnet 4217) has no native coin and blocks native msg.value, and the
 * Robinhood Chain mainnet pool (4663) does not list ETH.
 */
export function supportsNativeShield(chainId: number): boolean {
  return chainId !== 42431 && chainId !== 4217 && chainId !== 4663;
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
