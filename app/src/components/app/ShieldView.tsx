"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useReadContract, useReadContracts } from "wagmi";
import {
  decodeEventLog,
  formatEther,
  formatUnits,
  maxUint256,
  type Address,
  type Hex,
} from "viem";
import { formatEth, shortAddress } from "@/lib/chain";
import {
  useAppAccount,
  useAppBalance,
  useAppTokenBalance,
  useAppTxReceipt,
  useAppWriteContract,
} from "@/lib/demo";
import { useNetwork } from "./NetworkProvider";
import { safeParseEther, safeParseUnits } from "@/lib/amount";
import { erc20Abi } from "@/lib/dex";
import { useEthPrice, useLiveMarkets } from "@/hooks/useLiveMarkets";
import { useLocalShieldNotes } from "@/hooks/useLocalShieldNotes";
import { formatUsd } from "@/lib/markets";
import { shieldTokensFor, supportsNativeShield } from "@/lib/tokens";
import { APPROVE_GAS_LIMIT, gasFor, HASH_SCHEME, NATIVE_ASSET, SHIELD_GAS_LIMIT, SHIELD_BOUND_GAS_LIMIT, type LocalNote, assetLabel, formatAssetAmount, isNativeAsset, isShieldDeployed, makeNoteMaterial, markAllNotesRecovered, saveLocalNote, shieldPoolAbi } from "@/lib/shield";
import { makeBoundNotePoseidon } from "@/lib/notePoseidon";
import { SCREEN_BLOCKED_MESSAGE } from "@/lib/screening";
import { screenWallets } from "@/lib/screeningClient";
import { IssuerPolicyRow } from "./IssuerPolicyRow";
import { useVaultStatus } from "@/lib/passkey";
import { SealedField } from "@/components/ui/SealedField";
import { SealDots } from "@/components/ui/SealDots";
import { WalletMenu } from "./WalletMenu";
import { TokenLogo } from "./TokenLogo";
import { SuccessModal } from "./SuccessModal";
import { DevKeysBanner } from "./DevKeysBanner";

type TxKind = "shield" | "approve" | "pull" | null;
type AssetChoice = "eth" | string; // eth | token id

export function ShieldView() {
  const { address, isConnected, chainId, demo } = useAppAccount();
  const { network } = useNetwork();
  const onProduct = chainId === network.chainId;
  const { ethUsd } = useEthPrice();
  const { data: marketData } = useLiveMarkets();
  const deployed = isShieldDeployed() && Boolean(network.pool);
  const {
    open: openNotes,
    shieldedWei,
    byAsset,
    syncing,
    refresh: refreshNotes,
  } = useLocalShieldNotes(address);

  const [assetChoice, setAssetChoice] = useState<AssetChoice>("eth");
  const tokens = shieldTokensFor(network.chainId);
  const nativeOk = supportsNativeShield(network.chainId);
  const selectedToken =
    assetChoice === "eth"
      ? null
      : tokens.find((t) => t.id === assetChoice) ?? null;
  // Reset the asset choice when the network changes to one where it is invalid
  // (e.g. Tempo has no native ETH shield, and different tokens).
  useEffect(() => {
    const valid =
      assetChoice === "eth" ? nativeOk : tokens.some((t) => t.id === assetChoice);
    if (!valid) setAssetChoice(nativeOk ? "eth" : tokens[0]?.id ?? "eth");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network.chainId]);
  const assetAddress: Address = selectedToken
    ? selectedToken.address
    : NATIVE_ASSET;

  const { data: ethBal, refetch: refetchEth } = useAppBalance({
    address,
    chainId: network.chainId,
    enabled: Boolean(address),
  });

  const { data: tokenBal, refetch: refetchTok } = useAppTokenBalance({
    token: selectedToken?.address,
    address,
    chainId: network.chainId,
    enabled: Boolean(selectedToken && onProduct),
  });

  const { data: allowanceRead, refetch: refetchAllow } = useReadContract({
    address: selectedToken?.address,
    abi: erc20Abi,
    functionName: "allowance",
    args:
      address && network.pool
        ? [address, network.pool]
        : undefined,
    chainId: network.chainId,
    query: { enabled: Boolean(address && selectedToken && onProduct && !demo) },
  });
  // The pretend wallet approved the vault long ago, so a demo deposit is one step.
  const allowance = demo ? maxUint256 : allowanceRead;

  const { data: poolData, refetch: refetchPool } = useReadContracts({
    contracts: deployed
      ? [
          {
            address: network.pool!,
            abi: shieldPoolAbi,
            functionName: "nextIndex",
            chainId: network.chainId,
          },
          {
            address: network.pool!,
            abi: shieldPoolAbi,
            functionName: "deposited",
            args: [NATIVE_ASSET],
            chainId: network.chainId,
          },
          {
            address: network.pool!,
            abi: shieldPoolAbi,
            functionName: "currentRoot",
            chainId: network.chainId,
          },
          {
            address: network.pool!,
            abi: shieldPoolAbi,
            functionName: "verifier",
            chainId: network.chainId,
          },
          {
            address: network.pool!,
            abi: shieldPoolAbi,
            functionName: "owner",
            chainId: network.chainId,
          },
          {
            address: network.pool!,
            abi: shieldPoolAbi,
            functionName: "deposited",
            args: [assetAddress],
            chainId: network.chainId,
          },
          {
            address: network.pool!,
            abi: shieldPoolAbi,
            functionName: "shieldVerifier",
            chainId: network.chainId,
          },
          {
            address: network.pool!,
            abi: shieldPoolAbi,
            functionName: "depositLimitsOn",
            chainId: network.chainId,
          },
          {
            address: network.pool!,
            abi: shieldPoolAbi,
            functionName: "depositLimit",
            args: [assetAddress],
            chainId: network.chainId,
          },
        ]
      : [],
    query: { enabled: deployed && !demo, refetchInterval: 12_000 },
  });

  const nextIndex =
    poolData?.[0]?.status === "success"
      ? (poolData[0].result as bigint)
      : null;
  const poolEth =
    poolData?.[1]?.status === "success"
      ? (poolData[1].result as bigint)
      : null;
  const currentRoot =
    poolData?.[2]?.status === "success"
      ? (poolData[2].result as Hex)
      : null;
  const verifier =
    poolData?.[3]?.status === "success"
      ? (poolData[3].result as string)
      : null;
  const owner =
    poolData?.[4]?.status === "success"
      ? (poolData[4].result as string)
      : null;
  const poolSelected =
    poolData?.[5]?.status === "success"
      ? (poolData[5].result as bigint)
      : null;
  const shieldVerifierAddr =
    poolData?.[6]?.status === "success"
      ? (poolData[6].result as string)
      : null;
  // Beta deposit limits. Pools from before them fail this read: no limits.
  const limitsOn = poolData?.[7]?.status === "success" && poolData[7].result === true;
  const limit =
    limitsOn && poolData?.[8]?.status === "success"
      ? (poolData[8].result as readonly [bigint, bigint])
      : null;
  const limitPer = limit ? limit[0] : null;
  const limitRoom =
    limit && poolSelected !== null ? (limit[1] > poolSelected ? limit[1] - poolSelected : BigInt(0)) : null;
  // C1: when the pool enforces bound shields, plain shield() reverts and we must
  // prove commitment == Poseidon(secret, amount, asset) via shieldBound().
  // A demo takes that path without asking the chain (both live pools enforce it).
  const shieldVerifierLive =
    demo ||
    (Boolean(shieldVerifierAddr) &&
      shieldVerifierAddr !== "0x0000000000000000000000000000000000000000");

  const verifierLive =
    Boolean(verifier) &&
    verifier !== "0x0000000000000000000000000000000000000000";

  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const vault = useVaultStatus();
  // Sanctions screening of the depositing wallet (public address only). Checked
  // when the wallet connects so a blocked wallet never fills in the form, and
  // again right before signing.
  const [blockedAddr, setBlockedAddr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const screenBlocked = Boolean(address) && blockedAddr === address;
  useEffect(() => {
    if (!address || demo) return;
    let live = true;
    void screenWallets([address]).then(({ allowed }) => {
      if (live) setBlockedAddr(allowed ? null : address);
    });
    return () => {
      live = false;
    };
  }, [address, demo]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successTitle, setSuccessTitle] = useState("Added privately");
  const [successBody, setSuccessBody] = useState<React.ReactNode>(null);
  const [pendingNote, setPendingNote] = useState<LocalNote | null>(null);
  const [pendingKind, setPendingKind] = useState<TxKind>(null);
  const [sentLabel, setSentLabel] = useState("");
  const autoShieldAfterApprove = useRef(false);
  const pendingShieldArgs = useRef<{
    value: bigint;
    commitment: Hex;
    note: LocalNote;
  } | null>(null);

  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
    reset,
  } = useAppWriteContract();

  const {
    isLoading: confirming,
    isSuccess,
    data: receipt,
  } = useAppTxReceipt({
    hash,
    chainId: network.chainId,
  });

  const handledHash = useRef<string | null>(null);

  const walletBalance = selectedToken
    ? (tokenBal as bigint | undefined)
    : ethBal?.value;
  const symbol = selectedToken?.symbol ?? "ETH";
  const decimals = selectedToken?.decimals ?? 18;

  const mark = selectedToken
    ? selectedToken.kind === "stablecoin"
      ? 1
      : (marketData?.markets?.find((m) => m.id === selectedToken.id)?.mark ?? 0)
    : ethUsd ?? 0;

  useEffect(() => {
    if (!isSuccess || !hash || !receipt) return;
    if (handledHash.current === hash) return;
    handledHash.current = hash;

    if (pendingKind === "pull") {
      markAllNotesRecovered(address, assetAddress);
      refreshNotes();
      void refetchEth();
      void refetchTok();
      void refetchPool();
      setSuccessTitle("Pulled back");
      setSuccessBody(
        <>
          <p>
            {assetLabel(assetAddress)} went back from the vault to the owner
            wallet.
          </p>
          <p className="mt-2">Testnet recovery only.</p>
        </>
      );
      setShowSuccess(true);
      setPendingKind(null);
      return;
    }

    if (pendingKind === "approve") {
      void refetchAllow();
      setPendingKind(null);
      // auto continue shield
      const pending = pendingShieldArgs.current;
      if (pending && network.pool && autoShieldAfterApprove.current) {
        autoShieldAfterApprove.current = false;
        // Keep handledHash on the approval: the deposit has its own hash, and
        // clearing it here let this approval's receipt count as the deposit.
        // Route through executeShield so the shieldBound (C1) branch applies
        // after an ERC20 approval too.
        void executeShield(pending.value, pending.note, pending.commitment);
      }
      return;
    }

    let leafIndex: number | undefined;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: shieldPoolAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Shielded") {
          leafIndex = Number(decoded.args.leafIndex);
          break;
        }
      } catch {
        /* not ours */
      }
    }
    // Only the deposit itself emits Shielded; any other receipt is not a deposit.
    // (Demo receipts carry no logs; the pretend chain only plays the deposit.)
    if (pendingKind !== "shield" || (leafIndex === undefined && !demo)) return;

    if (pendingNote) {
      // Persist only after on-chain success (avoids ghost notes on reject)
      saveLocalNote({
        ...pendingNote,
        txHash: hash,
        leafIndex,
        status: "open",
      });
    }
    setPendingNote(null);
    setPendingKind(null);
    pendingShieldArgs.current = null;
    refreshNotes();
    void refetchEth();
    void refetchTok();
    void refetchAllow();
    void refetchPool();
    void import("@/lib/track").then(({ track }) => {
      track("shield_success", {
        asset: sentLabel.replace(/[\d.]+/g, "").trim().slice(0, 16) || "asset",
      });
    });
    setSuccessTitle("Added privately");
    setSuccessBody(
      <>
        <p>
          <span className="tnum font-medium text-foreground">{sentLabel}</span>{" "}
          is now in your private balance. Only you can see it.
        </p>
        <p className="mt-2">
          Open <strong className="font-medium text-foreground">Pay</strong> to
          send it privately or cash out.
        </p>
      </>
    );
    setShowSuccess(true);
    void import("@/lib/onboarding").then(({ markOnboardingStep }) => {
      markOnboardingStep("shield");
      markOnboardingStep("faucet");
    });
  }, [
    isSuccess,
    hash,
    receipt,
    pendingNote,
    pendingKind,
    address,
    assetAddress,
    sentLabel,
    refreshNotes,
    refetchEth,
    refetchTok,
    refetchAllow,
    refetchPool,
    writeContract,
    demo,
  ]);

  function parseAmount(): bigint | null {
    if (selectedToken) {
      return safeParseUnits(amount || "0", decimals);
    }
    return safeParseEther(amount || "0");
  }

  function limitText(v: bigint): string {
    const n = Number(formatUnits(v, decimals));
    return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}`;
  }

  /** Why the vault's beta limits refuse this amount, or null. */
  function limitProblem(value: bigint): string | null {
    if (!limitsOn) return null;
    if (!limit || limit[1] === BigInt(0)) {
      return `${symbol} deposits are closed right now. Private payments and cash out still work.`;
    }
    if (limitPer !== null && value > limitPer) {
      return `During the beta, one deposit can be up to ${limitText(limitPer)}.`;
    }
    if (limitRoom !== null && value > limitRoom) {
      return limitRoom === BigInt(0)
        ? `The vault is at its beta limit for ${symbol}. Try again later.`
        : `The vault has room for ${limitText(limitRoom)} more during the beta.`;
    }
    return null;
  }

  function validate(): string | null {
    if (!deployed) return "Pool not configured.";
    if (!isConnected || !onProduct) return "Connect and switch to testnet.";
    const value = parseAmount();
    if (value === null) return "Invalid amount.";
    if (value <= BigInt(0)) return "Amount must be greater than zero.";
    if (walletBalance !== undefined && value > walletBalance) {
      return `Not enough ${symbol}.`;
    }
    const overLimit = limitProblem(value);
    if (overLimit) return overLimit;
    if (!selectedToken && ethBal) {
      if (
        value > ethBal.value - 50_000_000_000_000n &&
        ethBal.value > value
      ) {
        return "Leave a little ETH for gas.";
      }
    }
    return null;
  }

  async function executeShield(value: bigint, note: LocalNote, commitment: Hex) {
    if (!network.pool) return;
    const asset = selectedToken ? selectedToken.address : NATIVE_ASSET;
    setPendingNote(note);
    setPendingKind("shield");
    // Do not saveLocalNote until shield confirms, see receipt handler

    // C1 (audit): a hardened pool requires a proof that commitment ==
    // Poseidon(secret, amount, asset), submitted via shieldBound(). On legacy
    // pools (shieldVerifier unset) plain shield() still works, unchanged.
    if (shieldVerifierLive) {
      try {
        const { proveShieldInBrowser } = await import("@/lib/proveClient");
        const { proofBytes } = await proveShieldInBrowser({
          commitment: BigInt(commitment).toString(),
          amount: value.toString(),
          asset: BigInt(asset).toString(),
          secret: BigInt(note.secret).toString(),
        });
        writeContract({
          address: network.pool,
          abi: shieldPoolAbi,
          functionName: "shieldBound",
          args: [asset, value, commitment, proofBytes],
          value: selectedToken ? undefined : value,
          gas: gasFor(network.chainId, SHIELD_BOUND_GAS_LIMIT),
          chainId: network.chainId,
        });
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Could not prepare your private deposit. Try again."
        );
        setPendingKind(null);
        setPendingNote(null);
      }
      return;
    }

    if (selectedToken) {
      writeContract({
        address: network.pool,
        abi: shieldPoolAbi,
        functionName: "shield",
        args: [selectedToken.address, value, commitment],
        gas: gasFor(network.chainId, SHIELD_GAS_LIMIT),
        chainId: network.chainId,
      });
    } else {
      writeContract({
        address: network.pool,
        abi: shieldPoolAbi,
        functionName: "shield",
        args: [NATIVE_ASSET, value, commitment],
        value,
        gas: gasFor(network.chainId, SHIELD_GAS_LIMIT),
        chainId: network.chainId,
      });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    if (!network.pool || !address) return;
    if (vault.locked) {
      setFormError("Unlock your private balance with your passkey first.");
      return;
    }

    const value = parseAmount();
    if (value === null) {
      setFormError("Invalid amount.");
      return;
    }

    // Screen the depositing wallet on the server before the wallet signs (on
    // Tempo, also the asset's TIP-403 issuer policy for this deposit).
    setChecking(true);
    const { allowed, scope, message } = await screenWallets([address], {
      chainId: network.chainId,
      asset: assetAddress,
      flow: "deposit",
    }).finally(() => setChecking(false));
    if (!allowed && scope === "asset") {
      setFormError(message ?? SCREEN_BLOCKED_MESSAGE);
      return;
    }
    if (!allowed) {
      setBlockedAddr(address);
      setFormError(null);
      return;
    }

    let secret: `0x${string}`;
    let commitment: `0x${string}`;
    let nullifier: `0x${string}`;
    if (HASH_SCHEME === "poseidon") {
      const n = await makeBoundNotePoseidon(value, assetAddress);
      secret = n.secret;
      commitment = n.commitment;
      nullifier = n.nullifier;
    } else {
      const n = makeNoteMaterial(value, assetAddress);
      secret = n.secret;
      commitment = n.commitment;
      nullifier = n.nullifier;
    }
    const note: LocalNote = {
      id: `${Date.now()}-${commitment.slice(0, 10)}`,
      chainId: network.chainId,
      pool: network.pool,
      asset: assetAddress,
      amountWei: value.toString(),
      commitment,
      secret,
      nullifier,
      bound: true,
      scheme: HASH_SCHEME,
      from: address,
      createdAt: Date.now(),
      status: "open",
      source: "local",
    };

    setFormError(null);
    reset();
    setShowSuccess(false);
    handledHash.current = null;
    setSentLabel(`${amount} ${symbol}`);
    pendingShieldArgs.current = { value, commitment, note };

    // ERC20: approve first if needed
    if (selectedToken) {
      if (allowance === undefined || allowance < value) {
        autoShieldAfterApprove.current = true;
        setPendingKind("approve");
        setPendingNote(note);
        writeContract({
          address: selectedToken.address,
          abi: erc20Abi,
          functionName: "approve",
          // Exactly this deposit, never an open-ended allowance: a standing
          // approval would let any key on this account move more than it meant to.
          args: [network.pool, value],
          gas: gasFor(network.chainId, APPROVE_GAS_LIMIT),
          chainId: network.chainId,
        });
        return;
      }
    }

    await executeShield(value, note, commitment);
  }

  // Clear in-memory pending on wallet reject / failed write
  useEffect(() => {
    if (!writeError) return;
    if (pendingKind === "shield" || pendingKind === "approve") {
      setPendingNote(null);
      setPendingKind(null);
      pendingShieldArgs.current = null;
      autoShieldAfterApprove.current = false;
    }
  }, [writeError, pendingKind]);

  const maxLabel =
    walletBalance !== undefined
      ? selectedToken
        ? formatUnits(walletBalance, decimals)
        : formatEth(walletBalance, 6)
      : "0";

  const amtNum = Number(amount);
  const usdHint =
    mark > 0 && Number.isFinite(amtNum) && amtNum > 0
      ? formatUsd(amtNum * mark)
      : null;

  const myShieldUsd =
    ethUsd != null && shieldedWei > BigInt(0)
      ? formatUsd((Number(shieldedWei) / 1e18) * ethUsd)
      : null;

  const assetRows = useMemo(() => {
    const rows: { asset: string; label: string; amount: bigint }[] = [];
    byAsset.forEach((amount, asset) => {
      if (amount > BigInt(0)) {
        rows.push({ asset, label: assetLabel(asset), amount });
      }
    });
    return rows.sort((a, b) => {
      if (isNativeAsset(a.asset)) return -1;
      if (isNativeAsset(b.asset)) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [byAsset]);

  if (!deployed) {
    return (
      <div className="gl-card max-w-[620px] p-6 sm:p-8">
        <span className="inline-flex items-center rounded-full bg-warn-soft px-2.5 py-1 text-[12px] font-medium text-warn">
          Not set up
        </span>
        <p className="t-title mt-4 text-foreground">
          The private vault is not on this network yet
        </p>
        <p className="mt-2 max-w-[52ch] text-[14px] leading-relaxed text-mute">
          The vault address is missing for {network.label}. Pick another network
          from the menu, or check back soon.
        </p>
      </div>
    );
  }

  const busy = isPending || confirming;
  // The browser is building the proof that binds the deposit (hardened pools)
  // before the wallet prompt opens.
  const proving =
    pendingKind === "shield" && !isPending && !confirming && !formError;

  const hasActiveShield = openNotes.length > 0;
  const connectedOk = isConnected && onProduct;
  const isTempo = network.key === "tempo";

  const maxDisplay =
    selectedToken && walletBalance !== undefined
      ? formatAssetAmount(walletBalance, selectedToken.address)
      : maxLabel;

  const logoIdFor = (asset: string): string | null => {
    if (isNativeAsset(asset)) return null;
    return (
      tokens.find((t) => t.address.toLowerCase() === asset.toLowerCase())?.id ??
      asset
    );
  };

  const balanceRows = hasActiveShield
    ? assetRows.map((r) => ({
        asset: r.asset,
        label: r.label,
        logoId: logoIdFor(r.asset),
        amount: isNativeAsset(r.asset)
          ? formatEth(r.amount)
          : formatAssetAmount(r.amount, r.asset),
        sub: isNativeAsset(r.asset) && myShieldUsd ? `≈ ${myShieldUsd}` : null,
      }))
    : [];

  const ctaLabel = checking
    ? "Checking…"
    : isPending && pendingKind === "approve"
      ? "Approve in your wallet…"
      : confirming && pendingKind === "approve"
        ? "Approving…"
        : proving
          ? "Preparing your private deposit…"
          : isPending && pendingKind === "shield"
            ? "Confirm in your wallet…"
            : confirming && pendingKind === "shield"
              ? "Adding privately…"
              : selectedToken &&
                  allowance !== undefined &&
                  parseAmount() !== null &&
                  (allowance as bigint) < (parseAmount() as bigint)
                ? `Approve and add ${symbol}`
                : `Add ${symbol} privately`;

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={onSubmit} className="gl-card min-w-0 p-5 sm:p-7">
          <DevKeysBanner compact />

          <div className="min-w-0">
            <h2 className="t-title text-foreground">Add money privately</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-mute">
              Move funds from your wallet into your private balance. From there
              you can pay anyone without the amount showing up.
            </p>
          </div>

          <div className="mt-6">
            {/* from: your wallet */}
            <div className="rounded-[16px] bg-surface p-[16px] transition-shadow focus-within:ring-2 focus-within:ring-foreground/15 sm:p-5">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <label htmlFor="shield-amount" className="text-mute">
                  You add
                </label>
                <button
                  type="button"
                  disabled={!isConnected}
                  onClick={() => {
                    if (walletBalance === undefined) return;
                    if (selectedToken) {
                      setAmount(formatUnits(walletBalance, decimals).slice(0, 18));
                    } else {
                      const leave = 50_000_000_000_000n;
                      const v =
                        walletBalance > leave ? walletBalance - leave : BigInt(0);
                      setAmount(v === BigInt(0) ? "0" : formatEther(v).slice(0, 12));
                    }
                  }}
                  className="tnum -my-2 inline-flex min-h-10 min-w-0 items-center gap-1.5 text-mute transition-colors hover:text-foreground disabled:opacity-45"
                >
                  <span className="truncate">
                    Balance {isConnected ? maxDisplay : "0"} {symbol}
                  </span>
                  <span className="font-medium text-foreground">Max</span>
                </button>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  id="shield-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  className="tnum min-w-0 flex-1 bg-transparent text-[40px] font-light leading-[1.15] tracking-[-0.02em] text-foreground outline-none! placeholder:text-faint sm:text-[46px]"
                  aria-label="Amount to add"
                />
                <div className="relative shrink-0 rounded-full focus-within:ring-2 focus-within:ring-foreground/20">
                  <div className="pointer-events-none flex h-11 items-center gap-2 rounded-full bg-panel pl-1.5 pr-3 text-[15px] font-medium text-foreground shadow-card">
                    <AssetMark id={selectedToken?.id ?? null} symbol={symbol} size={30} />
                    {symbol}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="text-mute">
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <select
                    value={assetChoice}
                    onChange={(e) => {
                      setAssetChoice(e.target.value);
                      setAmount("");
                    }}
                    className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0"
                    aria-label="Asset to add"
                  >
                    {nativeOk && <option value="eth">ETH</option>}
                    {tokens.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.symbol}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="tnum mt-1 min-h-5 text-[13px] text-mute">
                {usdHint ? `≈ ${usdHint}` : " "}
              </p>
            </div>

            <div
              aria-hidden
              className="relative z-10 mx-auto -my-3 grid h-9 w-9 place-items-center rounded-full border-4 border-panel bg-sealed-soft text-sealed"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14m0 0l-5-5m5 5l5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            {/* to: private balance */}
            <div className="rounded-[16px] bg-surface p-[16px] sm:p-5">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-mute">Into your private balance</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-sealed">
                  <span className="h-1.5 w-1.5 rounded-full bg-sealed" aria-hidden />
                  Only you
                </span>
              </div>
              <p className="tnum mt-3 truncate text-[28px] font-light leading-none tracking-[-0.02em] text-foreground">
                {amtNum > 0 ? amount : "0"}{" "}
                <span className="text-[15px] tracking-normal text-mute">{symbol}</span>
              </p>
            </div>
          </div>

          <dl className="mt-5 divide-y divide-line text-[14px]">
            <div className="flex h-11 items-center justify-between gap-3">
              <dt className="text-mute">Fee</dt>
              <dd className="text-foreground">No fee</dd>
            </div>
            <div className="flex h-11 items-center justify-between gap-3">
              <dt className="text-mute">Network</dt>
              <dd className="text-foreground">{network.label}</dd>
            </div>
            {limitsOn && limitPer !== null && limitPer > BigInt(0) && (
              <div className="flex h-11 items-center justify-between gap-3">
                <dt className="text-mute">Beta limit</dt>
                <dd className="tnum text-foreground">{limitText(limitPer)} per deposit</dd>
              </div>
            )}
          </dl>

          <div className="mt-5">
            {!connectedOk ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-surface px-4 py-3">
                <p className="text-[14px] text-mute">
                  {!isConnected
                    ? "Connect a wallet to add money."
                    : `Switch to ${network.label} to add money.`}
                </p>
                <WalletMenu />
              </div>
            ) : screenBlocked ? (
              <p role="status" className="rounded-[16px] bg-surface px-4 py-3.5 text-center text-[14px] text-mute">
                {SCREEN_BLOCKED_MESSAGE}
              </p>
            ) : (
              <button
                type="submit"
                disabled={busy || proving || checking}
                className="btn btn-ink btn-lg btn-block"
              >
                {(busy || proving || checking) && <Spinner />}
                {ctaLabel}
              </button>
            )}
          </div>

          {(formError || writeError) && (
            <p
              role="alert"
              className="mt-4 break-words rounded-xl bg-danger-soft px-4 py-3 text-[13.5px] leading-relaxed text-danger"
            >
              {formError ||
                (writeError?.message.includes("OverDepositLimit")
                  ? "This deposit is over the vault's beta limit. Try a smaller amount."
                  : writeError?.message.slice(0, 180))}
            </p>
          )}
          {hash && !isSuccess && (
            <p className="mt-4 flex items-center justify-center gap-2 text-[13.5px] text-mute">
              Submitted.
              <a
                href={network.explorerTx(hash)}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                View transaction
              </a>
            </p>
          )}

          <p className="mt-5 text-center text-[12.5px] leading-relaxed text-mute">
            Your public wallet balance goes down. Only you can see what is in your
            private balance.
          </p>
        </form>

        <aside className="space-y-4">
          <PrivateBalanceCard
            rows={balanceRows}
            syncing={syncing}
            actions={
              balanceRows.length > 0 ? (
                <>
                  <Link href="/app/vault?tab=move" className="btn btn-ink btn-sm">
                    Send privately
                  </Link>
                  <Link href="/app/vault?tab=move&mode=cashout" className="btn btn-ghost btn-sm">
                    Cash out
                  </Link>
                </>
              ) : null
            }
          />

          <div className="gl-card p-5">
            <p className="text-[13px] text-mute">What the explorer shows</p>
            <dl className="mt-3 divide-y divide-line text-[14px]">
              <div className="flex h-11 items-center justify-between gap-3">
                <dt className="text-mute">Your deposit</dt>
                <dd className="tnum truncate text-foreground">
                  {amtNum > 0 ? `${amount} ${symbol}` : `The amount, in ${symbol}`}
                </dd>
              </div>
              <div className="flex h-11 items-center justify-between gap-3">
                <dt className="text-mute">From</dt>
                <dd className="tnum truncate text-foreground">
                  {address ? shortAddress(address, 4) : "Your wallet"}
                </dd>
              </div>
              <IssuerPolicyRow chainId={network.chainId} asset={assetAddress} flow="deposit" />
              <div className="flex h-11 items-center justify-between gap-3">
                <dt className="text-mute">Your private balance</dt>
                <dd className="text-foreground/60">
                  <SealDots n={6} />
                </dd>
              </div>
              <div className="flex h-11 items-center justify-between gap-3">
                <dt className="text-mute">Who you pay next</dt>
                <dd className="text-foreground/60">
                  <SealDots n={6} />
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[12.5px] leading-relaxed text-mute">
              Adding money is a deposit like any other. What you hold and who you
              pay after that stays private.
            </p>
          </div>
        </aside>
      </div>

      <SuccessModal
        open={showSuccess && Boolean(hash)}
        title={successTitle}
        body={
          <>
            {successBody}
            {/* Private trade is not live yet, so a recording never points at it. */}
            {successTitle === "Added privately" && !isTempo && !demo && (
              <p className="mt-2">
                For a private stock trade, add ETH, then open{" "}
                <a
                  href="/app/trade?market=tsla&path=sealed"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Trade, Private trade
                </a>
                .
              </p>
            )}
          </>
        }
        primaryHref={hash ? network.explorerTx(hash) : undefined}
        primaryLabel="View on explorer"
        secondaryLabel="Done"
        onClose={() => {
          setShowSuccess(false);
          setAmount("");
        }}
      />
    </>
  );
}

type BalanceRow = {
  asset: string;
  label: string;
  logoId: string | null;
  amount: string;
  sub: string | null;
};

/** The private balance, only visible to its owner. Carries the sealed glow. */
function PrivateBalanceCard({
  rows,
  syncing,
  actions,
}: {
  rows: BalanceRow[];
  syncing: boolean;
  actions?: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(false);
  return (
    <div className="gl-card relative overflow-hidden p-5">
      <SealedField tone="soft" />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-mute">Private balance</p>
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-sealed">
              <span className="h-1.5 w-1.5 rounded-full bg-sealed" aria-hidden />
              {syncing ? "Syncing" : "Only you"}
            </span>
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => setHidden((v) => !v)}
                aria-pressed={hidden}
                aria-label={hidden ? "Show amounts" : "Hide amounts"}
                className="-mr-2 grid h-9 w-9 place-items-center rounded-full text-mute transition-colors hover:bg-surface hover:text-foreground"
              >
                <EyeIcon off={hidden} />
              </button>
            )}
          </div>
        </div>

        {rows.length > 0 ? (
          <ul className="mt-4 space-y-3.5">
            {rows.map((r) => (
              <li key={r.asset} className="flex items-center gap-3">
                <AssetMark id={r.logoId} symbol={r.label} size={32} />
                <div className="min-w-0">
                  <p className="tnum truncate text-[26px] font-light leading-none tracking-[-0.02em] text-foreground">
                    {hidden ? (
                      <SealDots n={6} className="text-foreground/60" />
                    ) : (
                      r.amount
                    )}{" "}
                    <span className="text-[14px] tracking-normal text-mute">{r.label}</span>
                  </p>
                  {r.sub && !hidden && (
                    <p className="tnum mt-1 text-[12.5px] text-mute">{r.sub}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <p className="tnum text-[34px] font-light leading-none tracking-[-0.02em] text-foreground">
              0
            </p>
            <p className="mt-2 max-w-[30ch] text-[13px] leading-relaxed text-mute">
              Money you add shows up here. Nobody else can see it.
            </p>
          </div>
        )}

        {actions && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

function AssetMark({
  id,
  symbol,
  size = 28,
}: {
  id: string | null;
  symbol: string;
  size?: number;
}) {
  if (!id) return <EthMark size={size} />;
  return <TokenLogo id={id} symbol={symbol} size={size} />;
}

/** The ETH mark, monochrome on an ink squircle (flips in dark mode). */
function EthMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-[30%] bg-ink text-on-ink"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <path d="M12 2.5l6 9.75-6 3.5-6-3.5 6-9.75z" fill="currentColor" />
        <path d="M6 13.6l6 3.5 6-3.5-6 8.4-6-8.4z" fill="currentColor" opacity="0.7" />
      </svg>
    </span>
  );
}

function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.6" />
      {off && <path d="M4 20L20 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}

function Spinner() {
  return (
    <span
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80 motion-reduce:animate-none"
      aria-hidden
    />
  );
}
