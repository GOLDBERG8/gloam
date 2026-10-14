import type { Metadata } from "next";
import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SealedField } from "@/components/ui/SealedField";
import { ArrowUpRight } from "@/components/ui/ArrowUpRight";

const title = "Privacy with an operator, and privacy without one";
const description =
  "Tempo made private stablecoin payments generally available for enterprises with Zones. That settles whether payments should be public by default. It leaves a second question open: private from whom? A look at the two models, the law around them, and what Gloam runs today.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/blog/privacy-without-an-operator" },
  openGraph: {
    title,
    description,
    url: "/blog/privacy-without-an-operator",
    siteName: "Gloam",
    type: "article",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Gloam: private money on public chains" }],
  },
};

const link =
  "text-foreground underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-foreground";
const h2 = "pt-8 text-[26px] font-normal leading-snug tracking-[-0.015em] text-foreground";

/** Who can see a balance or a payment, in each model. */
const SEES: { who: string; zone: boolean; gloam: boolean }[] = [
  { who: "You", zone: true, gloam: true },
  { who: "The operator or the team", zone: true, gloam: false },
  { who: "The public", zone: false, gloam: false },
];

function Mark({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-foreground">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Sees it
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-mute">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      Does not
    </span>
  );
}

/** The cover: the one difference that matters, side by side. */
function WhoSees() {
  return (
    <div className="grid w-full max-w-[860px] grid-cols-1 gap-3 sm:grid-cols-2">
      {(
        [
          ["A Tempo Zone", "zone", "Private from the public. The operator sees the whole zone."],
          ["A Gloam vault", "gloam", "Private from everyone, Gloam included. You choose who sees what."],
        ] as const
      ).map(([name, key, line]) => (
        <div key={key} className="gl-glass p-2 shadow-pop">
          <div className="h-full rounded-[12px] bg-panel p-5">
            <p className="text-[15px] text-foreground">{name}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-mute">{line}</p>
            <ul className="mt-4 divide-y divide-line">
              {SEES.map((s) => (
                <li key={s.who} className="flex min-h-[44px] items-center justify-between gap-4 text-[14px]">
                  <span className="text-soft">{s.who}</span>
                  <Mark on={key === "zone" ? s.zone : s.gloam} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}

const COMPARE: { k: string; zone: string; gloam: string }[] = [
  { k: "What it is", zone: "A dedicated chain rooted to Tempo, run by one sequencer, proven back to Tempo", gloam: "A shielded vault contract on a public chain, with zero-knowledge proofs for every spend" },
  { k: "Who sees inside", zone: "The account holder and the operator, who sees the whole zone", gloam: "Only the holder of each note, and whoever they show a proof to" },
  { k: "Who can join", zone: "Whoever the operator admits", gloam: "Anyone with a browser, a passkey or a wallet" },
  { k: "Who can pause", zone: "The operator, and token issuers through their policies", gloam: "Token issuers through their policies (TIP-403 on Tempo). There is no Gloam pause on your funds" },
  { k: "Public at the edges", zone: "Deposit amount and sender, withdrawal amount and recipient", gloam: "Deposit amount and sender, cash-out amount and recipient" },
  { k: "Compliance model", zone: "Operator screening, records and pause", gloam: "Screening at the edges, issuer policies, and proofs a user hands to one named reader" },
  { k: "Built for", zone: "Enterprises: payroll, payouts, B2B and treasury", gloam: "People, small teams, contractors and AI agents" },
  { k: "Status", zone: "Generally available for enterprises, by contacting Tempo", gloam: "Live on Tempo and Robinhood Chain testnet. Not on mainnet yet" },
];

const SOURCES: { label: string; href: string }[] = [
  { label: "Tempo: Privacy is live on Tempo", href: "https://tempo.xyz/blog/privacy-is-live-on-tempo/" },
  { label: "Tempo docs: Zones protocol overview", href: "https://tempo.xyz/developers/docs/protocol/zones" },
  { label: "Tempo docs: Zone architecture", href: "https://tempo.xyz/developers/docs/protocol/zones/architecture" },
  { label: "Decrypt: Buterin and co-authors on Privacy Pools (2023)", href: "https://decrypt.co/155278/vitalik-buterin-pushes-for-privacy-pools-to-balance-anonymity-with-regulatory-compliance" },
  { label: "Greenberg Traurig: Fifth Circuit rejects OFAC sanction of Tornado Cash code", href: "https://www.gtlaw.com/it/insights/2024/12/fifth-circuit-rejects-ofac-sanction-of-tornado-cash-crypto-code" },
  { label: "Steptoe: Treasury delists Tornado Cash after the Fifth Circuit's decision", href: "https://www.steptoe.com/en/news-publications/international-compliance-blog/treasury-department-delists-tornado-cash-following-the-fifth-circuits-decision.html" },
  { label: "Gloam: privacy model (what the explorer shows)", href: "/docs/privacy-model" },
  { label: "Gloam: live vault totals", href: "/transparency" },
];

export default function PrivacyWithoutAnOperatorPost() {
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
              <time dateTime="2026-10-14">October 14, 2026</time>
            </p>
            <h1 className="t-display-l mt-5 text-balance">Privacy with an operator, and privacy without one</h1>
            <p className="mt-6 text-[18px] leading-relaxed text-soft sm:text-[19px]">
              Today Tempo made private stablecoin payments generally available for
              enterprises, with Deel as the first customer. That is good news for
              everyone who builds payments. It settles an argument: money should not
              be public by default. It also leaves a second question on the table.
              Private from whom?
            </p>
          </header>

          <div className="mx-auto mt-12 max-w-[1400px] px-4 sm:mt-16 sm:px-7">
            <div className="gl-panel mx-auto flex min-h-[420px] max-w-[1200px] items-center justify-center px-5 py-14 sm:min-h-[520px]">
              <SealedField drift />
              <WhoSees />
            </div>
          </div>

          <div className="mx-auto max-w-[68ch] px-6">
            <div className="mt-12 space-y-6 text-[17px] leading-[1.75] text-soft">
              <p>
                There are now two serious answers to that question on the same chain.
                One keeps your payments from the public and gives an operator the full
                view. The other keeps them from everyone, including the people who built
                it, and lets you prove what you need to without showing the rest. Both
                are real engineering. They are built for different people, and it is
                worth being precise about the difference, because the word
                &ldquo;private&rdquo; now covers both.
              </p>

              <h2 className={h2}>What Tempo Zones are</h2>
              <p>
                A Zone is a dedicated chain rooted to Tempo. One sequencer controls block
                production and what is visible, and it posts commitments and validity
                proofs back to Tempo so money can move in and out. Tempo&apos;s docs are
                direct about the trust model: &ldquo;The operator can see the entire Zone
                state.&rdquo; Inside the zone, outsiders, explorers and other users see
                nothing. Each account sees only its own balance and history.
              </p>
              <p>
                The operator also runs compliance. It decides who can join, which assets
                are allowed and how incoming funds are screened, and it can pause
                transfers when it needs to. Every token keeps its issuer&apos;s rules
                inside the zone, the same TIP-403 policies that apply on Tempo. The
                validity proofs mean the operator can order and include transactions but
                cannot take deposited money. At the edges, entering and leaving a zone
                stays public: a deposit shows its amount and sender, and a withdrawal
                shows its amount and recipient. In Deel&apos;s case, the treasury deposit
                is visible on Tempo, while who gets paid and how much is not.
              </p>
              <p>
                For a company like Deel this is the right shape. It has to reconcile,
                support its users and report, and it already holds its contractors&apos;
                records. A zone keeps those records away from competitors and onlookers
                while the company keeps the view it is required to keep. Zones are
                available to enterprises by contacting Tempo.
              </p>

              <h2 className={h2}>What Gloam is</h2>
              <p>
                Gloam is a shielded vault: a contract on a public chain that holds
                everyone&apos;s private balances together, and only releases money for a
                valid zero-knowledge proof. The design comes from the Zcash line of work
                that started in 2016, the same pattern Tornado and Railgun use. When you
                add money, you get a private note that only you hold the secret to. When
                you pay someone, a proof shows you own a note in the vault and publishes a
                spent-marker, without saying which note was yours. The person you pay
                gets a new note sealed to them.
              </p>
              <p>
                There is no operator in that picture. Gloam&apos;s team cannot see your
                balance or your payments, and there is no admin function that moves your
                money. When the Gloam relay submits a payment for you, so your wallet
                never appears next to it, the proof fixes where the money goes, and the
                relay can only submit it or refuse. If you need someone to see something,
                you make a proof for that one reader: that you hold at least an amount,
                that a payment was made, or that a payroll run added up to a total, each
                bound to who it is for and when it expires. Anyone can check one at{" "}
                <Link href="/verify" className={link}>
                  gloam.trade/verify
                </Link>{" "}
                with no wallet.
              </p>
              <p>
                The edges are public here too, and we say so in our docs: each deposit
                shows its address, asset and amount, and each cash out shows its amount
                and destination. What stays hidden is the link between them, how much
                you hold, and who paid whom inside the vault. That unlinkability depends
                on how many people use the vault, because a crowd is what you hide in.
              </p>
            </div>

            <h2 className={h2}>Side by side</h2>
            <div className="mt-6 overflow-x-auto rounded-[18px] border border-line">
              <table className="w-full min-w-[640px] text-left text-[14px] leading-relaxed">
                <thead>
                  <tr className="border-b border-line bg-surface/60 text-mute">
                    <th className="w-[26%] px-4 py-3 font-normal"> </th>
                    <th className="px-4 py-3 font-medium text-foreground">Tempo Zones</th>
                    <th className="px-4 py-3 font-medium text-foreground">Gloam</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {COMPARE.map((r) => (
                    <tr key={r.k} className="align-top">
                      <td className="px-4 py-3 text-mute">{r.k}</td>
                      <td className="px-4 py-3 text-soft">{r.zone}</td>
                      <td className="px-4 py-3 text-soft">{r.gloam}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 space-y-6 text-[17px] leading-[1.75] text-soft">
              <h2 className={h2}>The compliance question, honestly</h2>
              <p>
                The reason operator models exist is not technical. A pool with no operator
                has a harder legal history. In August 2022 the US Treasury sanctioned
                Tornado Cash. In November 2024 the Fifth Circuit ruled that its immutable
                smart contracts were not property that could be sanctioned, because no one
                owns them or can stop others from using them. In March 2025 Treasury
                removed Tornado Cash from its sanctions list, while the criminal case
                against its developers went on. The law moved toward code being code. It
                did not hand out a blank check, and any team building a permissionless
                pool should say that out loud.
              </p>
              <p>
                The research community has spent the same years on a middle path. In 2023
                Vitalik Buterin and co-authors proposed Privacy Pools, where a user can
                prove their money came from a set of deposits that excludes known bad
                ones, without revealing which deposit was theirs. Zcash has offered
                viewing keys since its early days. The common thread is that compliance
                can travel with the user as a proof, instead of living with an operator
                as a standing view of everyone.
              </p>
              <p>
                That is the line Gloam takes. On Tempo, issuer policies still apply at
                every edge of the vault: an address an issuer has blocked cannot add that
                token or cash it out. An issuer could even freeze the vault as a whole, a
                risk we document openly rather than hide. Screening against sanctions
                lists is built into the app and is part of our mainnet checklist. And when someone
                needs to see a payment, the user shows that one payment to that one
                reader, with an expiry, instead of an operator seeing all of them forever.
                It is a different bet than Zones makes. We think both bets are needed.
              </p>

              <h2 className={h2}>Who should use which</h2>
              <p>
                If you are an enterprise that must keep records of every payment and
                wants a vendor to run the rails, a Zone is a strong choice, and Tempo has
                done careful work on it. If you are a person, a contractor, a small team,
                a DAO or an AI agent, and you do not want any company to hold a view of
                your money, that is what Gloam is for. You do not need an introduction
                call. You need a browser.
              </p>
              <p>
                There is a practical gap Zones do not try to fill, too. Privacy inside a
                zone covers the people the operator admits. A Gloam claim link pays anyone
                with a link, even someone who has never used Gloam: they tap it, claim
                the money on their phone with a passkey or a wallet app, and the explorer
                shows nothing about who got paid or how much. And agents can pay each
                other privately over x402 and the Machine Payments Protocol through
                Gloam&apos;s MCP server, with handles instead of secrets and spending
                limits they cannot exceed.
              </p>

              <h2 className={h2}>What is on the ground today</h2>
              <p>
                Gloam has run one private core on two testnets since its hardened vaults
                were redeployed on September 29: Tempo Moderato and Robinhood Chain. Read
                from the chain on October 14, the two vaults together had taken 80
                deposits, settled 29 private transfers and carried 16 private
                payment messages. Those are public totals anyone can check on{" "}
                <Link href="/transparency" className={link}>
                  our transparency page
                </Link>
                . The amounts inside are not public, which is the point.
              </p>
              <p>
                What works today: adding money privately in stablecoins and, on Robinhood
                Chain, ETH and tokenized stocks; paying a Gloam address; claim links,
                live since yesterday; payroll for up to 200 people per run; proofs of
                funds, payments and payroll totals; passkey sign-in on Tempo with network
                fees covered; wallet apps on phones through WalletConnect; and the agent
                tools, listed in the MCP Registry.
              </p>
              <p>
                What does not, yet: mainnet. Private trading is built but switched off
                until its accounting is proven safe. The proving keys come from a
                development ceremony, and a public production ceremony plus an external
                audit come before any real money. The vaults are young, so their crowd is
                small, and you should treat unlinkability as weak until it grows. We would
                rather tell you that than let you assume more privacy than you have.
              </p>

              <h2 className={h2}>The point</h2>
              <p>
                A payments chain spent its launch day saying balances should not be
                public by default. We agree, and we are glad it is no longer a fringe
                view. The open question is whether private has to mean someone else gets
                the view instead. For the companies Zones serve, that trade makes sense.
                For everyone else, we are building the version where the only person who
                sees your money is you, and whoever you decide to show.
              </p>
              <p>
                Try it on testnet at{" "}
                <AppLink href="/app" className={link}>
                  gloam.trade/app
                </AppLink>
                , read the{" "}
                <Link href="/docs/privacy-model" className={link}>
                  privacy model
                </Link>
                , or compare us with other approaches in the{" "}
                <Link href="/docs/compare" className={link}>
                  comparison
                </Link>
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
