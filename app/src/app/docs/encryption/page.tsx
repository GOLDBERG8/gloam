import type { Metadata } from "next";
import { AppLink } from "@/components/AppLink";
import { DocsLayout } from "@/components/DocsLayout";
import { FlowDiagram, PoolPicture } from "@/components/docs/FlowDiagram";
import { EncryptFlow } from "@/components/EncryptFlow";

export const metadata: Metadata = {
  title: "How shield works",
  description:
    "Simple explanation of Gloam shield and unshield, deposit, private note, proof, withdraw.",
};

export default function DocsEncryptionPage() {
  return (
    <DocsLayout
      title="How shield works"
      lede="No exam required. This is the deposit / note / withdraw loop in plain language."
      glance={[
        { label: "In", value: "Shield" },
        { label: "Move", value: "Private send" },
        { label: "Trade", value: "Private trade" },
        { label: "Out", value: "Cash out" },
      ]}
    >
      <h2>The short version</h2>
      <p>
        <strong>Shield</strong> = put money into Gloam’s vault.
        <br />
        <strong>Private send</strong> = pay someone while funds stay in the
        vault (share a payment tag).
        <br />
        <strong>Private trade</strong> = sell vault ETH for vault stock without
        a public DEX hop (built, and switched off for now).
        <br />
        <strong>Cash out</strong> = take it back to your open wallet with a
        proof that you own it.
      </p>
      <p>
        While it is in the vault, your normal wallet balance no longer shows
        that amount. The vault holds many people’s deposits together.
      </p>

      <PoolPicture />

      <FlowDiagram
        title="Step by step"
        steps={[
          {
            n: "1",
            title: "You start public",
            body: "Stablecoins or other tokens sit in your wallet. Explorers can show that balance.",
          },
          {
            n: "2",
            title: "You shield",
            body: "You send assets to the vault contract. A fingerprint of your deposit is written on-chain.",
          },
          {
            n: "3",
            title: "You keep a note",
            body: "Your browser stores a secret linked to that deposit. Clear site data and you lose the local copy (the on-chain leaf remains).",
          },
          {
            n: "4",
            title: "You private-send, trade, or cash out",
            body: "Private send splits a note into payment + change. Private trade (switched off for now) swaps inside the vault. Cash out builds a proof and pays your open wallet.",
          },
        ]}
      />

      <h2>Visual path</h2>
      <EncryptFlow />

      <h2>What the public still sees</h2>
      <ul>
        <li>That someone used the Gloam contract</li>
        <li>When money entered or left the vault (shield / cash out edges)</li>
        <li>That a private transfer or private trade happened, not who paid whom how much (and not exact size when max size privacy is on)</li>
        <li>Not (goal) your exact private bag while it stays inside</li>
      </ul>

      <h2>What we do not claim</h2>
      <p>
        Cash out is not invisible, leaving the vault is a public moment.
        Private send hides payment size and counterparty, not the fact that the
        vault was used. Private trade hides size (default min-out floor) but
        pair and caller remain public.
      </p>

      <p>
        Try it: <AppLink href="/app/vault?tab=shield">Shield</AppLink> →{" "}
        <AppLink href="/app/vault?tab=move">Move</AppLink> (private send) → cash
        out only when you need the open wallet.
      </p>
    </DocsLayout>
  );
}
