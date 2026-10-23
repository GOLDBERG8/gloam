import type { Metadata } from "next";
import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { DocsLayout } from "@/components/DocsLayout";
import { FlowDiagram, PoolPicture } from "@/components/docs/FlowDiagram";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Gloam docs: private money on public chains, on Robinhood Chain and Tempo, explained simply. Private balances, payments, payroll, on mainnet and on the free testnet.",
};

export default function DocsOverviewPage() {
  return (
    <DocsLayout
      title="Docs"
      lede="Private money on public chains, explained without the jargon wall. Start here."
    >
      <h2 id="what">What is Gloam?</h2>
      <p>
        Stablecoins are becoming how businesses and AI agents pay each other,
        and every one of those payments is public. Gloam makes them private,
        and lets the payer prove exactly what someone needs to see. Private by
        default, provable on demand.
      </p>
      <p>
        It runs on <strong>Tempo</strong> and <strong>Robinhood Chain</strong>{" "}
        mainnet, with real money, and on their testnets for free practice. You
        put money into a shared vault (“shield”), pay privately inside it, and
        cash out with a real proof. Proofs are made on your device, and nobody
        else holds a key. See{" "}
        <Link href="/docs/compare">how Gloam compares</Link>.
      </p>
      <p>
        Mainnet is <strong>beta software handling real money</strong>. It uses
        the final keys from a 13-contributor trusted setup, and beta deposit
        limits cap what goes in. The code was reviewed internally before
        launch; an external audit is planned. Deposits and private payments are
        free, and cashing out costs 0.25%. The testnets keep{" "}
        <strong>development proving keys</strong> and test funds with no real
        value. Details: <Link href="/docs/chain">Networks</Link>.
      </p>

      <PoolPicture title="One picture" />

      <h2 id="try">Try it (2 minutes)</h2>
      <p>
        Want to practice first? Use the free testnet:{" "}
        <Link href="/docs/testnet">
          <strong>Practice on testnet</strong>
        </Link>
        .
      </p>
      <ol>
        <li>
          Open <AppLink href="/app">/app</AppLink>, connect a wallet, and pick a
          network: Robinhood Chain or Tempo mainnet for real money, or a testnet
          to practice with test funds.
        </li>
        <li>
          <AppLink href="/app/vault?tab=shield">Shield</AppLink> a small amount.
        </li>
        <li>
          <AppLink href="/app/vault?tab=move">Move</AppLink> to pay a Gloam address or cash
          out. A proof made in your browser settles it, and the amount never
          shows.
        </li>
      </ol>

      <FlowDiagram
        title="What those buttons mean"
        steps={[
          {
            n: "1",
            title: "Shield",
            body: "Deposit into the Gloam vault. Your wallet balance goes down; the vault holds the asset.",
          },
          {
            n: "2",
            title: "Private send",
            body: "Send inside the vault to a Gloam address. The sender and amount stay sealed.",
          },
          {
            n: "3",
            title: "Cash out",
            body: "Move money back to a public balance with a real proof, made in your browser.",
          },
        ]}
      />

      <h2 id="works">What works today</h2>
      <ul>
        <li>Connect wallet, portfolio, markets</li>
        <li>
          Mainnet on Robinhood Chain and Tempo, with the final ceremony keys and
          beta deposit limits
        </li>
        <li>
          Send public balances (stablecoins and ETH, plus stock tokens on
          Robinhood Chain testnet)
        </li>
        <li>
          Shield into the vault: USDG and $GLOAM on Robinhood Chain mainnet;
          USDC.e, pathUSD, USDT0 and OUSD on Tempo mainnet; test ETH, stock
          tokens and stablecoins on the testnets
        </li>
        <li>
          Private send to a Gloam address, or by claim link with an optional
          passphrase
        </li>
        <li>Cash out with a real zero-knowledge proof</li>
        <li>
          <Link href="/docs/private-swaps">Private swaps</Link> on Robinhood
          Chain and Tempo mainnet: swap from your private balance, with who
          swapped kept private and the amounts public
        </li>
        <li>
          Proofs anyone can check at <Link href="/verify">/verify</Link>, in
          their own browser
        </li>
        <li>
          <Link href="/docs/proofs">Proof of funds and proof of payment</Link>:
          show you hold at least an amount, or that you were paid, without
          showing your balance
        </li>
        <li>
          <Link href="/docs/payroll">Private payroll</Link>: upload a list and
          pay everyone from your private balance, once or on a{" "}
          <Link href="/docs/payroll#schedules">schedule</Link> with a cap per run
        </li>
        <li>Payment requests: a link or QR that fills in what to pay you</li>
        <li>
          <Link href="/transparency">Transparency</Link>: what anyone can see
          about the vault, live from the chain
        </li>
        <li>
          <Link href="/docs/agents">Agent spending limits</Link> in the MCP
          server: caps per payment and per day, allowed payees, expiry
        </li>
        <li>The Gloam relay, which keeps your wallet off the record</li>
        <li>A backup of your private balance (with an optional passphrase) in Settings</li>
      </ul>

      <h2 id="not-yet">What does not work yet</h2>
      <ul>
        <li>
          Private swaps on the testnets, and swaps of stock tokens. Stock
          tokens can be held and sent privately on Robinhood Chain testnet.
          The old <Link href="/docs/sealed-trade">sealed trade</Link> is
          retired
        </li>
        <li>
          <Link href="/docs/data">On-chain price oracles</Link> (no Chainlink /
          Pyth / RedStone wired)
        </li>
        <li>
          <Link href="/docs/production">An external audit and a multisig owner</Link>{" "}
          (both planned)
        </li>
        <li>Ethereum expansion (roadmap)</li>
      </ul>

      <h2 id="read-next">Read next</h2>
      <ul>
        <li>
          <Link href="/docs/chain">Networks: mainnet and testnet</Link>
        </li>
        <li>
          <Link href="/docs/testnet">Practice on testnet</Link>
        </li>
        <li>
          <Link href="/docs/encryption">How shield works (simple)</Link>
        </li>
        <li>
          <Link href="/docs/product">What ships when</Link>
        </li>
        <li>
          <Link href="/docs/privacy-model">What stays private vs public</Link>
        </li>
        <li>
          <Link href="/docs/compare">How Gloam compares</Link>
        </li>
        <li>
          <Link href="/docs/production">Production gate</Link>
        </li>
        <li>
          <Link href="/docs/private-swaps">Private swaps</Link>
        </li>
        <li>
          <Link href="/docs/data">Prices, data &amp; oracles</Link>
        </li>
        <li>
          <Link href="/whitepaper">Whitepaper</Link>
        </li>
      </ul>
    </DocsLayout>
  );
}
