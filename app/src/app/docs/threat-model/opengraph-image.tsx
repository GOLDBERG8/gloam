import { docsCard } from "@/lib/docsCard";
import { ShieldArt } from "@/lib/docsCardArt";

const title = "Threat model";
const subtitle = "Who we defend against, and the gaps we know about.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <ShieldArt /> });
}
