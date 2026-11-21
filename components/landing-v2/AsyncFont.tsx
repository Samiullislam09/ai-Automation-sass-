"use client";
import { useEffect } from "react";

/** Loads a Google Fonts stylesheet WITHOUT blocking the first paint. A <link rel="stylesheet"> in the page holds the render until Google answers (a DNS lookup, a TLS handshake and
 *  two requests on a slow phone). This adds it after the page is up: the text shows at once in the fallback font and swaps when the font arrives (the URL carries display=swap). */
export function AsyncFont({ href }: { href: string }) {
  useEffect(() => {
    const added: HTMLLinkElement[] = [];
    const add = (rel: string, url: string, cross = false) => {
      const l = document.createElement("link");
      l.rel = rel; l.href = url;
      if (cross) l.crossOrigin = "";
      document.head.appendChild(l);
      added.push(l);
    };
    add("preconnect", "https://fonts.googleapis.com");
    add("preconnect", "https://fonts.gstatic.com", true);
    add("stylesheet", href);
    return () => added.forEach((l) => l.remove());
  }, [href]);
  return null;
}
