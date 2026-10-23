import { docsCard } from "@/lib/docsCard";
import { IndexArt } from "@/lib/docsCardArt";

const title = "Documentation";
const subtitle = "Private money on public chains, without the jargon.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <IndexArt /> });
}
