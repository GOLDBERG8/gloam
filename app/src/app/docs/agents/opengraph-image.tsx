import { docsCard } from "@/lib/docsCard";
import { ChatArt } from "@/lib/docsCardArt";

const title = "Build a private agent";
const subtitle = "Agents that shield, pay and prove, under policy.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <ChatArt /> });
}
