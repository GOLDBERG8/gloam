import type { Metadata } from "next";

// The claim page is a client component, so its metadata lives here. The code
// is in the link's fragment, so link previews never see what was sent.
export const metadata: Metadata = {
  title: "You've been sent a private payment",
  description: "Open it in Gloam to claim it. Only you will see the amount.",
  alternates: { canonical: "/claim" },
  robots: { index: false, follow: false },
  openGraph: {
    title: "You've been sent a private payment",
    description: "Open it in Gloam to claim it. Only you will see the amount.",
  },
  twitter: {
    card: "summary_large_image",
    title: "You've been sent a private payment",
    description: "Open it in Gloam to claim it. Only you will see the amount.",
  },
};

export default function ClaimLayout({ children }: { children: React.ReactNode }) {
  return children;
}
