/**
 * The Content-Security-Policy Gloam is moving towards. It is sent as
 * Content-Security-Policy-Report-Only (next.config.ts): browsers report what it
 * would block in the console but block nothing, so wallets, WalletConnect, the
 * RPCs, the prover's WebAssembly and analytics keep working while the list is
 * checked against real use. Once the console stays clean it can be enforced.
 *
 * connect-src must cover every RPC the app or a wallet connector calls from the
 * browser: scripts/selftest-csp.mts fails if a network or bridge origin chain
 * uses a host that is missing here.
 */

/** Gloam's own networks and their fee sponsor. */
const GLOAM_RPCS = [
  "https://rpc.mainnet.chain.robinhood.com",
  "https://rpc.testnet.chain.robinhood.com",
  "https://rpc.tempo.xyz",
  "https://rpc.moderato.tempo.xyz",
  "https://sponsor.moderato.tempo.xyz",
];

/** Default RPCs of the chains a private bridge order can be paid from (lib/originChains). */
const ORIGIN_RPCS = [
  "https://56.rpc.thirdweb.com",
  "https://api.avax.network",
  "https://arb1.arbitrum.io",
  "https://ethereum.reth.rs",
  "https://forno.celo.org",
  "https://mainnet.base.org",
  "https://mainnet.era.zksync.io",
  "wss://mainnet.era.zksync.io",
  "https://mainnet.optimism.io",
  "https://mainnet.unichain.org",
  "https://polygon.drpc.org",
  "https://rpc-gel.inkonchain.com",
  "wss://rpc-gel.inkonchain.com",
  "https://rpc-qnd.inkonchain.com",
  "wss://rpc-qnd.inkonchain.com",
  "https://rpc.berachain.com",
  "https://rpc.blast.io",
  "https://rpc.gnosischain.com",
  "wss://rpc.gnosischain.com",
  "https://rpc.hyperliquid.xyz",
  "https://rpc.linea.build",
  "wss://rpc.linea.build",
  "https://rpc.mantle.xyz",
  "https://rpc.monad.xyz",
  "wss://rpc.monad.xyz",
  "https://rpc1.monad.xyz",
  "wss://rpc1.monad.xyz",
  "https://rpc.scroll.io",
  "wss://wss-rpc.scroll.io",
  "https://rpc.soniclabs.com",
  "https://worldchain-mainnet.g.alchemy.com",
  "https://xlayerrpc.okx.com",
];

/** Solana, for bridge deposits paid from a Solana wallet. */
const SOLANA_RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];

/** Wallet connectors and the services the app reads from the browser. */
const SERVICES = [
  "https://*.walletconnect.org",
  "https://*.walletconnect.com",
  "wss://*.walletconnect.org",
  "wss://*.walletconnect.com",
  "https://api.web3modal.org",
  "https://*.reown.com",
  "https://*.turnkey.com",
  "https://wallet.tempo.xyz",
  "https://tokenlist.tempo.xyz",
  "https://api.relay.link",
  "https://api.coingecko.com",
  "https://api.dexscreener.com",
  "https://va.vercel-scripts.com",
];

export const CSP_CONNECT_SOURCES = ["'self'", ...GLOAM_RPCS, ...ORIGIN_RPCS, ...SOLANA_RPCS, ...SERVICES];

const FRAMES = ["'self'", "https://*.walletconnect.org", "https://*.walletconnect.com", "https://*.turnkey.com", "https://wallet.tempo.xyz"];

export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // Next's inline bootstrap scripts need 'unsafe-inline' until nonces are wired; the prover needs WebAssembly
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${CSP_CONNECT_SOURCES.join(" ")}`,
  `frame-src ${FRAMES.join(" ")}`,
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
