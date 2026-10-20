import type { Metadata } from "next";
import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { DocsLayout } from "@/components/DocsLayout";
import { FlowDiagram } from "@/components/docs/FlowDiagram";

export const metadata: Metadata = {
  title: "What ships when",
  description:
    "Gloam product status, what is live on testnet, what is next, what we will not fake.",
};

export default function DocsProductPage() {
  return (
    <DocsLayout
      title="What ships when"
      lede="Status board for the product. Updated as features actually land."
      glance={[
        { label: "App", value: "gloam.trade/app" },
        { label: "Docs", value: "/docs" },
        { label: "Paper", value: "/whitepaper" },
        { label: "X", value: "@gloamtrade" },
      ]}
      quickLinks={[
        { href: "/app", label: "Open testnet" },
        { href: "/whitepaper", label: "Whitepaper" },
        { href: "https://x.com/gloamtrade", label: "@gloamtrade" },
      ]}
    >
      <h2>Where things live</h2>
      <ul>
        <li>
          <strong>Marketing</strong>, gloam.trade
        </li>
        <li>
          <strong>App</strong>, gloam.trade/app
        </li>
        <li>
          <strong>Docs</strong>, gloam.trade/docs
        </li>
        <li>
          <strong>Testnet guide</strong>, {" "}
          <Link href="/docs/testnet">gloam.trade/docs/testnet</Link>
        </li>
        <li>
          <strong>Whitepaper</strong>, gloam.trade/whitepaper
        </li>
      </ul>

      <h2>Status (honest)</h2>
      <FlowDiagram
        title="Ship board"
        steps={[
          {
            n: "●",
            title: "Public path",
            body: "Connect, portfolio, send ETH, send faucet stocks, markets.",
          },
          {
            n: "●",
            title: "Shield",
            body: "Deposit stablecoins (USDG on Robinhood Chain, OUSD and PathUSD on Tempo), ETH or Robinhood Chain stock tokens into the vault.",
          },
          {
            n: "●",
            title: "Private send",
            body: "Pay someone inside the vault. Share a receive tag or payment ticket (optional passphrase lock).",
          },
          {
            n: "●",
            title: "Cash out",
            body: "Withdraw to your open wallet with a real browser proof.",
          },
          {
            n: "●",
            title: "Stock tokens, privately",
            body: "Hold and send Robinhood Chain stock tokens (TSLA, AMZN, PLTR, NFLX, AMD on testnet) from your private balance today.",
          },
          {
            n: "●",
            title: "Vault trade adapter",
            body: "From vault: cash out → public DEX swap → re-shield. Hold private; swap edge still public.",
          },
          {
            n: "●",
            title: "Private payroll + relay",
            body: "Upload a list and pay everyone from your private balance. The Gloam relay keeps your wallet off the record.",
          },
          {
            n: "●",
            title: "Scheduled payroll + payment requests",
            body: "Save a pay list as a schedule with a cap per run; Gloam reminds you on payday and runs it in one click. Request links fill in what to pay you.",
          },
          {
            n: "●",
            title: "Proof of funds + proof of payment",
            body: "Two new circuits: prove you hold at least an amount, or that you were paid, for one named verifier, checked in the browser against the live vault.",
          },
          {
            n: "●",
            title: "Agent limits + transparency",
            body: "Agents spend only inside the owner's caps, payees and expiry. A public page shows what anyone can see about the vault.",
          },
          {
            n: "!",
            title: "Private trade (switched off)",
            body: "Built, and switched off on-chain while we build a new engine for private trading. Trading mixes many people's orders, so it needs its own design.",
          },
          {
            n: "○",
            title: "Mainnet path",
            body: "The multi-party key ceremony is done and the code was reviewed internally before launch. An external audit is planned.",
          },
          {
            n: "○",
            title: "Ethereum expansion",
            body: "Same private rails on Ethereum after RH testnet rails are solid.",
          },
        ]}
      />

      <h2>Rules we will not break</h2>
      <ul>
        <li>No fake “private success” screens</li>
        <li>No claims past what the contracts actually do</li>
        <li>Testnet until audits and production keys exist for real money</li>
      </ul>

      <p>
        Open the app: <AppLink href="/app">/app</AppLink> ·{" "}
        <Link href="/docs/production">Production gate</Link> ·{" "}
        <Link href="/docs/sealed-trade">Private trade</Link> ·{" "}
        <Link href="/docs/compare">How Gloam compares</Link>. Follow{" "}
        <a href="https://x.com/gloamtrade" target="_blank" rel="noreferrer">
          @gloamtrade
        </a>{" "}
        for release notes.
      </p>
    </DocsLayout>
  );
}
