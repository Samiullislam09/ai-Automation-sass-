/** Run: cd agent-server && npx tsx --test src/lib/leads/icp.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

// icp.ts imports only TYPES from siteProfile.ts, so nothing here reaches env.ts, Supabase or the
// network — but the placeholders go in first anyway (the lib/dedupe.test.ts pattern), so that
// adding one value import later fails loudly in the test rather than mysteriously at runtime.
process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { buildIcp, buildIcpFromBuyerSegment, parseQuery, describeIcp, searchTermsFor, MAX_COUNT } = await import("./icp.js");
type SiteProfile = import("../siteProfile.js").SiteProfile;

function profileFixture(over: Partial<SiteProfile> = {}): SiteProfile {
  return {
    what_they_do: "We write SEO articles for independent restaurants.",
    offerings: [{ name: "Monthly article plan", url: "https://mrlxwa.com/plans", kind: "service" }],
    audience: "independent restaurants and cafes",
    buyer_intent: [],
    proof: [{ claim: "ISO 9001 certified", quote: "We are ISO 9001 certified", url: "https://mrlxwa.com/about" }],
    topic_clusters: [],
    content_gaps: [],
    voice: null,
    geo: "Dubai",
    language: "en",
    competitors: [],
    goals: null,
    confidence: {},
    sources: {},
    ...over,
  } as SiteProfile;
}

// ── ICP from a confirmed buyer segment (Phase 2) ──────────────────────────────────────────────

test("buildIcpFromBuyerSegment: the segment's own terms become the queries (buyers, not peers)", () => {
  const result = buildIcpFromBuyerSegment({
    segment: { name: "Manufacturers", search_terms: ["manufacturers", "factories", "exporters"] },
    geoScope: ["UAE"],
    profile: profileFixture(),
    count: 10,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.icp.industry, "Manufacturers");
  assert.equal(result.icp.geo, "UAE");
  // each term tied to the geo once, capped
  assert.deepEqual(result.icp.searchTerms, ["manufacturers in UAE", "factories in UAE", "exporters in UAE"]);
  // the offering/proof still come from the Site Brain, for the pitch
  assert.equal(result.icp.offering.length, 1);
  assert.ok(result.icp.evidence.some((e) => e.field === "buyer_segment" && e.value === "Manufacturers"));
});

test("buildIcpFromBuyerSegment: an explicit city overrides the buyer profile's geo_scope", () => {
  const result = buildIcpFromBuyerSegment({
    segment: { name: "Hotels", search_terms: ["hotels"] },
    geoScope: ["UAE"],
    profile: profileFixture(),
    geoOverride: "Dubai Marina",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.icp.geo, "Dubai Marina");
  assert.deepEqual(result.icp.searchTerms, ["hotels in Dubai Marina"]);
  assert.ok(result.icp.evidence.some((e) => e.field === "geo" && e.from === "user-query"));
});

test("buildIcpFromBuyerSegment: queries are capped to protect the Serper quota", () => {
  const result = buildIcpFromBuyerSegment({
    segment: { name: "X", search_terms: ["a", "b", "c", "d", "e", "f"] },
    geoScope: [],
    profile: profileFixture({ geo: null }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.icp.searchTerms.length <= 4, "no more than 4 queries per run");
  // no geo anywhere → bare terms
  assert.deepEqual(result.icp.searchTerms, ["a", "b", "c"]);
});

test("buildIcpFromBuyerSegment: a segment with no terms asks rather than searching", () => {
  const result = buildIcpFromBuyerSegment({ segment: { name: "Empty", search_terms: [] }, geoScope: ["UAE"], profile: profileFixture() });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.question, /no search terms/i);
});

// ── no profile, no query ────────────────────────────────────────────────────────────────────

test("with neither a profile nor a query it asks, rather than guessing an ICP", () => {
  const result = buildIcp({});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.missing, ["industry", "geo", "offering"]);
  assert.match(result.question, /I need to know who you are looking for/i);
  // The failure carries no ICP at all — there is no half-built object to accidentally use.
  assert.equal((result as any).icp, undefined);
});

test("an empty profile is the same as no profile — an empty string is not an ICP", () => {
  const result = buildIcp({ profile: profileFixture({ audience: null, geo: null, offerings: [], proof: [] }), query: "   " });
  assert.equal(result.ok, false);
});

// ── profile only ────────────────────────────────────────────────────────────────────────────

test("with a Site Brain and no query, the ICP is read off the profile and says so", () => {
  const result = buildIcp({ profile: profileFixture() });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.icp.industry, "independent restaurants and cafes");
  assert.equal(result.icp.geo, "Dubai");
  assert.equal(result.icp.kind, "local");
  assert.equal(result.icp.offering.length, 1);
  assert.equal(result.icp.proof.length, 1);

  // Every field says where it came from — the same discipline as siteProfile.sources.
  const from = Object.fromEntries(result.icp.evidence.map((e) => [e.field, e.from]));
  assert.equal(from.industry, "site-brain");
  assert.equal(from.geo, "site-brain");
  assert.equal(result.warnings.length, 0);
});

test("no offering on file is a warning on the ICP, not an invented product", () => {
  const result = buildIcp({ profile: profileFixture({ offerings: [], proof: [] }), query: "restaurants in Dubai" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.icp.offering, []);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /ask a question rather than pitch/i);
  assert.match(result.warnings[1], /may not state any credential/i);
});

// ── the query ───────────────────────────────────────────────────────────────────────────────

test("parses the Hinglish order: 'Dubai ke 20 restaurant leads dhundo'", () => {
  const parsed = parseQuery("Dubai ke 20 restaurant leads dhundo");
  assert.equal(parsed.geo, "Dubai");
  assert.equal(parsed.count, 20);
  assert.equal(parsed.industry, "restaurant");
  assert.deepEqual(parsed.sizeSignals, []);
});

test("parses the English order, and a size phrase is never read as the count", () => {
  const parsed = parseQuery("find 15 dentists in Manchester with 10+ staff");
  assert.equal(parsed.geo, "Manchester");
  assert.equal(parsed.count, 15);
  assert.equal(parsed.industry, "dentists");
  assert.equal(parsed.sizeSignals.length, 1);
  assert.equal(parsed.sizeSignals[0].min, 10);
  assert.equal(parsed.sizeSignals[0].unit, "staff");
});

test("a query with no place is a valid ICP with no geography — not a guessed one", () => {
  const result = buildIcp({ profile: null, query: "find logistics companies" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.icp.geo, null);
  assert.equal(result.icp.kind, "b2b");
  assert.equal(result.icp.industry, "logistics companies");
});

test("what the user typed now beats what the Site Brain remembers", () => {
  const result = buildIcp({ profile: profileFixture(), query: "hotels in Sharjah" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.icp.industry, "hotels");
  assert.equal(result.icp.geo, "Sharjah");
  const from = Object.fromEntries(result.icp.evidence.map((e) => [e.field, e.from]));
  assert.equal(from.industry, "user-query");
  assert.equal(from.geo, "user-query");
  // …but the tenant's own offering and proof still come from the brain: the user changed who
  // we are looking for, not who we are.
  assert.equal(result.icp.offering[0].name, "Monthly article plan");
});

test("count is clamped to what one run can pay for, and says so", () => {
  const result = buildIcp({ profile: profileFixture(), query: "restaurants in Dubai", count: 500 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.icp.count, MAX_COUNT);
  assert.match(result.warnings.join(" "), new RegExp(`${MAX_COUNT} is the most one run will do`));
});

test("local vs b2b is decided by the vertical first, the geography second", () => {
  const local = buildIcp({ query: "salons" });
  const b2b = buildIcp({ query: "saas companies" });
  const byGeo = buildIcp({ query: "packaging suppliers in Pune" });
  assert.equal(local.ok && local.icp.kind, "local");
  assert.equal(b2b.ok && b2b.icp.kind, "b2b");
  // "suppliers" is a B2B vertical even though a town was named — the vertical wins.
  assert.equal(byGeo.ok && byGeo.icp.kind, "b2b");
});

test("search terms are most-specific first, and never empty", () => {
  assert.deepEqual(searchTermsFor("restaurant", "Dubai"), ["restaurant in Dubai", "restaurant Dubai", "restaurant"]);
  assert.deepEqual(searchTermsFor("logistics", null), ["logistics", "logistics companies"]);
});

test("describeIcp prints only fields that exist", () => {
  const withGeo = buildIcp({ query: "5 cafes in Lisbon" });
  const withoutGeo = buildIcp({ query: "5 saas companies" });
  assert.equal(withGeo.ok && describeIcp(withGeo.icp), "5 × cafes in Lisbon [local]");
  assert.equal(withoutGeo.ok && describeIcp(withoutGeo.icp), "5 × saas companies [b2b]");
});

/* ── "find me more leads" is a request, not a vertical (2026-10-06) ──────────────────────────
 *
 *  Four real runs on 2026-10-05 produced found:0, saved:0 from perfectly clear asks. The cause
 *  was here: "new" and "website" were not in NOISE, so "new leads for my website" parsed as the
 *  vertical "new website", the search went looking for businesses of that type, and the
 *  buyer-fit gate correctly threw every result away. The customer was told nothing was found.
 *
 *  These are the exact queries from `tasks.params` on that day.
 */

test("a pure request for leads yields no vertical, so the Site Brain is used instead", () => {
  for (const q of ["new leads", "new leads for my website", "businesses matching our ICP", "top 10 leads", "20 new leads", "generate new leads", "aur leads dhundo"]) {
    assert.equal(parseQuery(q).industry, null, `"${q}" is a request, not a kind of business`);
  }
});

test("a real vertical still survives the same words", () => {
  // The fix must not cost a genuine query its subject: something always remains.
  assert.equal(parseQuery("new car dealers in Dubai").industry, "car dealers");
  assert.equal(parseQuery("website design agencies").industry, "design agencies");
  assert.equal(parseQuery("restaurants in Dubai").industry, "restaurants");
  assert.equal(parseQuery("companies needing ISO certification consulting services").industry, "companies needing ISO certification consulting services");
});

test("the count is still read off a request that has no vertical", () => {
  // "20 new leads" must still mean twenty of them, even though the vertical comes from elsewhere.
  assert.equal(parseQuery("20 new leads").count, 20);
  assert.equal(parseQuery("top 10 leads").count, 10);
});

test("a request with no vertical falls through to the Site Brain's audience", () => {
  const icp = buildIcp({ profile: profileFixture({ audience: "dental clinics" }), query: "new leads for my website", count: 20 });
  assert.equal(icp.ok, true);
  if (icp.ok) {
    assert.match(describeIcp(icp.icp).toLowerCase(), /dental clinics/);
    assert.ok(
      icp.icp.evidence.some((e) => e.field === "industry" && e.from === "site-brain"),
      "the vertical must be recorded as coming from the Site Brain, not from the user's words",
    );
  }
});
