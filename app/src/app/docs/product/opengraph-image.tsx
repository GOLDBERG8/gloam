import { docsCard } from "@/lib/docsCard";
import { TimelineArt } from "@/lib/docsCardArt";

const title = "What ships when";
const subtitle = "What is live, what is next, what we won't fake.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <TimelineArt /> });
}
