import { docsCard } from "@/lib/docsCard";
import { GuardArt } from "@/lib/docsCardArt";

const title = "Agents that pay privately";
const subtitle = "With Raeto and Agent Wormhole: funded privately, checked before every payment.";

export const alt = `Gloam research: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <GuardArt />, section: "Research" });
}
