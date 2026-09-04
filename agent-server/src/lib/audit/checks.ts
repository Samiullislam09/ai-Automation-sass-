/** Mr. Audit's checklist — what is wrong with the site as a whole (MASTER_PLAN §7.4).
 *
 *  Mr. SEO asks "will this ONE page answer the query it was written for?". Mr. Audit asks the
 *  question a site owner actually wakes up with: "is anything on my site broken, invisible to
 *  Google, or quietly costing me traffic?" — across every page at once. Two of the findings
 *  here are impossible to see one page at a time (duplicate titles, orphan pages), which is
 *  the whole reason this is a separate agent rather than Mr. SEO in a loop.
 *
 *  THE RULES ARE seoChecks.ts's RULES, deliberately, so a customer never has to learn a second
 *  scale or a second vocabulary:
 *
 *   · Every check is DETERMINISTIC. Nothing here asks a model whether a site is good.
 *   · Severity is "block" | "warn" | "info". "info" is a note or a check we could not run —
 *     it is shown, and it costs nothing.
 *   · Every failing check carries a FIX someone can act on today.
 *   · Score is 100 − 25·block − 5·warn, clamped to 0..100.
 *
 *  WHAT IS DELIBERATELY NOT HERE, AND WHY
 *
 *  This file measures only what a plain HTTP fetch can prove: status codes, redirects,
 *  canonicals, titles, headings, alt text, internal links, robots.txt, sitemap.xml, mixed
 *  content, page weight, response time. No browser, on purpose — it is what makes every check
 *  here testable from a fixture with nothing running behind it.
 *
 *  Core Web Vitals (LCP, CLS, an interactivity proxy) and anything a JavaScript-rendered page
 *  only shows after hydration need a real browser, and are NOT approximated here — a
 *  "performance score" derived from HTML size would be a made-up number dressed as a
 *  measurement, which is the one thing this product cannot afford to ship. That real
 *  measurement is lib/audit/performance.ts (2026-08-28, real `lighthouse`, not a stub); its
 *  issues arrive here as the optional `performance` argument to `auditSite()` below, kept
 *  separate so this file never has to import a browser to stay true to its own name.
 *  `skipped` still says so in words on any report where the browser genuinely could not launch
 *  — the gap moved from "nobody measures this" to "this specific deploy has no Chrome", and
 *  both are told honestly rather than one silently standing in for the other.
 */

import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { parseRobotsTxt, isBlocked } from "./robots.js";

/* ---------------------------------------------------------------- types ----------------- */

export type AuditSeverity = "block" | "warn" | "info";

/** One page as the checks see it. Everything is already fetched; nothing in this file touches
 *  the network, which is what makes the whole catalogue testable from a fixture. */
export type AuditPage = {
  url: string;
  /** null when the page could not be fetched at all — that is itself a finding. */
  status: number | null;
  /** Where a redirect landed, when it did. */
  finalUrl: string | null;
  html: string | null;
  /** Bytes of HTML. Not "page weight" — images and scripts are not counted, and the report
   *  says so rather than implying a number we did not measure. */
  bytes: number;
  /** Milliseconds to the first byte of the response body. */
  ms: number | null;
  /** Why it could not be read, in a sentence, when status is null. */
  error?: string | null;
};

export type SiteContext = {
  origin: string;
  /** robots.txt as text, or null when it 404s / could not be read. */
  robotsTxt: string | null;
  /** The URLs listed in sitemap.xml, or null when there is no readable sitemap. */
  sitemapUrls: string[] | null;
  /** Where the sitemap was looked for (the robots.txt `Sitemap:` address, else /sitemap.xml) —
   *  so a sitemap finding can name the file it is about. Optional: every fixture built before
   *  Round A (2026-09-05) omits it, and the checks fall back to origin + "/sitemap.xml". */
  sitemapUrl?: string | null;
  /** True when a sitemap WAS fetched but is not a sitemap (no <urlset>/<sitemapindex> root) —
   *  Semrush's "sitemap.xml format error", told from the same bytes fetchSite.ts already read. */
  sitemapMalformed?: boolean;
  /** Size of the sitemap file in bytes (0 / absent when there is none) — for the 50 MB cap. */
  sitemapBytes?: number;
};

export type AuditIssue = {
  /** Stable id — the UI, the trend and the tests key off this, never off the prose. */
  id: string;
  severity: AuditSeverity;
  /** What is wrong, in the customer's language. */
  what: string;
  /** What to do about it. */
  fix: string;
  /** The pages it happens on. Capped when rendered, never when counted. */
  pages: string[];
  /** How many pages in total — `pages` may be a sample, `count` never is. */
  count: number;
  /** Semrush's own thematic-report taxonomy (MASTER_PLAN §27) — Crawlability, HTTPS, Performance,
   *  Core Web Vitals, Internal Linking, On-Page SEO, Content, Technical SEO. Looked up by id from
   *  CHECK_CATEGORY at the end of auditSite(), so a check written anywhere (this file,
   *  performance.ts, the inline robots finding) gets one from the same table. Optional on the
   *  TYPE because every construction site (the `issue()` closure, performance.ts's
   *  issuesFromVitals, the inline robots finding) builds the issue first and the lookup stamps
   *  it last — but every issue that leaves auditSite() has one, and checks.test.ts pins that. */
  category?: string;
};

/** What the Statistics tab aggregates (MASTER_PLAN §27.4, Round A): one row per HTML page this
 *  run could read, every number a measurement the checks above already took — click depth from
 *  the same BFS `deep-page` uses, in-links from the same graph `orphan-page` uses, title and
 *  description length from the same strings `short-title`/`missing-meta` judge. Nothing here
 *  is recomputed by the page from the HTML (which is not stored), so a histogram can never
 *  disagree with the issue rows next to it. */
export type PageStats = {
  url: string;
  /** Clicks from the home page over internal links; null when no link path reaches it. */
  depth: number | null;
  titleChars: number;
  descriptionChars: number;
  words: number;
  inLinks: number;
  outLinks: number;
};

export type AuditResult = {
  /** 0-100. The average crawled page's health, minus the site-wide findings — see the block
   *  comment at the score itself for why it is no longer a count of problem kinds. */
  score: number;
  /** The same arithmetic per Semrush thematic category — the report page's rings read this
   *  rather than deriving their own, so a ring and the headline always agree. */
  thematic: { category: string; health: number; issues: number; checks: number }[];
  pagesChecked: number;
  blocks: number;
  warns: number;
  issues: AuditIssue[];
  /** Checks we could not run, and why. Rendered as-is; never silently dropped. */
  skipped: string[];
  /** Every URL that appears in at least one on-page issue's FULL affected-page list — computed
   *  from the same data each `issue()` call already builds, before PAGE_SAMPLE trims what is
   *  shown, so this is exact, not a sample-union that undercounts. Real Core Web Vitals issues
   *  (from lib/audit/performance.ts, only ~10 pages sampled) are deliberately excluded — mixing
   *  a 10-page performance sample into a 50-200 page crawl breakdown would misrepresent both.
   *  Used by the report page's Crawled Pages "Have issues" bucket (2026-09-05). */
  pagesWithIssues: string[];
  /** Every URL disallowed for `User-agent: *` by the site's own robots.txt — real evaluation
   *  (lib/audit/robots.ts), not a guess. Empty when robots.txt could not be read at all (that
   *  gap is already reported in `skipped`). Used by the same Crawled Pages "Blocked" bucket. */
  blockedPages: string[];
  /** Every check this catalogue can make, with its category — the DENOMINATOR the report page's
   *  thematic rings need ("Crawlability 94%" = checks in Crawlability that did NOT fire / all
   *  checks in Crawlability). Without this the page could only see the checks that failed and
   *  would have to guess how many existed; shipping the list makes the % exact. */
  catalogue: { id: string; category: string; severity: AuditSeverity }[];
  /** Per-page measurements for the Statistics tab — see PageStats. Only pages with HTML. */
  pageStats: PageStats[];
};

/* ---------------------------------------------------------------- helpers --------------- */

// How many example URLs an issue carries — `count` is always exact regardless. Raised 8 → 100
// (2026-09-05, "see more" full-page popup on the Audit report page) so that view has real URLs
// to show for nearly every issue on a small-business site, not just the first 8; still capped,
// never the unbounded list, so one issue on a huge site cannot make the row heavier than the
// rest of the report.
const PAGE_SAMPLE = 100;

/** Site Health arithmetic (see the block comment where the score is computed). A warning costs
 *  a page 5 of its 100; a block costs it all of them; a notice costs nothing. A site-wide
 *  finding (robots.txt, sitemap) is taken off the site's own average once. */
const HEALTH_WARN = 5;
const HEALTH_FILE_BLOCK = 25;

/** Semrush's own thematic-report taxonomy, one entry per check this catalogue makes — MASTER_PLAN
 *  §27's own tables, transcribed. Every id here must match the `issue(...)` id it labels (the
 *  test in checks.test.ts pins that: a check that fires with no category fails the build). The
 *  four `performance.ts` ids and the inline `robots-blocks-all` finding are here too, so one
 *  table covers every issue that can reach a report. Ids and categories never change once
 *  shipped — the trend/compare views key off them. */
export const CHECK_CATALOGUE: { id: string; category: string; severity: AuditSeverity }[] = [
  // ── Crawlability ──
  { id: "unreachable", category: "Crawlability", severity: "block" },
  { id: "unreachable-dns", category: "Crawlability", severity: "block" },
  { id: "server-error", category: "Crawlability", severity: "block" },
  { id: "not-found", category: "Crawlability", severity: "block" },
  { id: "noindex", category: "Crawlability", severity: "block" },
  { id: "robots-blocks-all", category: "Crawlability", severity: "block" },
  { id: "robots-format-error", category: "Crawlability", severity: "warn" },
  { id: "robots-not-found", category: "Crawlability", severity: "info" },
  { id: "no-sitemap", category: "Crawlability", severity: "warn" },
  { id: "sitemap-format-error", category: "Crawlability", severity: "warn" },
  { id: "sitemap-bad-page", category: "Crawlability", severity: "warn" },
  { id: "malformed-sitemap-url", category: "Crawlability", severity: "warn" },
  { id: "sitemap-too-large", category: "Crawlability", severity: "warn" },
  { id: "sitemap-not-in-robots", category: "Crawlability", severity: "warn" },
  { id: "blocked-resources", category: "Crawlability", severity: "warn" },
  { id: "malformed-link", category: "Crawlability", severity: "warn" },
  { id: "long-link-url", category: "Crawlability", severity: "warn" },
  { id: "underscore-url", category: "Crawlability", severity: "warn" },
  { id: "too-many-params", category: "Crawlability", severity: "warn" },
  { id: "long-url", category: "Crawlability", severity: "info" },
  { id: "resource-as-link", category: "Crawlability", severity: "info" },
  // ── HTTPS ──
  { id: "mixed-content", category: "HTTPS", severity: "block" },
  { id: "non-secure-page", category: "HTTPS", severity: "block" },
  { id: "homepage-not-https", category: "HTTPS", severity: "warn" },
  { id: "http-urls-in-sitemap", category: "HTTPS", severity: "warn" },
  { id: "https-to-http-links", category: "HTTPS", severity: "warn" },
  // ── Technical SEO ──
  { id: "redirect-chain", category: "Technical SEO", severity: "warn" },
  { id: "heavy-html", category: "Technical SEO", severity: "warn" },
  { id: "missing-viewport", category: "Technical SEO", severity: "warn" },
  { id: "viewport-no-width", category: "Technical SEO", severity: "warn" },
  { id: "meta-refresh", category: "Technical SEO", severity: "warn" },
  { id: "no-charset", category: "Technical SEO", severity: "warn" },
  { id: "no-doctype", category: "Technical SEO", severity: "warn" },
  { id: "plugin-content", category: "Technical SEO", severity: "warn" },
  { id: "frames", category: "Technical SEO", severity: "warn" },
  // ── On-Page SEO ──
  { id: "missing-title", category: "On-Page SEO", severity: "block" },
  { id: "long-title", category: "On-Page SEO", severity: "warn" },
  { id: "short-title", category: "On-Page SEO", severity: "warn" },
  { id: "duplicate-title", category: "On-Page SEO", severity: "warn" },
  { id: "h1-equals-title", category: "On-Page SEO", severity: "warn" },
  { id: "missing-meta", category: "On-Page SEO", severity: "warn" },
  { id: "duplicate-meta", category: "On-Page SEO", severity: "warn" },
  { id: "missing-h1", category: "On-Page SEO", severity: "warn" },
  { id: "multiple-h1", category: "On-Page SEO", severity: "warn" },
  { id: "missing-canonical", category: "On-Page SEO", severity: "warn" },
  { id: "multiple-canonical", category: "On-Page SEO", severity: "warn" },
  { id: "image-no-alt", category: "On-Page SEO", severity: "warn" },
  { id: "invalid-structured-data", category: "On-Page SEO", severity: "warn" },
  // ── Content ──
  { id: "thin-content", category: "Content", severity: "warn" },
  { id: "duplicate-content", category: "Content", severity: "warn" },
  { id: "low-text-ratio", category: "Content", severity: "warn" },
  // ── Internal Linking ──
  { id: "orphan-page", category: "Internal Linking", severity: "warn" },
  { id: "internal-nofollow", category: "Internal Linking", severity: "warn" },
  { id: "too-many-links", category: "Internal Linking", severity: "warn" },
  { id: "one-incoming-link", category: "Internal Linking", severity: "info" },
  { id: "deep-page", category: "Internal Linking", severity: "info" },
  { id: "generic-anchor", category: "Internal Linking", severity: "info" },
  { id: "empty-anchor", category: "Internal Linking", severity: "info" },
  { id: "external-nofollow", category: "Internal Linking", severity: "info" },
  // ── International SEO ──
  { id: "hreflang-conflict", category: "International SEO", severity: "warn" },
  { id: "hreflang-invalid", category: "International SEO", severity: "warn" },
  { id: "no-lang", category: "International SEO", severity: "warn" },
  { id: "hreflang-lang-mismatch", category: "International SEO", severity: "info" },
  // ── AI Search ──
  { id: "ai-too-much-content", category: "AI Search", severity: "info" },
  { id: "ai-outdated-content", category: "AI Search", severity: "info" },
  { id: "ai-low-semantic-html", category: "AI Search", severity: "info" },
  // ── Performance / Core Web Vitals ──
  { id: "slow-response", category: "Performance", severity: "warn" },
  { id: "slow-lcp", category: "Core Web Vitals", severity: "warn" },
  { id: "layout-shift", category: "Core Web Vitals", severity: "warn" },
  { id: "slow-interactivity", category: "Core Web Vitals", severity: "info" },
  { id: "performance-check-failed", category: "Core Web Vitals", severity: "info" },
];
// Severity above is the HOUSE scale (§7.4: score = 100 − 25·block − 5·warn, counted per KIND of
// problem), not a transcription of Semrush's Error/Warning/Notice column — MASTER_PLAN §27
// records which Semrush column each check sits in. Twenty new "block" kinds at −25 each would
// put nearly every real site at 0/100 and the score would stop meaning anything, so "block"
// stays reserved for what actually stops a page being found or trusted (unreachable, 5xx, 4xx,
// noindex, robots-blocks-all, missing title, mixed content, a plain-http page).

/** Semrush's own thresholds where it publishes one, ours where it does not — each stated in the
 *  finding's own sentence, so a customer can see the line and never has to guess it. */
const SHORT_TITLE_CHARS = 30;
const LONG_URL_CHARS = 200;
const MAX_URL_PARAMS = 4;
const MAX_LINKS_PER_PAGE = 3000;
const MIN_TEXT_RATIO = 0.1;
const SITEMAP_MAX_URLS = 50_000;
const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;
const MAX_CLICK_DEPTH = 3;
const AI_TOO_MANY_WORDS = 4000;
const AI_OUTDATED_MONTHS = 24;
const AI_MIN_DIVS_FOR_SEMANTIC_CHECK = 30;
const AI_MIN_SEMANTIC_RATIO = 0.05;
/** Words that tell a reader (and a crawler) nothing about where the link goes. */
const GENERIC_ANCHORS = new Set(["click here", "here", "read more", "more", "learn more", "link", "this", "this page", "click", "go", "continue", "see more", "view"]);
/** Files that are a resource, not a page — an <a href> at one of these is a mis-typed link. */
const RESOURCE_EXT = /\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|otf|mp4|webm|mp3|zip)$/i;
/** BCP-47 as far as hreflang uses it: language (2-3), optional script (4), optional region
 *  (2 letters or 3 digits), or the literal x-default. */
const HREFLANG_RE = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;
/** Every directive robots.txt (RFC 9309 + the ones Google/Yandex/Bing document) can contain. */
const ROBOTS_DIRECTIVES = new Set(["user-agent", "disallow", "allow", "sitemap", "crawl-delay", "host", "clean-param", "request-rate", "visit-time", "noindex"]);
/** What a fetch error says when the name did not resolve at all — Node's own words. */
const DNS_ERROR = /ENOTFOUND|EAI_AGAIN|EAI_NONAME|getaddrinfo|dns/i;
const CHECK_CATEGORY: Record<string, string> = Object.fromEntries(CHECK_CATALOGUE.map((c) => [c.id, c.category]));

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}

/** Same-origin, ignoring the fragment and the trailing slash — the two ways the same page
 *  turns into two "different" URLs and makes an orphan-page report lie. */
function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.origin.toLowerCase() + u.pathname;
  } catch {
    return url;
  }
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin.toLowerCase() === origin.toLowerCase();
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- page facts ------------ */

/** Everything the checks need to know about ONE page, read off its DOM exactly once and kept
 *  after the DOM is thrown away.
 *
 *  WHY THIS EXISTS (2026-09-05): the checks used to hold a cheerio DOM for every readable page
 *  at once. A DOM is ~10× the HTML it came from; 156 Elementor pages of 300-800 KB each is
 *  well over a gigabyte, and Railway killed the whole agent-server out of memory every time the
 *  crawl finished — before a single check ran, before the report was filed. Extracting these
 *  facts one page at a time keeps one DOM alive at any moment, and the facts for a page are a
 *  few kilobytes (anchor list included) instead of megabytes.
 *
 *  Nothing here is a judgement — every field is a measurement; the judgements are in
 *  auditFacts() below, so a check can still be read in one place. */
export type PageFacts = {
  page: AuditPage;
  /** status < 400 and there was HTML to read. Every field below is meaningless when false. */
  readable: boolean;
  hasDoctype: boolean;
  noindex: boolean;
  title: string;
  description: string;
  h1Count: number;
  /** First H1's text, whitespace-normalised and lower-cased (for the H1-equals-title check). */
  firstH1: string;
  /** Every <link rel=canonical href> on the page, in order. */
  canonicals: string[];
  imageWithoutAlt: boolean;
  /** An img/script/link on the page loads from http:// (judged against the page's own scheme later). */
  insecureResource: boolean;
  metaRefresh: boolean;
  /** The viewport meta's content, or null when the tag is absent. */
  viewport: string | null;
  hasCharset: boolean;
  pluginContent: boolean;
  frames: boolean;
  invalidStructuredData: boolean;
  hreflangs: { lang: string; href: string }[];
  htmlLang: string;
  /** Every <a href>, as the link checks need it — nothing about the element is kept. */
  anchors: { href: string; nofollow: boolean; text: string; imgAlt: boolean; labelled: boolean }[];
  /** Raw src/href of every script, stylesheet and image (for the robots.txt-blocked check). */
  resources: string[];
  /** Visible text — script/style and the site furniture removed — as a word count, a character
   *  count and a hash. The text itself is not kept: duplicate-content only needs equality. */
  words: number;
  textChars: number;
  textHash: string;
  /** The newest date the page states about itself (time/meta/JSON-LD), or null when it states none. */
  latestDate: number | null;
  divCount: number;
  semanticCount: number;
};

const EMPTY_FACTS: Omit<PageFacts, "page" | "readable"> = {
  hasDoctype: false,
  noindex: false,
  title: "",
  description: "",
  h1Count: 0,
  firstH1: "",
  canonicals: [],
  imageWithoutAlt: false,
  insecureResource: false,
  metaRefresh: false,
  viewport: null,
  hasCharset: false,
  pluginContent: false,
  frames: false,
  invalidStructuredData: false,
  hreflangs: [],
  htmlLang: "",
  anchors: [],
  resources: [],
  words: 0,
  textChars: 0,
  textHash: "",
  latestDate: null,
  divCount: 0,
  semanticCount: 0,
};

const normText = (s: string) => s.replace(/\s+/g, " ").trim();

/** JSON-LD that a parser rejects, or that names no @type, is markup Google throws away whole. */
function ldValid(text: string): boolean {
  try {
    const j = JSON.parse(text);
    const items = Array.isArray(j) ? j : j && Array.isArray(j["@graph"]) ? j["@graph"] : [j];
    return items.length > 0 && items.every((it: unknown) => !!it && typeof it === "object" && "@type" in (it as object));
  } catch {
    return false;
  }
}

/** One page's facts from its HTML. The DOM lives only inside this function. */
export function extractPageFacts(page: AuditPage): PageFacts {
  const readable = page.status !== null && page.status < 400 && !!page.html;
  if (!readable) return { page, readable: false, ...EMPTY_FACTS };

  const html = page.html as string;
  const $ = cheerio.load(html);

  // Visible text: a clone with script/style and the furniture removed, so thin-content,
  // duplicate-content, text ratio and the AI notices all agree on what "the text" is.
  const clone = cheerio.load($.html());
  clone("script, style, nav, header, footer, noscript").remove();
  const text = normText(clone("body").text());

  const raw: string[] = [];
  $("time[datetime]").each((_, el) => {
    raw.push($(el).attr("datetime") ?? "");
  });
  $('meta[property="article:modified_time"], meta[property="article:published_time"], meta[name="last-modified"], meta[itemprop="dateModified"], meta[itemprop="datePublished"]').each((_, el) => {
    raw.push($(el).attr("content") ?? "");
  });
  let invalidStructuredData = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    const t = $(el).text();
    if (!ldValid(t)) invalidStructuredData = true;
    for (const m of t.matchAll(/"date(?:Modified|Published)"\s*:\s*"([^"]+)"/g)) raw.push(m[1]);
  });
  const times = raw.map((d) => Date.parse(d)).filter((t) => Number.isFinite(t));

  const viewportEl = $('meta[name="viewport"]').first();

  return {
    page,
    readable: true,
    // \uFEFF is a byte-order mark — some editors put one before the doctype; not a defect.
    hasDoctype: /^\uFEFF?\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<!doctype/i.test(html),
    noindex: /noindex/i.test($('meta[name="robots"]').attr("content") ?? ""),
    title: ($("title").first().text() ?? "").trim(),
    description: ($('meta[name="description"]').attr("content") ?? "").trim(),
    h1Count: $("h1").length,
    firstH1: normText($("h1").first().text()).toLowerCase(),
    canonicals: $('link[rel="canonical"]')
      .toArray()
      .map((el) => ($(el).attr("href") ?? "").trim())
      .filter(Boolean),
    imageWithoutAlt: $("img").toArray().some((el) => !($(el).attr("alt") ?? "").trim()),
    insecureResource: $('img[src^="http://"], script[src^="http://"], link[href^="http://"]').length > 0,
    metaRefresh: $("meta[http-equiv]").toArray().some((el) => /^refresh$/i.test(($(el).attr("http-equiv") ?? "").trim())),
    viewport: viewportEl.length ? viewportEl.attr("content") ?? "" : null,
    hasCharset:
      $("meta[charset]").length > 0 ||
      $("meta[http-equiv]")
        .toArray()
        .some((el) => /content-type/i.test($(el).attr("http-equiv") ?? "") && /charset=/i.test($(el).attr("content") ?? "")),
    pluginContent: $("object, embed, applet")
      .toArray()
      .some((el) => el.tagName === "applet" || /flash|shockwave|silverlight|\.swf\b|\.xap\b|clsid:/i.test(Object.values($(el).attr() ?? {}).join(" "))),
    frames: $("frame, frameset").length > 0,
    invalidStructuredData,
    hreflangs: $('link[rel="alternate"][hreflang]')
      .toArray()
      .map((el) => ({ lang: ($(el).attr("hreflang") ?? "").trim(), href: ($(el).attr("href") ?? "").trim() }))
      .filter((h) => h.lang),
    htmlLang: ($("html").attr("lang") ?? "").trim(),
    anchors: $("a[href]")
      .toArray()
      .map((el) => ({
        href: ($(el).attr("href") ?? "").trim(),
        nofollow: /\bnofollow\b/.test(($(el).attr("rel") ?? "").toLowerCase()),
        text: normText($(el).text()).slice(0, 120),
        imgAlt: $(el)
          .find("img")
          .toArray()
          .some((img) => !!($(img).attr("alt") ?? "").trim()),
        labelled: !!(($(el).attr("aria-label") ?? "").trim() || ($(el).attr("title") ?? "").trim()),
      })),
    resources: $('script[src], link[rel="stylesheet"][href], img[src]')
      .toArray()
      .map((el) => ($(el).attr("src") ?? $(el).attr("href") ?? "").trim())
      .filter(Boolean),
    words: text ? text.split(" ").length : 0,
    textChars: text.length,
    textHash: createHash("sha1").update(text.toLowerCase()).digest("hex"),
    latestDate: times.length ? Math.max(...times) : null,
    divCount: $("div").length,
    semanticCount: $("main, article, section, nav, header, footer, aside").length,
  };
}

/** Facts for every page, one DOM at a time. `releaseHtml` drops each page's HTML string once
 *  its facts are taken — agents/audit.ts passes true, because after this nothing reads the HTML
 *  again and a 156-page crawl's HTML is tens of MB it no longer needs. Fixtures/tests keep it. */
export function extractFacts(pages: AuditPage[], releaseHtml = false): PageFacts[] {
  return pages.map((p) => {
    const f = extractPageFacts(p);
    if (releaseHtml) p.html = null;
    return f;
  });
}

/* ---------------------------------------------------------------- the catalogue --------- */

/** Everything that can be said about a site from its HTML and its two text files.
 *
 *  Order is the order the customer reads them in: broken first, then invisible-to-Google, then
 *  the on-page work. Within a severity the list is stable, because a report whose rows move
 *  between runs cannot be compared to the last one. */
export function auditSite(
  pages: AuditPage[],
  site: SiteContext,
  /** Real Core Web Vitals from lib/audit/performance.ts, when a browser was available to
   *  measure them. Optional and last, so every existing caller/test (all network-free, all
   *  built from fixtures with no Chrome anywhere near them) keeps compiling unchanged. */
  performance?: { issues: AuditIssue[]; skippedReason: string | null }
): AuditResult {
  return auditFacts(extractFacts(pages), site, performance);
}

/** The catalogue over already-extracted facts — what agents/audit.ts calls twice (once to
 *  file the report before the browser phase, once to add the vitals) without parsing any HTML
 *  a second time. */
export function auditFacts(
  facts: PageFacts[],
  site: SiteContext,
  performance?: { issues: AuditIssue[]; skippedReason: string | null }
): AuditResult {
  const pages = facts.map((f) => f.page);
  const skipped: string[] = [];
  const issues: (AuditIssue | null)[] = [...(performance?.issues ?? [])];

  // Real per-page issue attribution (2026-09-05, Crawled Pages breakdown's "Have issues"
  // bucket) — a closure over `pageIssueIds` so every `issue()` call below tallies the FULL
  // (untruncated) affected-page list it already builds, before PAGE_SAMPLE trims what is
  // shown. Summing the capped `.pages` samples after the fact would undercount on a big site;
  // this never does, because it tallies before the cap is applied, not after.
  const pageIssueIds = new Map<string, Set<string>>();
  /** Builds an issue only when it applies to at least one page. Returning null rather than an
   *  empty issue means the caller can `.filter(Boolean)` and no report ever shows "0 pages have
   *  a missing title" as though it were a finding. */
  function issue(id: string, severity: AuditSeverity, pageUrls: string[], what: (n: number) => string, fix: string): AuditIssue | null {
    for (const u of pageUrls) {
      if (!pageIssueIds.has(u)) pageIssueIds.set(u, new Set());
      pageIssueIds.get(u)!.add(id);
    }
    if (!pageUrls.length) return null;
    return { id, severity, what: what(pageUrls.length), fix, pages: pageUrls.slice(0, PAGE_SAMPLE), count: pageUrls.length };
  }

  /** A finding about one of the site's two text files rather than about pages — robots.txt or
   *  the sitemap. Not routed through `issue()` because those files are not crawled pages and
   *  must not land in `pagesWithIssues`. */
  const fileIssueIds = new Set<string>();
  function fileIssue(id: string, severity: AuditSeverity, url: string, what: string, fix: string): AuditIssue {
    fileIssueIds.add(id);
    return { id, severity, what, fix, pages: [url], count: 1 };
  }

  /** The readable pages — the ones every on-page check is about. */
  const pf = facts.filter((f) => f.readable);
  const ok = pf.map((f) => f.page);
  const factsByUrl = new Map(facts.map((f) => [f.page.url, f]));
  /** `pf.filter(pred).map(url)` — the shape of nearly every check below. */
  const urlsWhere = (pred: (f: PageFacts) => boolean) => pf.filter(pred).map((f) => f.page.url);

  let siteHost = "";
  try {
    siteHost = new URL(site.origin).host.toLowerCase();
  } catch {
    /* an origin that is not a URL never gets here — auditTarget() refuses it upstream */
  }
  const homeKey = canonicalKey(site.origin);
  const sitemapFile = site.sitemapUrl ?? site.origin + "/sitemap.xml";
  const robotsFile = site.origin + "/robots.txt";
  const groups = site.robotsTxt === null ? null : parseRobotsTxt(site.robotsTxt);

  /* ── 1 · broken and unreachable ─────────────────────────────────────────────────────── */

  // DNS failures are their own row (Semrush "couldn't be crawled: DNS resolution issue") because
  // the fix is different from a timeout or a refused connection: the NAME is wrong, not the
  // server. Split on the error text Node itself wrote — never inferred from the URL.
  const dead = pages.filter((p) => p.status === null);
  const dns = dead.filter((p) => DNS_ERROR.test(p.error ?? ""));
  const dnsSet = new Set(dns.map((p) => p.url));
  issues.push(
    issue(
      "unreachable-dns",
      "block",
      dns.map((p) => p.url),
      (n) => `${n} ${n === 1 ? "address does" : "addresses do"} not resolve — the domain name itself could not be found`,
      "Check the hostname in these links for a typo, and that the domain's DNS records exist. Nothing at a name that does not resolve can be reached by anyone, Google included.",
    ),
  );

  issues.push(
    issue(
      "unreachable",
      "block",
      dead.filter((p) => !dnsSet.has(p.url)).map((p) => p.url),
      (n) => `${n} ${n === 1 ? "page" : "pages"} could not be loaded at all`,
      "Open these in a browser. If they load for you, the server may be blocking automated visitors — which also blocks Google.",
    ),
  );

  issues.push(
    issue(
      "server-error",
      "block",
      pages.filter((p) => p.status !== null && p.status >= 500).map((p) => p.url),
      (n) => `${n} ${n === 1 ? "page returns" : "pages return"} a server error`,
      "Your host or developer needs to look at these — a 5xx page earns nothing and Google will eventually drop it.",
    ),
  );

  issues.push(
    issue(
      "not-found",
      "block",
      // Every 4xx, not only 404 (Semrush "4XX status code"): a 403 or 410 loses the visitor and
      // the ranking exactly the same way, and the fix — bring it back or redirect it — is the same.
      pages.filter((p) => p.status !== null && p.status >= 400 && p.status < 500).map((p) => p.url),
      (n) => `${n} ${n === 1 ? "link points" : "links point"} at a page that cannot be opened (4xx)`,
      "Either bring the page back or redirect it to the closest replacement. Deleting a page without a redirect throws away every link it earned.",
    ),
  );

  issues.push(
    issue(
      "redirect-chain",
      "warn",
      pages.filter((p) => p.finalUrl && canonicalKey(p.finalUrl) !== canonicalKey(p.url)).map((p) => p.url),
      (n) => `${n} ${n === 1 ? "URL redirects" : "URLs redirect"} somewhere else`,
      "Update your own links to point at the final address. Every redirect is a delay for the visitor and a hop Google may not follow.",
    ),
  );

  /* ── 2 · invisible to Google ────────────────────────────────────────────────────────── */

  issues.push(
    issue(
      "noindex",
      "block",
      urlsWhere((f) => f.noindex),
      (n) => `${n} ${n === 1 ? "page tells" : "pages tell"} Google not to list ${n === 1 ? "it" : "them"}`,
      'Remove the "noindex" robots tag from any page you want found. This is usually left over from when the site was being built.',
    ),
  );

  if (site.robotsTxt === null) {
    skipped.push("robots.txt could not be read, so the rules you give search engines were not checked.");
    // Also a row in the report (Semrush lists it as a Notice) — the skipped line above says
    // what was NOT checked because of it; this says what to do.
    issues.push(
      fileIssue(
        "robots-not-found",
        "info",
        robotsFile,
        "There is no robots.txt",
        "Add a robots.txt at the site root — even one that only names the sitemap. Without it every crawler has to guess what it may read, and some read less.",
      ),
    );
  } else {
    if (/^\s*disallow:\s*\/\s*$/im.test(site.robotsTxt) && /user-agent:\s*\*/i.test(site.robotsTxt)) {
      issues.push(
        fileIssue(
          "robots-blocks-all",
          "block",
          robotsFile,
          "Your robots.txt tells every search engine to stay off the whole site",
          'Remove the "Disallow: /" line from robots.txt. Until you do, nothing on the site can be found on Google.',
        ),
      );
    }

    // Lines that are not a comment, not blank, and not `directive: value` for any directive a
    // crawler knows — the same lines lib/audit/robots.ts's parser silently steps over. Counted
    // here so the owner learns the file has a typo before wondering why a rule is not obeyed.
    const badLines = site.robotsTxt
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter((l) => l && !ROBOTS_DIRECTIVES.has((l.match(/^([a-z-]+)\s*:/i)?.[1] ?? "").toLowerCase()));
    if (badLines.length) {
      issues.push(
        fileIssue(
          "robots-format-error",
          "warn",
          robotsFile,
          `robots.txt has ${badLines.length} ${badLines.length === 1 ? "line" : "lines"} no crawler can read (e.g. "${badLines[0].slice(0, 60)}")`,
          'Every line must be "Directive: value" — User-agent, Disallow, Allow, Sitemap, Crawl-delay — or a # comment. A crawler ignores a line it cannot parse, so a rule with a typo is a rule that is not applied.',
        ),
      );
    }

    if (site.sitemapUrls !== null && !/^\s*sitemap:/im.test(site.robotsTxt)) {
      issues.push(
        fileIssue(
          "sitemap-not-in-robots",
          "warn",
          robotsFile,
          "robots.txt does not name the sitemap",
          `Add the line "Sitemap: ${sitemapFile}" to robots.txt. It is the one place every crawler looks for it without being told.`,
        ),
      );
    }
  }

  if (site.sitemapUrls === null) {
    issues.push(
      fileIssue(
        "no-sitemap",
        "warn",
        sitemapFile,
        "There is no sitemap.xml",
        "Add one (every WordPress SEO plugin generates it) and list it in robots.txt. It is how Google finds pages nothing links to yet.",
      ),
    );
  } else {
    if (site.sitemapMalformed) {
      issues.push(
        fileIssue(
          "sitemap-format-error",
          "warn",
          sitemapFile,
          "The sitemap is not valid XML — it has no <urlset> or <sitemapindex>",
          "Open the sitemap address in a browser. If it shows a web page instead of XML, the server is answering the wrong file; regenerate the sitemap with your SEO plugin and check the address in robots.txt.",
        ),
      );
    }

    if (site.sitemapUrls.length > SITEMAP_MAX_URLS || (site.sitemapBytes ?? 0) > SITEMAP_MAX_BYTES) {
      issues.push(
        fileIssue(
          "sitemap-too-large",
          "warn",
          sitemapFile,
          `The sitemap has ${site.sitemapUrls.length.toLocaleString()} URLs${(site.sitemapBytes ?? 0) > SITEMAP_MAX_BYTES ? " and is over 50 MB" : ""} — past what one sitemap file may hold`,
          "Split it into several sitemaps of 50,000 URLs / 50 MB each and list them in a sitemap index. Crawlers stop reading at the limit and everything after it is never seen.",
        ),
      );
    }

    // Entries that are not URLs at all — `new URL()` refuses them, and so will Google.
    const badEntries = site.sitemapUrls.filter((u) => {
      try {
        new URL(u);
        return false;
      } catch {
        return true;
      }
    });
    issues.push(
      issue(
        "malformed-sitemap-url",
        "warn",
        badEntries,
        (n) => `${n} ${n === 1 ? "entry" : "entries"} in the sitemap ${n === 1 ? "is" : "are"} not a valid address`,
        "Every <loc> must be a full absolute URL — https://your-site.com/page — not a path or a bare domain. Fix the entries or regenerate the sitemap.",
      ),
    );

    // Pages the sitemap lists that a crawler would then find are not really there to index — a
    // 4xx/5xx, a redirect, or a noindex. Only judged on pages this run actually fetched.
    const inSitemap = new Set(site.sitemapUrls.map(canonicalKey));
    const wrong = pages
      .filter((p) => inSitemap.has(canonicalKey(p.url)))
      .filter((p) => {
        if (p.status !== 200) return true;
        if (p.finalUrl && canonicalKey(p.finalUrl) !== canonicalKey(p.url)) return true;
        return !!factsByUrl.get(p.url)?.noindex;
      })
      .map((p) => p.url);
    issues.push(
      issue(
        "sitemap-bad-page",
        "warn",
        wrong,
        (n) => `${n} ${n === 1 ? "page" : "pages"} in the sitemap ${n === 1 ? "is" : "are"} not indexable (an error, a redirect, or noindex)`,
        "A sitemap should list only live pages you want found. Remove these entries, or fix the page they point at — a sitemap full of dead ends teaches Google to trust it less.",
      ),
    );

    if (site.origin.startsWith("https://")) {
      issues.push(
        issue(
          "http-urls-in-sitemap",
          "warn",
          site.sitemapUrls.filter((u) => /^http:\/\//i.test(u)),
          (n) => `${n} sitemap ${n === 1 ? "entry uses" : "entries use"} http:// on a site served over https://`,
          "Regenerate the sitemap with https:// addresses. Each http:// entry sends the crawler through a redirect before it reaches the real page.",
        ),
      );
    }
  }

  if (!site.origin.startsWith("https://")) {
    issues.push(
      fileIssue(
        "homepage-not-https",
        "warn",
        site.origin,
        "The site's home address is not https://",
        "Install a certificate (most hosts include one free) and redirect every http:// address to https://. Browsers mark plain http sites as not secure, and Google prefers the secure version.",
      ),
    );
  }

  issues.push(
    issue(
      "non-secure-page",
      "block",
      ok.filter((p) => /^http:\/\//i.test(p.finalUrl ?? p.url)).map((p) => p.url),
      (n) => `${n} ${n === 1 ? "page is" : "pages are"} served over plain http://`,
      'Serve every page over https:// and redirect the http:// address to it. A page without the padlock is labelled "Not secure" in the browser bar, and that label costs visitors before they read a word.',
    ),
  );

  /* ── 3 · the page's own basics ──────────────────────────────────────────────────────── */

  issues.push(
    issue(
      "missing-title",
      "block",
      urlsWhere((f) => !f.title),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} no title`,
      "Give each page a title. It is the blue line people click in Google — without it they see the URL.",
    ),
  );

  issues.push(
    issue(
      "long-title",
      "warn",
      urlsWhere((f) => f.title.length > 65),
      (n) => `${n} ${n === 1 ? "title is" : "titles are"} too long to show in full`,
      "Keep titles under about 60 characters. Anything past that is cut off with an ellipsis in the search result.",
    ),
  );

  // Duplicates are the finding no per-page check can make. Two pages with the same title
  // compete with each other, and Google picks one — usually not the one you wanted.
  const groupBy = (key: (f: PageFacts) => string): string[] => {
    const groups = new Map<string, string[]>();
    for (const f of pf) {
      const k = key(f);
      if (!k) continue;
      groups.set(k, [...(groups.get(k) ?? []), f.page.url]);
    }
    return [...groups.values()].filter((urls) => urls.length > 1).flat();
  };
  issues.push(
    issue(
      "duplicate-title",
      "warn",
      groupBy((f) => f.title.toLowerCase()),
      (n) => `${n} pages share a title with another page`,
      "Give each page its own title. Pages with the same title compete with each other, and Google shows only one of them.",
    ),
  );

  issues.push(
    issue(
      "missing-meta",
      "warn",
      urlsWhere((f) => !f.description),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} no description`,
      "Write one or two sentences describing each page. Google shows it under the title — leave it out and it picks a random sentence for you.",
    ),
  );

  issues.push(
    issue(
      "missing-h1",
      "warn",
      urlsWhere((f) => f.h1Count === 0),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} no main heading`,
      "Add one H1 to each page saying what it is about. It is the first thing both a reader and a crawler look for.",
    ),
  );

  issues.push(
    issue(
      "multiple-h1",
      "warn",
      urlsWhere((f) => f.h1Count > 1),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} more than one main heading`,
      "Keep one H1 per page and make the rest H2s. Several H1s tell a crawler the page is about several things at once.",
    ),
  );

  issues.push(
    issue(
      "missing-canonical",
      "warn",
      urlsWhere((f) => !f.canonicals[0]),
      (n) => `${n} ${n === 1 ? "page does" : "pages do"} not say which address is the real one`,
      "Add a canonical link to each page. Without it, the same page reached two ways can be counted as two competing pages.",
    ),
  );

  issues.push(
    issue(
      "short-title",
      "warn",
      urlsWhere((f) => f.title.length > 0 && f.title.length < SHORT_TITLE_CHARS),
      (n) => `${n} ${n === 1 ? "title is" : "titles are"} shorter than ${SHORT_TITLE_CHARS} characters`,
      'A title that short wastes the space Google gives you. Say what the page is and where — "Roof repairs in Springfield | Example Roofing" — instead of one word.',
    ),
  );

  issues.push(
    issue(
      "h1-equals-title",
      "warn",
      urlsWhere((f) => !!f.firstH1 && f.firstH1 === normText(f.title).toLowerCase()),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} an H1 identical to its title`,
      "Let the title and the H1 do different jobs: the title earns the click in Google (add the place and the business), the H1 tells the reader they landed in the right spot.",
    ),
  );

  issues.push(
    issue(
      "duplicate-meta",
      "warn",
      groupBy((f) => f.description.toLowerCase()),
      (n) => `${n} pages share a description with another page`,
      "Write a description for each page that says what THAT page offers. The same sentence under every result tells the searcher nothing about which to open.",
    ),
  );

  issues.push(
    issue(
      "multiple-canonical",
      "warn",
      urlsWhere((f) => f.canonicals.length > 1),
      (n) => `${n} ${n === 1 ? "page names" : "pages name"} more than one canonical address`,
      "Keep exactly one canonical link per page. Given two, Google ignores both — usually a theme and an SEO plugin each adding their own.",
    ),
  );

  /* ── 3b · technical — what the <head> is missing ───────────────────────────────────── */

  issues.push(
    issue(
      "meta-refresh",
      "warn",
      urlsWhere((f) => f.metaRefresh),
      (n) => `${n} ${n === 1 ? "page redirects" : "pages redirect"} with a meta refresh tag`,
      "Replace the meta refresh with a real 301 redirect on the server. A meta refresh is slow for the visitor and Google may not pass the old page's authority through it.",
    ),
  );

  issues.push(
    issue(
      "missing-viewport",
      "warn",
      urlsWhere((f) => f.viewport === null),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} no viewport tag`,
      'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to every page. Without it phones render the desktop layout shrunk down, and Google ranks with the phone version.',
    ),
  );

  issues.push(
    issue(
      "viewport-no-width",
      "warn",
      urlsWhere((f) => f.viewport !== null && !/width\s*=/i.test(f.viewport)),
      (n) => `${n} viewport ${n === 1 ? "tag does" : "tags do"} not set a width`,
      'The viewport tag needs "width=device-width" in its content. Without a width the phone falls back to the desktop layout as if the tag were not there.',
    ),
  );

  issues.push(
    issue(
      "no-charset",
      "warn",
      urlsWhere((f) => !f.hasCharset),
      (n) => `${n} ${n === 1 ? "page does" : "pages do"} not declare a character encoding`,
      'Add <meta charset="utf-8"> as the first line of <head>. Without it a browser guesses, and a wrong guess turns every accent and quote into garbage characters.',
    ),
  );

  issues.push(
    issue(
      "no-doctype",
      "warn",
      urlsWhere((f) => !f.hasDoctype),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} no doctype declaration`,
      "Put <!DOCTYPE html> on the first line of every page. Without it browsers switch to quirks mode and lay the page out by 1990s rules, which breaks modern CSS.",
    ),
  );

  issues.push(
    issue(
      "plugin-content",
      "warn",
      urlsWhere((f) => f.pluginContent),
      (n) => `${n} ${n === 1 ? "page embeds" : "pages embed"} a browser plugin (Flash, Silverlight or a Java applet)`,
      "No current browser runs these — whatever it was showing is a blank box now. Replace it with an HTML5 video, an image, or plain HTML.",
    ),
  );

  issues.push(
    issue(
      "frames",
      "warn",
      urlsWhere((f) => f.frames),
      (n) => `${n} ${n === 1 ? "page is" : "pages are"} built with frames`,
      "Rebuild the page without <frameset>. Google indexes the frame contents as separate pages, so the page itself has no content of its own to rank.",
    ),
  );

  issues.push(
    issue(
      "invalid-structured-data",
      "warn",
      urlsWhere((f) => f.invalidStructuredData),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} structured data that cannot be read`,
      "Paste the page into Google's Rich Results Test. The JSON-LD is either not valid JSON or has no @type, and a block Google cannot parse earns none of the rich results it was added for.",
    ),
  );

  /* ── 3c · international — hreflang and the page language ───────────────────────────── */

  issues.push(
    issue(
      "hreflang-conflict",
      "warn",
      urlsWhere((f) => {
        const seen = new Map<string, string>();
        for (const h of f.hreflangs) {
          const key = h.lang.toLowerCase();
          if (seen.has(key) && seen.get(key) !== h.href) return true;
          seen.set(key, h.href);
        }
        return false;
      }),
      (n) => `${n} ${n === 1 ? "page points" : "pages point"} the same language at two different addresses`,
      "Each hreflang language may name one URL per page. Two different addresses for the same language and Google cannot tell which to show that country.",
    ),
  );

  issues.push(
    issue(
      "hreflang-invalid",
      "warn",
      urlsWhere((f) => f.hreflangs.some((h) => !HREFLANG_RE.test(h.lang))),
      (n) => `${n} ${n === 1 ? "page uses" : "pages use"} an hreflang code that is not a language`,
      'hreflang takes a language code ("en"), optionally with a region ("en-GB"), or "x-default". Anything else — "english", "uk", "en_GB" with an underscore — is ignored.',
    ),
  );

  issues.push(
    issue(
      "no-lang",
      "warn",
      urlsWhere((f) => !f.htmlLang && f.hreflangs.length === 0),
      (n) => `${n} ${n === 1 ? "page does" : "pages do"} not say what language it is in`,
      'Add lang="en" (or the page\'s language) to the <html> tag. Screen readers pick a voice from it, and search engines use it to decide which country to show the page in.',
    ),
  );

  issues.push(
    issue(
      "hreflang-lang-mismatch",
      "info",
      urlsWhere((f) => {
        const lang = f.htmlLang.toLowerCase().split("-")[0];
        if (!lang) return false;
        const self = f.hreflangs.find((h) => h.lang.toLowerCase() !== "x-default" && canonicalKey(h.href) === canonicalKey(f.page.url));
        return !!self && self.lang.toLowerCase().split("-")[0] !== lang;
      }),
      (n) => `${n} ${n === 1 ? "page's" : "pages'"} hreflang for itself disagrees with its <html lang>`,
      "Make the page's own hreflang entry and its <html lang> name the same language. When they disagree, one of them is wrong, and Google guesses which.",
    ),
  );

  /* ── 3d · the addresses themselves ─────────────────────────────────────────────────── */

  const urlOf = (u: string): URL | null => {
    try {
      return new URL(u);
    } catch {
      return null;
    }
  };

  issues.push(
    issue(
      "underscore-url",
      "warn",
      pages.filter((p) => urlOf(p.url)?.pathname.includes("_")).map((p) => p.url),
      (n) => `${n} ${n === 1 ? "URL uses" : "URLs use"} underscores instead of hyphens`,
      'Google reads "roof_repairs" as one word and "roof-repairs" as two. Use hyphens in new URLs; only rename an existing page if you also redirect the old address.',
    ),
  );

  issues.push(
    issue(
      "too-many-params",
      "warn",
      pages.filter((p) => [...(urlOf(p.url)?.searchParams ?? [])].length > MAX_URL_PARAMS).map((p) => p.url),
      (n) => `${n} ${n === 1 ? "URL has" : "URLs have"} more than ${MAX_URL_PARAMS} query parameters`,
      "Every combination of parameters is a separate page to Google, and most of them are the same page. Give the page a clean address and canonicalise the filtered versions to it.",
    ),
  );

  issues.push(
    issue(
      "long-url",
      "info",
      pages.filter((p) => p.url.length > LONG_URL_CHARS).map((p) => p.url),
      (n) => `${n} ${n === 1 ? "URL is" : "URLs are"} longer than ${LONG_URL_CHARS} characters`,
      "Shorter addresses are easier to share and get cut off less in search results. Trim the slug to the words that matter — with a redirect from the old one.",
    ),
  );

  /* ── 4 · images and links ───────────────────────────────────────────────────────────── */

  issues.push(
    issue(
      "image-no-alt",
      "warn",
      urlsWhere((f) => f.imageWithoutAlt),
      (n) => `${n} ${n === 1 ? "page has images" : "pages have images"} with no description`,
      "Describe each image in its alt text. It is what a blind visitor hears, what Google reads, and what shows when the image fails to load.",
    ),
  );

  issues.push(
    issue(
      "mixed-content",
      "block",
      urlsWhere((f) => f.page.url.startsWith("https://") && f.insecureResource),
      (n) => `${n} secure ${n === 1 ? "page loads something" : "pages load something"} over an insecure connection`,
      'Change those "http://" addresses to "https://". Browsers block them and some show the whole page as not secure.',
    ),
  );

  // Resources the site's own robots.txt hides from the crawler — a blocked stylesheet or script
  // means Google renders the page without it and judges what it sees. Same parser as the
  // AI-bot card and blockedPages below, so "blocked" means one thing everywhere.
  if (groups !== null) {
    issues.push(
      issue(
        "blocked-resources",
        "warn",
        urlsWhere((f) =>
          f.resources.some((src) => {
            try {
              const abs = new URL(src, f.page.finalUrl ?? f.page.url);
              return sameOrigin(abs.toString(), site.origin) && isBlocked(abs.pathname, "*", groups);
            } catch {
              return false;
            }
          }),
        ),
        (n) => `${n} ${n === 1 ? "page loads" : "pages load"} a script, stylesheet or image that robots.txt blocks`,
        "Allow the /wp-content/, /assets/ or /static/ folder (whichever holds them) in robots.txt. Google renders pages like a browser; hide the CSS and it sees a broken page.",
      ),
    );
  }

  /* ── 4b · the link graph — built once, read by seven checks ─────────────────────────── */

  // Every same-origin <a href> on every readable page, as page → page edges keyed the way
  // canonicalKey() keys them (so /about, /about/ and /about#team are one node). Orphans,
  // in-degree, click depth and the per-link findings all read this one structure, which is
  // what keeps "orphan" and "one incoming link" from disagreeing about the same page.
  const outLinks = new Map<string, Set<string>>();
  const inSources = new Map<string, Set<string>>();
  const linkFlags = {
    malformed: [] as string[],
    long: [] as string[],
    httpsToHttp: [] as string[],
    resource: [] as string[],
    internalNofollow: [] as string[],
    externalNofollow: [] as string[],
    generic: [] as string[],
    empty: [] as string[],
    tooMany: [] as string[],
  };
  const SKIP_SCHEME = /^(mailto|tel|sms|javascript|data|ftp|file):/i;
  const LOOKS_LIKE_URL = /^(https?:\/\/|www\.)\S+$/i;

  for (const f of pf) {
    const page = f.page;
    const fromKey = canonicalKey(page.url);
    if (f.anchors.length > MAX_LINKS_PER_PAGE) linkFlags.tooMany.push(page.url);
    const hit = { malformed: false, long: false, httpsToHttp: false, resource: false, internalNofollow: false, externalNofollow: false, generic: false, empty: false };

    for (const a of f.anchors) {
      const href = a.href;
      if (!href || href.startsWith("#") || SKIP_SCHEME.test(href)) continue;
      let abs: URL;
      try {
        abs = new URL(href, page.finalUrl ?? page.url);
      } catch {
        hit.malformed = true;
        continue;
      }
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;

      if (!a.text && !a.imgAlt && !a.labelled) hit.empty = true;
      else if (a.text && (GENERIC_ANCHORS.has(a.text.toLowerCase()) || LOOKS_LIKE_URL.test(a.text))) hit.generic = true;
      if (abs.toString().length > LONG_URL_CHARS) hit.long = true;
      if (abs.host.toLowerCase() === siteHost && abs.protocol === "http:" && page.url.startsWith("https://")) hit.httpsToHttp = true;

      if (sameOrigin(abs.toString(), site.origin)) {
        if (RESOURCE_EXT.test(abs.pathname)) hit.resource = true;
        if (a.nofollow) hit.internalNofollow = true;
        const toKey = canonicalKey(abs.toString());
        if (toKey === fromKey) continue;
        if (!outLinks.has(fromKey)) outLinks.set(fromKey, new Set());
        outLinks.get(fromKey)!.add(toKey);
        if (!inSources.has(toKey)) inSources.set(toKey, new Set());
        inSources.get(toKey)!.add(fromKey);
      } else if (a.nofollow) {
        hit.externalNofollow = true;
      }
    }
    for (const k of Object.keys(hit) as (keyof typeof hit)[]) if (hit[k]) linkFlags[k].push(page.url);
  }

  issues.push(
    issue(
      "malformed-link",
      "warn",
      linkFlags.malformed,
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} a link whose address is not a valid URL`,
      "Find the <a href> a browser cannot parse — usually a stray space, quote or bracket in the address — and fix it. A link nobody can follow is a link that passes nothing on.",
    ),
  );

  issues.push(
    issue(
      "long-link-url",
      "warn",
      linkFlags.long,
      (n) => `${n} ${n === 1 ? "page links" : "pages link"} to an address longer than ${LONG_URL_CHARS} characters`,
      "Shorten the address being linked to, or link to its clean canonical version. Very long URLs are usually tracking parameters that should not be in an internal link at all.",
    ),
  );

  issues.push(
    issue(
      "https-to-http-links",
      "warn",
      linkFlags.httpsToHttp,
      (n) => `${n} secure ${n === 1 ? "page links" : "pages link"} to the http:// version of this site`,
      "Change the links to https://. Each one sends the visitor through a redirect, and a page linked as http:// is a page Google may keep as the http:// version.",
    ),
  );

  issues.push(
    issue(
      "resource-as-link",
      "info",
      linkFlags.resource,
      (n) => `${n} ${n === 1 ? "page links" : "pages link"} to a file (image, script, stylesheet) as if it were a page`,
      "A visitor who clicks it gets a raw file, and a crawler spends a fetch on something it cannot rank. Link to the page that shows the file instead, or remove the link.",
    ),
  );

  issues.push(
    issue(
      "internal-nofollow",
      "warn",
      linkFlags.internalNofollow,
      (n) => `${n} ${n === 1 ? "page marks" : "pages mark"} a link to its own site as nofollow`,
      'Remove rel="nofollow" from links between your own pages. It tells Google not to trust the page you are linking to — your own page.',
    ),
  );

  issues.push(
    issue(
      "external-nofollow",
      "info",
      linkFlags.externalNofollow,
      (n) => `${n} ${n === 1 ? "page marks" : "pages mark"} every outgoing link nofollow`,
      "Nothing to fix if that is deliberate (paid or user-posted links should be nofollow). For links to sources and partners you vouch for, a normal link is fine and reads more naturally to Google.",
    ),
  );

  issues.push(
    issue(
      "generic-anchor",
      "info",
      linkFlags.generic,
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} links that just say "click here", "read more" or a bare URL`,
      'Make the link text say where it goes — "our roof repair prices" rather than "click here". The words in a link are one of the strongest hints about the page it points to.',
    ),
  );

  issues.push(
    issue(
      "empty-anchor",
      "info",
      linkFlags.empty,
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} links with no text at all`,
      "Give every link visible text, or an image with alt text, or an aria-label. An empty link is invisible to a screen reader and tells Google nothing about its target.",
    ),
  );

  issues.push(
    issue(
      "too-many-links",
      "warn",
      linkFlags.tooMany,
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} more than ${MAX_LINKS_PER_PAGE.toLocaleString()} links on it`,
      "That many links is almost always a sitemap page or a runaway tag cloud. Split it up — a page that links to everything passes almost nothing to anything.",
    ),
  );

  // Orphans: a page nothing on the site links to. Google can still find it through the sitemap,
  // but nothing passes it any authority and visitors never stumble into it.
  const okKeys = ok.map((p) => ({ url: p.url, key: canonicalKey(p.url) }));
  issues.push(
    issue(
      "orphan-page",
      "warn",
      okKeys.filter(({ key }) => key !== homeKey && !inSources.has(key)).map(({ url }) => url),
      (n) => `${n} ${n === 1 ? "page is" : "pages are"} not linked from anywhere on the site`,
      "Link to these from a relevant page or your menu. A page nothing links to reads as unimportant to Google and is invisible to visitors browsing.",
    ),
  );

  issues.push(
    issue(
      "one-incoming-link",
      "info",
      okKeys.filter(({ key }) => key !== homeKey && inSources.get(key)?.size === 1).map(({ url }) => url),
      (n) => `${n} ${n === 1 ? "page is" : "pages are"} reachable from only one other page`,
      "Add a second link to each — from a related page, the footer or the menu. One link is one point of failure: remove it in a redesign and the page becomes an orphan.",
    ),
  );

  // Click depth: breadth-first from the home page over the graph above. Only pages that are
  // reachable get a depth — an orphan is already its own finding, not also a "deep" page.
  const depth = new Map<string, number>([[homeKey, 0]]);
  const queue = [homeKey];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of outLinks.get(cur) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(cur)! + 1);
      queue.push(next);
    }
  }
  issues.push(
    issue(
      "deep-page",
      "info",
      okKeys.filter(({ key }) => (depth.get(key) ?? 0) > MAX_CLICK_DEPTH).map(({ url }) => url),
      (n) => `${n} ${n === 1 ? "page is" : "pages are"} more than ${MAX_CLICK_DEPTH} clicks from the home page`,
      "Link to these from somewhere higher up — a category page, the menu, the home page. Both crawlers and visitors give up before the fourth click.",
    ),
  );

  /* ── 4c · content ───────────────────────────────────────────────────────────────────── */

  issues.push(
    issue(
      "thin-content",
      "warn",
      urlsWhere((f) => f.words < 150),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} almost no text on it`,
      "Either write these properly or remove them. A page with a heading and two lines rarely ranks for anything and drags the rest down.",
    ),
  );

  // Identical visible text on two URLs that each claim to be the real one. A page whose canonical
  // points elsewhere has already declared itself the copy and is left out.
  const selfCanonical = (f: PageFacts) => {
    const href = f.canonicals[0];
    if (!href) return true;
    try {
      return canonicalKey(new URL(href, f.page.url).toString()) === canonicalKey(f.page.url);
    } catch {
      return true;
    }
  };
  issues.push(
    issue(
      "duplicate-content",
      "warn",
      groupBy((f) => (f.words < 50 || !selfCanonical(f) ? "" : f.textHash)),
      (n) => `${n} pages have exactly the same text as another page`,
      "Keep one and redirect the other to it, or add a canonical link on the copy pointing at the original. Two identical pages split the ranking between them and Google picks one at random.",
    ),
  );

  issues.push(
    issue(
      "low-text-ratio",
      "warn",
      urlsWhere((f) => f.page.bytes > 0 && f.textChars / f.page.bytes < MIN_TEXT_RATIO),
      (n) => `${n} ${n === 1 ? "page is" : "pages are"} less than ${Math.round(MIN_TEXT_RATIO * 100)}% text by size`,
      "The page is mostly markup and script, not words. Usually a page builder's output — worth showing your developer, and worth adding the text a reader actually came for.",
    ),
  );

  /* ── 4d · AI Search — what an answer engine needs that Google alone did not ─────────── */

  issues.push(
    issue(
      "ai-too-much-content",
      "info",
      urlsWhere((f) => f.words > AI_TOO_MANY_WORDS),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} more than ${AI_TOO_MANY_WORDS.toLocaleString()} words on it`,
      "AI answer engines quote a passage, not a page, and lose the thread in a very long one. Split it into pages with one question each, or add a summary and headings that name each section.",
    ),
  );

  // Only judged when the page itself carries a date. A page with no date is not called stale —
  // that would be guessing, and this file does not guess.
  const staleBefore = Date.now() - AI_OUTDATED_MONTHS * 30.44 * 24 * 3600 * 1000;
  issues.push(
    issue(
      "ai-outdated-content",
      "info",
      urlsWhere((f) => f.latestDate !== null && f.latestDate < staleBefore),
      (n) => `${n} ${n === 1 ? "page was" : "pages were"} last updated more than ${AI_OUTDATED_MONTHS / 12} years ago, by its own date`,
      "Refresh the page and update its published/modified date. AI answer engines favour recent sources, and a page that says it is two years old is passed over for one that says it is two months old.",
    ),
  );

  issues.push(
    issue(
      "ai-low-semantic-html",
      "info",
      urlsWhere((f) => f.divCount >= AI_MIN_DIVS_FOR_SEMANTIC_CHECK && f.semanticCount / f.divCount < AI_MIN_SEMANTIC_RATIO),
      (n) => `${n} ${n === 1 ? "page is" : "pages are"} built almost entirely from <div>s`,
      "Wrap the content in <main> and <article>, the menu in <nav>, sidebars in <aside>. AI engines use those tags to find the part of the page that is the answer; a wall of <div>s gives them nothing to hold.",
    ),
  );

  /* ── 5 · speed, as far as HTTP can honestly tell ────────────────────────────────────── */

  const slow = ok.filter((p) => (p.ms ?? 0) > 1500).map((p) => p.url);
  issues.push(
    issue(
      "slow-response",
      "warn",
      slow,
      (n) => `${n} ${n === 1 ? "page took" : "pages took"} over 1.5 seconds just to start responding`,
      "Ask your host about caching. This is the time before anything at all reaches the browser, so everything else happens after it.",
    ),
  );

  const heavy = ok.filter((p) => p.bytes > 500_000).map((p) => p.url);
  issues.push(
    issue(
      "heavy-html",
      "warn",
      heavy,
      (n) => `${n} ${n === 1 ? "page sends" : "pages send"} an unusually large amount of HTML`,
      "Usually a page builder repeating itself. Worth showing your developer — it delays everything the visitor sees.",
    ),
  );

  if (!performance) {
    // No performance argument at all — an old caller, or a test — is the same honest gap this
    // line has always described.
    skipped.push(
      "Loading speed as Google measures it (Core Web Vitals) needs a real browser, which this check does not use. Nothing here is an estimate of it.",
    );
  } else if (performance.skippedReason) {
    // Measured, but the browser genuinely could not run this time — a different sentence from
    // "we never try", because a deploy missing a Chrome binary is a fixable fact, not a design.
    skipped.push(performance.skippedReason);
  }
  // performance.skippedReason === null (it ran) → no skipped line at all; the numbers are in
  // performance.issues and the raw per-page data the caller (audit.ts) saves into run.performance.

  /* ── score ──────────────────────────────────────────────────────────────────────────── */

  const found = issues.filter(Boolean) as AuditIssue[];
  // "1 error · 18 warnings" on the report page: KINDS of problem, not pages. Unchanged.
  const blocks = found.filter((i) => i.severity === "block").length;
  const warns = found.filter((i) => i.severity === "warn").length;

  // Performance issues arrive pre-built (performance.ts) rather than through `issue()`, so
  // their pages are tallied here — otherwise a slow page would not count as a page with an
  // issue and would not lose any health.
  for (const i of performance?.issues ?? []) {
    for (const u of i.pages) {
      if (!pageIssueIds.has(u)) pageIssueIds.set(u, new Set());
      pageIssueIds.get(u)!.add(i.id);
    }
  }
  const severityOf = new Map(found.map((i) => [i.id, i.severity]));

  /* ── SITE HEALTH ────────────────────────────────────────────────────────────────────
   *
   * The average crawled page's own health, not a count of problem KINDS.
   *
   * The old formula was 100 − 25·blockKinds − 5·warnKinds, from when this file made twelve
   * checks. At seventy (MASTER_PLAN §27 Round A) it stopped meaning anything: a real
   * 156-page site tripped one block and eighteen warning KINDS and scored 0/100 — the same
   * as a site that is entirely down. Owner, 2026-09-05, looking at exactly that report:
   * "site health 0 kyun hai, halanki ye sab sahi lag raha hai".
   *
   * So: every crawled page starts at 100 and loses HEALTH_WARN for each warning it has and
   * everything for a block (a page Google cannot reach, read or index is not a page with a
   * blemish — it is a lost page). Notices cost nothing; they are notes, and the report says
   * so. Site Health is the mean, minus the site-wide findings (robots.txt, sitemap) which
   * belong to no single page. Every page's own number is exact — the same per-page issue map
   * the Crawled Pages breakdown uses — so the score can be explained page by page. */
  const pageHealth = (issueIds: Set<string> | undefined): number => {
    if (!issueIds?.size) return 100;
    let penalty = 0;
    for (const id of issueIds) {
      const sev = severityOf.get(id);
      if (sev === "block") return 0;
      if (sev === "warn") penalty += HEALTH_WARN;
    }
    return clamp(100 - penalty, 0, 100);
  };
  const meanHealth = pages.length ? pages.reduce((sum, p) => sum + pageHealth(pageIssueIds.get(p.url)), 0) / pages.length : 100;
  const filePenalty = found
    .filter((i) => fileIssueIds.has(i.id))
    .reduce((sum, i) => sum + (i.severity === "block" ? HEALTH_FILE_BLOCK : i.severity === "warn" ? HEALTH_WARN : 0), 0);
  const score = clamp(Math.round(meanHealth - filePenalty), 0, 100);

  // The same arithmetic per thematic category, so a ring and the headline can never disagree
  // about the same site. A category whose checks all passed is 100 — and says "No issues".
  const categories = Array.from(new Set(CHECK_CATALOGUE.map((c) => c.category)));
  const thematic = categories.map((category) => {
    const ids = new Set(found.filter((i) => (CHECK_CATEGORY[i.id] ?? "Other") === category).map((i) => i.id));
    const mean = pages.length
      ? pages.reduce((sum, p) => {
          const own = pageIssueIds.get(p.url);
          if (!own) return sum + 100;
          const mine = new Set([...own].filter((id) => ids.has(id)));
          return sum + pageHealth(mine);
        }, 0) / pages.length
      : 100;
    const filePen = found
      .filter((i) => ids.has(i.id) && fileIssueIds.has(i.id))
      .reduce((sum, i) => sum + (i.severity === "block" ? HEALTH_FILE_BLOCK : i.severity === "warn" ? HEALTH_WARN : 0), 0);
    return {
      category,
      health: clamp(Math.round(mean - filePen), 0, 100),
      issues: ids.size,
      checks: CHECK_CATALOGUE.filter((c) => c.category === category).length,
    };
  });

  // Real robots.txt evaluation (lib/audit/robots.ts) — the SAME parser the AI-bot access card
  // uses (agents/audit.ts), so a page or a bot is never "blocked" by one check and "allowed"
  // by the other. Empty (not a guess) when robots.txt could not be read — `skipped` above
  // already says why.
  const blockedPages =
    groups === null
      ? []
      : pages
          .map((p) => p.url)
          .filter((url) => {
            try {
              return isBlocked(new URL(url).pathname, "*", groups);
            } catch {
              return false;
            }
          });

  // Statistics-tab rows, read straight off the structures the checks above already built (the
  // link graph, the BFS depth map, the per-page facts) — so the histograms and the issue rows
  // are two views of one measurement, never two measurements.
  const pageStats: PageStats[] = pf.map((f) => {
    const key = canonicalKey(f.page.url);
    return {
      url: f.page.url,
      depth: depth.get(key) ?? null,
      titleChars: f.title.length,
      descriptionChars: f.description.length,
      words: f.words,
      inLinks: inSources.get(key)?.size ?? 0,
      outLinks: outLinks.get(key)?.size ?? 0,
    };
  });

  return {
    score,
    thematic,
    pagesChecked: pages.length,
    blocks,
    warns,
    // One lookup, applied last, so the four performance.ts ids and the inline robots finding get
    // their category from the same table as everything built through `issue()` above. "Other"
    // is a visible smell, not a silent default — checks.test.ts asserts no check ever lands there.
    issues: found.map((i) => ({ ...i, category: CHECK_CATEGORY[i.id] ?? "Other" })),
    skipped,
    // Only pages with a real problem — a notice is a note, not a page "with issues" (it is
    // what put 155 of 156 pages in that bucket on 2026-09-05 while the report itself said
    // most of them were fine).
    pagesWithIssues: Array.from(pageIssueIds.entries())
      .filter(([, ids]) => [...ids].some((id) => severityOf.get(id) === "block" || severityOf.get(id) === "warn"))
      .map(([url]) => url),
    blockedPages,
    catalogue: CHECK_CATALOGUE,
    pageStats,
  };
}

/* ---------------------------------------------------------------- the report ------------ */

/** §7.4: "user ko top-5 issues plain language me, aur score trend".
 *
 *  Blocks before warnings, and within a severity the issue affecting more pages first — the
 *  order somebody would work in if they had one afternoon. */
export function topIssues(result: AuditResult, n = 5): AuditIssue[] {
  const rank = { block: 0, warn: 1, info: 2 } as const;
  return [...result.issues].sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count).slice(0, n);
}

export function describeTrend(score: number, previous: number | null): string {
  if (previous === null) return "This is the first audit, so there is nothing to compare it to yet.";
  const diff = score - previous;
  if (diff === 0) return `Same score as last time (${score}).`;
  return diff > 0 ? `Up ${diff} points since the last audit (was ${previous}).` : `Down ${Math.abs(diff)} points since the last audit (was ${previous}).`;
}

/** The five sentences the customer reads. Deliberately not written by a model: this is a
 *  summary of measurements, and a model would round, soften and eventually invent. */
export function summarizeAudit(result: AuditResult, previous: number | null): string {
  const top = topIssues(result);
  const head =
    result.blocks > 0
      ? `Score ${result.score}/100 across ${result.pagesChecked} pages — ${result.blocks} serious ${result.blocks === 1 ? "problem" : "problems"} to fix first.`
      : result.warns > 0
        ? `Score ${result.score}/100 across ${result.pagesChecked} pages — nothing broken, ${result.warns} ${result.warns === 1 ? "thing" : "things"} worth improving.`
        : `Score ${result.score}/100 across ${result.pagesChecked} pages — nothing to fix.`;

  const lines = top.map((i, n) => `${n + 1}. ${i.what}. ${i.fix}`);
  return [head, describeTrend(result.score, previous), ...lines].join("\n");
}
