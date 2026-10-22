"use client";

import { useState } from "react";
import { BoxClosed, BoxOpen, Cap, CardFace, FABRICS, Hoodie, Tee, Tote, type Colorway } from "./Mockups";

type Option<T extends string> = { value: T; label: string; swatch?: string };

/** A row of choices: colour swatches or plain text, as a radio group. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] transition-colors sm:h-9 ${
              on ? "border-foreground text-foreground" : "border-line text-soft hover:border-line-strong hover:text-foreground"
            }`}
          >
            {o.swatch && (
              <span aria-hidden className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10 dark:ring-white/15" style={{ background: o.swatch }} />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const COLORWAYS: Option<Colorway>[] = (["ink", "bone", "slate"] as const).map((c) => ({
  value: c,
  label: FABRICS[c].name,
  swatch: FABRICS[c].base,
}));

function Spec({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="mt-5 divide-y divide-line border-t border-line text-[13.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[96px_1fr] gap-4 py-2.5 sm:grid-cols-[112px_1fr]">
          <dt className="text-mute">{k}</dt>
          <dd className="min-w-0 leading-relaxed text-soft">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Piece({
  title,
  run,
  stage,
  controls,
  spec,
  wide = false,
}: {
  title: string;
  run: string;
  stage: React.ReactNode;
  controls: React.ReactNode;
  spec: [string, React.ReactNode][];
  wide?: boolean;
}) {
  return (
    <article className={`gl-card flex min-w-0 flex-col overflow-hidden ${wide ? "lg:col-span-2" : ""}`}>
      <div className={`grid place-items-center bg-surface px-6 py-8 ${wide ? "aspect-[16/10] sm:aspect-[2/1]" : "aspect-[5/4]"}`}>
        <div className={`h-full w-full ${wide ? "max-w-[720px]" : "max-w-[560px]"}`}>{stage}</div>
      </div>
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-[20px] leading-tight tracking-[-0.01em]">{title}</h3>
          <span className="text-[13px] text-mute">{run}</span>
        </div>
        {controls && <div className="mt-4 flex flex-col gap-2">{controls}</div>}
        <Spec rows={spec} />
      </div>
    </article>
  );
}

function printOn(c: Colorway): string {
  return c === "ink" ? "tonal graphite, or white" : FABRICS[c].printName;
}

function TeePiece() {
  const [c, setC] = useState<Colorway>("ink");
  const [side, setSide] = useState<"front" | "back">("front");
  return (
    <Piece
      title="Heavyweight tee"
      run="First run: 20"
      stage={<Tee colorway={c} side={side} />}
      controls={
        <>
          <Choice label="Colour" options={COLORWAYS} value={c} onChange={setC} />
          <Choice
            label="Side"
            options={[
              { value: "front", label: "Front" },
              { value: "back", label: "Back" },
            ]}
            value={side}
            onChange={setSide}
          />
        </>
      }
      spec={[
        ["Blank", "300 gsm heavyweight cotton, garment dyed, boxy fit"],
        ["Front", "The mark, 6 cm, wearer's left chest"],
        ["Back", "Private money on public chains, 18 cm wide, 8 cm below the collar"],
        ["Print", `Screen print or DTF, in ${printOn(c)}`],
        ["Label", "Woven neck label, the mark on ink"],
      ]}
    />
  );
}

function HoodiePiece() {
  const [c, setC] = useState<Colorway>("ink");
  return (
    <Piece
      title="Hoodie"
      run="First run: 10, in Ink"
      stage={<Hoodie colorway={c} />}
      controls={<Choice label="Colour" options={COLORWAYS} value={c} onChange={setC} />}
      spec={[
        ["Blank", "400 gsm brushed-back cotton fleece, rib cuffs and hem, flat tonal drawcords"],
        ["Front", "The mark, 6 cm, wearer's left chest"],
        ["Print", `Screen print or DTF, in ${printOn(c)}`],
        ["Back", "Plain"],
      ]}
    />
  );
}

function CapPiece() {
  const [c, setC] = useState<Colorway>("ink");
  const [finish, setFinish] = useState<"embroidery" | "patch">("embroidery");
  return (
    <Piece
      title="Cap"
      run="First run: 15"
      stage={<Cap colorway={c} finish={finish} />}
      controls={
        <>
          <Choice label="Colour" options={COLORWAYS} value={c} onChange={setC} />
          <Choice
            label="Finish"
            options={[
              { value: "embroidery", label: "Embroidered" },
              { value: "patch", label: "Woven patch" },
            ]}
            value={finish}
            onChange={setFinish}
          />
        </>
      }
      spec={[
        ["Blank", "6 panel, washed cotton twill, low profile, strap back with a metal clasp"],
        ["Front", finish === "embroidery" ? "The mark, 4.5 cm, centre front" : "Woven patch, 5 × 4 cm, centre front, the mark inside"],
        [
          "Finish",
          finish === "embroidery"
            ? `Flat embroidery in ${c === "ink" ? "tonal graphite thread" : FABRICS[c].printName + " thread"}. The one piece we embroider: a printed cap looks cheap.`
            : "Woven patch, sewn on. The cheaper option, still clean.",
        ],
      ]}
    />
  );
}

function TotePiece() {
  const [c, setC] = useState<"bone" | "ink">("bone");
  return (
    <Piece
      title="Canvas tote"
      run="First run: 10"
      stage={<Tote colorway={c} />}
      controls={
        <Choice
          label="Colour"
          options={[
            { value: "bone", label: "Natural", swatch: "#e6dfd1" },
            { value: "ink", label: "Ink", swatch: "#1c1d20" },
          ]}
          value={c}
          onChange={setC}
        />
      }
      spec={[
        ["Blank", "12 oz cotton canvas, 38 × 42 cm, 65 cm handles"],
        ["Front", "The mark, 9 cm, centred. The line, 22 cm wide, 6 cm above the base"],
        ["Print", c === "bone" ? "Screen print or DTF, in ink" : "Screen print or DTF, in bone"],
      ]}
    />
  );
}

function CardPiece() {
  return (
    <Piece
      wide
      title="Insert card"
      run="One in every box"
      stage={
        <div className="grid h-full grid-cols-2 place-items-center gap-4 sm:gap-8">
          <div className="w-full max-w-[400px] -rotate-2">
            <CardFace side="front" />
          </div>
          <div className="w-full max-w-[400px] rotate-1">
            <CardFace side="back" />
          </div>
        </div>
      }
      controls={null}
      spec={[
        ["Size", "A6, 148 × 105 mm, with 3 mm bleed in the files"],
        ["Stock", "600 gsm uncoated board in bone"],
        ["Print", "One colour, ink, both sides. Letterpress if the budget allows"],
      ]}
    />
  );
}

function BoxPiece() {
  const [view, setView] = useState<"closed" | "open">("closed");
  return (
    <Piece
      wide
      title="The box"
      run="First run: 15"
      stage={view === "closed" ? <BoxClosed /> : <BoxOpen />}
      controls={
        <Choice
          label="View"
          options={[
            { value: "closed", label: "Lid on" },
            { value: "open", label: "Open" },
          ]}
          value={view}
          onChange={setView}
        />
      }
      spec={[
        ["Box", "Rigid lift-off lid, 32 × 26 × 9 cm"],
        ["Board", "1200 gsm rigid board, wrapped in matte black paper"],
        ["Lid", "Blind deboss of the mark, 60 mm, centred. Optional: the lockup in matte black foil on the front wall"],
        ["Inside", "Black tissue closed with one seal (the mark on bone, 40 mm round), and the insert card, 148 × 105 mm"],
        [
          "Files",
          <span key="files">
            Lid art, deboss and foil as separate layers on one artboard, with the 3 mm bleed, the safe area and the
            folds marked.{" "}
            <a href="#box-files" className="text-foreground underline decoration-line-strong underline-offset-4 hover:decoration-foreground">
              Box files
            </a>
          </span>,
        ],
        [
          "Printer",
          "Send the printer these files and ask for their dieline at this size; we drop the art on it.",
        ],
      ]}
    />
  );
}

/** The pieces, two to a row, the box across the top. */
export function MerchPieces() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <BoxPiece />
      <TeePiece />
      <HoodiePiece />
      <CapPiece />
      <TotePiece />
      <CardPiece />
    </div>
  );
}

/** The hero render: the box, lid on. */
export function HeroBox() {
  return <BoxClosed />;
}
