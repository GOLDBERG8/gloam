import type { Metadata } from "next";
import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";

export const metadata: Metadata = {
  title: "Agents",
  description:
    "Give an AI agent private payments on Robinhood Chain and Tempo: shield, pay, and disclose end to end via @gloamtrade/sdk and the @gloamtrade/mcp server, under policy.",
};

export default function DocsAgentsPage() {
  return (
    <DocsLayout
      title="Build a private agent"
      lede="Give an AI agent a private execution surface on Robinhood Chain and Tempo. It shields, pays, and proves holdings end to end, with size and strategy hidden and signing under policy."
      glance={[
        { label: "SDK", value: "@gloamtrade/sdk" },
        { label: "Server", value: "@gloamtrade/mcp (MCP)" },
        { label: "Example", value: "examples/agent-shield" },
        { label: "Secrets", value: "server-side only" },
      ]}
      quickLinks={[
        { href: "/docs/sdk", label: "SDK" },
        { href: "/docs/sdk/disclosure", label: "Selective disclosure" },
        { href: "/docs/privacy-model", label: "Privacy model" },
      ]}
    >
      <h2>Why agents need this most</h2>
      <p>
        An agent trading a public chain leaks its whole strategy: every position,
        size, and time is on the graph for anyone to copy or front-run. Agents run
        predictable, high-frequency strategies, so they are the easiest to
        reverse-engineer. Gloam gives an agent a private execution surface: hold,
        move, and prove value with size hidden, so its edge stays its own.
      </p>

      <h2>Two ways in</h2>
      <p>
        Both speak the same intent shape, so a plan an app builds and a plan an
        agent builds are the same object.
      </p>
      <ul>
        <li>
          <strong>Directly via <code>@gloamtrade/sdk</code>.</strong> Your agent
          framework builds an intent and signs it with its own wallet. Best when
          the agent already has an execution loop.
        </li>
        <li>
          <strong>Via the <code>@gloamtrade/mcp</code> server.</strong> An
          MCP-speaking model (Claude, etc.) gets Gloam as tools alongside its
          other capabilities, the same way Robinhood&apos;s own MCP exposes
          public trading. Best for a general assistant that should also act
          privately.
        </li>
      </ul>

      <h2 id="connect-by-url">Connect by URL</h2>
      <p>
        The quickest way to try Gloam from a chat. Gloam runs a hosted MCP
        server, so you add it to your client by URL and install nothing.
      </p>
      <pre>
        <code>https://www.gloam.trade/mcp</code>
      </pre>
      <ul>
        <li>
          <strong>Claude</strong> (claude.ai and Claude Desktop): Settings,
          Connectors, Add custom connector, then paste the URL.
        </li>
        <li>
          <strong>ChatGPT</strong>: Settings, Apps and connectors. Turn on
          developer mode, then create a connector with the URL and no
          authentication.
        </li>
        <li>
          <strong>Claude Code</strong>:{" "}
          <code>claude mcp add --transport http gloam-hosted https://www.gloam.trade/mcp</code>
        </li>
        <li>
          <strong>Cursor, VS Code and other clients</strong>: add it as a remote
          server, for example{" "}
          <code>{`{ "mcpServers": { "gloam-hosted": { "url": "https://www.gloam.trade/mcp" } } }`}</code>
        </li>
      </ul>
      <p>The hosted server reads and plans. It has these tools:</p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>gloam_info</code> / <code>gloam_networks</code>
              </td>
              <td>
                What Gloam is; each network&apos;s vault, assets and explorer, on
                mainnet and testnet, with faucets for the testnets
              </td>
            </tr>
            <tr>
              <td>
                <code>gloam_vault_stats</code>
              </td>
              <td>Public vault totals, as on the transparency page. No wallets</td>
            </tr>
            <tr>
              <td>
                <code>gloam_create_payment_request</code>
              </td>
              <td>A link that asks someone to pay your Gloam address privately</td>
            </tr>
            <tr>
              <td>
                <code>gloam_verify_proof</code>
              </td>
              <td>
                Check a proof of funds, proof of payment, payroll total or balance
                disclosure, with the same checks as <Link href="/verify">/verify</Link>
              </td>
            </tr>
            <tr>
              <td>
                <code>gloam_plan_deposit</code>
              </td>
              <td>The steps and app link for a private deposit, and what is public</td>
            </tr>
            <tr>
              <td>
                <code>gloam_mpp_how_to</code>
              </td>
              <td>
                Pay or charge privately over MPP with{" "}
                <code>@gloamtrade/mppx-gloam</code>, with code
              </td>
            </tr>
            <tr>
              <td>
                <code>gloam_connect_full_agent</code>
              </td>
              <td>Commands to install the local server that signs and pays</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        It never signs, never holds funds, and never needs a private key, a
        recovery phrase or a note secret. A tool call that looks like it carries
        one is refused with a warning not to share it, and nothing is kept. When
        something has to be signed, it sends you to the app, or to the local{" "}
        <a href="#the-mcp-server">MCP server</a>, which keeps keys on your own
        machine.
      </p>

      <h2>Reference agent (the SDK path)</h2>
      <p>
        <code>examples/agent-shield</code> is the smallest complete agent: it
        mints a note, generates the shield proof, and deposits privately via{" "}
        <code>shieldBound</code>. The whole private path is a few lines.
      </p>
      <pre>
        <code>{`import { buildShieldBoundIntent, artifactProver } from "@gloamtrade/sdk";
import { parseEther } from "viem";

// 1) SDK mints the note + generates the shield proof
const intent = await buildShieldBoundIntent({
  amountWei: parseEther("0.001"),
  prover: artifactProver({ wasm: "shield.wasm", zkey: "shield_final.zkey" }),
});

// 2) the agent signs the resolved call with its (server-held) wallet
const hash = await wallet.writeContract({
  address: intent.exec.poolAddress,
  abi: shieldPoolAbi,
  functionName: intent.exec.fn,   // "shieldBound"
  args: intent.exec.args,
  value: intent.exec.valueWei,
});
// persist intent.note.secret in the agent's note store, keyed by commitment`}</code>
      </pre>
      <p>
        That snippet runs on the free testnet, the SDK default. For real money,
        pass a mainnet network (<code>mainnetNetwork(&quot;tempo&quot;)</code> or{" "}
        <code>&quot;robinhood&quot;</code>), its stablecoin as <code>asset</code>,
        and prove with <code>circuitArtifactUrls(&quot;shield&quot;, net.chainId)</code>{" "}
        so the final keys are used. See the <Link href="/docs/quickstart">quickstart</Link>.
      </p>
      <p>
        From there the agent can cash out, pay a receive tag, or prove a balance
        to a counterparty with a <Link href="/docs/sdk/disclosure">disclosure</Link>,
        all with the same core.
      </p>

      <h2>The MCP server</h2>
      <p>
        Run it on your own machine with <code>npx -y @gloamtrade/mcp</code>. It
        signs there, under the spending limits below, and keeps keys and note
        secrets off the model.
      </p>
      <p>
        <code>@gloamtrade/mcp</code> exposes Gloam as tools to any MCP client. It keeps
        two phases separate on purpose: planning tools build an unsigned intent
        and describe, in plain language, what is private and what is not;
        execution tools take a plan, sign it server-side, and broadcast.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>gloam_info</code> / <code>gloam_privacy_status</code>
              </td>
              <td>What Gloam is; the honest current privacy posture (read)</td>
            </tr>
            <tr>
              <td>
                <code>gloam_list_markets</code> / <code>gloam_quote</code>
              </td>
              <td>Markets and indicative quotes, with what stays private (read)</td>
            </tr>
            <tr>
              <td>
                <code>gloam_plan_shield</code> / <code>gloam_plan_private_trade</code>
              </td>
              <td>Build an unsigned intent an agent can reason over (plan)</td>
            </tr>
            <tr>
              <td>
                <code>gloam_execute_shield</code>
              </td>
              <td>
                Real private deposit: mint a note, prove, and broadcast{" "}
                <code>shieldBound</code> server-side (execute)
              </td>
            </tr>
            <tr>
              <td>
                <code>gloam_execute_transfer</code>
              </td>
              <td>Sign + broadcast a public testnet transfer for funding (execute)</td>
            </tr>
            <tr>
              <td>
                <code>gloam_payment_requirements</code> /{" "}
                <code>gloam_verify_payment</code>
              </td>
              <td>
                Price a resource in a private x402 payment, and verify a presented
                one (server)
              </td>
            </tr>
            <tr>
              <td>
                <code>gloam_pay_x402</code>
              </td>
              <td>
                Plan the self-custodial private payment that satisfies a 402
                challenge (agent)
              </td>
            </tr>
            <tr>
              <td>
                <code>gloam_execute_private_pay</code>
              </td>
              <td>
                Settle that payment from one of the agent&apos;s notes, by handle,
                sealed to the payee (execute)
              </td>
            </tr>
            <tr>
              <td>
                <code>gloam_fetch_paid</code>
              </td>
              <td>
                Fetch a URL and, on a Gloam 402, pay privately and retry, all inside
                the server (execute)
              </td>
            </tr>
            <tr>
              <td>
                <code>gloam_list_notes</code> / <code>gloam_receive_tag</code>
              </td>
              <td>
                The agent&apos;s balances as handles, never secrets, and the tag
                others pay it at (read)
              </td>
            </tr>
            <tr>
              <td>
                <code>gloam_get_limits</code> /{" "}
                <code>gloam_get_spending_report</code>
              </td>
              <td>
                The agent&apos;s spending limits, and what it spent and has left in the
                last 24 hours (read)
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Private agent payments (x402)</h2>
      <p>
        Agents pay for tools and data over HTTP 402. The pattern that won
        Colosseum paired x402 with stablecoins, but that settlement is fully
        public: the amount, the payer, and the payee all leak. Gloam&apos;s{" "}
        <code>gloam-private</code> scheme keeps it private and self-custodial. The
        agent settles a shielded transfer to the payee itself, so no operator or
        facilitator ever holds its key or funds, then presents the payment note,
        sealed to the payee&apos;s receive tag, plus the settlement transaction on
        the 402 retry. The payee opens the note and moves it into a fresh note
        only it knows before serving, so the payer cannot spend it back. The
        public sees only shielded transfers.
      </p>
      <p>
        <strong>This is not a Tempo Zone.</strong> A Zone is operator-visible:
        the zone operator sees every transaction inside it. Gloam is private from
        the public and from any operator; only the payer and the payee learn the
        amount. Compliance visibility is opt-in per payment through an
        issuer-scoped disclosure, not a blanket view handed to an operator. See
        the <Link href="/docs/privacy-model">privacy model</Link> for what stays
        hidden and what does not.
      </p>

      <h2>Spending limits</h2>
      <p>
        An agent that can sign can spend, so the owner sets its limits and every
        tool that moves money (pay, send, shield) checks them before anything is
        proved or signed. A spend that breaks a limit is refused with a plain
        reason the agent can act on, for example &ldquo;that would bring today to
        14 PathUSD, over the limit of 12 a day&rdquo;.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Limit</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Assets</td>
              <td>Which stablecoins or tokens the agent may move, matched by contract address</td>
            </tr>
            <tr>
              <td>Per payment</td>
              <td>The most it may send in one payment</td>
            </tr>
            <tr>
              <td>Per day</td>
              <td>The most it may send in any 24 hours</td>
            </tr>
            <tr>
              <td>Recipients</td>
              <td>Anyone, or only the payees you list</td>
            </tr>
            <tr>
              <td>Expiry</td>
              <td>A date after which the agent cannot spend at all</td>
            </tr>
            <tr>
              <td>Tools</td>
              <td>Which of pay, send and shield it may use</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        No limits means no spending: a server with a key but no limits refuses
        every spend until you set them (or turn them off on purpose). Every
        spend is logged before it is signed, under a lock, so two calls at once
        cannot both squeeze under the daily cap. Configuration lives in the{" "}
        <a href="https://github.com/cryptoduke01/gloam/tree/main/mcp#spending-limits">
          MCP README
        </a>
        .
      </p>
      <p>
        <strong>Where they are enforced.</strong> These limits are enforced by the
        MCP server you run, off-chain, not by the vault contract. They stop a
        confused or manipulated agent; they do not stop someone who has the raw
        key. For that, use a policy wallet underneath, as below.
      </p>
      <p>
        <strong>The agent never holds the money itself.</strong> A private balance
        is a note, and whoever knows its secret can spend it, so the server keeps
        every note in an encrypted store and gives the agent short handles
        instead. A payment it makes is sealed to the payee&apos;s receive tag, so
        the agent cannot open that either. What limits still cannot stop: an agent
        tricked into spending within its limits to a payee you allowed.
      </p>

      <h2>Policy and key custody</h2>
      <p>
        Signing keys live <strong>server-side only</strong> and never enter a
        model context or a log. Before an agent holds real money on mainnet,
        swap the test key for a Turnkey server wallet with policy the agent
        cannot override: spend caps, an
        allow-list of contracts and markets, and size privacy always on. An
        out-of-policy action is refused, not quietly clamped.
      </p>

      <h2>Honesty</h2>
      <p>
        No fabricated fills, ever. If a private path is not live, the tool says so
        and returns a plan rather than a fake success.{" "}
        <Link href="/docs/private-swaps">Private swaps</Link> are live in the
        Gloam app on both mainnets, but the SDK and the MCP server do not swap
        yet: the market and trade tools only plan, and the old sealed trade they
        describe is retired. Shield, private send, cash out, and disclosure are
        live and proof-gated. Mainnet uses the final keys from the 13-contributor
        ceremony; testnet runs on dev-ceremony keys. The code was reviewed
        internally before launch, and an external audit is planned. Mainnet is
        beta software with real money, so start an agent on small limits.
      </p>
    </DocsLayout>
  );
}
