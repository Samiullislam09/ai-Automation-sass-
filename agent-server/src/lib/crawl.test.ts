/** URL handling in the crawler — the layer where the live knowledge base went wrong.
 *
 *  Every case here is a real URL from the live workspace on 2026-09-19. The "must keep" list is
 *  what was MISSING from site_pages (all 15 ISO service pages, /pricing, /services,
 *  /gap-analysis); the "must drop" list is what was stored INSTEAD (/cart, /checkout,
 *  /my-account, /payment-failed, and empty ElementsKit mega-menu fragments). A regression in
 *  either direction is the same bug returning, so both are asserted.
 *
 *  Discovery itself (the sitemap + link-graph union) is not unit-tested because it is network
 *  I/O against a real site; it was measured instead, against wca-global.com on 2026-09-19:
 *  146 URLs found, 15 of 15 ISO pages present, 0 junk, vs 156 stored URLs with 0 ISO pages and
 *  49 junk before the change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, normalizeSiteUrl } from "./crawl.js";

const ORIGIN = "https://wca-global.com";

/* ── the pages that were missing, and must never be filtered out again ───────────────────── */

const ISO = [
  "iso-9001", "iso-14001", "iso-45001", "iso-22000", "iso-27001", "iso-41001", "iso-22301",
  "iso-42001", "iso-27701", "iso-21001", "iso-37001", "iso-13485", "iso-20121", "iso-50001", "iso-17298",
];

for (const slug of ISO) {
  test(`keeps the ${slug} service page`, () => {
    assert.equal(canonicalUrl(`${ORIGIN}/iso/${slug}/`, ORIGIN), `${ORIGIN}/iso/${slug}`);
  });
}

for (const path of ["/pricing", "/services", "/gap-analysis", "/iso", "/blog", "/contact", "/verify", "/apply"]) {
  test(`keeps ${path}`, () => {
    assert.equal(canonicalUrl(`${ORIGIN}${path}/`, ORIGIN), `${ORIGIN}${path}`);
  });
}

/* ── the junk that was stored instead ────────────────────────────────────────────────────── */

const JUNK = [
  "/cart/", "/checkout/", "/my-account/", "/login", "/wishlist",
  "/elementskit-content/dynamic-content-megamenu-menuitem7497/",
  "/wp-admin/", "/wp-json/", "/blog/feed/",
];

for (const path of JUNK) {
  test(`drops ${path}`, () => {
    assert.equal(canonicalUrl(`${ORIGIN}${path}`, ORIGIN), null);
  });
}

test("drops the ?elementskit_template= fragments that stored 13 characters each", () => {
  assert.equal(canonicalUrl(`${ORIGIN}/?elementskit_template=heder1`, ORIGIN), null);
  assert.equal(canonicalUrl(`${ORIGIN}/?elementskit_template=section`, ORIGIN), null);
});

test("drops assets, which are not pages", () => {
  for (const f of ["/logo.png", "/style.css", "/app.js", "/brochure.pdf", "/font.woff2", "/sitemap.xml"]) {
    assert.equal(canonicalUrl(`${ORIGIN}${f}`, ORIGIN), null, f);
  }
});

test("drops anything off this site", () => {
  assert.equal(canonicalUrl("https://facebook.com/wcaglobal", ORIGIN), null);
  assert.equal(canonicalUrl("mailto:hi@wca-global.com", ORIGIN), null);
  assert.equal(canonicalUrl("javascript:void(0)", ORIGIN), null);
});

/* ── one spelling per page ───────────────────────────────────────────────────────────────── */

test("the sitemap's spelling and a link's spelling are the same page", () => {
  // The live sitemap lists "https://wca-global.com/iso/" while the nav links to "/iso" — and
  // the sitemap URL itself redirects to www. Three spellings, one page.
  const want = `${ORIGIN}/iso`;
  assert.equal(canonicalUrl("https://wca-global.com/iso/", ORIGIN), want);
  assert.equal(canonicalUrl("/iso", ORIGIN), want);
  assert.equal(canonicalUrl("https://www.wca-global.com/iso/", ORIGIN), want);
  assert.equal(canonicalUrl(`${ORIGIN}/iso#top`, ORIGIN), want);
});

test("tracking parameters do not make a second copy of a page", () => {
  assert.equal(canonicalUrl(`${ORIGIN}/pricing?utm_source=fb&utm_campaign=x`, ORIGIN), `${ORIGIN}/pricing`);
  assert.equal(canonicalUrl(`${ORIGIN}/pricing?fbclid=abc`, ORIGIN), `${ORIGIN}/pricing`);
  assert.equal(canonicalUrl(`${ORIGIN}/pricing?gclid=abc`, ORIGIN), `${ORIGIN}/pricing`);
});

test("a meaningful query string is still its own page", () => {
  assert.equal(canonicalUrl(`${ORIGIN}/course?id=42`, ORIGIN), `${ORIGIN}/course?id=42`);
});

test("the homepage keeps its slash and does not become an empty path", () => {
  assert.equal(canonicalUrl(ORIGIN, ORIGIN), `${ORIGIN}/`);
  assert.equal(canonicalUrl(`${ORIGIN}/`, ORIGIN), `${ORIGIN}/`);
});

/* ── normalizeSiteUrl: unchanged behaviour, still asserted ───────────────────────────────── */

test("a bare domain becomes a usable address", () => {
  assert.equal(normalizeSiteUrl("wca-global.com"), "https://wca-global.com");
  assert.equal(normalizeSiteUrl("  https://wca-global.com/  "), "https://wca-global.com");
});

test("the values that took whole crawls down are refused", () => {
  // Found live: onboarding's "Skip — describe instead" wrote this literal string.
  assert.equal(normalizeSiteUrl("(no website yet)"), null);
  assert.equal(normalizeSiteUrl("mailto:a@b.com"), null);
  assert.equal(normalizeSiteUrl("localhost"), null);
  assert.equal(normalizeSiteUrl(""), null);
  assert.equal(normalizeSiteUrl(null), null);
});
