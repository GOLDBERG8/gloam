import type { Metadata } from "next";
import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { DocsLayout } from "@/components/DocsLayout";

export const metadata: Metadata = {
  title: "Prices, data & oracles",
  description:
    "Where Gloam gets prices from today, what is not an oracle, and what ships next.",
};

export default function DocsDataPage() {
  return (
    <DocsLayout
      title="Prices, data & oracles"
      lede="Straight answer: Gloam does not use an on-chain price oracle yet. Marks in the app are display data. Swaps that hit a DEX use the pool’s own spot price."
      glance={[
        { label: "Display marks", value: "Yahoo / CG" },
        { label: "DEX price", value: "Pool spot" },
        { label: "On-chain oracle", value: "Not yet" },
        { label: "Fake fills", value: "Never" },
      ]}
    >
      <h2 id="oracle">Do you use Chainlink / Pyth / RedStone?</h2>
      <p>
        <strong>No.</strong> Nothing in the contracts reads those feeds today.
        If someone asks on a call, that is the honest one-liner.
      </p>

      <h2 id="display">What prices you see in the app</h2>
      <ul>
        <li>
          <strong>Stocks</strong>, Yahoo Finance chart API for the mark and
          sparkline (server-side). If Yahoo fails, the app falls back to a
          static catalog number.
        </li>
        <li>
          <strong>ETH</strong>, CoinGecko simple price + 30-day chart for USD
          conversion and portfolio.
        </li>
        <li>
          <strong>Memes</strong>, DexScreener discovery is not switched on in
          the app.
        </li>
      </ul>
      <p>
        These are <strong>display marks only</strong>. They are not binding
        settlement prices on Robinhood Chain.
      </p>

      <h2 id="execution">What sets execution price</h2>
      <ul>
        <li>
          <strong>Public / adapter swaps</strong>, Uniswap-style router{" "}
          <code>getAmountsOut</code> on the live AMM pool (spot price in that
          pool).
        </li>
        <li>
          <strong>Private swaps</strong>, the pool&apos;s own price. On
          Robinhood Chain the app quotes the allowed Uniswap v4 pools with the
          v4 quoter; on Tempo it asks Tempo&apos;s stablecoin exchange. The swap
          then asks for a little less than that quote (0.5% on Robinhood Chain,
          0.1% on Tempo) and receives exactly that amount, or reverts. See{" "}
          <Link href="/docs/private-swaps#costs">what a swap costs</Link>.
        </li>
        <li>
          <strong>Sealed trade (retired)</strong>, used public{" "}
          <code>rateIn</code> / <code>rateOut</code> from coarsened display
          marks. It stays off.
        </li>
      </ul>

      <h2 id="next">Our rule on oracles</h2>
      <p>
        We will not claim oracle security until a feed is on-chain and checked.
        Until then, a swap&apos;s price is the pool&apos;s own price.
      </p>

      <h2 id="activity">Balances and history</h2>
      <ul>
        <li>
          <strong>Wallet balances</strong>, on-chain (viem / wallet).
        </li>
        <li>
          <strong>Vault notes</strong>, local secrets + on-chain tree; backup in
          Settings.
        </li>
        <li>
          <strong>Public activity</strong>, explorer / RPC logs for open
          transfers.
        </li>
      </ul>

      <h2 id="testnet-eth">Testnet ETH</h2>
      <p>
        Official faucet:{" "}
        <a
          href="https://faucet.testnet.chain.robinhood.com/"
          target="_blank"
          rel="noreferrer"
        >
          faucet.testnet.chain.robinhood.com
        </a>
        . Also linked from <AppLink href="/app/settings">Settings</AppLink>.
      </p>

      <p>
        Related:{" "}
        <Link href="/docs/private-swaps">Private swaps</Link> ·{" "}
        <Link href="/docs/production">Production gate</Link> ·{" "}
        <Link href="/docs/product">What ships when</Link>.
      </p>
    </DocsLayout>
  );
}
