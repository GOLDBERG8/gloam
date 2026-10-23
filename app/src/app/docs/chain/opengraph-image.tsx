import { docsCard } from "@/lib/docsCard";
import { ChainsArt } from "@/lib/docsCardArt";

const title = "Networks";
const subtitle = "One private core on Robinhood Chain and Tempo.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <ChainsArt /> });
}
