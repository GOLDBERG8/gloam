"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Logo } from "@/components/Logo";
import { useMainnetLive } from "@/components/MainnetCountdown";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SealedField } from "@/components/ui/SealedField";
import {
  discoverWallets,
  portal,
  PortalError,
  signInWith,
  type KeyView,
  type PartnerAccount,
  type Stats,
  type WalletChoice,
} from "./client";
import { KeysPanel } from "./KeysPanel";
import { Overview } from "./Overview";
import { QuickstartPanel } from "./QuickstartPanel";
import { SettingsPanel } from "./SettingsPanel";
import { Field, Notice, shortAddr } from "./ui";

type Session = { wallet: string; partner: PartnerAccount | null };
type Tab = "overview" | "keys" | "settings" | "quickstart";

/** id, label, shorter label for phones */
const TABS: [Tab, string, string][] = [
  ["overview", "Overview", "Overview"],
  ["keys", "API keys", "Keys"],
  ["settings", "Fees and payouts", "Fees"],
  ["quickstart", "Quickstart", "Quickstart"],
];

/* ---------------------------------------------------------------- shells */

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background p-3 sm:p-4">
      <div className="gl-panel flex flex-1 flex-col">
        <SealedField />
        <header className="flex h-16 items-center justify-between px-4 sm:px-8">
          <Logo />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Link href="/partners" className="btn btn-quiet btn-sm">
              About the program
            </Link>
          </div>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center px-1 py-10 sm:px-5">
          <div className="w-full max-w-[440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SignIn({ onSignedIn, initialError }: { onSignedIn: () => void; initialError: string | null }) {
  const [wallets, setWallets] = useState<WalletChoice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(initialError);
  const mainnetLive = useMainnetLive();

  useEffect(() => {
    let live = true;
    void discoverWallets().then((w) => {
      if (live) setWallets(w);
    });
    return () => {
      live = false;
    };
  }, []);

  async function go(w: WalletChoice) {
    setBusy(w.id);
    setErr(null);
    try {
      await signInWith(w.provider);
      onSignedIn();
    } catch (e) {
      setErr(e instanceof PortalError ? e.message : "Sign-in did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Centered>
      <div className="gl-glass p-2 shadow-pop">
        <div className="rounded-[12px] bg-panel p-6 sm:p-7">
          <p className="t-label">Partner portal</p>
          <h1 className="t-display-m mt-3 text-foreground">Sign in with your wallet</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-mute">
            Use the wallet that will own your partner account. You sign a short message to prove it is yours. It costs nothing and
            moves no money.
          </p>
          <div className="mt-7 space-y-2">
            {wallets === null ? (
              <div className="h-12 rounded-full bg-surface motion-safe:animate-pulse" aria-busy="true" />
            ) : wallets.length === 0 ? (
              <Notice>
                No browser wallet found. Install one, such as MetaMask or Rabby, or open this page in your wallet&apos;s own
                browser.
              </Notice>
            ) : (
              wallets.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void go(w)}
                  className="btn btn-ink btn-lg btn-block"
                >
                  {w.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.icon} alt="" width={20} height={20} className="h-5 w-5 rounded-[6px]" />
                  )}
                  {busy === w.id ? "Check your wallet…" : wallets.length > 1 ? `Sign in with ${w.name}` : "Connect and sign in"}
                </button>
              ))
            )}
          </div>
          {err && (
            <div className="mt-4">
              <Notice tone="danger">{err}</Notice>
            </div>
          )}
        </div>
      </div>
      <p className="mt-5 text-center text-[12.5px] leading-relaxed text-mute">
        {mainnetLive ? "Partner fees are not charged yet, on mainnet or testnet." : "Testnet program. Nothing is charged."}{" "}
        <Link href="/docs/partners" className="text-foreground underline decoration-line-strong underline-offset-4 hover:decoration-foreground">
          How it works
        </Link>
      </p>
    </Centered>
  );
}

function Onboard({ wallet, onDone, onSignOut }: { wallet: string; onDone: (p: PartnerAccount) => void; onSignOut: () => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await portal<{ partner: PartnerAccount }>("/account", { method: "PUT", body: { name, website } });
      onDone(r.partner);
    } catch (e) {
      setErr(e instanceof PortalError ? e.message : "Could not create the account. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <div className="gl-glass p-2 shadow-pop">
        <form onSubmit={submit} className="rounded-[12px] bg-panel p-6 sm:p-7">
          <p className="t-label">Signed in as {shortAddr(wallet)}</p>
          <h1 className="t-display-m mt-3 text-foreground">Tell us about your app</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-mute">
            This names your account. You set your fee and make keys next.
          </p>
          <div className="mt-6 space-y-4">
            <Field label="App name" htmlFor="ob-name">
              <input
                id="ob-name"
                className="gl-input"
                maxLength={60}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Pay"
                autoFocus
              />
            </Field>
            <Field label="Website (optional)" htmlFor="ob-site">
              <input id="ob-site" className="gl-input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
            </Field>
          </div>
          {err && (
            <div className="mt-4">
              <Notice tone="danger">{err}</Notice>
            </div>
          )}
          <button type="submit" disabled={busy || name.trim().length < 2} className="btn btn-ink btn-lg btn-block mt-6">
            {busy ? "Creating…" : "Create partner account"}
          </button>
          <button type="button" onClick={onSignOut} className="btn btn-quiet btn-sm btn-block mt-2">
            Use another wallet
          </button>
        </form>
      </div>
    </Centered>
  );
}

/* ---------------------------------------------------------------- dashboard */

function Dashboard({ session, onSignOut, onPartner }: { session: Session & { partner: PartnerAccount }; onSignOut: () => void; onPartner: (p: PartnerAccount) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [keys, setKeys] = useState<KeyView[] | null>(null);
  const [keyMeta, setKeyMeta] = useState({ maxActive: 10, liveKeys: false });
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const mainnetLive = useMainnetLive();
  const partner = session.partner;

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await portal<Stats>("/stats"));
      setErr(null);
    } catch (e) {
      if (e instanceof PortalError && e.status === 401) return onSignOut();
      setErr(e instanceof PortalError ? e.message : "Could not load your figures.");
    } finally {
      setStatsLoading(false);
    }
  }, [onSignOut]);

  const loadKeys = useCallback(async () => {
    try {
      const r = await portal<{ keys: KeyView[]; maxActive: number; liveKeys: boolean }>("/keys");
      setKeys(r.keys);
      setKeyMeta({ maxActive: r.maxActive, liveKeys: r.liveKeys });
    } catch (e) {
      if (e instanceof PortalError && e.status === 401) return onSignOut();
      setErr(e instanceof PortalError ? e.message : "Could not load your keys.");
    }
  }, [onSignOut]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setOrigin(window.location.origin);
      try {
        const saved = window.sessionStorage.getItem("gloam.partners.tab");
        if (saved && TABS.some(([id]) => id === saved)) setTab(saved as Tab);
      } catch {
        /* storage off */
      }
      void loadStats();
      void loadKeys();
    }, 0);
    // Tracked live: refresh the figures while the tab is visible.
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadStats();
    }, 20_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, [loadStats, loadKeys]);

  function choose(t: Tab) {
    setTab(t);
    try {
      window.sessionStorage.setItem("gloam.partners.tab", t);
    } catch {
      /* storage off */
    }
  }

  const activeKeys = (keys ?? []).filter((k) => k.revokedAt === null).length;

  return (
    <div className="gloam-app min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-[12px] text-mute">Partners</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="tnum mr-1 hidden rounded-full bg-panel px-3 py-1.5 text-[12.5px] text-soft sm:inline" title={session.wallet}>
              {shortAddr(session.wallet)}
            </span>
            <ThemeToggle />
            <button type="button" onClick={onSignOut} className="btn btn-quiet btn-sm">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] space-y-7 px-4 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="t-display-m truncate">{partner.name}</h1>
            <p className="mt-2 text-[14px] text-mute">
              {mainnetLive
                ? "Nothing is charged yet, on mainnet or testnet. Fees show what your setting would have earned."
                : "Testnet. Nothing is charged. Fees show what your setting would have earned."}
            </p>
          </div>
          <div
            role="tablist"
            aria-label="Partner portal sections"
            className="flex max-w-full self-start overflow-x-auto rounded-full bg-surface-2 p-1 text-[13px] lg:self-auto"
          >
            {TABS.map(([id, label, short]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls="partner-panel"
                onClick={() => choose(id)}
                className={`h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 transition-colors sm:px-4 ${
                  tab === id ? "bg-panel font-medium text-foreground shadow-card" : "text-mute hover:text-foreground"
                }`}
              >
                <span className="sm:hidden">{short}</span>
                <span className="max-sm:hidden">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {err && <Notice tone="danger">{err}</Notice>}

        <div id="partner-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-w-0">
          {tab === "overview" && (
            <Overview stats={stats} fees={partner.fees} activeKeys={activeKeys} loading={statsLoading} onQuickstart={() => choose("quickstart")} />
          )}
          {tab === "keys" && <KeysPanel keys={keys} maxActive={keyMeta.maxActive} liveKeys={keyMeta.liveKeys} onChanged={() => void loadKeys()} />}
          {tab === "settings" && (
            <SettingsPanel
              partner={partner}
              onSaved={(p) => {
                onPartner(p);
                void loadStats();
              }}
            />
          )}
          {tab === "quickstart" && (
            <QuickstartPanel origin={origin} hasKey={activeKeys > 0} liveKeys={keyMeta.liveKeys} onKeys={() => choose("keys")} />
          )}
        </div>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- root */

export function PartnerDashboard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSession(await portal<Session>("/session"));
    } catch (e) {
      if (e instanceof PortalError && e.status !== 401) setError(e.message);
      setSession(null);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const signOut = useCallback(async () => {
    await portal("/session", { method: "DELETE" }).catch(() => null);
    setSession(null);
  }, []);

  if (session === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3" role="status">
          <span className="livedot h-2 w-2 rounded-full bg-foreground/60" />
          <p className="t-label">Checking your session</p>
        </div>
      </div>
    );
  }
  if (!session) return <SignIn onSignedIn={() => void load()} initialError={error} />;
  if (!session.partner) {
    return (
      <Onboard
        wallet={session.wallet}
        onSignOut={() => void signOut()}
        onDone={(p) => setSession({ wallet: session.wallet, partner: p })}
      />
    );
  }
  return (
    <Dashboard
      session={session as Session & { partner: PartnerAccount }}
      onSignOut={signOut}
      onPartner={(p) => setSession({ wallet: session.wallet, partner: p })}
    />
  );
}
