import { docsCard } from "@/lib/docsCard";
import { RevealArt } from "@/lib/docsCardArt";

const title = "Selective disclosure";
const subtitle = "The retired note format, kept here for reference.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <RevealArt /> });
}
