import type { Metadata } from "next";
import { DocsLayout } from "@/components/DocsLayout";

export const metadata: Metadata = {
  title: "Networks",
  description:
    "Gloam runs one private core on two chains: Robinhood Chain (tokenized equities) and Tempo (stablecoin payments). Chain IDs, RPCs, pools, and the Tempo integration details.",
};

export default function DocsNetworksPage() {
  return (
    <DocsLayout
      title="Networks"
      lede="One private core, two chains. Robinhood Chain for tokenized equities, Tempo for stablecoin payments."
      glance={[
        { label: "Robinhood testnet", value: "46630" },
        { label: "Tempo testnet", value: "42431" },
        { label: "Robinhood gas", value: "ETH" },
        { label: "Tempo gas", value: "Stablecoin" },
      ]}
    >
      <h2>Two chains, one shielded pool design</h2>
      <p>
        Gloam is not a chain. It is a shielded-pool contract plus verifiers,
        deployed to the chains where the markets already are. The same circuits,
        the same vault design, and the same SDK run on both networks. What
        differs is the asset each chain leads with: tokenized equities on
        Robinhood Chain, stablecoins on Tempo. The app switches networks at
        runtime and points at the right pool for each.
      </p>

      <h2>Robinhood Chain</h2>
      <p>
        An Arbitrum Orbit L2 built for financial services and real-world assets,
        and the surface where tokenized stocks and onchain culture already
        settle. Standard EVM tooling and Uniswap-class paths exist. Gloam adds
        the private layer where the equities are.
      </p>
      <ul>
        <li>
          <strong>Mainnet chain ID</strong>, 4663
        </li>
        <li>
          <strong>Testnet chain ID</strong>, 46630
        </li>
        <li>
          <strong>Native gas</strong>, ETH
        </li>
        <li>
          <strong>Testnet RPC</strong>,{" "}
          <code>https://rpc.testnet.chain.robinhood.com</code>
        </li>
        <li>
          <strong>Testnet vault (sealed pool)</strong>,{" "}
          <code>0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740</code>
        </li>
        <li>
          Official docs,{" "}
          <a
            href="https://docs.robinhood.com/chain/connecting/"
            target="_blank"
            rel="noreferrer"
          >
            docs.robinhood.com/chain
          </a>
        </li>
      </ul>

      <h2>Tempo</h2>
      <p>
        Tempo is a payments-first, EVM-compatible L1 (Reth) built around
        stablecoins, incubated by Stripe and Paradigm. It is the natural home
        for private payments: the chain is designed for moving money, and Gloam
        makes the amounts and balances private while settlement stays verifiable.
        Gloam is live on Tempo&apos;s Moderato testnet.
      </p>
      <ul>
        <li>
          <strong>Testnet name</strong>, Tempo Moderato
        </li>
        <li>
          <strong>Testnet chain ID</strong>, 42431
        </li>
        <li>
          <strong>Native currency</strong>, USD (gas is paid in a stablecoin,
          not ETH)
        </li>
        <li>
          <strong>Testnet RPC</strong>, <code>https://rpc.moderato.tempo.xyz</code>
        </li>
        <li>
          <strong>Explorer</strong>,{" "}
          <code>https://explore.testnet.tempo.xyz</code>
        </li>
        <li>
          <strong>Sealed pool (hardened)</strong>,{" "}
          <code>0x841DC046Ea3CC842BA3A855731472c6Eb0F2d5eb</code>
        </li>
        <li>
          <strong>Shieldable asset</strong>, PathUSD (6-decimal stablecoin),{" "}
          <code>0x20c0000000000000000000000000000000000000</code>
        </li>
      </ul>

      <h3>Integration notes (what is different from an ETH chain)</h3>
      <p>
        Tempo is stablecoin-native, so the vault integration differs from an
        ETH-gas chain in a few concrete ways. If you build against Tempo, these
        are the things that bite:
      </p>
      <ul>
        <li>
          <strong>No native value transfers.</strong> Tempo does not carry value
          in <code>msg.value</code>. You shield an ERC-20 stablecoin, not a
          native coin, so the shield path always moves a token with{" "}
          <code>transferFrom</code>, never a payable call.
        </li>
        <li>
          <strong>6-decimal accounting.</strong> PathUSD uses 6 decimals, not
          18. Amounts, notes, and disclosures normalize decimals per asset. Do
          not assume 1e18.
        </li>
        <li>
          <strong>30M gas cap per transaction.</strong> Proof-verifying calls
          are heavy, so deploys and some calls run near the cap. Tune your gas
          estimate multiplier down (we deploy at ~1.12x) rather than letting an
          estimator overshoot the 30,000,000 limit.
        </li>
        <li>
          <strong>Faucet is an RPC method.</strong> Fund a testnet address with
          the <code>tempo_fundAddress</code> RPC call rather than a web faucet.
          The in-app &quot;Get testnet funds&quot; link uses it.
        </li>
      </ul>

      <p>
        On Tempo the product is private stablecoin payments, for people and for
        agents: shield PathUSD, pay and send to a receive tag without showing
        your size, prove a balance when you have to, and cash out to a public
        balance whenever you want it public. Tokenized-equity markets are a
        Robinhood Chain product and do not appear on Tempo.
      </p>

      <h2>Switching networks in the app</h2>
      <p>
        The network selector in the app header lists every Gloam network and
        points the app at that chain&apos;s pool, faucet, and explorer. Both
        networks are testnet today. The registry lives in one place
        (<code>networks.ts</code>) so the same shield, private send, cash out,
        and selective-disclosure flows run against whichever chain is active.
      </p>

      <h2>Honest status</h2>
      <p>
        Both deployments are testnet with play money, and testnet proving keys
        come from a development ceremony. The production multi-party ceremony
        closed on 17 October with 13 contributors, and mainnet on both chains
        uses its keys. An external audit is the remaining gate. The contracts
        were self-reviewed across two multi-agent audit passes, the findings
        fixed, and the hardened pools redeployed on both chains.
      </p>
    </DocsLayout>
  );
}
