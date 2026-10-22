"""
Print-ready merch files for /merch, written to public/merch/.

Every file is pure vector: the mark is one path with its window knocked out
(so a single ink prints it and the window shows the garment), and all type is
outlined from the brand's own Aeonik files, so a print shop needs no fonts.
Sizes are real millimetres. PNGs are rendered afterwards by render-pngs.mjs.

    python3 -m venv .venv && .venv/bin/pip install fonttools brotli uharfbuzz
    .venv/bin/python scripts/merch/build-print-files.py
    node scripts/merch/render-pngs.mjs
"""

import io
import os

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FONTS = os.path.join(APP, "public", "fonts")
OUT = os.path.join(APP, "public", "merch")

INK = "#0B0C0E"
WHITE = "#FFFFFF"
BONE = "#ECE7DD"
GRAPHITE = "#3A3D43"  # tonal print on Ink
GREEN = "#2E7D53"
GREEN_SOFT = "#E6F2EA"
CUT = "#EC008C"  # CutContour spot colour for the die line


def num(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


class Face:
    """One Aeonik weight: shapes text with HarfBuzz (kerning included) and outlines it."""

    def __init__(self, name: str):
        tt = TTFont(os.path.join(FONTS, f"Aeonik-{name}.woff2"))
        tt.flavor = None
        buf = io.BytesIO()
        tt.save(buf)
        data = buf.getvalue()
        self.tt = TTFont(io.BytesIO(data))
        self.font = hb.Font(hb.Face(data))
        self.upem = self.tt["head"].unitsPerEm
        self.glyphs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        self.cap = self.tt["OS/2"].sCapHeight / self.upem

    def run(self, text: str, size: float, x: float = 0, y: float = 0, tracking: float = 0) -> tuple[str, float]:
        """Outlined path for `text` at font size `size`, baseline at y. Returns (d, width)."""
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.font, buf, {"kern": True, "liga": True})
        k = size / self.upem
        pen = SVGPathPen(self.glyphs, ntos=num)
        cx = 0.0
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            name = self.order[info.codepoint]
            self.glyphs[name].draw(TransformPen(pen, (k, 0, 0, -k, x + (cx + pos.x_offset) * k, y - pos.y_offset * k)))
            cx += pos.x_advance + tracking * self.upem
        width = (cx - tracking * self.upem) * k
        return pen.getCommands(), width


LIGHT = Face("Light")
REGULAR = Face("Regular")
MEDIUM = Face("Medium")


def rr(x: float, y: float, w: float, h: float, r: float) -> str:
    return (
        f"M{num(x + r)} {num(y)}H{num(x + w - r)}A{num(r)} {num(r)} 0 0 1 {num(x + w)} {num(y + r)}"
        f"V{num(y + h - r)}A{num(r)} {num(r)} 0 0 1 {num(x + w - r)} {num(y + h)}"
        f"H{num(x + r)}A{num(r)} {num(r)} 0 0 1 {num(x)} {num(y + h - r)}V{num(y + r)}"
        f"A{num(r)} {num(r)} 0 0 1 {num(x + r)} {num(y)}Z"
    )


def mark(x: float, y: float, size: float) -> str:
    """The mark as one path, window knocked out (fill-rule evenodd). Geometry from components/Logo.tsx."""
    s = size / 32
    return rr(x, y, 32 * s, 32 * s, 9 * s) + rr(x + 15 * s, y + 4 * s, 12 * s, 12 * s, 3.5 * s)


def svg(w: float, h: float, body: str, unit: str = "mm", title: str = "") -> str:
    head = f'<svg xmlns="http://www.w3.org/2000/svg" width="{num(w)}{unit}" height="{num(h)}{unit}" viewBox="0 0 {num(w)} {num(h)}">'
    t = f"<title>{title}</title>" if title else ""
    return f"{head}{t}{body}</svg>\n"


def write(name: str, content: str) -> None:
    with open(os.path.join(OUT, name), "w") as f:
        f.write(content)
    print("wrote", name)


def lockup(fill: str) -> str:
    """The official lockup (brand/kit/gloam-wordmark.svg): mark 32, Gloam in Medium 25.5 at x 41.5, baseline 24.6, -1.5% tracking."""
    d, _ = MEDIUM.run("Gloam", 25.5, 41.5, 24.6, -0.015)
    return f'<path fill="{fill}" fill-rule="evenodd" d="{mark(0, 0, 32)}"/><path fill="{fill}" d="{d}"/>'


def main() -> None:
    os.makedirs(OUT, exist_ok=True)

    # The mark and the lockup, one colour each.
    for tone, fill in (("ink", INK), ("white", WHITE)):
        write(f"gloam-mark-{tone}.svg", svg(32, 32, f'<path fill="{fill}" fill-rule="evenodd" d="{mark(0, 0, 32)}"/>', unit="", title="Gloam mark"))
        write(f"gloam-lockup-{tone}.svg", svg(117, 32, lockup(fill), unit="", title="Gloam lockup"))

    # Back print: the line, 180 mm wide, set in Regular. Ink for Bone, white or
    # tonal graphite for Ink, bone for Slate.
    slogan = "Private money on public chains"
    d, w = REGULAR.run(slogan, 100, 0, 0, -0.01)
    k = 180 / w
    cap_mm = REGULAR.cap * 100 * k
    for tone, fill in (("ink", INK), ("white", WHITE), ("graphite", GRAPHITE), ("bone", BONE)):
        body = f'<g transform="translate(0 {num(cap_mm)}) scale({num(k)})"><path fill="{fill}" d="{d}"/></g>'
        write(f"gloam-back-print-{tone}.svg", svg(180, cap_mm * 1.32, body, title="Back print, 180 mm wide"))

    # Tissue seal, the one sticker: 40 mm round, bone, the mark in ink, 1.5 mm bleed, CutContour circle.
    R, SB = 20, 1.5
    c = R + SB
    seal = (
        f'<circle cx="{num(c)}" cy="{num(c)}" r="{num(c)}" fill="{BONE}"/>'
        f'<path fill="{INK}" fill-rule="evenodd" d="{mark(c - 8, c - 8, 16)}"/>'
        f'<circle id="CutContour" cx="{num(c)}" cy="{num(c)}" r="{R}" fill="none" stroke="{CUT}" stroke-width="0.25"/>'
    )
    write("gloam-tissue-seal.svg", svg(2 * c, 2 * c, seal, title="Tissue seal, 40 mm round, 1.5 mm bleed, CutContour"))

    # Insert card, A6 landscape, 148 x 105 mm plus 3 mm bleed each side.
    B, CW, CH = 3, 148, 105
    def card(body: str, ground: str) -> str:
        return svg(CW + 2 * B, CH + 2 * B, f'<rect width="{CW + 2 * B}" height="{CH + 2 * B}" fill="{ground}"/><g transform="translate({B} {B})">{body}</g>', title="Insert card, A6 with 3 mm bleed")

    front = [f'<path fill="{INK}" fill-rule="evenodd" d="{mark(12, 12, 13)}"/>']
    for i, line in enumerate(("Private money", "on public chains.")):
        ld, _ = LIGHT.run(line, 15.5, 12, 76 + i * 15.5, -0.02)
        front.append(f'<path fill="{INK}" d="{ld}"/>')
    write("gloam-card-front.svg", card("".join(front), BONE))

    back = []
    hd, _ = REGULAR.run("Thank you for being here early.", 8.2, 12, 26, -0.015)
    back.append(f'<path fill="{INK}" d="{hd}"/>')
    for i, line in enumerate((
        "What you hold, what you send and who you pay",
        "stay yours. That was the whole idea, and you",
        "helped prove it works.",
    )):
        bd, _ = REGULAR.run(line, 4.4, 12, 40 + i * 6.6, -0.005)
        back.append(f'<path fill="#34373C" d="{bd}"/>')
    fd, _ = MEDIUM.run("gloam.trade", 4.4, 0, 0, -0.01)
    back.append(f'<g transform="translate(12 93)"><path fill="{INK}" d="{fd}"/></g>')
    back.append(f'<path fill="{INK}" fill-rule="evenodd" d="{mark(CW - 12 - 7, 87.3, 7)}"/>')
    write("gloam-card-back.svg", card("".join(back), BONE))

    box_lid()


def box_lid() -> None:
    """
    The lid of a rigid lift-off-lid box, 320 x 260 x 90 mm, laid flat for wrapping:
    top panel, 30 mm walls, 15 mm turn-ins, 3 mm bleed. The wrap is matte black
    paper, so the art is black to the bleed; the deboss (the mark, 60 mm, centred
    on the top) and the optional foil (the lockup, 50 mm, on the front wall) are
    separate layers on the same artboard so they register. The printer's own
    dieline replaces the guides; the art drops onto it at the same size.
    """
    TW, TH, D, T, B = 320, 260, 30, 15, 3
    O = B + D + T
    W, H = TW + 2 * (D + T + B), TH + 2 * (D + T + B)
    x0, y0, x1, y1 = O, O, O + TW, O + TH

    def poly(pts: list) -> str:
        return "M" + "L".join(f"{num(a)} {num(b)}" for a, b in pts) + "Z"

    # The wrap's outline: the top panel with a wall and turn-in on each side (corners notched).
    e = D + T
    trim = poly([
        (x0, y0 - e), (x1, y0 - e), (x1, y0), (x1 + e, y0), (x1 + e, y1), (x1, y1),
        (x1, y1 + e), (x0, y1 + e), (x0, y1), (x0 - e, y1), (x0 - e, y0), (x0, y0),
    ])
    folds = (
        f"M{x0} {y0}H{x1}V{y1}H{x0}Z"
        f"M{x0} {y0 - D}H{x1}M{x0} {y1 + D}H{x1}M{x0 - D} {y0}V{y1}M{x1 + D} {y0}V{y1}"
    )
    safe = poly([(x0 + 10, y0 + 10), (x1 - 10, y0 + 10), (x1 - 10, y1 - 10), (x0 + 10, y1 - 10)])
    M = 60
    deboss = f'<path fill="{INK}" fill-rule="evenodd" d="{mark(x0 + (TW - M) / 2, y0 + (TH - M) / 2, M)}"/>'
    lw = 50
    lk = lw / 117
    foil = (
        f'<g transform="translate({num(x0 + (TW - lw) / 2)} {num(y1 + (D - 32 * lk) / 2)}) scale({num(lk)})">'
        f"{lockup(INK)}</g>"
    )

    def labels(fill: str) -> str:
        out = []
        for text, x, y in (
            ("Lid top 320 x 260 mm. Deboss: the mark, 60 mm, centred.", x0 + 10, y0 + 8),
            ("Safe area: 10 mm in from every fold.", x0 + 14, y1 - 14),
            ("Front wall 30 mm. Optional foil: the lockup, 50 mm wide.", x0 + 4, y1 + D - 3),
            ("Turn-in 15 mm", x0 + 4, y1 + D + T - 4),
            ("Bleed 3 mm", x0 - e + 2, B + 1.8),
        ):
            ld, _ = REGULAR.run(text, 3.6, x, y, 0)
            out.append(f'<path fill="{fill}" d="{ld}"/>')
        return "".join(out)

    guides = (
        f'<g fill="none" stroke-width="0.35">'
        f'<path d="{trim}" stroke="{CUT}"/>'
        f'<path d="{folds}" stroke="#00A3E0" stroke-dasharray="3 2"/>'
        f'<path d="{safe}" stroke="#2E7D53" stroke-dasharray="1 1.5"/>'
        f'<rect x="{B / 2}" y="{B / 2}" width="{num(W - B)}" height="{num(H - B)}" stroke="#979BA2" stroke-dasharray="0.6 1.2"/>'
        f"</g>"
    )
    art = f'<rect width="{W}" height="{H}" fill="{INK}"/>'
    write("gloam-box-lid-art.svg", svg(W, H, art, title="Lid wrap art: matte black to the 3 mm bleed"))
    write("gloam-box-lid-deboss.svg", svg(W, H, deboss, title="Deboss layer: the mark, 60 mm, centred on the lid top"))
    write("gloam-box-lid-foil.svg", svg(W, H, foil, title="Foil layer, optional: the lockup, 50 mm, front wall, matte black foil"))
    write("gloam-box-lid-guides.svg", svg(W, H, guides + labels("#5F636A"), title="Guides: trim (magenta), folds (blue), safe area (green), bleed (grey)"))
    layout = (
        f'<rect width="{W}" height="{H}" fill="#F3F4F5"/>'
        f'<path d="{trim}" fill="{INK}"/>'
        f'<path fill="#1C1E22" fill-rule="evenodd" d="{mark(x0 + (TW - M) / 2, y0 + (TH - M) / 2, M)}"/>'
        f'<g transform="translate({num(x0 + (TW - lw) / 2)} {num(y1 + (D - 32 * lk) / 2)}) scale({num(lk)})">{lockup("#2A2D33")}</g>'
        + guides
        + labels("#C9CCD1")
    )
    write("gloam-box-lid-layout.svg", svg(W, H, layout, title="Lid wrap layout, all layers, for reference"))

if __name__ == "__main__":
    main()
