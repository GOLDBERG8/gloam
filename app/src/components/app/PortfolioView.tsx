"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatEth } from "@/lib/chain";
import { useAppAccount, useAppBalance, useAppTokenBalances } from "@/lib/demo";
import { useNetwork } from "./NetworkProvider";
import { SwapToStableButton } from "./BridgeIn";
import { faucetFor } from "@/lib/faucet";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { useLocalShieldNotes } from "@/hooks/useLocalShieldNotes";
import { useTradingSettings } from "@/hooks/useTradingSettings";
import {
  formatMark,
  formatTokenAmount,
  formatUsd,
  formatUsdCompact,
} from "@/lib/markets";
import { shieldTokensFor, supportsNativeShield } from "@/lib/tokens";
import {
  assetLabel,
  formatAssetAmount,
  isNativeAsset,
  isShieldDeployed,
} from "@/lib/shield";
import { isClaimedNote, isSecuredClaim, isUnsecuredClaim } from "@/lib/claimSweep";
import { SealedField } from "@/components/ui/SealedField";
import { ActivityFeed } from "./ActivityFeed";
import { AddressChip } from "./AddressChip";
import { FirstPaymentCard } from "./FirstPaymentCard";
import { RecoveryNudge } from "./RecoveryPanel";
import { OnboardingCard, openOnboarding } from "./OnboardingCard";
import { PaymentNoteLine } from "./PaymentNote";
import { TokenLogo } from "./TokenLogo";
import { TempoFaucetButton } from "./TempoFaucetButton";
import { WalletMenu } from "./WalletMenu";
import { NetworkPulse } from "./NetworkPulse";
import { Sparkline } from "./Sparkline";

/* Small marks that carry the public / private duality. */
function EyeIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function LockIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function KindBadge({ sealed }: { sealed: boolean }) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium ${
        sealed ? "bg-sealed-soft text-sealed" : "bg-surface text-mute"
      }`}
    >
      {sealed ? <LockIcon /> : <EyeIcon />}
      {sealed ? "Private" : "Public"}
    </span>
  );
}

function StatCard({
  label,
  sealed,
  value,
  sub,
  loading,
  children,
}: {
  label: string;
  sealed: boolean;
  value: string;
  sub?: string;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="gl-card flex min-w-0 flex-col p-5">
      <div className="flex h-6 items-center justify-between gap-3">
        <span className="text-[13px] text-mute">{label}</span>
        <KindBadge sealed={sealed} />
      </div>
      <p className="tnum mt-4 truncate text-[28px] font-light leading-none tracking-[-0.02em] text-foreground">
        {loading ? <span className="inline-block h-7 w-24 animate-pulse rounded-lg bg-surface align-middle" /> : value}
      </p>
      {sub && <p className="mt-2 truncate text-[13px] text-mute">{sub}</p>}
      {children}
    </div>
  );
}

function AddIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 17L17 7M9 7h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function MoveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 8h11m0 0l-3-3m3 3l-3 3M17 16H6m0 0l3-3m-3 3l3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function QuickAction({
  href,
  label,
  icon,
  primary = false,
  disabled = false,
  className = "",
}: {
  href: string;
  label: string;
  icon: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const cls = `btn ${primary ? "btn-ink" : "btn-ghost"} ${className}`;
  if (disabled) {
    return (
      <span className={cls} aria-disabled="true" title="Not live yet">
        {icon}
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={cls}>
      {icon}
      {label}
    </Link>
  );
}

function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1 max-sm:px-5 py-10 sm:px-6">
      <p className="text-[15px] text-foreground">{title}</p>
      {body && <p className="max-w-[48ch] text-[13.5px] leading-relaxed text-mute">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function PortfolioView() {
  const { address, isConnected, chainId } = useAppAccount();
  const router = useRouter();
  const { network } = useNetwork();
  const onProduct = chainId === network.chainId;
  // Test funds exist on the testnets only; a mainnet has no faucet.
  const faucet = faucetFor(network.key);
  const faucetExternal = faucet?.url.startsWith("http") ?? false;
  // Tempo (testnet or mainnet) has no native coin worth counting.
  const isTempo = network.family === "tempo";
  // The public, unshielded asset differs by network: equities on Robinhood
  // Chain testnet, stablecoins (and $GLOAM) everywhere else.
  const publicAssetLabel = network.stocks ? "Stocks" : "Tokens";
  const publicAssetSub = network.stocks
    ? "Tokenized stocks, live prices"
    : network.family === "tempo"
      ? "Stablecoins in your wallet"
      : "Stablecoins and tokens in your wallet";
  const { settings } = useTradingSettings();
  const { data: marketData } = useLiveMarkets();
  const ethUsd = marketData?.ethUsd ?? null;
  const markets = useMemo(() => marketData?.markets ?? [], [marketData]);
  // The native gas asset is priced differently per chain: Robinhood is ETH
  // (marked against ETH/USD), Tempo's native currency IS the US dollar, so a
  // unit is worth $1, never the ETH price. The wallet card labels it with the
  // chain's own symbol rather than a hardcoded "ETH".
  const nativeSymbol = network.primaryAsset.symbol;
  const nativeUsdRate: number | null = isTempo ? 1 : ethUsd;
  const { open: shieldNotes, merged: allNotes, shieldedWei, byAsset, syncing, refresh: refreshVault } =
    useLocalShieldNotes(address);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    refreshVault();
    await queryClient.invalidateQueries().catch(() => {});
    window.setTimeout(() => setRefreshing(false), 600);
  };
  const shieldLive = isShieldDeployed();

  const { data: bal, isLoading } = useAppBalance({
    address,
    chainId: network.chainId,
    enabled: Boolean(address),
  });

  // Public tokens differ by chain: equities on Robinhood, faucet stablecoins on
  // Tempo. Reading Robinhood's stock tokens on Tempo (or vice-versa) is exactly
  // why the holdings looked empty on the wrong chain.
  const tokenSet = useMemo(
    () => shieldTokensFor(network.chainId),
    [network.chainId]
  );

  const tokenAddresses = useMemo(() => tokenSet.map((t) => t.address), [tokenSet]);
  const tokenBals = useAppTokenBalances({
    tokens: tokenAddresses,
    address,
    chainId: network.chainId,
    enabled: onProduct,
  });

  const positions = useMemo(() => {
    return tokenSet
      .map((t, i) => {
        const raw = tokenBals[i] ?? BigInt(0);
        const m = markets.find((x) => x.id === t.id);
        // Stablecoins are worth $1; equities use their live mark.
        const mark = t.kind === "stablecoin" ? 1 : (m?.mark ?? 0);
        const amount = Number(raw) / 10 ** t.decimals;
        const usd = amount * mark;
        return {
          ...t,
          raw,
          amount,
          mark,
          usd,
          change24h: m?.change24h ?? 0,
          spark: m?.spark ?? [],
          live: m?.source === "live",
        };
      })
      .filter((p) => (settings.hideZeroBalances ? p.raw > BigInt(0) : true));
  }, [tokenSet, tokenBals, markets, settings.hideZeroBalances]);

  const shieldRows = useMemo(() => {
    const rows: {
      asset: string;
      label: string;
      amount: bigint;
      usd: number | null;
    }[] = [];
    byAsset.forEach((amount, asset) => {
      if (amount <= BigInt(0)) return;
      const label = assetLabel(asset);
      let usd: number | null = null;
      if (isNativeAsset(asset) && nativeUsdRate != null) {
        usd = (Number(amount) / 1e18) * nativeUsdRate;
      } else {
        const tok = tokenSet.find(
          (t) => t.address.toLowerCase() === asset.toLowerCase()
        );
        if (tok) {
          const dec = tok.decimals;
          if (tok.kind === "stablecoin") {
            usd = Number(amount) / 10 ** dec; // $1 each
          } else {
            const m = markets.find((x) => x.id === tok.id);
            if (m?.mark) usd = (Number(amount) / 10 ** dec) * m.mark;
          }
        }
      }
      rows.push({ asset, label, amount, usd });
    });
    return rows.sort((a, b) => {
      if (isNativeAsset(a.asset)) return -1;
      if (isNativeAsset(b.asset)) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [byAsset, nativeUsdRate, markets, tokenSet]);

  // Tempo has no native coin: its nodes answer a wallet's native balance with a
  // huge placeholder, so on Tempo the wallet's public money is its stablecoins.
  const nativeWei = isTempo ? BigInt(0) : (bal?.value ?? BigInt(0));
  const ethAmt = Number(nativeWei) / 1e18;
  const shieldEthUsd =
    nativeUsdRate != null && shieldedWei > BigInt(0)
      ? (Number(shieldedWei) / 1e18) * nativeUsdRate
      : 0;
  const shieldStocksUsd = shieldRows
    .filter((r) => !isNativeAsset(r.asset))
    .reduce((s, r) => s + (r.usd ?? 0), 0);
  const ethUsdVal = nativeUsdRate != null ? ethAmt * nativeUsdRate : null;
  const stocksUsd = positions.reduce((s, p) => s + p.usd, 0);
  // On Robinhood the native ETH is a real holding and counts toward value. On
  // Tempo the native USD is a faucet balance (the faucet hands out an absurd
  // amount), so it is NOT portfolio value. Total value there reflects only what
  // you actually hold and have shielded (stablecoins + vault).
  const nativeHeldUsd = isTempo ? 0 : (ethUsdVal ?? 0);
  const totalUsd = nativeHeldUsd + stocksUsd + shieldEthUsd + shieldStocksUsd;

  const hasShield = shieldRows.length > 0;
  const stockCount = positions.filter((p) => p.raw > BigInt(0)).length;

  // Public (wallet + tokens) vs sealed (vault) split, the whole point.
  const publicUsd = nativeHeldUsd + stocksUsd;
  const sealedUsd = shieldEthUsd + shieldStocksUsd;
  const totalKnown = publicUsd + sealedUsd;
  const sealedPct =
    isConnected && onProduct && totalKnown > 0
      ? Math.round((sealedUsd / totalKnown) * 100)
      : null;

  // Balances only mean anything when the wallet is on this network. When it is
  // connected to a different chain, its on-chain reads belong to that foreign
  // chain (and can be absurdly large), so hold everything at zero until the
  // wallet is switched, which is exactly what the wrong-network banner says.
  const balancesVisible = isConnected && onProduct;

  const totalDisplay = !balancesVisible
    ? settings.showUsd
      ? formatUsd(0)
      : `0 ${nativeSymbol}`
    : totalUsd != null && settings.showUsd
      ? formatUsdCompact(totalUsd)
      : `${formatEth(nativeWei + shieldedWei)} ${nativeSymbol}`;

  const walletValue = isTempo
    ? formatUsdCompact(balancesVisible ? stocksUsd : 0)
    : !balancesVisible
      ? `0 ${nativeSymbol}`
      : `${formatEth(nativeWei)} ${nativeSymbol}`;
  const walletSub = isTempo
    ? "Stablecoins, visible on the explorer"
    : !balancesVisible
      ? "Visible on the explorer"
      : ethUsdVal != null && settings.showUsd
        ? formatUsdCompact(ethUsdVal)
        : "Visible on the explorer";

  const vaultValue = !balancesVisible
    ? "0"
    : !hasShield
      ? "0"
      : shieldRows.length === 1
        ? `${
            isNativeAsset(shieldRows[0].asset)
              ? formatEth(shieldRows[0].amount)
              : formatAssetAmount(shieldRows[0].amount, shieldRows[0].asset)
          } ${shieldRows[0].label}`
        : `${shieldRows.length} assets`;

  // The hero number: what sits in the vault, only readable in this browser.
  const privateDisplay = !balancesVisible
    ? settings.showUsd
      ? formatUsd(0)
      : "0"
    : settings.showUsd && (sealedUsd > 0 || !hasShield)
      ? formatUsdCompact(sealedUsd)
      : vaultValue;
  const privateSub = !isConnected
    ? "Connect a wallet to see your private balance."
    : !onProduct
      ? `Switch your wallet to ${network.label} to see balances.`
      : syncing
        ? "Syncing your vault…"
        : !hasShield
          ? shieldLive
            ? "Nothing here yet. Add money privately and only you will see this number."
            : "The private vault is not live on this network yet."
          : settings.showUsd && sealedUsd > 0
            ? `${vaultValue} in your vault. Nobody else can see it.`
            : "Hidden from the public. Only this browser can read it.";

  const stocksValue = !balancesVisible
    ? settings.showUsd
      ? formatUsd(0)
      : "0 tokens"
    : settings.showUsd && stocksUsd > 0
      ? formatUsdCompact(stocksUsd)
      : `${stockCount} ${stockCount === 1 ? "token" : "tokens"}`;

  const quietLink =
    "inline-flex h-9 items-center rounded-full px-3 text-[13px] text-mute transition-colors hover:bg-surface hover:text-foreground disabled:opacity-60";

  return (
    <div className="space-y-5">
      <OnboardingCard />

      {/* Private balance: the hero. The field behind it is the sealed signal. */}
      <section className="gl-card relative overflow-hidden">
        <SealedField tone="soft" />
        <div className="relative z-[1] max-sm:p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex items-center gap-2.5">
              <span className="text-[14px] text-soft">Private balance</span>
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-sealed-soft px-2.5 text-[12px] font-medium text-sealed">
                <LockIcon />
                Only you
              </span>
            </div>
            <div className="-mr-2 flex flex-wrap items-center gap-0.5">
              <NetworkPulse />
              {network.key === "tempo" ? (
                <TempoFaucetButton className={quietLink} />
              ) : faucet ? (
                <a
                  href={faucet.url}
                  target={faucetExternal ? "_blank" : undefined}
                  rel={faucetExternal ? "noreferrer" : undefined}
                  className={quietLink}
                  title={faucet.blurb}
                >
                  Get test funds
                </a>
              ) : null}
              <button type="button" onClick={openOnboarding} className={quietLink}>
                Getting started
              </button>
              <button
                type="button"
                onClick={() => void refreshAll()}
                disabled={refreshing || !isConnected}
                aria-label="Refresh balances"
                title="Refresh balances"
                className="grid h-9 w-9 place-items-center rounded-full text-mute transition-colors hover:bg-surface hover:text-foreground disabled:opacity-60"
              >
                <svg
                  aria-hidden
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  className={refreshing || syncing ? "animate-spin motion-reduce:animate-none" : undefined}
                >
                  <path
                    d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="max-lg:mt-6 flex max-lg:flex-col gap-7 lg:mt-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p
                className={`tnum truncate max-sm:text-[48px] font-light leading-none tracking-[-0.03em] sm:text-[64px] ${
                  balancesVisible && hasShield ? "text-foreground" : "text-foreground/85"
                }`}
              >
                {privateDisplay}
              </p>
              <p className="mt-3 max-w-[52ch] text-[14px] leading-relaxed text-mute">{privateSub}</p>
            </div>

            <div className="shrink-0 gap-2 max-sm:grid max-sm:grid-cols-2 sm:flex sm:flex-wrap">
              <QuickAction
                href="/app/shield"
                label="Add privately"
                icon={<AddIcon />}
                primary
                disabled={!shieldLive}
                className="max-sm:col-span-2"
              />
              <QuickAction href="/app/send" label="Send" icon={<SendIcon />} />
              <QuickAction href="/app/move" label="Move" icon={<MoveIcon />} disabled={!shieldLive} />
            </div>
          </div>
        </div>

        {/* network banner lives in the card footer; the sidebar already
            carries the connect control, so no connect prompt here */}
        {isConnected && !onProduct && (
          <div className="relative z-[1] flex max-sm:flex-col gap-3 border-t border-line max-sm:px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <p className="text-[14px] text-danger">Switch your wallet to {network.label} to see balances.</p>
            <WalletMenu />
          </div>
        )}
        {isConnected && onProduct && address && (
          <div className="relative z-[1] flex items-center justify-between gap-3 border-t border-line max-sm:px-6 py-2.5 sm:px-8">
            <span className="text-[12.5px] text-mute">Wallet</span>
            <AddressChip address={address} className="min-h-9 text-[12.5px]" />
          </div>
        )}
      </section>

      {/* Recovery: back the private balance up, or bring it back on a new device. */}
      {onProduct && shieldLive && (
        <RecoveryNudge
          hasBalance={shieldNotes.some((n) => Boolean(n.secret) && n.secret !== "0x")}
          hasDeposits={allNotes.some((n) => n.source === "chain")}
        />
      )}

      {/* Holds a private balance here but has never paid privately from this
          device: point at Pay with a small amount filled in. */}
      {balancesVisible && hasShield && shieldLive && (
        <FirstPaymentCard open={shieldNotes} all={allNotes} chainId={network.chainId} />
      )}

      {/* Total + public accounts */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="gl-card flex min-w-0 flex-col p-5">
          <div className="flex h-6 items-center justify-between gap-3">
            <span className="text-[13px] text-mute">Total value</span>
            {sealedPct != null && (
              <span className="tnum text-[12px] text-mute">{sealedPct}% private</span>
            )}
          </div>
          <p className="tnum mt-4 truncate text-[28px] font-light leading-none tracking-[-0.02em] text-foreground">
            {totalDisplay}
          </p>
          <div className="mt-auto pt-4">
            <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface" aria-hidden>
              {sealedPct != null && (
                <>
                  <span className="h-full rounded-full bg-foreground/75" style={{ width: `${100 - sealedPct}%` }} />
                  <span className="h-full rounded-full bg-sealed" style={{ width: `${sealedPct}%` }} />
                </>
              )}
            </div>
            <div className="mt-2.5 flex items-center gap-4 text-[12px] text-mute">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-foreground/75" />
                Public{sealedPct != null ? ` ${100 - sealedPct}%` : ""}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-sealed" />
                Private{sealedPct != null ? ` ${sealedPct}%` : ""}
              </span>
            </div>
          </div>
        </div>
        <StatCard
          label="Wallet"
          sealed={false}
          value={walletValue}
          sub={walletSub}
          loading={isConnected && isLoading}
        />
        <StatCard
          label={publicAssetLabel}
          sealed={false}
          value={stocksValue}
          sub={publicAssetSub}
        />
      </div>

      {/* Main split: vault + holdings, with the public feed alongside */}
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="min-w-0 space-y-5 lg:col-span-8">
          {shieldNotes.length > 0 && (
            <section className="gl-card overflow-hidden">
              <header className="flex items-center justify-between gap-3 max-sm:px-5 pb-3 pt-5 sm:px-6">
                <div>
                  <h2 className="text-[17px] text-foreground">In your vault</h2>
                  <p className="mt-0.5 text-[13px] text-mute">Only this browser can read these amounts</p>
                </div>
                <KindBadge sealed />
              </header>
              <ul className="divide-y divide-line border-t border-line">
                {shieldNotes.slice(0, 6).map((n) => (
                  <li
                    key={n.id}
                    className="flex min-h-[64px] items-center justify-between gap-3 max-sm:px-5 py-3 transition-colors hover:bg-surface/60 sm:px-6"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sealed-soft text-sealed" aria-hidden>
                        <LockIcon />
                      </span>
                      <div className="min-w-0">
                        <p className="tnum truncate text-[15px] text-foreground">
                          {isNativeAsset(n.asset)
                            ? formatEth(BigInt(n.amountWei))
                            : formatAssetAmount(BigInt(n.amountWei), n.asset)}{" "}
                          <span className="text-mute">{assetLabel(n.asset)}</span>
                        </p>
                        <p className="mt-0.5 truncate text-[12.5px] text-mute">
                          {n.leafIndex != null
                            ? "Ready to send privately or cash out"
                            : "Confirming…"}
                          {isClaimedNote(n) || isSecuredClaim(n) ? ", received" : ""}
                        </p>
                        {isUnsecuredClaim(n) && (
                          <p className="mt-0.5 text-[12.5px] text-warn">
                            Not secured yet, so the sender can still take it back.{" "}
                            <Link
                              href="/app/vault?tab=move"
                              className="font-medium underline underline-offset-4"
                            >
                              Secure it
                            </Link>
                          </p>
                        )}
                        {n.note && (
                          <PaymentNoteLine
                            note={n.note}
                            label="Their note"
                            className="mt-0.5 text-[12.5px] text-soft"
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {n.txHash && (
                        <a
                          href={network.explorerTx(n.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="max-sm:hidden h-9 items-center rounded-full px-3 text-[13px] text-mute transition-colors hover:bg-surface hover:text-foreground sm:inline-flex"
                        >
                          Receipt
                        </a>
                      )}
                      {network.stocks && (
                        <Link
                          href={
                            isNativeAsset(n.asset)
                              ? "/app/trade?path=sealed"
                              : `/app/trade?path=sealed&side=sell&market=${
                                  tokenSet.find(
                                    (t) =>
                                      t.address.toLowerCase() ===
                                      n.asset.toLowerCase()
                                  )?.id ?? "tsla"
                                }`
                          }
                          className="btn btn-quiet btn-sm h-10"
                        >
                          Trade
                        </Link>
                      )}
                      <Link href="/app/move" className="btn btn-ghost btn-sm h-10">
                        Move
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Holdings table */}
          <section className="gl-card overflow-hidden">
            <header className="flex items-center justify-between gap-3 max-sm:px-5 pb-3 pt-5 sm:px-6">
              <div>
                <h2 className="text-[17px] text-foreground">Holdings</h2>
                <p className="mt-0.5 text-[13px] text-mute">Public tokens in your wallet</p>
              </div>
              <KindBadge sealed={false} />
            </header>
            {!balancesVisible ? (
              <div className="border-t border-line">
                <EmptyState
                  title={!isConnected ? "Connect a wallet" : `Switch to ${network.label}`}
                  body={
                    !isConnected
                      ? faucet
                        ? "Your tokens from the faucet show up here once you connect."
                        : "Your tokens show up here once you connect."
                      : `Your wallet is on another network. Switch it to ${network.label} to see your tokens.`
                  }
                />
              </div>
            ) : positions.length === 0 && nativeWei === BigInt(0) ? (
              <div className="border-t border-line">
                {faucet ? (
                  <EmptyState
                    title="No tokens yet"
                    body="Claim free test tokens to try paying and holding privately."
                    action={
                      <a
                        href={faucet.url}
                        target={faucetExternal ? "_blank" : undefined}
                        rel={faucetExternal ? "noreferrer" : undefined}
                        className="btn btn-ghost btn-sm h-10"
                      >
                        Claim from the faucet
                      </a>
                    }
                  />
                ) : (
                  <EmptyState
                    title="No tokens yet"
                    body={`Gloam takes ${tokenSet.map((t) => t.symbol).join(", ")} on ${network.label}. Once one is in your wallet, you can add it privately.`}
                  />
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center border-t border-line max-sm:px-5 py-2.5 sm:px-6">
                  <span className="t-label flex-1">Asset</span>
                  <span className="t-label max-sm:hidden w-[88px] text-center sm:block">24h</span>
                  <span className="t-label w-28 text-right">Balance</span>
                  <span className="w-[200px] max-sm:hidden" aria-hidden />
                </div>
                <ul className="divide-y divide-line border-t border-line">
                  {nativeWei > BigInt(0) && (
                    // The gas coin. Robinhood Chain mainnet's pool does not take it, so it
                    // shows here without an add button.
                    <li className="flex min-h-[64px] items-center gap-3 max-sm:px-5 py-3 transition-colors hover:bg-surface/60 sm:px-6">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <TokenLogo id="eth" symbol={nativeSymbol} size={34} />
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-medium text-foreground">{nativeSymbol}</p>
                          <p className="truncate text-[12.5px] text-mute">Ether, pays network fees</p>
                        </div>
                      </div>
                      <div className="max-sm:hidden w-[88px] sm:block" aria-hidden />
                      <div className="w-28 text-right">
                        <p className="tnum text-[14px] text-foreground">{formatEth(nativeWei)}</p>
                        {settings.showUsd && nativeUsdRate != null && (
                          <p className="tnum text-[12.5px] text-mute">
                            {formatUsd((Number(nativeWei) / 1e18) * nativeUsdRate)}
                          </p>
                        )}
                      </div>
                      <div className="w-[200px] justify-end gap-1 max-sm:hidden sm:flex">
                        {shieldLive && supportsNativeShield(network.chainId) ? (
                          <Link href="/app/shield" className="btn btn-ghost btn-sm">
                            Add privately
                          </Link>
                        ) : (
                          // Where the pool doesn't take the gas coin, swap it into the one it does.
                          <SwapToStableButton recipient={address ?? undefined} onArrived={() => router.push("/app/shield")} />
                        )}
                      </div>
                    </li>
                  )}
                  {positions.map((p) => (
                    <li
                      key={p.id}
                      className="flex min-h-[64px] items-center gap-3 max-sm:px-5 py-3 transition-colors hover:bg-surface/60 sm:px-6"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <TokenLogo id={p.id} symbol={p.symbol} size={34} />
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-medium text-foreground">{p.symbol}</p>
                          <p className="truncate text-[12.5px] text-mute">{p.name}</p>
                        </div>
                      </div>
                      <div className="max-sm:hidden w-[88px] justify-center sm:flex">
                        <Sparkline
                          // Real history only: without it the line stays a flat hairline.
                          points={p.spark.length >= 2 ? p.spark : []}
                          up={p.change24h >= 0}
                          width={72}
                          height={26}
                        />
                      </div>
                      <div className="w-28 text-right">
                        <p className="tnum text-[14px] text-foreground">
                          {formatTokenAmount(p.raw, p.decimals)}
                        </p>
                        {settings.showUsd && p.mark > 0 && (
                          <p className="tnum text-[12.5px] text-mute">
                            {p.usd > 0
                              ? formatUsd(p.usd)
                              : `$${formatMark(p.mark)}`}
                          </p>
                        )}
                      </div>
                      <div className="w-[200px] justify-end gap-1 max-sm:hidden sm:flex">
                        {shieldLive && (
                          <Link href="/app/shield" className="btn btn-ghost btn-sm">
                            Add privately
                          </Link>
                        )}
                        {network.stocks && (
                          <Link href={`/app/trade?market=${p.id}`} className="btn btn-quiet btn-sm">
                            Trade
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-4">
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}
