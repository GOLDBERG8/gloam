import { formatUnits, parseEther, parseUnits } from "viem";
import { readAmountText } from "./amountText";

/** Exact, grouped token amount for funding instructions and financial records. */
export function formatExactAmount(raw: bigint, decimals: number, minimumFractionDigits = 0): string {
  const [whole, fraction = ""] = formatUnits(raw, decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const digits = fraction.padEnd(Math.min(minimumFractionDigits, decimals), "0");
  return digits ? `${grouped}.${digits}` : grouped;
}

/** Safe decimal → wei; refuses anything lib/amountText refuses (sci notation, "1,25", "-1"). */
export function safeParseEther(raw: string): bigint | null {
  const read = readAmountText(raw, 18);
  if (!read.ok || !read.text) return null;
  try {
    return parseEther(read.text);
  } catch {
    return null;
  }
}

/** Decimal → raw units. More decimals than the token has is refused, never clipped. */
export function safeParseUnits(raw: string, decimals = 18): bigint | null {
  const read = readAmountText(raw, decimals);
  if (!read.ok || !read.text) return null;
  try {
    return parseUnits(read.text, decimals);
  } catch {
    return null;
  }
}

export function finiteNumber(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
