import { docsCard } from "@/lib/docsCard";
import { ExportsArt } from "@/lib/docsCardArt";

const title = "API reference";
const subtitle = "Every export of @gloamtrade/sdk, from one import.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <ExportsArt /> });
}
