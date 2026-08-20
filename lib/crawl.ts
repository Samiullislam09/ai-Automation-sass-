import * as cheerio from "cheerio";
import "@/lib/dns-fix";

const UA = "MrLxwaBot/1.0 (+https://mrlxwa.com; learning your site to write about it)";

/** Finds page URLs for a site — sitemap.xml first (incl. sitemap-index), falls back to
 *  crawling same-domain links off the homepage. Capped, per Build Guide Step 5. */
export async function discoverUrls(siteUrl: string, limit: number): Promise<string[]> {
  const origin = new URL(siteUrl).origin;

  const fromSitemap = await tryFetchSitemap(`${origin}/sitemap.xml`, limit);
  if (fromSitemap.length) return fromSitemap.slice(0, limit);

  return crawlHomepageLinks(origin, limit);
}

async function tryFetchSitemap(url: string, limit: number, depth = 0): Promise<string[]> {
  if (depth > 2) return []; // sitemap-index → sitemap → (stop) — don't recurse forever
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    // sitemap index — a list of other sitemap files
    const childSitemaps = $("sitemapindex sitemap loc").map((_, el) => $(el).text().trim()).get();
    if (childSitemaps.length) {
      const urls: string[] = [];
      for (const child of childSitemaps.slice(0, 3)) {
        urls.push(...(await tryFetchSitemap(child, limit - urls.length, depth + 1)));
        if (urls.length >= limit) break;
      }
      return urls;
    }

    return $("urlset url loc").map((_, el) => $(el).text().trim()).get();
  } catch {
    return [];
  }
}

async function crawlHomepageLinks(origin: string, limit: number): Promise<string[]> {
  try {
    const res = await fetch(origin, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [origin];
    const html = await res.text();
    const $ = cheerio.load(html);

    const links = new Set<string>([origin]);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        const abs = new URL(href, origin);
        if (abs.origin === origin && !abs.hash && !/\.(pdf|jpg|jpeg|png|gif|svg|zip|css|js)$/i.test(abs.pathname)) {
          links.add(abs.origin + abs.pathname);
        }
      } catch {
        // ignore malformed hrefs (mailto:, javascript:, etc.)
      }
    });

    return Array.from(links).slice(0, limit);
  } catch {
    return [origin];
  }
}

/** Fetches one page and extracts a title + readable text (scripts/styles/nav stripped). */
export async function extractPage(url: string): Promise<{ title: string; text: string } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, nav, footer, svg").remove();

    const title = $("title").first().text().trim() || $("h1").first().text().trim() || url;
    const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 4000);

    return text ? { title, text } : null;
  } catch {
    return null;
  }
}
