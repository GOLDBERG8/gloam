// PNGs of the merch print files (public/merch/*.svg), at print resolution.
// Run after build-print-files.py:  node scripts/merch/render-pngs.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// sharp ships with Next; resolve it from Next's own folder.
const fromApp = createRequire(join(app, "package.json"));
const sharp = createRequire(fromApp.resolve("next/package.json"))("sharp");
const dir = join(app, "public", "merch");

// [svg, png, width in px]: marks and lockups at 3000 px, the rest at 300 dpi.
const MM = (mm) => Math.round((mm / 25.4) * 300);
const LID = 416; // the lid wrap artboard, mm
const JOBS = [
  ["gloam-mark-ink.svg", "gloam-mark-ink-3000.png", 3000],
  ["gloam-mark-white.svg", "gloam-mark-white-3000.png", 3000],
  ["gloam-lockup-ink.svg", "gloam-lockup-ink-3000.png", 3000],
  ["gloam-lockup-white.svg", "gloam-lockup-white-3000.png", 3000],
  ["gloam-back-print-ink.svg", "gloam-back-print-ink.png", MM(180)],
  ["gloam-back-print-white.svg", "gloam-back-print-white.png", MM(180)],
  ["gloam-back-print-graphite.svg", "gloam-back-print-graphite.png", MM(180)],
  ["gloam-back-print-bone.svg", "gloam-back-print-bone.png", MM(180)],
  ["gloam-tissue-seal.svg", "gloam-tissue-seal.png", MM(43)],
  ["gloam-card-front.svg", "gloam-card-front.png", MM(154)],
  ["gloam-card-back.svg", "gloam-card-back.png", MM(154)],
  ["gloam-box-lid-layout.svg", "gloam-box-lid-layout.png", MM(LID)],
  ["gloam-box-lid-art.svg", "gloam-box-lid-art.png", MM(LID)],
  ["gloam-box-lid-deboss.svg", "gloam-box-lid-deboss.png", MM(LID)],
  ["gloam-box-lid-foil.svg", "gloam-box-lid-foil.png", MM(LID)],
  ["gloam-box-lid-guides.svg", "gloam-box-lid-guides.png", MM(LID)],
];

for (const [src, out, width] of JOBS) {
  const svg = readFileSync(join(dir, src));
  // Rasterise at twice the target from the file's own size (mm or px), then resize to the exact width.
  // sharp scales a px-sized SVG by density / 72, but a mm-sized one by density squared / 72.
  const [, size, unit] = /width="([\d.]+)(mm)?"/.exec(svg.toString()) ?? [];
  const density =
    unit === "mm"
      ? Math.ceil(Math.sqrt((width * 2 * 72 * 25.4) / Number(size)))
      : Math.min(100000, Math.ceil((width * 2 * 72) / Number(size)));
  const png = await sharp(svg, { density }).resize({ width }).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(dir, out), png);
  const meta = await sharp(png).metadata();
  console.log(out, `${meta.width} x ${meta.height}`);
}

// The one-page spec sheet: an HTML page rendered by Chrome at A4, 300 dpi.
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (existsSync(chrome)) {
  const out = join(dir, "gloam-merch-spec-sheet.png");
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--force-device-scale-factor=2",
    "--window-size=1240,1754",
    "--virtual-time-budget=4000",
    `--screenshot=${out}`,
    `file://${join(app, "scripts", "merch", "spec-sheet.html")}`,
  ], { stdio: "ignore" });
  const meta = await sharp(out).metadata();
  console.log("gloam-merch-spec-sheet.png", `${meta.width} x ${meta.height}`);
} else {
  console.log("Chrome not found: skipped the spec sheet");
}

// Everything in one zip, with a short read-me for the printer.
writeFileSync(
  join(dir, "gloam-merch-readme.txt"),
  [
    "Gloam merch, print files",
    "",
    "All vectors are outlined (no fonts needed) and sized in real millimetres. PNGs are 300 dpi; the mark and lockup are 3000 px wide.",
    "The mark is one path with its window knocked out, so a single ink prints it and the window shows the fabric.",
    "",
    "Mark, lockup: chest 6 cm, cap 4.5 cm (embroidery or woven patch 5 x 4 cm), tote 9 cm, box deboss 60 mm, foil lockup 50 mm.",
    "Back print: the line, 180 mm wide on the tee, 220 mm on the tote. Ink on Bone, tonal graphite or white on Ink, bone on Slate.",
    "Box: rigid lift-off lid, 32 x 26 x 9 cm, 1200 gsm board wrapped in matte black paper. Lid files share one artboard (lid top,",
    "  30 mm walls, 15 mm turn-ins, 3 mm bleed): art, deboss, foil and guides are separate layers. Send the printer these files",
    "  and ask for their dieline at this size; we drop the art on it.",
    "Tissue seal: 40 mm round, 1.5 mm bleed, CutContour die line.",
    "Insert card: A6, 148 x 105 mm, 3 mm bleed, 600 gsm uncoated bone board, one colour ink both sides.",
    "",
    "Spec sheet: gloam-merch-spec-sheet.png. Everything also at gloam.trade/merch.",
    "",
  ].join("\n"),
);
const zip = join(dir, "gloam-merch-files.zip");
rmSync(zip, { force: true });
const files = readdirSync(dir).filter((f) => /\.(svg|png|txt)$/.test(f)).sort();
execFileSync("zip", ["-q", "-X", zip, ...files], { cwd: dir });
console.log("gloam-merch-files.zip", `${files.length} files`);
