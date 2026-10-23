import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";

/**
 * The link preview card for a docs page: the site's ink card (mark, wordmark,
 * Aeonik Light, the courier etching) with the page's own title, one line on
 * what the page covers, and a small drawing on the right that tells the cards
 * apart. Each docs route's opengraph-image.tsx passes those three in.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Colours for the card and its drawings: ink, paper, greys and the one green tint. */
export const C = {
  ink: "#000000",
  paper: "#F4F5F6",
  mute: "#A9AEB5",
  faint: "#6B7078",
  line: "#33363C",
  surface: "#0F1113",
  raised: "#1A1C20",
  tint: "#8FD3AD",
  tintSoft: "rgba(143, 211, 173, 0.13)",
  tintLine: "rgba(143, 211, 173, 0.55)",
} as const;

const PAD_X = 72;
const ART_W = 340;
const TEXT_W = size.width - PAD_X * 2 - ART_W - 56;

const asset = (f: string) => join(process.cwd(), "src/assets/og", f);

let assets: Promise<{ light: Buffer; medium: Buffer; etching: string }> | undefined;
function loadAssets() {
  assets ??= Promise.all([
    readFile(asset("Aeonik-Light.ttf")),
    readFile(asset("Aeonik-Medium.ttf")),
    readFile(asset("etching-og.jpg")),
  ]).then(([light, medium, etching]) => ({
    light,
    medium,
    etching: `data:image/jpeg;base64,${etching.toString("base64")}`,
  }));
  return assets;
}

/**
 * A title that is too wide for one line goes on two, broken at the space that
 * leaves the two lines closest in length, so it never wraps unevenly.
 */
function titleLines(title: string): string[] {
  if (title.length <= 16) return [title];
  const words = title.split(" ");
  let best = [title];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      best = [a, b];
      bestDiff = diff;
    }
  }
  return best;
}

/** Headline size: the longest line of the title has to fit the text column. */
function titleSize(lines: string[]): number {
  const longest = Math.max(...lines.map((l) => l.length));
  // Aeonik Light runs a little under half an em per character in mixed case.
  const fit = Math.floor(TEXT_W / (longest * 0.5));
  return Math.min(76, fit);
}

function Mark() {
  return (
    <div
      style={{
        position: "relative",
        width: 44,
        height: 44,
        borderRadius: 12,
        background: C.paper,
        display: "flex",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 20.6,
          top: 5.5,
          width: 16.5,
          height: 16.5,
          borderRadius: 5,
          background: C.ink,
          display: "flex",
        }}
      />
    </div>
  );
}

export async function docsCard({
  title,
  subtitle,
  art,
}: {
  title: string;
  subtitle: string;
  art: ReactNode;
}) {
  const { light, medium, etching } = await loadAssets();
  const lines = titleLines(title);
  const fontSize = titleSize(lines);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: C.ink,
          fontFamily: "Aeonik",
          position: "relative",
        }}
      >
        {/* The etching, set lower than on the home card so the mountains frame the foot. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={etching}
          alt=""
          width={1200}
          height={300}
          style={{ position: "absolute", left: 0, top: 418, width: 1200, height: 300 }}
        />

        <div style={{ display: "flex", flexDirection: "column", padding: `60px ${PAD_X}px 0` }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Mark />
            <div
              style={{
                marginLeft: 14,
                color: C.paper,
                fontSize: 30,
                fontWeight: 500,
                letterSpacing: "-0.015em",
                display: "flex",
              }}
            >
              Gloam
            </div>
            <div
              style={{
                marginLeft: 18,
                width: 1,
                height: 26,
                background: C.line,
                display: "flex",
              }}
            />
            <div
              style={{
                marginLeft: 18,
                color: C.mute,
                fontSize: 26,
                fontWeight: 300,
                letterSpacing: "-0.01em",
                display: "flex",
              }}
            >
              Docs
            </div>
          </div>

          <div
            style={{
              marginTop: 50,
              width: TEXT_W,
              fontSize,
              lineHeight: 1.04,
              fontWeight: 300,
              letterSpacing: "-0.028em",
              color: C.paper,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {lines.map((l) => (
              <span key={l} style={{ display: "flex" }}>
                {l}
              </span>
            ))}
          </div>

          <div
            style={{
              marginTop: 22,
              width: TEXT_W,
              fontSize: 28,
              lineHeight: 1.3,
              fontWeight: 300,
              letterSpacing: "-0.01em",
              color: C.mute,
              display: "flex",
            }}
          >
            {subtitle}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: PAD_X,
            top: 132,
            width: ART_W,
            height: 280,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {art}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Aeonik", data: light, weight: 300, style: "normal" },
        { name: "Aeonik", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
}
