import test from "node:test";
import assert from "node:assert/strict";
import { auditSite, describeTrend, summarizeAudit, topIssues, type AuditPage, type SiteContext } from "./checks.js";
import { chooseUrls, parseSitemap, auditTarget } from "./fetchSite.js";

/** Mr. Audit's catalogue, tested the way seoChecks.ts is: from fixtures, with no network, and
 *  with a test per claim the report makes to a customer. The two that matter most are the ones
 *  no per-page checker could make at all — duplicate titles and orphan pages. */

const ORIGIN = "https://example.com";

function page(url: string, html: string, over: Partial<AuditPage> = {}): AuditPage {
  return { url, status: 200, finalUrl: null, html, bytes: Buffer.byteLength(html, "utf8"), ms: 200, error: null, ...over };
}

/** A page with nothing wrong with it, so a test's fixture only has to state its own defect. */
function good(url: string, title: string, extra = ""): AuditPage {
  const body = `<p>${"word ".repeat(200)}</p>`;
  return page(
    url,
    `<html><head><title>${title}</title><meta name="description" content="A description of ${title}."><link rel="canonical" href="${url}"></head>` +
      `<body><h1>${title}</h1>${body}${extra}</body></html>`
  );
}

const CTX: SiteContext = { origin: ORIGIN, robotsTxt: "User-agent: *\nAllow: /", sitemapUrls: [`${ORIGIN}/`] };

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
  const home = good(`${ORIGIN}/`, "Home", `<a href="/a">A</a>`);
  const clean = auditSite([home, good(`${ORIGIN}/a`, "A")], CTX);
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
