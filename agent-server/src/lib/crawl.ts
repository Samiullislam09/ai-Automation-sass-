import * as cheerio from "cheerio";

/** Ported from the main app's lib/crawl.ts (Build Guide Step 5). Lives here too because
 *  the FULL site crawl (Step 12 follow-up) needs to run as a background job — the main
 *  app's synchronous /api/onboarding/crawl route is deliberately capped low (~15 pages)
 *  to stay under Vercel's serverless request time limit; a real site can have hundreds of
 *  pages, which only works as an unbounded-by-a-request background job here. */
const UA = "MrLxwaBot/1.0 (+https://mrlxwa.com; learning your site to write about it)";

export async function discoverUrls(siteUrl: string, limit: number): Promise<string[]> {
  const origin = new URL(siteUrl).origin;

  const fromSitemap = await tryFetchSitemap(`${origin}/sitemap.xml`, limit);
  if (fromSitemap.length) return fromSitemap.slice(0, limit);

  return crawlHomepageLinks(origin, limit);
}

async function tryFetchSitemap(url: string, limit: number, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    const childSitemaps = $("sitemapindex sitemap loc").map((_, el) => $(el).text().trim()).get();
    if (childSitemaps.length) {
      const urls: string[] = [];
      for (const child of childSitemaps.slice(0, 10)) {
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
