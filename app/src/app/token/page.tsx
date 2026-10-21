import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { FlowField } from "@/components/ui/FlowField";
import { SealedField } from "@/components/ui/SealedField";
import { MainnetCopy } from "@/components/MainnetCountdown";
import { robinhood } from "@/lib/chain";
import { liveMainnetNames, mainnetPool } from "@/lib/mainnet";
import { CopyAddress, TokenFilm } from "./TokenClient";

const GLOAM_TOKEN = "0xDcD885F5c60b3aD49F6D58718696417314e8724d";
const ORYNTH_URL = "https://www.orynth.dev/projects/gloam";
const EXPLORER_URL = `${robinhood.blockExplorers.default.url}/token/${GLOAM_TOKEN}`;

/** The Robinhood Chain mainnet pool (the one that lists $GLOAM) is filled in. */
const RH_MAINNET = mainnetPool(4663) !== null;

export const metadata: Metadata = {
  title: "$GLOAM",
  // Fixed at build time: says the pool holds it once the Robinhood Chain mainnet pool is filled in.
  description: RH_MAINNET
    ? "$GLOAM is the Gloam token on Robinhood Chain. Holders steer Gloam, half of Gloam's fees buy it back, and you can hold it privately in the Robinhood Chain mainnet pool."
    : "$GLOAM is the Gloam token on Robinhood Chain. Holders steer Gloam, half of Gloam's fees buy it back, and from mainnet you can hold it privately.",
  alternates: { canonical: "/token" },
  openGraph: {
    title: "$GLOAM, the Gloam token",
    description: "Governance, buybacks from Gloam's fees, private holding and first access. Live on Robinhood Chain.",
    images: ["/media/gloam-token-poster.jpg"],
  },
};

/* ---------- the facts ---------- */

const FACTS = [
  { value: "500,000", body: "Fixed supply. The contract has no way to mint more." },
  { value: "Locked", body: "The launch liquidity is locked for good." },
  { value: "No presale", body: "Every token started in the pool. No team allocation." },
  { value: "Robinhood Chain", body: "Live on mainnet today, launched on Orynth." },
];

/* ---------- what it does ---------- */

const USES = [
  {
    n: "01",
    title: "Governance",
    body: "Holders vote on what Gloam does next: new assets, new chains, deposit limits and fees. The first votes run in the open. Private voting, where you prove your balance without showing your wallet, comes after.",
    when: "First vote at mainnet",
  },
  {
    n: "02",
    title: "Buybacks",
    body: "At mainnet, deposits and private payments are free and cash-outs carry a 0.25% fee. Half of Gloam's fees buy $GLOAM from the market: half of that is burned, half goes to the Gloam treasury.",
    when: "Starts when fees go live",
  },
  {
    n: "03",
    title: "Private holding",
    body: "The Robinhood Chain mainnet pool lists $GLOAM next to USDG. Shield it and your balance leaves the public record, and you can still prove it to someone when you need to.",
    when: "At mainnet",
  },
  {
    n: "04",
    title: "First access",
    body: "Holders get new Gloam features first, from agent tools to payroll upgrades.",
    when: "After mainnet",
  },
];

/* ---------- what holders ask ---------- */

const QUESTIONS = [
  {
    q: "What is it for, besides governance?",
    a: "Buybacks tie it to how much Gloam gets used, you can hold it privately in the vault from mainnet, and holders get new features first.",
  },
  {
    q: "How much does the team hold?",
    a: "None. There was no team allocation and no presale, so there is nothing to vest or unlock. Every token started in the pool, and the launch liquidity is locked.",
  },
  {
    q: "Then how is the team paid?",
    a: "By the product, not the token. From mainnet a cash-out carries a 0.25% fee: half of Gloam's fees run the team and the service, half buy back $GLOAM. Orynth also pays a small creator fee on trades. Payroll and API fees come later.",
  },
  {
    q: "Burned or kept?",
    a: "Half of every buyback is burned, so the supply only goes down. The other half goes to the Gloam treasury.",
  },
  {
    q: "Is there staking?",
    a: "Not for yield. Later, relayers that help run Gloam will stake $GLOAM to take part.",
  },
  {
    q: "Is there an airdrop for testnet users?",
    a: "Nothing is decided. If that changes, you will hear it from @gloamtrade on X first.",
  },
];

/* ---------- roadmap ---------- */

type Phase = { tag: string; title: string; done?: boolean; items: string[] };

const PHASES: Phase[] = [
  {
    tag: "Done",
    title: "Rails first",
    done: true,
    items: [
      "$GLOAM live on Robinhood Chain, with a fixed supply and locked liquidity",
      "Private payments live on Tempo and Robinhood Chain testnet",
      "Trusted setup closed with 13 contributors",
      "$GLOAM listed in the mainnet pool, ready for deploy",
    ],
  },
  {
    tag: "Next",
    title: "Mainnet",
    items: [
      "Gloam goes live on Tempo and Robinhood Chain mainnet",
      "Shield $GLOAM in the Robinhood Chain pool: 25,000 per deposit, 250,000 in total during beta",
      "Fees switch on, and half of them start buying back $GLOAM",
      "The first holder vote, held in the open",
    ],
  },
  {
    tag: "Then",
    title: "After mainnet",
    items: ["Private voting with a proof of your balance", "Holders get new features first"],
  },
  {
    tag: "Later",
    title: "Run the network",
    items: ["Relayers stake $GLOAM to help run Gloam"],
  },
];

/* ---------- the same, once mainnet is live ---------- */

const LIVE_USES: typeof USES = [
  { ...USES[0], when: "First vote next" },
  {
    ...USES[1],
    body: "On mainnet, deposits and private payments are free and cash-outs carry a 0.25% fee. Half of Gloam's fees buy $GLOAM from the market: half of that is burned, half goes to the Gloam treasury.",
    when: "Fees live on mainnet",
  },
  RH_MAINNET
    ? {
        ...USES[2],
        body: "The Robinhood Chain mainnet pool lists $GLOAM next to USDG. Shield it (up to 25,000 per deposit and 250,000 in total during beta) and your balance leaves the public record, and you can still prove it to someone when you need to.",
        when: "Live on mainnet",
      }
    : USES[2],
  { ...USES[3], when: "Next" },
];

const LIVE_QUESTIONS: typeof QUESTIONS = QUESTIONS.map((x, i) =>
  i === 0 && RH_MAINNET
    ? { ...x, a: "Buybacks tie it to how much Gloam gets used, you can hold it privately in the Robinhood Chain mainnet vault, and holders get new features first." }
    : i === 2
      ? { ...x, a: "By the product, not the token. On mainnet a cash-out carries a 0.25% fee: half of Gloam's fees run the team and the service, half buy back $GLOAM. Orynth also pays a small creator fee on trades. Payroll and API fees come later." }
      : x
);

const LIVE_PHASES: Phase[] = [
  {
    tag: "Done",
    title: "Rails first",
    done: true,
    items: [
      "$GLOAM live on Robinhood Chain, with a fixed supply and locked liquidity",
      "Private payments live on Tempo and Robinhood Chain testnet",
      "Trusted setup closed with 13 contributors",
    ],
  },
  {
    tag: "Done",
    title: "Mainnet",
    done: true,
    items: [
      `Gloam live on ${liveMainnetNames()} mainnet`,
      ...(RH_MAINNET ? ["Shield $GLOAM in the Robinhood Chain pool: 25,000 per deposit, 250,000 in total during beta"] : []),
      "Fees on: deposits and payments free, 0.25% on cash-outs, and half of Gloam's fees buy back $GLOAM",
    ],
  },
  {
    tag: "Next",
    title: "Holders",
    items: ["The first holder vote, held in the open", "Private voting with a proof of your balance", "Holders get new features first"],
  },
  {
    tag: "Later",
    title: "Run the network",
    items: ["Relayers stake $GLOAM to help run Gloam"],
  },
];

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UseRows({ uses }: { uses: typeof USES }) {
  return (
    <>
      {uses.map((u) => (
        <div
          key={u.n}
          className="grid grid-cols-1 gap-3 border-b border-line px-5 py-6 last:border-0 sm:grid-cols-[180px_minmax(0,1fr)_200px] sm:items-start sm:gap-8 sm:px-7"
        >
          <p className="flex items-baseline gap-3 text-[18px] tracking-[-0.01em] text-foreground">
            <span className="tnum text-[13px] text-mute">{u.n}</span>
            {u.title}
          </p>
          <p className="max-w-[60ch] text-[14.5px] leading-relaxed text-mute">{u.body}</p>
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-sealed-soft px-3 py-1.5 text-[12.5px] font-medium text-sealed sm:justify-self-end">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sealed" />
            {u.when}
          </span>
        </div>
      ))}
    </>
  );
}

function QuestionRows({ questions }: { questions: typeof QUESTIONS }) {
  return (
    <>
      {questions.map((x) => (
        <div key={x.q} className="grid grid-cols-1 gap-2 py-6 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:gap-8">
          <dt className="text-[17px] leading-snug tracking-[-0.01em]">{x.q}</dt>
          <dd className="text-[14.5px] leading-relaxed text-mute">{x.a}</dd>
        </div>
      ))}
    </>
  );
}

function PhaseList({ phases }: { phases: Phase[] }) {
  return (
    <ol className="relative">
      {phases.map((p, i) => (
        <li key={p.title} className="relative grid grid-cols-[28px_1fr] gap-5 pb-12 last:pb-0">
          {i < phases.length - 1 && (
            <span aria-hidden className="absolute left-[13px] top-8 bottom-0 w-px bg-line" />
          )}
          <span
            aria-hidden
            className={`relative mt-0.5 grid h-7 w-7 place-items-center rounded-full ${
              p.done ? "bg-sealed text-panel" : "border border-line-strong bg-panel text-mute"
            }`}
          >
            {p.done ? <Check /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0">
            <p className="t-label">{p.tag}</p>
            <p className="mt-1.5 text-[22px] leading-snug tracking-[-0.015em]">{p.title}</p>
            <ul className="mt-4 space-y-2.5">
              {p.items.map((it) => (
                <li key={it} className="flex gap-3 text-[14.5px] leading-relaxed text-mute">
                  <span aria-hidden className={`mt-[9px] h-1 w-1 shrink-0 rounded-full ${p.done ? "bg-sealed" : "bg-faint"}`} />
                  <span className="min-w-0">{it}</span>
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function TokenPage() {
  return (
    <div className="relative min-h-screen bg-panel text-foreground">
      <Header />

      <main>
        {/* hero */}
        <section className="mx-auto max-w-[1400px] px-4 pt-3 sm:px-7 sm:pt-6">
          <div className="gl-panel flex min-h-[560px] flex-col justify-end px-5 pb-8 pt-24 sm:px-12 sm:pb-12 lg:min-h-[640px]">
            <FlowField />
            <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
              <div className="max-w-[560px]">
                <p className="t-label">The Gloam token</p>
                <h1 className="t-display-xl mt-5">$GLOAM</h1>
                <p className="mt-6 max-w-[42ch] text-[16px] leading-relaxed text-soft sm:text-[17px]">
                  Private money is coming onchain, and $GLOAM holders get a say in
                  where it goes. Live on Robinhood Chain.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <a href={ORYNTH_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ink btn-lg">
                    Get $GLOAM on Orynth
                  </a>
                  <Link
                    href="#roadmap"
                    className="t-label inline-flex items-center gap-1.5 text-foreground transition-colors hover:text-sealed"
                  >
                    See the roadmap <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>

              <div className="gl-glass min-w-0 p-2">
                <TokenFilm />
              </div>
            </div>
          </div>
        </section>

        {/* facts */}
        <section className="mx-auto max-w-[1240px] px-6 py-20 sm:py-28">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_2fr]">
            <div>
              <h2 className="t-display-l max-w-[12ch]">Built to last</h2>
              <p className="mt-5 max-w-[36ch] text-[15px] leading-relaxed text-mute">
                $GLOAM has been live for a while. We let it sit quietly and put
                every hour into the rails first. Now the token goes to work.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
              {FACTS.map((f) => (
                <div key={f.value} className="border-t border-foreground pt-5">
                  <p className="tnum text-[26px] leading-tight tracking-[-0.02em]">{f.value}</p>
                  <p className="mt-3 text-[14px] leading-relaxed text-mute">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* what it does */}
        <section className="mx-auto max-w-[1400px] px-4 sm:px-7">
          <div className="gl-panel bg-surface px-5 py-14 sm:px-12 sm:py-20">
            <SealedField tone="soft" />
            <div className="relative mx-auto max-w-[1120px]">
              <p className="t-label">What it does</p>
              <h2 className="t-display-l mt-4 max-w-[18ch]">Four jobs for one token</h2>

              <div className="mt-12 overflow-hidden rounded-[18px] border border-line bg-panel">
                <MainnetCopy live={<UseRows uses={LIVE_USES} />} before={<UseRows uses={USES} />} />
              </div>
            </div>
          </div>
        </section>

        {/* what holders ask */}
        <section id="questions" className="mx-auto max-w-[1240px] scroll-mt-20 px-6 pt-20 sm:pt-28">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_2fr]">
            <div>
              <p className="t-label">Questions</p>
              <h2 className="t-display-l mt-4 max-w-[12ch]">What holders ask</h2>
            </div>
            <dl className="divide-y divide-line border-y border-line">
              <MainnetCopy live={<QuestionRows questions={LIVE_QUESTIONS} />} before={<QuestionRows questions={QUESTIONS} />} />
            </dl>
          </div>
        </section>

        {/* roadmap */}
        <section id="roadmap" className="mx-auto max-w-[1240px] scroll-mt-20 px-6 py-20 sm:py-28">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_2fr]">
            <div>
              <p className="t-label">Roadmap</p>
              <h2 className="t-display-l mt-4 max-w-[12ch]">Where $GLOAM goes from here</h2>
              <p className="mt-5 max-w-[36ch] text-[15px] leading-relaxed text-mute">
                Each step lands with the product, not before it.{" "}
                <MainnetCopy
                  live="Mainnet went live Wednesday 21 October, 13:00 UTC."
                  before="Mainnet goes live Wednesday 21 October, 13:00 UTC."
                />
              </p>
            </div>
            <MainnetCopy live={<PhaseList phases={LIVE_PHASES} />} before={<PhaseList phases={PHASES} />} />
          </div>
        </section>

        {/* contract */}
        <section className="mx-auto max-w-[1400px] px-4 pb-14 sm:px-7 sm:pb-20">
          <div className="theme-dark gl-panel grid grid-cols-1 gap-10 border border-line bg-background px-5 py-14 text-foreground sm:px-12 sm:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <SealedField tone="soft" />
            <div className="relative">
              <p className="t-label">Contract</p>
              <h2 className="t-display-l mt-4 max-w-[14ch]">Check it yourself</h2>
              <p className="mt-5 max-w-[42ch] text-[15px] leading-relaxed text-mute">
                Always copy the address from here or from @gloamtrade on X. Anything
                else claiming to be $GLOAM is not ours.
              </p>
            </div>
            <div className="relative min-w-0">
              <CopyAddress address={GLOAM_TOKEN} />
              <ul className="mt-6 divide-y divide-line border-y border-line text-[15px]">
                {[
                  ["Network", "Robinhood Chain (4663)"],
                  ["Standard", "ERC-20, 18 decimals"],
                  ["Supply", "500,000, fixed"],
                ].map(([k, v]) => (
                  <li key={k} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-4">
                    <span>{k}</span>
                    <span className="tnum text-[14px] text-mute">{v}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3">
                <a
                  href={EXPLORER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="t-label inline-flex items-center gap-1.5 text-foreground transition-colors hover:text-sealed"
                >
                  View on the explorer <span aria-hidden>↗</span>
                </a>
                <a
                  href={ORYNTH_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="t-label inline-flex items-center gap-1.5 text-foreground transition-colors hover:text-sealed"
                >
                  Trade on Orynth <span aria-hidden>↗</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* note */}
        <section className="mx-auto max-w-[1240px] px-6 pb-20 sm:pb-28">
          <p className="max-w-[72ch] text-[13px] leading-relaxed text-mute">
            No promises on price. $GLOAM is a governance and utility token. It is
            not a share in Gloam and not a claim on its revenue: buybacks are
            how Gloam uses part of its fees, not a payout to holders. Nothing here is financial advice. Read the{" "}
            <Link href="/disclosures" className="text-foreground underline underline-offset-4 hover:text-sealed">
              risk disclosures
            </Link>
            .
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
