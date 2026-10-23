import { docsCard } from "@/lib/docsCard";
import { RetiredArt } from "@/lib/docsCardArt";

const title = "Sealed trade (retired)";
const subtitle = "Replaced by private swaps on mainnet.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <RetiredArt /> });
}
