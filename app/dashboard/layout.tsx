import { Inter } from "next/font/google";

/** The dashboard's font, self-hosted. Its theme used to start with `@import url(fonts.googleapis.com/... Inter)`, which holds back ALL of the dashboard's styling until Google's
 *  stylesheet has been fetched: on every full load the page sat unstyled or blank for as long as that took. `display: contents` keeps this wrapper out of the layout. */
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter", display: "swap" });

export default function DashboardRootLayout({ children }: { children: React.ReactNode }) {
  return <div className={inter.variable} style={{ display: "contents" }}>{children}</div>;
}
