/** Run: cd agent-server && npx tsx --test src/lib/leads/icp.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

// icp.ts imports only TYPES from siteProfile.ts, so nothing here reaches env.ts, Supabase or the
// network — but the placeholders go in first anyway (the lib/dedupe.test.ts pattern), so that
// adding one value import later fails loudly in the test rather than mysteriously at runtime.
process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { buildIcp, parseQuery, describeIcp, searchTermsFor, MAX_COUNT } = await import("./icp.js");
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
