import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Promo Agent — URL → animated promo video in 90 seconds",
  description:
    "Autonomous agent that turns a company URL into a finished kinetic-typography promo video. Powered by Nemotron 3 Super 120B running inside NemoClaw with policy-based guardrails. Submission for NVIDIA GTC Taipei 2026 Hackathon.",
  openGraph: {
    title: "Promo Agent — URL → animated promo video",
    description:
      "Powered by Nemotron 3 Super 120B inside NemoClaw. No human in the loop after the URL.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
