import { docsCard } from "@/lib/docsCard";
import { CodeArt } from "@/lib/docsCardArt";

const title = "SDK";
const subtitle = "The privacy layer for apps and agents, as a package.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <CodeArt /> });
}
