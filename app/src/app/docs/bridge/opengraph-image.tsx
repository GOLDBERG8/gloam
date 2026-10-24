import { docsCard } from "@/lib/docsCard";
import { ChainsArt } from "@/lib/docsCardArt";

const title = "Deposit from another chain";
const subtitle = "Bitcoin, Solana and 22 EVM chains in. Private once it lands.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <ChainsArt /> });
}
