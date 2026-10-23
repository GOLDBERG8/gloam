import { docsCard } from "@/lib/docsCard";
import { SendArt } from "@/lib/docsCardArt";

const title = "Private pay on Robinhood Chain";
const subtitle = "A normal send, with who and how much hidden.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <SendArt /> });
}
