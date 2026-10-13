"use client";

import type { CreateConnectorFn } from "wagmi";
import { walletConnect } from "wagmi/connectors";

/**
 * WalletConnect, for phones and desktops with no wallet in the browser: the
 * page shows a QR (desktop) or opens a wallet app (phone), the person approves
 * there, and the app talks to that wallet through WalletConnect's relay.
 *
 * Off unless NEXT_PUBLIC_WC_PROJECT_ID is set (a public Reown project id).
 * Nothing loads and no relay connection opens until someone picks it, or
 * comes back with a session from last time. Telemetry is off, and the stock
 * Reown modal (which sends analytics) is not used: WalletConnectSheet draws
 * our own.
 */
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim() ?? "";
export const WALLETCONNECT_ENABLED = WC_PROJECT_ID.length > 0;
export const WALLETCONNECT_ID = "walletConnect";

/** Set while a WalletConnect session exists, so a reload reconnects it. */
const SESSION_MARK = "gloam.wc.v1";

let armed = false;

function hasSessionMark(): boolean {
  try {
    return window.localStorage.getItem(SESSION_MARK) === "1";
  } catch {
    return false;
  }
}

function setSessionMark(on: boolean) {
  try {
    if (on) window.localStorage.setItem(SESSION_MARK, "1");
    else window.localStorage.removeItem(SESSION_MARK);
  } catch {
    /* private mode: the session just won't come back after a reload */
  }
}

/** A wallet lives in this browser: an extension, or a wallet app's own browser. */
export function hasBrowserWallet(): boolean {
  return typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum);
}

/** No wallet here, so "use a wallet" means WalletConnect. Call after mount. */
export function prefersWalletConnect(): boolean {
  return WALLETCONNECT_ENABLED && !hasBrowserWallet();
}

/** A phone or tablet: open a wallet app rather than show a QR to scan. */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * wagmi's WalletConnect connector, kept asleep. wagmi calls getProvider on
 * every connector at load (to reconnect), which would open a relay socket for
 * every visitor; here it stays undefined until connect() runs or a session
 * from an earlier visit exists.
 */
export function lazyWalletConnect(): CreateConnectorFn | null {
  if (!WALLETCONNECT_ENABLED) return null;
  const create = walletConnect({
    projectId: WC_PROJECT_ID,
    showQrModal: false,
    metadata: {
      name: "Gloam",
      description: "Private stablecoin payments",
      // the page's own origin, which wallets check against what they are shown
      url: typeof window === "undefined" ? "https://www.gloam.trade" : window.location.origin,
      icons: ["https://www.gloam.trade/icon.png"],
    },
    // forwarded to the WalletConnect client: no usage events to Reown
    ...({ telemetryEnabled: false } as object),
  });
  const fn: CreateConnectorFn = (config) => {
    const inner = create(config);
    const awake = () => armed || hasSessionMark();
    return {
      ...inner,
      async setup() {
        if (awake()) await inner.setup?.call(this);
      },
      async getProvider(parameters?: { chainId?: number | undefined }) {
        if (!awake()) return undefined;
        return inner.getProvider.call(this, parameters);
      },
      async isAuthorized() {
        if (!awake()) return false;
        const ok = await inner.isAuthorized.call(this);
        if (!ok) setSessionMark(false);
        return ok;
      },
      async connect(parameters) {
        armed = true;
        const result = await inner.connect.call(this, parameters);
        setSessionMark(true);
        return result;
      },
      async disconnect() {
        setSessionMark(false);
        await inner.disconnect.call(this);
      },
    } as typeof inner;
  };
  return fn;
}

/**
 * Wallet apps that can add Robinhood Chain and Tempo when asked, opened with
 * the WalletConnect link. Universal links fall back to the app's store page
 * when it is not installed.
 */
export const WALLET_APPS: { id: string; name: string; link: (uri: string) => string }[] = [
  { id: "metamask", name: "MetaMask", link: (u) => `https://metamask.app.link/wc?uri=${encodeURIComponent(u)}` },
  { id: "trust", name: "Trust Wallet", link: (u) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(u)}` },
  { id: "coinbase", name: "Coinbase Wallet", link: (u) => `https://go.cb-w.com/wc?uri=${encodeURIComponent(u)}` },
  { id: "okx", name: "OKX Wallet", link: (u) => `okex://main/wc?uri=${encodeURIComponent(u)}` },
];
