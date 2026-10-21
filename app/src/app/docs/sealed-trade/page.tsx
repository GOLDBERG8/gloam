import type { Metadata } from "next";
import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { DocsLayout } from "@/components/DocsLayout";
import { FlowDiagram } from "@/components/docs/FlowDiagram";

export const metadata: Metadata = {
  title: "Private trade",
  description:
    "What private trade means on Gloam, why it is off on mainnet and switched off on testnet while we build a new engine for it, and how stock tokens can already be held and sent privately on testnet.",
};

export default function DocsSealedTradePage() {
  return (
    <DocsLayout
      title="Private trade"
      lede="Trade one asset for another from your private balance, with your size kept private. It is not live anywhere: the mainnet pools take payments only, and on testnet the built version is switched off while we build a new engine for private trading. Stock tokens can already be held and sent privately on testnet."
      glance={[
        { label: "Mainnet", value: "Off, payments only" },
        { label: "Testnet", value: "Built, switched off" },
        { label: "Next", value: "New engine underway" },
        { label: "Fake fills", value: "Never" },
      ]}
    >
      <h2>Why it is switched off</h2>
      <p>
        A payment has one owner, so the owner can prove it alone. A trade is
        different: it mixes many people&apos;s orders against shared
        liquidity. That needs its own design, so we are building a new engine
        for private trading instead of stretching the payment one.
      </p>
      <p>
        The first version showed why. A sealed swap spends an{" "}
        <code>assetIn</code> note and mints an <code>assetOut</code> note with
        both amounts private, but no tokens move, so the pool ends up owing{" "}
        <code>assetOut</code> it does not physically hold (audit H1). Rather
        than ship an insolvent swap or reveal your size to fix the accounting,
        the on-chain verifier on the testnet pools is set to zero and the swap
        is off. Turning it on again there goes through the 3-day timelock.
        Shield, private send and cash out are live and solvent in the meantime.
      </p>
      <p>
        <strong>On mainnet there is nothing to switch on.</strong> The mainnet
        pools (<code>ShieldPoolPayments</code>) take payments only and have no
        sealed swap at all. Private trading comes to mainnet only with the new
        engine.
      </p>

      <h2 id="stock-tokens">Stock tokens today</h2>
      <p>
        On Robinhood Chain testnet you can already{" "}
        <AppLink href="/app/vault?tab=shield">shield</AppLink> stock tokens (TSLA, AMZN, PLTR,
        NFLX and AMD on testnet), hold them privately, and{" "}
        <AppLink href="/app/vault?tab=move">send them privately</AppLink>. Trading them
        privately is the part that waits for the new engine. Stock tokens are
        not on mainnet.
      </p>

      <h2>How the built version works (switched off)</h2>
      <FlowDiagram
        title="Private trade (sealed path)"
        steps={[
          {
            n: "1",
            title: "Pick direction + vault note",
            body: "Buy (ETH → stock) or sell (stock → ETH). Spend a note you already hold in the vault.",
          },
          {
            n: "2",
            title: "Prove the trade",
            body: "Browser builds a sealed-swap proof. Size stays private; the chain only sees a vault proof.",
          },
          {
            n: "3",
            title: "Settle in vault",
            body: "You receive the out asset as a new vault note, plus change. No public DEX hop.",
          },
        ]}
      />
      <p>
        Testnet rates use <strong>coarsened display marks</strong> (Yahoo /
        CoinGecko for the UI), not an on-chain oracle. If marks fail, 1:1
        fallback. Dev ceremony keys only.
      </p>
      <p>
        <strong>Size privacy (default on when enabled):</strong> the public{" "}
        <code>amountOutMin</code> is a 1-wei floor, not your real output (an
        earlier build leaked size by setting min-out to the exact amount; the
        sealed path fixes that). Rates and asset pair are public. Cash out
        publishes amount. See{" "}
        <Link href="/docs/privacy-model">privacy model</Link> ·{" "}
        <Link href="/docs/production">production gate</Link>.
      </p>

      <h2>Vault trade adapter (fallback)</h2>
      <FlowDiagram
        title="From vault (public swap step)"
        steps={[
          {
            n: "1",
            title: "Cash out",
            body: "Unshield a vault note to your open wallet (public edge).",
          },
          {
            n: "2",
            title: "Swap",
            body: "Public DEX swap. Size and pair are visible on the explorer.",
          },
          {
            n: "3",
            title: "Re-shield",
            body: "Proceeds go back into the vault. Hold is private again.",
          },
        ]}
      />
      <p>
        Useful on thin books. <strong>Not</strong> sealed trade: the swap edge
        still leaks size. The product shows both paths honestly.
      </p>

      <h2>What “sealed” means</h2>
      <ul>
        <li>
          Public observers do not get your exact size as a free signal (with max
          size privacy on)
        </li>
        <li>Settlement still ends on-chain (we do not claim invisibility)</li>
        <li>No theatrical “private success” without a real proof</li>
        <li>
          Explorer shows <code>sealedSwap</code> + pair, not a Uniswap fill
        </li>
      </ul>

      <h2>What ships next</h2>
      <ol>
        <li>
          <strong>A new engine for private trading</strong>, built for many
          people&apos;s orders, that keeps size private and the pool solvent.
          It is underway. Notes on the solvency side are in{" "}
          <code>contracts/audit/H1-CONFIDENTIAL-SWAP-DESIGN.md</code>.
        </li>
        <li>
          <strong>On-chain rates</strong>, replace display-mark rates with
          oracle-bound or pool-bound pricing (Pyth / AMM). Full write-up:{" "}
          <Link href="/docs/data">Prices &amp; oracles</Link>.
        </li>
        <li>
          <strong>Vault inventory</strong>, seed faucet stocks so cash-out after
          a sealed trade does not fail for empty <code>deposited</code>.
        </li>
        <li>
          <strong>Production keys for trading</strong>. The 13-contributor
          ceremony covered the payment and proof circuits that mainnet uses, not
          the trading circuit, so a trading engine needs multi-party keys of its
          own before it touches real money.
        </li>
        <li>
          <strong>Ethereum expansion</strong>, same private rails where the
          largest onchain audience already sits.
        </li>
        <li>
          <strong>Deeper liquidity design</strong>, intent batching or
          vault-native pool when books are thin.
        </li>
      </ol>
      <p>
        Each step keeps the same rule: no fake private fills. See{" "}
        <Link href="/docs/production">Production gate</Link>.
      </p>

      <h2>What we will not do</h2>
      <ul>
        <li>Hide a public swap behind a “private” button</li>
        <li>Claim production readiness on dev proving keys</li>
        <li>Promise dark-pool guarantees on thin testnet liquidity</li>
      </ul>

      <h2>Repo pointers</h2>
      <ul>
        <li>
          Engineering design: <code>contracts/SEALED_TRADE.md</code>
        </li>
        <li>
          Status helper: <code>app/src/lib/sealedTrade.ts</code> (
          <code>sealedTradeReady() === true</code> when artifacts ship; panel
          still checks the on-chain verifier)
        </li>
        <li>
          UI: <code>app/src/components/app/SealedTradePanel.tsx</code>
        </li>
        <li>
          Production keys gate:{" "}
          <Link href="/docs/production">/docs/production</Link>
        </li>
      </ul>

      <p>
        Private trade is off on mainnet and switched off on-chain on testnet,
        so the trade panel shows it as disabled until the new engine is ready. Available today: the{" "}
        <AppLink href="/app/vault?tab=trade&path=vault">from-vault adapter</AppLink> (honest,
        not sealed), and <AppLink href="/app/vault?tab=move">Move</AppLink> to hold and send
        privately.
      </p>
    </DocsLayout>
  );
}
