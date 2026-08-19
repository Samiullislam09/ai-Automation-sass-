import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";

export const metadata: Metadata = {
  metadataBase: new URL("https://growthteam.example.com"), // TODO: final domain
  title: { default: "GrowthTeam AI — Your AI Marketing Team for Small Business", template: "%s · GrowthTeam AI" },
  description: "Six AI agents write ranking articles, post to every platform, find leads and care for your website — every action approved by you. Start free.",
  keywords: ["AI marketing team", "AI agents for small business", "AI content automation", "AI lead generation", "SEO articles AI"],
  openGraph: { type: "website", siteName: "GrowthTeam AI", title: "Your AI Marketing Team for Small Business", description: "Content, leads, reviews and SEO — one AI team, human-approved." },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
