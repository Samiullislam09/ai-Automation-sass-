import localFont from "next/font/local";

/** Fonts served from our own domain, preloaded with the page, no request to Google at all, `display: swap` so text shows at once.
 *  (They were a render-blocking <link rel="stylesheet"> to fonts.googleapis.com in the page body, and then `next/font/google`, which downloads from Google DURING
 *  `next build` and failed a deployment when Google answered with a URL Next could not parse. The files now live in app/fonts: see app/fonts/README.md.)
 *  Google Sans Flex is not an open font we can ship: see AsyncFont. */
export const bricolage = localFont({ src: "../../app/fonts/bricolage-grotesque-latin-800-normal.woff2", weight: "800", variable: "--font-bricolage", display: "swap", adjustFontFallback: "Arial" });
export const jetbrainsMono = localFont({ src: "../../app/fonts/jetbrains-mono-latin-500-normal.woff2", weight: "500", variable: "--font-jbmono", display: "swap", adjustFontFallback: false }); // next/font can only size-match Arial or Times New Roman; a monospace fallback is left as the browser's own
