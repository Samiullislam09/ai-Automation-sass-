import localFont from "next/font/local";

/** The dashboard's font, self-hosted. Its theme used to start with `@import url(fonts.googleapis.com/... Inter)`, which holds back ALL of the dashboard's styling until Google's
 *  stylesheet has been fetched: on every full load the page sat unstyled or blank for as long as that took. `display: contents` keeps this wrapper out of the layout. */
// A file in the repo (app/fonts/README.md says why): `next/font/google` fetched Inter from Google DURING `next build` and a build failed when Google answered with a URL Next could not parse.
// One variable file covers every weight the dashboard uses (400-800).
const inter = localFont({ src: "../fonts/inter-latin-wght-normal.woff2", weight: "100 900", variable: "--font-inter", display: "swap", adjustFontFallback: "Arial" });

export default function DashboardRootLayout({ children }: { children: React.ReactNode }) {
  return <div className={inter.variable} style={{ display: "contents" }}>{children}</div>;
}
