import type { Metadata } from "next";

const TITLE = "Check a Gloam proof";
const DESCRIPTION =
  "Check a Gloam proof someone shared with you, and the contracts that hold the money. The proof is checked in your browser and nothing is sent to Gloam. No wallet, no account.";

// The verifier page is a client component, so its metadata lives here. A
// shared proof rides in the link's fragment, so previews never see it.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/verify" },
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
