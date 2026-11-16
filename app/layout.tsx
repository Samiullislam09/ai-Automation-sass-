import type { Metadata } from "next";
import { Manrope, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { BRAND, SITE_URL } from "@/lib/brand";
import { ThemeProvider } from "@/components/theme-provider";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });

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
