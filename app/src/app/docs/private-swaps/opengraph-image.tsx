import { docsCard } from "@/lib/docsCard";
import { SwapArt } from "@/lib/docsCardArt";

const title = "Private swaps";
const subtitle = "Who swapped stays private. Amounts stay public.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <SwapArt /> });
}
