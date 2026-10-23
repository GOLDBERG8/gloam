import { docsCard } from "@/lib/docsCard";
import { KeyArt } from "@/lib/docsCardArt";

const title = "Partner program and API";
const subtitle = "Add private payments with one key. Set your own fee.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <KeyArt /> });
}
