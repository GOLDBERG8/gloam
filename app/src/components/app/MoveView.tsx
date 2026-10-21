"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatUnits, type Hex } from "viem";
import { useReadContract, useWriteContract } from "wagmi";
import { SealedField } from "@/components/ui/SealedField";
import { SealDots } from "@/components/ui/SealDots";
import { shortAddress } from "@/lib/chain";
import { useAppAccount, useAppTxReceipt, useAppWriteContract, useDemo } from "@/lib/demo";
import { shieldTokensFor } from "@/lib/tokens";
import { useLocalShieldNotes } from "@/hooks/useLocalShieldNotes";
import { usePoolDeposited } from "@/hooks/usePoolDeposited";
import { useShieldTree } from "@/hooks/useShieldTree";
import { getRhPublicClient } from "@/lib/rhClient";
import { HASH_SCHEME, dropUnsentNote, gasFor, SHIELD_GAS_LIMIT, TRANSFER_GAS_LIMIT, type LocalNote, assetDecimals, assetLabel, formatAssetAmount, formatAssetLabel, formatFeePercent, isNativeAsset, isShieldDeployed, loadLocalNotes, parseAssetAmount, saveLocalNote, shieldPoolAbi, updateLocalNote, withdrawFeeOf } from "@/lib/shield";
import {
  claimNoteId,
  isClaimedNote,
  isSecuredClaim,
  isUnsecuredClaim,
  secureClaim,
} from "@/lib/claimSweep";
import { readDemo } from "@/lib/demoFlag";
import { syncShieldTree } from "@/lib/treeSync";
import { buildPoseidonUnshieldWitness } from "@/lib/proverPoseidon";
import { buildTransferWitness } from "@/lib/proverTransfer";
import {
  fieldToBytes32,
  proveTransferInBrowser,
  proveUnshieldInBrowser,
} from "@/lib/proveClient";
import { SCREEN_BLOCKED_MESSAGE } from "@/lib/screening";
import { screenWallets } from "@/lib/screeningClient";
import { cashOutTargetProblem } from "@/lib/cashOutTarget";
import { IssuerPolicyRow } from "./IssuerPolicyRow";
import { noteCommitmentPoseidon, noteNullifierPoseidon } from "@/lib/notePoseidon";
import { fieldToHex, hexToField } from "@/lib/poseidon";
import type { PoseidonMerklePath } from "@/lib/merklePoseidon";
import type { SweepResult } from "@gloamtrade/sdk";

import {
  buildNotePackage,
  decodeNotePackage,
  encodeNotePackage,
  encodeNotePackageEncrypted,
  isEncryptedPackage,
  isPayToTagSealed,
} from "@/lib/notePackage";
import {
  getOrCreateReceiveIdentity,
  isReceiveTag,
  encryptTicketForTag,
  rotateReceiveIdentity,
  type ReceiveIdentity,
} from "@/lib/receiveTag";
import {
  loadContacts,
  upsertContact,
  type GloamContact,
} from "@/lib/contacts";
import {
  fetchPaymentMemos,
  isPayMemoLive,
  MEMO_GAS_LIMIT,
  payMemoAddress,
  payMemoAbi,
  ticketToMemoBytes,
  type ScannedMemo,
} from "@/lib/payMemo";
import { useNetwork } from "./NetworkProvider";
import { getNetwork, isNetworkKey } from "@/lib/networks";
import {
  relayFor,
  relayMemo,
  relayPreferred,
  relayTransfer,
  relayUnshield,
  RelaySubmitError,
  setRelayPreferred,
} from "@/lib/relay/client";
import { RelayToggle } from "./RelayToggle";
import { PaymentRequestBanner, RequestPaymentCard } from "./PaymentRequest";
import {
  readPaymentRequest,
  requestParamsFrom,
  type PaymentRequest,
} from "@/lib/paymentRequest";
import { PAYMENT_NOTE_MAX, cleanPaymentNote } from "@/lib/paymentNote";
import { NoteGlyph, PaymentNoteLine } from "./PaymentNote";
import { SuccessModal } from "./SuccessModal";
import { PrivatePayShare } from "./PrivatePayShare";
import {
  markPrivatePaid,
  readFirstPaySuggestion,
  type FirstPaySuggestion,
} from "@/lib/firstPayment";
import { DevKeysBanner } from "./DevKeysBanner";
import { PaymentTicketShare } from "./PaymentTicketShare";
import { SentLinks } from "./SentLinks";
import { makeSentLink, paymentNullifier, type SentLink } from "@/lib/sentLinks";
import { removeSentLink, saveSentLink } from "@/lib/sentLinksStore";
import { countLinkClaimed, countLinkCreated, countLinkOpened, countSendAfterClaim } from "@/lib/funnel";
import { WalletMenu } from "./WalletMenu";
import { TokenLogo } from "./TokenLogo";

/** How securing a claim ended (lib/claimSweep), or "error" when it threw. */
type SweepStatus = SweepResult["status"] | "error";

type Mode = "send" | "cashout" | "receive";
/** Direct (pay to sticky tag) vs open bearer ticket */
type PayStyle = "direct" | "bearer";

/**
 * Move = direct pay-to-tag + bearer tickets + cash out.
 * Never uses a public 0x as the private path.
 */
/** Testnet pools carry no cash-out fee; every other network must report its fee first. */
const TESTNET_CHAIN_IDS = new Set<number>([46630, 42431]);

/** Relay failures after which the payment may still have gone out (a timeout, a lost reply). */
const RELAY_MAYBE_SENT = new Set(["rpc", "network", "error", "in_flight"]);

export function MoveView() {
  const shieldLive = isShieldDeployed();
  const poseidonMode = HASH_SCHEME === "poseidon";
  const { address, isConnected, chainId } = useAppAccount();
  const { network } = useNetwork();
  const onProduct = chainId === network.chainId;
  const { open, refresh: refreshNotes } = useLocalShieldNotes(address);
  const {
    loading: treeLoading,
    error: treeError,
    matchesChain,
    leafCount,
    pathForLeaf,
    leafIndexForCommitment,
    refresh: refreshTree,
  } = useShieldTree();

  // ?mode=receive|cashout opens a specific action (e.g. "Cash out" links).
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(() => {
    const m = searchParams.get("mode");
    return m === "receive" || m === "cashout" ? m : "send";
  });
  // Payment request links (lib/paymentRequest, mode=pay) open Send with the
  // recipient, amount and token filled in. Read once; the payer still sends.
  const [request, setRequest] = useState<PaymentRequest | null>(() =>
    typeof window === "undefined"
      ? null
      : readPaymentRequest(
          requestParamsFrom(window.location.search, window.location.hash),
          network.key
        )
  );
  // The first-payment nudge (FirstPaymentCard) opens Send with a small amount
  // in one stablecoin (?suggest=5&suggestAsset=0x…). A request link wins over
  // it. Read once; the URL is cleaned up below so a refresh starts blank.
  const [suggestion] = useState<FirstPaySuggestion | null>(() =>
    request ? null : readFirstPaySuggestion(searchParams, network.chainId)
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sendAmount, setSendAmount] = useState(
    () => request?.amount ?? suggestion?.amount ?? ""
  );
  // Private note that travels inside the payment (lib/paymentNote). A request's
  // note comes along by default; the payer can change or remove it.
  const [payNote, setPayNote] = useState(() => request?.note ?? "");
  const [noteOpen, setNoteOpen] = useState(() => Boolean(request?.note));
  /** The note the last payment carried, for the success message. */
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareBlob, setShareBlob] = useState<string | null>(null);
  /** The claim code the sender has copied, downloaded or shared, so the success dialog can let go. */
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [shareAmountLabel, setShareAmountLabel] = useState<string | null>(null);
  const [sendPassphrase, setSendPassphrase] = useState("");
  const [importText, setImportText] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [importOk, setImportOk] = useState<{
    text: string;
    note?: string;
    fresh?: boolean;
    tone?: "warn" | "danger";
  } | null>(null);
  /** The claimed payment being secured right now (lib/claimSweep). */
  const [securingId, setSecuringId] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successTitle, setSuccessTitle] = useState("Done");
  const [busy, setBusy] = useState(false);
  const [claimPreview, setClaimPreview] = useState<{ text: string; note?: string } | null>(null);
  const [payStyle, setPayStyle] = useState<PayStyle>("direct");
  const [recipientTag, setRecipientTag] = useState(() => request?.to ?? "");
  const [myIdentity, setMyIdentity] = useState<ReceiveIdentity | null>(null);
  const [tagCopied, setTagCopied] = useState(false);
  const [shareLocked, setShareLocked] = useState(false);
  const [inbox, setInbox] = useState<
    { memo: ScannedMemo; label: string; ticket: string; note?: string }[]
  >([]);
  const [inboxStatus, setInboxStatus] = useState<string | null>(null);
  const [memoPosted, setMemoPosted] = useState(false);
  /** A claim code nobody else will get (no heads-up reached a Gloam address): the sender must keep it. */
  const mustSaveCode = Boolean(shareBlob) && !memoPosted;

  // leaving with an unsaved claim code loses the money in it
  useEffect(() => {
    if (!mustSaveCode || savedCode === shareBlob) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [mustSaveCode, savedCode, shareBlob]);
  const [contacts, setContacts] = useState<GloamContact[]>([]);
  /** Relay: submit proven actions from the Gloam relay so the wallet never shows. */
  const [relayAvailable, setRelayAvailable] = useState(false);
  const [relayOn, setRelayOn] = useState(false);
  /** The relay status has loaded for this network; until then nothing is sent, so a quick click can't go out from the wallet. */
  const [relayChecked, setRelayChecked] = useState(false);
  const [relayHash, setRelayHash] = useState<Hex | undefined>(undefined);
  /** The last confirmed action was a private payment, so success offers the share post. */
  const [paidPrivately, setPaidPrivately] = useState(false);

  // Drop the nudge's suggestion from the URL once read (it is already in the
  // form), so a refresh or a tab switch does not fill it in again.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("suggest") && !url.searchParams.has("suggestAsset")) return;
    url.searchParams.delete("suggest");
    url.searchParams.delete("suggestAsset");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);

  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
    reset,
  } = useAppWriteContract();
  // Securing a claim waits on its own transaction, apart from the flow above.
  const { writeContractAsync } = useWriteContract();

  const txHash = relayHash ?? hash;
  const { isLoading: confirming, isSuccess, isError: receiptLost } = useAppTxReceipt({
    hash: txHash,
    chainId: network.chainId,
  });

  // Claim links: /app/vault?tab=move&net=tempo#claim=<code>. The code lives in
  // the URL fragment (never sent to a server) and is cleared once read.
  const { setNetworkKey, networkKey } = useNetwork();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const h = window.location.hash;
    if (!h.startsWith("#claim=")) return;
    const code = decodeURIComponent(h.slice("#claim=".length));
    const net = new URLSearchParams(window.location.search).get("net");
    const t = window.setTimeout(() => {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      if (isNetworkKey(net) && net !== networkKey) setNetworkKey(net);
      if (code) {
        countLinkOpened(code);
        setMode("receive");
        setImportText(code);
        // opened from a claim link: go straight to the claim, not the address above it
        window.setTimeout(() => {
          const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          document.getElementById("claim-payment")?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
        }, 400);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [networkKey, setNetworkKey]);

  // A request link opened in a tab that already shows Pay only changes the
  // fragment, so pick it up here too.
  useEffect(() => {
    const onHash = () => {
      const r = readPaymentRequest(
        requestParamsFrom(window.location.search, window.location.hash),
        networkKey
      );
      if (!r) return;
      requestSwitched.current = false;
      setRequest(r);
      setMode("send");
      setSelectedId(null);
      setRecipientTag(r.to ?? "");
      setSendAmount(r.amount ?? "");
      setPayNote(r.note ?? "");
      setNoteOpen(Boolean(r.note));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [networkKey]);

  // Analytics: a request link was opened. Its shape only, never who, how much or the note.
  const trackedRequest = useRef<PaymentRequest | null>(null);
  useEffect(() => {
    if (!request || trackedRequest.current === request) return;
    trackedRequest.current = request;
    const chainId = getNetwork(request.network ?? networkKey).chainId;
    void import("@/lib/track").then(({ track }) => {
      track("payment_request_opened", {
        hasAmount: Boolean(request.amount),
        hasNote: Boolean(request.note),
        chainId,
      });
    });
  }, [request, networkKey]);

  // A request names its network: move there once so the right balance shows.
  // After that the banner offers the switch instead of forcing it again.
  const requestSwitched = useRef(false);
  useEffect(() => {
    const want = request?.network;
    if (!want || want === networkKey || requestSwitched.current) return;
    const t = window.setTimeout(() => {
      requestSwitched.current = true;
      setNetworkKey(want);
    }, 0);
    return () => window.clearTimeout(t);
  }, [request, networkKey, setNetworkKey]);

  useEffect(() => {
    let live = true;
    setRelayChecked(false);
    void relayFor(network.chainId).then((r) => {
      if (!live) return;
      const ok = Boolean(r?.enabled);
      setRelayAvailable(ok);
      setRelayOn(ok && relayPreferred());
      setRelayChecked(true);
    });
    return () => {
      live = false;
    };
  }, [network.chainId]);

  const handledHash = useRef<string | null>(null);
  const pendingAction = useRef<"send" | "cashout" | "memo" | null>(null);
  /** The change note and Sent link saved just before a send went out. */
  const keptBeforeSend = useRef<{ changeId: string | null; linkId: string | null } | null>(null);
  /** Drops what was kept ahead of a send that surely never went out. */
  const forgetUnsent = () => {
    const kept = keptBeforeSend.current;
    if (!kept) return;
    if (kept.changeId) dropUnsentNote(kept.changeId);
    if (kept.linkId) void removeSentLink(kept.linkId).catch(() => undefined);
    keptBeforeSend.current = null;
  };
  const spentNoteId = useRef<string | null>(null);
  /** Change only, never store the payment note on the sender */
  const pendingChange = useRef<LocalNote | null>(null);
  const pendingShare = useRef<{ blob: string; amountLabel: string } | null>(
    null
  );
  /** Analytics for the payment in flight: sent on a request, carrying a note. */
  const payTrack = useRef<{ chainId: number; request: boolean; note: boolean } | null>(null);
  /** The payment's code for Sent links, saved once the payment lands. */
  const pendingLink = useRef<SentLink | null>(null);
  /** The saved Sent links record, dropped again if their heads-up posts. */
  const savedLinkId = useRef<string | null>(null);
  /** The payment in flight is a claim link (counted once it lands, lib/funnel). */
  const pendingClaimLink = useRef(false);
  /** After direct pay: post encrypted ticket on-chain (GloamPayMemo) */
  const pendingMemo = useRef<{
    paymentCommitment: Hex;
    ticket: string;
  } | null>(null);

  // Confirm path: transfer → optional on-chain memo → share UI
  useEffect(() => {
    if (!isSuccess || !txHash) return;
    if (handledHash.current === txHash) return;
    handledHash.current = txHash;

    void (async () => {
      // Memo post finished
      if (pendingAction.current === "memo") {
        pendingAction.current = null;
        pendingMemo.current = null;
        // They got the heads-up, so the payment shows up on their side: no Sent links row needed.
        if (savedLinkId.current) {
          void removeSentLink(savedLinkId.current).catch(() => undefined);
          savedLinkId.current = null;
        }
        setMemoPosted(true);
        if (pendingShare.current) {
          setShareBlob(pendingShare.current.blob);
          setShareAmountLabel(pendingShare.current.amountLabel);
          pendingShare.current = null;
        }
        setSuccessTitle("Paid privately");
        void import("@/lib/track").then(({ track }) => {
          track("private_pay_success");
        });
        void import("@/lib/onboarding").then(({ markOnboardingStep }) => {
          markOnboardingStep("move");
          markOnboardingStep("shield");
        });
        setShowSuccess(true);
        setBusy(false);
        setStatus(null);
        return;
      }

      if (pendingAction.current === "send") {
        // The payment itself has landed (a heads-up, if any, is a second
        // step). Retires the first-payment nudge on this device.
        markPrivatePaid(network.chainId);
        setPaidPrivately(true);
        // claim-link counts: a link made, or a claimer's first own payment (lib/funnel)
        if (pendingClaimLink.current) countLinkCreated();
        pendingClaimLink.current = false;
        countSendAfterClaim();
        // The payment landed: keep its code under Sent links, encrypted in this
        // browser, so a lost code is not lost money (removed again if a heads-up posts).
        const link = pendingLink.current;
        pendingLink.current = null;
        pendingClaimLink.current = false;
        if (link) {
          savedLinkId.current = link.id;
          void saveSentLink(link).catch(() => undefined);
        }
      }

      if (pendingAction.current === "send" && payTrack.current) {
        const t = payTrack.current;
        payTrack.current = null;
        void import("@/lib/track").then(({ track }) => {
          if (t.request) track("payment_request_paid", { chainId: t.chainId });
          if (t.note) track("private_note_added", { chainId: t.chainId });
        });
      }

      if (spentNoteId.current) {
        updateLocalNote(spentNoteId.current, { status: "recovered" });
        spentNoteId.current = null;
      }

      // Resolve leaf index from chain tree (safe if others inserted mid-flight)
      let changeLeaf: number | undefined;
      if (pendingChange.current) {
        try {
          const tree = await syncShieldTree(getRhPublicClient());
          const idx = tree?.indexByCommitment.get(
            pendingChange.current.commitment.toLowerCase()
          );
          if (idx != null) changeLeaf = idx;
        } catch {
          /* leafIndex optional, path resolved on next sync */
        }
      }

      if (pendingChange.current) {
        saveLocalNote({
          ...pendingChange.current,
          txHash,
          leafIndex: changeLeaf,
        });
        pendingChange.current = null;
      }

      refreshNotes();
      void refreshTree();

      // Direct pay + memo board live → second tx posts ciphertext on-chain
      if (
        pendingMemo.current &&
        isPayMemoLive() &&
        payMemoAddress() &&
        pendingAction.current === "send"
      ) {
        const m = pendingMemo.current;
        setStatus("Letting them know privately…");
        pendingAction.current = "memo";
        handledHash.current = null;
        if (relayOn) {
          try {
            const h = await relayMemo({
              chainId: network.chainId,
              paymentCommitment: m.paymentCommitment,
              memo: ticketToMemoBytes(m.ticket),
            });
            setRelayHash(h);
          } catch (e) {
            // Payment already landed; only the heads-up failed. Fall back to the link.
            pendingAction.current = null;
            pendingMemo.current = null;
            if (pendingShare.current) {
              setShareBlob(pendingShare.current.blob);
              setShareAmountLabel(pendingShare.current.amountLabel);
              pendingShare.current = null;
            }
            setError(
              `Payment sent. We could not send their heads-up (${e instanceof Error ? e.message : "relay error"}), so share the claim code below instead.`
            );
            setShowSuccess(true);
            setBusy(false);
            setStatus(null);
          }
          return;
        }
        writeContract({
          address: payMemoAddress()!,
          abi: payMemoAbi,
          functionName: "postMemo",
          args: [m.paymentCommitment, ticketToMemoBytes(m.ticket)],
          gas: gasFor(network.chainId, MEMO_GAS_LIMIT),
          chainId: network.chainId,
        });
        return;
      }

      pendingMemo.current = null;
      if (pendingShare.current) {
        setShareBlob(pendingShare.current.blob);
        setShareAmountLabel(pendingShare.current.amountLabel);
        pendingShare.current = null;
      }

      setShowSuccess(true);
      setBusy(false);
      setStatus(null);
    })();
  }, [isSuccess, txHash, relayOn, network.chainId, refreshNotes, refreshTree, writeContract]);

  // Wallet reject / tx fail: drop ephemeral payment secrets
  useEffect(() => {
    if (!writeError) return;
    // the wallet never sent it: drop what was kept ahead of the send
    if (pendingAction.current === "send") forgetUnsent();
    keptBeforeSend.current = null;
    setBusy(false);
    setStatus(null);
    // Only their heads-up failed: the payment already landed, so its code
    // stays on screen (it is under Sent links too) instead of being dropped.
    const landed = pendingAction.current === "memo" ? pendingShare.current : null;
    pendingChange.current = null;
    pendingShare.current = null;
    pendingMemo.current = null;
    pendingLink.current = null;
    pendingClaimLink.current = false;
    spentNoteId.current = null;
    payTrack.current = null;
    setShareBlob(landed?.blob ?? null);
    if (landed) {
      setShareAmountLabel(landed.amountLabel);
      setError(
        "Payment sent, but their heads-up was not. Share the claim code below with them instead. It is also kept under Sent links."
      );
    }
  }, [writeError]);

  // The receipt wait gave up (a busy network). The payment may still land: what
  // it creates is already saved and settles on its own, so stop and say so.
  useEffect(() => {
    if (!receiptLost || !txHash || !busy) return;
    const action = pendingAction.current;
    keptBeforeSend.current = null;
    pendingChange.current = null;
    pendingShare.current = null;
    pendingMemo.current = null;
    pendingLink.current = null;
    pendingClaimLink.current = false;
    spentNoteId.current = null;
    setBusy(false);
    setStatus(null);
    setError(
      action === "cashout"
        ? "Your cash out was sent, but the network is slow to confirm it. Your balance updates once it lands. Check it with the link below."
        : "Your payment was sent, but the network is slow to confirm it. Your change and the payment's code are saved in this browser and show up once it lands."
    );
    const t = window.setTimeout(() => refreshNotes(), 15_000);
    return () => window.clearTimeout(t);
  }, [receiptLost, txHash, busy, refreshNotes]);

  // Resolve leafIndex from tree when import left it missing
  const notes = useMemo(() => {
    return open
      .filter(
        (n) =>
          n.bound &&
          n.secret &&
          n.secret !== "0x" &&
          (!poseidonMode || n.scheme === "poseidon" || !n.scheme)
      )
      .map((n) => {
        if (n.leafIndex != null) return n;
        const idx = leafIndexForCommitment(n.commitment);
        return idx != null ? { ...n, leafIndex: idx } : n;
      })
      .filter((n) => n.leafIndex != null);
  }, [open, poseidonMode, leafIndexForCommitment]);

  // Claimed payments the payer could still spend back (lib/claimSweep).
  const unsecured = useMemo(() => open.filter(isUnsecuredClaim), [open]);

  // For a request, default to a balance in the requested token: the smallest
  // one that covers the amount, else the largest. A manual pick still wins.
  const requestNoteId = useMemo(() => {
    const asset = request?.asset;
    if (!asset) return null;
    const same = notes.filter(
      (n) => n.asset.toLowerCase() === asset.address.toLowerCase()
    );
    if (!same.length) return null;
    const need = request.amount ? parseAssetAmount(request.amount, asset.address) : null;
    const bySize = [...same].sort((a, b) =>
      BigInt(a.amountWei) < BigInt(b.amountWei) ? -1 : 1
    );
    const covering = need ? bySize.find((n) => BigInt(n.amountWei) >= need) : null;
    return (covering ?? bySize[bySize.length - 1]).id;
  }, [request, notes]);

  // The nudge's suggestion picks a balance the same way: the smallest one in
  // its token that covers the amount, else the largest.
  const suggestNoteId = useMemo(() => {
    if (!suggestion) return null;
    const same = notes.filter(
      (n) => n.asset.toLowerCase() === suggestion.asset.toLowerCase()
    );
    if (!same.length) return null;
    const need = parseAssetAmount(suggestion.amount, suggestion.asset);
    const bySize = [...same].sort((a, b) =>
      BigInt(a.amountWei) < BigInt(b.amountWei) ? -1 : 1
    );
    const covering = need ? bySize.find((n) => BigInt(n.amountWei) >= need) : null;
    return (covering ?? bySize[bySize.length - 1]).id;
  }, [suggestion, notes]);

  const selected =
    notes.find((n) => n.id === selectedId) ??
    notes.find((n) => n.id === requestNoteId) ??
    notes.find((n) => n.id === suggestNoteId) ??
    notes[0] ??
    null;

  const maxEth = selected
    ? formatUnits(BigInt(selected.amountWei), assetDecimals(selected.asset))
    : "0";

  const cashOutAsset = selected?.asset as `0x${string}` | undefined;
  const { deposited: poolForCashOut } = usePoolDeposited(
    mode === "cashout" ? cashOutAsset : null
  );
  const cashOutAmount = selected ? BigInt(selected.amountWei) : 0n;
  // Cash-out fee (mainnet pools). The proof still spends the whole note; the
  // pool keeps the fee and pays the rest. Older pools fail this read: no fee.
  const demoMode = useDemo();
  const { data: feeBpsRead } = useReadContract({
    address: network.pool ?? undefined,
    abi: shieldPoolAbi,
    functionName: "withdrawFeeBps",
    chainId: network.chainId,
    query: { enabled: Boolean(network.pool) && mode === "cashout" && !demoMode, refetchInterval: 60_000 },
  });
  const cashOutFeeBps = typeof feeBpsRead === "number" ? feeBpsRead : 0;
  // On mainnet the fee must be known before anyone confirms: a failed read must
  // not show the full amount when the pool will keep a fee. Testnet pools have no fee.
  const cashOutFeeUnknown =
    mode === "cashout" && !demoMode && !TESTNET_CHAIN_IDS.has(network.chainId) && typeof feeBpsRead !== "number";
  const cashOutFee = withdrawFeeOf(cashOutAmount, cashOutFeeBps);
  const cashOutInventoryShort =
    mode === "cashout" &&
    selected != null &&
    poolForCashOut != null &&
    poolForCashOut < cashOutAmount;

  async function onCashOut() {
    if (!selected || !address || !network.pool || !poseidonMode) return;
    setError(null);

    if (poolForCashOut != null && poolForCashOut < BigInt(selected.amountWei)) {
      setError(
        `Not enough in the shared vault to cash out right now (${formatAssetLabel(poolForCashOut, selected.asset)} available, ${formatAssetLabel(selected.amountWei, selected.asset)} needed). It opens up once more of this asset is added.`
      );
      return;
    }
    // Never to the vault or the memo board: the money would be stuck there.
    const targetProblem = cashOutTargetProblem(address, network);
    if (targetProblem) {
      setError(targetProblem);
      return;
    }
    // The cash out goes to this public wallet, relay or not (on Tempo, also
    // checked against the asset's TIP-403 issuer policy).
    const screen = await screenWallets([address], {
      chainId: network.chainId,
      asset: selected.asset,
      flow: "cashout",
    });
    if (!screen.allowed) {
      setError(screen.message ?? SCREEN_BLOCKED_MESSAGE);
      return;
    }

    setBusy(true);
    setPaidPrivately(false);
    reset();
    setRelayHash(undefined);
    handledHash.current = null;
    pendingAction.current = "cashout";
    spentNoteId.current = selected.id;
    pendingChange.current = null;

    try {
      const path = await pathForLeaf(selected.leafIndex!);
      if (!path) throw new Error("Could not read your private balance. Refresh and try again.");
      setStatus("Proving privately, this takes 10 to 30 seconds…");
      const w = await buildPoseidonUnshieldWitness({
        secretHex: selected.secret,
        amount: BigInt(selected.amountWei),
        asset: selected.asset,
        to: address,
        path: path as PoseidonMerklePath,
      });
      if (!w.checks.commitmentMatches) {
        throw new Error(w.blocker ?? "This balance does not match the vault.");
      }
      const { proofBytes } = await proveUnshieldInBrowser(w.circomInput);
      if (relayOn) {
        setStatus("Sending through the Gloam relay…");
        const h = await relayUnshield({
          chainId: network.chainId,
          proof: proofBytes,
          root: fieldToBytes32(w.publicInputs.root),
          nullifier: fieldToBytes32(w.publicInputs.nullifier),
          asset: selected.asset,
          to: address,
          amount: BigInt(selected.amountWei),
        });
        setRelayHash(h);
        setSuccessTitle("Cashed out");
        return;
      }
      setStatus("Confirm the cash out in your wallet…");
      writeContract({
        address: network.pool,
        abi: shieldPoolAbi,
        functionName: "unshield",
        args: [
          proofBytes,
          fieldToBytes32(w.publicInputs.root),
          fieldToBytes32(w.publicInputs.nullifier),
          selected.asset,
          address,
          BigInt(selected.amountWei),
        ],
        gas: gasFor(network.chainId, SHIELD_GAS_LIMIT),
        chainId: network.chainId,
      });
      setSuccessTitle("Cashed out");
      void import("@/lib/track").then(({ track }) => {
        track("unshield_success");
      });
      // cash out is intentional exit, no onboarding mark
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cash out failed");
      setBusy(false);
      setStatus(null);
    }
  }

  async function onPrivateSend() {
    if (!selected || !address || !network.pool || !poseidonMode) return;
    setError(null);
    setShareBlob(null);
    setBusy(true);
    setPaidPrivately(false);
    reset();
    setRelayHash(undefined);
    handledHash.current = null;
    pendingAction.current = "send";
    spentNoteId.current = selected.id;
    pendingLink.current = null;
    pendingClaimLink.current = false;
    savedLinkId.current = null;

    try {
      const amountPay = parseAssetAmount(sendAmount, selected.asset);
      if (amountPay === null || amountPay <= 0n) {
        throw new Error("Enter a valid amount to send.");
      }
      if (amountPay > BigInt(selected.amountWei)) {
        throw new Error("That is more than this balance holds.");
      }

      const path = await pathForLeaf(selected.leafIndex!);
      if (!path) throw new Error("Could not read your private balance. Refresh and try again.");

      setStatus("Proving your payment privately…");
      const w = await buildTransferWitness({
        secretHex: selected.secret,
        amountIn: BigInt(selected.amountWei),
        amountPay,
        asset: selected.asset,
        path: path as PoseidonMerklePath,
      });
      if (w.blocker) throw new Error(w.blocker);

      const { proofBytes } = await proveTransferInBrowser(w.circomInput);

      // Change stays with sender only. Payment secret goes solely into share package.
      if (BigInt(w.changeNote.amountWei) > 0n) {
        pendingChange.current = {
          id: `chg-${Date.now()}`,
          chainId: network.chainId,
          pool: network.pool,
          asset: selected.asset,
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
        };
      } else {
        pendingChange.current = null;
      }

      // Share package for recipient (shown only after on-chain success).
      // The note rides inside it, so it is sealed or locked with the payment.
      const pack = buildNotePackage({
        pool: network.pool,
        asset: w.paymentNote.asset,
        amountWei: w.paymentNote.amountWei,
        secret: w.paymentNote.secret,
        commitment: w.paymentNote.commitment,
        note: payNote,
      });
      setSentNote(pack.note ?? null);
      payTrack.current = { chainId: network.chainId, request: Boolean(request), note: Boolean(pack.note) };
      let share: string;
      let locked = false;
      if (payStyle === "direct") {
        const tag = recipientTag.trim();
        if (!isReceiveTag(tag)) {
          throw new Error(
            "Paste their Gloam address (it starts with gloamr1) to pay them privately."
          );
        }
        const plain = encodeNotePackage(pack);
        share = await encryptTicketForTag(plain, tag);
        locked = true; // encrypted to their key
      } else if (sendPassphrase.trim()) {
        share = await encodeNotePackageEncrypted(pack, sendPassphrase);
        locked = true;
      } else {
        share = encodeNotePackage(pack);
      }
      pendingShare.current = {
        blob: share,
        amountLabel: formatAssetLabel(w.paymentNote.amountWei, w.paymentNote.asset),
      };
      // Sent links record. The nullifier is worked out now, the same way a claim
      // does, so its status can be checked later without the phrase.
      let linkNullifier: Hex | undefined;
      try {
        linkNullifier = await paymentNullifier(pack.secret, pack.commitment);
      } catch {
        /* the row shows Couldn't check */
      }
      pendingClaimLink.current = payStyle === "bearer";
      pendingLink.current = makeSentLink({
        code: share,
        chainId: network.chainId,
        pool: network.pool,
        asset: pack.asset,
        symbol: assetLabel(pack.asset),
        amountWei: pack.amountWei,
        nullifier: linkNullifier,
        note: pack.note,
      });
      setShareLocked(locked);
      setShareBlob(null);
      setMemoPosted(false);

      // Payment leaf commitment, for on-chain memo discovery
      if (payStyle === "direct" && isPayMemoLive()) {
        pendingMemo.current = {
          paymentCommitment: fieldToBytes32(w.publicInputs.newCommitment0),
          ticket: share,
        };
      } else {
        pendingMemo.current = null;
      }

      // The change and the payment's code are money: keep them in this browser
      // before anything is sent. The change waits out of the balance until the
      // chain shows it (lib/claimSweep settles it if this tab never hears back);
      // the code goes under Sent links. A send that surely never went out drops both.
      if (pendingChange.current) saveLocalNote({ ...pendingChange.current, sweepPending: true });
      if (pendingLink.current) await saveSentLink(pendingLink.current).catch(() => undefined);
      keptBeforeSend.current = {
        changeId: pendingChange.current?.id ?? null,
        linkId: pendingLink.current?.id ?? null,
      };

      if (relayOn) {
        setStatus("Sending through the Gloam relay…");
        const h = await relayTransfer({
          chainId: network.chainId,
          proof: proofBytes,
          root: fieldToBytes32(w.publicInputs.root),
          nullifier: fieldToBytes32(w.publicInputs.nullifier),
          commitments: [
            fieldToBytes32(w.publicInputs.newCommitment0),
            fieldToBytes32(w.publicInputs.newCommitment1),
          ],
        });
        setRelayHash(h);
        setSuccessTitle("Sent privately");
        void import("@/lib/track").then(({ track }) => {
          track("private_send_submit", { relay: true });
        });
        return;
      }
      setStatus("Confirm the payment in your wallet…");
      writeContract({
        address: network.pool,
        abi: shieldPoolAbi,
        functionName: "transfer",
        args: [
          proofBytes,
          fieldToBytes32(w.publicInputs.root),
          fieldToBytes32(w.publicInputs.nullifier),
          [
            fieldToBytes32(w.publicInputs.newCommitment0),
            fieldToBytes32(w.publicInputs.newCommitment1),
          ],
        ],
        gas: gasFor(network.chainId, TRANSFER_GAS_LIMIT),
        chainId: network.chainId,
      });
      setSuccessTitle(
        payStyle === "direct" && isPayMemoLive()
          ? "Paid. Confirm the heads-up next"
          : "Sent privately"
      );
      void import("@/lib/track").then(({ track }) => {
        track("private_send_submit");
      });
    } catch (e) {
      // The relay may have sent it (a lost reply, a timeout): keep what was saved,
      // it settles from the chain. Any clear refusal means nothing went out.
      const maybeSent = e instanceof RelaySubmitError && RELAY_MAYBE_SENT.has(e.code);
      if (maybeSent) {
        setError(
          "The relay may have sent this payment. Your change and the payment's code are saved in this browser: they show in your balance and under Sent links once it lands."
        );
      } else {
        forgetUnsent();
        setError(e instanceof Error ? e.message : "Private send failed");
      }
      keptBeforeSend.current = null;
      setBusy(false);
      setStatus(null);
      pendingChange.current = null;
      pendingShare.current = null;
      pendingMemo.current = null;
      pendingLink.current = null;
      pendingClaimLink.current = false;
      payTrack.current = null;
    }
  }

  async function scanInbox() {
    if (!isPayMemoLive()) {
      setInboxStatus(
        "Not available on this network yet. Ask the sender for a claim link."
      );
      return;
    }
    setInboxStatus("Checking for payments to your Gloam address…");
    setInbox([]);
    try {
      const client = getRhPublicClient();
      const memos = await fetchPaymentMemos(client);
      const hits: { memo: ScannedMemo; label: string; ticket: string; note?: string }[] = [];
      const seen = new Set<string>();
      for (const m of memos) {
        try {
          const pack = await decodeNotePackage(m.ticket, undefined, {
            tryTagDecrypt: true,
          });
          // Anyone who knows your Gloam address can post a message to it, so only
          // a real, unclaimed payment is shown: the code must open the commitment
          // the message names, and that note must be in the vault and unspent.
          const commitment = fieldToHex(
            await noteCommitmentPoseidon(hexToField(pack.secret), BigInt(pack.amountWei), pack.asset)
          ).toLowerCase();
          if (commitment !== m.paymentCommitment.toLowerCase() || seen.has(commitment)) continue;
          if (!network.pool || (pack.pool && pack.pool.toLowerCase() !== network.pool.toLowerCase())) continue;
          const [inVault, spent] = await Promise.all([
            client.readContract({ address: network.pool, abi: shieldPoolAbi, functionName: "commitmentSeen", args: [commitment as Hex] }),
            client.readContract({
              address: network.pool,
              abi: shieldPoolAbi,
              functionName: "isSpent",
              args: [await paymentNullifier(pack.secret, commitment as Hex)],
            }),
          ]);
          if (!inVault || spent) continue;
          seen.add(commitment);
          hits.push({
            memo: m,
            ticket: m.ticket,
            label: formatAssetLabel(pack.amountWei, pack.asset),
            note: pack.note,
          });
        } catch {
          /* not for us */
        }
      }
      setInbox(hits);
      setInboxStatus(
        hits.length
          ? `Found ${hits.length} ${hits.length === 1 ? "payment" : "payments"} for you.`
          : "No new payments yet."
      );
    } catch (e) {
      setInboxStatus(e instanceof Error ? e.message : "Could not check for payments.");
    }
  }

  /**
   * Move a claimed payment into a fresh note only this browser knows. Through
   * the relay when it is on; otherwise the wallet signs (and shows as sender).
   */
  async function secureNote(
    note: LocalNote,
    claim?: { claimed: true; note?: string },
    report = true
  ): Promise<SweepStatus> {
    const label = formatAssetLabel(note.amountWei, note.asset);
    const did = claim ? `Claimed ${label}` : `${label} is claimed`;
    const stillOpen = "Until it is secured, the person who sent it can still take it back.";
    if (report) {
      setError(null);
      setImportOk(null);
    }
    setSecuringId(note.id);
    setBusy(true);
    setStatus("Securing this payment…");
    let outcome: SweepStatus = "error";
    try {
      const r = await secureClaim({
        note,
        relay: relayOn,
        sendWithWallet: ({ pool, args }) =>
          writeContractAsync({
            address: pool,
            abi: shieldPoolAbi,
            functionName: "transfer",
            args: [args[0], args[1], args[2], [args[3][0], args[3][1]]],
            gas: gasFor(network.chainId, TRANSFER_GAS_LIMIT),
            chainId: network.chainId,
          }),
        onStage: setStatus,
      });
      void import("@/lib/track").then(({ track }) => {
        track("claim_secure", { reason: r.status, relay: relayOn, chainId: network.chainId });
      });
      outcome = r.status;
      if (r.status === "swept" && r.freshNote) {
        const fresh = loadLocalNotes(address).find(
          (n) => n.commitment.toLowerCase() === r.freshNote!.commitment.toLowerCase()
        );
        if (fresh) setSelectedId(fresh.id);
      }
      if (!report) {
        /* the caller says what happened */
      } else if (r.status === "swept") {
        setImportOk({
          text: `${claim ? "Claimed and secured" : "Secured"} ${label}. Only you can spend it now, and the person who sent it can no longer take it back.`,
          note: claim?.note,
          fresh: Boolean(claim),
        });
      } else if (r.status === "already_spent") {
        setImportOk({
          text: `The person who sent ${label} moved it before it was secured, so it is not in your balance. Ask them to send it again.`,
          note: claim?.note,
          tone: "danger",
        });
      } else if (r.status === "not_settled") {
        setImportOk({
          text: `${did}, but the payment has not reached the vault yet, so it cannot be secured. Secure it once it lands. ${stillOpen}`,
          note: claim?.note,
          tone: "warn",
        });
      } else if (r.status === "unconfirmed") {
        setImportOk({
          text: `${did}. Securing it was sent and has not confirmed yet. It counts in your balance once it lands.`,
          note: claim?.note,
          tone: "warn",
        });
      } else if (r.status === "bad_note") {
        setImportOk({
          text: "The amount in this payment does not match what it holds in the vault, so it cannot be secured.",
          tone: "danger",
        });
      } else {
        const why = /reject|denied|cancel/i.test(r.reason ?? "")
          ? "the wallet prompt was closed"
          : "it did not go through";
        setImportOk({
          text: `${did}, but it is not secured yet: ${why}. ${stillOpen}`,
          note: claim?.note,
          tone: "warn",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/\.$/, "") : "something went wrong";
      if (report) setImportOk({
        text: `${did}, but it is not secured yet: ${msg}. ${stillOpen}`,
        note: claim?.note,
        tone: "warn",
      });
    }
    refreshNotes();
    void refreshTree();
    setBusy(false);
    setStatus(null);
    setSecuringId(null);
    return outcome;
  }

  /**
   * Claim a payment code into the connected wallet's private balance. Used by
   * Receive > Claim a payment and by Sent links > Take back, so a locked code
   * needs its phrase either way. The note is saved in this browser first (never
   * lost); the caller then secures it with secureNote, because the payer made
   * its secret and could spend it back until it moves. A payment already
   * claimed here is not counted twice, and one still waiting to be secured is
   * picked up again.
   */
  async function claimCode(
    code: string,
    passphrase?: string
  ): Promise<{ label: string; note?: string; local: LocalNote; isNew: boolean; already: boolean; demo: boolean }> {
    if (!network.pool || !address) {
      throw new Error("Connect a wallet first.");
    }
    const pack = await decodeNotePackage(code, passphrase || undefined, {
      tryTagDecrypt: true,
    });
    if (
      pack.pool &&
      pack.pool.toLowerCase() !== network.pool.toLowerCase()
    ) {
      throw new Error("This payment is for a different vault or network.");
    }

    const asset = pack.asset;
    const secret = pack.secret;
    let amount: bigint;
    try {
      amount = BigInt(pack.amountWei);
    } catch {
      throw new Error("This payment has no readable amount.");
    }
    if (amount <= 0n) throw new Error("This payment carries no value.");
    // The amount must be what the note holds: commitment = Poseidon(secret, amount, asset).
    const commitment = fieldToHex(
      await noteCommitmentPoseidon(hexToField(secret), amount, asset)
    );
    if (
      pack.commitment &&
      pack.commitment !== "0x" &&
      pack.commitment.toLowerCase() !== commitment.toLowerCase()
    ) {
      throw new Error(
        "The amount in this payment does not match what it holds in the vault, so it was not claimed."
      );
    }
    const nullifier = fieldToHex(
      await noteNullifierPoseidon(hexToField(secret), hexToField(commitment))
    );
    const label = formatAssetLabel(pack.amountWei, asset);
    const demo = readDemo();
    const moved =
      "This payment was already moved, most likely by the person who sent it, so there is nothing left to claim. Ask them to send it again.";

    const known = loadLocalNotes(address).find(
      (n) => n.commitment.toLowerCase() === commitment.toLowerCase()
    );
    if (known && !isUnsecuredClaim(known)) {
      if (known.status === "recovered" && !known.secured) throw new Error(moved);
      return { label, note: pack.note, local: known, isNew: false, already: true, demo };
    }

    if (!known && !demo) {
      const spent = await getRhPublicClient()
        .readContract({
          address: network.pool,
          abi: shieldPoolAbi,
          functionName: "isSpent",
          args: [nullifier],
        })
        .catch(() => false);
      if (spent) throw new Error(moved);
    }

    const tree = await syncShieldTree(getRhPublicClient()).catch(() => null);
    const idx = tree?.indexByCommitment.get(commitment.toLowerCase());

    const local: LocalNote = known ?? {
      id: claimNoteId(),
      chainId: network.chainId,
      pool: network.pool,
      asset,
      amountWei: pack.amountWei,
      commitment,
      secret,
      nullifier,
      bound: true,
      scheme: "poseidon",
      from: address,
      createdAt: Date.now(),
      status: "open",
      source: "local",
      leafIndex: idx ?? undefined,
      // The payer's private note, kept with the balance (encrypted at rest).
      ...(pack.note ? { note: pack.note } : {}),
      // Recording demo: the pretend payer cannot take anything back.
      ...(demo ? { secured: true } : {}),
    };
    if (!known) saveLocalNote(local);
    else if (demo) updateLocalNote(known.id, { secured: true });
    setSelectedId(local.id);
    refreshNotes();
    void refreshTree();
    return { label, note: pack.note, local, isNew: !known, already: false, demo };
  }

  async function onImportNote() {
    setError(null);
    setImportOk(null);
    try {
      const r = await claimCode(importText, importPassphrase);
      if (r.isNew) countLinkClaimed(importText);
      setImportText("");
      setImportPassphrase("");
      if (r.already) {
        setImportOk({ text: `You already claimed ${r.label}.`, note: r.note });
        return;
      }
      if (r.demo) {
        setImportOk({
          text: `Claimed and secured ${r.label}. Only you can spend it now.`,
          note: r.note,
          fresh: true,
        });
        return;
      }
      await secureNote(r.local, { claimed: true, note: r.note });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  }

  /**
   * Sent links > Take back: the same claim into the sender's own balance, then
   * secured, so the link stops working once the move lands.
   */
  async function takeBackLink(code: string, passphrase?: string): Promise<{ secured: boolean }> {
    const r = await claimCode(code, passphrase);
    if (r.already || r.demo) return { secured: true };
    const outcome = await secureNote(r.local, undefined, false);
    if (outcome === "already_spent") {
      throw new Error("Someone claimed it first, so there is nothing to take back.");
    }
    return { secured: outcome === "swept" };
  }

  /** The banner's button: secure every claimed payment still open to the payer, one at a time. */
  async function secureAll() {
    for (const n of unsecured) {
      if ((await secureNote(n)) !== "swept") return;
    }
  }

  // Sticky receive tag for direct private pay
  useEffect(() => {
    if (mode !== "receive" && mode !== "send") return;
    void getOrCreateReceiveIdentity().then(setMyIdentity).catch(() => {
      /* crypto unavailable */
    });
    if (mode === "send") setContacts(loadContacts());
  }, [mode]);

  // Auto-scan inbox when opening Receive (if memo board live)
  useEffect(() => {
    if (mode !== "receive" || !isPayMemoLive()) return;
    void scanInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-tab scan once per enter
  }, [mode]);

  // Live preview when pasting a ticket (amount only, not a full claim)
  useEffect(() => {
    const t = importText.trim();
    if (!t || mode !== "receive") {
      setClaimPreview(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          if (isPayToTagSealed(t)) {
            const pack = await decodeNotePackage(t, undefined, {
              tryTagDecrypt: true,
            });
            if (!cancelled) {
              setClaimPreview({
                text: `A payment of ${formatAssetLabel(pack.amountWei, pack.asset)} for you, ready to claim.`,
                note: pack.note,
              });
            }
            return;
          }
          if (isEncryptedPackage(t) && !importPassphrase.trim()) {
            if (!cancelled) {
              setClaimPreview({ text: "This claim link is locked. Enter the phrase to see it." });
            }
            return;
          }
          const pack = await decodeNotePackage(
            t,
            importPassphrase || undefined
          );
          if (cancelled) return;
          setClaimPreview({
            text: `Looks like a payment of ${formatAssetLabel(pack.amountWei, pack.asset)}.`,
            note: pack.note,
          });
        } catch (e) {
          if (!cancelled) {
            setClaimPreview(
              e instanceof Error && e.message.includes("someone else")
                ? { text: e.message }
                : null
            );
          }
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [importText, importPassphrase, mode]);

  const working = busy || isPending || confirming;
  const connectedOk = isConnected && onProduct;
  const memoLive = isPayMemoLive();

  // Payment request: who asked (only a saved contact counts as known) and
  // whether a private balance can cover it on this network.
  const requestContact = request?.to
    ? (contacts.find((c) => c.tag === request.to)?.label ?? null)
    : null;
  const requestHint = ((): { text: string; addHref?: string } | null => {
    const asset = request?.asset;
    if (!asset || !shieldLive) return null;
    if (!requestNoteId) {
      return {
        text: `You have no private ${asset.symbol} on ${network.label} yet. Add some, then open this link again.`,
        addHref: "/app/vault?tab=shield",
      };
    }
    if (!selected) return null;
    if (selected.asset.toLowerCase() !== asset.address.toLowerCase()) {
      return {
        text: `This request is for ${asset.symbol}. The balance picked below holds ${assetLabel(selected.asset)}.`,
      };
    }
    const need = request.amount ? parseAssetAmount(request.amount, asset.address) : null;
    if (need && BigInt(selected.amountWei) < need) {
      return {
        text: `Each payment comes from one balance, and your largest ${asset.symbol} balance is ${formatAssetLabel(selected.amountWei, selected.asset)}. Add more to pay it in full.`,
        addHref: "/app/vault?tab=shield",
      };
    }
    return null;
  })();

  function selectMode(id: Mode) {
    setMode(id);
    setError(null);
    setStatus(null);
    setImportOk(null);
    setClaimPreview(null);
  }

  const shieldTokens = shieldTokensFor(network.chainId);
  const logoIdFor = (asset: string): string | null => {
    if (isNativeAsset(asset)) return null;
    return (
      shieldTokens.find((t) => t.address.toLowerCase() === asset.toLowerCase())?.id ??
      asset
    );
  };

  const totals = (() => {
    const m = new Map<string, bigint>();
    for (const n of notes) {
      const k = n.asset.toLowerCase();
      m.set(k, (m.get(k) ?? 0n) + BigInt(n.amountWei || "0"));
    }
    return Array.from(m.entries()).map(([asset, amt]) => ({
      asset,
      label: assetLabel(asset),
      logoId: logoIdFor(asset),
      amount: formatAssetAmount(amt, asset),
    }));
  })();

  const connectPrompt = (action: string) => (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-surface px-4 py-3">
      <p className="text-[14px] text-mute">
        {!isConnected
          ? `Connect a wallet to ${action}.`
          : `Switch to ${network.label} to ${action}.`}
      </p>
      <WalletMenu />
    </div>
  );

  const relayToggle = (
    <RelayToggle
      available={relayAvailable}
      on={relayOn}
      onChange={(v) => {
        setRelayOn(v);
        setRelayPreferred(v);
      }}
    />
  );

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="gl-card min-w-0 p-5 sm:p-7">
          <DevKeysBanner compact />

          {/* Mode tabs */}
          <div
            role="tablist"
            aria-label="Pay"
            className="flex rounded-full bg-surface p-1"
          >
            {(
              [
                ["send", "Send privately", "Send"],
                ["receive", "Receive", "Receive"],
                ["cashout", "Cash out", "Cash out"],
              ] as const
            ).map(([id, label, short]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => selectMode(id)}
                className={`h-10 flex-1 whitespace-nowrap rounded-full px-3 text-[14px] transition-colors duration-200 ${
                  mode === id
                    ? "bg-panel font-medium text-foreground shadow-card dark:bg-surface-2"
                    : "text-mute hover:text-foreground"
                }`}
              >
                <span className="max-sm:hidden">{label}</span>
                <span className="sm:hidden">{short}</span>
              </button>
            ))}
          </div>

          {!poseidonMode && (
            <p className="mt-5 rounded-xl bg-warn-soft px-4 py-3 text-[13.5px] leading-relaxed text-warn">
              The private vault is not connected right now. Try again shortly.
            </p>
          )}

          {mode === "send" && request && (
            <PaymentRequestBanner
              request={request}
              contactLabel={requestContact}
              currentNetwork={networkKey}
              onSwitchNetwork={setNetworkKey}
              onDismiss={() => setRequest(null)}
              balanceHint={requestHint}
            />
          )}

          {unsecured.length > 0 && poseidonMode && (
            <div className="mt-5 rounded-xl bg-warn-soft px-4 py-3.5 text-[13.5px] leading-relaxed">
              <p className="font-medium text-warn">
                {unsecured.length === 1
                  ? `Secure the ${formatAssetLabel(unsecured[0]!.amountWei, unsecured[0]!.asset)} you claimed`
                  : `Secure ${unsecured.length} payments you claimed`}
              </p>
              <p className="mt-1 text-foreground">
                {unsecured.length === 1
                  ? "Whoever paid you made its key, so they can still take it back until you secure it. Securing moves it into a balance only you hold."
                  : "Whoever paid you made their keys, so they can still take them back until you secure them. Securing moves them into a balance only you hold."}
                {relayOn
                  ? " It goes through the Gloam relay, so your wallet stays out of it."
                  : " With the relay off, your wallet signs it and shows as the sender."}
              </p>
              {isConnected && (onProduct || relayOn) ? (
                <button
                  type="button"
                  onClick={() => void secureAll()}
                  disabled={working}
                  className="btn btn-ink btn-sm mt-3"
                >
                  {securingId ? (
                    <>
                      <Spinner />
                      <span className="truncate">{status || "Securing…"}</span>
                    </>
                  ) : unsecured.length === 1 ? (
                    "Secure it now"
                  ) : (
                    "Secure them now"
                  )}
                </button>
              ) : (
                <div className="mt-3">{connectPrompt("secure it")}</div>
              )}
            </div>
          )}

          {importOk && (
            <div
              className={`mt-5 flex items-start gap-3 rounded-xl px-4 py-3 text-[13.5px] leading-relaxed text-foreground ${
                importOk.tone === "danger"
                  ? "bg-danger-soft"
                  : importOk.tone === "warn"
                    ? "bg-warn-soft"
                    : "bg-sealed-soft"
              }`}
              role={importOk.tone === "danger" ? "alert" : undefined}
              aria-live="polite"
            >
              <span
                className={`mt-0.5 ${
                  importOk.tone === "danger"
                    ? "text-danger"
                    : importOk.tone === "warn"
                      ? "text-warn"
                      : "text-sealed"
                }`}
                aria-hidden
              >
                {importOk.tone ? <LockIcon size={14} /> : <CheckIcon />}
              </span>
              <span className="min-w-0">
                <span className="block">{importOk.text}</span>
                {importOk.note && (
                  <PaymentNoteLine
                    note={importOk.note}
                    label="Their note"
                    className="mt-1 text-soft"
                  />
                )}
                {importOk.fresh && (
                  <>
                    <span className="mt-2 block text-soft">
                      Every new person in the vault makes every payment in it harder to trace, yours included.
                    </span>
                    <span className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setImportOk(null);
                          setPayStyle("bearer");
                          setMode("send");
                        }}
                        className="btn btn-ink btn-sm"
                      >
                        Send one back
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setImportOk(null);
                          setMode("cashout");
                        }}
                        className="btn btn-ghost btn-sm"
                      >
                        Cash out
                      </button>
                    </span>
                  </>
                )}
              </span>
            </div>
          )}

          {shieldLive && notes.length > 0 && mode !== "receive" ? (
            <>
              <section className="mt-6">
                <p className="text-[13px] text-mute">
                  {mode === "cashout" ? "Cash out from" : "Pay from"}
                </p>
                <ul
                  role="radiogroup"
                  aria-label={mode === "cashout" ? "Cash out from" : "Pay from"}
                  className="mt-2 max-h-[300px] space-y-2 overflow-y-auto"
                >
                  {notes.map((n) => {
                    const active = selected?.id === n.id;
                    const exposed = isUnsecuredClaim(n);
                    const kind = exposed
                      ? "Claimed, not secured yet"
                      : isClaimedNote(n) || isSecuredClaim(n) || !n.txHash
                        ? "Claimed"
                        : n.id.startsWith("chg-")
                          ? "Change from a payment"
                          : "Added";
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setSelectedId(n.id)}
                          className={`flex min-h-[60px] w-full items-center gap-3 rounded-[14px] border px-4 py-2.5 text-left transition-colors ${
                            active
                              ? "border-foreground bg-panel"
                              : "border-line hover:border-line-strong hover:bg-surface"
                          }`}
                        >
                          <AssetMark id={logoIdFor(n.asset)} symbol={assetLabel(n.asset)} size={32} />
                          <span className="min-w-0 flex-1">
                            <span className="tnum block truncate text-[16px] text-foreground">
                              {formatAssetAmount(n.amountWei, n.asset)}{" "}
                              <span className="text-mute">{assetLabel(n.asset)}</span>
                            </span>
                            <span className={`block truncate text-[12px] ${exposed ? "text-warn" : "text-mute"}`}>
                              {kind},{" "}
                              {new Date(n.createdAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                            {n.note && (
                              <PaymentNoteLine
                                note={n.note}
                                className="mt-0.5 text-[12px] text-soft"
                              />
                            )}
                          </span>
                          <span
                            aria-hidden
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                              active ? "border-foreground bg-foreground" : "border-line-strong"
                            }`}
                          >
                            {active && <span className="h-2 w-2 rounded-full bg-panel" />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {mode === "send" && (
                <div className="mt-6 space-y-5">
                  {/* Same mental model as public Send: To + Amount. A claim
                      link is the way to pay someone who has never used Gloam,
                      so it sits next to the address, not under the form. */}
                  <div>
                    <p id="pay-to" className="text-[13px] text-mute">
                      To
                    </p>
                    <div
                      role="radiogroup"
                      aria-labelledby="pay-to"
                      className="mt-2 grid grid-cols-2 gap-2"
                    >
                      {(
                        [
                          ["direct", "Gloam address", "They already use Gloam"],
                          ["bearer", "Claim link", "Anyone, even new to Gloam"],
                        ] as const
                      ).map(([style, label, hint]) => {
                        const active = payStyle === style;
                        return (
                          <button
                            key={style}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => {
                              if (style === "bearer") setRecipientTag("");
                              else setSendPassphrase("");
                              setPayStyle(style);
                            }}
                            className={`flex min-h-[60px] min-w-0 items-start gap-3 rounded-[14px] border px-3.5 py-3 text-left transition-colors ${
                              active
                                ? "border-foreground bg-panel"
                                : "border-line hover:border-line-strong hover:bg-surface"
                            }`}
                          >
                            <span
                              aria-hidden
                              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                                active ? "border-foreground bg-foreground" : "border-line-strong"
                              }`}
                            >
                              {active && <span className="h-2 w-2 rounded-full bg-panel" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[14.5px] leading-snug text-foreground">{label}</span>
                              <span className="mt-0.5 block text-[12px] leading-snug text-mute">{hint}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {payStyle === "bearer" ? (
                      <div className="mt-3">
                        <p className="text-[12.5px] leading-relaxed text-mute">
                          You get a link to send any way you like. They tap it and
                          claim in Gloam. Anyone with the link can claim it, so add
                          a phrase to lock it and share the phrase separately.
                        </p>
                        <label
                          htmlFor="send-pass"
                          className="mt-4 block text-[13px] text-mute"
                        >
                          Phrase (optional)
                        </label>
                        <input
                          id="send-pass"
                          type="text"
                          autoComplete="off"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          value={sendPassphrase}
                          onChange={(e) => setSendPassphrase(e.target.value)}
                          placeholder="e.g. coffee-tuesday"
                          className="gl-input mt-2"
                        />
                      </div>
                    ) : (
                    <>
                    <label htmlFor="recv-tag" className="sr-only">
                      Their Gloam address
                    </label>
                    <input
                      id="recv-tag"
                      value={recipientTag}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        setRecipientTag(v);
                        if (v.startsWith("gloamr1.")) setPayStyle("direct");
                        else if (v === "") setPayStyle("direct");
                      }}
                      placeholder="Their Gloam address (gloamr1…)"
                      className="gl-input tnum mt-3"
                    />
                    <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
                      Like sending to an address, but private. They find their
                      Gloam address under Pay, Receive.
                    </p>
                    {(contacts.length > 0 || recipientTag.trim().startsWith("gloamr1.")) && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {contacts.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setRecipientTag(c.tag)}
                            className={`h-10 rounded-full px-3.5 text-[13px] transition-colors ${
                              recipientTag === c.tag
                                ? "bg-ink text-on-ink"
                                : "bg-surface text-soft hover:bg-surface-2 hover:text-foreground"
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}
                        {recipientTag.trim().startsWith("gloamr1.") && (
                          <button
                            type="button"
                            className="h-10 rounded-full px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-surface"
                            onClick={() => {
                              const label =
                                window.prompt("Save contact as", request?.name ?? "Friend") ?? "";
                              if (!label.trim()) return;
                              upsertContact(label, recipientTag);
                              setContacts(loadContacts());
                            }}
                          >
                            + Save to contacts
                          </button>
                        )}
                      </div>
                    )}
                    </>
                    )}
                  </div>

                  <div>
                    <label htmlFor="pay-amt" className="text-[13px] text-mute">
                      Amount
                    </label>
                    <div className="mt-2 flex items-center gap-3 rounded-[16px] bg-surface py-2 pl-4 pr-2 focus-within:ring-2 focus-within:ring-foreground/15">
                      <input
                        id="pay-amt"
                        inputMode="decimal"
                        autoComplete="off"
                        value={sendAmount}
                        onChange={(e) =>
                          setSendAmount(e.target.value.replace(/[^0-9.]/g, ""))
                        }
                        placeholder="0"
                        className="tnum min-w-0 flex-1 bg-transparent text-[32px] font-light leading-[1.25] tracking-[-0.02em] text-foreground outline-none! placeholder:text-faint"
                      />
                      {selected && (
                        <span className="shrink-0 text-[15px] text-mute">
                          {assetLabel(selected.asset)}
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm shrink-0"
                        onClick={() => setSendAmount(maxEth)}
                      >
                        Max
                      </button>
                    </div>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
                      The amount never shows up on the explorer. Anything left
                      over stays in your private balance.
                    </p>
                  </div>

                  <PayNoteField
                    value={payNote}
                    open={noteOpen}
                    onOpen={setNoteOpen}
                    onChange={setPayNote}
                    fromRequest={Boolean(request?.note) && cleanPaymentNote(payNote) === request?.note}
                    bearer={payStyle === "bearer" && !recipientTag.trim()}
                    locked={Boolean(sendPassphrase.trim())}
                  />

                  {relayToggle}

                  {!connectedOk ? (
                    connectPrompt("pay privately")
                  ) : (
                    <button
                      type="button"
                      disabled={
                        !isConnected ||
                        !onProduct ||
                        !selected ||
                        matchesChain === false ||
                        treeLoading ||
                        !relayChecked ||
                        working ||
                        (payStyle !== "bearer" && !recipientTag.trim())
                      }
                      onClick={() => {
                        if (recipientTag.trim()) setPayStyle("direct");
                        void onPrivateSend();
                      }}
                      className="btn btn-ink btn-lg btn-block"
                    >
                      {working &&
                      (pendingAction.current === "send" ||
                        pendingAction.current === "memo") ? (
                        <>
                          <Spinner />
                          <span className="truncate">{status || "Working…"}</span>
                        </>
                      ) : treeLoading ? (
                        "Syncing your balance…"
                      ) : payStyle === "bearer" ? (
                        "Make the claim link"
                      ) : (
                        "Send privately"
                      )}
                    </button>
                  )}
                  {treeError && !treeLoading && matchesChain !== false && (
                    <p className="flex flex-wrap items-center justify-center gap-x-2 text-center text-[12.5px] text-warn">
                      Couldn&apos;t read the vault right now. The network may be busy.
                      <button
                        type="button"
                        onClick={() => void refreshTree()}
                        className="font-medium underline underline-offset-4"
                      >
                        Try again
                      </button>
                    </p>
                  )}
                  {matchesChain === false && (
                    <p className="flex flex-wrap items-center justify-center gap-x-2 text-center text-[12.5px] text-warn">
                      Your private balance is out of sync.
                      <button
                        type="button"
                        onClick={() => void refreshTree()}
                        className="font-medium underline underline-offset-4"
                      >
                        Refresh
                      </button>
                    </p>
                  )}
                  {memoLive && payStyle === "direct" && (
                    <p className="text-center text-[12.5px] leading-relaxed text-mute">
                      They get a private heads-up, so the payment shows up under
                      Receive on their side. No QR needed.
                    </p>
                  )}
                  {shareBlob && (
                    <PaymentTicketShare
                      code={shareBlob}
                      amountLabel={shareAmountLabel}
                      locked={shareLocked}
                      onSaved={() => setSavedCode(shareBlob)}
                    />
                  )}
                </div>
              )}

              {mode === "cashout" && (
                <div className="mt-6 space-y-4">
                  <div className="rounded-[16px] bg-warn-soft px-4 py-3.5 text-[13px] leading-relaxed">
                    <p className="font-medium text-warn">
                      Cashing out makes this amount public
                    </p>
                    <p className="mt-1 text-soft">
                      The explorer will show the asset, the amount and your
                      wallet. To keep the size private, send it privately or
                      trade privately instead.
                    </p>
                  </div>
                  {selected && (
                    <div className="rounded-[16px] bg-surface p-[16px] sm:p-5">
                      <p className="text-[13px] text-mute">
                        You get, in your connected wallet
                      </p>
                      <p className="tnum mt-2.5 truncate text-[32px] font-light leading-none tracking-[-0.02em] text-foreground">
                        {formatAssetAmount(cashOutAmount - cashOutFee, selected.asset)}{" "}
                        <span className="text-[15px] tracking-normal text-mute">
                          {assetLabel(selected.asset)}
                        </span>
                      </p>
                      {cashOutFeeBps > 0 && (
                        <p className="tnum mt-2 text-[12.5px] text-mute">
                          You receive {formatAssetLabel(cashOutAmount - cashOutFee, selected.asset)} (
                          {formatFeePercent(cashOutFeeBps)} fee: {formatAssetLabel(cashOutFee, selected.asset)})
                        </p>
                      )}
                      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px]">
                        <span className="text-mute">
                          In the vault ({assetLabel(selected.asset)})
                        </span>
                        <span className="tnum truncate text-foreground">
                          {poolForCashOut != null
                            ? formatAssetLabel(poolForCashOut, selected.asset)
                            : "Checking…"}
                        </span>
                      </div>
                      {cashOutInventoryShort ? (
                        <p className="mt-2 text-[12.5px] leading-relaxed text-warn">
                          Not enough in the vault to pay this out yet. Cash out
                          opens once more {assetLabel(selected.asset)} is added.{" "}
                          <Link
                            href="/app/vault?tab=shield"
                            className="font-medium underline underline-offset-4"
                          >
                            Add more
                          </Link>
                        </p>
                      ) : poolForCashOut != null ? (
                        <p className="mt-2 text-[12.5px] text-mute">
                          The vault can cover this cash out.
                        </p>
                      ) : null}
                    </div>
                  )}
                  {relayToggle}
                  {!connectedOk ? (
                    connectPrompt("cash out")
                  ) : (
                    <button
                      type="button"
                      disabled={
                        !isConnected ||
                        !onProduct ||
                        !selected ||
                        matchesChain === false ||
                        treeLoading ||
                        !relayChecked ||
                        working ||
                        selected?.leafIndex == null ||
                        cashOutInventoryShort ||
                        cashOutFeeUnknown
                      }
                      onClick={() => void onCashOut()}
                      className="btn btn-ink btn-lg btn-block"
                    >
                      {working && pendingAction.current === "cashout" ? (
                        <>
                          <Spinner />
                          <span className="truncate">{status || "Working…"}</span>
                        </>
                      ) : cashOutInventoryShort ? (
                        "Not enough in the vault yet"
                      ) : cashOutFeeUnknown ? (
                        "Loading the cash-out fee…"
                      ) : (
                        "Cash out to my wallet"
                      )}
                    </button>
                  )}
                  {selected?.leafIndex == null && (
                    <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-warn">
                      This balance is not linked to the vault yet.
                      <button
                        type="button"
                        onClick={() => void refreshTree()}
                        className="font-medium underline underline-offset-4"
                      >
                        Refresh
                      </button>
                    </p>
                  )}
                </div>
              )}
            </>
          ) : mode !== "receive" ? (
            <div className="mt-6 rounded-[16px] bg-surface px-5 py-9 text-center">
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-panel text-mute shadow-card">
                <LockIcon />
              </span>
              <p className="mt-4 text-[15px] text-foreground">
                Nothing in your private balance yet
              </p>
              <p className="mx-auto mt-1.5 max-w-[40ch] text-[13.5px] leading-relaxed text-mute">
                Add money first, or open Receive to claim a payment someone sent
                you.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link href="/app/vault?tab=shield" className="btn btn-ink">
                  Add money
                </Link>
                <button
                  type="button"
                  onClick={() => selectMode("receive")}
                  className="btn btn-ghost"
                >
                  Receive
                </button>
              </div>
            </div>
          ) : null}

          {mode === "send" && shieldLive && <SentLinks onTakeBack={takeBackLink} />}

          {mode === "receive" && (
            <div className="mt-6 space-y-7">
              <section>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-medium text-foreground">
                    Your Gloam address
                  </h3>
                  {myIdentity && (
                    <button
                      type="button"
                      onClick={() => {
                        void rotateReceiveIdentity().then(setMyIdentity);
                      }}
                      title="Makes a new address. Payments sent to the old one stop opening here."
                      className="btn btn-quiet btn-sm -mr-2 text-mute"
                    >
                      New address
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-mute">
                  Share it once. People paste it to pay you privately. Payments
                  open only in{" "}
                  <strong className="font-medium text-foreground">this browser</strong>,
                  so back up your account before you clear your data.
                </p>
                {myIdentity ? (
                  <>
                    <div className="mt-3 rounded-[16px] border border-line p-[16px]">
                      <p className="tnum break-all text-[13px] leading-relaxed text-foreground">
                        {myIdentity.tag}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(myIdentity.tag);
                              setTagCopied(true);
                              setTimeout(() => setTagCopied(false), 2000);
                            } catch {
                              setError("Could not copy your address.");
                            }
                          }}
                          aria-live="polite"
                          className="btn btn-ink"
                        >
                          {tagCopied ? "Copied" : "Copy address"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById("req-amount");
                            const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                            el?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
                            el?.focus({ preventScroll: true });
                          }}
                          className="btn btn-ghost"
                        >
                          Request a payment
                        </button>
                      </div>
                    </div>
                    <div className="mt-3">
                      <PaymentTicketShare
                        code={myIdentity.tag}
                        amountLabel={null}
                        locked={false}
                      />
                    </div>
                  </>
                ) : (
                  <p className="mt-3 rounded-[16px] bg-surface p-[16px] text-[13px] text-mute">
                    Making your address… This needs a secure browser connection.
                  </p>
                )}
              </section>

              {myIdentity && (
                <section className="border-t border-line pt-6">
                  <h3 className="text-[15px] font-medium text-foreground">
                    Request a payment
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-mute">
                    Make a link with the amount and a note filled in, like an
                    invoice. They open it, check it and pay you privately.
                  </p>
                  <RequestPaymentCard tag={myIdentity.tag} />
                </section>
              )}

              <section className="border-t border-line pt-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-medium text-foreground">
                    Payments to you
                  </h3>
                  <button
                    type="button"
                    onClick={() => void scanInbox()}
                    className="btn btn-ghost btn-sm"
                  >
                    Check now
                  </button>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-mute">
                  When someone pays your Gloam address, it shows up here on its
                  own. No QR needed.
                  {memoLive
                    ? ""
                    : " Not available on this network yet, so paste the claim link below."}
                </p>
                {inboxStatus && (
                  <p className="mt-3 text-[13px] text-soft" aria-live="polite">
                    {inboxStatus}
                  </p>
                )}
                {inbox.length > 0 && (
                  <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[16px] border border-line">
                    {inbox.map((row) => (
                      <li
                        key={row.memo.paymentCommitment}
                        className="flex min-h-14 items-center justify-between gap-3 px-4 py-2"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sealed-soft text-sealed">
                            <LockIcon size={13} />
                          </span>
                          <span className="min-w-0">
                            <span className="tnum block truncate text-[15px] text-foreground">
                              {row.label}
                            </span>
                            {row.note ? (
                              <PaymentNoteLine
                                note={row.note}
                                className="text-[12px] text-soft"
                              />
                            ) : (
                              <span className="block text-[12px] text-mute">
                                Private payment
                              </span>
                            )}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm shrink-0"
                          onClick={() => {
                            setImportText(row.ticket);
                            setClaimPreview({
                              text: `Selected ${row.label} from your payments.`,
                              note: row.note,
                            });
                          }}
                        >
                          Select
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section id="claim-payment" className="scroll-mt-24 border-t border-line pt-6">
                <h3 className="text-[15px] font-medium text-foreground">
                  Claim a payment
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-mute">
                  Paste the claim link or payment code you were sent. Codes start
                  with gloam2t, gloam1 or gloam1e. Claiming also secures it: the
                  payment moves into a balance only you hold, so the person who
                  sent it can no longer take it back.
                </p>
                <label htmlFor="claim-code" className="sr-only">
                  Claim link or payment code
                </label>
                <textarea
                  id="claim-code"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={4}
                  spellCheck={false}
                  className="gl-input tnum mt-3 h-auto min-h-[108px] resize-none py-3 text-[13px] leading-relaxed"
                  placeholder="gloam2t… or gloam1…"
                />
                {claimPreview && (
                  <div className="mt-2 rounded-xl bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-soft" aria-live="polite">
                    <p>{claimPreview.text}</p>
                    {claimPreview.note && (
                      <PaymentNoteLine
                        note={claimPreview.note}
                        label="Their note"
                        className="mt-1 text-foreground"
                      />
                    )}
                  </div>
                )}
                {(importText.trim().startsWith("gloam1e.") ||
                  (isEncryptedPackage(importText) &&
                    !isPayToTagSealed(importText))) && (
                  <div className="mt-4">
                    <label htmlFor="recv-pass" className="text-[13px] text-mute">
                      Phrase
                    </label>
                    <input
                      id="recv-pass"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={importPassphrase}
                      onChange={(e) => setImportPassphrase(e.target.value)}
                      placeholder="The phrase the sender gave you"
                      className="gl-input mt-2"
                    />
                  </div>
                )}
                <div className="mt-4 space-y-4">
                  {relayToggle}
                  {!isConnected ? (
                    connectPrompt("claim it")
                  ) : (
                    <button
                      type="button"
                      onClick={() => void onImportNote()}
                      disabled={!importText.trim() || !isConnected || working}
                      className="btn btn-ink btn-lg btn-block"
                    >
                      {securingId ? (
                        <>
                          <Spinner />
                          <span className="truncate">{status || "Securing…"}</span>
                        </>
                      ) : (
                        "Claim and secure"
                      )}
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}

          {(error || writeError) && (
            <p
              role="alert"
              className="mt-5 break-words rounded-xl bg-danger-soft px-4 py-3 text-[13.5px] leading-relaxed text-danger"
            >
              {error || writeError?.message.slice(0, 200)}
            </p>
          )}
          {txHash && !isSuccess && (
            <p className="mt-4 flex items-center justify-center gap-2 text-[13.5px] text-mute">
              Submitted.
              <a
                href={network.explorerTx(txHash)}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                View transaction
              </a>
            </p>
          )}
        </div>

        <aside className="space-y-4">
          {mode === "receive" ? (
            <div className="gl-card p-5">
              <p className="text-[13px] text-mute">About your Gloam address</p>
              <ul className="mt-3 divide-y divide-line text-[13.5px] leading-relaxed">
                <li className="py-3">
                  <p className="text-foreground">Not a wallet address</p>
                  <p className="mt-0.5 text-mute">
                    It never shows up on the explorer, so nobody can look up what
                    you receive.
                  </p>
                </li>
                <li className="py-3">
                  <p className="text-foreground">Opens in this browser</p>
                  <p className="mt-0.5 text-mute">
                    Back up your account in{" "}
                    <Link
                      href="/app/settings"
                      className="text-foreground underline underline-offset-4"
                    >
                      Settings
                    </Link>{" "}
                    so you can open payments on another device.
                  </p>
                </li>
                <li className="py-3">
                  <p className="text-foreground">Requests stay private</p>
                  <p className="mt-0.5 text-mute">
                    A request link carries your address, the amount and a note.
                    When they pay, the note comes back sealed inside the
                    payment, so only the two of you can read it.
                  </p>
                </li>
                <li className="pt-3">
                  <p className="text-foreground">Claim links work too</p>
                  <p className="mt-0.5 text-mute">
                    Paste one under Claim a payment. It lands in your private
                    balance and is secured straight away, so the person who sent
                    it cannot take it back.
                  </p>
                </li>
              </ul>
            </div>
          ) : (
            <>
              <PrivateBalanceCard rows={totals} />
              <div className="gl-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] text-mute">What the explorer shows</p>
                  {mode === "send" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sealed-soft px-2.5 py-0.5 text-[12px] font-medium text-sealed">
                      <LockIcon size={10} />
                      Private
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-surface px-2.5 py-0.5 text-[12px] text-mute">
                      Public
                    </span>
                  )}
                </div>
                <dl className="mt-3 divide-y divide-line text-[14px]">
                  <div className="flex h-11 items-center justify-between gap-3">
                    <dt className="text-mute">Sent by</dt>
                    <dd className="truncate text-foreground">
                      {relayOn ? "Gloam relay" : "Your wallet"}
                    </dd>
                  </div>
                  <div className="flex h-11 items-center justify-between gap-3">
                    <dt className="text-mute">To</dt>
                    <dd className="tnum truncate text-foreground">
                      {mode === "send" ? (
                        <SealDots n={6} className="text-foreground/60" />
                      ) : address ? (
                        shortAddress(address, 4)
                      ) : (
                        "Your wallet"
                      )}
                    </dd>
                  </div>
                  <div className="flex h-11 items-center justify-between gap-3">
                    <dt className="text-mute">Amount</dt>
                    <dd className="tnum truncate text-foreground">
                      {mode === "send" ? (
                        <SealDots n={6} className="text-foreground/60" />
                      ) : selected ? (
                        formatAssetLabel(selected.amountWei, selected.asset)
                      ) : (
                        "The full amount"
                      )}
                    </dd>
                  </div>
                  <IssuerPolicyRow chainId={network.chainId} asset={mode === "cashout" ? selected?.asset : null} flow="cashout" />
                </dl>
                <p className="mt-3 text-[12.5px] leading-relaxed text-mute">
                  {mode === "send"
                    ? relayOn
                      ? "Nothing on the explorer links this payment to you or to them."
                      : relayAvailable
                        ? "Turn on Hide my wallet so your wallet stays off it too."
                        : "The amount and the person you pay stay hidden. Your wallet shows as the sender while the relay is offline."
                    : "A cash out is a public transfer. It ends privacy for this amount."}
                </p>
              </div>
            </>
          )}
        </aside>
      </div>

      <SuccessModal
        open={showSuccess && Boolean(txHash)}
        title={successTitle}
        hold={mustSaveCode && savedCode !== shareBlob ? "Save the code to finish" : null}
        detail={
          mustSaveCode && shareBlob ? (
            <PaymentTicketShare
              code={shareBlob}
              amountLabel={shareAmountLabel}
              locked={shareLocked}
              stacked
              onSaved={() => setSavedCode(shareBlob)}
            />
          ) : undefined
        }
        body={
          pendingAction.current === "send" ||
          pendingAction.current === "memo" ||
          shareBlob ? (
            <>
              <p>
                {memoPosted
                  ? "They got a private heads-up, so the payment shows up under Receive on their side. The claim code on the page is a backup."
                  : "This code is the money. Copy, download or share it now. A copy stays under Sent links in this browser only, and anything left over stays in your private balance."}
              </p>
              {sentNote && (
                <p className="mt-3 break-words">
                  Your note went with it:{" "}
                  <span className="text-foreground">{sentNote}</span>
                </p>
              )}
            </>
          ) : (
            <p>
              The money is back in your wallet. That amount is public on the
              explorer, so only cash out when you need it in the open.
            </p>
          )
        }
        primaryHref={txHash ? network.explorerTx(txHash) : undefined}
        primaryLabel="View on explorer"
        secondaryLabel="Done"
        footer={
          paidPrivately ? (
            <PrivatePayShare chainId={network.chainId} networkLabel={network.label} testnet={network.testnet} />
          ) : undefined
        }
        onClose={() => {
          setShowSuccess(false);
          setStatus(null);
        }}
      />
    </>
  );
}

/**
 * Pay → Note: an optional private note that travels inside the payment
 * (lib/paymentNote), like "Invoice 042". One quiet button until it is wanted.
 */
function PayNoteField({
  value,
  open,
  onOpen,
  onChange,
  fromRequest,
  bearer,
  locked,
}: {
  value: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  onChange: (value: string) => void;
  /** The note is the one the payment request asked for. */
  fromRequest: boolean;
  /** Paying with a claim link rather than to a Gloam address. */
  bearer: boolean;
  /** The claim link is locked with a phrase. */
  locked: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the field opens or closes, so it is never dropped.
  const focusNext = useRef<"input" | "add" | null>(null);
  const shown = open || value.length > 0;
  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    (next === "input" ? inputRef : addRef).current?.focus();
  }, [shown]);

  if (!shown) {
    return (
      <div>
        <button
          ref={addRef}
          type="button"
          onClick={() => {
            focusNext.current = "input";
            onOpen(true);
          }}
          className="-my-2 inline-flex min-h-10 items-center gap-2 text-[13px] text-mute transition-colors hover:text-foreground"
        >
          <NoteGlyph size={14} />
          Add a note
        </button>
      </div>
    );
  }

  const length = Array.from(value).length;
  const hint = bearer
    ? locked
      ? "It is locked inside the claim link with your phrase, so only the person you pay can read it."
      : "It rides inside the claim link, so whoever has the link can read it. Add a phrase below to lock both."
    : "Only the person you pay can read it. It travels sealed inside the payment.";
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="pay-note" className="text-[13px] text-mute">
          Note <span className="text-faint">(optional)</span>
        </label>
        <button
          type="button"
          onClick={() => {
            focusNext.current = "add";
            onChange("");
            onOpen(false);
          }}
          className="-my-2 -mr-2 inline-flex min-h-10 items-center rounded-full px-2 text-[13px] text-mute transition-colors hover:text-foreground"
        >
          Remove note
        </button>
      </div>
      <input
        ref={inputRef}
        id="pay-note"
        type="text"
        autoComplete="off"
        maxLength={PAYMENT_NOTE_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Invoice 042"
        aria-describedby="pay-note-hint"
        className="gl-input mt-2"
      />
      <p
        id="pay-note-hint"
        className="mt-2 flex items-start gap-2 text-[12.5px] leading-relaxed text-mute"
      >
        <span className="mt-[3px] shrink-0 text-sealed" aria-hidden>
          <LockIcon size={12} />
        </span>
        <span className="min-w-0 flex-1">
          {fromRequest ? "From their request. " : ""}
          {hint}
        </span>
        {length > PAYMENT_NOTE_MAX - 20 && (
          <span className="tnum shrink-0 text-faint">
            {length}/{PAYMENT_NOTE_MAX}
          </span>
        )}
      </p>
    </div>
  );
}

type BalanceRow = {
  asset: string;
  label: string;
  logoId: string | null;
  amount: string;
};

/** The private balance, only visible to its owner. Carries the sealed glow. */
function PrivateBalanceCard({ rows }: { rows: BalanceRow[] }) {
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
              Only you
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
                <p className="tnum min-w-0 truncate text-[26px] font-light leading-none tracking-[-0.02em] text-foreground">
                  {hidden ? <SealDots n={6} className="text-foreground/60" /> : r.amount}{" "}
                  <span className="text-[14px] tracking-normal text-mute">{r.label}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <p className="tnum text-[34px] font-light leading-none tracking-[-0.02em] text-foreground">
              0
            </p>
            <p className="mt-2 max-w-[30ch] text-[13px] leading-relaxed text-mute">
              Add money or claim a payment to start. Nobody else can see this.
            </p>
          </div>
        )}
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

function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80 motion-reduce:animate-none"
      aria-hidden
    />
  );
}
