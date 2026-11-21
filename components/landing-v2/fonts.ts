import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";

/** Fonts that next/font can SELF-HOST at build time: preloaded with the page, served from our own domain, no request to Google at all, `display: swap` so text shows at once.
 *  (They were a render-blocking <link rel="stylesheet"> to fonts.googleapis.com in the page body.) Google Sans Flex is not in next/font's list: see AsyncFont. */
export const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: "800", variable: "--font-bricolage", display: "swap" });
export const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: "500", variable: "--font-jbmono", display: "swap" });
