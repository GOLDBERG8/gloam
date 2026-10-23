import { docsCard } from "@/lib/docsCard";
import { LedgerArt } from "@/lib/docsCardArt";

const title = "What anyone can see";
const subtitle = "The vault's money, deposits, transfers and cash-outs, read live from the chain.";

export const alt = `Gloam transparency: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <LedgerArt />, section: "Transparency" });
}
