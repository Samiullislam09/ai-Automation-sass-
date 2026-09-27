import * as cheerio from "cheerio";

/** Reading the customer's website — the thing every other agent's quality depends on.
 *
 *  REWRITTEN 2026-09-19, against measurements from the live database. What was wrong:
 *
 *   1. DISCOVERY WAS EITHER/OR. `discoverUrls` fetched the sitemap and, only if that came back
 *      empty, fell back to the links on the homepage. One momentary sitemap failure therefore
 *      decided the whole knowledge base — and that is exactly what happened. On the live
 *      workspace the stored set contained /cart, /checkout, /my-account, /payment-failed and
 *      empty ElementsKit mega-menu fragments (none of which appear in any sitemap) and was
 *      missing all 15 /iso/iso-XXXXX service pages, plus /iso, /pricing, /services and
 *      /gap-analysis (all of which do). The sitemap works perfectly when fetched today — 200 OK, 135 URLs —
 *      so nothing would ever have told anyone. Discovery is now a UNION of the sitemap, the
 *      homepage's links, and the links on the pages those reach; no single source failing can
 *      lose a page any more.
 *
 *   2. ONLY THE HOMEPAGE'S LINKS WERE FOLLOWED. /iso/iso-9001 is one click from /iso, not from
 *      /. Nothing walked that second step, so an entire product catalogue was unreachable even
 *      in the fallback. `crawlLinks` now walks to CRAWL_DEPTH.
 *
 *   3. THE TEXT WAS CUT AT 4000 CHARACTERS. Live: 156 rows, median 4000, max 4000 — i.e. every
 *      page of substance was truncated, one mid-word. Now MAX_TEXT, which is large enough that
 *      a normal page is stored whole.
 *
 *   4. THE PAGE'S OWN SUMMARY WAS THROWN AWAY. No meta description, no headings, no canonical.
 *      They are captured now — see migration 025 for where they go and why.
 *
 *  This file is duplicated at ../../lib/crawl.ts in the Next.js app (separate package, no
 *  shared module). Both copies must change together; the app's copy carries the same header.
 */
const UA = "MrLxwaBot/1.0 (+https://mrlxwa.com; learning your site to write about it)";

/** How far from the homepage to walk when following links. 2 reaches /iso → /iso/iso-9001,
 *  which is the depth the live site needed and never got. */
const CRAWL_DEPTH = 2;

/** Per page. A long service page is 10-20k characters; 4000 cut every one of them. This is a
 *  ceiling against a runaway page, not a budget. */
const MAX_TEXT = 60_000;

/** Fetch timeout.
 *
 *  RAISED FROM 8s, 2026-09-27. 8s was inherited from the app's SYNCHRONOUS onboarding crawl,
 *  where the whole request has to finish inside a Vercel function — a budget this background
 *  job does not share. Measured on wca-global.com: the same page answered in 137ms and in
 *  11.6s on different attempts, because every non-www URL redirects to the www. host first. An
 *  8s ceiling makes that page indistinguishable from a dead one on a bad day, and a slow page
 *  is not a missing page.
 *
 *  HONEST NOTE ON WHAT THIS DID NOT FIX. It was raised while chasing twelve pages of that site
 *  (/apply, /verify, /career, /dashboard, …) that the crawl kept reporting as unreachable. The
 *  timeout was not their problem: those pages are JavaScript-rendered, and their HTML carries
 *  no article text at all — /apply has 24,671 characters of body text of which 23,405 are
 *  inside <script>, and 15 characters survive once the chrome is removed. Skipping them is
 *  correct, and no fetch timeout would ever have changed it. The raise stands on its own
 *  evidence above, not on theirs.
 *
 *  This is a ceiling against a hung request, not a target: a page that has said nothing in 20s
 *  is not going to. CRAWL_TIMEOUT_MS overrides it for a site that needs longer still. */
const TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS) || 20_000;

/** URLs that are never content: a shop's plumbing, a login, and the page-builder fragments
 *  that are not pages at all. Live proof this is needed: the stored set included
 *  /elementskit-content/dynamic-content-megamenu-menuitem7497 with 13 characters of text, and
 *  /cart, /checkout and /my-account with under 150 each, while real service pages were absent.
 *  Matched on the PATH only, so a legitimate article about "checkout optimisation" is safe. */
const JUNK_PATH =
  /(^\/(cart|checkout|my-account|account|login|logout|register|signup|wishlist|compare|basket)(\/|$))|(^\/elementskit-content\/)|(\/(feed|embed|amp)\/?$)|(^\/wp-(admin|login|json)(\/|$))/i;

/** Query strings that mean "a fragment of a page", not "a page". `?elementskit_template=` was
 *  storing three rows of 13-24 characters each on the live site. */
const JUNK_QUERY = /(^|&)(elementskit_template|replytocom|add-to-cart|orderby|s)=/i;

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|avif|ico|zip|gz|rar|css|js|mp4|mp3|wav|woff2?|ttf|eot|xml|json)$/i;

/** fetch, but it does not give up on the first blip.
 *
 *  EVERY fetch in this file used to be a single attempt inside a try/catch that returned []
 *  or null — so a momentary DNS or TCP failure was indistinguishable from "this site has no
 *  sitemap" and "this page is empty". That is not a hypothetical: it is the most likely
 *  explanation for the 2026-09-07 run that stored /cart and /checkout and none of the service
 *  pages, and it happened again while re-running the rebuilt crawler on 2026-09-19 — the
 *  sitemap returned 1 URL instead of 135 and 78 of 99 pages came back "unreadable", purely
 *  from a flaky local network.
 *
 *  Two attempts, briefly spaced. Retrying costs one extra request on a genuinely dead URL;
 *  not retrying costs a permanently wrong knowledge base, because the crawler upserts and the
 *  bad result becomes the truth. */
async function fetchWithRetry(url: string, attempts = 2): Promise<Response | null> {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      // A 5xx is the server having a moment too; a 4xx is an answer and is not retried.
      if (res.ok || res.status < 500 || i === attempts) return res;
    } catch {
      if (i === attempts) return null;
    }
    await new Promise((r) => setTimeout(r, 400 * i));
  }
  return null;
}

/** A website address we can actually fetch, or null.
 *
 *  `new URL()` throws on anything that isn't one, and the only call that mattered was
 *  unguarded — so a bad value stored on the tenant took the whole crawl down with
 *  "Invalid URL" and burned all three retries on data that retrying could never fix.
 *  Found live: onboarding's own "Skip — describe instead" link wrote the literal string
 *  "(no website yet)" into the field, which then had "https://" prefixed onto it.
 *
 *  Returns a normalised origin+path so every caller compares the same shape. */
export function normalizeSiteUrl(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  // A scheme that isn't http(s) is not a website. Without this check "mailto:a@b.com" got
  // "https://" glued in front and parsed as the host b.com with "mailto:a" as userinfo.
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^https?:\/\//i.test(v)) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Credentials in a website address mean it was pasted from somewhere it shouldn't be.
    if (u.username || u.password) return null;
    // No dot means it isn't a public site; whitespace means it was never a URL at all.
    if (!u.hostname.includes(".") || /\s/.test(u.hostname)) return null;
    return u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, ""));
  } catch {
    return null;
  }
}

/** ONE spelling per page, so the sitemap's "https://site/iso/" and a link's "/iso" are the
 *  same row rather than two. Trailing slash dropped, fragment dropped, and `www.` folded onto
 *  the origin we started from — the live sitemap redirects to www and the homepage links do
 *  not, which alone would have doubled every page. */
export function canonicalUrl(raw: string, origin: string): string | null {
  try {
    const u = new URL(raw, origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const base = new URL(origin);
    // Same site, ignoring a www. that only one of the two spellings carries.
    const host = u.hostname.replace(/^www\./i, "");
    if (host !== base.hostname.replace(/^www\./i, "")) return null;
    if (SKIP_EXT.test(u.pathname)) return null;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (JUNK_PATH.test(path)) return null;
    if (u.search && JUNK_QUERY.test(u.search.slice(1))) return null;
    // Tracking parameters are not a different page.
    const params = new URLSearchParams(u.search);
    for (const k of Array.from(params.keys())) {
      if (/^(utm_|fbclid|gclid|msclkid|ref|source)/i.test(k)) params.delete(k);
    }
    const q = params.toString();
    return `${base.origin}${path === "/" ? "/" : path}${q ? `?${q}` : ""}`;
  } catch {
    return null;
  }
}

export type Discovered = { url: string; depth: number };

/** Every page we can find, from every source we have, deduplicated.
 *
 *  THE UNION IS THE WHOLE POINT. The previous version returned the sitemap OR the homepage's
 *  links, and picking one lost the other's pages permanently (the crawler upserts and never
 *  prunes, so a bad run is forever). A sitemap is authoritative about what the owner wants
 *  indexed; the link graph is authoritative about what actually exists. Neither is a superset
 *  of the other — on the live site the sitemap held the 15 service pages and the link
 *  graph held 49 pages the sitemap never listed. Both are the site. */
export async function discoverUrls(siteUrl: string, limit: number): Promise<string[]> {
  return (await discover(siteUrl, limit)).map((d) => d.url);
}

export async function discover(siteUrl: string, limit: number): Promise<Discovered[]> {
  const site = normalizeSiteUrl(siteUrl);
  // Guarded, and with the offending value in the message — "Invalid URL" on its own told
  // nobody which field was wrong or where it came from.
  if (!site) throw new Error(`Not a usable website address: ${JSON.stringify(siteUrl)}`);
  const origin = new URL(site).origin;

  const found = new Map<string, number>();
  const add = (raw: string, depth: number) => {
    const url = canonicalUrl(raw, origin);
    if (!url) return;
    const prior = found.get(url);
    if (prior === undefined || depth < prior) found.set(url, depth);
  };

  add(origin, 0);

  // 1 ─ the sitemap, if there is one. Several well-known locations, because a site that has a
  //     sitemap at a non-default path is not a site without a sitemap, and treating it as one
  //     is how the service pages went missing.
  for (const path of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap-index.xml"]) {
    const urls = await tryFetchSitemap(`${origin}${path}`, limit * 2);
    for (const u of urls) add(u, 0);
    if (found.size > 1) break;
  }
  const fromSitemap = found.size;

  // 2 ─ the link graph, walked to CRAWL_DEPTH. Runs even when the sitemap worked: a sitemap
  //     that is stale or partial is the normal case, not the exception.
  let frontier = [origin];
  for (let depth = 1; depth <= CRAWL_DEPTH && found.size < limit; depth++) {
    const next: string[] = [];
    for (const page of frontier) {
      if (found.size >= limit) break;
      for (const href of await linksOn(page)) {
        const before = found.size;
        add(href, depth);
        const url = canonicalUrl(href, origin);
        if (url && found.size > before) next.push(url);
      }
    }
    frontier = next.slice(0, 60); // a fan-out ceiling, so one link-heavy page cannot own the crawl
  }

  console.log(`[crawl] ${origin}: ${fromSitemap} from sitemap, ${found.size} total after ${CRAWL_DEPTH} link levels`);

  // Shallow first: if a limit has to bite, it should bite the deepest pages, never the
  // homepage and the service pages the sitemap named.
  return Array.from(found, ([url, depth]) => ({ url, depth }))
    .sort((a, b) => a.depth - b.depth || a.url.length - b.url.length)
    .slice(0, limit);
}

async function tryFetchSitemap(url: string, limit: number, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  try {
    const res = await fetchWithRetry(url);
    if (!res || !res.ok) return [];
    const xml = await res.text();
    // A "sitemap" that is really an HTML 404 page parses as XML with zero <loc>s, which is
    // harmless — but a redirect to the homepage does too, and that used to read as "no sitemap".
    const $ = cheerio.load(xml, { xmlMode: true });

    const childSitemaps = $("sitemapindex sitemap loc").map((_, el) => $(el).text().trim()).get();
    if (childSitemaps.length) {
      const urls: string[] = [];
      for (const child of childSitemaps.slice(0, 25)) {
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

async function linksOn(pageUrl: string): Promise<string[]> {
  try {
    const res = await fetchWithRetry(pageUrl);
    if (!res || !res.ok) return [];
    if (!(res.headers.get("content-type") || "").includes("text/html")) return [];
    const $ = cheerio.load(await res.text());
    return $("a[href]").map((_, el) => $(el).attr("href") || "").get().filter(Boolean);
  } catch {
    return [];
  }
}

export type ExtractedPage = {
  title: string;
  text: string;
  metaDescription: string | null;
  headings: { level: number; text: string }[];
  canonical: string | null;
  wordCount: number;
  statusCode: number;
};

/** One page, read as fully as it is worth reading.
 *
 *  `nav` and `footer` are still stripped — on the live site the same 900-character menu was
 *  repeated into all 156 rows, which is how "every page mentions ISO 9001" became true and
 *  useless. `header` and `aside` join them for the same reason. Headings are read BEFORE the
 *  strip so a page whose H1 lives inside its header is not left anonymous. */
export async function extractPage(url: string): Promise<ExtractedPage | null> {
  try {
    const res = await fetchWithRetry(url);
    if (!res) return null;
    const statusCode = res.status;
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $("title").first().text().trim() || $("h1").first().text().trim() || url;
    const metaDescription =
      $('meta[name="description"]').attr("content")?.trim() ||
      $('meta[property="og:description"]').attr("content")?.trim() ||
      null;
    const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;

    const headings = $("h1, h2, h3")
      .map((_, el) => ({
        level: Number(el.tagName.slice(1)),
        text: $(el).text().replace(/\s+/g, " ").trim(),
      }))
      .get()
      .filter((h) => h.text && h.text.length <= 200)
      .slice(0, 60);

    $("script, style, noscript, nav, footer, header, aside, svg, form, iframe").remove();

    // Prefer the page's own main content region when it declares one: a WordPress theme's
    // <main> is the article, and everything outside it is the same chrome on every page.
    const main = $("main").first();
    const article = $("article").first();
    const root = main.length ? main : article.length ? article : $("body");
    const text = root.text().replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

    if (!text) return null;
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    return { title, text, metaDescription, headings, canonical, wordCount, statusCode };
  } catch {
    return null;
  }
}
