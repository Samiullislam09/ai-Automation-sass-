/** The reading half of Mr. Audit: fetch the pages, robots.txt and sitemap.xml, and hand the
 *  checks something they can measure (MASTER_PLAN §7.4).
 *
 *  Split from checks.ts on purpose — the entire check catalogue is a pure function of what
 *  comes out of here, which is what lets it be tested from a fixture instead of a live site.
 *
 *  THE MANNERS, same as the leads agent's (lib/leads/sources.ts): one request at a time per
 *  host with a gap between them, a User-Agent that says who we are and how to stop us, and a
 *  timeout on everything. We are auditing our own customer's site, but a crawler that hammers
 *  a small shared host is a crawler that gets the customer's site taken down.
 */

import { normalizeSiteUrl } from "../crawl.js";
import type { AuditPage, SiteContext } from "./checks.js";

export const AUDIT_UA = "MrLxwaAuditBot/1.0 (+https://mrlxwa.com/bot; site audit for the site's own owner)";

/** 400ms between requests to the same host. The site belongs to the customer who asked for the
 *  audit, so this is politeness to their server rather than to a stranger's. */
const GAP_MS = 400;
const TIMEOUT_MS = 15_000;
/** §7.4's own original figure was 50 pages — raised to match agents/audit.ts's own already-
 *  existing ceiling (2026-09-04, owner: "complete site audit samjhe?" — most small-business
 *  sites are well under 200 pages, so this is "the whole site" for nearly everyone on this
 *  plan, not a sample of it). Still a real cap, not unlimited: at 400ms between requests
 *  (GAP_MS, politeness to the customer's own server) 200 pages is ~80s for the deterministic
 *  crawl alone — a genuinely unbounded audit of a very large site would need its own async job
 *  design, not a bigger number here. A caller (agents/audit.ts's `pages` job param) can still
 *  ask for fewer. */
export const DEFAULT_PAGE_LIMIT = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Fetcher = typeof fetch;

/** One page, with everything the checks need and nothing they do not. Never throws: a page
 *  that cannot be read is a finding (`status: null`), not an exception that ends the audit. */
export async function fetchAuditPage(url: string, fetchImpl: Fetcher = fetch): Promise<AuditPage> {
  const started = Date.now();
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": AUDIT_UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    const type = res.headers.get("content-type") ?? "";
    // A PDF or an image reached from a link is not a broken page and not an HTML page either.
    // It is read for its status code and nothing else.
    const html = type.includes("html") ? await res.text() : null;
    return {
      url,
      status: res.status,
      finalUrl: res.url && res.url !== url ? res.url : null,
      html,
      bytes: html ? Buffer.byteLength(html, "utf8") : 0,
      ms,
      error: null,
    };
  } catch (e: any) {
    return { url, status: null, finalUrl: null, html: null, bytes: 0, ms: null, error: String(e?.message ?? e).slice(0, 200) };
  }
}

/** robots.txt and sitemap.xml — the two files that decide whether any of the rest matters. */
export async function fetchSiteContext(origin: string, fetchImpl: Fetcher = fetch): Promise<SiteContext> {
  const read = async (path: string): Promise<string | null> => {
    try {
      const res = await fetchImpl(origin + path, {
        headers: { "User-Agent": AUDIT_UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  };

  const robotsTxt = await read("/robots.txt");
  await sleep(GAP_MS);

  // The sitemap named in robots.txt wins over the conventional location — plenty of sites put
  // it somewhere else and say so, and guessing /sitemap.xml would report "no sitemap" at them.
  const declared = robotsTxt?.match(/^\s*sitemap:\s*(\S+)/im)?.[1] ?? null;
  const xml = declared ? await readAbsolute(declared, fetchImpl) : await read("/sitemap.xml");

  return {
    origin,
    robotsTxt,
    sitemapUrls: xml === null ? null : parseSitemap(xml),
    sitemapUrl: declared ?? origin + "/sitemap.xml",
    // A file that answered 200 but is not a sitemap — an HTML "not found" page served with the
    // wrong status is the usual way this happens. Decided from the bytes already in hand, no
    // second request (MASTER_PLAN §27.1 #13).
    sitemapMalformed: xml !== null && !/<(urlset|sitemapindex)[\s>]/i.test(xml),
    sitemapBytes: xml === null ? 0 : Buffer.byteLength(xml, "utf8"),
  };
}

async function readAbsolute(url: string, fetchImpl: Fetcher): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { headers: { "User-Agent": AUDIT_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** <loc> out of a sitemap, including a sitemap index (whose <loc>s are other sitemaps — those
 *  are returned too, and the caller simply finds no HTML at them; chasing an index recursively
 *  is a Phase 4 problem, and pretending it is handled would be worse than not doing it). */
export function parseSitemap(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

/** Which pages to audit, in priority order: the sitemap if there is one (it is the site's own
 *  statement of what matters), otherwise whatever the database already crawled, otherwise the
 *  home page alone. Deduplicated, capped, same-origin only. */
export function chooseUrls(origin: string, sitemapUrls: string[] | null, crawled: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (u: string) => {
    let abs: URL;
    try {
      abs = new URL(u, origin);
    } catch {
      return;
    }
    if (abs.origin.toLowerCase() !== origin.toLowerCase()) return;
    abs.hash = "";
    const key = abs.toString();
    if (seen.has(key)) return;
    seen.add(key);
    if (out.length < limit) out.push(key);
  };

  push(origin + "/");
  for (const u of sitemapUrls ?? []) push(u);
  for (const u of crawled) push(u);
  return out;
}

/** Fetch every chosen page, one at a time, reporting progress as it goes. Sequential by
 *  design: concurrency here would be politeness spent on speed the customer did not ask for. */
export async function fetchAllPages(
  urls: string[],
  onPage: (done: number, total: number, url: string) => void,
  fetchImpl: Fetcher = fetch,
): Promise<AuditPage[]> {
  const pages: AuditPage[] = [];
  for (const url of urls) {
    pages.push(await fetchAuditPage(url, fetchImpl));
    onPage(pages.length, urls.length, url);
    if (pages.length < urls.length) await sleep(GAP_MS);
  }
  return pages;
}

/** The tenant's address, or a sentence saying why there is nothing to audit. Same shape the
 *  leads agent uses for a missing ICP: a returned answer, not a thrown error, because the fix
 *  is the user typing something rather than us retrying. */
export function auditTarget(websiteUrl: string | null | undefined): { ok: true; origin: string } | { ok: false; reason: string } {
  const site = normalizeSiteUrl(websiteUrl ?? null);
  if (!site) {
    return {
      ok: false,
      reason: websiteUrl
        ? `The website on file isn't a usable address: ${JSON.stringify(websiteUrl)}. Fix it in Settings and I'll audit it.`
        : "There's no website on your account yet, so there's nothing for me to audit. Add it in Settings.",
    };
  }
  try {
    return { ok: true, origin: new URL(site).origin };
  } catch {
    return { ok: false, reason: `The website on file isn't a usable address: ${JSON.stringify(websiteUrl)}.` };
  }
}
