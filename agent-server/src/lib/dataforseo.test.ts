/** Run: cd agent-server && npx tsx --test src/lib/dataforseo.test.ts
 *
 *  normalizeHost and findRank only — keywordSuggestions/checkRank make a real DataForSEO call
 *  and are exercised by hand, same as every other paid-provider fetch in this codebase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { normalizeHost, findRank } = await import("./dataforseo.js");

/* ---------------------------------------------------------------- normalizeHost ---------- */

test("strips scheme and path from a full URL", () => {
  assert.equal(normalizeHost("https://example.com/blog/post"), "example.com");
});

test("strips a leading www.", () => {
  assert.equal(normalizeHost("https://www.example.com"), "example.com");
  assert.equal(normalizeHost("www.example.com"), "example.com");
});

test("a bare domain with no scheme normalizes the same as one with a scheme", () => {
  assert.equal(normalizeHost("example.com"), normalizeHost("https://example.com"));
});

test("is case-insensitive", () => {
  assert.equal(normalizeHost("Www.Example.COM"), "example.com");
});

test("empty input normalizes to an empty string, not a throw", () => {
  assert.equal(normalizeHost(""), "");
  assert.equal(normalizeHost(undefined as any), "");
});

test("a malformed value still normalizes without throwing", () => {
  assert.doesNotThrow(() => normalizeHost("not a url at all :: with junk"));
});

/* ---------------------------------------------------------------- findRank --------------- */

test("finds the tenant's domain among organic results and reports its position", () => {
  const items = [
    { type: "organic", domain: "competitor.com", url: "https://competitor.com/a", rank_absolute: 1 },
    { type: "organic", domain: "example.com", url: "https://example.com/best-plumber", rank_absolute: 4 },
  ];
  const out = findRank(items, "https://example.com");
  assert.equal(out.position, 4);
  assert.equal(out.url, "https://example.com/best-plumber");
});

test("matches even when the SERP result gives www. and the query domain doesn't (or vice versa)", () => {
  const items = [{ type: "organic", domain: "www.example.com", url: "https://www.example.com/x", rank_absolute: 7 }];
  assert.equal(findRank(items, "example.com").position, 7);
});

test("not present in the results is a real null, not a thrown error", () => {
  const items = [{ type: "organic", domain: "someone-else.com", url: "https://someone-else.com", rank_absolute: 1 }];
  const out = findRank(items, "example.com");
  assert.equal(out.position, null);
  assert.equal(out.url, null);
});

test("a paid/featured-snippet/non-organic item is never matched, even at the target domain", () => {
  const items = [{ type: "paid", domain: "example.com", url: "https://example.com/ad", rank_absolute: 1 }];
  const out = findRank(items, "example.com");
  assert.equal(out.position, null);
});

test("an empty items list is a clean null, not a throw", () => {
  assert.deepEqual(findRank([], "example.com"), { position: null, url: null });
});

test("falls back to parsing the domain out of the item's url when it has no domain field", () => {
  const items = [{ type: "organic", url: "https://example.com/page", rank_absolute: 12 }];
  assert.equal(findRank(items, "example.com").position, 12);
});
