/**
 * A MOCK Gloam pool, in memory. It applies the same rules ShieldPoolPoseidon
 * applies to transfer(proof, root, nullifier, [c0, c1]): the root must be one
 * the tree has had, the nullifier must be unspent, both new commitments must be
 * fresh, and both are inserted. A successful transfer leaves a receipt with a
 * Transferred(nullifier, [c0, c1]) log, exactly what the real pool emits.
 *
 * Proofs are not checked here (run the demo with --real-proofs to generate and
 * verify real Groth16 transfer proofs). Nothing is broadcast anywhere.
 */
import type { Address, Hex } from "viem";
import {
  IncrementalMerkleTreePoseidon,
  fieldToHex,
  hexToField,
  noteCommitmentPoseidon,
  type GloamAsset,
} from "@gloamtrade/sdk";
import { TRANSFERRED_TOPIC, type GloamChargeChain, type GloamSubmitter, type MinimalReceipt } from "@gloamtrade/mppx-gloam/core";

const lc = (h: string) => h.toLowerCase();

export interface PublicEvent {
  tx: Hex;
  submittedBy: string;
  event: "Transferred";
  nullifier: Hex;
  newCommitments: [Hex, Hex];
}

/**
 * `pool` is the official pool the charge names (the receipts' logs come from
 * it); `asset` is the stablecoin the demo prices in. Both come from the network
 * the demo runs on the terms of.
 */
export function createMockPool(o: { pool: Address; asset: GloamAsset }) {
  const tree = new IncrementalMerkleTreePoseidon();
  const index = new Map<string, number>();
  const roots = new Set<string>();
  const spent = new Set<string>();
  const receipts = new Map<string, MinimalReceipt>();
  /** Everything an observer of the chain would see. */
  const publicFeed: PublicEvent[] = [];
  let n = 0;

  const insert = async (c: string) => {
    index.set(lc(c), await tree.insert(hexToField(c)));
    roots.add(lc(fieldToHex(tree.currentRoot)));
  };

  async function transfer(args: readonly unknown[], submittedBy: string): Promise<Hex> {
    const [, root, nullifier, outs] = args as [Hex, Hex, Hex, [Hex, Hex]];
    const tx = `0x${(++n).toString(16).padStart(64, "0")}` as Hex;
    const ok = roots.has(lc(root)) && !spent.has(lc(nullifier)) && outs.every((c) => !index.has(lc(c)));
    if (ok) {
      spent.add(lc(nullifier));
      for (const c of outs) await insert(c);
      publicFeed.push({ tx, submittedBy, event: "Transferred", nullifier, newCommitments: outs });
    }
    receipts.set(tx, {
      status: ok ? "success" : "reverted",
      logs: ok ? [{ address: o.pool, topics: [TRANSFERRED_TOPIC, lc(nullifier)], data: `0x${outs.map((c) => lc(c).slice(2)).join("")}` }] : [],
    });
    return tx;
  }

  const chain: GloamChargeChain = {
    isSpent: async (nf) => spent.has(lc(nf)),
    isCommitmentSeen: async (c) => index.has(lc(c)),
    pathForCommitment: async (c) => (index.has(lc(c)) ? tree.path(index.get(lc(c))!) : null),
    waitForReceipt: async (tx) => ({ status: receipts.get(tx)?.status ?? "reverted" }),
    getReceipt: async (tx) => receipts.get(tx) ?? null,
  };

  /** A submitter standing in for a wallet or the Gloam relay. */
  const submitter =
    (who: string): GloamSubmitter =>
    (intent) =>
      transfer(intent.exec.args, who);

  /**
   * Put a shielded note in the pool, as gloam_execute_shield or the app's Shield
   * would have. (A real shield is public: a deposit of a known amount. The demo
   * starts after it.)
   */
  async function shield(secret: bigint, amountWei: bigint, asset: Address = o.asset.address) {
    const commitment = fieldToHex(await noteCommitmentPoseidon(secret, amountWei, asset));
    await insert(commitment);
    return { secret: fieldToHex(secret), amountWei, commitment, path: await tree.path(index.get(lc(commitment))!) };
  }

  /** A fresh membership path for a note (what syncTree gives a real client). */
  async function pathOf(commitment: Hex) {
    return tree.path(index.get(lc(commitment))!);
  }

  return { chain, submitter, shield, pathOf, publicFeed, pool: o.pool, asset: o.asset };
}

export type MockPool = ReturnType<typeof createMockPool>;
