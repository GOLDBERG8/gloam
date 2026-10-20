import type { Metadata } from "next";
import { Web3Provider } from "@/components/app/Web3Provider";
import { TurnkeyEmbeddedProvider } from "@/components/app/TurnkeyEmbeddedProvider";
import { AppThemeScope } from "@/components/app/AppThemeScope";
import { MAINNET_CONFIGURED } from "@/lib/mainnet";

// The tab title says Testnet until a mainnet pool is filled in (lib/mainnet.ts); then the app is both.
export const metadata: Metadata = MAINNET_CONFIGURED
  ? {
      title: {
        default: "App",
        template: "%s · Gloam",
      },
      description:
        "The Gloam app: a private balance, private payments, payroll and proofs on Robinhood Chain and Tempo, on mainnet and testnet.",
    }
  : {
      title: {
        default: "Testnet",
        template: "%s · Gloam Testnet",
      },
      description:
        "The Gloam app on testnet: a private balance, private payments, payroll and proofs on Robinhood Chain and Tempo.",
    };

export default function ProductLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TurnkeyEmbeddedProvider>
      <AppThemeScope />
      <Web3Provider>{children}</Web3Provider>
    </TurnkeyEmbeddedProvider>
  );
}
