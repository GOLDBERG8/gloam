import type { Metadata } from "next";
import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ArrowUpRight } from "@/components/ui/ArrowUpRight";

const title = "Agents that pay privately, and check before they pay";
const description =
  "AI agents now spend real money, and every payment they make has two problems: it is public, and the agent can be fooled into making it. How Raeto funds agents privately with Gloam, and how Agent Wormhole checks each payment before it moves.";

// No images here: the card in this folder (opengraph-image.tsx) is the share image.
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/blog/private-agent-payments" },
  openGraph: {
    title,
    description,
    url: "/blog/private-agent-payments",
    siteName: "Gloam",
    type: "article",
  },
};

const link =
  "text-foreground underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-foreground";
const h2 = "pt-8 text-[26px] font-normal leading-snug tracking-[-0.015em] text-foreground";

/** The cover: one payment, from the agent to the service, with the check in between. */
const STEPS: { name: string; line: string; sealed?: boolean }[] = [
  { name: "Your agent", line: "Gets a price back: pay 2 USDG for this" },
  { name: "Agent Wormhole", line: "Checks the payment request. Only allow goes on" },
  { name: "Gloam", line: "Pays from a private balance", sealed: true },
  { name: "The service", line: "Gets paid. Nobody else sees how much, or by whom" },
];

function Flow() {
  return (
    <div className="w-full max-w-[1000px]">
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.name} className="gl-glass p-2 shadow-pop">
            <div className="flex h-full flex-col rounded-[12px] bg-panel p-5">
              <p className="tnum text-[12px] text-faint">{i + 1}</p>
              <p className={`mt-2 text-[15px] ${s.sealed ? "text-sealed" : "text-foreground"}`}>{s.name}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-mute">{s.line}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-center text-[13px] text-mute">
        Refuse, abstain, an error or no answer in time: nothing moves.
      </p>
    </div>
  );
}

/** What a stranger with an explorer can and cannot learn from a private agent top-up. */
const SEES: { what: string; seen: boolean; note: string }[] = [
  { what: "Who funded which agent", seen: false, note: "Not on chain. The payment moves inside the vault" },
  { what: "How much each top-up was", seen: false, note: "Not on chain" },
  { what: "Which payments Raeto received", seen: false, note: "Not on chain. Raeto sweeps each one into a note only it knows" },
  { what: "Money added to Gloam", seen: true, note: "The wallet, the token and the amount, like every shielded pool" },
  { what: "Raeto's cash-outs to its treasury", seen: true, note: "The amount and destination, on Raeto's schedule, not one per user" },
];

const SOURCES: { label: string; href: string }[] = [
  { label: "Raeto", href: "https://raeto.cc" },
  { label: "Agent Wormhole", href: "https://agentwormhole.com" },
  { label: "Gloam docs: agents and the MCP server", href: "/docs/agents" },
  { label: "Gloam docs: the SDK", href: "/docs/sdk" },
  { label: "@gloamtrade/mcp on npm", href: "https://www.npmjs.com/package/@gloamtrade/mcp" },
  { label: "@gloamtrade/sdk on npm", href: "https://www.npmjs.com/package/@gloamtrade/sdk" },
  { label: "x402: payments over HTTP 402", href: "https://www.x402.org" },
  { label: "Gloam: privacy model (what the explorer shows)", href: "/docs/privacy-model" },
  { label: "Gloam: live vault totals", href: "/transparency" },
];

export default function PrivateAgentPaymentsPost() {
  return (
    <div className="flex min-h-screen flex-col bg-panel text-foreground">
      <Header />

      <main>
        <article>
          <header className="mx-auto max-w-[68ch] px-6 pt-12 sm:pt-20">
            <p className="t-label flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <Link href="/" className="transition-colors hover:text-foreground">
                Gloam
              </Link>
              <span aria-hidden className="h-1 w-1 rounded-full bg-faint" />
              <span>Research</span>
              <span aria-hidden className="h-1 w-1 rounded-full bg-faint" />
              <time dateTime="2026-10-23">October 23, 2026</time>
            </p>
            <h1 className="t-display-l mt-5 text-balance">Agents that pay privately, and check before they pay</h1>
            <p className="mt-6 text-[18px] leading-relaxed text-soft sm:text-[19px]">
              AI agents now spend real money. They pay for APIs, data, compute and
              each other, often without a person in the loop. Every one of those
              payments has two problems, and this week two Gloam partners started
              solving them.
            </p>
          </header>

          <div className="mx-auto mt-12 max-w-[1400px] px-4 sm:mt-16 sm:px-7">
            <div className="gl-panel mx-auto flex min-h-[360px] max-w-[1200px] items-center justify-center px-5 py-14 sm:min-h-[420px]">
              <Flow />
            </div>
          </div>

          <div className="mx-auto max-w-[68ch] px-6">
            <div className="mt-12 space-y-6 text-[17px] leading-[1.75] text-soft">
              <h2 className={h2}>Two problems with agent money</h2>
              <p>
                The first is that it is public. Fund an agent from your wallet and the
                chain keeps a permanent record that anyone can read: which wallet pays for
                which agent, what it buys, how much it spends, and when. For a company,
                that is its product roadmap and its vendor list, published. For a
                person, it ties an agent&apos;s whole history back to their own wallet.
              </p>
              <p>
                The second is that agents believe what they are told. When an agent asks
                a paid service for something, the service answers with a price, an HTTP
                402 under standards like x402. That answer is just text from a stranger.
                It can be padded, swapped for a different one, or carry instructions
                written for the model instead of the human. An agent with a budget and
                no second opinion will pay it.
              </p>
              <p>
                Gloam works on the first problem. Agent Wormhole works on the second.
                Raeto is the first platform running private agent funding in production.
              </p>

              <h2 className={h2}>Raeto: funding agents without a trail</h2>
              <p>
                Raeto sells AI credits on Robinhood Chain. Since October 23 it has taken
                payments through Gloam in production, using our SDK. It works like this:
              </p>
              <ol className="list-decimal space-y-3 pl-6 marker:text-faint">
                <li>
                  Each Raeto account or agent gets its own Gloam payment request link.
                </li>
                <li>
                  Whoever is topping it up pays from their private Gloam balance. The
                  payment moves inside the vault, so the explorer shows no amount and no
                  link between payer and payee. An encrypted heads-up goes onto
                  Gloam&apos;s payment board, readable only by Raeto.
                </li>
                <li>
                  Raeto&apos;s server reads the board about every 30 seconds with{" "}
                  <code className="text-[15px] text-foreground">scanIncomingPayments</code>.
                </li>
                <li>
                  Before crediting anything, it moves each payment into a fresh note only
                  Raeto knows, with{" "}
                  <code className="text-[15px] text-foreground">sweepReceivedNote</code>,
                  through the Gloam relay. Credit happens only once that sweep lands.
                </li>
              </ol>
              <p>
                The sweep is the part people miss. A private payment arrives as a note the
                payer created, so until the receiver moves it into a note of their own,
                the payer could still spend it back. Crediting only after the sweep closes
                that gap. Raeto&apos;s first live payment, $5, was credited in under a
                minute.
              </p>
              <p>
                The partnership runs both ways. Glim, the helper in Gloam&apos;s
                community group, picks the model for simple questions through
                Raeto&apos;s routing.
              </p>

              <h2 className={h2}>What stays private, and what does not</h2>
              <p>
                Here is what a stranger with a block explorer can learn from a private
                agent top-up.
              </p>
            </div>

            <div className="mt-6 overflow-x-auto rounded-[18px] border border-line">
              <table className="w-full min-w-[560px] text-left text-[14px] leading-relaxed">
                <thead>
                  <tr className="border-b border-line bg-surface/60 text-mute">
                    <th className="w-[34%] px-4 py-3 font-normal">On chain</th>
                    <th className="w-[16%] px-4 py-3 font-normal">Visible?</th>
                    <th className="px-4 py-3 font-normal">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {SEES.map((r) => (
                    <tr key={r.what} className="align-top">
                      <td className="px-4 py-3 text-foreground">{r.what}</td>
                      <td className={`px-4 py-3 ${r.seen ? "text-mute" : "text-sealed"}`}>{r.seen ? "Yes" : "No"}</td>
                      <td className="px-4 py-3 text-soft">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 space-y-6 text-[17px] leading-[1.75] text-soft">
              <p>
                The two public rows are the edges of the vault, and every shielded pool has
                them, Zcash and Railgun included, because a token contract records money
                going in and out. What matters is that the edges do not connect to what
                happens inside. We keep working on them anyway. The relay submits
                payments so a payer&apos;s wallet never appears next to them. Cash-outs can
                go out privately, split into ordinary-looking pieces and spread over
                time, so an amount coming out does not match one going in. And every new
                person and agent using the vault makes everyone in it harder to pick out.
              </p>

              <h2 className={h2}>Agent Wormhole: a check before every payment</h2>
              <p>
                Agent Wormhole builds security for AI agents that spend money. Its check
                reads a payment request before an agent acts on it: it looks for hidden
                instructions and tells whether the request changed since it was first
                seen. Since October 23 it is built into Gloam&apos;s MCP server, version
                0.4.0, the tool agents use to pay through Gloam.
              </p>
              <p>
                When an agent is about to pay, the order is fixed. First the agent&apos;s
                own spending limits. Then, if the operator turned the check on, the
                payment request goes to Agent Wormhole. Only an answer of allow lets the
                payment go ahead. A refusal, an abstain, an error, an answer the server
                does not recognise, or no answer within five seconds all mean the same
                thing: the agent does not pay, and nothing is spent.
              </p>
              <p>
                It is also careful about what it shares. Agent Wormhole sees the payment
                request and nothing else: never a note, a balance, the wallet or a key.
                The payment itself still goes through Gloam privately. The check is off
                by default; an operator turns it on by setting{" "}
                <code className="text-[15px] text-foreground">GLOAM_WORMHOLE_KEY</code>.
              </p>
              <p>
                One honest gap: each answer comes with a signed attestation. Agent
                Wormhole has not yet published the exact form its check attestations are
                signed in, so the MCP server keeps the attestation in its result for the
                operator instead of verifying it itself. We will verify it on our side
                once that format is documented.
              </p>

              <h2 className={h2}>Put together</h2>
              <p>
                An agent on Gloam can now be funded without tying it to the person behind
                it, receive money without a public trail, and refuse to pay a price that
                looks wrong. Private by default, checked before it spends. None of it asks
                the agent&apos;s owner to trust Gloam with their money: the vault only
                releases funds for a valid proof, and the relay can submit a payment or
                refuse it, nothing more.
              </p>

              <h2 className={h2}>What comes next</h2>
              <p>
                Paying by name is next: send money privately to an ENS name like
                alice.eth, with the lookup itself kept out of view. After that, more agent
                platforms on the same rails as Raeto, and a growing crowd in the vault,
                which is the privacy feature that compounds. Gloam has been live on
                Robinhood Chain and Tempo mainnet since October 21; anyone can follow the
                public totals on{" "}
                <Link href="/transparency" className={link}>
                  our transparency page
                </Link>
                .
              </p>

              <h2 className={h2}>Try it</h2>
              <p>
                Builders can start with the{" "}
                <Link href="/docs/agents" className={link}>
                  agent docs
                </Link>{" "}
                and{" "}
                <a href="https://www.npmjs.com/package/@gloamtrade/mcp" target="_blank" rel="noreferrer" className={link}>
                  @gloamtrade/mcp
                </a>
                . To top up agents privately, see{" "}
                <a href="https://raeto.cc" target="_blank" rel="noreferrer" className={link}>
                  raeto.cc
                </a>
                . To add the payment check, get a key at{" "}
                <a href="https://agentwormhole.com" target="_blank" rel="noreferrer" className={link}>
                  agentwormhole.com
                </a>
                .
              </p>
            </div>

            <div className="mt-14 border-t border-line pt-8">
              <p className="t-label">Sources</p>
              <ol className="mt-4 space-y-2 text-[14px] leading-relaxed text-mute">
                {SOURCES.map((s, i) => (
                  <li key={s.href} className="flex gap-3">
                    <span className="tnum w-5 shrink-0 text-faint">{i + 1}.</span>
                    {s.href.startsWith("http") ? (
                      <a href={s.href} target="_blank" rel="noreferrer" className={link}>
                        {s.label}
                      </a>
                    ) : (
                      <Link href={s.href} className={link}>
                        {s.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-12 flex flex-wrap items-center gap-2 border-t border-line pt-8">
              <Link href="/docs/agents" className="btn btn-ink">
                Read the agent docs
              </Link>
              <AppLink href="/app" className="btn btn-quiet">
                Open the app
              </AppLink>
              <a href="https://x.com/gloamtrade" target="_blank" rel="noreferrer" className="btn btn-quiet">
                Follow @gloamtrade <ArrowUpRight />
              </a>
            </div>
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}
