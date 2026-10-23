import { docsCard } from "@/lib/docsCard";
import { DropArt } from "@/lib/docsCardArt";

const title = "Practice on testnet";
const subtitle = "Try every step for free before real money.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <DropArt /> });
}
