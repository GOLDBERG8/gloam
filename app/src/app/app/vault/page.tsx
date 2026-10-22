import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { VaultHub } from "@/components/app/VaultHub";

const PAID = {
  title: "You've been sent a private payment",
  description: "Open it in Gloam to claim it. Only you will see the amount.",
};

/**
 * A payment link opens the vault on "receive" with its network named
 * (lib/claimLink appClaimPath) and the payment in its fragment, so its preview
 * in a chat says so, like /claim's. A plain Receive link has no network and
 * keeps the vault card.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { mode, net } = await searchParams;
  if (mode !== "receive" || typeof net !== "string" || !net) return { title: "Vault" };
  return {
    title: { absolute: PAID.title },
    description: PAID.description,
    robots: { index: false, follow: false },
    openGraph: { ...PAID, images: [{ url: "/claim/opengraph-image", width: 1200, height: 630, alt: PAID.title }] },
    twitter: { card: "summary_large_image", ...PAID, images: ["/claim/twitter-image"] },
  };
}

function VaultSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading the vault">
      <div className="h-12 w-full max-w-[380px] rounded-full bg-surface-2 motion-safe:animate-pulse" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="gl-card h-[420px] motion-safe:animate-pulse" />
        <div className="gl-card h-[220px] motion-safe:animate-pulse" />
      </div>
    </div>
  );
}

export default function VaultPage() {
  return (
    <AppShell
      title="Vault"
      subtitle="Add money privately, send it, and cash out, all in one place. Your amounts stay hidden."
    >
      <Suspense fallback={<VaultSkeleton />}>
        <VaultHub />
      </Suspense>
    </AppShell>
  );
}
