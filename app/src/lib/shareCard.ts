/**
 * The "Paid privately" share image, drawn in the browser on a canvas. It holds
 * no amount, no recipient and no address: the Gloam mark, one headline, one
 * line, the sealed row the brand posts use, and a small footer naming the
 * network (with "testnet" on a testnet). 1200 x 675 (X's 16:9), drawn at 2x so
 * it stays sharp.
 */

const W = 1200;
const H = 675;
const SCALE = 2;
const FONT = "Aeonik, system-ui, sans-serif";

type Palette = {
  frame: string;
  base: string;
  hi: string;
  wash: string;
  washDeep: string;
  ink: string;
  soft: string;
  mute: string;
  rowFill: string;
  rowLine: string;
  markInset: string;
};

// The app's light and dark tokens (globals.css).
const LIGHT: Palette = {
  frame: "#ffffff",
  base: "#eef0f2",
  hi: "#ffffff",
  wash: "#cfe6d8",
  washDeep: "#a9d6bb",
  ink: "#0b0c0e",
  soft: "#34373c",
  mute: "#5f636a",
  rowFill: "rgba(255, 255, 255, 0.78)",
  rowLine: "#e4e6e9",
  markInset: "#eef0f2",
};

const DARK: Palette = {
  frame: "#08090a",
  base: "#0e0f11",
  hi: "#24272b",
  wash: "#16241c",
  washDeep: "#1d3d2c",
  ink: "#f4f5f6",
  soft: "#cdd0d4",
  mute: "#9b9fa6",
  rowFill: "rgba(255, 255, 255, 0.05)",
  rowLine: "#232529",
  markInset: "#0e0f11",
};

function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  // Fade to the same colour at zero alpha: fading to transparent black would
  // drag a grey band through the middle of every glow.
  const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  g.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 1)`);
  g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

async function loadFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`300 120px ${FONT}`),
      document.fonts.load(`400 28px ${FONT}`),
      document.fonts.load(`500 30px ${FONT}`),
    ]);
  } catch {
    /* falls back to the system face */
  }
}

/** Draws the card and returns it as a PNG. */
export async function renderPaidPrivatelyCard(opts: {
  dark: boolean;
  /** e.g. "Tempo" or "Robinhood Chain" */
  networkLabel: string;
  /** A testnet payment (the default) says so in the footer; a mainnet one names the chain alone. */
  testnet?: boolean;
}): Promise<Blob> {
  await loadFonts();
  const p = opts.dark ? DARK : LIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.scale(SCALE, SCALE);

  // Frame, then the panel with the soft silver field and a green corner wash.
  ctx.fillStyle = p.frame;
  ctx.fillRect(0, 0, W, H);
  const px = 20;
  const py = 20;
  const pw = W - 40;
  const ph = 590;
  ctx.save();
  rounded(ctx, px, py, pw, ph, 40);
  ctx.clip();
  ctx.fillStyle = p.base;
  ctx.fillRect(px, py, pw, ph);
  glow(ctx, 300, 60, 640, p.hi, 0.9);
  glow(ctx, 1120, 640, 760, p.wash, 1);
  glow(ctx, 1160, 700, 460, p.washDeep, 0.55);
  ctx.restore();

  // Mark + wordmark, top left.
  const mx = 68;
  const my = 66;
  const ms = 34;
  const u = ms / 32;
  ctx.fillStyle = p.ink;
  rounded(ctx, mx, my, ms, ms, 9 * u);
  ctx.fill();
  ctx.fillStyle = p.markInset;
  rounded(ctx, mx + 15 * u, my + 4 * u, 12 * u, 12 * u, 3.5 * u);
  ctx.fill();
  ctx.fillStyle = p.ink;
  ctx.textBaseline = "middle";
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText("Gloam", mx + ms + 12, my + ms / 2 + 1);

  // The sealed row: what the public sees of the payment.
  const rw = 340;
  const rh = 60;
  const rx = px + pw - 48 - rw;
  const ry = 236;
  rounded(ctx, rx, ry, rw, rh, 16);
  ctx.fillStyle = p.rowFill;
  ctx.fill();
  ctx.strokeStyle = p.rowLine;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = p.mute;
  ctx.font = `400 20px ${FONT}`;
  ctx.fillText("The public sees", rx + 22, ry + rh / 2 + 1);
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.arc(rx + rw - 26 - i * 15, ry + rh / 2, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Headline and one line, bottom left.
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.ink;
  let size = 132;
  ctx.font = `300 ${size}px ${FONT}`;
  while (ctx.measureText("Paid privately").width > 960 && size > 72) {
    size -= 4;
    ctx.font = `300 ${size}px ${FONT}`;
  }
  ctx.fillText("Paid privately", 62, 480);
  ctx.fillStyle = p.soft;
  ctx.font = `400 28px ${FONT}`;
  ctx.fillText("The amount and who I paid stay hidden.", 68, 538);

  // Footer under the panel.
  ctx.textBaseline = "middle";
  ctx.fillStyle = p.ink;
  ctx.font = `500 20px ${FONT}`;
  ctx.fillText("gloam.trade", 28, 644);
  ctx.fillStyle = p.mute;
  ctx.font = `400 20px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(opts.testnet === false ? `On ${opts.networkLabel}` : `On ${opts.networkLabel} testnet`, W - 28, 644);
  ctx.textAlign = "left";

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not make the image."))),
      "image/png"
    );
  });
}
