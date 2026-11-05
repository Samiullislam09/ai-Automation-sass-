import { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/app/", "/dashboard/", "/api/"] }, sitemap: "https://growthteam.example.com/sitemap.xml" };
}
