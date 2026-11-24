import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { BRAND, SITE_URL } from "@/lib/brand";
import { ThemeProvider } from "@/components/theme-provider";

// Self-hosted (app/fonts/README.md): no download from Google at build time, so a Google Fonts hiccup can no longer fail a deployment.
const manrope = localFont({ src: "./fonts/manrope-latin-wght-normal.woff2", weight: "200 800", variable: "--font-manrope", display: "swap", adjustFontFallback: "Arial" });
const jakarta = localFont({ src: "./fonts/plus-jakarta-sans-latin-wght-normal.woff2", weight: "200 800", variable: "--font-jakarta", display: "swap", adjustFontFallback: "Arial" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${BRAND.name} — Your AI Marketing Team for Small Business`, template: `%s · ${BRAND.name}` },
  description: "MenCra is an AI marketing team for small business: it researches keywords, writes articles in your voice and publishes them to your website, with your approval at every step. Start free.",
  applicationName: BRAND.name,
  openGraph: { type: "website", url: SITE_URL, siteName: BRAND.name, title: `${BRAND.name} — Your AI Marketing Team for Small Business`, description: "Research keywords, write articles in your voice and publish to your site. One AI team, every action approved by you." },
  twitter: { card: "summary_large_image", title: `${BRAND.name} — Your AI Marketing Team for Small Business`, description: "Research keywords, write articles in your voice and publish to your site. Every action approved by you." },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${manrope.variable} ${jakarta.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <StoreProvider>{children}</StoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
