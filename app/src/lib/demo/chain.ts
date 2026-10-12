/*
 * Recording demo: stand-ins for the chain and the relay (switch in
 * lib/demoFlag.ts). Each lib that would touch the network checks the switch
 * once and lands here instead, so the app's own code (witnesses, tickets,
 * notes) runs end to end against the pretend wallet in ./store.
 */

import { MERKLE_DEPTH } from "@gloamtrade/sdk";
import { parseUnits, zeroAddress, type Address, type Hex } from "viem";
import type { GloamContact } from "@/lib/contacts";
import type { PoseidonMerklePath } from "@/lib/merklePoseidon";
import { getActiveNetwork, getNetwork, NETWORK_KEYS } from "@/lib/networks";
import { noteCommitmentPoseidon } from "@/lib/notePoseidon";
import type { ScannedMemo } from "@/lib/payMemo";
import { hexToField } from "@/lib/poseidon";
import type { RelayNetworkStatus } from "@/lib/relay/client";
import { TEMPO_STABLE_TOKENS } from "@/lib/tokens";
import type { SyncedTree } from "@/lib/treeSync";
import {
  DEMO_MS,
  creditDemoWallet,
  demoIncoming,
  demoLeafCount,
  demoLeafOpening,
  demoNotes,
  demoPoolDeposited,
  demoSentLeaves,
  jitter,
  randomField,
  randomHex,
  setDemoIncomingTicket,
  sleep,
  submitDemoTx,
} from "./store";

// ------------------------------------------------------------------ relay

const RELAYER: Address = "0x51c4e3A0B7D29f86A10083D08b6f2a947e0C1D35";

/** The relay is up on every network, memos included. */
export function demoRelayStatus(): RelayNetworkStatus[] {
  return NETWORK_KEYS.map((key) => ({
    chainId: getNetwork(key).chainId,
    key,
    enabled: true,
    relayer: RELAYER,
    memo: true,
    lowBalance: false,
  }));
}

/** The relay taking a proven action. It lands like any other transaction, minus the wallet. */
export async function demoRelay(body: Record<string, unknown>): Promise<Hex> {
  await sleep(jitter(DEMO_MS.relay));
  // A cash out pays the wallet; sends and memos only touch the vault.
  const wallet: [Address, bigint][] =
    body.action === "unshield" ? [[body.asset as Address, BigInt(body.amount as bigint)]] : [];
  // A private send's payment (commitments[0]) takes a leaf, so its claim link can be claimed.
  const sent = body.action === "transfer" ? [(body.commitments as readonly Hex[])[0]] : [];
  return submitDemoTx(Number(body.chainId), { wallet, sent });
}

// ------------------------------------------------------------------ vault

/** The vault tree as the app's own sync would build it for the pretend wallet. */
export function demoSyncedTree(): SyncedTree | null {
  const net = getActiveNetwork();
  if (!net.pool) return null;
  const indexByCommitment = new Map<string, number>();
  for (const n of demoNotes()) {
    if (n.chainId === net.chainId && n.leafIndex != null) {
      indexByCommitment.set(n.commitment.toLowerCase(), n.leafIndex);
    }
  }
  const incoming = demoIncoming(net.chainId);
  if (incoming) indexByCommitment.set(incoming.commitment.toLowerCase(), incoming.leafIndex);
  for (const [commitment, leaf] of demoSentLeaves(net.chainId)) indexByCommitment.set(commitment, leaf);
  return {
    scheme: "poseidon",
    leaves: [],
    root: randomField(),
    leafCount: demoLeafCount(net.chainId),
    indexByCommitment,
    pathForLeaf: (leafIndex) => demoPath(net.chainId, leafIndex),
  };
}

/** A path whose leaf is exactly what the note's secret opens, so the app's own witness checks pass. */
async function demoPath(chainId: number, leafIndex: number): Promise<PoseidonMerklePath | null> {
  const opening = demoLeafOpening(chainId, leafIndex);
  if (!opening) return null;
  const leaf = await noteCommitmentPoseidon(
    hexToField(opening.secret),
    BigInt(opening.amountWei),
    opening.asset
  );
  return {
    leafIndex,
    leaf,
    pathElements: Array.from({ length: MERKLE_DEPTH }, () => 0n),
    pathIndices: Array.from({ length: MERKLE_DEPTH }, (_, i) => (leafIndex >> i) & 1),
    root: hexToField(randomField()),
  };
}

export function demoPoolInventory(asset: Address): bigint {
  return demoPoolDeposited(getActiveNetwork().chainId, asset);
}

// ------------------------------------------------------------------ receive

/** The memo board as this wallet would scan it: the payment waiting for it, sealed to this browser's Gloam address. */
export async function demoPaymentMemos(): Promise<ScannedMemo[]> {
  const net = getActiveNetwork();
  const incoming = demoIncoming(net.chainId);
  await sleep(jitter(DEMO_MS.lookup));
  if (!incoming || !net.pool) return [];
  const { encryptTicketForTag, getOrCreateReceiveIdentity } = await import("@/lib/receiveTag");
  const { buildNotePackage, encodeNotePackage } = await import("@/lib/notePackage");
  const { tag } = await getOrCreateReceiveIdentity();
  let ticket = incoming.tag === tag ? incoming.ticket : undefined;
  if (!ticket) {
    const pack = buildNotePackage({
      pool: net.pool,
      asset: incoming.asset,
      amountWei: incoming.amountWei,
      secret: incoming.secret,
      commitment: incoming.commitment,
      note: incoming.note,
    });
    ticket = await encryptTicketForTag(encodeNotePackage(pack), tag);
    setDemoIncomingTicket(net.chainId, tag, ticket);
  }
  return [{ paymentCommitment: incoming.commitment, poster: zeroAddress, ticket, txHash: randomHex(32) }];
}

/** People the pretend wallet pays (their Gloam addresses are real keys, so tickets seal properly). */
export const DEMO_CONTACTS: GloamContact[] = [
  {
    id: "demo-yomi",
    label: "Yomi",
    tag: "gloamr1.MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkMUNu5NN3FOsOG3Z0pvzYSQ_drriwWSh1iEL8utrczEhpgvn82l6aQTNS5Gb1lgSTp6CcHyN_Kt-99sBkfxZcQ",
    createdAt: Date.UTC(2026, 7, 20),
  },
  {
    id: "demo-robin",
    label: "Robin",
    tag: "gloamr1.MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEMnv8F155ZLPr2-tjkzzDkkCQAGKW6e7glwei2RslxV80tmsWjAxyNCwgwMOCYTX5K-NLfzBuPywTi8pKZILhCQ",
    createdAt: Date.UTC(2026, 7, 22),
  },
  {
    id: "demo-kris",
    label: "Kris",
    tag: "gloamr1.MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWVpX3EE43uHltrRhrsfNqaoKWb2rBrt_JpE4uCI7sLHzZrUT8ceUibdpjv3GyGIVh_rsySrSDuivDgc3Y_06UA",
    createdAt: Date.UTC(2026, 8, 2),
  },
];

// ------------------------------------------------------------------ faucet

/** Tempo's faucet: a short wait, then 1,000 of each test stablecoin lands in the wallet. */
export async function demoFundTempo(): Promise<string[]> {
  await sleep(jitter(DEMO_MS.faucet));
  creditDemoWallet(
    getNetwork("tempo").chainId,
    TEMPO_STABLE_TOKENS.map((t) => [t.address, parseUnits("1000", t.decimals)])
  );
  return [];
}
