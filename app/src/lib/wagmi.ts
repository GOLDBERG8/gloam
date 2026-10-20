"use client";

import { http, createConfig, createStorage, cookieStorage } from "wagmi";
import { injected } from "wagmi/connectors";
import { robinhood, robinhoodTestnet } from "./chain";
import { NETWORK_KEYS, tempoMainnet, tempoTestnet } from "./networks";
import { turnkeyConnector } from "./turnkeyConnector";
import { tempoFeeAware } from "./feeSponsor";
import { tempoWalletConnector } from "./tempoWallet";
import { lazyWalletConnect } from "./walletConnect";

const walletConnectFn = lazyWalletConnect();

/**
 * Both testnets Gloam targets are registered so the app can switch between
 * them at runtime. A mainnet is registered only once its pool is filled in
 * (MAINNET_POOLS in lib/mainnet.ts), after the testnets so the first chain a
 * connector starts on stays Robinhood Chain testnet. Before deploy day the
 * config is exactly the two testnets.
 *
 * Connectors:
 * - injected: browser wallets on every network. On Tempo (testnet and mainnet)
 *   it sets a fee token first when the account has none and no pathUSD
 *   (lib/feeSponsor.ts).
 * - Turnkey passkey: Robinhood Chain testnet only, behind NEXT_PUBLIC_TURNKEY_ENABLED.
 * - Tempo Wallet: passkey sign-in on Tempo testnet, fees sponsored (lib/tempoWallet.ts).
 * - WalletConnect: a wallet app on a phone (or scanned from desktop) when the
 *   browser has no wallet, behind NEXT_PUBLIC_WC_PROJECT_ID (lib/walletConnect.ts).
 */
const mainnetChains = [
  ...(NETWORK_KEYS.includes("robinhood-mainnet") ? [robinhood] : []),
  ...(NETWORK_KEYS.includes("tempo-mainnet") ? [tempoMainnet] : []),
];

// wagmi narrows hook `chainId` options to the registered ids. The type names
// all four (GloamChainId); at runtime only the mainnets with a pool are there.
const chains = [robinhoodTestnet, tempoTestnet, ...mainnetChains] as unknown as readonly [
  typeof robinhoodTestnet,
  typeof tempoTestnet,
  typeof robinhood,
  typeof tempoMainnet,
];

export const wagmiConfig = createConfig({
  chains,
  connectors: [
    tempoFeeAware(injected({ shimDisconnect: true })),
    turnkeyConnector(),
    tempoWalletConnector(),
    ...(walletConnectFn ? [tempoFeeAware(walletConnectFn)] : []),
  ],
  transports: {
    [robinhoodTestnet.id]: http("https://rpc.testnet.chain.robinhood.com"),
    [tempoTestnet.id]: http("https://rpc.moderato.tempo.xyz"),
    [robinhood.id]: http("https://rpc.mainnet.chain.robinhood.com"),
    [tempoMainnet.id]: http("https://rpc.tempo.xyz"),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
