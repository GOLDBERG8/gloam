"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SealedField } from "@/components/ui/SealedField";
import { SealDots } from "@/components/ui/SealDots";
import { appClaimPath, codeFromHash } from "@/lib/claimLink";
import { countLinkOpened, isClaimLink } from "@/lib/funnel";
import { getNetwork, isNetworkKey, type NetworkKey } from "@/lib/networks";
import { decodeNotePackage, isEncryptedPackage } from "@/lib/notePackage";
import { inWalletBrowser } from "@/lib/passkey";
import { WALLETCONNECT_ENABLED } from "@/lib/walletConnect";
import { formatAssetLabel } from "@/lib/shield";

/**
 * Where a claim link lands (gloam.trade/claim?net=...#claim=<code>). Phone
 * first: what was sent, one button into the app to claim it, and what to
 * expect. The code stays in the fragment, so it never reaches a server; this
 * page only reads it in the browser.
 */

type View =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; code: string; net: NetworkKey; amount: string | null; locked: boolean; note?: string };

export default function ClaimPage() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [walletBrowser, setWalletBrowser] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const code = codeFromHash(window.location.hash);
    const q = new URLSearchParams(window.location.search).get("net");
    const net: NetworkKey = isNetworkKey(q) ? q : "tempo";
    void (async () => {
      const wb = inWalletBrowser();
      if (!code || !isClaimLink(code)) {
        if (!cancelled) {
          setWalletBrowser(wb);
          setView({ kind: "missing" });
        }
        return;
      }
      countLinkOpened(code);
      let amount: string | null = null;
      let note: string | undefined;
      const locked = isEncryptedPackage(code);
      if (!locked) {
        try {
          const pack = await decodeNotePackage(code);
          amount = formatAssetLabel(pack.amountWei, pack.asset);
          note = pack.note;
        } catch {
          amount = null;
        }
      }
      if (!cancelled) {
        setWalletBrowser(wb);
        setView({ kind: "ready", code, net, amount, locked, note });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the address bar has it too */
    }
  }

  return (
    <div className="relative flex min-h-[100svh] flex-col bg-surface text-foreground">
      <header className="mx-auto flex w-full max-w-[560px] items-center justify-between px-5 pt-6">
        <Link href="/" className="inline-flex items-center gap-2.5 text-[18px] font-medium tracking-[-0.01em]">
          <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="9" className="fill-foreground" />
            <rect x="15" y="4" width="12" height="12" rx="3.5" className="fill-surface" />
          </svg>
          Gloam
        </Link>
        <span className="text-[12.5px] text-mute">Testnet</span>
      </header>

      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-5 pb-10 pt-8">
        {view.kind === "loading" && (
          <div className="rounded-[24px] bg-panel p-7 shadow-card">
            <div className="h-4 w-40 animate-pulse rounded bg-surface" />
            <div className="mt-5 h-12 w-56 animate-pulse rounded bg-surface" />
            <div className="mt-8 h-12 w-full animate-pulse rounded-full bg-surface" />
          </div>
        )}

        {view.kind === "missing" && (
          <div className="rounded-[24px] bg-panel p-7 shadow-card">
            <p className="t-label">Claim link</p>
            <h1 className="mt-3 text-[30px] font-light leading-[1.1] tracking-[-0.02em]">This link is missing its payment</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-soft">
              The part after <span className="whitespace-nowrap">#claim=</span> was cut off, often when a link is copied by hand.
              Ask the sender to send the full link again, or paste the code under Pay, then Receive in the app.
            </p>
            <Link href="/app/vault?tab=move&mode=receive" className="btn btn-ink btn-lg btn-block mt-7">
              Open Gloam
            </Link>
          </div>
        )}

        {view.kind === "ready" && (
          <>
            <div className="relative overflow-hidden rounded-[24px] bg-panel p-7 shadow-card">
              <SealedField tone="soft" />
              <div className="relative">
                <p className="t-label inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-sealed" aria-hidden />
                  A private payment for you
                </p>
                {view.locked ? (
                  <>
                    <h1 className="mt-4 text-[34px] font-light leading-[1.08] tracking-[-0.02em]">Someone sent you money, locked with a phrase</h1>
                    <p className="mt-3 text-[15px] leading-relaxed text-soft">
                      The sender gives you the phrase separately. You&apos;ll type it on the next screen to see the amount and claim it.
                    </p>
                  </>
                ) : view.amount ? (
                  <>
                    <h1 className="tnum mt-4 text-[44px] font-light leading-none tracking-[-0.025em]">{view.amount}</h1>
                    <p className="mt-3 text-[15px] leading-relaxed text-soft">
                      sent to you privately on {getNetwork(view.net).label}. Only you will see it once it&apos;s claimed.
                    </p>
                  </>
                ) : (
                  <>
                    <h1 className="mt-4 text-[34px] font-light leading-[1.08] tracking-[-0.02em]">Someone sent you money, privately</h1>
                    <p className="mt-3 text-[15px] leading-relaxed text-soft">Open it in Gloam to see the amount and claim it.</p>
                  </>
                )}
                {view.note && (
                  <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-relaxed text-soft">
                    <span className="text-mute">Their note: </span>
                    {view.note}
                  </p>
                )}
                <a href={appClaimPath(view.code, view.net)} className="btn btn-ink btn-lg btn-block mt-7">
                  Claim it
                </a>
                <p className="mt-3 text-center text-[13px] text-mute">
                  {view.net === "tempo"
                    ? "No wallet needed: sign in with a passkey on the next screen."
                    : walletBrowser
                      ? "Connect your wallet on the next screen, then tap Claim."
                      : WALLETCONNECT_ENABLED
                        ? "Connect a wallet app such as MetaMask on the next screen, then tap Claim."
                        : "You'll need a wallet app such as MetaMask or Rabby to claim on Robinhood Chain."}
                </p>
              </div>
            </div>

            {view.net !== "tempo" && !walletBrowser && !WALLETCONNECT_ENABLED && (
              <div className="mt-3 rounded-[20px] bg-panel p-5 text-[14px] leading-relaxed text-soft shadow-card">
                <p className="text-foreground">On a phone?</p>
                <p className="mt-1">Open this link inside your wallet app&apos;s browser, then tap Claim it.</p>
                <button type="button" onClick={() => void copyLink()} className="btn btn-ghost btn-sm mt-3">
                  {copied ? "Copied" : "Copy this link"}
                </button>
              </div>
            )}

            <ol className="mt-8 grid gap-4 px-1">
              {[
                ["Sign in or connect a wallet", "It takes a few seconds and costs nothing on testnet."],
                ["Tap Claim", "The money moves into your private balance on this device."],
                ["It stays private", "The explorer never shows how much you hold or who paid you."],
              ].map(([t, s], i) => (
                <li key={t} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                  <span className="tnum grid h-7 w-7 place-items-center rounded-full bg-sealed-soft text-[13px] font-medium text-sealed">{i + 1}</span>
                  <span>
                    <span className="block text-[15px] text-foreground">{t}</span>
                    <span className="block text-[13.5px] leading-relaxed text-mute">{s}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-8 flex items-start gap-3 rounded-[20px] border border-line px-5 py-4 text-[13.5px] leading-relaxed text-soft">
              <span className="mt-1 shrink-0 text-sealed" aria-hidden>
                <SealDots n={3} />
              </span>
              <span>Every new person in the vault makes every payment in it harder to trace. Claiming this makes it more private for everyone, you included.</span>
            </div>
          </>
        )}

        <p className="mt-auto pt-10 text-center text-[12.5px] leading-relaxed text-mute">
          Gloam runs on testnet: this is play money with no real value.{" "}
          <Link href="/docs/private-pay" className="underline underline-offset-4">
            How private payments work
          </Link>
        </p>
      </main>
    </div>
  );
}
