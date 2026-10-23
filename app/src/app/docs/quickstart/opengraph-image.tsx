import { docsCard } from "@/lib/docsCard";
import { TimerArt } from "@/lib/docsCardArt";

const title = "Quickstart";
const subtitle = "A real private balance in about ten minutes.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <TimerArt /> });
}
