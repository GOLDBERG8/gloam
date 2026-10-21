/**
 * The buyer: an agent with a private balance (shielded notes) and an MPP
 * client that pays gloam charges from it. mppx handles the 402 dance; the
 * gloam method checks the terms against the agent's policy, proves a private
 * send of exactly the price, seals the payment note to the seller, and retries
 * with the credential.
 */
import { parseUnits, type Address, type Hex } from "viem";
import { Mppx } from "mppx/client";
import { gloam } from "@gloamtrade/mppx-gloam/client";
import type { BuiltPayment, Prover } from "@gloamtrade/sdk";
import type { MockPool } from "./mock-pool.js";

interface HeldNote {
  secret: Hex;
  amountWei: bigint;
  commitment: Hex;
  status: "unspent" | "pending";
}

/**
 * A minimal note wallet. A real agent keeps notes encrypted (the Gloam MCP's
 * note store does) and gets paths from syncTree; the shape is the same.
 */
export function createAgentWallet(pool: MockPool) {
  const notes: HeldNote[] = [];
  let lastSpent: HeldNote | null = null;
  let lastChange: HeldNote | null = null;
  return {
    add(n: { secret: Hex; amountWei: bigint; commitment: Hex }) {
      notes.push({ ...n, status: "unspent" });
    },
    /** The smallest unspent note that covers the charge, reserved until the payment settles. */
    async getNote(want: { amountWei: bigint; currency: Address }) {
      if (want.currency.toLowerCase() !== pool.asset.address.toLowerCase()) {
        throw new Error(`This wallet only holds ${pool.asset.symbol}.`);
      }
      const n = notes
        .filter((x) => x.status === "unspent" && x.amountWei >= want.amountWei)
        .sort((a, b) => (a.amountWei < b.amountWei ? -1 : 1))[0];
      if (!n) throw new Error("No single private note covers this charge.");
      n.status = "pending";
      lastSpent = n;
      return { secret: n.secret, amountWei: n.amountWei, path: await pool.pathOf(n.commitment) };
    },
    /** Keep the change note before anything is submitted: it is the rest of the balance. */
    keepChange(built: BuiltPayment) {
      const c = built.changeNote;
      lastChange = { secret: c.secret, amountWei: BigInt(c.amountWei), commitment: c.commitment, status: "pending" };
      if (lastChange.amountWei > 0n) notes.push(lastChange);
    },
    /** After a request: the spent note goes, the change becomes spendable (or the reservation is undone). */
    async settle() {
      if (!lastSpent) return;
      const landed = lastChange ? await pool.chain.isCommitmentSeen(lastChange.commitment) : false;
      if (landed) {
        notes.splice(notes.indexOf(lastSpent), 1);
        if (lastChange) lastChange.status = "unspent";
      } else {
        lastSpent.status = "unspent";
        if (lastChange) notes.splice(notes.indexOf(lastChange), 1);
      }
      lastSpent = lastChange = null;
    },
    balance: () => notes.filter((n) => n.status === "unspent").reduce((s, n) => s + n.amountWei, 0n),
    count: () => notes.filter((n) => n.status === "unspent").length,
  };
}

export type AgentWallet = ReturnType<typeof createAgentWallet>;

export function createAgent(o: { pool: MockPool; wallet: AgentWallet; prove: Prover; mode: "push" | "pull"; fetch: typeof fetch }) {
  return Mppx.create({
    polyfill: false,
    fetch: o.fetch,
    methods: [
      gloam({
        getNote: (want) => o.wallet.getNote(want),
        prove: o.prove,
        mode: o.mode,
        // push: the agent broadcasts its own transfer (its wallet, or the Gloam relay so its wallet never shows).
        submit: o.pool.submitter("agent"),
        waitForReceipt: o.pool.chain.waitForReceipt,
        // Never pay more than 0.05 per request, never in another token, never to a pool that is not Gloam's.
        policy: { maxAmountWei: parseUnits("0.05", o.pool.asset.decimals), currencies: [o.pool.asset.address] },
        beforeSubmit: (built) => o.wallet.keepChange(built),
      }),
    ],
  });
}
