import { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

/** Public pages only (the app itself is behind a login and disallowed in robots.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number][] = [["", 1], ["/signup", 0.7], ["/login", 0.5], ["/privacy", 0.4], ["/terms", 0.4], ["/refund", 0.4]];
  return pages.map(([p, priority]) => ({ url: SITE_URL + p, changeFrequency: p === "" ? ("weekly" as const) : ("monthly" as const), priority }));
}
