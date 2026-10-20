import type { Metadata } from "next";
import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";
import { FlowDiagram } from "@/components/docs/FlowDiagram";

export const metadata: Metadata = {
  title: "How Gloam compares",
  alternates: { canonical: "/docs/compare" },
  description:
    "Why a payment needs no key holder, and how Gloam compares with Zama, Arcium, Tempo Zones, Helius Privacy and Railgun: who can see your payments, what a breach exposes, and where each one wins.",
};

export default function DocsComparePage() {
  return (
    <DocsLayout
      title="How Gloam compares"
      lede="Privacy onchain splits into two jobs. Some apps share secrets between many people. A payment has one owner. Gloam does the second job, and that choice decides who can see your money."
      glance={[
        { label: "Who holds a key", value: "only you" },
        { label: "Proofs made", value: "on your device" },
        { label: "Networks", value: "Tempo · Robinhood Chain (testnet)" },
        { label: "New cryptography", value: "none, by design" },
      ]}
      quickLinks={[
        { href: "/docs/privacy-model", label: "What stays private" },
        { href: "/docs/proofs", label: "Proofs" },
        { href: "/docs/production", label: "Production gate" },
        { href: "/whitepaper", label: "Whitepaper" },
      ]}
    >
      <h2 id="two-jobs">Two jobs, two kinds of privacy</h2>
      <p>
        A sealed auction, a private order book or a lending pool has to work on
        many people&apos;s hidden data at once. Somebody has to do that work.
        So FHE networks like Zama and MPC networks like Arcium use a committee
        of nodes that hold the keys together.
      </p>
      <p>
        A payment is different. It has one owner. The owner can prove the
        payment is valid on their own device with a zero-knowledge proof, and
        nobody else ever holds a key. That is the job Gloam does.
      </p>

      <FlowDiagram
        title="Who holds the key"
        steps={[
          {
            n: "A",
            title: "Committee model",
            body: "Zama, Arcium, Tempo Zones. A committee or an operator holds the key, or sees inside.",
          },
          {
            n: "B",
            title: "Owner model",
            body: "Gloam. Your device makes the proof. Nobody else holds a key, including us.",
          },
        ]}
      />

      <h2 id="breach">What a breach exposes</h2>
      <p>
        If a committee or an operator is breached, everyone who used it can be
        exposed, past payments included. If one owner&apos;s device is
        breached, one person is exposed. That is the whole argument for doing
        payments the owner way.
      </p>
      <p>
        It also means Gloam never needs your secrets on a server. Proofs are
        made on your device, never on our servers.
      </p>

      <h2 id="not-new-cryptography">Not new cryptography</h2>
      <p>
        Gloam does not invent new maths. It uses the zero-knowledge proofs of
        the Zcash lineage: notes, nullifiers, a Merkle tree and Groth16 proofs.
        Then it builds the payments product on top, the way Stripe built on
        card networks. What is new is the product layer. See{" "}
        <Link href="/docs/privacy-model#whats-new">what is new and what is not</Link>.
      </p>

      <h2 id="table">Side by side</h2>
      <p>
        &quot;Not found&quot; means we did not find it in their public docs as
        of October 2026. It does not mean it cannot be built.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-[920px] [&_th]:whitespace-normal">
          <thead>
            <tr>
              <th>Product</th>
              <th>Who can see your payments</th>
              <th>If they are hacked</th>
              <th>Live on Tempo or Robinhood Chain</th>
              <th>Prove one fact to one person</th>
              <th>Private payroll</th>
              <th>Agent payments</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Gloam</strong>
              </td>
              <td>Only you</td>
              <td>One person is exposed</td>
              <td>Yes, both testnets</td>
              <td>Yes, a proof for one reader that expires</td>
              <td>Yes, with a payroll total proof</td>
              <td>Yes: x402, an MPP method, MCP</td>
            </tr>
            <tr>
              <td>Zama</td>
              <td>A 13-node committee shares one global key</td>
              <td>Everyone, past data included</td>
              <td>Not found</td>
              <td>Decryption rights for a value</td>
              <td>Not found</td>
              <td>Not found</td>
            </tr>
            <tr>
              <td>Arcium</td>
              <td>A node cluster, private while one node stays honest</td>
              <td>Everyone on that cluster, if every node falls</td>
              <td>Not found (Solana)</td>
              <td>Not found</td>
              <td>Not found</td>
              <td>Not found</td>
            </tr>
            <tr>
              <td>Tempo Zones</td>
              <td>The zone operator sees everything in the zone</td>
              <td>Everyone in the zone</td>
              <td>Tempo, limited preview</td>
              <td>Not found</td>
              <td>Not found</td>
              <td>Not found</td>
            </tr>
            <tr>
              <td>Helius Privacy</td>
              <td>Helius&apos;s server receives the full secret inputs, amounts included</td>
              <td>Whatever reached the server</td>
              <td>Not found (Solana devnet)</td>
              <td>Not found</td>
              <td>Not found</td>
              <td>Not found</td>
            </tr>
            <tr>
              <td>Railgun</td>
              <td>Only you</td>
              <td>One person is exposed</td>
              <td>Not found (Ethereum and L2s)</td>
              <td>Viewing keys that show your whole history</td>
              <td>Not found</td>
              <td>Not found</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="each">Gloam and each of them</h2>

      <h3>Zama</h3>
      <p>
        Zama uses fully homomorphic encryption. Tokens stay encrypted and a
        coprocessor network computes on them. A 13-node key management
        committee shares one global key. Zama has raised over $170M, including
        a token sale.
      </p>
      <p>
        <strong>Where they win:</strong> computing on shared data, like sealed
        auctions and lending. <strong>Where Gloam differs:</strong> a payment
        has one owner, so there is no committee and no global key.
      </p>

      <h3>Arcium</h3>
      <p>
        Arcium uses multi-party computation on Solana. Clusters of nodes compute
        on secret shares, and data stays private while at least one node in the
        cluster stays honest. Clusters are admitted by an authority.
      </p>
      <p>
        <strong>Where they win:</strong> private shared state on Solana.{" "}
        <strong>Where Gloam differs:</strong> no cluster to trust, and it runs on
        Tempo and Robinhood Chain.
      </p>

      <h3>Tempo Zones</h3>
      <p>
        Zones are operator-run private chains on Tempo. The operator sees
        everything inside its zone, and deposits and withdrawals are public.
        Zones are in a limited preview.
      </p>
      <p>
        <strong>Where they win:</strong> enterprises that want an operator in
        the loop. <strong>Where Gloam differs:</strong> self-custody with no
        operator, open to anyone a Zone does not serve.
      </p>

      <h3>Helius Privacy</h3>
      <p>
        Helius Privacy is on Solana devnet. Helius&apos;s server generates the
        proofs, so it receives the full secret inputs, amounts included.
      </p>
      <p>
        <strong>Where they win:</strong> speed on weak phones, and reach on
        Solana. <strong>Where Gloam differs:</strong> proofs are made on your
        device, never on our servers.
      </p>

      <h3>Railgun</h3>
      <p>
        Railgun is the closest to Gloam in design: client-side zero-knowledge
        proofs, on Ethereum and L2s. It holds about $113M and charges 0.25% in
        and out. Its viewing keys show your whole history to whoever holds
        them.
      </p>
      <p>
        <strong>Where they win:</strong> years live, a public multi-party
        ceremony, and external audits. <strong>Where Gloam differs:</strong>{" "}
        proofs for one reader that expire, payroll total proofs, agent payments,
        and Tempo and Robinhood Chain.
      </p>

      <h3>Others worth knowing</h3>
      <ul>
        <li>
          <strong>Payy</strong> ($6M seed) runs a private stablecoin wallet and
          a Visa card on its own ZK chain. Where they win: consumer users and a
          card today.
        </li>
        <li>
          <strong>Cloak</strong> is a client-side ZK pool with payroll, on
          Solana.
        </li>
      </ul>

      <h2 id="short-version">The short version</h2>
      <p>
        We found no other product on Tempo or Robinhood Chain that combines
        owner-only privacy, proofs for one reader, and payroll and agent rails.
      </p>

      <h2 id="behind">Where Gloam is behind</h2>
      <ul>
        <li>
          <strong>Testnet only, for now.</strong> Testnet keys come from a
          single-contributor dev ceremony. The multi-party ceremony for mainnet
          is done, with 13 contributors, and mainnet deploys its final keys.
        </li>
        <li>
          <strong>Internal audits only.</strong> Two rounds, with fixes
          deployed. An external audit comes before mainnet.
        </li>
        <li>
          <strong>Small crowd.</strong> The testnet anonymity set is small, so
          treat unlinkability as weak for now.
        </li>
        <li>
          <strong>Forwarded proofs.</strong> A reader can still pass a proof on.
          It will say who it was for and when it expired. A designated-verifier
          mode is next.
        </li>
        <li>
          <strong>Rule changes.</strong> There is no admin withdraw, and rule
          changes are timelocked: the owner can swap verifiers only after a
          3-day public delay.
        </li>
      </ul>
      <p>
        The full list is on the <Link href="/docs/production">production gate</Link>{" "}
        and in <Link href="/docs/privacy-model">what stays private</Link>.
      </p>
    </DocsLayout>
  );
}
