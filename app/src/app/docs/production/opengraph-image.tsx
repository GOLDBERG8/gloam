import { docsCard } from "@/lib/docsCard";
import { ChecklistArt } from "@/lib/docsCardArt";

const title = "Production gate";
const subtitle = "What mainnet cleared before real money went in.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <ChecklistArt /> });
}
