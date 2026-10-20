import type { Metadata } from "next";
import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";

export const metadata: Metadata = {
  title: "SDK",
  description:
    "@gloamtrade/sdk: add private balances, private payments, and selective disclosure to any Robinhood Chain app or agent. The privacy layer as a package.",
};

export default function DocsSdkPage() {
  return (
    <DocsLayout
      title="SDK"
      lede="The privacy layer for Robinhood Chain, as a package. Give any app or agent shielded balances, private payments, and selective disclosure, without building a proving stack from scratch."
      glance={[
        { label: "Package", value: "@gloamtrade/sdk" },
        { label: "Runtime", value: "browser + node" },
        { label: "Chain", value: "RH testnet 46630" },
        { label: "Proofs", value: "Groth16 + Poseidon" },
      ]}
      quickLinks={[
        { href: "/docs/sdk/disclosure", label: "Selective disclosure" },
        { href: "/docs/agents", label: "Build a private agent" },
        { href: "/docs/encryption", label: "How shield works" },
        { href: "/docs/privacy-model", label: "Privacy model" },
      ]}
    >
      <h2>What Gloam gives your app</h2>
      <p>
        Robinhood Chain is public: every balance, size, and move is visible.
        Gloam is the shielded chamber on top of it, and <code>@gloamtrade/sdk</code>{" "}
        is that chamber as a dependency. The Gloam vault app is the reference
        implementation, not a special case: the same core runs in your app.
      </p>
      <ul>
        <li>
          <strong>Shielded balances.</strong> Deposit ETH or tokenized stocks
          into a private balance only the holder can see or spend.
        </li>
        <li>
          <strong>Private payments.</strong> Send inside the vault to a receive
          tag, with on-chain encrypted discovery.
        </li>
        <li>
          <strong>Selective disclosure.</strong> Let a holder prove one balance
          to a chosen party, such as an auditor or a counterparty, revealing
          nothing else. See <Link href="/docs/sdk/disclosure">the guide</Link>.
        </li>
        <li>
          <strong>Cash out.</strong> Unshield to a public balance with a real
          browser- or node-generated Groth16 proof.
        </li>
      </ul>

      <h2>Install</h2>
      <p>
        The SDK ships TypeScript source, consumed through your bundler (Next
        <code>transpilePackages</code>, Vite, tsx), the same way the reference
        app uses it. <code>snarkjs</code> is an optional peer, needed only when
        you generate proofs (shield, unshield, disclosure).
      </p>
      <pre>
        <code>{`npm install @gloamtrade/sdk viem
npm install snarkjs   # optional peer, for proving`}</code>
      </pre>

      <h2>The model</h2>
      <p>
        Gloam is a shielded pool. A private balance is a <strong>note</strong>:
      </p>
      <pre>
        <code>{`commitment = Poseidon(secret, amount, asset)
nullifier  = Poseidon(secret, commitment)`}</code>
      </pre>
      <p>
        Shielding inserts the <code>commitment</code> as a leaf in a depth-20
        incremental Merkle tree; the <code>secret</code> is the only spend
        authority and never leaves the client. Spending (send, cash out, trade)
        proves in zero knowledge that you know the secret for a commitment in the
        tree, and publishes the <code>nullifier</code> so it cannot be spent
        twice, without revealing which note. The chain verifies a Groth16 proof,
        never your identity or size. Nothing is a mock; if a path cannot be
        private, it waits.
      </p>

      <h2>Quickstart: shield privately</h2>
      <p>
        The hardened pool enforces a proof at deposit (audit C1), so plain{" "}
        <code>shield()</code> reverts. <code>buildShieldBoundIntent</code> mints
        the note <em>and</em> generates the shield proof; you sign the resolved
        call.
      </p>
      <pre>
        <code>{`import { buildShieldBoundIntent, artifactProver } from "@gloamtrade/sdk";
import { parseEther } from "viem";

const intent = await buildShieldBoundIntent({
  amountWei: parseEther("0.001"),
  // file paths (node) or URLs (browser) to the shield circuit artifacts
  prover: artifactProver({ wasm: "shield.wasm", zkey: "shield_final.zkey" }),
});

// intent.exec is a ready shieldBound(asset, amount, commitment, proof) call.
// intent.note.secret is the spend key. PERSIST IT.
await wallet.writeContract({
  address: intent.exec.poolAddress,
  abi: shieldPoolAbi,
  functionName: intent.exec.fn,      // "shieldBound"
  args: intent.exec.args,
  value: intent.exec.valueWei,       // amount for native ETH, 0n for tokens
});`}</code>
      </pre>
      <p>
        A complete runnable agent is in{" "}
        <code>examples/agent-shield</code>. See{" "}
        <Link href="/docs/agents">Build a private agent</Link>.
      </p>

      <h2>Intents: plan and exec</h2>
      <p>
        Every action is an <strong>intent</strong> with two layers. The{" "}
        <strong>plan</strong> is portable and safe to log or hand to an agent
        (symbol, amount, no secrets). The <strong>exec</strong> resolves the
        on-chain call (wei amounts, resolved addresses, proof args). The SDK and
        the <Link href="/docs/agents">agent server</Link> share one intent shape.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Builder</th>
              <th>Resolves</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>buildShieldBoundIntent</code>
              </td>
              <td>
                Mints a note + shield proof → <code>shieldBound(...)</code> (the
                live deposit path)
              </td>
            </tr>
            <tr>
              <td>
                <code>buildShieldIntent</code>
              </td>
              <td>
                Plain <code>shield(...)</code>, only for pools without a shield
                verifier
              </td>
            </tr>
            <tr>
              <td>
                <code>buildUnshieldIntent</code>
              </td>
              <td>
                Witness + proof → <code>unshield(...)</code> (cash out)
              </td>
            </tr>
            <tr>
              <td>
                <code>buildPrivateSendIntent</code>
              </td>
              <td>
                Transfer witness → <code>transfer(...)</code> to a receive tag
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>API surface</h2>
      <h3>Notes</h3>
      <pre>
        <code>{`import { makeBoundNotePoseidon, noteNullifierPoseidon } from "@gloamtrade/sdk";

const note = await makeBoundNotePoseidon(amountWei, assetAddress);
// { secret, commitment, secretField, commitmentField }
const nullifier = await noteNullifierPoseidon(note.secretField, note.commitmentField);`}</code>
      </pre>
      <h3>Prover (injected)</h3>
      <p>
        Proving is environment-bound, so it is passed in. <code>artifactProver</code>{" "}
        binds snarkjs to your circuit artifacts (paths in node, URLs in the
        browser); <code>proveGroth16</code> is the one-shot form.
      </p>
      <pre>
        <code>{`import { artifactProver, proveGroth16 } from "@gloamtrade/sdk";

const prover = artifactProver({ wasm, zkey });
const { proofBytes, publicSignals } = await prover(circomInput);`}</code>
      </pre>
      <h3>Merkle</h3>
      <p>
        A depth-20 incremental tree and a circom path builder
        (<code>buildPoseidonMerklePath</code>) for spend proofs. Rebuild the tree
        from the pool&apos;s <code>Shielded</code> events, then prove membership.
      </p>
      <h3>Rates &amp; privacy</h3>
      <p>
        Pure sealed-rate math (<code>exactSealedAmounts</code>) and the
        size-privacy floor policy (<code>publicAmountOutMin</code>), proven
        against the circuit equality{" "}
        <code>amountOut·rateOut = amountSwap·rateIn</code>.
      </p>
      <h3>Constants</h3>
      <p>
        <code>SEALED_VAULT</code> (the hardened pool),{" "}
        <code>SHIELD_VERIFIER</code>, <code>NATIVE_ASSET</code>, and the chain
        ids. The default <code>SEALED_VAULT</code> is the hardened C1/C2/C3 pool,
        never the retired <code>0x4F38</code> pool.
      </p>

      <h2>Integration patterns</h2>
      <ul>
        <li>
          <strong>Private balances in your app.</strong> Shield with{" "}
          <code>buildShieldBoundIntent</code>, persist <code>note.secret</code>{" "}
          in your own store keyed by commitment, cash out with the unshield
          builder.
        </li>
        <li>
          <strong>Private payments.</strong> Send to a receive tag; the recipient
          scans the encrypted <code>GloamPayMemo</code> inbox and opens the note.
          See <Link href="/docs/private-pay">Private pay</Link>.
        </li>
        <li>
          <strong>Compliance without opacity.</strong> A holder proves one
          balance to an auditor via a <Link href="/docs/sdk/disclosure">disclosure</Link>,
          revealing nothing else.
        </li>
        <li>
          <strong>Autonomous agents.</strong> The same core runs server-side, so
          an AI agent can hold and move value privately under policy. See{" "}
          <Link href="/docs/agents">Agents</Link>.
        </li>
      </ul>

      <h2>Public inputs are pinned</h2>
      <p>
        The SDK pins the exact public-input ordering the deployed verifiers
        expect, so an integrator cannot drift out of proof compatibility:
      </p>
      <ul>
        <li>
          <strong>shield</strong>, <code>[commitment, amount, asset]</code>
        </li>
        <li>
          <strong>unshield</strong>,{" "}
          <code>[root, nullifier, asset, amount, to]</code>
        </li>
        <li>
          <strong>transfer</strong>,{" "}
          <code>[root, nullifier, newCommitment0, newCommitment1]</code>
        </li>
        <li>
          <strong>sealedSwap</strong>, nine signals ending in{" "}
          <code>amountOutMin, rateIn, rateOut</code>
        </li>
      </ul>

      <h2>Guardrails</h2>
      <p>
        Robinhood Chain testnet <code>46630</code> only, with dev-ceremony keys.
        Real privacy only, never a mock success. Note secrets are the sole spend
        authority: persist and protect them. Mainnet runs on the production
        ceremony&apos;s keys after an internal review; an external audit is planned. See{" "}
        <Link href="/docs/production">the production gate</Link>.
      </p>
    </DocsLayout>
  );
}
