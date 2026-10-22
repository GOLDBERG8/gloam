import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SealedField } from "@/components/ui/SealedField";
import { ArrowUpRight } from "@/components/ui/ArrowUpRight";

const title = "Private money, live on public chains";
const description =
  "Why money anyone can read fails the people who use it, and what went live on Robinhood Chain and Tempo mainnet today.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/blog/live-on-mainnet" },
  // Setting openGraph here replaces the root one, so the share image is named again.
  openGraph: {
    title,
    description,
    url: "/blog/live-on-mainnet",
    siteName: "Gloam",
    type: "article",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Gloam: private money on public chains" }],
  },
};

const link =
  "text-foreground underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-foreground";
const h2 = "pt-8 text-[26px] font-normal leading-snug tracking-[-0.015em] text-foreground";

const POOL = "0x39e28cde55cab798874746ac52cb4b5cc99a0194";

const GLANCE = [
  { k: "Networks", v: "Robinhood Chain and Tempo mainnet" },
  { k: "Live since", v: "21 October 2026, 13:00 UTC" },
  { k: "Fees", v: "Free to add and pay, 0.25% to cash out" },
  { k: "Status", v: "Beta, real money, deposit limits on" },
];

type Asset = { symbol: string; logo: string; limit: string };

const NETWORKS: { name: string; logo: string; assets: Asset[] }[] = [
  {
    name: "Robinhood Chain",
    logo: "/brand/chains/4663.png",
    assets: [
      { symbol: "USDG", logo: "/brand/logos/usdg.png", limit: "500 / 25,000" },
      { symbol: "$GLOAM", logo: "/brand/kit/gloam-avatar-ink.png", limit: "25,000 / 250,000" },
    ],
  },
  {
    name: "Tempo",
    logo: "/brand/logos/tempo.svg",
    assets: [
      { symbol: "USDC.e", logo: "/brand/logos/usdce.png", limit: "500 / 25,000" },
      { symbol: "pathUSD", logo: "/brand/logos/pathusd.svg", limit: "500 / 25,000" },
      { symbol: "USDT0", logo: "/brand/logos/usdt0.png", limit: "500 / 25,000" },
      { symbol: "OUSD", logo: "/brand/logos/ousd.svg", limit: "500 / 25,000" },
    ],
  },
];

/** The cover: both mainnet pools and what each one takes, in place of an illustration. */
function MainnetPools() {
  return (
    <div className="grid w-full max-w-[820px] grid-cols-1 gap-3 sm:grid-cols-2">
      {NETWORKS.map((n) => (
        <div key={n.name} className="gl-glass p-2 shadow-pop">
          <div className="h-full rounded-[12px] bg-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-[15px] text-foreground">
                <Image src={n.logo} alt="" width={20} height={20} className="h-5 w-5 rounded-md ring-1 ring-line" />
                {n.name}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sealed-soft px-2.5 py-1 text-[12px] font-medium text-sealed">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sealed" /> Live
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between text-[12px] text-mute">
              <span>Asset</span>
              <span>Beta limit, per deposit / total</span>
            </div>
            <ul className="mt-1 divide-y divide-line">
              {n.assets.map((a) => (
                <li key={a.symbol} className="flex min-h-[44px] items-center justify-between gap-4 text-[14px]">
                  <span className="inline-flex items-center gap-2 text-foreground">
                    <Image src={a.logo} alt="" width={18} height={18} className="h-[18px] w-[18px] rounded-full" />
                    {a.symbol}
                  </span>
                  <span className="tnum text-soft">{a.limit}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}

const READ_MORE: { label: string; href: string }[] = [
  { label: "Privacy model: what the explorer shows", href: "/docs/privacy-model" },
  { label: "Production readiness: what is done and what is ahead", href: "/docs/production" },
  { label: "Threat model: what the team can and cannot do", href: "/docs/threat-model" },
  { label: "Agents: the Gloam MCP server", href: "/docs/agents" },
  { label: "Live vault totals", href: "/transparency" },
  { label: "Check a proof", href: "/verify" },
  { label: "The pool on Robinhood Chain", href: `https://robin.etherscan.io/address/${POOL}` },
  { label: "The pool on Tempo", href: `https://explore.tempo.xyz/address/${POOL}` },
  { label: "Trusted setup transcript", href: "https://github.com/cryptoduke01/gloam/releases/tag/ceremony-final" },
];

export default function LiveOnMainnetPost() {
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
              <span>Announcement</span>
              <span aria-hidden className="h-1 w-1 rounded-full bg-faint" />
              <time dateTime="2026-10-21">October 21, 2026</time>
            </p>
            <h1 className="t-display-l mt-5 text-balance">Private money, live on public chains</h1>
            <p className="mt-6 text-[18px] leading-relaxed text-soft sm:text-[19px]">
              Why money anyone can read fails the people who use it, and what went
              live on Robinhood Chain and Tempo mainnet today.
            </p>
          </header>

          <div className="mx-auto mt-12 max-w-[1400px] px-4 sm:mt-16 sm:px-7">
            <div className="gl-panel mx-auto flex min-h-[420px] max-w-[1200px] items-center justify-center px-5 py-14 sm:min-h-[520px]">
              <SealedField drift />
              <MainnetPools />
            </div>
          </div>

          <div className="mx-auto max-w-[68ch] px-6">
            <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-6 sm:grid-cols-4">
              {GLANCE.map((g) => (
                <div key={g.k} className="min-w-0">
                  <dt className="t-label">{g.k}</dt>
                  <dd className="mt-1.5 text-[14px] leading-snug text-foreground">{g.v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-12 space-y-6 text-[17px] leading-[1.75] text-soft">
              <p>
                At 13:00 UTC today, Gloam went live on Robinhood Chain and Tempo
                mainnet. It has a simple job. It lets people and AI agents pay each
                other in stablecoins without publishing the details to everyone else.
                What follows is the case for why that matters, a plain account of how
                it works, and an honest list of what it does not do yet.
              </p>

              <h2 className={h2}>Money anyone can read</h2>
              <p>
                Public blockchains made a choice that suited their first users. Every
                balance and every transfer is visible to anyone, forever. That is how
                a stranger can check that the ledger adds up without trusting a bank.
                It is also why a stablecoin payment works less like a bank transfer
                and more like a postcard. Anyone who learns one of your addresses can
                read your balance, your income and the people you pay.
              </p>
              <p>For speculation, that cost has been tolerable. For payments, it breaks fast.</p>
              <p>
                Take salaries. A company that pays its team onchain publishes its
                payroll. Every employee can see what every colleague earns. Anyone who
                links a wallet to a name can see that person&apos;s pay, their savings
                and where they spend. No payroll provider would be allowed to work this
                way, yet it is the default on most chains.
              </p>
              <p>
                Take businesses. A supplier&apos;s payments reveal its margins. A
                treasury&apos;s transfers reveal its runway. A competitor does not need
                to guess who a company&apos;s customers are when the ledger lists them.
                Public by default turns ordinary bookkeeping into a disclosure no
                company would choose.
              </p>
              <p>
                Take AI agents. Agents are starting to pay for data, tools and compute
                on their own, often many times a minute. Every one of those payments is
                a signal. An agent&apos;s spending can reveal its strategy, its owner
                and the business behind it. If software is going to pay at that scale,
                it needs the same discretion a person expects from a bank card.
              </p>
              <p>
                None of this is an argument against public ledgers. Settlement anyone
                can verify is the reason stablecoins are useful. The argument is
                narrower. The amount, the sender and the recipient of a payment should
                not be public by default.
              </p>

              <h2 className={h2}>What Gloam is</h2>
              <p>
                Gloam is private stablecoin payments for people and AI agents. It is
                self-custodial. Only you hold the keys to your money, and there is no
                admin function that can move it. There are no middlemen. No one holds
                your money for you, and no operator keeps a view of everyone&apos;s
                balances. That includes us. The Gloam team cannot see what you hold or
                who you pay.
              </p>

              <h2 className={h2}>How it works</h2>
              <p>
                On each chain, Gloam runs one shielded pool: a smart contract that
                holds everyone&apos;s private balances together. When you add money,
                the pool records a private note that only you can open. The contract
                releases money only for a valid zero-knowledge proof. The proof shows
                that you own a note in the pool and have not spent it, without saying
                which note is yours or how much it holds.
              </p>
              <p>
                You get a private balance only you can see. Your public wallet no
                longer shows the money. The app reads your notes on your device and
                shows the total to you alone.
              </p>
              <p>
                You can pay privately. A payment inside the pool moves value into
                someone else&apos;s note. On the explorer it is a private transfer,
                with no sender, recipient or amount.
              </p>
              <p>
                You can pay with a claim link, which works like cash in an envelope.
                Whoever holds the link can claim the money, even someone who has never
                used Gloam. On claim, the money moves into a fresh note only they
                control, so the sender cannot take it back.
              </p>
              <p>
                You can prove exactly what you need to, to whoever needs it. Private
                does not mean nobody can check anything. You can make a proof for one
                reader: that you hold at least an amount, that a payment was made, or
                that a payroll run added up to a total, and nothing else. Each proof
                names who it is for and when it expires. Anyone can check one at{" "}
                <Link href="/verify" className={link}>
                  gloam.trade/verify
                </Link>{" "}
                without a wallet. Compliance travels with the user as a proof, instead
                of living with an operator as a standing view of everyone.
              </p>
              <p>
                Agents can pay privately too. The{" "}
                <Link href="/docs/agents" className={link}>
                  Gloam MCP server
                </Link>{" "}
                lets an AI agent shield funds, pay for tools over x402 and prove what
                it paid. The owner sets the limits: which assets, how much per payment
                and per day, which recipients, and when access ends. The agent works
                with handles, never with the secrets themselves.
              </p>

              <h2 className={h2}>What went live today</h2>
              <p>
                On Robinhood Chain mainnet, the pool takes USDG and $GLOAM. On Tempo
                mainnet, it takes USDC.e, pathUSD, USDT0 and OUSD. The pool has the
                same address on both chains,{" "}
                <span className="break-all text-foreground">{POOL}</span>.
              </p>
              <p>
                Adding money and paying privately are free. Cashing out to a public
                address costs 0.25%.
              </p>
              <p>
                This is a beta, so deposits are capped. Each stablecoin takes up to 500
                per deposit and 25,000 in total. $GLOAM takes up to 25,000 per deposit
                and 250,000 in total. Cash-outs and private payments are never limited.
              </p>
              <p>
                If your money sits on another chain, a bridge built on Relay deposit
                addresses lets you add it from 24 chains straight into Gloam.
              </p>
              <p>
                The proofs use keys from a public trusted setup. Thirteen people
                contributed, the result was sealed with a public drand round, and the
                transcript is open to anyone. The deploy script would not create a pool
                unless its verifiers accepted proofs made with these final keys and
                rejected proofs made with the old development keys.
              </p>

              <h2 className={h2}>What is public, and what is not</h2>
              <p>
                Privacy claims are easy to overstate, so here is the line. Adding money
                and cashing out are ordinary public transactions. Anyone can see the
                address and the amount at both edges. What stays hidden is everything
                in between: how much you hold, who paid whom, how much, and the link
                between a deposit and a later cash-out.
              </p>
              <p>
                The totals each vault holds are public on purpose. Anyone can read them
                at{" "}
                <Link href="/transparency" className={link}>
                  gloam.trade/transparency
                </Link>
                , straight from public nodes. You should be able to check that the pool
                holds what it should without trusting us.
              </p>
              <p>
                Hiding in a pool also depends on the crowd. The mainnet pools are new,
                so the crowd is thin at first. It grows with use, and until it does you
                should treat the link between your deposit and your cash-out as easier
                to guess.
              </p>

              <h2 className={h2}>What it does not do yet</h2>
              <p>
                This is beta software holding real money. We would rather you know its
                limits than assume more than it offers.
              </p>
              <p>
                The contracts and circuits were reviewed internally before launch. That
                review closed on 20 October with no Critical or High findings open. An
                external audit is planned and has not happened.
              </p>
              <p>Private trading is not live. The mainnet pool has no swap code at all.</p>
              <p>
                The Gloam team runs the relayer at launch. The relayer submits proofs
                and pays gas so your wallet does not appear next to your payment. It
                cannot move or redirect money, because the proof fixes where funds go.
                If it is down, you can send from your own wallet.
              </p>
              <p>
                The owner is a single wallet today, and a multisig is planned. The
                owner can lower limits or close deposits at once, but has no way to
                take pooled funds. Raising a limit, adding an asset or changing a
                verifier waits a public 3-day timelock, so anyone can see a change
                coming before it takes effect.
              </p>

              <h2 className={h2}>What comes next</h2>
              <p>
                The next step is handing more of Gloam to the people who use it.{" "}
                <Link href="/token" className={link}>
                  $GLOAM
                </Link>{" "}
                holders will vote on what comes next: new assets, new chains, deposit
                limits and fees. The first votes run in the open. Private voting, where
                you prove your balance without showing your wallet, comes after. Later,
                relayers that help run Gloam will stake $GLOAM to take part. And we are bringing on more
                partners, so other apps can offer private payments to their own users.
              </p>

              <h2 className={h2}>The point</h2>
              <p>
                A payment between two people should be their business. Public chains
                got settlement right and left privacy out, and that gap matters more as
                salaries, invoices and machine payments move onchain. Gloam is our
                answer. Private by default, provable when you choose, and held by no one
                but you.
              </p>
              <p>
                It is live now at{" "}
                <AppLink href="/app" className={link}>
                  gloam.trade/app
                </AppLink>
                . Read the{" "}
                <Link href="/docs/privacy-model" className={link}>
                  privacy model
                </Link>{" "}
                before you add money, and start small.
              </p>
            </div>

            <div className="mt-14 border-t border-line pt-8">
              <p className="t-label">Read more</p>
              <ol className="mt-4 space-y-2 text-[14px] leading-relaxed text-mute">
                {READ_MORE.map((s, i) => (
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
              <AppLink href="/app" className="btn btn-ink">
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
