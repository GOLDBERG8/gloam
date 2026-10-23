"use client";

/**
 * Private trade: vault assetIn → vault assetOut. No DEX.
 * Buy = ETH → stock · Sell = stock → ETH.
 * Size stays private. Rates from display marks (exact circuit product).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  useAccount,
  useChainId,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatEther, type Address } from "viem";
import { ensureRhTestnetWallet, formatEth, shortAddress } from "@/lib/chain";
import { useNetwork } from "./NetworkProvider";
import { safeParseEther } from "@/lib/amount";
import { useLocalShieldNotes } from "@/hooks/useLocalShieldNotes";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { usePoolDeposited } from "@/hooks/usePoolDeposited";
import { useShieldTree } from "@/hooks/useShieldTree";
import { HASH_SCHEME, NATIVE_ASSET, SEALED_SWAP_GAS_LIMIT, assetLabel, isNativeAsset, isShieldDeployed, saveLocalNote, shieldPoolAbi, updateLocalNote, type LocalNote } from "@/lib/shield";
import { buildSealedSwapWitness } from "@/lib/proverSealedSwap";
import { fieldToBytes32, proveSealedSwapInBrowser } from "@/lib/proveClient";
import type { PoseidonMerklePath } from "@/lib/merklePoseidon";
import { formatUsd } from "@/lib/markets";
import {
  estimateSealedOut,
  exactSealedAmounts,
  fallbackOneToOneRates,
  formatSealedAmount,
  marksToSealedRates,
} from "@/lib/sealedRates";
import { TESTNET_STOCK_TOKENS } from "@/lib/tokens";
import {
  coarsenMarkUsd,
  publicAmountOutMin,
  type SizePrivacyMode,
} from "@/lib/privacy";
import { readVaultSealedReadiness } from "@/lib/vaultStatus";
import { DevKeysBanner } from "./DevKeysBanner";
import { StatusPill } from "./StatusPill";
import { SuccessModal } from "./SuccessModal";
import { WalletMenu } from "./WalletMenu";
import { SealedField } from "@/components/ui/SealedField";

type Support = "checking" | "ready" | "no_verifier" | "offline";
/** Buy = vault ETH → vault stock · Sell = vault stock → vault ETH */
type TradeDir = "buy" | "sell";

export function SealedTradePanel({
  marketId,
  marketSymbol,
  tokenAddress,
  initialDir = "buy",
}: {
  marketId?: string;
  marketSymbol: string;
  tokenAddress?: Address;
  /** buy = ETH→stock · sell = stock→ETH */
  initialDir?: TradeDir;
  /** kept for TradeView API compat; unused */
  onUseAdapter?: () => void;
}) {
  const shieldLive = isShieldDeployed();
  const poseidonMode = HASH_SCHEME === "poseidon";
  const { address, isConnected } = useAccount();
  const { network } = useNetwork();
  const chainId = useChainId();
  const onProduct = chainId === network.chainId;
  const { open, refresh: refreshNotes } = useLocalShieldNotes(address);
  const {
    pathForLeaf,
    leafIndexForCommitment,
    refresh: refreshTree,
    loading: treeLoading,
    error: treeError,
    leafCount,
  } = useShieldTree();
  // leafIndexForCommitment used after sealedSwap success to bind new notes
  const { data: marketsData } = useLiveMarkets();

  const [support, setSupport] = useState<Support>("checking");
  const [dir, setDir] = useState<TradeDir>(initialDir);

  useEffect(() => {
    setDir(initialDir);
  }, [initialDir]);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  /** max = amountOutMin = 1 on-chain (size privacy). Default on, our moat. */
  const [sizePrivacy, setSizePrivacy] = useState<SizePrivacyMode>("max");

  const spentNoteId = useRef<string | null>(null);
  const pendingOut = useRef<LocalNote | null>(null);
  const pendingChange = useRef<LocalNote | null>(null);
  const handledHash = useRef<string | null>(null);

  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();

  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    chainId: network.chainId,
  });

  // Dedicated RH RPC, works with wallet off or on another chain
  const checkVault = useCallback(async () => {
    if (!shieldLive || !poseidonMode) {
      setSupport("offline");
      return;
    }
    setSupport("checking");
    const r = await readVaultSealedReadiness();
    if (r.status === "ready") setSupport("ready");
    else if (r.status === "no_verifier") setSupport("no_verifier");
    else setSupport("offline");
  }, [shieldLive, poseidonMode]);

  useEffect(() => {
    void checkVault();
  }, [checkVault]);

  const stockToken =
    tokenAddress ??
    TESTNET_STOCK_TOKENS.find((t) => t.id === marketId)?.address ??
    TESTNET_STOCK_TOKENS.find(
      (t) => t.symbol.toLowerCase() === marketSymbol.toLowerCase()
    )?.address;

  /** Circuit assetIn / assetOut for current direction */
  const assetIn: Address =
    dir === "buy" ? NATIVE_ASSET : (stockToken ?? NATIVE_ASSET);
  const assetOut: Address =
    dir === "buy" ? (stockToken ?? NATIVE_ASSET) : NATIVE_ASSET;
  const inSymbol = dir === "buy" ? "ETH" : marketSymbol;
  const outSymbol = dir === "buy" ? marketSymbol : "ETH";

  const spendNotes = useMemo(() => {
    return open
      .filter((n) => {
        if (!n.bound || !n.secret || n.secret === "0x") return false;
        if (poseidonMode && n.scheme && n.scheme !== "poseidon") return false;
        if (dir === "buy") return isNativeAsset(n.asset);
        if (!stockToken) return false;
        return n.asset.toLowerCase() === stockToken.toLowerCase();
      })
      .map((n) => {
        if (n.leafIndex != null) return n;
        const idx = leafIndexForCommitment(n.commitment);
        return idx != null ? { ...n, leafIndex: idx } : n;
      })
      .filter((n) => n.leafIndex != null);
  }, [open, poseidonMode, leafIndexForCommitment, dir, stockToken]);

  const notesMissingIndex = useMemo(() => {
    return open.filter((n) => {
      if (!n.bound || !n.secret || n.secret === "0x") return false;
      if (poseidonMode && n.scheme && n.scheme !== "poseidon") return false;
      const assetOk =
        dir === "buy"
          ? isNativeAsset(n.asset)
          : Boolean(
              stockToken &&
                n.asset.toLowerCase() === stockToken.toLowerCase()
            );
      if (!assetOk) return false;
      return (
        n.leafIndex == null && leafIndexForCommitment(n.commitment) == null
      );
    }).length;
  }, [open, poseidonMode, leafIndexForCommitment, dir, stockToken]);

  useEffect(() => {
    if (support === "ready") void refreshTree();
  }, [support, refreshTree]);

  // Reset note + amount when flipping buy/sell
  useEffect(() => {
    setNoteId(null);
    setAmount("");
    setError(null);
  }, [dir]);

  const selected =
    spendNotes.find((n) => n.id === noteId) ?? spendNotes[0] ?? null;

  useEffect(() => {
    if (selected && selected.id !== noteId) setNoteId(selected.id);
  }, [selected, noteId]);

  const rateQuote = useMemo(() => {
    const markets = marketsData?.markets ?? [];
    const ethM =
      markets.find((m) => m.id === "eth") ??
      markets.find((m) => m.symbol === "ETH");
    const outM =
      markets.find((m) => m.id === marketId) ??
      markets.find(
        (m) => m.symbol.toLowerCase() === marketSymbol.toLowerCase()
      );
    const ethUsdRaw = marketsData?.ethUsd ?? ethM?.mark ?? null;
    const outUsdRaw = outM?.mark ?? null;
    const bothLive =
      ethM?.source === "live" && outM?.source === "live" && ethUsdRaw != null;
    let base =
      ethUsdRaw != null && outUsdRaw != null && ethUsdRaw > 0 && outUsdRaw > 0
        ? marksToSealedRates(
            coarsenMarkUsd(ethUsdRaw),
            coarsenMarkUsd(outUsdRaw),
            bothLive ? "live" : "static"
          )
        : null;
    if (!base) base = fallbackOneToOneRates();
    // Buy ETH→stock: rateIn=ETH, rateOut=stock. Sell stock→ETH: swap.
    if (dir === "sell") {
      return {
        ...base,
        rateIn: base.rateOut,
        rateOut: base.rateIn,
      };
    }
    return base;
  }, [marketsData, marketId, marketSymbol, dir]);

  const amountSwapPreview = safeParseEther(amount);
  const amountEntered =
    amountSwapPreview != null && amountSwapPreview > 0n;

  // Floor estimate always (instant UI). Exact fit for the circuit proof.
  const roughOut =
    amountEntered
      ? estimateSealedOut(
          amountSwapPreview!,
          rateQuote.rateIn,
          rateQuote.rateOut
        )
      : 0n;
  const exactPreview = amountEntered
    ? exactSealedAmounts(
        amountSwapPreview!,
        rateQuote.rateIn,
        rateQuote.rateOut
      )
    : null;
  const expectedOut = exactPreview?.amountOut ?? roughOut;
  const amountSwapExact = exactPreview?.amountSwap ?? 0n;
  const quoteReady = Boolean(exactPreview && exactPreview.amountOut > 0n);

  const {
    deposited: poolOutDeposited,
    isLoading: invLoading,
    refetch: refetchInv,
  } = usePoolDeposited(assetOut);
  // Inventory for the out asset (stock on buy, ETH on sell), cash-out solvency later
  const inventoryShort =
    expectedOut > 0n &&
    poolOutDeposited != null &&
    poolOutDeposited < expectedOut;

  useEffect(() => {
    if (!isSuccess || !hash) return;
    if (handledHash.current === hash) return;
    handledHash.current = hash;

    if (spentNoteId.current) {
      updateLocalNote(spentNoteId.current, { status: "recovered" });
      spentNoteId.current = null;
    }
    void (async () => {
      await refreshTree();
      // Attach leaf indices so Move/Private trade can spend new notes immediately
      const out = pendingOut.current;
      const chg = pendingChange.current;
      if (out) {
        const idx = leafIndexForCommitment(out.commitment);
        saveLocalNote({
          ...out,
          txHash: hash,
          leafIndex: idx ?? out.leafIndex,
        });
        pendingOut.current = null;
      }
      if (chg) {
        const idx = leafIndexForCommitment(chg.commitment);
        saveLocalNote({
          ...chg,
          txHash: hash,
          leafIndex: idx ?? chg.leafIndex,
        });
        pendingChange.current = null;
      }
      refreshNotes();
      setShowSuccess(true);
      setBusy(false);
      setStatus(null);
      void import("@/lib/track").then(({ track }) => {
        track("sealed_swap_success", { asset: marketSymbol.slice(0, 12) });
      });
      void import("@/lib/onboarding").then(({ markOnboardingStep }) => {
        markOnboardingStep("private-trade");
        markOnboardingStep("shield");
      });
    })();
  }, [
    isSuccess,
    hash,
    refreshNotes,
    refreshTree,
    marketSymbol,
    leafIndexForCommitment,
  ]);

  useEffect(() => {
    if (!writeError) return;
    const msg = writeError.message.slice(0, 180);
    queueMicrotask(() => {
      setBusy(false);
      setStatus(null);
      setError(msg);
    });
  }, [writeError]);

  async function onSealedSwap() {
    setError(null);
    if (
      !selected ||
      !address ||
      !network.pool ||
      !stockToken ||
      !poseidonMode
    ) {
      setError(
        dir === "buy"
          ? "Shield some ETH first, then pick a stock on the left."
          : `Shield some ${marketSymbol} first, or buy it privately.`
      );
      return;
    }
    if (support !== "ready") {
      setError("Vault not ready yet. Wait a second and try again.");
      return;
    }

    const amountWanted = safeParseEther(amount);
    if (amountWanted === null || amountWanted <= 0n) {
      setError("Enter an amount.");
      return;
    }
    if (amountWanted > BigInt(selected.amountWei)) {
      setError(`That is more ${inSymbol} than this vault balance holds.`);
      return;
    }

    const exact = exactSealedAmounts(
      amountWanted,
      rateQuote.rateIn,
      rateQuote.rateOut
    );
    if (!exact) {
      setError("Try Max, or a slightly smaller amount.");
      return;
    }

    setBusy(true);
    reset();
    handledHash.current = null;
    spentNoteId.current = selected.id;

    try {
      setStatus("Syncing vault…");
      await refreshTree();

      let leafIdx = selected.leafIndex;
      if (leafIdx == null) {
        leafIdx = leafIndexForCommitment(selected.commitment) ?? undefined;
      }
      if (leafIdx == null) {
        throw new Error(
          "This vault balance is not ready yet. Open Shield, wait for it to confirm, then come back."
        );
      }

      const path = await pathForLeaf(leafIdx);
      if (!path) throw new Error("Vault sync failed. Tap Refresh and retry.");

      setStatus("Building private proof… 10 to 40 seconds is normal.");
      const { rateIn, rateOut } = rateQuote;
      // Do NOT publish exact amountOut as amountOutMin, that was the size leak.
      const amountOutMin = publicAmountOutMin(exact.amountOut, sizePrivacy);
      // Audit M-3: a real client-side slippage floor. The public amountOutMin
      // above stays a privacy floor (~1 wei); this minOut refuses to build if the
      // output dropped below 1% of the quote before the proof was built (e.g. an
      // oracle move). The on-chain oracle ratio-tolerance is the settle-time guard.
      const SLIPPAGE_BPS = 100n; // 1%
      const minOut = (exact.amountOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;
      const w = await buildSealedSwapWitness({
        secretHex: selected.secret,
        amountIn: BigInt(selected.amountWei),
        amountSwap: exact.amountSwap,
        assetIn,
        assetOut,
        amountOutMin,
        minOut,
        rateIn,
        rateOut,
        path: path as PoseidonMerklePath,
      });
      if (w.blocker) throw new Error(w.blocker);

      let proofBytes: `0x${string}`;
      try {
        ({ proofBytes } = await proveSealedSwapInBrowser(w.circomInput));
      } catch (pe) {
        const msg = pe instanceof Error ? pe.message : String(pe);
        throw new Error(
          msg.includes("Assert") || msg.includes("Error in template")
            ? "Proof failed. Tap Refresh, then Max, and try again."
            : `Proof failed: ${msg.slice(0, 140)}`
        );
      }

      pendingOut.current = {
        id: `ss-out-${Date.now()}`,
        chainId: network.chainId,
        pool: network.pool,
        asset: w.outNote.asset,
        amountWei: w.outNote.amountWei,
        commitment: w.outNote.commitment,
        secret: w.outNote.secret,
        nullifier: w.outNote.nullifier,
        bound: true,
        scheme: "poseidon",
        from: address,
        createdAt: Date.now(),
        status: "open",
        source: "local",
      };
      pendingChange.current =
        BigInt(w.changeNote.amountWei) > 0n
          ? {
              id: `ss-chg-${Date.now()}`,
              chainId: network.chainId,
              pool: network.pool,
              asset: w.changeNote.asset,
              amountWei: w.changeNote.amountWei,
              commitment: w.changeNote.commitment,
              secret: w.changeNote.secret,
              nullifier: w.changeNote.nullifier,
              bound: true,
              scheme: "poseidon",
              from: address,
              createdAt: Date.now(),
              status: "open",
              source: "local",
            }
          : null;

      setStatus("Confirm in your wallet…");
      writeContract({
        address: network.pool,
        abi: shieldPoolAbi,
        functionName: "sealedSwap",
        args: [
          proofBytes,
          fieldToBytes32(w.publicInputs.root),
          fieldToBytes32(w.publicInputs.nullifier),
          fieldToBytes32(w.publicInputs.newCommitmentOut),
          fieldToBytes32(w.publicInputs.newCommitmentChange),
          assetIn,
          assetOut,
          w.publicInputs.amountOutMin,
          w.publicInputs.rateIn,
          w.publicInputs.rateOut,
        ],
        gas: SEALED_SWAP_GAS_LIMIT,
        chainId: network.chainId,
      });
      void import("@/lib/track").then(({ track }) => {
        // No amounts, privacy stack
        track("sealed_swap_submit", {
          asset: marketSymbol.slice(0, 12),
          dir,
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Private trade failed");
      setBusy(false);
      setStatus(null);
      pendingOut.current = null;
      pendingChange.current = null;
      spentNoteId.current = null;
    }
  }

  const working = busy || isPending || confirming;

  if (!shieldLive || !poseidonMode) {
    return (
      <div className="gl-card p-6 text-[14px] text-mute">
        Private trade is not configured on this build.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <DevKeysBanner compact />

        {support === "checking" && (
          <div className="gl-card flex items-center gap-3 p-6 text-[14px] text-mute">
            <Spinner />
            Connecting to the vault…
          </div>
        )}

        {support === "offline" && (
          <div className="gl-card p-6">
            <p className="t-title text-foreground">Can&apos;t reach the vault</p>
            <p className="mt-2 text-[14px] leading-relaxed text-mute">
              The app connects to the Robinhood testnet directly. Your wallet
              network does not matter here. Retry, or wait a few seconds if the
              network is slow.
            </p>
            {network.pool && (
              <p className="tnum mt-3 text-[12px] text-faint">
                Vault {shortAddress(network.pool, 6)}
              </p>
            )}
            <button
              type="button"
              onClick={() => void checkVault()}
              className="btn btn-ink btn-block mt-5"
            >
              Retry
            </button>
          </div>
        )}

        {support === "no_verifier" && (
          <div className="gl-card p-6">
            <p className="t-title text-foreground">Private trade is offline</p>
            <p className="mt-2 text-[14px] leading-relaxed text-mute">
              The vault is up, but private trade is not switched on yet. Use
              Shield or Cash out until then.
            </p>
          </div>
        )}

        {support === "ready" && (
          <div className="gl-card overflow-hidden">
            {/* header strip on the sealed field: the private signal */}
            <div className="relative overflow-hidden border-b border-line px-5 pb-5 pt-5">
              <SealedField tone="soft" />
              <div className="relative z-[1] flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="t-title text-foreground">Private trade</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-mute">
                    Vault {inSymbol} to vault {outSymbol}. Your amount stays
                    hidden. No public market needed.
                  </p>
                </div>
                <StatusPill tone="lime" dot>
                  Ready
                </StatusPill>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div
                className="grid grid-cols-2 gap-1 rounded-full bg-surface p-1"
                role="group"
                aria-label="Trade direction"
              >
                {(["buy", "sell"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={working}
                    onClick={() => setDir(d)}
                    aria-pressed={dir === d}
                    className={`h-10 truncate rounded-full px-2 text-[14px] font-medium transition-colors disabled:cursor-not-allowed ${
                      dir === d
                        ? "bg-panel text-foreground shadow-card dark:bg-surface-2"
                        : "text-mute hover:text-foreground"
                    }`}
                  >
                    {d === "buy" ? "Buy" : "Sell"} {marketSymbol}
                  </button>
                ))}
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-[16px] bg-surface p-4">
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${
                    sizePrivacy === "max"
                      ? "bg-sealed-soft text-sealed"
                      : "bg-surface-2 text-mute"
                  }`}
                  aria-hidden
                >
                  <LockGlyph />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-foreground">
                    Amount privacy {sizePrivacy === "max" ? "on" : "relaxed"}
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-relaxed text-mute">
                    {sizePrivacy === "max"
                      ? "The network can't see how much you traded. It only sees that a private trade happened."
                      : "This can reveal roughly how much you traded. Turn it back on to stay fully private."}
                  </span>
                  <span className="sr-only">
                    Maximum amount privacy (recommended)
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={sizePrivacy === "max"}
                  onChange={(e) =>
                    setSizePrivacy(e.target.checked ? "max" : "slippage")
                  }
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className="relative mt-1 h-6 w-10 shrink-0 rounded-full bg-surface-2 ring-1 ring-line-strong transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-mute after:transition-transform peer-checked:bg-ink peer-checked:ring-ink peer-checked:after:translate-x-4 peer-checked:after:bg-on-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy-500"
                />
              </label>

              <ol className="grid gap-2 text-[13px] text-mute">
                <li className="flex items-center gap-2.5">
                  <StepNum n={1} />
                  <span>
                    <Link
                      href="/app/shield"
                      className="font-medium text-foreground underline decoration-line-strong underline-offset-4 hover:decoration-foreground"
                    >
                      Shield {inSymbol}
                    </Link>{" "}
                    into the vault
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <StepNum n={2} />
                  Pick how much {inSymbol} to {dir === "buy" ? "spend" : "sell"}
                </li>
                <li className="flex items-center gap-2.5">
                  <StepNum n={3} />
                  Wait for the proof, confirm in your wallet
                </li>
              </ol>

              <div className="flex items-center justify-between gap-2 border-t border-line pt-4 text-[12px] text-mute">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      treeLoading
                        ? "bg-faint"
                        : treeError
                          ? "bg-danger"
                          : "bg-sealed"
                    }`}
                  />
                  <span className="truncate">
                    {treeLoading
                      ? "Syncing vault…"
                      : treeError
                        ? "Vault sync error"
                        : `Vault in sync · ${leafCount} private balances`}
                    {network.pool ? ` · ${shortAddress(network.pool, 4)}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void refreshTree()}
                  disabled={treeLoading || working}
                  className="btn btn-quiet btn-sm shrink-0"
                >
                  Refresh
                </button>
              </div>

              <div>
                <p className="text-[13px] text-mute">Your vault {inSymbol}</p>
                {spendNotes.length === 0 ? (
                  <div className="mt-2 rounded-[16px] border border-dashed border-line-strong px-4 py-4 text-[13px] leading-relaxed text-mute">
                    <p>
                      No vault {inSymbol} yet. This side spends{" "}
                      <strong className="font-medium text-foreground">
                        {inSymbol} in the vault
                      </strong>
                      .
                    </p>
                    <Link href="/app/shield" className="btn btn-ghost btn-block mt-3">
                      Shield {inSymbol}
                    </Link>
                    {dir === "sell" && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm btn-block mt-1.5"
                        onClick={() => setDir("buy")}
                      >
                        Or buy {marketSymbol} privately first
                      </button>
                    )}
                    {notesMissingIndex > 0 && (
                      <p className="mt-2 text-[12px] text-warn">
                        Found balances that are not ready yet. Tap Refresh above.
                      </p>
                    )}
                  </div>
                ) : (
                  <ul className="mt-2 grid gap-1.5">
                    {spendNotes.map((n) => {
                      const on = selected?.id === n.id;
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => setNoteId(n.id)}
                            aria-pressed={on}
                            className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-[14px] border px-4 py-2.5 text-left transition-colors ${
                              on
                                ? "border-foreground bg-panel"
                                : "border-line hover:border-line-strong"
                            }`}
                          >
                            <span className="flex items-center gap-3">
                              <span
                                aria-hidden
                                className={`grid h-4 w-4 place-items-center rounded-full border ${
                                  on ? "border-foreground" : "border-line-strong"
                                }`}
                              >
                                {on && (
                                  <span className="h-2 w-2 rounded-full bg-foreground" />
                                )}
                              </span>
                              <span className="tnum text-[15px] font-medium text-foreground">
                                {formatEth(BigInt(n.amountWei))} {inSymbol}
                              </span>
                            </span>
                            <span className="text-[12px] text-mute">
                              {assetLabel(n.asset)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="gl-inputcard p-5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="ss-amt" className="text-[13px] text-mute">
                    {inSymbol} to {dir === "buy" ? "spend" : "sell"}
                  </label>
                  <button
                    type="button"
                    className="rounded-full bg-panel px-2.5 py-1 text-[12px] font-medium text-foreground ring-1 ring-line transition-colors hover:ring-line-strong"
                    aria-label="Use full balance"
                    onClick={() =>
                      selected &&
                      setAmount(formatEther(BigInt(selected.amountWei)))
                    }
                  >
                    Max
                  </button>
                </div>
                <div className="mt-3 flex items-baseline gap-3">
                  <input
                    id="ss-amt"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) =>
                      setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                    }
                    placeholder="0"
                    className="tnum min-w-0 flex-1 bg-transparent text-[34px] font-light leading-none tracking-[-0.02em] text-foreground outline-none placeholder:text-faint"
                  />
                  <span className="shrink-0 text-[15px] font-medium text-mute">
                    {inSymbol}
                  </span>
                </div>
              </div>

              <div className="space-y-2.5 rounded-[16px] bg-surface px-4 py-3.5 text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-mute">You get (est.)</span>
                  <span
                    key={`${dir}-${amount}-${expectedOut.toString()}`}
                    className="tnum text-[15px] font-medium text-foreground"
                  >
                    {expectedOut > 0n
                      ? `${formatSealedAmount(expectedOut)} ${outSymbol}`
                      : amountEntered
                        ? `Can't price, try Max`
                        : `0 ${outSymbol}`}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-[12px] text-mute">
                  <span className="tnum min-w-0 truncate">
                    {rateQuote.source === "fallback_1_1"
                      ? "1:1 test rate"
                      : `ETH ${formatUsd(rateQuote.ethUsd)} · ${marketSymbol} ${formatUsd(rateQuote.outUsd)}`}
                  </span>
                  <StatusPill dot={rateQuote.source === "live"}>
                    {rateQuote.source === "live" ? "Live prices" : "Prices"}
                  </StatusPill>
                </div>
                {quoteReady &&
                  amountSwapExact > 0n &&
                  amountSwapPreview != null &&
                  amountSwapExact !== amountSwapPreview && (
                    <p className="tnum text-[12px] text-mute">
                      Exact amount {formatSealedAmount(amountSwapExact)}{" "}
                      {inSymbol} for the proof.
                    </p>
                  )}
                <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5 text-[12px] text-mute">
                  <span>Vault inventory ({outSymbol})</span>
                  <span className="flex items-center gap-2">
                    <span className="tnum font-medium text-foreground">
                      {invLoading
                        ? "…"
                        : poolOutDeposited != null
                          ? formatSealedAmount(poolOutDeposited)
                          : "Unknown"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void refetchInv()}
                      className="font-medium text-foreground underline decoration-line-strong underline-offset-4 hover:decoration-foreground"
                    >
                      Refresh
                    </button>
                  </span>
                </div>
              </div>

              {inventoryShort && (
                <p className="rounded-[14px] bg-warn-soft px-4 py-3 text-[13px] leading-relaxed text-warn">
                  The vault holds less {outSymbol} than this trade. The private
                  trade can still go through, but cashing out {outSymbol} later
                  may fail until the vault is refilled.{" "}
                  <Link href="/app/shield" className="font-medium underline underline-offset-4">
                    Shield more
                  </Link>
                </p>
              )}

              {!isConnected ? (
                <div className="space-y-2.5">
                  <p className="text-[13px] text-mute">
                    Connect a wallet to sign the trade. You can view the vault
                    without one.
                  </p>
                  <WalletMenu variant="inline" />
                </div>
              ) : !onProduct ? (
                <div className="space-y-2.5">
                  <p className="text-[13px] text-mute">
                    Your wallet is on another network. Switch to Robinhood
                    testnet to sign.
                  </p>
                  <button
                    type="button"
                    onClick={() => void ensureRhTestnetWallet()}
                    className="btn btn-ink btn-lg btn-block"
                  >
                    Switch to Robinhood testnet
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={
                      working ||
                      !selected ||
                      !stockToken ||
                      !amountEntered ||
                      !quoteReady ||
                      treeLoading
                    }
                    onClick={() => void onSealedSwap()}
                    className="btn btn-ink btn-lg btn-block"
                  >
                    {working ? (
                      <>
                        <Spinner onInk />
                        <span className="truncate">{status || "Working…"}</span>
                      </>
                    ) : (
                      <>
                        <LockGlyph />
                        {dir === "buy"
                          ? `Buy ${marketSymbol} privately`
                          : `Sell ${marketSymbol} privately`}
                      </>
                    )}
                  </button>
                  {!working && selected && amountEntered && !quoteReady && (
                    <p className="text-center text-[12px] text-warn">
                      Could not prepare a proof for that amount. Tap Max and try
                      again.
                    </p>
                  )}
                  {!working && !selected && (
                    <p className="text-center text-[12px] text-mute">
                      Select a vault {inSymbol} balance above.
                    </p>
                  )}
                  {!working && selected && !amountEntered && (
                    <p className="text-center text-[12px] text-mute">
                      Enter how much {inSymbol} to {dir === "buy" ? "spend" : "sell"}, or tap Max.
                    </p>
                  )}
                </>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-[14px] bg-danger-soft px-4 py-3 text-[13px] leading-relaxed text-danger"
                >
                  {error}
                </p>
              )}
              {status && !error && (
                <p className="text-[13px] text-mute">{status}</p>
              )}
              {hash && !isSuccess && (
                <p className="text-[13px] text-mute">
                  Submitted.{" "}
                  <a
                    href={network.explorerTx(hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground underline decoration-line-strong underline-offset-4 hover:decoration-foreground"
                  >
                    View on explorer
                  </a>
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <SuccessModal
        open={showSuccess}
        title="Private trade done"
        body={
          <p>
            You received vault {outSymbol}. Your amount stayed hidden. The
            network shows a private trade, not how much you traded. Cashing out
            later shows the amount publicly, so stay in the vault to stay
            private.
            {hash ? (
              <>
                {" "}
                <a
                  href={network.explorerTx(hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-foreground underline decoration-line-strong underline-offset-4 hover:decoration-foreground"
                >
                  View transaction
                </a>
              </>
            ) : null}
          </p>
        }
        primaryHref="/app"
        primaryLabel="See portfolio"
        onClose={() => setShowSuccess(false)}
      />
    </>
  );
}

function LockGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="currentColor" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

function StepNum({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="tnum grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-medium text-soft"
    >
      {n}
    </span>
  );
}

/** Small ring spinner; still (no spin) under reduced motion. */
function Spinner({ onInk = false }: { onInk?: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-4 w-4 shrink-0 rounded-full border-2 motion-safe:animate-spin ${
        onInk
          ? "border-on-ink/30 border-t-on-ink"
          : "border-line-strong border-t-foreground"
      }`}
    />
  );
}
