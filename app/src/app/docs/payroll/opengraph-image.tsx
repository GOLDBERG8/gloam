import { docsCard } from "@/lib/docsCard";
import { PayrollArt } from "@/lib/docsCardArt";

const title = "Private payroll";
const subtitle = "Pay a whole team. Nobody sees who got what.";

export const alt = `Gloam docs: ${title}. ${subtitle}`;
export { size, contentType } from "@/lib/docsCard";

export default function OpenGraphImage() {
  return docsCard({ title, subtitle, art: <PayrollArt /> });
}
