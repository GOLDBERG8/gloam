import type { Metadata } from "next";
import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";
import { FlowDiagram } from "@/components/docs/FlowDiagram";

export const metadata: Metadata = {
  title: "Production gate",
  description:
    "What was in place before Gloam took real money on mainnet, and what is still ahead: final ceremony keys, beta limits, timelock, internal review, external audit, multisig.",
};

export default function DocsProductionPage() {
  return (
    <DocsLayout
      title="Production gate"
      lede="What mainnet cleared before real money went in, and what is still ahead."
      glance={[
        { label: "Mainnet", value: "Live since 21 Oct, 13:00 UTC" },
        { label: "Keys", value: "Final, 13 contributors" },
        { label: "Review", value: "Internal; external planned" },
        { label: "Testnet", value: "Dev keys, test funds" },
      ]}
    >
      <h2>Why this page exists</h2>
      <p>
        Mainnet is beta software handling real money, so we keep a plain list of
        what had to be true before it opened, what is in place now, and what is
        not done yet. The app proves shield, unshield, and private send in the
        browser, and that is real cryptography. On mainnet the proofs use the
        final keys from the production trusted setup (see the{" "}
        <a href="https://github.com/cryptoduke01/gloam/releases/tag/ceremony-final">transcript</a>).
        The testnets keep development keys, which are{" "}
        <strong>not</strong> safe for real money, so they stay the free practice
        network with test funds.
      </p>

      <FlowDiagram
        title="Gate order"
        steps={[
          {
            n: "1",
            title: "Production ceremony (done)",
            body: "Done 17 October: the public Hermez Powers of Tau, then 13 contributions to the six mainnet circuits, sealed with drand round 6561386. Transcript public. The mainnet verifiers and the app's mainnet proofs use these keys.",
          },
          {
            n: "2",
            title: "Internal review (done)",
            body: "Contracts and circuits reviewed internally before launch. The review finished on 20 October with no Critical or High findings open. An external audit is planned, not done.",
          },
          {
            n: "3",
            title: "Limits and timelock (in place)",
            body: "Beta deposit limits cap what the pools take. Raising a limit, adding an asset or changing a verifier waits a public 3-day timelock. The owner can lower limits or close deposits at once.",
          },
          {
            n: "4",
            title: "Mainnet deploy (done)",
            body: "New ShieldPoolPayments pools on Robinhood Chain and Tempo mainnet: payments only, no sealed swap. The app proves with the final keys there.",
          },
          {
            n: "5",
            title: "Private swap routers (deployed)",
            body: "One router per mainnet, with no owner, no admin and no upgrade. They use only the vault's normal release and deposit calls, so the vault did not change. Reviewed internally before deploy, not externally audited.",
          },
        ]}
      />

      <h2>Ceremony checklist (keys)</h2>
      <ul>
        <li>Done: phase 1 is the public Hermez Powers of Tau (54 contributors)</li>
        <li>
          Done: phase 2, 13 contributions to shield, unshield, transfer,
          solvency, receipt and payroll_total, each round a public release
        </li>
        <li>
          Done: the final keys and their Solidity verifiers, exported byte for byte
          (<code>contracts/src/verifiers/final</code>), same public inputs layout v2
        </li>
        <li>
          Done: their SHA-256 fingerprints are pinned, and each network proves with its own
          set: dev keys on testnet, the final keys on mainnet
        </li>
        <li>
          Done: the mainnet deploy refuses to create a pool unless its verifiers accept
          proofs made with the final keys and reject proofs made with the dev keys
        </li>
        <li>Destroy or never re-use toxic waste from the ceremony</li>
      </ul>

      <h2>Mainnet at launch</h2>
      <ul>
        <li>
          <strong>Pools.</strong> <code>ShieldPoolPayments</code> on Robinhood
          Chain (4663) and Tempo (4217). Addresses and assets are on{" "}
          <Link href="/docs/chain#mainnet">Networks</Link>.
        </li>
        <li>
          <strong>Beta deposit limits.</strong> Each stablecoin: 500 per deposit
          and 25,000 in total. $GLOAM: 25,000 per deposit and 250,000 in total.
          Cash outs and private payments are never limited.
        </li>
        <li>
          <strong>No admin withdraw.</strong> No function lets the team take
          pooled funds. Notes leave only through an unshield proof.
        </li>
        <li>
          <strong>Fees.</strong> Deposits and private payments are free. A cash
          out costs 0.25%. Half of Gloam&apos;s fees buy back $GLOAM; half of
          that is burned and half goes to the treasury.
        </li>
      </ul>

      <h2>What was hardened before mainnet</h2>
      <ul>
        <li>Real on-chain verifiers (no always-true mock on the funded pool)</li>
        <li>Browser prove path with artifact hash checks</li>
        <li>Private send does not keep the payment note on the sender</li>
        <li>Hardened pool: a bound shield proof and 128-bit amount range checks (audit C1/C2)</li>
        <li>Two-step ownership and a one-way shield-verifier set (audit M-4)</li>
        <li>
          Note secrets and receive keys encrypted at rest (AES-GCM under an
          IndexedDB device key, or that key wrapped by a passkey, audit M-1)
        </li>
        <li>
          Claimed payments secured on claim: moved into a fresh note only the
          payee knows, so the payer cannot spend them back
        </li>
      </ul>

      <h2>What is still ahead</h2>
      <ul>
        <li>
          <strong>External audit.</strong> Planned, not done. Until then the
          beta limits cap how much the pools can hold.
        </li>
        <li>
          <strong>Multisig owner.</strong> At launch one wallet is owner and
          treasury (<code>0x76b7E410a227c888aBD2Bdc24Ee32E094B0FD4D8</code>). A
          multisig is planned.
        </li>
        <li>
          <strong>Relayer.</strong> The Gloam team runs it at launch. It only
          submits already-proven transactions and pays gas; it cannot move or
          redirect money. If it is down, you can send from your own wallet.
        </li>
        <li>
          <strong>Anonymity set.</strong> The mainnet pools are new, so the
          crowd of notes to hide among is thin at first. It grows with use.
        </li>
        <li>
          <strong>Swap amounts.</strong> A{" "}
          <Link href="/docs/private-swaps">private swap</Link> hides who
          swapped, not the tokens or the amounts. The old sealed trade, which
          tried to hide the size too, is retired and stays off
        </li>
        <li>
          <strong>Stronger key custody.</strong> Notes and receive keys are encrypted at rest, but
          the key is device-bound; a wallet-bound or passphrase key is still open
        </li>
      </ul>

      <p>
        Security policy: <Link href="/disclosures">Disclosures</Link> · repo{" "}
        <code>SECURITY.md</code>. Product status:{" "}
        <Link href="/docs/product">What ships when</Link>.
      </p>
    </DocsLayout>
  );
}
