import type { Metadata } from "next";
import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";
import { mainnetPool, type MainnetChainId } from "@/lib/mainnet";
import { RH_MAINNET_TOKENS, TEMPO_MAINNET_TOKENS } from "@/lib/tokens";

export const metadata: Metadata = {
  title: "Networks",
  description:
    "Gloam runs one private core on two chains, Robinhood Chain and Tempo: mainnet with real money, and a testnet on each for free practice. Chain IDs, RPCs, pools, assets, beta limits, and the Tempo integration details.",
};

/** A mainnet pool address, or a placeholder until it is filled in on deploy day. */
function MainnetPoolAddress({ chainId }: { chainId: MainnetChainId }) {
  const p = mainnetPool(chainId);
  return p ? <code>{p.pool}</code> : <>Published at launch</>;
}

function MainnetDeployBlock({ chainId }: { chainId: MainnetChainId }) {
  const p = mainnetPool(chainId);
  return p ? <code>{p.deployBlock.toString()}</code> : <>Published at launch</>;
}

const MAINNET_POSEIDON_T3 = "0x1a32C2c2A77225EC2dD3BF7be1018819b1039Cb4";
const MAINNET_OWNER = "0x76b7E410a227c888aBD2Bdc24Ee32E094B0FD4D8";
const MAINNET_RELAYER = "0xb1E994586E62994648a0b866BF33F2EDd942512e";

export default function DocsNetworksPage() {
  return (
    <DocsLayout
      title="Networks"
      lede="One private core, two chains. Robinhood Chain and Tempo, each on mainnet with real money, and each with a testnet for free practice."
      glance={[
        { label: "Robinhood mainnet", value: "4663" },
        { label: "Tempo mainnet", value: "4217" },
        { label: "Robinhood testnet", value: "46630" },
        { label: "Tempo testnet", value: "42431" },
        { label: "Robinhood gas", value: "ETH" },
        { label: "Tempo gas", value: "Stablecoin" },
      ]}
    >
      <h2>Two chains, one shielded pool design</h2>
      <p>
        Gloam is not a chain. It is a shielded-pool contract plus verifiers,
        deployed to the chains where the money already moves. The same circuits,
        the same vault design, and the same SDK run on both networks. What
        differs is the asset each chain leads with: USDG and $GLOAM on Robinhood
        Chain, dollar stablecoins on Tempo. The app switches networks at runtime
        and points at the right pool for each.
      </p>

      <h2 id="mainnet">Mainnet</h2>
      <p>
        Gloam went live on Robinhood Chain and Tempo mainnet on 21 October 2026,
        13:00 UTC. This is real money and beta software. The mainnet pools take
        payments only (<code>ShieldPoolPayments</code>): shield, private send,
        cash out and proofs. Private trade is not part of them.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th />
              <th>Robinhood Chain</th>
              <th>Tempo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Chain ID</td>
              <td>
                <code>4663</code>
              </td>
              <td>
                <code>4217</code>
              </td>
            </tr>
            <tr>
              <td>RPC</td>
              <td>
                <code>https://rpc.mainnet.chain.robinhood.com</code>
              </td>
              <td>
                <code>https://rpc.tempo.xyz</code>
              </td>
            </tr>
            <tr>
              <td>Explorer</td>
              <td>
                <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">
                  robinhoodchain.blockscout.com
                </a>
              </td>
              <td>
                <a href="https://explore.tempo.xyz" target="_blank" rel="noreferrer">
                  explore.tempo.xyz
                </a>
              </td>
            </tr>
            <tr>
              <td>Pool</td>
              <td>
                <MainnetPoolAddress chainId={4663} />
              </td>
              <td>
                <MainnetPoolAddress chainId={4217} />
              </td>
            </tr>
            <tr>
              <td>Deploy block</td>
              <td>
                <MainnetDeployBlock chainId={4663} />
              </td>
              <td>
                <MainnetDeployBlock chainId={4217} />
              </td>
            </tr>
            <tr>
              <td>Gas</td>
              <td>ETH (gas only, not a pool asset)</td>
              <td>Paid in stablecoins</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Assets and beta limits</h3>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Chain</th>
              <th>Address</th>
              <th>Decimals</th>
            </tr>
          </thead>
          <tbody>
            {RH_MAINNET_TOKENS.map((t) => (
              <tr key={`rh-${t.address}`}>
                <td>{t.symbol === "GLOAM" ? "$GLOAM" : t.symbol}</td>
                <td>Robinhood Chain</td>
                <td>
                  <code>{t.address}</code>
                </td>
                <td>{t.decimals}</td>
              </tr>
            ))}
            {TEMPO_MAINNET_TOKENS.map((t) => (
              <tr key={`tempo-${t.address}`}>
                <td>{t.symbol}</td>
                <td>Tempo</td>
                <td>
                  <code>{t.address}</code>
                </td>
                <td>{t.decimals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul>
        <li>
          <strong>Beta deposit limits.</strong> Each stablecoin: 500 per deposit
          and 25,000 in total. $GLOAM: 25,000 per deposit and 250,000 in total.
          The app shows the room left before you sign.
        </li>
        <li>
          <strong>Never limited:</strong> private payments and cash outs.
        </li>
        <li>
          <strong>Changes are public.</strong> Raising a limit or adding an
          asset waits a public 3-day timelock. The owner can lower limits or
          close deposits at once, which never stops a withdrawal.
        </li>
        <li>
          <strong>Fees.</strong> Deposits and private payments are free. A cash
          out costs 0.25%, kept by the pool.
        </li>
      </ul>

      <h3>Keys and accounts</h3>
      <ul>
        <li>
          <strong>Proving keys</strong>, the final keys from the 13-contributor
          trusted setup (drand round 6561386, release{" "}
          <a
            href="https://github.com/cryptoduke01/gloam/releases/tag/ceremony-final"
            target="_blank"
            rel="noreferrer"
          >
            ceremony-final
          </a>
          ). Mainnet proofs must use them; the testnets keep the dev keys.
        </li>
        <li>
          <strong>PoseidonT3</strong> (both chains), <code>{MAINNET_POSEIDON_T3}</code>
        </li>
        <li>
          <strong>Owner and treasury</strong>, <code>{MAINNET_OWNER}</code>. One
          wallet at launch; a multisig is planned. It cannot withdraw pooled
          funds: there is no admin withdraw.
        </li>
        <li>
          <strong>Relayer</strong>, <code>{MAINNET_RELAYER}</code>. Run by the
          Gloam team. It only submits already-proven transactions and pays the
          gas; it cannot move or redirect money.
        </li>
      </ul>

      <h2>Robinhood Chain</h2>
      <p>
        An Arbitrum Orbit L2 built for financial services and real-world assets,
        and the surface where tokenized stocks and onchain culture already
        settle. Standard EVM tooling and Uniswap-class paths exist. Gloam adds
        the private layer next to them.
      </p>
      <ul>
        <li>
          <strong>Mainnet chain ID</strong>, 4663
        </li>
        <li>
          <strong>Mainnet RPC</strong>,{" "}
          <code>https://rpc.mainnet.chain.robinhood.com</code>
        </li>
        <li>
          <strong>Mainnet pool</strong>, <MainnetPoolAddress chainId={4663} />
        </li>
        <li>
          <strong>Mainnet assets</strong>, USDG and $GLOAM. Native ETH pays gas
          but is not a pool asset, and stock tokens are testnet only.
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
        Gloam is live on Tempo mainnet, and on the Moderato testnet for practice.
      </p>
      <ul>
        <li>
          <strong>Mainnet chain ID</strong>, 4217
        </li>
        <li>
          <strong>Mainnet RPC</strong>, <code>https://rpc.tempo.xyz</code>
        </li>
        <li>
          <strong>Mainnet explorer</strong>, <code>https://explore.tempo.xyz</code>
        </li>
        <li>
          <strong>Mainnet pool</strong>, <MainnetPoolAddress chainId={4217} />
        </li>
        <li>
          <strong>Mainnet assets</strong>, USDC.e, pathUSD, USDT0 and OUSD
          (TIP-20, 6 decimals)
        </li>
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
          <strong>Testnet explorer</strong>,{" "}
          <code>https://explore.testnet.tempo.xyz</code>
        </li>
        <li>
          <strong>Testnet sealed pool (hardened)</strong>,{" "}
          <code>0x841DC046Ea3CC842BA3A855731472c6Eb0F2d5eb</code>
        </li>
        <li>
          <strong>Testnet shieldable asset</strong>, PathUSD (6-decimal stablecoin),{" "}
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
          <strong>6-decimal accounting.</strong> Tempo stablecoins use 6
          decimals, not 18. Amounts, notes, and disclosures normalize decimals
          per asset. Do not assume 1e18.
        </li>
        <li>
          <strong>30M gas cap per transaction.</strong> Proof-verifying calls
          are heavy, so deploys and some calls run near the cap. Tune your gas
          estimate multiplier down (we deploy at ~1.12x) rather than letting an
          estimator overshoot the 30,000,000 limit.
        </li>
        <li>
          <strong>Testnet faucet is an RPC method.</strong> Fund a testnet
          address with the <code>tempo_fundAddress</code> RPC call rather than a
          web faucet. The in-app &quot;Get testnet funds&quot; link uses it.
        </li>
      </ul>

      <p>
        On Tempo the product is private stablecoin payments, for people and for
        agents: shield a stablecoin, pay and send to a receive tag without
        showing your size, prove a balance when you have to, and cash out to a
        public balance whenever you want it public. Tokenized-equity markets
        are a Robinhood Chain testnet feature and do not appear on Tempo.
      </p>

      <h2>Switching networks in the app</h2>
      <p>
        The network selector in the app header lists every Gloam network and
        marks each one Mainnet or Testnet. Mainnet is real money; a testnet
        shows test funds. The selector points the app at that chain&apos;s
        pool, explorer and, on a testnet, its faucet. The registry lives in one
        place (<code>networks.ts</code>) so the same shield, private send, cash
        out, and selective-disclosure flows run against whichever chain is
        active. Test funds never move to mainnet.
      </p>

      <h2>Honest status</h2>
      <p>
        Mainnet on both chains is beta software handling real money. It uses
        the final keys from the multi-party ceremony that closed on 17 October
        with 13 contributors, and beta deposit limits cap what the pools take.
        The code was reviewed internally before launch; that review finished on
        20 October with no Critical or High findings open. An external audit is
        planned, not done. The mainnet pools are new, so their anonymity set is
        thin at first. The testnets run on development keys with test funds, and
        stay open for practice. See the{" "}
        <Link href="/docs/production">production gate</Link> for what is done
        and what is still ahead.
      </p>
    </DocsLayout>
  );
}
