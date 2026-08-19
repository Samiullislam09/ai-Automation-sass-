import { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://growthteam.example.com"; // TODO: final domain
  return ["", "/login", "/signup"].map(p => ({ url: base + p, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.6 }));
}
