import type { Metadata } from "next";
import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { DocsLayout } from "@/components/DocsLayout";
import { FlowDiagram } from "@/components/docs/FlowDiagram";

export const metadata: Metadata = {
  title: "What ships when",
  description:
    "Gloam product status: what is live on mainnet and testnet, what is next, what we will not fake.",
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
        { href: "/app", label: "Open the app" },
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
          <strong>Networks</strong>, {" "}
          <Link href="/docs/chain">gloam.trade/docs/chain</Link>
        </li>
        <li>
          <strong>Practice on testnet</strong>, {" "}
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
            title: "Mainnet",
            body: "Live on Robinhood Chain and Tempo since 21 October 2026, 13:00 UTC, on the final ceremony keys and under beta deposit limits. Deposits and private payments are free; a cash out costs 0.25%.",
          },
          {
            n: "●",
            title: "Public path",
            body: "Connect, portfolio, send stablecoins and ETH. Faucet stocks and markets on testnet.",
          },
          {
            n: "●",
            title: "Shield",
            body: "Mainnet: USDG and $GLOAM on Robinhood Chain; USDC.e, pathUSD, USDT0 and OUSD on Tempo, under beta deposit limits. Testnet: also test ETH and Robinhood Chain stock tokens.",
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
            title: "Private swaps",
            body: "Mainnet on Robinhood Chain (USDG and $GLOAM) and Tempo (its stablecoins). Swap from your private balance in one relayed transaction. Who swapped stays private; the amounts are public.",
          },
          {
            n: "●",
            title: "Vault trade adapter (testnet)",
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
            title: "Sealed trade (retired)",
            body: "The first private trade design stays off on every network. The mainnet vaults have no sealed swap code. Private swaps replaced it.",
          },
          {
            n: "○",
            title: "External audit + multisig",
            body: "Reviewed internally before launch, with no Critical or High findings open on 20 October. An external audit is planned, and the owner moves from one wallet to a multisig.",
          },
          {
            n: "○",
            title: "Ethereum expansion",
            body: "Same private rails on Ethereum once the mainnet rails are solid.",
          },
        ]}
      />

      <h2>Rules we will not break</h2>
      <ul>
        <li>No fake “private success” screens</li>
        <li>No claims past what the contracts actually do</li>
        <li>
          Real money only on the final ceremony keys, under beta limits, and
          with what is still ahead said plainly
        </li>
      </ul>

      <p>
        Open the app: <AppLink href="/app">/app</AppLink> ·{" "}
        <Link href="/docs/production">Production gate</Link> ·{" "}
        <Link href="/docs/private-swaps">Private swaps</Link> ·{" "}
        <Link href="/docs/compare">How Gloam compares</Link>. Follow{" "}
        <a href="https://x.com/gloamtrade" target="_blank" rel="noreferrer">
          @gloamtrade
        </a>{" "}
        for release notes.
      </p>
    </DocsLayout>
  );
}
