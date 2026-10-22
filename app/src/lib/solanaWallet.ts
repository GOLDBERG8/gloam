"use client";

/**
 * Solana wallets in this browser (Phantom, Solflare, Backpack and the rest),
 * found through the Wallet Standard: each wallet announces itself with a window
 * event, so no wallet SDK is bundled. Used to pay a private bridge order from
 * Solana (lib/bridgePrivate). Inside a phone wallet's own browser this finds
 * that wallet too.
 */
import { useSyncExternalStore } from "react";

const CHAIN = "solana:mainnet";

type StandardAccount = { address: string; chains: readonly string[] };
type TxInput = { account: StandardAccount; chain: string; transaction: Uint8Array };
type StandardFeatures = {
  "standard:connect"?: { connect(): Promise<{ accounts?: readonly StandardAccount[] } | undefined> };
  "solana:signAndSendTransaction"?: { signAndSendTransaction(input: TxInput): Promise<unknown> };
  "solana:signTransaction"?: { signTransaction(input: TxInput): Promise<readonly { signedTransaction: Uint8Array }[]> };
};
type StandardWallet = {
  name: string;
  icon: string;
  chains: readonly string[];
  accounts: readonly StandardAccount[];
  features: StandardFeatures;
};

export type SolanaWallet = { name: string; icon: string; wallet: StandardWallet };
export type SolanaAccount = { address: string; account: StandardAccount };

const registered = new Set<StandardWallet>();
const listeners = new Set<() => void>();
const EMPTY: SolanaWallet[] = [];
let snapshot: SolanaWallet[] = EMPTY;
let started = false;

function usable(w: StandardWallet): boolean {
  return (
    Array.isArray(w.chains) &&
    w.chains.includes(CHAIN) &&
    Boolean(w.features?.["standard:connect"]) &&
    Boolean(w.features?.["solana:signAndSendTransaction"] || w.features?.["solana:signTransaction"])
  );
}

function publish() {
  const seen = new Set<string>();
  snapshot = [...registered]
    .filter(usable)
    .filter((w) => (seen.has(w.name) ? false : (seen.add(w.name), true)))
    .map((wallet) => ({ name: wallet.name, icon: wallet.icon, wallet }));
  for (const l of listeners) l();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const api = {
    register(...wallets: StandardWallet[]) {
      for (const w of wallets) registered.add(w);
      publish();
      return () => {
        for (const w of wallets) registered.delete(w);
        publish();
      };
    },
  };
  // Wallets that load after the page answer app-ready; ones already loaded
  // answer register-wallet. Both hand over the same register API.
  window.addEventListener("wallet-standard:register-wallet", (e) => {
    const callback = (e as CustomEvent).detail;
    if (typeof callback === "function") callback(api);
  });
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
}

function subscribe(l: () => void) {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The Solana wallets that can pay a bridge order here, as they appear. */
export function useSolanaWallets(): SolanaWallet[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

/** Ask the wallet to connect. Returns its Solana mainnet account. */
export async function connectSolana(w: SolanaWallet): Promise<SolanaAccount> {
  const connect = w.wallet.features["standard:connect"];
  if (!connect) throw new Error(`${w.name} can't connect here.`);
  const out = await connect.connect();
  const accounts = out?.accounts?.length ? out.accounts : w.wallet.accounts;
  const account = accounts.find((a) => a.chains?.includes(CHAIN)) ?? accounts[0];
  if (!account) throw new Error(`${w.name} didn't share an account.`);
  return { address: account.address, account };
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/**
 * Sign and send the order's transaction from this wallet. A wallet that only
 * signs hands it back, and the server sends it (/api/bridge/solana-send).
 */
export async function paySolana(w: SolanaWallet, a: SolanaAccount, txBase64: string): Promise<void> {
  const transaction = fromBase64(txBase64);
  const sendFeature = w.wallet.features["solana:signAndSendTransaction"];
  if (sendFeature) {
    await sendFeature.signAndSendTransaction({ account: a.account, chain: CHAIN, transaction });
    return;
  }
  const signFeature = w.wallet.features["solana:signTransaction"];
  if (!signFeature) throw new Error(`${w.name} can't sign this.`);
  const [signed] = await signFeature.signTransaction({ account: a.account, chain: CHAIN, transaction });
  if (!signed?.signedTransaction) throw new Error(`${w.name} didn't sign it.`);
  const res = await fetch("/api/bridge/solana-send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx: toBase64(signed.signedTransaction) }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
  if (!json?.ok) throw new Error(json?.error?.message ?? "Couldn't send it to Solana. Try again.");
}
