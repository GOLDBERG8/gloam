"use client";

import { useId } from "react";

/**
 * Hand-drawn SVG renders of the merch pieces. Garments are flat lays at a real
 * scale (the units below are noted per piece), so the mark sits where it would
 * be printed and at its printed size. The mark is always the one path with its
 * window knocked out, so it reads the way a single ink prints it: the window
 * shows the fabric.
 */

export type Colorway = "ink" | "bone" | "slate";

type Fabric = {
  name: string;
  base: string;
  deep: string;
  lift: string;
  line: string;
  /** The print colour on this fabric, and what to call it. */
  print: string;
  printName: string;
  /** How strongly folds show on this fabric. */
  fold: number;
};

export const FABRICS: Record<Colorway, Fabric> = {
  ink: { name: "Ink", base: "#1c1d20", deep: "#0f1012", lift: "#2c2e33", line: "#0a0b0c", print: "#4a4d54", printName: "tonal graphite", fold: 1 },
  bone: { name: "Bone", base: "#e8e3d8", deep: "#cdc5b6", lift: "#f5f1e9", line: "#b9b09f", print: "#0b0c0e", printName: "ink", fold: 1 },
  slate: { name: "Slate", base: "#5e646b", deep: "#474c52", lift: "#727880", line: "#3c4146", print: "#ece7dd", printName: "bone", fold: 0.55 },
};

const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;

/** The Gloam mark (components/Logo.tsx geometry), one path, window knocked out. */
export const MARK_D = rr(0, 0, 32, 32, 9) + rr(15, 4, 12, 12, 3.5);

function Mark({ x, y, size, fill, opacity = 1 }: { x: number; y: number; size: number; fill: string; opacity?: number }) {
  return <path d={MARK_D} fillRule="evenodd" fill={fill} opacity={opacity} transform={`translate(${x} ${y}) scale(${size / 32})`} />;
}

/** A stable, selector-safe id prefix for this render's gradients and filters. */
function useSvgId(): string {
  return `m${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

/** Soft shading shared by the garments: light from above, darker sides and hem, a cast shadow. */
function GarmentDefs({ id, dark }: { id: string; dark: boolean }) {
  const k = dark ? 1 : 0.7;
  return (
    <defs>
      <linearGradient id={`${id}v`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity={0.09 * k} />
        <stop offset="0.4" stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity={0.2 * k} />
      </linearGradient>
      <linearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity={0.22 * k} />
        <stop offset="0.2" stopColor="#000" stopOpacity="0" />
        <stop offset="0.8" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity={0.22 * k} />
      </linearGradient>
      <filter id={`${id}s`} x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#000" floodOpacity={dark ? 0.32 : 0.18} />
      </filter>
      <filter id={`${id}b`} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
    </defs>
  );
}

// ---------------------------------------------------------------- tee

/** Heavyweight tee, flat lay. 8 units = 1 cm; the body is 56 cm across. */
export function Tee({ colorway, side }: { colorway: Colorway; side: "front" | "back" }) {
  const f = FABRICS[colorway];
  const id = useSvgId();
  const dark = colorway !== "bone";
  const neck = side === "front" ? "C352 104 248 104 228 46" : "C330 64 270 64 228 46";
  const body =
    "M228 46 Q160 58 88 76 C66 120 40 168 18 214 L90 250 C96 246 102 240 106 234 C104 360 100 500 100 626 Q300 640 500 626 C500 500 496 360 494 234 C498 240 504 246 510 250 L582 214 C560 168 534 120 512 76 Q440 58 372 46 " +
    neck +
    "Z";
  return (
    <svg viewBox="0 0 600 680" role="img" aria-label={`${f.name} tee, ${side}`} className="h-full w-full">
      <GarmentDefs id={id} dark={dark} />
      <clipPath id={`${id}c`}>
        <path d={body} />
      </clipPath>
      <ellipse cx="300" cy="652" rx="230" ry="12" fill="#000" opacity={dark ? 0.16 : 0.08} filter={`url(#${id}b)`} />
      <g filter={`url(#${id}s)`}>
        <path d={body} fill={f.base} />
      </g>
      <g clipPath={`url(#${id}c)`}>
        {/* sleeves a touch darker, and their seams */}
        <path d="M88 76 C66 120 40 168 18 214 L90 250 C96 246 102 240 106 234 C104 170 98 120 88 76Z M512 76 C534 120 560 168 582 214 L510 250 C504 246 498 240 494 234 C496 170 502 120 512 76Z" fill="#000" opacity={dark ? 0.12 : 0.05} />
        <path d="M88 76 C98 120 104 170 106 234 M512 76 C502 120 496 170 494 234" stroke={f.line} strokeWidth="1.4" fill="none" opacity="0.55" />
        {/* folds */}
        <g filter={`url(#${id}b)`} fill="none" strokeLinecap="round" opacity={f.fold}>
          <path d="M170 300 C200 380 190 470 160 560" stroke="#000" strokeWidth="16" opacity={dark ? 0.16 : 0.045} />
          <path d="M420 260 C400 360 418 460 446 590" stroke="#000" strokeWidth="14" opacity={dark ? 0.14 : 0.04} />
          <path d="M300 520 C320 560 360 590 400 600" stroke="#000" strokeWidth="12" opacity={dark ? 0.12 : 0.035} />
          <path d="M240 200 C260 300 250 420 228 520" stroke="#fff" strokeWidth="18" opacity={dark ? 0.035 : 0.12} />
        </g>
        <rect width="600" height="680" fill={`url(#${id}v)`} />
        <rect width="600" height="680" fill={`url(#${id}h)`} />
        {/* stitching: sleeve hems and the bottom hem */}
        <g stroke={f.line} strokeWidth="1.3" strokeDasharray="4 3" fill="none" opacity="0.7">
          <path d="M25 224 L94 258" />
          <path d="M575 224 L506 258" />
          <path d="M102 612 Q300 626 498 612" />
        </g>
      </g>
      {side === "front" ? (
        <>
          {/* the inside of the back, the woven label, and the collar rib */}
          <path d="M228 46 C248 104 352 104 372 46 C340 58 260 58 228 46Z" fill={f.deep} />
          <path d="M228 46 C260 58 340 58 372 46" stroke={f.lift} strokeWidth="5" fill="none" opacity="0.6" />
          <rect x="286" y="58" width="28" height="15" rx="1.5" fill="#101113" />
          <Mark x={296.5} y={60.5} size={7} fill="#ece7dd" />
          <path d="M228 46 C248 104 352 104 372 46" stroke={f.base} strokeWidth="13" fill="none" />
          <path d="M228 46 C248 104 352 104 372 46" stroke="#000" strokeWidth="13" fill="none" opacity={dark ? 0.1 : 0.04} />
          <path d="M231 56 C252 113 348 113 369 56" stroke={f.line} strokeWidth="1.2" strokeDasharray="3.5 3" fill="none" opacity="0.7" />
          {/* the mark, 6 cm, wearer's left chest */}
          <Mark x={352} y={160} size={48} fill={f.print} />
        </>
      ) : (
        <>
          <path d="M228 46 C270 64 330 64 372 46" stroke={f.base} strokeWidth="11" fill="none" />
          <path d="M228 46 C270 64 330 64 372 46" stroke="#000" strokeWidth="11" fill="none" opacity={dark ? 0.12 : 0.05} />
          <path d="M231 54 C270 72 330 72 369 54" stroke={f.line} strokeWidth="1.2" strokeDasharray="3.5 3" fill="none" opacity="0.7" />
          {/* the line, 18 cm wide, 8 cm below the collar */}
          <text
            x="228"
            y="126"
            textLength="144"
            lengthAdjust="spacingAndGlyphs"
            fill={f.print}
            style={{ fontFamily: "Aeonik, system-ui, sans-serif", fontSize: 9.4, letterSpacing: "-0.01em" }}
          >
            Private money on public chains
          </text>
        </>
      )}
      <path d={body} fill="none" stroke="#fff" strokeOpacity={dark ? 0.06 : 0} strokeWidth="1.2" />
    </svg>
  );
}

// ---------------------------------------------------------------- hoodie

/** Hoodie, flat lay. 7 units = 1 cm; the body is 60 cm across. */
export function Hoodie({ colorway }: { colorway: Colorway }) {
  const f = FABRICS[colorway];
  const id = useSvgId();
  const dark = colorway !== "bone";
  const body =
    "M206 118 C170 130 130 140 98 152 C70 260 46 420 38 560 L100 566 C108 430 116 330 124 262 C126 400 128 520 130 600 L470 600 C472 520 474 400 476 262 C484 330 492 430 500 566 L562 560 C554 420 530 260 502 152 C470 140 430 130 394 118 C376 146 338 160 300 160 C262 160 224 146 206 118Z";
  const ribL = "M38 560 L100 566 L98 614 L44 614Z";
  const ribR = "M562 560 L500 566 L502 614 L556 614Z";
  const band = "M130 600 L470 600 L470 650 L130 650Z";
  const ribLines = (x0: number, x1: number, y0: number, y1: number) => {
    const out = [];
    for (let x = x0 + 2; x < x1; x += 4) out.push(`M${x} ${y0}V${y1}`);
    return out.join("");
  };
  return (
    <svg viewBox="0 0 600 690" role="img" aria-label={`${f.name} hoodie`} className="h-full w-full">
      <GarmentDefs id={id} dark={dark} />
      <clipPath id={`${id}c`}>
        <path d={body} />
      </clipPath>
      <clipPath id={`${id}r`}>
        <path d={`${ribL}${ribR}${band}`} />
      </clipPath>
      <ellipse cx="300" cy="668" rx="250" ry="12" fill="#000" opacity={dark ? 0.16 : 0.08} filter={`url(#${id}b)`} />
      <g filter={`url(#${id}s)`}>
        {/* the hood, lying behind the shoulders */}
        <path d="M206 118 C190 40 254 12 300 12 C346 12 410 40 394 118Z" fill={f.base} />
        <path d={body} fill={f.base} />
        <path d={`${ribL}${ribR}${band}`} fill={f.base} />
      </g>
      <path d="M206 118 C190 40 254 12 300 12 C346 12 410 40 394 118Z" fill="#000" opacity={dark ? 0.14 : 0.04} />
      <g clipPath={`url(#${id}r)`}>
        <path d={`${ribLines(38, 102, 556, 616)}${ribLines(498, 562, 556, 616)}${ribLines(130, 470, 600, 650)}`} stroke="#000" strokeWidth="1" opacity={dark ? 0.35 : 0.12} />
        <rect width="600" height="690" fill={`url(#${id}v)`} />
      </g>
      <g clipPath={`url(#${id}c)`}>
        <path d="M98 152 C70 260 46 420 38 560 L100 566 C108 430 116 330 124 262 C118 220 108 180 98 152Z M502 152 C530 260 554 420 562 560 L500 566 C492 430 484 330 476 262 C482 220 492 180 502 152Z" fill="#000" opacity={dark ? 0.12 : 0.05} />
        <path d="M98 152 C110 190 120 230 124 262 M502 152 C490 190 480 230 476 262" stroke={f.line} strokeWidth="1.4" fill="none" opacity="0.55" />
        <g filter={`url(#${id}b)`} fill="none" strokeLinecap="round" opacity={f.fold}>
          <path d="M180 260 C210 330 200 400 176 470" stroke="#000" strokeWidth="16" opacity={dark ? 0.15 : 0.045} />
          <path d="M424 250 C404 330 414 410 436 480" stroke="#000" strokeWidth="14" opacity={dark ? 0.13 : 0.04} />
          <path d="M70 330 C66 400 60 470 56 530" stroke="#000" strokeWidth="10" opacity={dark ? 0.15 : 0.04} />
          <path d="M530 330 C534 400 540 470 544 530" stroke="#000" strokeWidth="10" opacity={dark ? 0.15 : 0.04} />
          <path d="M250 190 C268 280 262 360 248 420" stroke="#fff" strokeWidth="18" opacity={dark ? 0.035 : 0.12} />
        </g>
        {/* kangaroo pocket */}
        <path d="M206 432 L394 432 C412 472 426 522 432 600 L168 600 C174 522 188 472 206 432Z" fill="#000" opacity={dark ? 0.06 : 0.025} />
        <path d="M206 432 L394 432" stroke={f.line} strokeWidth="1.4" opacity="0.6" />
        <path d="M210 440 L390 440" stroke={f.line} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.6" />
        <path d="M206 432 C188 472 174 522 168 600 M394 432 C412 472 426 522 432 600" stroke="#000" strokeWidth="3" fill="none" opacity={dark ? 0.4 : 0.16} />
        <rect width="600" height="690" fill={`url(#${id}v)`} />
        <rect width="600" height="690" fill={`url(#${id}h)`} />
      </g>
      {/* the hood's opening and its edge */}
      <path d="M232 120 C226 72 262 42 300 40 C338 42 374 72 368 120 C352 140 326 152 300 156 C274 152 248 140 232 120Z" fill={f.deep} />
      <path d="M232 120 C226 72 262 42 300 40 C338 42 374 72 368 120 C352 140 326 152 300 156 C274 152 248 140 232 120Z" stroke={f.base} strokeWidth="11" fill="none" />
      <path d="M232 120 C226 72 262 42 300 40 C338 42 374 72 368 120" stroke="#000" strokeWidth="11" fill="none" opacity={dark ? 0.08 : 0.03} />
      <path d="M262 150 C280 158 320 158 338 150" stroke={f.line} strokeWidth="1.2" fill="none" opacity="0.6" />
      {/* flat drawcords, tonal */}
      <circle cx="285" cy="150" r="3.4" fill={f.deep} stroke={f.lift} strokeWidth="1" />
      <circle cx="315" cy="150" r="3.4" fill={f.deep} stroke={f.lift} strokeWidth="1" />
      <path d="M285 152 C283 200 280 250 277 302 M315 152 C317 200 320 250 323 302" stroke={f.lift} strokeWidth="5.5" strokeLinecap="round" fill="none" />
      <path d="M285 152 C283 200 280 250 277 302 M315 152 C317 200 320 250 323 302" stroke="#000" strokeWidth="5.5" strokeLinecap="round" fill="none" opacity={dark ? 0.15 : 0.04} />
      <rect x="273.5" y="298" width="7" height="16" rx="2.5" fill={f.deep} />
      <rect x="319.5" y="298" width="7" height="16" rx="2.5" fill={f.deep} />
      {/* the mark, 6 cm, wearer's left chest */}
      <Mark x={351} y={206} size={42} fill={f.print} />
      <path d={body} fill="none" stroke="#fff" strokeOpacity={dark ? 0.06 : 0} strokeWidth="1.2" />
    </svg>
  );
}

// ---------------------------------------------------------------- cap

/** 6-panel cap, three-quarter view, the bill toward the front left. The mark is 4.5 cm, centre front. */
export function Cap({ colorway, finish }: { colorway: Colorway; finish: "embroidery" | "patch" }) {
  const f = FABRICS[colorway];
  const id = useSvgId();
  const dark = colorway !== "bone";
  const crown = "M166 294 C156 196 232 100 356 90 C462 82 526 170 518 294 C440 314 262 318 166 294Z";
  const bill = "M170 284 C120 296 62 316 36 346 C92 376 258 370 378 310 C306 316 226 306 170 284Z";
  const billUnder = "M36 346 C92 376 258 370 378 310 C382 316 382 322 378 326 C262 386 92 392 34 356 C33 352 34 349 36 346Z";
  // The front panels face left of us: the mark is drawn on them, narrowed and tilted with the panel.
  const panel = "matrix(0.84 -0.12 0.06 1 0 0)";
  const patch = colorway === "ink" ? "#2c2e33" : "#141518";
  return (
    <svg viewBox="0 40 560 380" role="img" aria-label={`${f.name} cap, ${finish === "patch" ? "woven patch" : "embroidered"}`} className="h-full w-full">
      <defs>
        <linearGradient id={`${id}g`} x1="0.15" y1="0" x2="0.95" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={dark ? 0.1 : 0.24} />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity={dark ? 0.38 : 0.2} />
        </linearGradient>
        <linearGradient id={`${id}bt`} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor="#fff" stopOpacity={dark ? 0.06 : 0.2} />
          <stop offset="1" stopColor="#000" stopOpacity={dark ? 0.28 : 0.12} />
        </linearGradient>
        <pattern id={`${id}sat`} width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
          <rect width="2" height="0.8" fill="#fff" opacity={dark ? 0.07 : 0.1} />
        </pattern>
        <linearGradient id={`${id}em`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
        <pattern id={`${id}wov`} width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="1.4" fill="#fff" opacity="0.05" />
        </pattern>
        <filter id={`${id}s`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#000" floodOpacity={dark ? 0.32 : 0.18} />
        </filter>
        <filter id={`${id}b`}>
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <filter id={`${id}bb`}>
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <clipPath id={`${id}c`}>
          <path d={crown} />
        </clipPath>
      </defs>
      <ellipse cx="300" cy="372" rx="240" ry="16" fill="#000" opacity={dark ? 0.2 : 0.1} filter={`url(#${id}bb)`} />
      <g filter={`url(#${id}s)`}>
        <path d={crown} fill={f.base} />
        <path d={billUnder} fill={f.deep} />
        <path d={bill} fill={f.base} />
      </g>
      <g clipPath={`url(#${id}c)`}>
        <rect y="40" width="560" height="380" fill={`url(#${id}g)`} />
        {/* seams: centre front, and the side seam; topstitched */}
        <g fill="none">
          <path d="M354 92 C300 136 270 214 262 312" stroke={f.line} strokeWidth="1.6" opacity="0.7" />
          <path d="M358 90 C420 132 452 214 456 308" stroke={f.line} strokeWidth="1.6" opacity="0.7" />
          <path d="M354 92 C250 120 200 196 190 300" stroke={f.line} strokeWidth="1.4" opacity="0.5" />
          <g stroke={f.line} strokeWidth="1" strokeDasharray="3 2.6" opacity="0.55">
            <path d="M349 98 C295 142 265 218 257 312 M359 98 C305 142 275 218 267 312" />
            <path d="M363 96 C425 138 457 218 461 308" />
          </g>
        </g>
        <path d="M166 280 C262 306 440 304 518 280 L518 320 L166 320Z" fill="#000" opacity={dark ? 0.22 : 0.08} />
      </g>
      {/* the bill: light on top, and its stitching rows */}
      <path d={bill} fill={`url(#${id}bt)`} />
      <g stroke={f.line} strokeWidth="1.1" strokeDasharray="3.5 3" fill="none" opacity="0.6">
        <path d="M150 294 C108 308 70 324 52 344" />
        <path d="M134 302 C98 316 72 332 60 348" />
        <path d="M66 352 C120 366 250 360 356 318" />
        <path d="M84 356 C136 368 254 362 344 326" />
      </g>
      <path d="M36 346 C92 376 258 370 378 310" stroke="#fff" strokeOpacity={dark ? 0.07 : 0.3} strokeWidth="1" fill="none" />
      {/* eyelets and the button */}
      <ellipse cx="244" cy="160" rx="4.5" ry="4" fill={f.deep} stroke={f.lift} strokeWidth="1.3" />
      <ellipse cx="430" cy="156" rx="4.5" ry="4.5" fill={f.deep} stroke={f.lift} strokeWidth="1.3" />
      <ellipse cx="356" cy="91" rx="15" ry="6.5" fill={f.base} />
      <ellipse cx="354" cy="89.5" rx="12" ry="4.2" fill={f.lift} opacity="0.7" />
      <g transform={`translate(214 188) ${panel}`}>
        {finish === "embroidery" ? (
          <g>
            <path d={MARK_D} fillRule="evenodd" fill="#000" opacity="0.35" transform="translate(0 2.5) scale(3)" filter={`url(#${id}b)`} />
            <Mark x={0} y={0} size={96} fill={f.print} />
            <path d={MARK_D} fillRule="evenodd" fill={`url(#${id}sat)`} transform="scale(3)" />
            <path d={MARK_D} fillRule="evenodd" fill={`url(#${id}em)`} transform="scale(3)" />
          </g>
        ) : (
          <g>
            <path d={rr(-6, 6, 108, 84, 10)} fill="#000" opacity="0.3" transform="translate(0 2)" filter={`url(#${id}b)`} />
            <path d={rr(-6, 6, 108, 84, 10)} fill={patch} />
            <path d={rr(-6, 6, 108, 84, 10)} fill={`url(#${id}wov)`} />
            <path d={rr(-2, 10, 100, 76, 7)} fill="none" stroke="#ece7dd" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2.4 2" />
            <Mark x={27} y={27} size={42} fill="#ece7dd" />
          </g>
        )}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------- tote

/** Canvas tote. 10 units = 1 cm; the bag is 38 x 42 cm. */
export function Tote({ colorway }: { colorway: "bone" | "ink" }) {
  const id = useSvgId();
  const dark = colorway === "ink";
  const base = dark ? "#1c1d20" : "#e6dfd1";
  const deep = dark ? "#121315" : "#cfc6b4";
  const line = dark ? "#0a0b0c" : "#b3a891";
  const print = dark ? "#ece7dd" : "#0b0c0e";
  const bag = rr(70, 210, 380, 420, 5);
  return (
    <svg viewBox="0 0 520 680" role="img" aria-label={`${dark ? "Ink" : "Natural"} canvas tote`} className="h-full w-full">
      <defs>
        <filter id={`${id}t`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.09 0" result="a" />
          <feComposite in="a" in2="SourceGraphic" operator="in" />
        </filter>
        <linearGradient id={`${id}v`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={dark ? 0.05 : 0.18} />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity={dark ? 0.25 : 0.12} />
        </linearGradient>
        <linearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity={dark ? 0.25 : 0.1} />
          <stop offset="0.12" stopColor="#000" stopOpacity="0" />
          <stop offset="0.88" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity={dark ? 0.25 : 0.1} />
        </linearGradient>
        <filter id={`${id}s`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#000" floodOpacity={dark ? 0.32 : 0.16} />
        </filter>
        <filter id={`${id}b`}>
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <clipPath id={`${id}c`}>
          <path d={bag} />
        </clipPath>
      </defs>
      <ellipse cx="260" cy="652" rx="200" ry="12" fill="#000" opacity={dark ? 0.18 : 0.08} filter={`url(#${id}b)`} />
      {/* the back handle, then the front one, 2.5 cm webbing with stitched edges */}
      <path d="M186 214 C186 74 334 74 334 214" stroke={deep} strokeWidth="24" fill="none" />
      <g filter={`url(#${id}s)`}>
        <path d={bag} fill={base} />
      </g>
      <g clipPath={`url(#${id}c)`}>
        <rect width="520" height="680" fill={base} filter={`url(#${id}t)`} />
        <rect width="520" height="680" fill={`url(#${id}v)`} />
        <rect width="520" height="680" fill={`url(#${id}h)`} />
        <g filter={`url(#${id}b)`} fill="none">
          <path d="M150 300 C170 380 166 470 146 560" stroke="#000" strokeWidth="14" opacity={dark ? 0.15 : 0.04} />
          <path d="M370 280 C356 380 364 480 384 580" stroke="#000" strokeWidth="12" opacity={dark ? 0.12 : 0.05} />
        </g>
        <path d="M70 244 H450" stroke={line} strokeWidth="1.4" opacity="0.7" />
        <path d="M70 236 H450" stroke={line} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
      </g>
      <path d="M170 220 C170 50 350 50 350 220" stroke={base} strokeWidth="25" fill="none" />
      <path d="M170 220 C170 50 350 50 350 220" stroke={line} strokeWidth="19" strokeDasharray="4 3" fill="none" opacity="0.55" />
      <path d="M170 220 C170 50 350 50 350 220" stroke={base} strokeWidth="16.5" fill="none" />
      <path d="M170 220 C170 50 350 50 350 220" stroke="#000" strokeWidth="25" fill="none" opacity={dark ? 0.1 : 0.04} />
      {/* box-x stitching where the handles meet the bag */}
      {[157.5, 337.5].map((x) => (
        <g key={x} stroke={line} strokeWidth="1.1" fill="none" opacity="0.75">
          <rect x={x} y={214} width="25" height="34" fill={base} />
          <path d={`M${x + 3} ${217}h19v28h-19z M${x + 3} 217 l19 28 M${x + 22} 217 l-19 28`} strokeDasharray="2.6 2" />
        </g>
      ))}
      {/* the mark, 9 cm, centred; the line, 22 cm wide, 6 cm above the base */}
      <Mark x={215} y={350} size={90} fill={print} />
      <text
        x="150"
        y="570"
        textLength="220"
        lengthAdjust="spacingAndGlyphs"
        fill={print}
        style={{ fontFamily: "Aeonik, system-ui, sans-serif", fontSize: 14.3, letterSpacing: "-0.01em" }}
      >
        Private money on public chains
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------- box

/**
 * The rigid box, lid on, in an axonometric view. Lengths in cm: 32 x 26 x 9,
 * the lid 3 cm deep. The lid carries the mark as a blind deboss, and the front
 * wall the lockup in matte black foil (optional).
 */
export function BoxClosed({ foil = true }: { foil?: boolean }) {
  const id = useSvgId();
  // Axes: x along the 32 cm length, y along the 26 cm depth, z up.
  const ex = [8.4, 3.3];
  const ey = [-7.2, 3.5];
  const ez = [0, -9.6];
  const O = [268, 206];
  const P = (x: number, y: number, z: number) => [O[0] + x * ex[0] + y * ey[0] + z * ez[0], O[1] + x * ex[1] + y * ey[1] + z * ez[1]];
  const pts = (...p: number[][]) => p.map((q) => q.map((v) => v.toFixed(1)).join(" ")).join(" L");
  const t0 = P(0, 0, 9), t1 = P(32, 0, 9), t2 = P(32, 26, 9), t3 = P(0, 26, 9);
  const b1 = P(32, 0, 0), b2 = P(32, 26, 0), b3 = P(0, 26, 0);
  const l1 = P(32, 0, 6), l2 = P(32, 26, 6), l3 = P(0, 26, 6);
  // Lid-top coordinates (cm) to the screen, and the front wall's (cm, y down from the lid's top edge).
  const top = `matrix(${ex[0]} ${ex[1]} ${ey[0]} ${ey[1]} ${O[0] + 9 * ez[0]} ${O[1] + 9 * ez[1]})`;
  const wall = `matrix(${ex[0]} ${ex[1]} ${-ez[0]} ${-ez[1]} ${O[0] + 26 * ey[0] + 9 * ez[0]} ${O[1] + 26 * ey[1] + 9 * ez[1]})`;
  const m = 6 / 32; // a 6 cm mark, in mark units
  return (
    <svg viewBox="0 0 600 470" role="img" aria-label="The Gloam box, lid on" className="h-full w-full">
      <defs>
        <linearGradient id={`${id}top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#24262a" />
          <stop offset="1" stopColor="#141518" />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0c0d0f" />
          <stop offset="1" stopColor="#141517" />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1a1b1e" />
          <stop offset="1" stopColor="#101113" />
        </linearGradient>
        <linearGradient id={`${id}foil`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a3d43" />
          <stop offset="0.5" stopColor="#24262a" />
          <stop offset="1" stopColor="#34373c" />
        </linearGradient>
        <filter id={`${id}b`}>
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <path d={`M${pts(P(-1, -1, 0), P(33, -1, 0), P(33, 28, 0), P(-1, 28, 0))}Z`} fill="#000" opacity="0.28" filter={`url(#${id}b)`} transform="translate(0 10)" />
      <path d={`M${pts(t3, t2, b2, b3)}Z`} fill={`url(#${id}l)`} />
      <path d={`M${pts(t1, t2, b2, b1)}Z`} fill={`url(#${id}r)`} />
      <path d={`M${pts(t0, t1, t2, t3)}Z`} fill={`url(#${id}top)`} />
      {/* the lid's lower edge, where it meets the base */}
      <path d={`M${pts(l3, l2, l1)}`} stroke="#000" strokeWidth="2" fill="none" opacity="0.7" />
      <path d={`M${pts(l3, l2, l1)}`} stroke="#fff" strokeWidth="0.8" fill="none" opacity="0.06" transform="translate(0 -1.5)" />
      <path d={`M${pts(t3, t2, t1)}`} stroke="#fff" strokeWidth="1.2" fill="none" opacity="0.16" />
      <path d={`M${pts(t3, t0, t1)}`} stroke="#fff" strokeWidth="1" fill="none" opacity="0.07" />
      <path d={`M${pts(t2, b2)}`} stroke="#fff" strokeWidth="1" fill="none" opacity="0.09" />
      {/* blind deboss: the mark pressed in, lit from the back left */}
      <g transform={top}>
        <path d={MARK_D} fillRule="evenodd" fill="#3a3d42" opacity="0.55" transform={`translate(${13 + 0.07} ${10 + 0.07}) scale(${m})`} />
        <path d={MARK_D} fillRule="evenodd" fill="#050506" transform={`translate(${13 - 0.06} ${10 - 0.06}) scale(${m})`} />
        <path d={MARK_D} fillRule="evenodd" fill="#151619" transform={`translate(13 10) scale(${m})`} />
      </g>
      {foil && (
        <g transform={wall}>
          {/* the lockup, 5 cm, centred on the front wall */}
          <g transform={`translate(${16 - 2.5} 0.9) scale(${5 / 117})`}>
            <path d={MARK_D} fillRule="evenodd" fill={`url(#${id}foil)`} />
            <text x="41.5" y="24.6" fill={`url(#${id}foil)`} style={{ fontFamily: "Aeonik, system-ui, sans-serif", fontSize: 25.5, fontWeight: 500, letterSpacing: "-0.3825px" }}>
              Gloam
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}

/** The box opened, from above: black tissue folded back, the seal, a folded tee, the cap and the card. 1.5 units = 1 mm. */
export function BoxOpen() {
  const id = useSvgId();
  const bone = FABRICS.bone;
  return (
    <svg viewBox="0 0 600 470" role="img" aria-label="The Gloam box, open, with the tee, the cap and the card inside" className="h-full w-full">
      <defs>
        <filter id={`${id}s`} x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#000" floodOpacity="0.3" />
        </filter>
        <filter id={`${id}i`} x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000" floodOpacity="0.45" />
        </filter>
        <linearGradient id={`${id}w`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d1f22" />
          <stop offset="1" stopColor="#0d0e10" />
        </linearGradient>
        <filter id={`${id}soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <radialGradient id={`${id}cap`} cx="0.42" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#2e3035" />
          <stop offset="1" stopColor="#141518" />
        </radialGradient>
      </defs>
      {/* the base: walls seen from above, then the floor */}
      <g filter={`url(#${id}s)`}>
        <path d={rr(60, 40, 480, 390, 6)} fill={`url(#${id}w)`} />
      </g>
      <path d={rr(72, 52, 456, 366, 3)} fill="#0e0f11" />
      <path d={rr(72, 52, 456, 366, 3)} fill="none" stroke="#000" strokeWidth="6" opacity="0.5" />
      {/* black tissue, folded back left and right, with soft creases */}
      <path d="M76 58 L300 70 L292 412 L78 414Z" fill="#17181b" />
      <path d="M524 56 L300 70 L308 414 L522 412Z" fill="#131417" />
      <g filter={`url(#${id}soft)`} fill="#fff">
        <path d="M86 70 L230 96 L180 180 L84 150Z" opacity="0.05" />
        <path d="M84 300 L250 270 L262 330 L86 400Z" opacity="0.04" />
        <path d="M514 80 L360 110 L420 210 L516 170Z" opacity="0.04" />
        <path d="M516 300 L346 330 L420 410 L516 404Z" opacity="0.035" />
      </g>
      <path d="M300 70 L292 412 M300 70 L308 414" stroke="#000" strokeWidth="3" opacity="0.5" />
      {/* the folded tee, bone, with the mark */}
      <g filter={`url(#${id}i)`}>
        <path d={rr(118, 100, 196, 244, 6)} fill={bone.base} />
      </g>
      <path d="M176 100 C186 132 248 132 258 100" fill={bone.deep} />
      <path d="M176 100 C186 132 248 132 258 100" stroke={bone.base} strokeWidth="9" fill="none" />
      <path d="M118 100 L142 100 M314 100 L290 100" stroke={bone.line} strokeWidth="1" opacity="0.5" />
      <path d="M118 302 H314" stroke={bone.line} strokeWidth="1" opacity="0.6" />
      <path d="M118 308 H314" stroke={bone.line} strokeWidth="1" strokeDasharray="3 2.6" opacity="0.6" />
      <Mark x={254} y={150} size={30} fill={bone.print} />
      {/* the cap from above: brim toward us, six panels, the button, the mark on the front panels */}
      <g filter={`url(#${id}i)`}>
        <path d="M372 236 C374 312 488 312 490 236 C470 268 392 268 372 236Z" fill="#202226" />
        <circle cx="431" cy="206" r="62" fill={`url(#${id}cap)`} />
      </g>
      <g stroke="#3a3c42" strokeWidth="0.9" strokeDasharray="2.6 2" fill="none" opacity="0.8">
        <path d="M382 252 C400 282 462 282 480 252" />
        <path d="M384 262 C402 292 460 292 478 262" />
      </g>
      <g stroke="#000" strokeWidth="1.2" opacity="0.55" fill="none">
        <path d="M431 206 L431 144 M431 206 L485 175 M431 206 L485 237 M431 206 L431 268 M431 206 L377 237 M431 206 L377 175" />
      </g>
      <circle cx="431" cy="206" r="7" fill="#26282c" />
      <circle cx="431" cy="205" r="4" fill="#33363b" />
      <path d={MARK_D} fillRule="evenodd" fill="#4a4d54" transform="translate(420 236) scale(0.72 0.42)" />
      {/* the seal on the tissue, and the card */}
      <circle cx="300" cy="372" r="22" fill="#ece7dd" filter={`url(#${id}i)`} />
      <Mark x={291} y={363} size={18} fill="#0b0c0e" />
      <g filter={`url(#${id}i)`} transform="rotate(-4 452 372)">
        <rect x="370" y="318" width="164" height="116" rx="2" fill="#ece7dd" />
      </g>
      <g transform="rotate(-4 452 372)">
        <Mark x={382} y={330} size={14} fill="#0b0c0e" />
        <text x="382" y="408" fill="#0b0c0e" style={{ fontFamily: "Aeonik, system-ui, sans-serif", fontSize: 13, fontWeight: 300, letterSpacing: "-0.02em" }}>
          Private money
        </text>
        <text x="382" y="424" fill="#0b0c0e" style={{ fontFamily: "Aeonik, system-ui, sans-serif", fontSize: 13, fontWeight: 300, letterSpacing: "-0.02em" }}>
          on public chains.
        </text>
      </g>
    </svg>
  );
}

/** The insert card, front or back, drawn from the print files themselves. */
export function CardFace({ side }: { side: "front" | "back" }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the print file itself, so the page shows exactly what prints
    <img
      src={`/merch/gloam-card-${side}.svg`}
      alt={side === "front" ? "Insert card front: the mark and Private money on public chains" : "Insert card back: Thank you for being here early"}
      width={154}
      height={111}
      className="h-auto w-full rounded-[3px] shadow-pop"
    />
  );
}

