import type { Metadata } from "next";
import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";
import { FlowDiagram } from "@/components/docs/FlowDiagram";

export const metadata: Metadata = {
  title: "Production gate",
  description:
    "What must be true before Gloam leaves testnet, ceremony keys, audit, ops.",
};

export default function DocsProductionPage() {
  return (
    <DocsLayout
      title="Production gate"
      lede="Testnet is live. Mainnet and real money wait on this checklist, we will not skip it."
      glance={[
        { label: "Today", value: "Testnet + dev keys" },
        { label: "Ceremony", value: "Done, 13 people" },
        { label: "Audit", value: "Required" },
        { label: "Mainnet", value: "Blocked" },
      ]}
    >
      <h2>Why this page exists</h2>
      <p>
        The app proves shield, unshield, and private send in the browser. That is
        real cryptography. Testnet still runs on development keys, which are{" "}
        <strong>not</strong> production-safe. The production trusted setup is
        done (see the <a href="https://github.com/cryptoduke01/gloam/releases/tag/ceremony-final">transcript</a>), and its keys go
        in with mainnet.
      </p>

      <FlowDiagram
        title="Gate order"
        steps={[
          {
            n: "1",
            title: "Production ceremony (done)",
            body: "Done 17 October: the public Hermez Powers of Tau, then 13 contributions to the six mainnet circuits, sealed with drand round 6561386. Transcript public. Next: the app's zkeys and the verifiers switch to these keys for mainnet.",
          },
          {
            n: "2",
            title: "Independent review",
            body: "Contracts + circuits reviewed. Fix blockers. No “audit pending” mainnet.",
          },
          {
            n: "3",
            title: "Ops + incident plan",
            body: "Owner keys, pause/upgrade policy (or immutability choice), monitoring, disclosure channel.",
          },
          {
            n: "4",
            title: "Mainnet deploy",
            body: "New pool + verifiers on Robinhood mainnet. App points at production artifacts only.",
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

      <h2>What is already hardened on testnet</h2>
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

      <h2>What is still open product-wise</h2>
      <ul>
        <li>
          <strong>Re-enable sealed swaps</strong> after the H1 solvency fix (they
          are disabled on-chain today)
        </li>
        <li>
          <strong>Stronger key custody.</strong> Notes and receive keys are encrypted at rest, but
          the key is device-bound; a wallet-bound or passphrase key is a mainnet
          consideration
        </li>
        <li>Stronger public-input privacy (rates / pair strategies)</li>
        <li>Anonymity set growth (more users → better privacy)</li>
        <li>Mainnet only after this gate</li>
      </ul>

      <p>
        Security policy: <Link href="/disclosures">Disclosures</Link> · repo{" "}
        <code>SECURITY.md</code>. Product status:{" "}
        <Link href="/docs/product">What ships when</Link>.
      </p>
    </DocsLayout>
  );
}
