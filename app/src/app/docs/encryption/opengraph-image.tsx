import { docsCard } from "@/lib/docsCard";
import { LockArt } from "@/lib/docsCardArt";

const title = "How shield works";
const subtitle = "Deposit, private note, cash out, in plain words.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <LockArt /> });
}
