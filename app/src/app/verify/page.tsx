"use client";

import Image from "next/image";
import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toHex } from "viem";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SealedField } from "@/components/ui/SealedField";
import { FlowField } from "@/components/ui/FlowField";
import {
  LEGACY_DISCLOSURE,
  decodeDisclosure,
  verifyDisclosureProof,
  type Disclosure,
} from "@/lib/disclosure";
import {
  decodeProof,
  isGloamProof,
  verifyProof,
  type AnyProof,
  type VerifyResult,
} from "@/lib/proofs";
import { ProofVerdict, amountOf, symbolOf } from "@/components/verify/ProofVerdict";
import { networkForChain } from "@/lib/proofs/chain";
import { NETWORK_KEYS, getNetwork, type ChainFamily, type GloamNetwork, type NetworkKey } from "@/lib/networks";
import { track } from "@/lib/track";
import { ArrowUpRight } from "@/components/ui/ArrowUpRight";
import { useMainnetLive } from "@/components/MainnetCountdown";
import { vaultSwapRouter } from "@/lib/vaultSwap";

type Result =
  | { kind: "idle" }
  | { kind: "checking"; step: string }
  /** An older balance disclosure: never verified, whatever its math (lib/disclosure). */
  | { kind: "legacy"; d: Disclosure }
  | { kind: "proof"; p: AnyProof; r: VerifyResult; at: number }
  | { kind: "bad"; reason: string; title?: string };

/**
 * A proof handed over in the link: `#proof=` (stays in the browser) or
 * `?proof=`. URLSearchParams turns a bare "+" into a space, and base64 never
 * has spaces, so those go back to "+".
 */
function proofFromUrl(): string | null {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const raw = hash.get("proof") || query.get("proof");
    return raw ? raw.trim().replace(/ /g, "+") : null;
  } catch {
    return null;
  }
}

function onUrlChange(cb: () => void) {
  window.addEventListener("hashchange", cb);
  window.addEventListener("popstate", cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener("popstate", cb);
  };
}
const noProof = () => null;

/** A disclosure carries its asset as a field element; back to an address. */
function assetAddress(asset: string): string {
  try {
    return toHex(BigInt(asset), { size: 20 });
  } catch {
    return asset;
  }
}

const GITHUB = "https://github.com/cryptoduke01/gloam";

/* ---------- small pieces ---------- */

function CheckMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-mute transition-colors hover:bg-surface hover:text-foreground"
    >
      {copied ? (
        <CheckMark />
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function ExplorerLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-mute transition-colors hover:bg-surface hover:text-foreground"
    >
      Explorer <ArrowUpRight />
    </a>
  );
}

/* ---------- the contracts ---------- */

type Row = { name: string; what: string; address: string };

function chainRows(n: GloamNetwork): Row[] {
  const rows: Row[] = [];
  if (n.pool) {
    rows.push({
      name: "Vault",
      what: "Holds every private balance. Releases money only for a valid proof.",
      address: n.pool,
    });
  }
  if (n.payMemo) {
    rows.push({
      name: "Payment messages",
      what: "Encrypted notes that let a recipient find a payment with their Gloam address.",
      address: n.payMemo.address,
    });
  }
  const router = vaultSwapRouter(n.chainId);
  if (router) {
    rows.push({
      name: "Swap router",
      what: "Swaps one note through a public DEX and back into the vault. No owner, no admin, no upgrade.",
      address: router,
    });
  }
  return rows;
}

const CHAIN_LOGOS: Record<ChainFamily, string> = {
  robinhood: "/brand/logos/robinhood.png",
  tempo: "/brand/logos/tempo.svg",
};

const NETWORK_LINES: Record<NetworkKey, string> = {
  robinhood: "Robinhood Chain testnet",
  tempo: "Tempo Moderato testnet",
  "robinhood-mainnet": "Robinhood Chain mainnet",
  "tempo-mainnet": "Tempo mainnet",
};

/** Every network Gloam runs on: each mainnet once its pool is in, then the two testnets. */
const CHAINS: { key: NetworkKey; logo: string; testnet: string }[] = NETWORK_KEYS.map((key) => ({
  key,
  logo: CHAIN_LOGOS[getNetwork(key).family],
  testnet: NETWORK_LINES[key],
}));

function ChainCard({ chainKey, logo, testnet }: { chainKey: NetworkKey; logo: string; testnet: string }) {
  const n = getNetwork(chainKey);
  const rows = chainRows(n);
  return (
    <div className="gl-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Image src={logo} alt="" width={28} height={28} className="h-7 w-7 rounded-lg ring-1 ring-line" />
          <div>
            <p className="text-[16px] text-foreground">{n.label}</p>
            <p className="tnum text-[12.5px] text-mute">
              {testnet}, chain {n.chainId}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12px] text-soft">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
          {n.status === "live" ? "Live" : "Planned"}
        </span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.name} className="px-5 py-4 sm:px-6">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] lg:items-center lg:gap-8">
              <div className="min-w-0">
                <p className="text-[15px] text-foreground">{r.name}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-mute">{r.what}</p>
              </div>
              <div className="flex min-w-0 flex-wrap items-center rounded-xl bg-surface py-1 pl-3.5 pr-1 sm:flex-nowrap sm:gap-1">
                <span
                  className="tnum min-w-0 flex-1 basis-full break-all pb-1 pr-2 pt-2.5 text-[13.5px] leading-snug text-foreground sm:basis-auto sm:truncate sm:p-0"
                  title={r.address}
                >
                  {r.address}
                </span>
                <div className="-ml-3 flex shrink-0 items-center sm:ml-0">
                  <CopyButton value={r.address} label={`${n.label} ${r.name.toLowerCase()} address`} />
                  <ExplorerLink href={n.explorerAddress(r.address)} />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FACTS = [
  {
    title: "No admin withdraw",
    body: "The vault has no function that lets anyone, the Gloam team included, take money out. Only a valid proof from the owner of a balance can.",
  },
  {
    title: "Three days of public notice",
    body: "Setup is closed. Any change to how proofs, rates or prices are checked waits behind a public three day timelock on-chain.",
  },
  {
    title: "The relay cannot redirect",
    body: "Private sends and cash outs can go through the Gloam relay, and swaps always do. The proofs fix where the money goes, so the relay can only submit or refuse.",
  },
  {
    title: "Open source",
    body: "Contracts, circuits, app and SDK are public. Compare what is deployed with the repo yourself.",
  },
];

/** Once mainnet is live: the beta deposit limits sit next to the facts above. */
const LIVE_FACTS = [
  ...FACTS,
  {
    title: "Beta deposit limits",
    body: "On mainnet each stablecoin takes up to 500 per deposit and 25,000 in total, and $GLOAM 25,000 and 250,000. Cash outs and private payments are never limited. Raising a limit waits the same three days; lowering one is instant.",
  },
];

/**
 * After a proof is checked: the person who opened it can make one of their
 * own. Shown under every finished result, shared link or pasted.
 */
function MakeYourOwn({ from }: { from: "link" | "page" }) {
  const live = useMainnetLive();
  return (
    <div className="gl-card mt-4 p-5 sm:p-7">
      <p className="text-[18px] leading-snug tracking-[-0.01em] text-foreground">Make your own proof</p>
      <p className="mt-1.5 max-w-[52ch] text-[14px] leading-relaxed text-mute">
        Prove you hold at least an amount, that you paid someone, or what a payroll run added up to.
        Nothing else about you shows.
      </p>
      <AppLink
        href="/app/disclose"
        onClick={() => track("verify_make_own", { from })}
        className="btn btn-ink btn-lg btn-block mt-5 sm:w-auto"
      >
        Make your own proof
      </AppLink>
      <p className="mt-3 text-[12.5px] leading-relaxed text-mute">
        {live
          ? "Add money privately, then prove only what you choose. The testnet is free for practice."
          : "Free on testnet: add some test money privately, then prove only what you choose."}
      </p>
    </div>
  );
}

/** The result of a check, in the order it appears: working, refused, or the verdict. */
function ResultView({ result }: { result: Result }) {
  if (result.kind === "checking") {
    return (
      <div className="gl-card mt-4 p-5 sm:p-7" aria-live="polite">
        <div className="h-6 w-24 animate-pulse rounded-full bg-surface" />
        <div className="mt-5 h-9 w-3/4 animate-pulse rounded-lg bg-surface" />
        <p className="mt-4 text-[13.5px] text-mute">{result.step}…</p>
      </div>
    );
  }
  if (result.kind === "bad") {
    return (
      <div role="alert" className="mt-4 rounded-[18px] bg-danger-soft p-5 sm:p-6">
        <p className="text-[13px] font-medium text-danger">{result.title ?? "Not verified"}</p>
        <p className="mt-1.5 text-[15px] text-foreground">{result.reason}</p>
      </div>
    );
  }
  if (result.kind === "proof") return <ProofVerdict proof={result.p} result={result.r} checkedAt={result.at} />;
  if (result.kind === "legacy") {
    return (
      <div role="alert" className="mt-4 rounded-[18px] bg-warn-soft p-5 sm:p-6">
        <p className="text-[13px] font-medium text-warn">Can&apos;t confirm who holds this</p>
        <p className="tnum mt-1.5 text-[15px] text-foreground">
          {`It claims ${amountOf(result.d.amount, assetAddress(result.d.asset))} ${symbolOf(
            assetAddress(result.d.asset),
            Number(result.d.chainId)
          )} in Gloam's vault.`}
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-soft">{LEGACY_DISCLOSURE}</p>
      </div>
    );
  }
  return null;
}

export default function VerifyPage() {
  const urlProof = useSyncExternalStore(onUrlChange, proofFromUrl, noProof);
  const [typed, setTyped] = useState<string | null>(null);
  const token = typed ?? urlProof ?? "";
  const [result, setResult] = useState<Result>({ kind: "idle" });
  // Opened from a shared link (and not swapped for another proof): the result
  // leads the page, phone first, instead of the hero.
  const shared = Boolean(urlProof) && typed === null;
  const live = useMainnetLive();

  // Opened from a shared link: check the proof straight away.
  useEffect(() => {
    if (!urlProof) return;
    const t = window.setTimeout(() => {
      setTyped(null); // a new link replaces whatever was pasted
      void onVerify(urlProof);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per proof in the link
  }, [urlProof]);

  /** Proof of funds, payment, exact balance and payroll total: decode, then every check in lib/proofs. */
  async function onVerifyProof(text: string) {
    setResult({ kind: "checking", step: "Reading the proof" });
    let p: AnyProof;
    try {
      p = decodeProof(text);
    } catch (e) {
      setResult({
        kind: "bad",
        title: "Could not read this proof",
        reason:
          e instanceof Error && e.message !== "Not a Gloam proof."
            ? e.message
            : "That does not look like a Gloam proof. Check that you copied all of it.",
      });
      return;
    }
    try {
      setResult({ kind: "checking", step: "Checking it against the vault" });
      const r = await verifyProof(p);
      setResult({ kind: "proof", p, r, at: Math.floor(Date.now() / 1000) });
      // Which kind and whether it held, never the proof or who it was for.
      track("proof_verified", { kind: p.kind, ok: r.ok });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setResult({
        kind: "bad",
        title: "Could not check this proof",
        reason: /not built yet/i.test(msg)
          ? "This version of the verifier cannot check this kind of proof yet. Try again after the next update."
          : msg || "Something went wrong while checking. Try again in a moment.",
      });
    }
  }

  async function onVerify(input: string = token) {
    if (isGloamProof(input)) return onVerifyProof(input);
    setResult({ kind: "checking", step: "Reading the proof" });
    let d: Disclosure;
    try {
      d = decodeDisclosure(input);
    } catch {
      setResult({ kind: "bad", reason: "That is not a valid Gloam proof." });
      return;
    }

    try {
      setResult({ kind: "checking", step: "Checking the proof" });
      const proofOk = await verifyDisclosureProof(d);
      track("proof_verified", { kind: "balance", ok: false });
      if (!proofOk) {
        setResult({ kind: "bad", reason: "The proof did not verify." });
        return;
      }
      const net = networkForChain(Number(d.chainId));
      if (!net?.pool || typeof d.pool !== "string" || net.pool.toLowerCase() !== d.pool.toLowerCase()) {
        setResult({
          kind: "bad",
          reason: "This proof points at a vault that is not Gloam's current vault, so its balance cannot be trusted.",
        });
        return;
      }
      // Every deposit publishes a valid proof of this same statement, so a
      // copy of it shows nothing about who holds the money. No chain lookup.
      setResult({ kind: "legacy", d });
    } catch (e) {
      setResult({
        kind: "bad",
        reason: e instanceof Error ? e.message : "Verification failed.",
      });
    }
  }

  const checking = result.kind === "checking";
  const finished = result.kind === "proof" || result.kind === "legacy" || result.kind === "bad";

  /** Leave the shared proof for the paste box, without the old proof in the address bar. */
  function checkAnother() {
    window.history.replaceState(null, "", "/verify");
    setTyped("");
    setResult({ kind: "idle" });
    // straight to the paste box (on a phone the section heading sits far above it)
    window.setTimeout(() => {
      const box = document.getElementById("disc");
      box?.scrollIntoView({ block: "center" });
      box?.focus({ preventScroll: true });
    }, 0);
  }

  return (
    <div className="relative min-h-screen bg-panel text-foreground">
      <Header />

      <main>
        {shared && (
          <section className="mx-auto max-w-[680px] px-5 pb-16 pt-8 sm:pb-24 sm:pt-14">
            <p className="t-label">Shared with you</p>
            <h1 className="mt-3 text-balance text-[34px] font-light leading-[1.08] tracking-[-0.02em] sm:text-[46px]">
              A Gloam proof, checked here
            </h1>
            <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-soft">
              Your browser checks it against Gloam&apos;s vault on chain. Nothing is sent to Gloam, and you
              need no wallet or account.
            </p>
            <ResultView result={result} />
            {finished && <MakeYourOwn from="link" />}
            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
              <button
                type="button"
                onClick={checkAnother}
                className="t-label inline-flex min-h-10 items-center gap-1.5 text-foreground transition-colors hover:text-sealed"
              >
                Check a different proof <span aria-hidden>→</span>
              </button>
              <Link
                href="/docs/proofs"
                className="t-label inline-flex min-h-10 items-center gap-1.5 text-foreground transition-colors hover:text-sealed"
              >
                How proofs work <span aria-hidden>→</span>
              </Link>
            </div>
          </section>
        )}

        {/* hero */}
        {!shared && (
          <section className="mx-auto max-w-[1400px] px-4 pt-3 sm:px-7 sm:pt-6">
            <div className="gl-panel flex min-h-[560px] flex-col justify-end px-6 pb-8 pt-24 sm:px-12 sm:pb-12 lg:min-h-[620px]">
              <FlowField />
              <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:gap-14">
                <div className="max-w-[720px]">
                  <p className="t-label">Verify</p>
                  <h1 className="t-display-xl mt-5">Check it yourself</h1>
                  <p className="mt-6 max-w-[48ch] text-[16px] leading-relaxed text-soft sm:text-[17px]">
                    Two things anyone can check without asking us: a proof someone
                    shared with you, and the contracts that hold the money. No
                    wallet, no account.
                  </p>
                  <div className="mt-8 flex flex-wrap gap-2">
                    <a href="#proof" className="btn btn-ink btn-lg">
                      Verify a proof
                    </a>
                    <a href="#contracts" className="btn btn-ghost btn-lg">
                      See the contracts
                    </a>
                  </div>
                </div>

                <div className="gl-glass w-full p-2 lg:max-w-[420px] lg:justify-self-end">
                  <div className="rounded-[12px] bg-panel p-4 sm:p-5">
                    <p className="text-[13px] text-mute">What the code allows</p>
                    <ul className="mt-2 divide-y divide-line">
                      {[
                        ["Admin withdraw", "Does not exist"],
                        ["Rule changes", "3-day public notice"],
                        ["Relay", "Submit or refuse only"],
                        ["Source", "Public on GitHub"],
                      ].map(([k, v]) => (
                        <li key={k} className="flex min-h-[48px] items-center justify-between gap-4 text-[14px]">
                          <span className="text-mute">{k}</span>
                          <span className="inline-flex items-center gap-2 text-right text-foreground">
                            {v}
                            <span className="text-sealed">
                              <CheckMark size={15} />
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* verify a proof */}
        {!shared && (
          <section id="proof" className="mx-auto max-w-[1240px] scroll-mt-20 px-6 py-20 sm:py-28">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
              <div>
                <h2 className="t-display-l max-w-[12ch]">Verify a proof</h2>
                <p className="mt-5 max-w-[46ch] text-[16px] leading-relaxed text-mute">
                  Someone sent you a Gloam proof. Paste it here to check it: an
                  exact balance, a minimum they hold, a private payment, or the
                  total of a payroll run they paid. You see only what they chose
                  to prove, and nothing about who they are or what else they hold.
                </p>
                <ul className="mt-10 divide-y divide-line border-y border-line text-[15px]">
                  <li className="flex justify-between gap-6 py-4">
                    <span>The proof</span>
                    <span className="text-right text-mute">Checked in your browser</span>
                  </li>
                  <li className="flex justify-between gap-6 py-4">
                    <span>The vault</span>
                    <span className="text-right text-mute">Looked up on chain</span>
                  </li>
                  <li className="flex justify-between gap-6 py-4">
                    <span>Sent to Gloam</span>
                    <span className="text-right text-mute">Nothing</span>
                  </li>
                </ul>
                <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
                  <AppLink
                    href="/app/disclose"
                    className="t-label inline-flex items-center gap-1.5 text-foreground transition-colors hover:text-sealed"
                  >
                    Make a proof of your own <span aria-hidden>→</span>
                  </AppLink>
                  <Link
                    href="/docs/proofs"
                    className="t-label inline-flex items-center gap-1.5 text-foreground transition-colors hover:text-sealed"
                  >
                    How proofs work <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>

              <div className="min-w-0">
                <div className="gl-card p-5 sm:p-7">
                  <label htmlFor="disc" className="text-[13px] text-mute">
                    Proof
                  </label>
                  <textarea
                    id="disc"
                    value={token}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder="gloamfunds1:…"
                    rows={6}
                    spellCheck={false}
                    className="tnum mt-2 w-full resize-y break-all rounded-xl border border-line-strong bg-panel px-4 py-3.5 text-[16px] leading-relaxed sm:text-[14px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-foreground focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--foreground)_12%,transparent)]"
                  />
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[12.5px] text-faint">
                      Starts with gloamfunds1:, gloampay1:, gloamroll1: or gloambal1:
                    </p>
                    <button
                      type="button"
                      onClick={() => void onVerify()}
                      disabled={!token.trim() || checking}
                      className="btn btn-ink"
                    >
                      {checking ? (result as { step: string }).step + "…" : "Verify"}
                    </button>
                  </div>
                </div>

                {result.kind !== "checking" && <ResultView result={result} />}
                {finished && <MakeYourOwn from="page" />}
              </div>
            </div>
          </section>
        )}

        {/* the contracts */}
        <section id="contracts" className="mx-auto max-w-[1400px] scroll-mt-20 px-4 sm:px-7">
          <div className="gl-panel bg-surface px-5 py-14 sm:px-12 sm:py-20">
            <SealedField tone="soft" />
            <div className="relative mx-auto max-w-[1120px]">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-[640px]">
                  <h2 className="t-display-l">The contracts</h2>
                  <p className="mt-5 max-w-[54ch] text-[16px] leading-relaxed text-mute">
                    {live ? (
                      <>
                        Gloam runs on Robinhood Chain and Tempo, on mainnet and on
                        testnet. The mainnet vaults hold payments, and private swaps
                        run through a separate router on each mainnet. Every address
                        links to the public explorer, and the source behind each one
                        is on GitHub.
                      </>
                    ) : (
                      <>
                        The same contracts run on two chains. Every address links to
                        the public explorer, and the source behind each one is on
                        GitHub.
                      </>
                    )}
                  </p>
                </div>
                <a
                  href={`${GITHUB}/tree/main/contracts`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost self-start lg:self-auto"
                >
                  Read the source <ArrowUpRight />
                </a>
              </div>
              <div className="mt-12 grid grid-cols-1 gap-4">
                {CHAINS.map((c) => (
                  <ChainCard key={c.key} chainKey={c.key} logo={c.logo} testnet={c.testnet} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* no middlemen */}
        <section className="mx-auto max-w-[1240px] px-6 pb-8 pt-20 sm:pt-28">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_2fr]">
            <div>
              <h2 className="t-display-l max-w-[10ch]">No middlemen</h2>
              <p className="mt-5 max-w-[34ch] text-[15px] leading-relaxed text-mute">
                {live ? (
                  <>
                    Mainnet proofs use the final keys from the trusted setup, which
                    closed on 17 October with 13 contributors. The testnet keeps
                    development keys and play money. Gloam was reviewed internally
                    before launch, and an external audit is planned. It is beta
                    software handling real money.
                  </>
                ) : (
                  <>
                    Testnet with play money, so testnet proofs still use development
                    keys. The production trusted setup closed on 17 October with 13
                    contributors, and mainnet uses its final keys. It was reviewed
                    internally before launch, and an external audit is planned.
                  </>
                )}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
              {(live ? LIVE_FACTS : FACTS).map((f) => (
                <div key={f.title} className="border-t border-foreground pt-5">
                  <p className="flex items-center gap-2.5 text-[18px] leading-snug tracking-[-0.01em]">
                    <span className="shrink-0 text-sealed">
                      <CheckMark size={17} />
                    </span>
                    {f.title}
                  </p>
                  <p className="mt-3 text-[14px] leading-relaxed text-mute">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
