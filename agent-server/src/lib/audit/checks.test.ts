import test from "node:test";
import assert from "node:assert/strict";
import { auditSite, describeTrend, summarizeAudit, topIssues, type AuditPage, type SiteContext } from "./checks.js";
import { chooseUrls, parseSitemap, auditTarget, fetchSiteContext } from "./fetchSite.js";

/** Mr. Audit's catalogue, tested the way seoChecks.ts is: from fixtures, with no network, and
 *  with a test per claim the report makes to a customer. The two that matter most are the ones
 *  no per-page checker could make at all — duplicate titles and orphan pages. */

const ORIGIN = "https://example.com";

function page(url: string, html: string, over: Partial<AuditPage> = {}): AuditPage {
  return { url, status: 200, finalUrl: null, html, bytes: Buffer.byteLength(html, "utf8"), ms: 200, error: null, ...over };
}

/** A page with nothing wrong with it, so a test's fixture only has to state its own defect.
 *  "Nothing wrong" grew with Round A (2026-09-05): a doctype, a charset, a viewport, a lang, a
 *  title long enough to be a title, and an H1 that is not a copy of it. */
function good(url: string, title: string, extra = ""): AuditPage {
  const body = `<p>${"word ".repeat(200)}</p>`;
  return page(
    url,
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${title} — Example Roofing, Springfield</title><meta name="description" content="A description of ${title}."><link rel="canonical" href="${url}"></head>` +
      `<body><h1>About ${title}</h1>${body}${extra}</body></html>`
  );
}

const CTX: SiteContext = { origin: ORIGIN, robotsTxt: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml`, sitemapUrls: [`${ORIGIN}/`] };

/** A bare page: the shape most Round A checks are looking for. */
const bare = (body: string, head = "") => `<html><head>${head}</head><body>${body}</body></html>`;

/* ---------------------------------------------------------------- broken ---------------- */

test("a page that could not be loaded is a finding, not a crash", () => {
  const r = auditSite([{ url: `${ORIGIN}/gone`, status: null, finalUrl: null, html: null, bytes: 0, ms: null, error: "timeout" }], CTX);
  const found = r.issues.find((i) => i.id === "unreachable");
  assert.ok(found);
  assert.equal(found.severity, "block");
  assert.equal(found.count, 1);
});

test("404 and 500 are separate findings, because the fix is different", () => {
  const r = auditSite(
    [
      page(`${ORIGIN}/a`, "", { status: 404, html: null }),
      page(`${ORIGIN}/b`, "", { status: 500, html: null }),
    ],
    CTX
  );
  assert.ok(r.issues.some((i) => i.id === "not-found"));
  assert.ok(r.issues.some((i) => i.id === "server-error"));
});

test("a redirect is a warning about our own links, not a broken page", () => {
  const r = auditSite([{ ...good(`${ORIGIN}/old`, "Old"), finalUrl: `${ORIGIN}/new` }], CTX);
  const found = r.issues.find((i) => i.id === "redirect-chain");
  assert.ok(found);
  assert.equal(found.severity, "warn");
});

test("a trailing slash is not a redirect", () => {
  // The commonest false positive there is: /about and /about/ are the same page, and reporting
  // it would bury the real redirects in noise.
  const r = auditSite([{ ...good(`${ORIGIN}/about`, "About"), finalUrl: `${ORIGIN}/about/` }], CTX);
  assert.equal(r.issues.some((i) => i.id === "redirect-chain"), false);
});

/* ---------------------------------------------------------------- invisible ------------- */

test("noindex blocks: a page telling Google to stay away is the most expensive thing on a site", () => {
  const html = `<html><head><title>T</title><meta name="robots" content="noindex, follow"></head><body><h1>T</h1></body></html>`;
  const r = auditSite([page(`${ORIGIN}/x`, html)], CTX);
  const found = r.issues.find((i) => i.id === "noindex");
  assert.ok(found);
  assert.equal(found.severity, "block");
});

test("robots.txt disallowing the whole site is a block, and it names the file", () => {
  const r = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, robotsTxt: "User-agent: *\nDisallow: /" });
  const found = r.issues.find((i) => i.id === "robots-blocks-all");
  assert.ok(found);
  assert.equal(found.severity, "block");
  assert.deepEqual(found.pages, [`${ORIGIN}/robots.txt`]);
});

test("a disallow of one folder is not a disallow of the site", () => {
  const r = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, robotsTxt: "User-agent: *\nDisallow: /wp-admin/" });
  assert.equal(r.issues.some((i) => i.id === "robots-blocks-all"), false);
});

test("an unreadable robots.txt is a skipped check, never an accusation", () => {
  const r = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, robotsTxt: null });
  assert.equal(r.issues.some((i) => i.id === "robots-blocks-all"), false);
  assert.ok(r.skipped.some((s) => /robots\.txt/.test(s)));
});

/* ---------------------------------------------------------------- pagesWithIssues / blockedPages (2026-09-05, Crawled Pages breakdown) ---------------- */

test("pagesWithIssues names exactly the pages that triggered an on-page issue, not an approximation", () => {
  const r = auditSite(
    [
      good(`${ORIGIN}/`, "Home"),
      page(`${ORIGIN}/no-title`, `<html><head></head><body><h1>X</h1>${"word ".repeat(200)}</body></html>`),
    ],
    CTX
  );
  assert.ok(r.pagesWithIssues.includes(`${ORIGIN}/no-title`));
  assert.equal(r.pagesWithIssues.includes(`${ORIGIN}/`), false, "the clean page triggered nothing, so it is not in the list");
});

test("pagesWithIssues is exact even when an issue affects more pages than PAGE_SAMPLE shows", () => {
  const many = Array.from({ length: 120 }, (_, i) => page(`${ORIGIN}/p${i}`, `<html><head></head><body><h1>X</h1>${"word ".repeat(200)}</body></html>`));
  const r = auditSite(many, CTX);
  const missingTitle = r.issues.find((i) => i.id === "missing-title");
  assert.ok(missingTitle);
  assert.ok(missingTitle!.pages.length < 120, "the SHOWN sample is capped");
  assert.equal(r.pagesWithIssues.length, 120, "but the real tally is not — every one of the 120 pages is accounted for");
});

test("blockedPages names exactly the pages robots.txt disallows for '*', using the same parser the AI-bot check uses", () => {
  const r = auditSite(
    [good(`${ORIGIN}/`, "Home"), good(`${ORIGIN}/private/secret`, "Secret")],
    { ...CTX, robotsTxt: "User-agent: *\nDisallow: /private\n" }
  );
  assert.deepEqual(r.blockedPages, [`${ORIGIN}/private/secret`]);
});

test("blockedPages is empty (not a guess) when robots.txt could not be read at all", () => {
  const r = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, robotsTxt: null });
  assert.deepEqual(r.blockedPages, []);
});

/* ---------------------------------------------------------------- category / catalogue (2026-09-05, thematic %) ---------------- */

test("every issue that fires carries a real category — never the 'Other' smell", () => {
  // A site that trips as many checks as a fixture can: broken, redirected, noindex, missing
  // everything, mixed content, thin, heavy, slow, orphan, plus a performance issue folded in.
  const r = auditSite(
    [
      page(`${ORIGIN}/`, `<html><head></head><body><p>hi</p><img src="http://x.test/a.png"></body></html>`, { ms: 5000, bytes: 3_000_000 }),
      page(`${ORIGIN}/gone`, "", { status: 404, html: null }),
      page(`${ORIGIN}/moved`, `<html><head><title>M</title></head><body><h1>M</h1></body></html>`, { finalUrl: `${ORIGIN}/elsewhere` }),
      page(`${ORIGIN}/hidden`, `<html><head><title>H</title><meta name="robots" content="noindex"></head><body><h1>H</h1></body></html>`),
    ],
    { ...CTX, robotsTxt: "User-agent: *\nDisallow: /\n", sitemapUrls: [`${ORIGIN}/`, `${ORIGIN}/orphan`] },
    { issues: [{ id: "slow-lcp", severity: "warn", what: "x", fix: "y", pages: [`${ORIGIN}/`], count: 1, category: "" }], skippedReason: null }
  );
  assert.ok(r.issues.length >= 8, `fixture should trip many checks, tripped ${r.issues.length}`);
  for (const i of r.issues) {
    assert.ok(i.category && i.category !== "Other", `${i.id} has no category in CHECK_CATALOGUE`);
  }
});

test("the catalogue lists every id that can ever fire, so a thematic % has an exact denominator", () => {
  const r = auditSite([good(`${ORIGIN}/`, "Home")], CTX);
  const ids = new Set(r.catalogue.map((c) => c.id));
  for (const id of ["unreachable", "server-error", "not-found", "missing-title", "duplicate-title", "mixed-content", "orphan-page", "thin-content", "robots-blocks-all", "slow-lcp"]) {
    assert.ok(ids.has(id), `${id} missing from CHECK_CATALOGUE`);
  }
  assert.ok(r.catalogue.every((c) => c.category && c.severity), "every catalogue entry names a category and a severity");
});

/* ---------------------------------------------------------------- cross-page ------------ */

test("duplicate titles are found — the check no single-page tool can make", () => {
  const r = auditSite([good(`${ORIGIN}/a`, "Roof repairs"), good(`${ORIGIN}/b`, "Roof repairs"), good(`${ORIGIN}/c`, "Gutters")], {
    ...CTX,
    sitemapUrls: null,
  });
  const found = r.issues.find((i) => i.id === "duplicate-title");
  assert.ok(found);
  assert.equal(found.count, 2, "both pages sharing the title are named, not just the second one");
  assert.equal(found.pages.includes(`${ORIGIN}/c`), false);
});

test("an orphan is a page nothing links to — and the home page is never one", () => {
  const home = good(`${ORIGIN}/`, "Home", `<a href="/a">A</a>`);
  const r = auditSite([home, good(`${ORIGIN}/a`, "A"), good(`${ORIGIN}/b`, "B")], CTX);
  const found = r.issues.find((i) => i.id === "orphan-page");
  assert.ok(found);
  assert.deepEqual(found.pages, [`${ORIGIN}/b`]);
});

test("a link with a trailing slash still counts as a link", () => {
  const home = good(`${ORIGIN}/`, "Home", `<a href="/a/">A</a>`);
  const r = auditSite([home, good(`${ORIGIN}/a`, "A")], CTX);
  assert.equal(r.issues.some((i) => i.id === "orphan-page"), false);
});

/* ---------------------------------------------------------------- page basics ----------- */

test("titles, descriptions, headings and canonicals each have their own finding", () => {
  const bare = page(`${ORIGIN}/x`, `<html><head></head><body><p>${"word ".repeat(200)}</p></body></html>`);
  const r = auditSite([bare], { ...CTX, sitemapUrls: null });
  for (const id of ["missing-title", "missing-meta", "missing-h1", "missing-canonical"]) {
    assert.ok(r.issues.some((i) => i.id === id), `expected ${id}`);
  }
  assert.equal(r.issues.find((i) => i.id === "missing-title")?.severity, "block");
  assert.equal(r.issues.find((i) => i.id === "missing-meta")?.severity, "warn", "a missing description is worth fixing, not worth stopping for");
});

test("mixed content on an https page is a block; the same on http is not a finding", () => {
  const insecure = `<img src="http://cdn.example.net/a.png">`;
  const https = auditSite([page(`${ORIGIN}/x`, `<html><head><title>T</title></head><body><h1>T</h1>${insecure}${"word ".repeat(200)}</body></html>`)], CTX);
  assert.equal(https.issues.find((i) => i.id === "mixed-content")?.severity, "block");

  const plain = auditSite(
    [page("http://old.example/x", `<html><head><title>T</title></head><body><h1>T</h1>${insecure}${"word ".repeat(200)}</body></html>`)],
    { ...CTX, origin: "http://old.example" }
  );
  assert.equal(plain.issues.some((i) => i.id === "mixed-content"), false);
});

test("thin content ignores the furniture — a nav-heavy page with real text is not thin", () => {
  const chrome = `<nav>${"menu ".repeat(300)}</nav><footer>${"links ".repeat(300)}</footer>`;
  const thin = auditSite([page(`${ORIGIN}/x`, `<html><head><title>T</title></head><body>${chrome}<h1>T</h1><p>Two lines only.</p></body></html>`)], CTX);
  assert.ok(thin.issues.some((i) => i.id === "thin-content"));

  const real = auditSite([page(`${ORIGIN}/x`, `<html><head><title>T</title></head><body>${chrome}<h1>T</h1><p>${"word ".repeat(200)}</p></body></html>`)], CTX);
  assert.equal(real.issues.some((i) => i.id === "thin-content"), false);
});

test("images with alt text are not reported; one image without it is", () => {
  const withAlt = good(`${ORIGIN}/a`, "A", `<img src="/a.png" alt="A roof being repaired">`);
  assert.equal(auditSite([withAlt], CTX).issues.some((i) => i.id === "image-no-alt"), false);

  const without = good(`${ORIGIN}/a`, "A", `<img src="/a.png" alt="A roof"><img src="/b.png">`);
  assert.ok(auditSite([without], CTX).issues.some((i) => i.id === "image-no-alt"));
});

/* ---------------------------------------------------------------- score and report ------ */

test("the score is the house formula, and a clean site scores 100", () => {
  // Three pages, each linked from two others with descriptive anchors — so no page is an
  // orphan, none has a single incoming link, and no anchor is "click here".
  const home = good(`${ORIGIN}/`, "Home", `<a href="/a">Roof repairs</a><a href="/b">Gutter cleaning</a>`);
  const a = good(`${ORIGIN}/a`, "Roof repairs", `<a href="/b">Gutter cleaning</a><a href="/">Example Roofing home</a>`);
  const b = good(`${ORIGIN}/b`, "Gutter cleaning", `<a href="/a">Roof repairs</a><a href="/">Example Roofing home</a>`);
  const clean = auditSite([home, a, b], CTX);
  assert.equal(clean.issues.length, 0, JSON.stringify(clean.issues.map((i) => i.id)));
  assert.equal(clean.score, 100);

  const broken = auditSite([{ url: `${ORIGIN}/x`, status: null, finalUrl: null, html: null, bytes: 0, ms: null }], CTX);
  assert.equal(broken.score, 100 - 25 * broken.blocks - 5 * broken.warns);
});

test("the score never goes below zero however bad the site is", () => {
  // Note what the score counts: KINDS of problem, not pages. Six unreachable pages are one
  // finding with a count of six, so scoring by page would put a small broken site at zero and
  // a large one at zero too, and the number would stop meaning anything. Five distinct kinds
  // of serious problem is what actually gets you to the floor.
  const r = auditSite(
    [
      { url: `${ORIGIN}/a`, status: null, finalUrl: null, html: null, bytes: 0, ms: null },
      page(`${ORIGIN}/b`, "", { status: 500, html: null }),
      page(`${ORIGIN}/c`, "", { status: 404, html: null }),
      page(`${ORIGIN}/d`, `<html><head><title>T</title><meta name="robots" content="noindex"></head><body><h1>T</h1></body></html>`),
    ],
    { origin: ORIGIN, robotsTxt: "User-agent: *\nDisallow: /", sitemapUrls: null }
  );
  assert.ok(r.blocks >= 5, `expected 5+ kinds of block, got ${r.blocks}`);
  assert.equal(r.score, 0);
});

test("Core Web Vitals are declared as not measured, never estimated", () => {
  const r = auditSite([good(`${ORIGIN}/`, "Home")], CTX);
  assert.ok(r.skipped.some((s) => /Core Web Vitals/.test(s)));
  assert.equal(r.issues.some((i) => /vital|lcp|cls|performance/i.test(i.id)), false);
});

/* ---------------------------------------------------------------- performance (2026-08-28) --- */

test("real performance issues fold into the report, and the 'not measured' line disappears", () => {
  const perfIssue = { id: "slow-lcp", severity: "warn" as const, what: "1 page is slow", fix: "compress the hero image", pages: [`${ORIGIN}/`], count: 1 };
  const r = auditSite([good(`${ORIGIN}/`, "Home")], CTX, { issues: [perfIssue], skippedReason: null });
  assert.ok(r.issues.some((i) => i.id === "slow-lcp"));
  assert.equal(r.skipped.some((s) => /Core Web Vitals/.test(s)), false, "it WAS measured this time — the old blanket line must not still show");
  // The house formula counts it like any other warn — one extra warn is -5.
  assert.equal(r.warns, 1);
});

test("a browser that could not launch this run is a different, honest sentence — not the old blanket one", () => {
  const r = auditSite([good(`${ORIGIN}/`, "Home")], CTX, { issues: [], skippedReason: "No Chrome binary found on this server." });
  assert.ok(r.skipped.includes("No Chrome binary found on this server."));
  assert.equal(r.skipped.some((s) => /needs a real browser, which this check does not use/.test(s)), false);
});

test("performance measured with zero issues leaves no skipped line at all — the gap is genuinely closed", () => {
  const r = auditSite([good(`${ORIGIN}/`, "Home")], CTX, { issues: [], skippedReason: null });
  assert.equal(r.skipped.length, 0);
});

test("top issues put blocks first, then whatever affects the most pages", () => {
  const pages = [
    page(`${ORIGIN}/a`, "", { status: 404, html: null }),
    good(`${ORIGIN}/b`, "Dup"),
    good(`${ORIGIN}/c`, "Dup"),
  ];
  const top = topIssues(auditSite(pages, { ...CTX, sitemapUrls: null }));
  assert.equal(top[0].severity, "block");
  assert.ok(top.length <= 5);
});

test("the trend is a sentence, including the first-audit case", () => {
  assert.match(describeTrend(70, null), /first audit/);
  assert.match(describeTrend(76, 70), /Up 6/);
  assert.match(describeTrend(64, 70), /Down 6/);
  assert.match(describeTrend(70, 70), /Same score/);
});

test("the summary is measurements, and it says how many pages were checked", () => {
  const r = auditSite([good(`${ORIGIN}/`, "Home")], CTX);
  const s = summarizeAudit(r, 61);
  assert.match(s, new RegExp(`${r.score}/100`));
  assert.match(s, /1 pages/);
  assert.match(s, /was 61/);
});

/* ---------------------------------------------------------------- Round A (2026-09-05, MASTER_PLAN §27.5) ---------------- */

const ids = (r: ReturnType<typeof auditSite>) => new Set(r.issues.map((i) => i.id));
const has = (r: ReturnType<typeof auditSite>, id: string) => ids(r).has(id);

test("Round A: every new id is in the catalogue, so the thematic rings have their denominator", () => {
  const r = auditSite([good(`${ORIGIN}/`, "Home")], CTX);
  const catalogue = new Set(r.catalogue.map((c) => c.id));
  const roundA = [
    "unreachable-dns", "robots-format-error", "robots-not-found", "sitemap-format-error", "sitemap-bad-page", "malformed-sitemap-url",
    "sitemap-too-large", "sitemap-not-in-robots", "blocked-resources", "malformed-link", "long-link-url", "underscore-url", "too-many-params",
    "long-url", "resource-as-link", "non-secure-page", "homepage-not-https", "http-urls-in-sitemap", "https-to-http-links", "missing-viewport",
    "viewport-no-width", "meta-refresh", "no-charset", "no-doctype", "plugin-content", "frames", "short-title", "h1-equals-title", "duplicate-meta",
    "multiple-canonical", "invalid-structured-data", "duplicate-content", "low-text-ratio", "internal-nofollow", "too-many-links",
    "one-incoming-link", "deep-page", "generic-anchor", "empty-anchor", "external-nofollow", "hreflang-conflict", "hreflang-invalid", "no-lang",
    "hreflang-lang-mismatch", "ai-too-much-content", "ai-outdated-content", "ai-low-semantic-html",
  ];
  for (const id of roundA) assert.ok(catalogue.has(id), `${id} missing from CHECK_CATALOGUE`);
});

test("a DNS failure is its own row, separate from a timeout — the fix is the name, not the server", () => {
  const r = auditSite(
    [
      { url: `${ORIGIN}/dns`, status: null, finalUrl: null, html: null, bytes: 0, ms: null, error: "getaddrinfo ENOTFOUND example.com" },
      { url: `${ORIGIN}/slow`, status: null, finalUrl: null, html: null, bytes: 0, ms: null, error: "The operation was aborted due to timeout" },
    ],
    CTX
  );
  assert.deepEqual(r.issues.find((i) => i.id === "unreachable-dns")?.pages, [`${ORIGIN}/dns`]);
  assert.deepEqual(r.issues.find((i) => i.id === "unreachable")?.pages, [`${ORIGIN}/slow`]);
});

test("a 403 or 410 is a 4xx finding like a 404", () => {
  const r = auditSite([page(`${ORIGIN}/a`, "", { status: 403, html: null }), page(`${ORIGIN}/b`, "", { status: 410, html: null })], CTX);
  assert.equal(r.issues.find((i) => i.id === "not-found")?.count, 2);
});

test("robots.txt rows: missing is a notice, a typo line is a format error, a sitemap it does not name is a row", () => {
  const none = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, robotsTxt: null });
  assert.equal(none.issues.find((i) => i.id === "robots-not-found")?.severity, "info");

  const typo = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, robotsTxt: `User-agent: *\nDissalow: /wp-admin/\nSitemap: ${ORIGIN}/sitemap.xml` });
  assert.ok(has(typo, "robots-format-error"));
  assert.match(typo.issues.find((i) => i.id === "robots-format-error")!.what, /Dissalow/);
  assert.equal(has(typo, "sitemap-not-in-robots"), false);

  const comments = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, robotsTxt: `# hello\nUser-agent: *   # everyone\n\nAllow: /\nCrawl-delay: 5\nSitemap: ${ORIGIN}/sitemap.xml` });
  assert.equal(has(comments, "robots-format-error"), false, "comments, blank lines and known directives are not errors");

  const unnamed = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, robotsTxt: "User-agent: *\nAllow: /" });
  assert.ok(has(unnamed, "sitemap-not-in-robots"));
  assert.equal(has(auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, robotsTxt: "User-agent: *\nAllow: /", sitemapUrls: null }), "sitemap-not-in-robots"), false, "no sitemap → the no-sitemap row, not this one");
});

test("sitemap rows: format error, an entry that is not a URL, a listed page that is not indexable, http entries, too large", () => {
  const malformed = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, sitemapUrls: [], sitemapMalformed: true });
  assert.ok(has(malformed, "sitemap-format-error"));
  assert.equal(has(auditSite([good(`${ORIGIN}/`, "Home")], CTX), "sitemap-format-error"), false);

  const junk = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, sitemapUrls: [`${ORIGIN}/`, "not a url", "/relative"] });
  assert.equal(junk.issues.find((i) => i.id === "malformed-sitemap-url")?.count, 2);

  const listed = auditSite(
    [
      good(`${ORIGIN}/`, "Home"),
      page(`${ORIGIN}/gone`, "", { status: 404, html: null }),
      { ...good(`${ORIGIN}/moved`, "Moved"), finalUrl: `${ORIGIN}/elsewhere` },
      page(`${ORIGIN}/hidden`, bare(`<h1>H</h1>`, `<title>Hidden page of Example Roofing</title><meta name="robots" content="noindex">`)),
      good(`${ORIGIN}/fine-but-unlisted`, "Unlisted"),
    ],
    { ...CTX, sitemapUrls: [`${ORIGIN}/`, `${ORIGIN}/gone`, `${ORIGIN}/moved`, `${ORIGIN}/hidden`] }
  );
  assert.deepEqual(listed.issues.find((i) => i.id === "sitemap-bad-page")?.pages.sort(), [`${ORIGIN}/gone`, `${ORIGIN}/hidden`, `${ORIGIN}/moved`]);

  const http = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, sitemapUrls: [`${ORIGIN}/`, "http://example.com/old"] });
  assert.equal(http.issues.find((i) => i.id === "http-urls-in-sitemap")?.count, 1);

  const huge = auditSite([good(`${ORIGIN}/`, "Home")], { ...CTX, sitemapUrls: [`${ORIGIN}/`], sitemapBytes: 60 * 1024 * 1024 });
  assert.ok(has(huge, "sitemap-too-large"));
});

test("HTTPS rows: an http:// site is a warn at the root and a block per page; an https site has neither", () => {
  const r = auditSite([good("http://old.example/", "Home")], { ...CTX, origin: "http://old.example" });
  assert.equal(r.issues.find((i) => i.id === "homepage-not-https")?.severity, "warn");
  assert.equal(r.issues.find((i) => i.id === "non-secure-page")?.severity, "block");
  const s = auditSite([good(`${ORIGIN}/`, "Home")], CTX);
  assert.equal(has(s, "homepage-not-https") || has(s, "non-secure-page"), false);
});

test("a short title and an H1 that copies the title are separate rows; a proper page has neither", () => {
  const r = auditSite([page(`${ORIGIN}/x`, bare(`<h1>Roofing</h1><p>${"word ".repeat(200)}</p>`, `<title>Roofing</title>`))], CTX);
  assert.ok(has(r, "short-title"));
  assert.ok(has(r, "h1-equals-title"));
  const thirty = auditSite([page(`${ORIGIN}/x`, bare(`<h1>Other</h1>`, `<title>${"x".repeat(30)}</title>`))], CTX);
  assert.equal(has(thirty, "short-title"), false, "30 characters is the line, not under it");
  const g = auditSite([good(`${ORIGIN}/x`, "Roofing")], CTX);
  assert.equal(has(g, "short-title") || has(g, "h1-equals-title"), false);
});

test("duplicate descriptions and two canonical tags are found", () => {
  const dup = auditSite([good(`${ORIGIN}/a`, "Same"), good(`${ORIGIN}/b`, "Same")], CTX);
  assert.equal(dup.issues.find((i) => i.id === "duplicate-meta")?.count, 2);
  const two = auditSite([good(`${ORIGIN}/a`, "A", `<link rel="canonical" href="${ORIGIN}/a?v=2">`)], CTX);
  assert.ok(has(two, "multiple-canonical"));
});

test("doctype, charset, viewport and lang: missing on a bare page, present on a proper one, and a BOM before the doctype is fine", () => {
  const b = auditSite([page(`${ORIGIN}/x`, bare(`<h1>X</h1>`))], CTX);
  for (const id of ["no-doctype", "no-charset", "missing-viewport", "no-lang"]) assert.ok(has(b, id), `expected ${id}`);
  const g = auditSite([good(`${ORIGIN}/x`, "X")], CTX);
  for (const id of ["no-doctype", "no-charset", "missing-viewport", "no-lang", "viewport-no-width"]) assert.equal(has(g, id), false, `${id} must not fire on a proper page`);

  const bom = auditSite([page(`${ORIGIN}/x`, "\uFEFF<!DOCTYPE html>" + bare(`<h1>X</h1>`))], CTX);
  assert.equal(has(bom, "no-doctype"), false);
  const legacyCharset = auditSite([page(`${ORIGIN}/x`, bare(`<h1>X</h1>`, `<meta http-equiv="Content-Type" content="text/html; charset=utf-8">`))], CTX);
  assert.equal(has(legacyCharset, "no-charset"), false);
  const noWidth = auditSite([page(`${ORIGIN}/x`, bare(`<h1>X</h1>`, `<meta name="viewport" content="initial-scale=1">`))], CTX);
  assert.ok(has(noWidth, "viewport-no-width"));
  assert.equal(has(noWidth, "missing-viewport"), false);
});

test("meta refresh, frames (an iframe is not a frame) and plugin content", () => {
  const refresh = auditSite([page(`${ORIGIN}/x`, bare(`<h1>X</h1>`, `<meta http-equiv="refresh" content="0;url=/y">`))], CTX);
  assert.ok(has(refresh, "meta-refresh"));
  const frames = auditSite([page(`${ORIGIN}/x`, `<html><head></head><frameset><frame src="/a"></frameset></html>`)], CTX);
  assert.ok(has(frames, "frames"));
  const iframe = auditSite([page(`${ORIGIN}/x`, bare(`<h1>X</h1><iframe src="https://www.youtube.com/embed/1"></iframe>`))], CTX);
  assert.equal(has(iframe, "frames"), false);
  const flash = auditSite([page(`${ORIGIN}/x`, bare(`<h1>X</h1><embed src="/intro.swf" type="application/x-shockwave-flash">`))], CTX);
  assert.ok(has(flash, "plugin-content"));
  const video = auditSite([page(`${ORIGIN}/x`, bare(`<h1>X</h1><object data="/doc.pdf" type="application/pdf"></object>`))], CTX);
  assert.equal(has(video, "plugin-content"), false);
});

test("structured data: broken JSON or no @type is a row; a valid block or a @graph is not", () => {
  const bad = auditSite([page(`${ORIGIN}/x`, bare(`<h1>X</h1>`, `<script type="application/ld+json">{"name": "x",}</script>`))], CTX);
  assert.ok(has(bad, "invalid-structured-data"));
  const untyped = auditSite([page(`${ORIGIN}/x`, bare(`<h1>X</h1>`, `<script type="application/ld+json">{"name": "x"}</script>`))], CTX);
  assert.ok(has(untyped, "invalid-structured-data"));
  const ok = auditSite([page(`${ORIGIN}/x`, bare(`<h1>X</h1>`, `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"x"}]}</script>`))], CTX);
  assert.equal(has(ok, "invalid-structured-data"), false);
});

test("hreflang: a conflict, an invalid code, and a self-entry disagreeing with <html lang>; a correct set is silent", () => {
  const url = `${ORIGIN}/x`;
  const conflict = auditSite([page(url, bare(`<h1>X</h1>`, `<link rel="alternate" hreflang="en" href="${url}"><link rel="alternate" hreflang="en" href="${ORIGIN}/y">`))], CTX);
  assert.ok(has(conflict, "hreflang-conflict"));
  const invalid = auditSite([page(url, bare(`<h1>X</h1>`, `<link rel="alternate" hreflang="english" href="${url}">`))], CTX);
  assert.ok(has(invalid, "hreflang-invalid"));
  assert.equal(has(invalid, "no-lang"), false, "hreflang entries count as a language declaration");
  const mismatch = auditSite([page(url, `<html lang="fr"><head><link rel="alternate" hreflang="en" href="${url}"></head><body><h1>X</h1></body></html>`)], CTX);
  assert.ok(has(mismatch, "hreflang-lang-mismatch"));
  const fine = auditSite(
    [page(url, `<html lang="en-GB"><head><link rel="alternate" hreflang="en-GB" href="${url}"><link rel="alternate" hreflang="fr" href="${ORIGIN}/fr/x"><link rel="alternate" hreflang="x-default" href="${url}"></head><body><h1>X</h1></body></html>`)],
    CTX
  );
  for (const id of ["hreflang-conflict", "hreflang-invalid", "hreflang-lang-mismatch", "no-lang"]) assert.equal(has(fine, id), false, id);
});

test("URL rows: underscores, more than four parameters, and over 200 characters", () => {
  const r = auditSite(
    [
      good(`${ORIGIN}/roof_repairs`, "A"),
      good(`${ORIGIN}/s?a=1&b=2&c=3&d=4&e=5`, "B"),
      good(`${ORIGIN}/s?a=1&b=2&c=3&d=4`, "C"),
      good(`${ORIGIN}/${"long-".repeat(50)}`, "D"),
    ],
    CTX
  );
  assert.deepEqual(r.issues.find((i) => i.id === "underscore-url")?.pages, [`${ORIGIN}/roof_repairs`]);
  assert.deepEqual(r.issues.find((i) => i.id === "too-many-params")?.pages, [`${ORIGIN}/s?a=1&b=2&c=3&d=4&e=5`]);
  assert.equal(r.issues.find((i) => i.id === "long-url")?.count, 1);
});

test("link rows: malformed, long, https→http, resource, nofollow in and out, generic and empty anchors", () => {
  const links =
    `<a href="http://exa mple.com/x">broken</a>` +
    `<a href="/p?${"q=1&".repeat(60)}">very long</a>` +
    `<a href="http://example.com/old">plain http</a>` +
    `<a href="/logo.png">logo file</a>` +
    `<a href="/pdfs/brochure.pdf">brochure</a>` +
    `<a href="/team" rel="nofollow">our team</a>` +
    `<a href="https://other.example/" rel="nofollow noopener">partner</a>` +
    `<a href="/prices">click here</a>` +
    `<a href="/faq">https://example.com/faq</a>` +
    `<a href="/empty"></a>` +
    `<a href="/img-ok"><img src="/i.png" alt="Our office"></a>` +
    `<a href="/aria-ok" aria-label="Contact us"></a>` +
    `<a href="mailto:hi@example.com">email</a>`;
  const r = auditSite([good(`${ORIGIN}/`, "Home", links)], CTX);
  for (const id of ["malformed-link", "long-link-url", "https-to-http-links", "resource-as-link", "internal-nofollow", "external-nofollow", "generic-anchor", "empty-anchor"]) {
    assert.ok(has(r, id), `expected ${id}`);
  }
  const clean = auditSite([good(`${ORIGIN}/`, "Home", `<a href="/pdfs/brochure.pdf">brochure</a><a href="mailto:hi@example.com">email</a><a href="/img-ok"><img src="/i.png" alt="Our office"></a>`)], CTX);
  for (const id of ["malformed-link", "resource-as-link", "empty-anchor", "generic-anchor"]) assert.equal(has(clean, id), false, `${id} false positive`);
});

test("one incoming link and click depth come from the same graph the orphan check uses", () => {
  const chain = [
    good(`${ORIGIN}/`, "Home", `<a href="/a">Roof repairs</a>`),
    good(`${ORIGIN}/a`, "A", `<a href="/b">Gutters</a>`),
    good(`${ORIGIN}/b`, "B", `<a href="/c">Skylights</a>`),
    good(`${ORIGIN}/c`, "C", `<a href="/d">Chimneys</a>`),
    good(`${ORIGIN}/d`, "D"),
  ];
  const r = auditSite(chain, CTX);
  assert.equal(has(r, "orphan-page"), false);
  assert.deepEqual(r.issues.find((i) => i.id === "one-incoming-link")?.pages, [`${ORIGIN}/a`, `${ORIGIN}/b`, `${ORIGIN}/c`, `${ORIGIN}/d`]);
  assert.deepEqual(r.issues.find((i) => i.id === "deep-page")?.pages, [`${ORIGIN}/d`], "d is 4 clicks away; c at 3 is the line");
});

test("a resource robots.txt blocks is a row, using the same parser as blockedPages", () => {
  const p = good(`${ORIGIN}/`, "Home", `<script src="/assets/app.js"></script>`);
  assert.ok(has(auditSite([p], { ...CTX, robotsTxt: `User-agent: *\nDisallow: /assets/\nSitemap: ${ORIGIN}/sitemap.xml` }), "blocked-resources"));
  assert.equal(has(auditSite([p], { ...CTX, robotsTxt: `User-agent: *\nDisallow: /private/\nSitemap: ${ORIGIN}/sitemap.xml` }), "blocked-resources"), false);
});

test("duplicate content names both copies, unless one of them canonicalises to the other", () => {
  const text = `<p>${"same words here ".repeat(60)}</p>`;
  const both = auditSite([good(`${ORIGIN}/a`, "Same", text), good(`${ORIGIN}/b`, "Same", text)], CTX);
  assert.equal(both.issues.find((i) => i.id === "duplicate-content")?.count, 2);
  const copy = { ...good(`${ORIGIN}/b`, "Same", text), html: good(`${ORIGIN}/b`, "Same", text).html!.replace(`href="${ORIGIN}/b"`, `href="${ORIGIN}/a"`) };
  assert.equal(has(auditSite([good(`${ORIGIN}/a`, "Same", text), copy], CTX), "duplicate-content"), false);
});

test("a page that is mostly markup by size is a low text ratio row", () => {
  const r = auditSite([{ ...good(`${ORIGIN}/x`, "X"), bytes: 200_000 }], CTX);
  assert.ok(has(r, "low-text-ratio"));
  assert.equal(has(auditSite([good(`${ORIGIN}/x`, "X")], CTX), "low-text-ratio"), false);
});

test("AI Search notices: too many words, a stated date older than two years, and a wall of divs", () => {
  const long = auditSite([good(`${ORIGIN}/x`, "X", `<p>${"more ".repeat(4200)}</p>`)], CTX);
  assert.ok(has(long, "ai-too-much-content"));

  const old = auditSite([good(`${ORIGIN}/x`, "X", `<time datetime="2015-03-01">1 March 2015</time>`)], CTX);
  assert.ok(has(old, "ai-outdated-content"));
  const undated = auditSite([good(`${ORIGIN}/x`, "X")], CTX);
  assert.equal(has(undated, "ai-outdated-content"), false, "no date on the page → nothing is claimed about its age");
  const recent = auditSite([good(`${ORIGIN}/x`, "X", `<time datetime="2015-03-01">old</time><script type="application/ld+json">{"@type":"Article","dateModified":"${new Date().toISOString()}"}</script>`)], CTX);
  assert.equal(has(recent, "ai-outdated-content"), false, "the latest date on the page is the one that counts");

  const divs = "<div>x</div>".repeat(40);
  assert.ok(has(auditSite([good(`${ORIGIN}/x`, "X", divs)], CTX), "ai-low-semantic-html"));
  assert.equal(has(auditSite([good(`${ORIGIN}/x`, "X", `<main><article>${divs}</article><nav></nav></main>`)], CTX), "ai-low-semantic-html"), false);
});

/* ---------------------------------------------------------------- choosing pages -------- */

test("the sitemap decides what to audit, the home page is always first, and other sites are ignored", () => {
  const urls = chooseUrls(ORIGIN, [`${ORIGIN}/b`, "https://elsewhere.com/x", `${ORIGIN}/a`], [`${ORIGIN}/c`], 10);
  assert.equal(urls[0], `${ORIGIN}/`);
  assert.deepEqual(urls, [`${ORIGIN}/`, `${ORIGIN}/b`, `${ORIGIN}/a`, `${ORIGIN}/c`]);
});

test("the cap is a cap, and the same page listed twice is one page", () => {
  const many = Array.from({ length: 30 }, (_, i) => `${ORIGIN}/p${i}`);
  assert.equal(chooseUrls(ORIGIN, [...many, ...many], [], 5).length, 5);
});

test("with no sitemap we audit what we already crawled", () => {
  assert.deepEqual(chooseUrls(ORIGIN, null, [`${ORIGIN}/known`], 10), [`${ORIGIN}/`, `${ORIGIN}/known`]);
});

test("a sitemap file, an xsl or a feed is never chosen as a page — even when the sitemap or the crawl table lists it", () => {
  const urls = chooseUrls(ORIGIN, [`${ORIGIN}/post-sitemap.xml`, `${ORIGIN}/about`], [`${ORIGIN}/feed.rss`, `${ORIGIN}/main-sitemap.xsl`, `${ORIGIN}/contact`], 10);
  assert.deepEqual(urls, [`${ORIGIN}/`, `${ORIGIN}/about`, `${ORIGIN}/contact`]);
});

test("a sitemap index is followed to its child sitemaps, and the pages come from the children", async () => {
  const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>${ORIGIN}/post-sitemap.xml</loc></sitemap><sitemap><loc>${ORIGIN}/page-sitemap.xml</loc></sitemap></sitemapindex>`;
  const posts = `<urlset><url><loc>${ORIGIN}/post-1/</loc></url><url><loc>${ORIGIN}/post-2/</loc></url></urlset>`;
  const pagesXml = `<urlset><url><loc>${ORIGIN}/about/</loc></url></urlset>`;
  const files: Record<string, string> = { "/robots.txt": `User-agent: *\nSitemap: ${ORIGIN}/sitemap_index.xml`, "/sitemap_index.xml": index, "/post-sitemap.xml": posts, "/page-sitemap.xml": pagesXml };
  const fetched: string[] = [];
  const fakeFetch = (async (input: any) => {
    const path = new URL(String(input)).pathname;
    fetched.push(path);
    const body = files[path];
    return new Response(body ?? "not found", { status: body ? 200 : 404 });
  }) as unknown as typeof fetch;
  const ctx = await fetchSiteContext(ORIGIN, fakeFetch);
  assert.deepEqual(ctx.sitemapUrls, [`${ORIGIN}/post-1/`, `${ORIGIN}/post-2/`, `${ORIGIN}/about/`]);
  assert.equal(ctx.sitemapMalformed, false);
  assert.ok(fetched.includes("/post-sitemap.xml") && fetched.includes("/page-sitemap.xml"), "both children were read");
});

test("a sitemap index is parsed for its locations like any other sitemap", () => {
  const xml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>${ORIGIN}/s1.xml</loc></sitemap><sitemap><loc>${ORIGIN}/s2.xml</loc></sitemap></sitemapindex>`;
  assert.deepEqual(parseSitemap(xml), [`${ORIGIN}/s1.xml`, `${ORIGIN}/s2.xml`]);
});

test("no website on file is a sentence to the user, not an exception", () => {
  const none = auditTarget(null);
  assert.equal(none.ok, false);
  assert.match(none.ok ? "" : none.reason, /no website/i);

  const junk = auditTarget("(no website yet)");
  assert.equal(junk.ok, false);

  const fine = auditTarget("example.com");
  assert.equal(fine.ok, true);
  assert.equal(fine.ok ? fine.origin : "", "https://example.com");
});
