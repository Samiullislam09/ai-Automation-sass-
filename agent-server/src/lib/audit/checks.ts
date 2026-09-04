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

import * as cheerio from "cheerio";

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
};

export type AuditResult = {
  score: number;
  pagesChecked: number;
  blocks: number;
  warns: number;
  issues: AuditIssue[];
  /** Checks we could not run, and why. Rendered as-is; never silently dropped. */
  skipped: string[];
};

/* ---------------------------------------------------------------- helpers --------------- */

// How many example URLs an issue carries — `count` is always exact regardless. Raised 8 → 100
// (2026-09-05, "see more" full-page popup on the Audit report page) so that view has real URLs
// to show for nearly every issue on a small-business site, not just the first 8; still capped,
// never the unbounded list, so one issue on a huge site cannot make the row heavier than the
// rest of the report.
const PAGE_SAMPLE = 100;

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

/** Builds an issue only when it applies to at least one page. Returning null rather than an
 *  empty issue means the caller can `.filter(Boolean)` and no report ever shows "0 pages have
 *  a missing title" as though it were a finding. */
function issue(id: string, severity: AuditSeverity, pages: string[], what: (n: number) => string, fix: string): AuditIssue | null {
  if (!pages.length) return null;
  return { id, severity, what: what(pages.length), fix, pages: pages.slice(0, PAGE_SAMPLE), count: pages.length };
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
  const skipped: string[] = [];
  const issues: (AuditIssue | null)[] = [...(performance?.issues ?? [])];

  const ok = pages.filter((p) => p.status !== null && p.status < 400 && p.html);
  const parsed = ok.map((p) => ({ page: p, $: cheerio.load(p.html as string) }));

  /* ── 1 · broken and unreachable ─────────────────────────────────────────────────────── */

  issues.push(
    issue(
      "unreachable",
      "block",
      pages.filter((p) => p.status === null).map((p) => p.url),
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
      pages.filter((p) => p.status === 404).map((p) => p.url),
      (n) => `${n} ${n === 1 ? "link points" : "links point"} at a page that no longer exists`,
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

  const noindex = parsed
    .filter(({ $ }) => /noindex/i.test($('meta[name="robots"]').attr("content") ?? ""))
    .map(({ page }) => page.url);
  issues.push(
    issue(
      "noindex",
      "block",
      noindex,
      (n) => `${n} ${n === 1 ? "page tells" : "pages tell"} Google not to list ${n === 1 ? "it" : "them"}`,
      'Remove the "noindex" robots tag from any page you want found. This is usually left over from when the site was being built.',
    ),
  );

  if (site.robotsTxt === null) {
    skipped.push("robots.txt could not be read, so the rules you give search engines were not checked.");
  } else if (/^\s*disallow:\s*\/\s*$/im.test(site.robotsTxt) && /user-agent:\s*\*/i.test(site.robotsTxt)) {
    issues.push({
      id: "robots-blocks-all",
      severity: "block",
      what: "Your robots.txt tells every search engine to stay off the whole site",
      fix: 'Remove the "Disallow: /" line from robots.txt. Until you do, nothing on the site can be found on Google.',
      pages: [site.origin + "/robots.txt"],
      count: 1,
    });
  }

  if (site.sitemapUrls === null) {
    issues.push({
      id: "no-sitemap",
      severity: "warn",
      what: "There is no sitemap.xml",
      fix: "Add one (every WordPress SEO plugin generates it) and list it in robots.txt. It is how Google finds pages nothing links to yet.",
      pages: [site.origin + "/sitemap.xml"],
      count: 1,
    });
  }

  /* ── 3 · the page's own basics ──────────────────────────────────────────────────────── */

  const titleOf = ({ $ }: { $: cheerio.CheerioAPI }) => ($("title").first().text() ?? "").trim();

  issues.push(
    issue(
      "missing-title",
      "block",
      parsed.filter((p) => !titleOf(p)).map(({ page }) => page.url),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} no title`,
      "Give each page a title. It is the blue line people click in Google — without it they see the URL.",
    ),
  );

  issues.push(
    issue(
      "long-title",
      "warn",
      parsed.filter((p) => titleOf(p).length > 65).map(({ page }) => page.url),
      (n) => `${n} ${n === 1 ? "title is" : "titles are"} too long to show in full`,
      "Keep titles under about 60 characters. Anything past that is cut off with an ellipsis in the search result.",
    ),
  );

  // Duplicates are the finding no per-page check can make. Two pages with the same title
  // compete with each other, and Google picks one — usually not the one you wanted.
  const byTitle = new Map<string, string[]>();
  for (const p of parsed) {
    const t = titleOf(p).toLowerCase();
    if (!t) continue;
    byTitle.set(t, [...(byTitle.get(t) ?? []), p.page.url]);
  }
  const duplicateTitlePages = [...byTitle.values()].filter((urls) => urls.length > 1).flat();
  issues.push(
    issue(
      "duplicate-title",
      "warn",
      duplicateTitlePages,
      (n) => `${n} pages share a title with another page`,
      "Give each page its own title. Pages with the same title compete with each other, and Google shows only one of them.",
    ),
  );

  const metaOf = ({ $ }: { $: cheerio.CheerioAPI }) => ($('meta[name="description"]').attr("content") ?? "").trim();
  issues.push(
    issue(
      "missing-meta",
      "warn",
      parsed.filter((p) => !metaOf(p)).map(({ page }) => page.url),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} no description`,
      "Write one or two sentences describing each page. Google shows it under the title — leave it out and it picks a random sentence for you.",
    ),
  );

  issues.push(
    issue(
      "missing-h1",
      "warn",
      parsed.filter(({ $ }) => $("h1").length === 0).map(({ page }) => page.url),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} no main heading`,
      "Add one H1 to each page saying what it is about. It is the first thing both a reader and a crawler look for.",
    ),
  );

  issues.push(
    issue(
      "multiple-h1",
      "warn",
      parsed.filter(({ $ }) => $("h1").length > 1).map(({ page }) => page.url),
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} more than one main heading`,
      "Keep one H1 per page and make the rest H2s. Several H1s tell a crawler the page is about several things at once.",
    ),
  );

  issues.push(
    issue(
      "missing-canonical",
      "warn",
      parsed.filter(({ $ }) => !$('link[rel="canonical"]').attr("href")).map(({ page }) => page.url),
      (n) => `${n} ${n === 1 ? "page does" : "pages do"} not say which address is the real one`,
      "Add a canonical link to each page. Without it, the same page reached two ways can be counted as two competing pages.",
    ),
  );

  /* ── 4 · images and links ───────────────────────────────────────────────────────────── */

  const noAlt = parsed
    .filter(({ $ }) => $("img").toArray().some((el) => !($(el).attr("alt") ?? "").trim()))
    .map(({ page }) => page.url);
  issues.push(
    issue(
      "image-no-alt",
      "warn",
      noAlt,
      (n) => `${n} ${n === 1 ? "page has images" : "pages have images"} with no description`,
      "Describe each image in its alt text. It is what a blind visitor hears, what Google reads, and what shows when the image fails to load.",
    ),
  );

  issues.push(
    issue(
      "mixed-content",
      "block",
      parsed
        .filter(({ page, $ }) => page.url.startsWith("https://") && $('img[src^="http://"], script[src^="http://"], link[href^="http://"]').length > 0)
        .map(({ page }) => page.url),
      (n) => `${n} secure ${n === 1 ? "page loads something" : "pages load something"} over an insecure connection`,
      'Change those "http://" addresses to "https://". Browsers block them and some show the whole page as not secure.',
    ),
  );

  // Orphans: a page in the sitemap that nothing on the site links to. Google can still find it,
  // but nothing passes it any authority and visitors never stumble into it.
  const linked = new Set<string>();
  for (const { page, $ } of parsed) {
    for (const el of $("a[href]").toArray()) {
      const href = $(el).attr("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      try {
        const abs = new URL(href, page.finalUrl ?? page.url).toString();
        if (sameOrigin(abs, site.origin)) linked.add(canonicalKey(abs));
      } catch {
        /* an unparseable href is the browser's problem, not a finding worth a row */
      }
    }
  }
  const orphans = ok.map((p) => p.url).filter((u) => !linked.has(canonicalKey(u)) && canonicalKey(u) !== canonicalKey(site.origin));
  issues.push(
    issue(
      "orphan-page",
      "warn",
      orphans,
      (n) => `${n} ${n === 1 ? "page is" : "pages are"} not linked from anywhere on the site`,
      "Link to these from a relevant page or your menu. A page nothing links to reads as unimportant to Google and is invisible to visitors browsing.",
    ),
  );

  const thin = parsed
    .filter(({ $ }) => {
      const clone = cheerio.load($.html());
      clone("script, style, nav, header, footer, noscript").remove();
      return clone("body").text().replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length < 150;
    })
    .map(({ page }) => page.url);
  issues.push(
    issue(
      "thin-content",
      "warn",
      thin,
      (n) => `${n} ${n === 1 ? "page has" : "pages have"} almost no text on it`,
      "Either write these properly or remove them. A page with a heading and two lines rarely ranks for anything and drags the rest down.",
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
  const blocks = found.filter((i) => i.severity === "block").length;
  const warns = found.filter((i) => i.severity === "warn").length;

  return {
    score: clamp(100 - 25 * blocks - 5 * warns, 0, 100),
    pagesChecked: pages.length,
    blocks,
    warns,
    issues: found,
    skipped,
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
