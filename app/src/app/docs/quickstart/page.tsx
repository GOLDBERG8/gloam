import type { Metadata } from "next";
import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";

export const metadata: Metadata = {
  title: "Quickstart",
  description:
    "Shield your first private balance on Robinhood Chain in under ten minutes with @gloamtrade/sdk: install, prove, deposit, cash out.",
};

export default function DocsQuickstartPage() {
  return (
    <DocsLayout
      title="Quickstart"
      lede="Go from an empty project to a real private balance on Robinhood Chain testnet in under ten minutes. Every step below runs: no mocks, real Groth16 proofs."
      glance={[
        { label: "Time", value: "~10 minutes" },
        { label: "Runtime", value: "browser or node" },
        { label: "Chain", value: "RH testnet 46630" },
        { label: "You end with", value: "a spendable private note" },
      ]}
      quickLinks={[
        { href: "/docs/sdk/reference", label: "API reference" },
        { href: "/docs/sdk", label: "SDK overview" },
        { href: "/docs/testnet", label: "Testnet + faucet" },
        { href: "/docs/agents", label: "Build a private agent" },
      ]}
    >
      <h2>Fastest start</h2>
      <p>Scaffold a working private app in one command:</p>
      <pre>
        <code>{`npm create gloam-app@latest my-private-app
cd my-private-app && npm install && npm run dev`}</code>
      </pre>
      <p>
        That gives you the browser shield flow, wired and running on{" "}
        <code>localhost:3000</code>. The rest of this page builds the same thing
        by hand so you understand each piece.
      </p>

      <h2>What you need</h2>
      <ul>
        <li>
          Node 18+ (or a browser app with a bundler, such as Next or Vite). The SDK ships
          TypeScript source, transpiled by your bundler.
        </li>
        <li>
          A funded testnet account. Point a wallet at Robinhood Chain testnet
          (chain id <code>46630</code>) and get test ETH. See the{" "}
          <Link href="/docs/testnet">testnet guide</Link>.
        </li>
        <li>
          The shield circuit artifacts, <code>shield.wasm</code> and{" "}
          <code>shield_final.zkey</code> (step 2).
        </li>
      </ul>

      <h2>1. Install</h2>
      <p>
        <code>viem</code> handles signing and RPC; <code>snarkjs</code> is the
        proving peer, loaded only when you generate a proof.
      </p>
      <pre>
        <code>{`npm install @gloamtrade/sdk viem
npm install snarkjs   # peer, for proving`}</code>
      </pre>

      <h2>2. Get the circuit artifacts</h2>
      <p>
        Shielding into the hardened pool requires a proof, so you need the shield
        circuit&apos;s <code>wasm</code> and <code>zkey</code>. The reference app
        serves them from <code>app/public/circuits/</code>:
      </p>
      <ul>
        <li>
          <code>shield.wasm</code>: the witness generator
        </li>
        <li>
          <code>shield_final.zkey</code>: the proving key
        </li>
        <li>
          <code>shield_vkey.json</code>: the verifying key (only for{" "}
          <Link href="/docs/sdk/disclosure">disclosure verification</Link>)
        </li>
      </ul>
      <p>
        In <strong>node</strong>, pass file paths. In the <strong>browser</strong>,
        host the files and pass URLs (for example <code>/circuits/shield.wasm</code>).
        Same artifacts either way.
      </p>

      <h2>3. Shield your first note</h2>
      <p>
        <code>buildShieldBoundIntent</code> does the private half: it mints a note
        (a Poseidon commitment binding your secret to the amount and asset) and
        generates the shield proof. You sign the resolved call. The{" "}
        <code>note.secret</code> it returns is your only spend authority, so persist
        it.
      </p>
      <pre>
        <code>{`import { buildShieldBoundIntent, artifactProver } from "@gloamtrade/sdk";
import { createWalletClient, http, parseEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const rhTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["<RH_TESTNET_RPC>"] } },
});

const account = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);
const wallet = createWalletClient({ account, chain: rhTestnet, transport: http() });

// mint the note + generate the shield proof
const intent = await buildShieldBoundIntent({
  amountWei: parseEther("0.001"),
  prover: artifactProver({
    wasm: "./shield.wasm",        // URL in the browser
    zkey: "./shield_final.zkey",
  }),
});

// sign + broadcast shieldBound(asset, amount, commitment, proof)
const hash = await wallet.writeContract({
  address: intent.exec.poolAddress,
  abi: SHIELD_BOUND_ABI,
  functionName: intent.exec.fn,   // "shieldBound"
  args: intent.exec.args,
  value: intent.exec.valueWei,    // the deposit for native ETH, 0n for tokens
});

// PERSIST THIS. Losing it loses the funds.
saveSecret(intent.note.commitment, intent.note.secret);`}</code>
      </pre>
      <p>The minimal ABI fragment for the one call you make:</p>
      <pre>
        <code>{`const SHIELD_BOUND_ABI = [{
  type: "function",
  name: "shieldBound",
  stateMutability: "payable",
  inputs: [
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "commitment", type: "bytes32" },
    { name: "proof", type: "bytes" },
  ],
  outputs: [],
}] as const;`}</code>
      </pre>

      <h2>4. Confirm it landed</h2>
      <p>
        The deposit inserts your commitment as a leaf in the pool&apos;s Merkle
        tree. Check membership directly, with no index and no backend:
      </p>
      <pre>
        <code>{`const seen = await publicClient.readContract({
  address: intent.exec.poolAddress,
  abi: [{ type: "function", name: "commitmentSeen", stateMutability: "view",
    inputs: [{ name: "c", type: "bytes32" }], outputs: [{ type: "bool" }] }],
  functionName: "commitmentSeen",
  args: [intent.note.commitment],
});
// seen === true  ->  you hold a private balance`}</code>
      </pre>
      <p>
        That is a real shielded balance. Nobody can tell it is yours or spend it
        without <code>note.secret</code>.
      </p>

      <h2>5. Cash out</h2>
      <p>
        To exit, rebuild the tree from chain, prove membership, and unshield.{" "}
        <code>syncTree</code> replays every leaf-inserting event in order (so the
        root matches even after transfers); <code>buildUnshieldIntent</code>{" "}
        builds the witness and proof. The amount, asset, and recipient become
        public on exit; the source note stays unlinkable via the nullifier.
      </p>
      <pre>
        <code>{`import { buildUnshieldIntent, artifactProver, syncTree, SEALED_VAULT } from "@gloamtrade/sdk";

// rebuild the pool tree, then get this note's membership path by commitment
const synced = await syncTree(publicClient, { pool: SEALED_VAULT, fromBlock });
const path = await synced.pathForCommitment(note.commitment);
if (!path) throw new Error("note not found in the tree yet");

const exit = await buildUnshieldIntent({
  secretHex: note.secret,
  amountWei: parseEther("0.001"),
  to: account.address,
  path,
  prove: artifactProver({ wasm: "./unshield.wasm", zkey: "./unshield_final.zkey" }),
});

await wallet.writeContract({
  address: exit.exec.poolAddress,
  abi: unshieldAbi,
  functionName: exit.exec.fn,     // "unshield"
  args: exit.exec.args,
});`}</code>
      </pre>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/docs/sdk/reference">API reference</Link>: every builder,
          the note and prover primitives, merkle, rates, and constants.
        </li>
        <li>
          <Link href="/docs/private-pay">Private pay</Link>: send inside the
          vault to a receive tag with <code>buildPrivateSendIntent</code>.
        </li>
        <li>
          <Link href="/docs/sdk/disclosure">Selective disclosure</Link>: prove
          one balance to a chosen party, revealing nothing else.
        </li>
        <li>
          <Link href="/docs/agents">Build a private agent</Link>: the same core,
          server-side, under policy.
        </li>
      </ul>

      <h2>Honesty</h2>
      <p>
        Robinhood Chain testnet only, with dev-ceremony proving keys. Everything
        here is real: real proofs, real on-chain state, no mocks. Sealed swaps
        are disabled pending the H1 solvency work. Mainnet runs on the production
        ceremony&apos;s keys after an internal review; an external audit is planned. See{" "}
        <Link href="/docs/production">the production gate</Link>.
      </p>
    </DocsLayout>
  );
}
