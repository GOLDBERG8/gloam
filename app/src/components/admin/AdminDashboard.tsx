"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { Logo } from "@/components/Logo";
import { SealedField } from "@/components/ui/SealedField";
import { shortAddress } from "@/lib/chain";
import { MAINNET_ENABLED, NETWORK_KEYS, getNetwork, isNetworkKey, networkName, type GloamNetwork } from "@/lib/networks";
import type { CreatorFees } from "@/lib/creatorFees";
import type { CombinedRevenue, DayRow, NetworkMetrics, OnchainMetrics, Windowed } from "@/lib/onchainMetrics";
import type { DailyCounters, StoredEvent } from "@/lib/tractionStore";
import type { FunnelDay } from "@/lib/funnelStore";
import { relayChainName } from "@/lib/bridge";
import type { RelayVolume } from "@/lib/relayVolume";
import { ArrowUpRight } from "@/components/ui/ArrowUpRight";

type MetricsPayload = {
  ok: boolean;
  generatedAt?: string;
  launch?: {
    open: boolean;
    forceOpen: boolean;
    opensAt: string;
    opensAtMs: number;
  };
  onchain?: OnchainMetrics | { error: string };
  product?: {
    backend: "redis" | "memory";
    totalEvents: number;
    counters: Record<string, number>;
    dims?: Record<string, number>;
    daily?: DailyCounters[];
    recent: StoredEvent[];
  };
  /** Claim-link totals per UTC day, oldest first (lib/funnel). */
  claimLinks?: FunnelDay[];
  /** Bridges and swaps tagged to Gloam at Relay (lib/relayVolume). */
  relay?: RelayVolume | { error: string };
  /** Revenue switches read from env (bridge app fee). */
  revenueConfig?: { bridgeFeeBps: number | null };
  error?: string;
};

type Tab = "overview" | "revenue" | "relay" | "users" | "events" | "partners" | "testers" | "bugs";

/** Events added for proofs, the public ledger, requests and notes; shown first in the breakdowns. */
/** How often an open admin tab refreshes. Only while it is on screen: each refresh reads Redis. */
const ADMIN_REFRESH_MS = 60_000;

const NEW_EVENTS = [
  "proof_created",
  "proof_create_failed",
  "verify_page_view",
  "transparency_view",
  "transparency_tab",
  "payment_request_created",
  "payment_request_opened",
  "payment_request_paid",
  "private_note_added",
  "bridge_address_created",
  "bridge_arrived",
  "swap_review",
  "swap_submit",
  "swap_success",
];

/** Payroll events come from the payroll flow; the first name present is the one counted. */
const PAYROLL_KEYS = ["payroll_run_finished", "payroll_run_success", "payroll_run_paid", "payroll_run", "payroll_run_submit", "payroll_paid"];

const KIND_LABEL: Record<string, string> = {
  deposit: "Deposit",
  transfer: "Private transfer",
  cashout: "Cash-out",
  trade: "Private trade",
};

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "Not priced";
  if (n > 0 && n < 0.01) return "<$0.01";
  return usdFmt.format(n);
}

function fmtWhen(ts: number | null | undefined): string {
  if (!ts) return "None yet";
  return new Date(ts * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtAge(sec: number): string {
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

function n(v: number | undefined): string {
  return (v ?? 0).toLocaleString("en-US");
}

export function AdminDashboard() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/session", { credentials: "include" });
      if (res.status === 503) {
        setAuthed(false);
        setLoginErr("ADMIN_ACCESS_CODE is not set on the server.");
        return false;
      }
      if (res.status === 401) {
        setAuthed(false);
        return false;
      }
      if (!res.ok) {
        setAuthed(false);
        setLoginErr("Could not verify session.");
        return false;
      }
      setAuthed(true);
      return true;
    } catch {
      setAuthed(false);
      setLoginErr("Network error checking session.");
      return false;
    }
  }, []);

  const loadMetrics = useCallback(async (fresh = false) => {
    setLoadErr(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/metrics${fresh ? "?fresh=1" : ""}`, { credentials: "include" });
      if (res.status === 401) {
        setAuthed(false);
        setData(null);
        return;
      }
      // Session is valid if we got past 401, don't freeze on metrics failure
      setAuthed(true);
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setLoadErr(json?.error ?? `Metrics failed (${res.status})`);
        return;
      }
      const json = (await res.json()) as MetricsPayload;
      setData(json);
    } catch (e) {
      // Keep dashboard shell if session was already true
      setLoadErr(e instanceof Error ? e.message : "Network error loading metrics");
      setAuthed((prev) => (prev === null ? false : prev));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const ok = await checkSession();
      if (ok) await loadMetrics();
    })();
  }, [checkSession, loadMetrics]);

  useEffect(() => {
    if (!authed) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMetrics();
    }, ADMIN_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [authed, loadMetrics]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLoginErr(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        credentials: "include",
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setLoginErr(json.error ?? "Login failed");
        setAuthed(false);
        return;
      }
      setCode("");
      setAuthed(true);
      await loadMetrics();
    } catch {
      setLoginErr("Network error");
      setAuthed(false);
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "include",
    });
    setAuthed(false);
    setData(null);
  }

  // Hooks must run every render (before any early return), React #310
  const oc = data?.onchain && "networks" in data.onchain ? data.onchain : null;
  const ocError = data?.onchain && !("networks" in data.onchain) ? data.onchain.error : null;
  const product = data?.product;
  const relay = data?.relay;
  const counters = useMemo(() => product?.counters ?? {}, [product?.counters]);

  const funnel = useMemo(() => {
    const payrollKey = PAYROLL_KEYS.find((k) => counters[k] != null) ?? PAYROLL_KEYS[0];
    const steps = [
      { k: "App views", v: counters.app_view ?? 0, sub: "app_view" },
      { k: "Wallet connects", v: counters.wallet_connect ?? 0, sub: "wallet_connect" },
      {
        k: "First deposits",
        v: oc?.combined.depositors ?? 0,
        sub: "unique depositor wallets, on-chain",
      },
      {
        k: "Private sends and payments",
        v: counters.private_send_submit ?? 0,
        sub: `private_send_submit, ${n(oc?.combined.transfers)} landed on-chain`,
      },
      { k: "Proofs created", v: counters.proof_created ?? 0, sub: "proof_created" },
      { k: "Payroll runs", v: counters[payrollKey] ?? 0, sub: payrollKey },
    ];
    const max = Math.max(1, ...steps.map((s) => s.v));
    return steps.map((s) => ({ ...s, pct: (s.v / max) * 100 }));
  }, [counters, oc]);

  const claim = useMemo(() => {
    const rows = data?.claimLinks ?? [];
    const t = { link_created: 0, link_opened: 0, link_claimed: 0, claimer_sent: 0 };
    for (const r of rows) {
      t.link_created += r.link_created;
      t.link_opened += r.link_opened;
      t.link_claimed += r.link_claimed;
      t.claimer_sent += r.claimer_sent;
    }
    const rate = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}% of ${b === t.link_created ? "links made" : "claims"}` : "");
    const steps = [
      { k: "Claim links made", v: t.link_created, sub: "the payment landed" },
      { k: "Opened in Gloam", v: t.link_opened, sub: rate(t.link_opened, t.link_created) },
      { k: "Claimed", v: t.link_claimed, sub: rate(t.link_claimed, t.link_created) },
      { k: "Claimers who then paid someone", v: t.claimer_sent, sub: rate(t.claimer_sent, t.link_claimed) },
    ];
    const max = Math.max(1, ...steps.map((s) => s.v));
    return { steps: steps.map((s) => ({ ...s, pct: (s.v / max) * 100 })), rows: [...rows].reverse() };
  }, [data?.claimLinks]);

  const days = useMemo(() => {
    const eventsByDay = new Map((product?.daily ?? []).map((d) => [d.day, d.counters]));
    const chain = oc?.combined.daily ?? [];
    const allDays = chain.length ? chain.map((d) => d.day) : (product?.daily ?? []).map((d) => d.day);
    const byDay = new Map<string, DayRow>(chain.map((d) => [d.day, d]));
    return allDays
      .map((day) => ({ day, chain: byDay.get(day) ?? null, ev: eventsByDay.get(day) ?? {} }))
      .reverse();
  }, [oc, product?.daily]);

  const breakdowns = useMemo(() => {
    const groups = new Map<string, { field: string; value: string; v: number }[]>();
    for (const [key, v] of Object.entries(product?.dims ?? {})) {
      const [event, pair] = key.split("|");
      if (!event || !pair) continue;
      const [field, value] = pair.split("=");
      const list = groups.get(event) ?? [];
      list.push({ field, value: value ?? "", v });
      groups.set(event, list);
    }
    const rank = (e: string) => {
      const i = NEW_EVENTS.indexOf(e);
      return i === -1 ? NEW_EVENTS.length : i;
    };
    return [...groups.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .map(([event, list]) => ({
        event,
        list: list.sort((a, b) => a.field.localeCompare(b.field) || b.v - a.v),
      }));
  }, [product?.dims]);

  if (authed === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <span className="livedot h-2 w-2 rounded-full bg-foreground/60" />
          <p className="t-label">Verifying session</p>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="flex min-h-dvh flex-col bg-background p-3 sm:p-4">
        <div className="gl-panel flex flex-1 flex-col">
          <SealedField />
          <header className="flex h-16 items-center justify-between px-5 sm:px-8">
            <Logo />
            <span className="rounded-full bg-panel/70 px-3 py-1 text-[12px] text-mute">
              Restricted
            </span>
          </header>

          <main className="flex flex-1 flex-col items-center justify-center px-2 py-12 sm:px-5">
            <div className="w-full max-w-[420px]">
              <div className="gl-glass p-2 shadow-pop">
                <div className="rounded-[12px] bg-panel p-6 sm:p-7">
                  <p className="t-label">Ops console</p>
                  <h1 className="t-display-m mt-3 text-foreground">Traction</h1>
                  <p className="mt-2 text-[14px] leading-relaxed text-mute">
                    On-chain volume, unique wallets, and product funnel. Access
                    code required. Not public.
                  </p>

                  <form onSubmit={onLogin} className="mt-7 space-y-4">
                    <label className="block">
                      <span className="text-[13px] text-mute">Access code</span>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="••••••••••••"
                        className="gl-input mt-2"
                        required
                      />
                    </label>
                    {loginErr && (
                      <p
                        className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger"
                        role="alert"
                      >
                        {loginErr}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={busy}
                      className="btn btn-ink btn-lg btn-block"
                    >
                      {busy ? "Checking…" : "Enter console"}
                    </button>
                  </form>
                </div>
              </div>
              <p className="mt-5 text-center text-[12px] text-mute">
                Set{" "}
                <code className="rounded-md bg-panel/70 px-1.5 py-0.5 text-foreground">
                  ADMIN_ACCESS_CODE
                </code>{" "}
                on Vercel
              </p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const nets = oc?.networks ?? [];
  const isTest = (m: NetworkMetrics) => m.testnet ?? getNetwork(m.key).testnet;
  const nameOf = (m: NetworkMetrics) => adminName(getNetwork(m.key));
  const hasTest = nets.some(isTest);
  // Real money first. Snapshots cached before the split carry only `combined`.
  const real = oc?.mainnet ?? oc?.combined;
  const test = oc?.testnet;
  const totalHeads = MAINNET_ENABLED && hasTest ? ["Mainnet total", "Testnet total"] : ["Total"];
  const byNetwork = (
    f: (m: NetworkMetrics) => ReactNode,
    total: (c: NonNullable<typeof real>) => ReactNode
  ): ReactNode[] => [
    ...nets.map((m) => f(m)),
    ...(totalHeads.length === 2 ? [real ? total(real) : "", test ? total(test) : ""] : [oc ? total(oc.combined) : ""]),
  ];
  // Revenue is real money only: mainnet vault fees plus $GLOAM creator fees.
  const realRev = oc?.mainnet?.revenue;
  const creator = oc?.creator && "earnedEth" in oc.creator ? oc.creator : null;
  const revenue = realRev ? revenueTotals(realRev, creator) : null;
  const testSub = (v: number | undefined, what: string) =>
    MAINNET_ENABLED && test ? `mainnet, real money; ${n(v)} ${what} on testnet` : "both networks, on-chain";

  return (
    <div className="gloam-app min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-3 px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-[12px] text-mute">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-2 hidden text-[12px] text-mute sm:inline">
              {product?.backend === "redis" ? "Redis" : "Memory"}, refreshes every 45s
            </span>
            <button
              type="button"
              onClick={() => void loadMetrics(true)}
              disabled={loading}
              className="btn btn-ghost btn-sm"
            >
              {loading ? "Reading…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="btn btn-quiet btn-sm"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] space-y-8 px-5 py-10 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="t-display-m">Traction</h1>
            <p className="mt-2 text-[14px] text-mute">
              On-chain activity on Robinhood Chain and Tempo, and the product funnel, in one place.
            </p>
          </div>
          {/* Tabs */}
          <div
            role="tablist"
            aria-label="Dashboard sections"
            className="flex self-start rounded-full bg-surface-2 p-1 text-[13px] sm:self-auto"
          >
            {(
              [
                ["overview", "Overview"],
                ["revenue", "Revenue"],
                ["relay", "Bridge and swaps"],
                ["users", "Wallets"],
                ["events", "Product events"],
                ["partners", "Partners"],
                ["testers", "Testers"],
                ["bugs", "Bug reports"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`h-9 rounded-full px-3.5 transition-colors sm:px-4 ${
                  tab === id
                    ? "bg-panel font-medium text-foreground shadow-card"
                    : "text-mute hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loadErr && (
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger" role="alert">
            {loadErr}
          </p>
        )}

        {!data && !loadErr && (
          <p className="flex items-center gap-2.5 rounded-xl bg-surface px-4 py-3 text-[14px] text-mute" role="status">
            <span className="livedot h-2 w-2 rounded-full bg-foreground/60" />
            Reading both chains. The first read after a deploy can take half a minute.
          </p>
        )}

        {ocError && (
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
            On-chain: {ocError}
          </p>
        )}

        {nets
          .filter((m) => m.error || m.catchingUp)
          .map((m) => (
            <p
              key={m.key}
              className={`rounded-xl px-4 py-3 text-[14px] ${
                m.error ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"
              }`}
            >
              {m.error
                ? `${nameOf(m)}: the last read failed (${m.error}). Showing what was read before.`
                : `${nameOf(m)}: still reading its history, up to block ${m.scannedTo} of ${m.latestBlock}. The next refresh continues.`}
            </p>
          ))}

        {tab === "overview" && (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi
                label="TVL"
                value={fmtUsd(real?.heldUsd ?? 0)}
                sub={
                  real?.unpriced.length
                    ? `plus ${real.unpriced.length} unpriced`
                    : MAINNET_ENABLED && test
                      ? `real money; ${fmtUsd(test.heldUsd)} test money on testnet`
                      : "priced holdings"
                }
              />
              <Kpi
                label="Revenue, 30 days"
                value={revenue ? fmtUsd(revenue.total.d30) : "Not read yet"}
                sub={revenue ? `${fmtUsd(revenue.total.all)} all time` : "after the next chain read"}
              />
              <Kpi
                label="Volume, 30 days"
                value={realRev ? fmtUsd(realRev.depositVolume.d30 + realRev.cashoutVolume.d30) : "Not read yet"}
                sub={realRev ? `${fmtUsd(realRev.depositVolume.d30)} in, ${fmtUsd(realRev.cashoutVolume.d30)} out` : "deposits and cash-outs"}
              />
              <Kpi
                label="Active wallets, 7 days"
                value={realRev ? n(realRev.users.d7) : "Not read yet"}
                sub={realRev ? `${n(realRev.users.d1)} in 24h, ${n(realRev.users.d30)} in 30 days` : "deposited or cashed out"}
              />
            </section>

            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi
                label="Depositor wallets"
                value={n(real?.depositors)}
                sub={testSub(test?.depositors, "more")}
              />
              <Kpi
                label="Private transfers"
                value={n(real?.transfers)}
                sub={testSub(test?.transfers, "more")}
              />
              <Kpi
                label="Transactions, 30 days"
                value={realRev ? n(realRev.txs.d30) : "Not read yet"}
                sub={realRev ? `${n(realRev.txs.all)} all time, on-chain` : "deposits, transfers, cash-outs"}
              />
              <Kpi
                label="Claim links, 14 days"
                value={`${n(claim.steps[2]?.v)} claimed`}
                sub={`of ${n(claim.steps[0]?.v)} made, ${n(claim.steps[1]?.v)} opened`}
              />
            </section>

            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi
                label="Bridges and swaps, 30 days"
                value={
                  relay && "enabled" in relay && relay.enabled
                    ? fmtUsd(relay.last30.bridge.inUsd + relay.last30.swap.inUsd)
                    : n((counters.bridge_arrived ?? 0) + (counters.swap_success ?? 0))
                }
                sub={
                  relay && "enabled" in relay && relay.enabled
                    ? `${n(relay.last30.bridge.count)} bridges, ${n(relay.last30.swap.count)} swaps`
                    : "finished, from product events"
                }
              />
              <Kpi
                label="Product events"
                value={n(product?.totalEvents)}
                sub={product?.backend ?? "unknown"}
              />
              <Kpi
                label="Last activity"
                value={fmtWhen(real?.lastActivity)}
                sub={`first ${fmtWhen(real?.firstActivity)}`}
              />
              <Kpi
                label="Chain read"
                value={oc ? fmtAge(oc.ageSec) : "Not yet"}
                sub={oc ? `${oc.source === "fresh" ? "just read" : `cached in ${oc.source}`}` : "waiting"}
              />
            </section>

            <Panel title="By network">
              <DataTable
                headers={["", ...nets.map(nameOf), ...totalHeads]}
                rows={[
                  ["Deposits", ...byNetwork((m) => n(m.deposits), (c) => n(c.deposits))],
                  ["Private transfers", ...byNetwork((m) => n(m.transfers), (c) => n(c.transfers))],
                  ["Cash-outs", ...byNetwork((m) => n(m.cashouts), (c) => n(c.cashouts))],
                  ["Private trades", ...byNetwork((m) => n(m.trades), (c) => n(c.trades))],
                  ["Payment messages", ...byNetwork((m) => n(m.memos), (c) => n(c.memos))],
                  ["Depositor wallets", ...byNetwork((m) => n(m.depositors), (c) => n(c.depositors))],
                  ["Active wallets", ...byNetwork((m) => n(m.activeWallets), (c) => n(c.activeWallets))],
                  ["Held (priced)", ...byNetwork((m) => fmtUsd(m.heldUsd), (c) => fmtUsd(c.heldUsd))],
                  [
                    "Deposit volume",
                    ...byNetwork(
                      (m) => (m.revenue ? fmtUsd(m.revenue.depositVolume.all) : ""),
                      (c) => (c.revenue ? fmtUsd(c.revenue.depositVolume.all) : "")
                    ),
                  ],
                  [
                    "Cash-out volume",
                    ...byNetwork(
                      (m) => (m.revenue ? fmtUsd(m.revenue.cashoutVolume.all) : ""),
                      (c) => (c.revenue ? fmtUsd(c.revenue.cashoutVolume.all) : "")
                    ),
                  ],
                  [
                    "Cash-out fees",
                    ...byNetwork(
                      (m) => (isTest(m) ? "Not counted" : m.revenue ? fmtUsd(m.revenue.fees.all) : ""),
                      (c) => (c === test ? "Not counted" : c.revenue ? fmtUsd(c.revenue.fees.all) : "")
                    ),
                  ],
                  ["First activity", ...byNetwork((m) => fmtWhen(m.firstActivity), (c) => fmtWhen(c.firstActivity))],
                  ["Last activity", ...byNetwork((m) => fmtWhen(m.lastActivity), (c) => fmtWhen(c.lastActivity))],
                  ["Vault since", ...byNetwork((m) => fmtWhen(m.vaultSince), () => "")],
                  [
                    "Vault",
                    ...byNetwork(
                      (m) => (
                        <a
                          key="v"
                          href={getNetwork(m.key).explorerAddress(m.pool)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-mute transition-colors hover:text-foreground"
                        >
                          {shortAddress(m.pool, 4)} <ArrowUpRight />
                        </a>
                      ),
                      () => ""
                    ),
                  ],
                  ["Read to block", ...byNetwork((m) => `#${m.scannedTo}`, () => "")],
                ]}
                empty="No on-chain figures yet"
              />
              <p className="mt-4 text-[13px] leading-relaxed text-mute">
                Current vaults only. Active wallets deposited or received a cash-out;
                transfers and trades carry no wallet. Totals count a wallet used on both
                networks once. Testnet money is play money and never counts toward the
                mainnet total.
              </p>
            </Panel>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Panel title="Claim links, last 14 days">
                <BarChart rows={claim.steps} />
                <p className="mt-5 text-[13px] leading-relaxed text-mute">
                  Totals only, counted without cookies or ids. Opened counts each link once per
                  browser; a claimer&apos;s first own payment counts once per browser.
                </p>
              </Panel>
              <Panel title="Claim links by day">
                <DataTable
                  headers={["Day", "Made", "Opened", "Claimed", "Claimer paid"]}
                  rows={claim.rows.map((d) => [fmtDay(d.day), n(d.link_created), n(d.link_opened), n(d.link_claimed), n(d.claimer_sent)])}
                  empty="No claim links yet"
                  minWidth={420}
                />
              </Panel>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Panel title="Funnel">
                <BarChart rows={funnel} />
                <p className="mt-5 text-[13px] leading-relaxed text-mute">
                  Event counts, not unique people, except first deposits, which are unique
                  wallets read from the chain. Recording demo sessions are not counted.
                </p>
              </Panel>
              <Panel title="Last 14 days">
                <DataTable
                  headers={["Day", "Active wallets", "Deposits", "Transfers", "Cash-outs", "App views", "Connects", "Proofs"]}
                  rows={days.map((d) => [
                    fmtDay(d.day),
                    n(d.chain?.activeWallets),
                    n(d.chain?.deposits),
                    n(d.chain?.transfers),
                    n(d.chain?.cashouts),
                    n(d.ev.app_view),
                    n(d.ev.wallet_connect),
                    n(d.ev.proof_created),
                  ])}
                  empty="No days yet"
                  minWidth={620}
                />
                <p className="mt-4 text-[13px] leading-relaxed text-mute">
                  UTC days. Active wallets deposited or received a cash-out that day, on either
                  network.
                </p>
              </Panel>
            </div>

            <Panel title="Held by asset">
              <DataTable
                headers={["Network", "Asset", "Held now", "USD", "Deposited", "Cashed out"]}
                rows={nets.flatMap((m) =>
                  m.assets.map((a) => [
                    nameOf(m),
                    a.symbol,
                    a.held ?? "Unknown",
                    fmtUsd(a.heldUsd),
                    `${a.deposited} (${a.depositCount})`,
                    `${a.cashedOut} (${a.cashoutCount})`,
                  ])
                )}
                empty="Nothing held or moved yet"
              />
              <p className="mt-4 text-[13px] leading-relaxed text-mute">
                Stablecoins count as $1. ETH {oc?.prices.ethUsd ? `at ${fmtUsd(oc.prices.ethUsd)}` : "is not priced right now"};
                stock tokens at live equity marks{oc?.prices.stocks === "live" ? "" : ", not available right now"}.
                Counts in brackets.
              </p>
            </Panel>

            <Panel title="Recent on-chain activity">
              <DataTable
                headers={["Network", "Kind", "Detail", "Wallet", "Tx", "When"]}
                rows={(oc?.recent ?? []).map((tx) => {
                  const net = getNetwork(isNetworkKey(tx.network) ? tx.network : "robinhood");
                  return [
                    adminName(net),
                    KIND_LABEL[tx.kind] ?? tx.kind,
                    tx.detail,
                    tx.wallet ? (
                      <a
                        key="a"
                        href={net.explorerAddress(tx.wallet)}
                        className="text-mute transition-colors hover:text-foreground"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(tx.wallet, 4)}
                      </a>
                    ) : (
                      <span key="a" className="text-faint">
                        Private
                      </span>
                    ),
                    <a
                      key="t"
                      href={net.explorerTx(tx.tx)}
                      className="text-mute transition-colors hover:text-foreground"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {tx.tx.slice(0, 10)}…
                    </a>,
                    tx.ts ? fmtWhen(tx.ts) : `#${tx.block}`,
                  ];
                })}
                empty="No on-chain activity yet"
              />
            </Panel>
          </>
        )}

        {tab === "users" && (
          <Panel title="Depositors (by activity)">
            <p className="mb-4 text-[14px] text-mute">
              Unique wallets that deposited into a current vault, per network. A wallet used
              on both networks shows twice.
            </p>
            <DataTable
              headers={["#", "Network", "Address", "Deposits", "Last deposit", "Explorer"]}
              rows={nets
                .flatMap((m) => m.topDepositors.map((u) => ({ ...u, key: m.key, label: nameOf(m) })))
                .sort((a, b) => b.deposits - a.deposits || b.lastTs - a.lastTs)
                .map((u, i) => [
                  String(i + 1),
                  u.label,
                  <span key="addr" className="text-[13px] text-foreground">
                    {u.address}
                  </span>,
                  n(u.deposits),
                  fmtWhen(u.lastTs),
                  <a
                    key="ex"
                    href={getNetwork(u.key).explorerAddress(u.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-foreground"
                  >
                    View
                  </a>,
                ])}
              empty="No depositors yet"
            />
          </Panel>
        )}

        {tab === "events" && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Object.entries(counters)
                .filter(([k]) => k !== "total")
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <Kpi key={k} label={k} value={n(v)} sub={NEW_EVENTS.includes(k) ? "count, new" : "count"} />
                ))}
            </div>
            <Panel title="Breakdowns">
              <p className="mb-4 text-[14px] text-mute">
                Kinds, networks and yes or no fields only. Events never carry amounts, names,
                addresses, labels, notes or proofs.
              </p>
              <DataTable
                headers={["Event", "Field", "Value", "Count"]}
                rows={breakdowns.flatMap((g) =>
                  g.list.map((r) => [
                    <span key="e" className="text-foreground">
                      {g.event}
                    </span>,
                    r.field,
                    dimValue(r.field, r.value),
                    n(r.v),
                  ])
                )}
                empty="No breakdowns yet. They fill in as new events arrive."
              />
            </Panel>
            <Panel title="Event stream">
              <DataTable
                headers={["Event", "Path", "Details", "Time"]}
                rows={(product?.recent ?? []).map((ev) => [
                  <span key="t" className="text-foreground">
                    {ev.t}
                  </span>,
                  ev.path ?? "None",
                  metaText(ev.meta),
                  new Date(ev.ts).toLocaleString(),
                ])}
                empty="No product events, open /app to generate traffic"
              />
            </Panel>
            {product?.backend === "memory" && (
              <p className="text-[14px] text-mute">
                Backend is memory. Set Upstash{" "}
                <code className="rounded-md bg-surface px-1.5 py-0.5 text-foreground">
                  UPSTASH_REDIS_REST_*
                </code>{" "}
                and redeploy for durable counts.
              </p>
            )}
          </>
        )}

        {tab === "revenue" && (
          <RevenuePanel
            oc={oc}
            revenue={revenue}
            realRev={realRev}
            creator={creator}
            bridgeFeeBps={data?.revenueConfig?.bridgeFeeBps ?? null}
          />
        )}

        {tab === "relay" && <RelayPanel relay={relay} counters={counters} dims={product?.dims ?? {}} />}

        {tab === "partners" && <PartnersPanel />}
        {tab === "testers" && <TestersPanel />}
        {tab === "bugs" && <BugsPanel />}

        <p className="tnum text-[12px] text-mute">
          Generated {data?.generatedAt ?? "not yet"} ·{" "}
          <Link
            href="/app"
            className="text-foreground underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-foreground"
          >
            Open app
          </Link>
        </p>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- partners */

type AdminPartner = {
  id: string;
  owner: string;
  name: string;
  website: string | null;
  fees: { privatePaymentCents: number; cashoutBps: number; depositBps: number };
  createdAt: number;
  activeKeys: number;
  totals: {
    privatePayments: number;
    cashOuts: number;
    deposits: number;
    publicVolumeUsd: number;
    commissionUsd: number;
    unpriced: number;
    lastActivity: number | null;
  } | null;
};

type PartnersPayload = {
  backend: "redis" | "memory" | "none";
  partners: AdminPartner[];
  totals: { privatePayments: number; cashOuts: number; deposits: number; publicVolumeUsd: number; commissionUsd: number } | null;
};

/** The partner program: every partner, their keys and the volume their keys brought in. */
function PartnersPanel() {
  const [data, setData] = useState<PartnersPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/partners/admin", { credentials: "include", cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: PartnersPayload; error?: { message?: string } } | null;
        if (!live) return;
        if (!res.ok || !json?.ok || !json.data) {
          setErr(json?.error?.message ?? `Partners failed (${res.status})`);
          return;
        }
        setErr(null);
        setData(json.data);
      } catch {
        if (live) setErr("Network error loading partners");
      }
    };
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, ADMIN_REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  if (err) {
    return (
      <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger" role="alert">
        {err}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="flex items-center gap-2.5 rounded-xl bg-surface px-4 py-3 text-[14px] text-mute" role="status">
        <span className="livedot h-2 w-2 rounded-full bg-foreground/60" />
        Loading partners
      </p>
    );
  }
  const t = data.totals;
  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Partners" value={n(data.partners.length)} sub={`${n(data.partners.reduce((s, p) => s + p.activeKeys, 0))} active keys`} />
        <Kpi label="Private payments" value={n(t?.privatePayments)} sub="relayed with a partner key" />
        <Kpi label="Public volume" value={fmtUsd(t?.publicVolumeUsd ?? 0)} sub={`${n((t?.cashOuts ?? 0) + (t?.deposits ?? 0))} cash outs and deposits`} />
        <Kpi label="Would-be fees" value={fmtUsd(t?.commissionUsd ?? 0)} sub={MAINNET_ENABLED ? "partner fees not charged yet" : "testnet, nothing charged"} />
      </section>
      <Panel title="Partners">
        <DataTable
          headers={["Partner", "Owner", "Keys", "Private payments", "Cash outs", "Deposits", "Public volume", "Would-be fees", "Fee setting", "Last payment", "Joined"]}
          rows={data.partners.map((p) => [
            <span key="n" className="text-foreground">
              {p.website ? (
                <a href={p.website} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:decoration-foreground">
                  {p.name}
                </a>
              ) : (
                p.name
              )}
            </span>,
            <span key="o" title={p.owner}>
              {shortAddress(p.owner, 4)}
            </span>,
            n(p.activeKeys),
            n(p.totals?.privatePayments),
            n(p.totals?.cashOuts),
            n(p.totals?.deposits),
            fmtUsd(p.totals?.publicVolumeUsd ?? 0),
            fmtUsd(p.totals?.commissionUsd ?? 0),
            `$${(p.fees.privatePaymentCents / 100).toFixed(2)} · ${pct(p.fees.cashoutBps)} · ${pct(p.fees.depositBps)}`,
            p.totals?.lastActivity ? new Date(p.totals.lastActivity).toLocaleString() : "None yet",
            new Date(p.createdAt).toLocaleDateString(),
          ])}
          empty={data.backend === "none" ? "Partner storage is not configured (set Upstash Redis)." : "No partners yet"}
          minWidth={1100}
        />
        <p className="mt-4 text-[13px] leading-relaxed text-mute">
          Fee setting is per private payment, cash outs, deposits. Volume counts payments relayed with a partner key and
          deposits partners reported (checked on chain). Store: {data.backend}.
        </p>
      </Panel>
    </>
  );
}

/** Revenue over the windows, in dollars: vault cash-out fees plus $GLOAM creator fees at today's ETH price. */
function revenueTotals(rev: CombinedRevenue, creator: CreatorFees | null) {
  const c = creator?.earnedUsd;
  const w = (k: keyof Windowed) => rev.fees[k] + (c ? c[k] : 0);
  return { total: { d1: w("d1"), d7: w("d7"), d30: w("d30"), all: w("all") }, creatorPriced: Boolean(c) };
}

function fmtEth(v: number | null | undefined): string {
  if (v == null) return "Unknown";
  if (v > 0 && v < 0.0001) return "<0.0001 ETH";
  return `${v.toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`;
}

function RevenuePanel({
  oc,
  revenue,
  realRev,
  creator,
  bridgeFeeBps,
}: {
  oc: OnchainMetrics | null;
  revenue: ReturnType<typeof revenueTotals> | null;
  realRev: CombinedRevenue | undefined;
  creator: CreatorFees | null;
  bridgeFeeBps: number | null;
}) {
  if (!oc || !realRev || !revenue) {
    return (
      <p className="flex items-center gap-2.5 rounded-xl bg-surface px-4 py-3 text-[14px] text-mute" role="status">
        <span className="livedot h-2 w-2 rounded-full bg-foreground/60" />
        Revenue appears after the next chain read. Press Refresh.
      </p>
    );
  }
  const creatorErr = oc.creator && !("earnedEth" in oc.creator) ? oc.creator.error : (creator?.error ?? null);
  const mainnets = oc.networks.filter((m) => !(m.testnet ?? getNetwork(m.key).testnet));
  const bpsOf = (m: NetworkMetrics) => m.revenue?.feeBps;
  const feeLine = mainnets
    .map((m) => `${adminName(getNetwork(m.key))} ${bpsOf(m) == null ? "unknown" : `${((bpsOf(m) ?? 0) / 100).toFixed(2)}%`}`)
    .join(", ");
  const w = (v: Windowed | null | undefined, k: keyof Windowed) => (v ? fmtUsd(v[k]) : "Unknown");
  const daily = realRev.daily
    .map((d) => {
      const c = creator?.daily.find((x) => x.day === d.day);
      return { ...d, creatorUsd: c?.usd ?? null, creatorEth: c?.eth ?? 0 };
    })
    .reverse();

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Revenue, 24 hours" value={fmtUsd(revenue.total.d1)} sub="fees kept, real money" />
        <Kpi label="Revenue, 7 days" value={fmtUsd(revenue.total.d7)} sub="fees kept, real money" />
        <Kpi label="Revenue, 30 days" value={fmtUsd(revenue.total.d30)} sub="fees kept, real money" />
        <Kpi label="Revenue, all time" value={fmtUsd(revenue.total.all)} sub={revenue.creatorPriced ? "creator fees at today's ETH price" : "vault fees only"} />
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Deposit volume, 30 days" value={fmtUsd(realRev.depositVolume.d30)} sub={`${fmtUsd(realRev.depositVolume.all)} all time`} />
        <Kpi label="Cash-out volume, 30 days" value={fmtUsd(realRev.cashoutVolume.d30)} sub={`${fmtUsd(realRev.cashoutVolume.all)} all time`} />
        <Kpi label="Fees waiting to collect" value={fmtUsd(realRev.owedUsd)} sub="in the vaults, for collectFees" />
        <Kpi label="Active wallets, 30 days" value={n(realRev.users.d30)} sub={`${n(realRev.users.d7)} in 7 days, ${n(realRev.users.d1)} in 24h`} />
      </section>

      <Panel title="Revenue by source">
        <DataTable
          headers={["Source", "24 hours", "7 days", "30 days", "All time", "How it is counted"]}
          rows={[
            [
              "Cash-out fees",
              fmtUsd(realRev.fees.d1),
              fmtUsd(realRev.fees.d7),
              fmtUsd(realRev.fees.d30),
              fmtUsd(realRev.fees.all),
              `Kept by the mainnet vaults on each cash-out (${feeLine || "no mainnet vault"})`,
            ],
            [
              "$GLOAM creator fees",
              w(creator?.earnedUsd, "d1"),
              w(creator?.earnedUsd, "d7"),
              w(creator?.earnedUsd, "d30"),
              w(creator?.earnedUsd, "all"),
              creator ? `1% of the ETH side of every trade on Orynth, ${fmtEth(creator.earnedEth.all)} all time` : "Not read",
            ],
            [
              "Bridge fee",
              "",
              "",
              "",
              "",
              bridgeFeeBps ? `On, ${(bridgeFeeBps / 100).toFixed(2)}%. Paid out by Relay, not read here` : "Off. Bridging and swaps charge nothing on top of Relay",
            ],
            ["Partner API fees", "", "", "", "", "Not charged yet. Would-be fees are on the Partners tab"],
            [
              <span key="t" className="font-medium text-foreground">
                Total
              </span>,
              fmtUsd(revenue.total.d1),
              fmtUsd(revenue.total.d7),
              fmtUsd(revenue.total.d30),
              fmtUsd(revenue.total.all),
              "",
            ],
          ]}
          minWidth={820}
        />
        <p className="mt-4 text-[13px] leading-relaxed text-mute">
          Real money only; testnet fees are play money and never count. Priced at today&apos;s prices: stablecoins at $1,
          ETH {oc.prices.ethUsd ? `at ${fmtUsd(oc.prices.ethUsd)}` : "not priced right now"}, $GLOAM from DEX Screener.
          Windows are the last 24 hours, 7 days and 30 days.
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Cash-out fees by asset">
          <DataTable
            headers={["Network", "Asset", "Earned", "USD", "Cash-outs", "Waiting", "Collected"]}
            rows={mainnets.flatMap((m) =>
              (m.revenue?.feeRows ?? []).map((r) => [
                adminName(getNetwork(m.key)),
                r.symbol,
                r.earned,
                fmtUsd(r.earnedUsd),
                n(r.count),
                r.owed ?? "Unknown",
                r.collected,
              ])
            )}
            empty="No cash-out fees yet"
            minWidth={560}
          />
          <p className="mt-4 text-[13px] leading-relaxed text-mute">
            Waiting fees sit in the vault until someone calls collectFees(asset), which sends them to the fee recipient
            {mainnets[0]?.revenue?.feeRecipient ? ` ${shortAddress(mainnets[0].revenue.feeRecipient, 4)}` : ""}. Anyone can
            call it; the destination is fixed.
          </p>
        </Panel>

        <Panel title="$GLOAM creator fees">
          {creator ? (
            <>
              <DataTable
                headers={["", "ETH", "USD now"]}
                rows={[
                  ["Earned, all time", fmtEth(creator.earnedEth.all), w(creator.earnedUsd, "all")],
                  ["Earned, 30 days", fmtEth(creator.earnedEth.d30), w(creator.earnedUsd, "d30")],
                  ["Claimed", fmtEth(creator.claimedEth), oc.prices.ethUsd ? fmtUsd(creator.claimedEth * oc.prices.ethUsd) : "Unknown"],
                  ["Waiting to claim", fmtEth(creator.unclaimedEth), oc.prices.ethUsd ? fmtUsd(creator.unclaimedEth * oc.prices.ethUsd) : "Unknown"],
                  ["Trades that paid a share", n(creator.trades), ""],
                ]}
                minWidth={360}
              />
              <p className="mt-4 text-[13px] leading-relaxed text-mute">
                Read from the Orynth fee vault{" "}
                <a
                  href={getNetwork("robinhood-mainnet").explorerAddress(creator.vault)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-mute transition-colors hover:text-foreground"
                >
                  {shortAddress(creator.vault, 4)} <ArrowUpRight />
                </a>{" "}
                for the creator wallet {shortAddress(creator.creator, 4)}.
                {creator.catchingUp ? " Still reading its history; the next refresh continues." : ""}
                {creatorErr ? ` The last read failed (${creatorErr}); showing what was read before.` : ""}
              </p>
            </>
          ) : (
            <p className="text-[14px] text-mute">{creatorErr ?? "Not read yet. Creator fees are read once Robinhood Chain mainnet is live."}</p>
          )}
        </Panel>
      </div>

      <Panel title="Daily, last 30 days">
        <DataTable
          headers={["Day", "Revenue", "Cash-out fees", "Creator fees", "Deposits", "Cash-outs", "Transactions", "Active wallets"]}
          rows={daily.map((d) => [
            fmtDay(d.day),
            fmtUsd(d.feesUsd + (d.creatorUsd ?? 0)),
            fmtUsd(d.feesUsd),
            d.creatorUsd == null ? fmtEth(d.creatorEth) : fmtUsd(d.creatorUsd),
            fmtUsd(d.depositUsd),
            fmtUsd(d.cashoutUsd),
            n(d.txs),
            n(d.wallets),
          ])}
          empty="No days yet"
          minWidth={820}
        />
        <p className="mt-4 text-[13px] leading-relaxed text-mute">
          UTC days, newest first, mainnet only. Deposits and cash-outs are dollar volume; transactions count deposits,
          private transfers, cash-outs and trades. Creator fees are placed in days by block, to within a couple of minutes.
        </p>
      </Panel>
    </>
  );
}

type TesterRow = {
  id: string;
  name: string;
  telegram: string;
  x: string | null;
  address: string;
  network: "both" | "tempo" | "robinhood";
  setup: string | null;
  note: string | null;
  paid?: boolean;
  createdAt: number;
};

const TESTER_NETWORK: Record<TesterRow["network"], string> = { both: "Both", tempo: "Tempo", robinhood: "Robinhood Chain" };

function TestersPanel() {
  const [data, setData] = useState<{ backend: string; cap: number; applications: TesterRow[]; loadedAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/testers", { credentials: "include", cache: "no-store" });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; data?: { backend: string; cap: number; applications: TesterRow[] }; error?: { message?: string } }
          | null;
        if (!live) return;
        if (!res.ok || !json?.ok || !json.data) {
          setErr(json?.error?.message ?? `Testers failed (${res.status})`);
          return;
        }
        setErr(null);
        setData({ ...json.data, loadedAt: Date.now() });
      } catch {
        if (live) setErr("Network error loading testers");
      }
    };
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, ADMIN_REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  if (err) {
    return (
      <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger" role="alert">
        {err}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="flex items-center gap-2.5 rounded-xl bg-surface px-4 py-3 text-[14px] text-mute" role="status">
        <span className="livedot h-2 w-2 rounded-full bg-foreground/60" />
        Loading testers
      </p>
    );
  }
  const apps = data.applications;
  const dayAgo = data.loadedAt - 86_400_000;
  const paid = apps.filter((a) => a.paid !== false).length;
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Applications" value={n(apps.length)} sub={`${n(apps.filter((a) => a.createdAt > dayAgo).length)} in the last 24h`} />
        <Kpi
          label="Paid spots"
          value={`${n(paid)} / ${n(data.cap)}`}
          sub={paid >= data.cap ? "Full, new testers are volunteers" : `${n(data.cap - paid)} left`}
        />
        <Kpi label="Volunteers" value={n(apps.length - paid)} sub="joined after paid spots filled" />
        <Kpi label="Rewards owed" value={fmtUsd(paid * 10)} sub="$10 per paid tester" />
      </section>
      <Panel
        title="Tester applications"
        action={
          <a href="/api/testers?format=csv" className="btn btn-ghost btn-sm">
            Download CSV
          </a>
        }
      >
        <DataTable
          headers={["Name", "Spot", "Telegram", "X", "EVM address", "Network", "Device and wallet", "Note", "Applied"]}
          rows={apps.map((a) => [
            <span key="n" className="text-foreground">
              {a.name}
            </span>,
            a.paid !== false ? "Paid" : "Volunteer",
            <a key="t" href={`https://t.me/${a.telegram}`} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:decoration-foreground">
              @{a.telegram}
            </a>,
            a.x ? (
              <a key="x" href={`https://x.com/${a.x}`} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:decoration-foreground">
                @{a.x}
              </a>
            ) : (
              "None"
            ),
            <span key="a" title={a.address}>
              {shortAddress(a.address, 4)}
            </span>,
            TESTER_NETWORK[a.network] ?? a.network,
            a.setup ?? "None",
            <span key="note" title={a.note ?? undefined} className="block max-w-[260px] truncate">
              {a.note ?? "None"}
            </span>,
            new Date(a.createdAt).toLocaleString(),
          ])}
          empty={data.backend === "none" ? "Tester storage is not configured (set Upstash Redis)." : "No applications yet"}
          minWidth={1180}
        />
        <p className="mt-4 text-[13px] leading-relaxed text-mute">
          Approve Telegram join requests that match an application. The CSV has full addresses for paying rewards. Store:{" "}
          {data.backend}.
        </p>
      </Panel>
    </>
  );
}

type BugRow = {
  id: string;
  userId: number;
  username: string | null;
  firstName: string;
  thread: string;
  text: string;
  link: string | null;
  createdAt: number;
};

/** Bug reports the Telegram helper saved from Testers, Feedback and /bug. Read only. */
function BugsPanel() {
  const [data, setData] = useState<{ backend: string; reports: BugRow[]; loadedAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/bugs", { credentials: "include", cache: "no-store" });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; data?: { backend: string; reports: BugRow[] }; error?: { message?: string } }
          | null;
        if (!live) return;
        if (!res.ok || !json?.ok || !json.data) {
          setErr(json?.error?.message ?? `Bug reports failed (${res.status})`);
          return;
        }
        setErr(null);
        setData({ ...json.data, loadedAt: Date.now() });
      } catch {
        if (live) setErr("Network error loading bug reports");
      }
    };
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, ADMIN_REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  if (err) {
    return (
      <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger" role="alert">
        {err}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="flex items-center gap-2.5 rounded-xl bg-surface px-4 py-3 text-[14px] text-mute" role="status">
        <span className="livedot h-2 w-2 rounded-full bg-foreground/60" />
        Loading bug reports
      </p>
    );
  }
  const reports = data.reports;
  const dayAgo = data.loadedAt - 86_400_000;
  const people = new Set(reports.map((r) => r.userId)).size;
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Reports" value={n(reports.length)} sub={`${n(reports.filter((r) => r.createdAt > dayAgo).length)} in the last 24h`} />
        <Kpi label="Reporters" value={n(people)} sub="people on Telegram" />
      </section>
      <Panel title="Bug reports">
        <DataTable
          headers={["From", "Where", "Report", "Message", "Reported"]}
          rows={reports.map((r) => [
            r.username ? (
              <a key="u" href={`https://t.me/${r.username}`} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:decoration-foreground">
                {r.firstName || r.username} (@{r.username})
              </a>
            ) : (
              <span key="u" className="text-foreground">
                {r.firstName || `User ${r.userId}`}
              </span>
            ),
            r.thread,
            <span key="t" title={r.text} className="block max-w-[420px] truncate">
              {r.text}
            </span>,
            r.link ? (
              <a key="l" href={r.link} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:decoration-foreground">
                Open
              </a>
            ) : (
              "None"
            ),
            new Date(r.createdAt).toLocaleString(),
          ])}
          empty={data.backend === "none" ? "Bug storage is not configured (set Upstash Redis)." : "No bug reports yet"}
          minWidth={980}
        />
        <p className="mt-4 text-[13px] leading-relaxed text-mute">
          Saved by the Telegram helper from Testers, Feedback and /bug. Hover a report for the full text. Store: {data.backend}.
        </p>
      </Panel>
    </>
  );
}

/** A network's name; "testnet" is added once a mainnet sits beside it. */
function adminName(n: GloamNetwork): string {
  return MAINNET_ENABLED ? networkName(n) : n.label;
}

/** Chain ids read as network names in the breakdowns. */
function dimValue(field: string, value: string): string {
  if (field === "chainId") {
    const net = NETWORK_KEYS.map(getNetwork).find((x) => String(x.chainId) === value);
    return net ? `${adminName(net)} (${value})` : value;
  }
  if (field === "network" && isNetworkKey(value)) return adminName(getNetwork(value));
  return value;
}

function metaText(meta: Record<string, unknown> | null): string {
  if (!meta) return "None";
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k} ${String(v)}`);
  return parts.length ? parts.join(", ").slice(0, 80) : "None";
}

const RELAY_FUNNEL: [string, string][] = [
  ["bridge_address_created", "Deposit addresses made"],
  ["bridge_arrived", "Bridges that arrived"],
  ["swap_review", "Swaps reviewed"],
  ["swap_submit", "Swaps sent from a wallet"],
  ["swap_success", "Swaps that landed"],
];

/** Bridges in through Relay deposit addresses, and same-chain swaps of the gas coin. */
function RelayPanel({
  relay,
  counters,
  dims,
}: {
  relay: RelayVolume | { error: string } | undefined;
  counters: Record<string, number>;
  dims: Record<string, number>;
}) {
  const funnelMax = Math.max(1, ...RELAY_FUNNEL.map(([k]) => counters[k] ?? 0));
  const funnel = RELAY_FUNNEL.map(([k, label]) => ({ k: label, v: counters[k] ?? 0, sub: k, pct: ((counters[k] ?? 0) / funnelMax) * 100 }));
  const bySourceEvents = Object.entries(dims)
    .map(([key, v]) => {
      const m = /^(bridge_address_created|bridge_arrived)\|source=(.+)$/.exec(key);
      return m ? { event: m[1]!, source: m[2]!, v } : null;
    })
    .filter((x): x is { event: string; source: string; v: number } => x !== null);
  const sources = [...new Set(bySourceEvents.map((x) => x.source))];
  const eventRows = sources
    .map((src) => {
      const made = bySourceEvents.find((x) => x.source === src && x.event === "bridge_address_created")?.v ?? 0;
      const arrived = bySourceEvents.find((x) => x.source === src && x.event === "bridge_arrived")?.v ?? 0;
      return { src, made, arrived };
    })
    .sort((a, b) => b.arrived - a.arrived || b.made - a.made);

  const live = relay && "enabled" in relay && relay.enabled ? relay : null;
  const off = relay && "enabled" in relay && !relay.enabled ? relay.reason : null;
  const failed = relay && "error" in relay ? relay.error : null;

  return (
    <>
      {live ? (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Bridged in, 30 days" value={fmtUsd(live.last30.bridge.inUsd)} sub={`${n(live.last30.bridge.count)} bridges, ${fmtUsd(live.all.bridge.inUsd)} all time`} />
          <Kpi label="Swapped, 30 days" value={fmtUsd(live.last30.swap.inUsd)} sub={`${n(live.last30.swap.count)} swaps, ${fmtUsd(live.all.swap.inUsd)} all time`} />
          <Kpi
            label="Finished, all time"
            value={n(live.all.bridge.count + live.all.swap.count)}
            sub={`${n(live.refunded)} refunded, ${n(live.failed)} failed, ${n(live.pending)} in flight`}
          />
          <Kpi label="Fees paid to Relay" value={fmtUsd(live.all.bridge.feeUsd + live.all.swap.feeUsd)} sub={`${fmtUsd(live.last30.bridge.feeUsd + live.last30.swap.feeUsd)} in 30 days, paid by users`} />
        </section>
      ) : (
        <p className={`rounded-xl px-4 py-3 text-[14px] leading-relaxed ${failed ? "bg-danger-soft text-danger" : "bg-surface text-soft"}`}>
          {failed
            ? `Relay: ${failed}`
            : `Volume from Relay is off. ${off ?? ""} Add RELAY_API_KEY on Vercel to tag new quotes as gloam.trade and read them back here. Until then, the counts below come from product events and carry no amounts.`}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Funnel">
          <BarChart rows={funnel} />
          <p className="mt-5 text-[13px] leading-relaxed text-mute">
            Product events, counted only for visitors who accepted analytics. They carry the chain and token, never an
            amount, wallet or transaction.
          </p>
        </Panel>
        <Panel title="By source chain">
          {live ? (
            <DataTable
              headers={["Source", "Kind", "Finished", "Volume", "Relay fees"]}
              rows={live.bySource.map((r) => [relayChainName(r.chainId), r.kind === "swap" ? "Swap" : "Bridge", n(r.count), fmtUsd(r.inUsd), fmtUsd(r.feeUsd)])}
              empty="Nothing tagged yet"
              minWidth={460}
            />
          ) : (
            <DataTable
              headers={["Source", "Addresses made", "Arrived"]}
              rows={eventRows.map((r) => [r.src, n(r.made), n(r.arrived)])}
              empty="No bridge events yet"
              minWidth={360}
            />
          )}
        </Panel>
      </div>

      {live && (
        <>
          <Panel title="Last 30 days">
            <DataTable
              headers={["Day", "Bridges", "Bridged", "Swaps", "Swapped", "Relay fees"]}
              rows={[...live.daily]
                .reverse()
                .filter((d) => d.bridges + d.swaps > 0)
                .map((d) => [fmtDay(d.day), n(d.bridges), fmtUsd(d.bridgeUsd), n(d.swaps), fmtUsd(d.swapUsd), fmtUsd(d.feeUsd)])}
              empty="No finished bridges or swaps in the last 30 days"
              minWidth={560}
            />
            <p className="mt-4 text-[13px] leading-relaxed text-mute">
              UTC days, finished requests only, valued in dollars by Relay when each one was made.
              {live.since ? ` Tagged at Relay since ${fmtWhen(live.since)}.` : " Nothing tagged at Relay yet."}
              {live.truncated ? " More requests exist than one refresh reads, so totals are a floor." : ""}
            </p>
          </Panel>
          <Panel title="Recent">
            <DataTable
              headers={["Kind", "From", "Sent", "Received", "Status", "Tx", "When"]}
              rows={live.recent.map((r) => [
                r.kind === "swap" ? "Swap" : "Bridge",
                relayChainName(r.fromChainId),
                `${r.inAmount ? Number(r.inAmount).toLocaleString("en-US", { maximumFractionDigits: 6 }) : ""} ${r.inSymbol}`.trim(),
                `${r.outAmount ? Number(r.outAmount).toLocaleString("en-US", { maximumFractionDigits: 2 }) : ""} ${r.outSymbol}`.trim(),
                r.stage === "done" ? "Done" : r.stage === "refunded" ? "Refunded" : r.stage === "failed" ? "Failed" : "In flight",
                r.tx ? (
                  <a
                    key="t"
                    href={`https://relay.link/transaction/${r.tx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-mute transition-colors hover:text-foreground"
                  >
                    {r.tx.slice(0, 10)}… <ArrowUpRight />
                  </a>
                ) : (
                  ""
                ),
                fmtWhen(r.ts),
              ])}
              empty="No requests yet"
              minWidth={720}
            />
            <p className="mt-4 text-[13px] leading-relaxed text-mute">
              Wallets are left out on purpose. Relay holds the full record.
            </p>
          </Panel>
        </>
      )}
    </>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="gl-card min-w-0 px-4 py-4 sm:px-5 sm:py-5">
      <p className="t-label truncate">{label}</p>
      <p className="tnum mt-3 truncate text-[22px] font-light leading-none tracking-[-0.02em] text-foreground sm:text-[30px]">
        {value}
      </p>
      {sub && <p className="mt-2 truncate text-[12px] text-mute">{sub}</p>}
    </div>
  );
}

function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="gl-card min-w-0 p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-2">
        <h2 className="text-[17px] tracking-[-0.01em] text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function BarChart({
  rows,
}: {
  rows: { k: string; v: number; pct: number; sub?: string }[];
}) {
  if (rows.length === 0) {
    return <p className="text-[14px] text-mute">No data</p>;
  }
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <li key={r.k}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="min-w-0 truncate text-mute">
              {r.k}
              {r.sub && <span className="ml-2 text-[12px] text-faint">{r.sub}</span>}
            </span>
            <span className="tnum shrink-0 text-foreground">{r.v.toLocaleString("en-US")}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-foreground transition-[width] duration-500"
              style={{ width: `${Math.max(r.pct, r.v > 0 ? 4 : 0)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DataTable({
  headers,
  rows,
  empty,
  minWidth = 480,
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: string;
  minWidth?: number;
}) {
  if (rows.length === 0) {
    return <p className="text-[14px] text-mute">{empty ?? "No rows"}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="tnum w-full text-left text-[14px]" style={{ minWidth }}>
        <thead className="border-b border-line bg-surface">
          <tr>
            {headers.map((h, i) => (
              <th key={`${h}-${i}`} className="t-label px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-line transition-colors last:border-0 hover:bg-surface"
            >
              {row.map((cell, j) => (
                <td key={j} className="h-[52px] whitespace-nowrap px-4 py-2 text-soft">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
