"use client";

/**
 * Swap inside the private balance (lib/vaultSwap, lib/vaultSwapRun). Shown
 * only where a vault swap router is deployed. Who swapped stays private; the
 * amounts show on chain, like any DEX trade, and the copy says so.
 */
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { useAppAccount } from "@/lib/demo";
import { useLocalShieldNotes } from "@/hooks/useLocalShieldNotes";
import { getRhPublicClient } from "@/lib/rhClient";
import { relayFor } from "@/lib/relay/client";
import { isUnsecuredClaim } from "@/lib/claimSweep";
import { freshPath } from "@/lib/cashOutSplit";
import {
  assetLabel,
  formatAssetAmount,
  formatAssetLabel,
  formatFeePercent,
  parseAssetAmount,
  shieldPoolAbi,
  type LocalNote,
} from "@/lib/shield";
import { VAULT_SWAP_ASSETS, planVaultSwap, swapBufferBps, vaultSwapRouter, type SwapPlan } from "@/lib/vaultSwap";
import { SWAP_REFUNDED, runVaultSwap } from "@/lib/vaultSwapRun";
import type { PoseidonMerklePath } from "@/lib/merklePoseidon";
import { useNetwork } from "./NetworkProvider";
import { WalletMenu } from "./WalletMenu";

const limitAbi = [
  {
    type: "function",
    name: "depositLimit",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "perDeposit", type: "uint128" },
      { name: "total", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "deposited",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function VaultSwapView() {
  const { network } = useNetwork();
  const { address, isConnected } = useAppAccount();
  const router = vaultSwapRouter(network.chainId);
  const assets = useMemo(() => VAULT_SWAP_ASSETS[network.chainId] ?? [], [network.chainId]);
  const { open, refresh: refreshNotes } = useLocalShieldNotes(address);

  // Notes a swap can spend: this vault's, in a swap asset, with their secret.
  // A claimed payment the payer could still take back is secured first, in Pay.
  const notes = useMemo(
    () =>
      open
        .filter(
          (n) =>
            n.chainId === network.chainId &&
            network.pool != null &&
            same(n.pool, network.pool) &&
            n.bound &&
            (!n.scheme || n.scheme === "poseidon") &&
            assets.some((a) => same(a, n.asset)) &&
            !isUnsecuredClaim(n)
        )
        .sort((a, b) => (BigInt(a.amountWei) > BigInt(b.amountWei) ? -1 : 1)),
    [open, network.chainId, network.pool, assets]
  );

  const [noteId, setNoteId] = useState<string | null>(null);
  const note: LocalNote | null = notes.find((n) => n.id === noteId) ?? notes[0] ?? null;
  const [toPick, setToPick] = useState<Address | null>(null);
  const toAsset: Address | null =
    (toPick && note && !same(toPick, note.asset) ? toPick : null) ?? assets.find((a) => note && !same(a, note.asset)) ?? null;
  const [amountInput, setAmountInput] = useState("");

  const noteWei = note ? BigInt(note.amountWei) : 0n;
  const typed = amountInput.trim() && note ? parseAssetAmount(amountInput.trim(), note.asset) : null;
  const amountInvalid = amountInput.trim() !== "" && (typed === null || typed <= 0n || typed > noteWei);
  const amount = typed !== null && !amountInvalid ? typed : noteWei;

  const { data: feeRead } = useReadContract({
    address: network.pool ?? undefined,
    abi: shieldPoolAbi,
    functionName: "withdrawFeeBps",
    chainId: network.chainId,
    query: { enabled: Boolean(network.pool) },
  });
  const feeBps = typeof feeRead === "number" ? feeRead : null;
  const { data: limit } = useReadContract({
    address: network.pool ?? undefined,
    abi: limitAbi,
    functionName: "depositLimit",
    args: toAsset ? [toAsset] : undefined,
    chainId: network.chainId,
    query: { enabled: Boolean(network.pool && toAsset) },
  });
  const { data: inVault } = useReadContract({
    address: network.pool ?? undefined,
    abi: limitAbi,
    functionName: "deposited",
    args: toAsset ? [toAsset] : undefined,
    chainId: network.chainId,
    query: { enabled: Boolean(network.pool && toAsset) },
  });

  const [relayOk, setRelayOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void relayFor(network.chainId).then((r) => live && setRelayOk(Boolean(r?.enabled)));
    return () => {
      live = false;
    };
  }, [network.chainId]);

  const [plan, setPlan] = useState<SwapPlan | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // A fresh quote whenever what is being swapped changes (after a short pause while typing).
  const quoteKey = note && toAsset && feeBps != null && !amountInvalid ? `${note.id}|${toAsset}|${amount}|${feeBps}` : null;
  useEffect(() => {
    if (!quoteKey || !note || !toAsset || feeBps == null || busy) return;
    let live = true;
    const t = window.setTimeout(() => {
      setQuoting(true);
      setQuoteError(null);
      planVaultSwap(getRhPublicClient(), network.chainId, { assetIn: note.asset, assetOut: toAsset, amountIn: amount, feeBps })
        .then((p) => live && setPlan(p))
        .catch((e) => {
          if (!live) return;
          setPlan(null);
          setQuoteError(e instanceof Error ? e.message : "Could not get a price. Try again.");
        })
        .finally(() => live && setQuoting(false));
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quoteKey names everything the quote reads
  }, [quoteKey, network.chainId, busy]);
  const shownPlan = plan && quoteKey ? plan : null;

  // The vault's beta deposit limits apply to what lands.
  const room =
    limit && typeof inVault === "bigint"
      ? (() => {
          const [per, total] = limit;
          const left = total > inVault ? total - inVault : 0n;
          return per < left ? per : left;
        })()
      : null;
  const overRoom = shownPlan && room != null && shownPlan.amountOut > room;

  if (!router) return null;

  async function onSwap() {
    if (!note || !toAsset || !shownPlan || !address) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { outNote, refunded } = await runVaultSwap({
        network,
        router: router!,
        note,
        amount,
        assetOut: toAsset,
        plan: shownPlan,
        owner: address as Address,
        pathFor: async (n) => ((await freshPath(n.commitment))?.path as PoseidonMerklePath | undefined) ?? null,
        onStatus: setStatus,
      });
      setDone(
        refunded ? SWAP_REFUNDED : `Swapped. ${formatAssetLabel(outNote.amountWei, outNote.asset)} is in your private balance.`
      );
      setAmountInput("");
      setPlan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The swap failed. Nothing moved.");
    } finally {
      setBusy(false);
      setStatus(null);
      refreshNotes();
    }
  }

  const venue = network.chainId === 4217 ? "Tempo's stablecoin exchange" : "Uniswap on Robinhood Chain";
  const canSwap =
    Boolean(note && toAsset && shownPlan && address) && !quoting && !busy && !amountInvalid && !overRoom && relayOk === true;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="gl-card p-5 sm:p-6">
        <p className="t-title text-foreground">Swap privately</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-mute">
          Swap inside your private balance. Who swapped stays private. The amounts show on chain, like any DEX trade.
        </p>

        {!isConnected || !address ? (
          <div className="mt-6 space-y-3">
            <p className="text-[13.5px] text-soft">Connect the wallet you use with Gloam to see your private balance.</p>
            <WalletMenu />
          </div>
        ) : !notes.length ? (
          <p className="mt-6 rounded-xl bg-surface px-4 py-3 text-[13.5px] leading-relaxed text-soft">
            Nothing to swap yet. Add {assets.map(assetLabel).join(" or ")} to your private balance first.
          </p>
        ) : (
          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="swap-from" className="text-[13px] text-mute">
                From your private balance
              </label>
              <select
                id="swap-from"
                value={note?.id ?? ""}
                onChange={(e) => {
                  setNoteId(e.target.value);
                  setAmountInput("");
                }}
                disabled={busy}
                className="gl-input mt-2"
              >
                {notes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {formatAssetLabel(n.amountWei, n.asset)}
                  </option>
                ))}
              </select>
              <label htmlFor="swap-amount" className="sr-only">
                Amount to swap
              </label>
              <input
                id="swap-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amountInput}
                disabled={busy}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder={note ? `All of it: ${formatAssetAmount(note.amountWei, note.asset)}` : "Amount"}
                className="gl-input tnum mt-3"
              />
              {amountInvalid && (
                <p className="mt-2 text-[12.5px] text-warn">Enter an amount up to this balance.</p>
              )}
              {!amountInvalid && note && amount < noteWei && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
                  The rest stays in your private balance: it is set aside privately first.
                </p>
              )}
            </div>

            <div>
              <p id="swap-to" className="text-[13px] text-mute">
                To
              </p>
              <div role="radiogroup" aria-labelledby="swap-to" className="mt-2 flex flex-wrap gap-2">
                {assets
                  .filter((a) => note && !same(a, note.asset))
                  .map((a) => {
                    const active = toAsset != null && same(a, toAsset);
                    return (
                      <button
                        key={a}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={busy}
                        onClick={() => setToPick(a)}
                        className={`min-h-[44px] rounded-[14px] border px-4 text-[14px] transition-colors ${
                          active ? "border-foreground bg-panel text-foreground" : "border-line text-soft hover:border-line-strong hover:bg-surface"
                        }`}
                      >
                        {assetLabel(a)}
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="rounded-[14px] bg-surface px-4 py-3.5" aria-live="polite">
              {quoting && !shownPlan ? (
                <p className="text-[13.5px] text-mute">Getting a price…</p>
              ) : quoteError ? (
                <p className="text-[13.5px] text-warn">{quoteError}</p>
              ) : shownPlan && toAsset ? (
                <>
                  <p className="text-[12.5px] text-mute">You get</p>
                  <p className="tnum mt-0.5 text-[22px] leading-tight text-foreground">
                    {formatAssetLabel(shownPlan.amountOut, toAsset)}
                  </p>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
                    Through {venue}. The vault keeps its {formatFeePercent(feeBps ?? 0)} cash-out fee, and the swap asks{" "}
                    {formatFeePercent(swapBufferBps(network.chainId))} under the price so a small move can&apos;t stop it.
                    What it doesn&apos;t use, about {formatAssetLabel(shownPlan.leftover, note!.asset)}, goes to the Gloam treasury.
                  </p>
                  {overRoom && room != null && (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-warn">
                      The vault takes at most {formatAssetLabel(room, toAsset)} right now. Swap a smaller amount.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[13.5px] text-mute">Pick what to swap.</p>
              )}
            </div>

            {relayOk === false && (
              <p className="text-[12.5px] leading-relaxed text-warn">
                Swaps go through the Gloam relay, so your wallet never shows. It is off right now; try again soon.
              </p>
            )}

            <button type="button" disabled={!canSwap} onClick={() => void onSwap()} className="btn btn-ink btn-lg btn-block">
              {busy ? <span className="truncate">{status ?? "Working…"}</span> : "Swap privately"}
            </button>

            {error && (
              <p role="alert" className="break-words rounded-xl bg-danger-soft px-4 py-3 text-[13.5px] leading-relaxed text-danger">
                {error}
              </p>
            )}
            {done && <p className="rounded-xl bg-surface px-4 py-3 text-[13.5px] leading-relaxed text-foreground">{done}</p>}
          </div>
        )}
      </div>

      <div className="gl-card p-5 text-[13px] leading-relaxed text-soft">
        <p className="t-title text-foreground">What stays private</p>
        <ul className="mt-3 space-y-2">
          <li>Who swapped. The Gloam relay sends it, so your wallet never shows.</li>
          <li>Which balance it came from, and where the new one goes next.</li>
        </ul>
        <p className="t-title mt-5 text-foreground">What is public</p>
        <ul className="mt-3 space-y-2">
          <li>The two amounts and the two tokens, as with any trade on {venue}.</li>
          <li>So cashing out that exact amount later can be matched to this swap. Send it on or cash out a different amount.</li>
        </ul>
      </div>
    </div>
  );
}
