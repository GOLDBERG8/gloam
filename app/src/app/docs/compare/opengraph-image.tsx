import { docsCard } from "@/lib/docsCard";
import { CompareArt } from "@/lib/docsCardArt";

const title = "How Gloam compares";
const subtitle = "A payment has one owner. That decides who sees it.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <CompareArt /> });
}
