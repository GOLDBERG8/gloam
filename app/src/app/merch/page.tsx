import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { FlowField } from "@/components/ui/FlowField";
import { KitPill } from "@/components/brand/KitAsset";
import { HeroBox, MerchPieces } from "@/components/merch/MerchShop";

// Not linked from the nav and kept out of search until the first run ships.
export const metadata: Metadata = {
  title: "Merch",
  description: "The Gloam box: a heavyweight tee, a hoodie, a cap, a canvas tote and a card in one black box. Mockups, specs and print-ready files.",
  robots: { index: false, follow: false },
};

const M = "/merch";

const FIRST_RUN: [string, string, string][] = [
  ["20", "Tees", "10 Ink, 10 Bone"],
  ["10", "Hoodies", "Ink"],
  ["15", "Caps", "Embroidered"],
  ["10", "Totes", "Natural canvas"],
  ["15", "Boxes", "One per kit"],
];

type File = { label: string; href: string };
const pair = (base: string, label = ""): File[] => [
  { label: `${label}${label ? " " : ""}SVG`, href: `${M}/${base}.svg` },
  { label: `${label}${label ? " " : ""}PNG`, href: `${M}/${base}.png` },
];

const DOWNLOADS: { title: string; note: string; items: { label: string; meta: string; files: File[] }[] }[] = [
  {
    title: "Logo",
    note: "One colour each. The window is knocked out, so it shows the fabric.",
    items: [
      {
        label: "Mark",
        meta: "Chest, cap, deboss",
        files: [
          { label: "Ink SVG", href: `${M}/gloam-mark-ink.svg` },
          { label: "Ink PNG", href: `${M}/gloam-mark-ink-3000.png` },
          { label: "White SVG", href: `${M}/gloam-mark-white.svg` },
          { label: "White PNG", href: `${M}/gloam-mark-white-3000.png` },
        ],
      },
      {
        label: "Lockup",
        meta: "Foil, labels",
        files: [
          { label: "Ink SVG", href: `${M}/gloam-lockup-ink.svg` },
          { label: "Ink PNG", href: `${M}/gloam-lockup-ink-3000.png` },
          { label: "White SVG", href: `${M}/gloam-lockup-white.svg` },
          { label: "White PNG", href: `${M}/gloam-lockup-white-3000.png` },
        ],
      },
    ],
  },
  {
    title: "Garments",
    note: "The line, outlined, set 180 mm wide for the back. Scale it to 220 mm for the tote.",
    items: [
      { label: "Back print, ink", meta: "On Bone", files: pair("gloam-back-print-ink") },
      { label: "Back print, graphite", meta: "Tonal on Ink", files: pair("gloam-back-print-graphite") },
      { label: "Back print, white", meta: "On Ink", files: pair("gloam-back-print-white") },
      { label: "Back print, bone", meta: "On Slate", files: pair("gloam-back-print-bone") },
    ],
  },
  {
    title: "Box",
    note: "Lid wrap for 32 × 26 × 9 cm: one artboard, 3 mm bleed, each layer its own file.",
    items: [
      { label: "Lid layout", meta: "All layers, for reference", files: pair("gloam-box-lid-layout") },
      { label: "Lid art", meta: "Matte black to the bleed", files: pair("gloam-box-lid-art") },
      { label: "Deboss", meta: "The mark, 60 mm", files: pair("gloam-box-lid-deboss") },
      { label: "Foil", meta: "Optional, front wall", files: pair("gloam-box-lid-foil") },
      { label: "Guides", meta: "Trim, folds, safe area, bleed", files: pair("gloam-box-lid-guides") },
      { label: "Tissue seal", meta: "40 mm round, die line", files: pair("gloam-tissue-seal") },
    ],
  },
  {
    title: "Card",
    note: "A6, 148 × 105 mm, 3 mm bleed.",
    items: [
      { label: "Front", meta: "Bone, ink", files: pair("gloam-card-front") },
      { label: "Back", meta: "Bone, ink", files: pair("gloam-card-back") },
    ],
  },
  {
    title: "Spec",
    note: "Every piece, its blank, method, placement and size, on one page.",
    items: [{ label: "Spec sheet", meta: "PNG", files: [{ label: "PNG", href: `${M}/gloam-merch-spec-sheet.png` }] }],
  },
];

export default function MerchPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main>
        <section className="mx-auto max-w-[1400px] px-4 pt-3 sm:px-7 sm:pt-6">
          <div className="gl-panel grid items-center gap-2 px-6 pb-8 pt-14 sm:gap-6 sm:px-12 sm:pb-14 sm:pt-20 lg:min-h-[560px] lg:grid-cols-[1fr_1.2fr]">
            <FlowField />
            <div className="relative">
              <p className="t-label text-soft">Merch</p>
              <h1 className="t-display-xl mt-4 max-w-[11ch]">The Gloam box</h1>
              <p className="mt-6 max-w-[46ch] text-[16px] leading-relaxed text-soft sm:text-[17px]">
                A small first run for the people building this with us. Heavy cotton, quiet marks, one black box.
                Nothing loud, all of it worth keeping.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                <a href={`${M}/gloam-merch-files.zip`} download className="btn btn-ink btn-lg">
                  Download all print files
                </a>
                <a href="#pieces" className="btn btn-quiet btn-lg">
                  See the pieces <span aria-hidden>↓</span>
                </a>
              </div>
            </div>
            <div className="relative mx-auto aspect-[600/470] w-full max-w-[700px]">
              <HeroBox />
            </div>
          </div>
        </section>

        <div className="mx-auto flex max-w-[1240px] flex-col gap-24 px-4 pb-8 pt-16 sm:px-6 sm:pt-20">
          <section aria-labelledby="first-run">
            <div className="grid gap-4 border-t border-line pt-10 lg:grid-cols-[1fr_1.4fr] lg:gap-12">
              <h2 id="first-run" className="t-display-l">First run</h2>
              <p className="max-w-[58ch] text-[16px] leading-relaxed text-mute lg:pt-3">
                Small on purpose: enough for the team, the testers and the people who helped early. Printed, not
                embroidered, except the cap. If it goes well, the next run grows.
              </p>
            </div>
            <ul className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-line bg-line sm:grid-cols-5">
              {FIRST_RUN.map(([n, what, note]) => (
                <li key={what} className="flex flex-col gap-1 bg-panel px-5 py-6">
                  <span className="tnum text-[40px] font-light leading-none tracking-[-0.03em]">{n}</span>
                  <span className="mt-2 text-[14px]">{what}</span>
                  <span className="text-[12.5px] text-mute">{note}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="pieces" id="pieces" className="scroll-mt-24">
            <div className="grid gap-4 border-t border-line pt-10 lg:grid-cols-[1fr_1.4fr] lg:gap-12">
              <h2 id="pieces-title" className="t-display-l">The pieces</h2>
              <p className="max-w-[58ch] text-[16px] leading-relaxed text-mute lg:pt-3">
                Each one shows the mark at its real size and place. Switch the colour to see the print it takes:
                tonal on Ink, ink on Bone, bone on Slate.
              </p>
            </div>
            <div className="mt-10">
              <MerchPieces />
            </div>
          </section>

          <section aria-labelledby="downloads" id="downloads" className="scroll-mt-24">
            <div className="grid gap-4 border-t border-line pt-10 lg:grid-cols-[1fr_1.4fr] lg:gap-12">
              <h2 id="downloads-title" className="t-display-l">Print files</h2>
              <p className="max-w-[58ch] text-[16px] leading-relaxed text-mute lg:pt-3">
                Everything a printer needs. Vectors are outlined, so no fonts are required, and sized in real millimetres.
                PNGs are 300 dpi, the mark and lockup 3000 px wide.
              </p>
            </div>
            <div className="mt-10 grid gap-10">
              {DOWNLOADS.map((g) => (
                <div key={g.title} id={g.title === "Box" ? "box-files" : undefined} className="grid scroll-mt-24 gap-4 lg:grid-cols-[1fr_2.4fr] lg:gap-12">
                  <div>
                    <h3 className="text-[17px]">{g.title}</h3>
                    <p className="mt-1 max-w-[34ch] text-[13px] leading-relaxed text-mute">{g.note}</p>
                  </div>
                  <ul className="divide-y divide-line border-y border-line">
                    {g.items.map((it) => (
                      <li key={it.label} className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                        <span className="min-w-0">
                          <span className="block text-[14px]">{it.label}</span>
                          <span className="block text-[12.5px] text-mute">{it.meta}</span>
                        </span>
                        <span className="flex flex-wrap gap-1.5">
                          {it.files.map((f) => (
                            <KitPill key={f.href} href={f.href}>
                              {f.label}
                            </KitPill>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <a href={`${M}/gloam-merch-files.zip`} download className="btn btn-ink btn-lg">
                  Download all
                </a>
                <span className="text-[13px] text-mute">Every file above in one zip.</span>
              </div>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
