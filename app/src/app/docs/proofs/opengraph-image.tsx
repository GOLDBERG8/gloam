import { docsCard } from "@/lib/docsCard";
import { SealArt } from "@/lib/docsCardArt";

const title = "Proofs";
const subtitle = "Show one fact about your money to one person.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <SealArt /> });
}
