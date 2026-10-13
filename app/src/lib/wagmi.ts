"use client";

import { http, createConfig, createStorage, cookieStorage } from "wagmi";
import { injected } from "wagmi/connectors";
import { robinhoodTestnet } from "./chain";
import { tempoTestnet } from "./networks";
import { turnkeyConnector } from "./turnkeyConnector";
import { tempoFeeAware } from "./feeSponsor";
import { tempoWalletConnector } from "./tempoWallet";
import { lazyWalletConnect } from "./walletConnect";

const walletConnectFn = lazyWalletConnect();

/**
 * Product is **testnet-only** until stocks/swaps/privacy work end-to-end.
 * Mainnet chains are intentionally not registered here. Both testnets Gloam
 * targets are registered so the app can switch between them at runtime.
 *
 * Connectors:
 * - injected: browser wallets on both networks. On Tempo it sets a fee token
 *   (OUSD) first when the account has none and no PathUSD (lib/feeSponsor.ts).
 * - Turnkey passkey: Robinhood Chain only, behind NEXT_PUBLIC_TURNKEY_ENABLED.
 * - Tempo Wallet: passkey sign-in on Tempo, fees sponsored (lib/tempoWallet.ts).
 * - WalletConnect: a wallet app on a phone (or scanned from desktop) when the
 *   browser has no wallet, behind NEXT_PUBLIC_WC_PROJECT_ID (lib/walletConnect.ts).
 */
export const wagmiConfig = createConfig({
  chains: [robinhoodTestnet, tempoTestnet],
  connectors: [
    tempoFeeAware(injected({ shimDisconnect: true })),
    turnkeyConnector(),
    tempoWalletConnector(),
    ...(walletConnectFn ? [tempoFeeAware(walletConnectFn)] : []),
  ],
  transports: {
    [robinhoodTestnet.id]: http("https://rpc.testnet.chain.robinhood.com"),
    [tempoTestnet.id]: http("https://rpc.moderato.tempo.xyz"),
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
