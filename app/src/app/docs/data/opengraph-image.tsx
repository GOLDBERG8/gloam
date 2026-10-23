import { docsCard } from "@/lib/docsCard";
import { ChartArt } from "@/lib/docsCardArt";

const title = "Prices, data & oracles";
const subtitle = "No onchain price oracle yet, and what that means.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <ChartArt /> });
}
