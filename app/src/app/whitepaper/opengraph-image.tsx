import { docsCard } from "@/lib/docsCard";
import { PaperArt } from "@/lib/docsCardArt";

const title = "Whitepaper";
const subtitle = "The technical and product thesis for Gloam.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <PaperArt /> });
}
