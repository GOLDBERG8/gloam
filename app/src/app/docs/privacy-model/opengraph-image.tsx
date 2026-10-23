import { docsCard } from "@/lib/docsCard";
import { UnlinkArt } from "@/lib/docsCardArt";

const title = "What stays private";
const subtitle = "What an explorer shows, and what stays hidden.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <UnlinkArt /> });
}
