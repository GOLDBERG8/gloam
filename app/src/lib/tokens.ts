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
 * Robinhood Chain mainnet tokens a private swap can land in that Add does not
 * list (lib/vaultSwap RH_SWAP_ASSETS_V2): named here so a note in one shows
 * with its symbol and decimals everywhere. WETH is the chain's canonical
 * wrapped ETH (Arbitrum's aeWETH), the form ETH takes in the vault. The stock
 * tokens are Robinhood's: balances never rebase, but each has a uiMultiplier
 * (splits, dividends) that wallets show balances with, so one raw token is
 * worth the share price times uiMultiplier / 1e18 (lib/stockMultiplier).
 */
export const RH_MAINNET_SWAP_TOKENS: OnchainToken[] = [
  { id: "weth", symbol: "WETH", name: "Wrapped Ether", address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18, yahoo: "", kind: "token", coingecko: "ethereum" },
  { id: "usde", symbol: "USDe", name: "USDe", address: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", decimals: 18, yahoo: "", kind: "stablecoin", coingecko: "ethena-usde" },
  { id: "u", symbol: "U", name: "United Stables", address: "0xcE24439F2D9C6a2289F741120FE202248B666666", decimals: 18, yahoo: "", kind: "stablecoin", coingecko: "united-stables" },
  { id: "cbbtc", symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4", decimals: 8, yahoo: "", kind: "token", coingecko: "coinbase-wrapped-btc" },
  { id: "pons", symbol: "PONS", name: "Pons", address: "0x39dBED3a2bd333467115dE45665cC57F813C4571", decimals: 18, yahoo: "", kind: "token", coingecko: "pons" },
  { id: "cashcat", symbol: "CASHCAT", name: "Cash Cat", address: "0x020bfC650A365f8BB26819deAAbF3E21291018b4", decimals: 18, yahoo: "", kind: "token", coingecko: "cash-cat" },
  { id: "virtual", symbol: "VIRTUAL", name: "Virtuals Protocol", address: "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31", decimals: 18, yahoo: "", kind: "token", coingecko: "virtual-protocol" },
  { id: "spy", symbol: "SPY", name: "SPDR S&P 500 ETF Trust", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", decimals: 18, yahoo: "SPY", kind: "stock", coingecko: "spdr-s-p-500-etf-trust-robinhood-tokenized-stock" },
  { id: "nvda", symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18, yahoo: "NVDA", kind: "stock", coingecko: "nvidia-robinhood-tokenized-stock" },
  { id: "tsla", symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", decimals: 18, yahoo: "TSLA", kind: "stock", coingecko: "tesla-robinhood-tokenized-stock" },
  { id: "amzn", symbol: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", decimals: 18, yahoo: "AMZN", kind: "stock", coingecko: "amazon-robinhood-tokenized-stock" },
  { id: "spcx", symbol: "SPCX", name: "Space Exploration Technologies Corp. Class A Common Stock", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", decimals: 18, yahoo: "", kind: "stock", coingecko: "spacex-robinhood-tokenized-stock" },
  { id: "crcl", symbol: "CRCL", name: "Circle Internet Group", address: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", decimals: 18, yahoo: "CRCL", kind: "stock", coingecko: "circle-internet-group-robinhood-tokenized-stock" },
  { id: "meta", symbol: "META", name: "Meta Platforms", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", decimals: 18, yahoo: "META", kind: "stock", coingecko: "meta-platforms-robinhood-tokenized-stock" },
  { id: "mstr", symbol: "MSTR", name: "Strategy Inc.", address: "0xec262a75e413fAfD0dF80480274532C79D42da09", decimals: 18, yahoo: "MSTR", kind: "stock", coingecko: "strategy-inc-robinhood-tokenized-stock" },
  { id: "googl", symbol: "GOOGL", name: "Alphabet Class A", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", decimals: 18, yahoo: "GOOGL", kind: "stock", coingecko: "alphabet-class-a-robinhood-tokenized-stock" },
  { id: "aapl", symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", decimals: 18, yahoo: "AAPL", kind: "stock", coingecko: "apple-robinhood-tokenized-stock" },
  { id: "msft", symbol: "MSFT", name: "Microsoft", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", decimals: 18, yahoo: "MSFT", kind: "stock", coingecko: "microsoft-robinhood-tokenized-stock" },
  { id: "pltr", symbol: "PLTR", name: "Palantir Technologies", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", decimals: 18, yahoo: "PLTR", kind: "stock", coingecko: "palantir-technologies-robinhood-tokenized-stock" },
  { id: "amd", symbol: "AMD", name: "AMD", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", decimals: 18, yahoo: "AMD", kind: "stock", coingecko: "amd-robinhood-tokenized-stock" },
  { id: "coin", symbol: "COIN", name: "Coinbase", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", decimals: 18, yahoo: "COIN", kind: "stock", coingecko: "coinbase-robinhood-tokenized-stock" },
  { id: "amc", symbol: "AMC", name: "AMC Entertainment Holdings, Inc.", address: "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B", decimals: 18, yahoo: "AMC", kind: "stock", coingecko: "amc-entertainment-holdings-inc-robinhood-token" },
  { id: "hims", symbol: "HIMS", name: "Hims & Hers Health", address: "0xCceE82fE024c36fA15E1005edE3E9e4787e23D09", decimals: 18, yahoo: "HIMS", kind: "stock", coingecko: "hims-hers-health-inc-robinhood-token" },
  { id: "intc", symbol: "INTC", name: "Intel", address: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", decimals: 18, yahoo: "INTC", kind: "stock", coingecko: "intel-robinhood-tokenized-stock" },
  { id: "tsm", symbol: "TSM", name: "Taiwan Semiconductor Manufacturing", address: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", decimals: 18, yahoo: "TSM", kind: "stock", coingecko: "taiwan-semiconductor-manufacturing-robinhood-tokenized-stock" },
  { id: "gld", symbol: "GLD", name: "SPDR Gold Shares", address: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e", decimals: 18, yahoo: "GLD", kind: "stock", coingecko: "spdr-gold-shares-robinhood-token" },
  { id: "mu", symbol: "MU", name: "Micron Technology", address: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", decimals: 18, yahoo: "MU", kind: "stock", coingecko: "micron-technology-robinhood-tokenized-stock" },
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
    ...RH_MAINNET_SWAP_TOKENS,
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
