/** Run: cd agent-server && npx tsx --test src/lib/blueprint.test.ts
 *
 *  The brief Mr. Writer writes from, now that it carries the business (§25.3). Two things are
 *  being protected here and they pull against each other:
 *
 *    · WITH a Site Brain, the brief must name what they sell, with the real URLs, under the
 *      rule that the proof list is the only set of facts about the business the writer may
 *      state — otherwise the article invents a certification;
 *    · WITHOUT one, the brief must be exactly what it was before, byte for byte, because a
 *      tenant whose analyst has not run must not get a worse article than they got yesterday.
 *
 *  Nothing here touches the network or the database. */
import { test } from "node:test";
import assert from "node:assert/strict";

// Same env-then-dynamic-import dance as dedupe.test.ts and siteProfile.test.ts: blueprint.ts
// now imports siteProfile.ts, which imports the Supabase client, whose env.ts throws on a
// missing DATABASE_URL. Placeholders first, module second. Only pure functions are called.
process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { buildBlueprint, matchOfferings, nearestCluster } = await import("./blueprint.js");
const { emptyProfile } = await import("./siteProfile.js");
type Research = import("./blueprint.js").Research;
type SiteProfile = import("./siteProfile.js").SiteProfile;

function iso(): SiteProfile {
  return {
    ...emptyProfile(),
    what_they_do: "ISO certification consultancy — 9001, 14001 and 27001 audits, documentation and training.",
    audience: "SME owners and quality managers",
    offerings: [
      { name: "ISO 9001 certification", url: "https://x.test/services/iso-9001", kind: "service" },
      { name: "ISO 27001 gap audit", url: "https://x.test/services/iso-27001-gap-audit", kind: "service" },
      { name: "Internal auditor training", url: "https://x.test/training", kind: "service" },
    ],
    proof: [{ claim: "IRCA-registered lead auditors", quote: "our IRCA-registered lead auditors", url: "https://x.test/about" }],
    topic_clusters: [
      { name: "ISO 27001 and infosec", page_urls: ["https://x.test/services/iso-27001-gap-audit", "https://x.test/blog/isms-scope"], centroid: null, size: 5 },
      { name: "training", page_urls: ["https://x.test/training"], centroid: null, size: 2 },
    ],
    voice: { tone: "formal, no hype", do: ["use we"], dont: ["no superlatives"], samples: [] },
    geo: "India and UAE",
  };
}

function research(over: Partial<Research> = {}): Research {
  return {
    topic: "iso 27001 cost",
    source: "autocomplete",
    seedSearchVolume: null,
    seedCompetition: null,
    relatedKeywords: [{ keyword: "iso 27001 cost india", searchVolume: null }],
    providerError: null,
    ownSearchConsole: [],
    ...over,
  };
}

// ── the no-profile promise ──────────────────────────────────────────────────────────────────

test("no profile: the brief is exactly what it was before — not one extra line", () => {
  const before = buildBlueprint("iso 27001 cost", research());
  for (const passed of [buildBlueprint("iso 27001 cost", research(), null), buildBlueprint("iso 27001 cost", research(), undefined)]) {
    assert.equal(passed, before, "passing null/undefined must be identical to passing nothing");
  }
  for (const absent of ["SITE BRAIN", "CALL TO ACTION", "INTERNAL LINKS", "PROVEN FACTS"]) {
    assert.ok(!before.includes(absent), `"${absent}" must not appear without a profile`);
  }
  // And the parts that were always there are still there.
  assert.match(before, /^Primary keyword: iso 27001 cost/);
  assert.match(before, /Structure: open by answering the primary keyword directly/);
});

test("an empty profile is the same as no profile", () => {
  assert.equal(buildBlueprint("iso 27001 cost", research(), emptyProfile()), buildBlueprint("iso 27001 cost", research()));
});

// ── the business, in the brief ──────────────────────────────────────────────────────────────

test("the brief names what they do, what they sell, and the URLs that sell it", () => {
  const b = buildBlueprint("iso 27001 cost", research(), iso());

  assert.match(b, /SITE BRAIN/);
  assert.match(b, /WHAT THIS BUSINESS DOES: ISO certification consultancy/);
  assert.match(b, /Location\/service area: India and UAE/);
  // The offering list, with its real URL — not a description of an offering.
  assert.match(b, /- ISO 27001 gap audit \(service\) — https:\/\/x\.test\/services\/iso-27001-gap-audit/);
  assert.match(b, /Tone: formal, no hype/);
});

test("the proof rule survives into the brief: these facts and no others", () => {
  const b = buildBlueprint("iso 27001 cost", research(), iso());
  assert.match(b, /PROVEN FACTS you may state\. These are the ONLY facts about this business you may use/);
  assert.match(b, /- IRCA-registered lead auditors \[https:\/\/x\.test\/about\]/);
});

test("the call to action is a real offering with a real URL, never a generic contact-us", () => {
  const b = buildBlueprint("iso 27001 cost", research(), iso());
  assert.match(b, /CALL TO ACTION/);
  // "iso 27001 cost" shares "iso" and "27001" with the gap-audit offering and only "iso" with
  // the 9001 one, so the gap audit has to win.
  assert.match(b, /- ISO 27001 gap audit — link the closing call to action to https:\/\/x\.test\/services\/iso-27001-gap-audit/);
  // "contact us" appears twice and both are PROHIBITIONS. Every occurrence must be one.
  for (const line of b.split("\n").filter((l) => /contact us/i.test(l))) {
    assert.match(line, /never a generic/i, `"contact us" appears as something other than a prohibition: ${line}`);
  }
});

test("a keyword that matches nothing still gets a real offering, not a blank", () => {
  // The moment a generic "contact us" would otherwise creep back in.
  const b = buildBlueprint("how to motivate a team", research({ topic: "how to motivate a team" }), iso());
  assert.match(b, /CALL TO ACTION/);
  assert.match(b, /- ISO 9001 certification — link the closing call to action to https:\/\/x\.test\/services\/iso-9001/);
});

test("an offering with no URL is named in words and never given an invented link", () => {
  const profile: SiteProfile = {
    ...emptyProfile(),
    offerings: [{ name: "On-site readiness workshop", url: null, kind: "service" }],
  };
  const b = buildBlueprint("readiness workshop", research({ topic: "readiness workshop" }), profile);
  assert.match(b, /- On-site readiness workshop — no page URL is on file for it, so name it in words and do NOT invent a link/);
});

test("internal links come from the keyword's own topic cluster, by exact URL", () => {
  const b = buildBlueprint("iso 27001 cost", research(), iso());
  assert.match(b, /INTERNAL LINKS — these pages are the same topic area \("ISO 27001 and infosec"\)/);
  assert.match(b, /- https:\/\/x\.test\/blog\/isms-scope/);
  assert.match(b, /Do not invent a URL that is not listed here/);
  // The training cluster is a different subject and must not be offered as "the same area".
  assert.ok(!b.includes('same topic area ("training")'));
});

// ── the honesty notes that were already there ───────────────────────────────────────────────

test("adding the business does not weaken the source-honesty notes", () => {
  const ai = buildBlueprint(
    "iso 27001 cost",
    research({ source: "ai", providerError: "DataForSEO not configured (paid provider — optional)" }),
    iso()
  );
  assert.match(ai, /AI-suggested customer questions, NOT measured search volumes/);
  assert.match(ai, /Do not state or imply/);

  const gsc = buildBlueprint(
    "iso 27001 cost",
    research({ source: "gsc", relatedKeywords: [{ keyword: "iso 27001 cost", searchVolume: null, impressions: 340, position: 14.2 }] }),
    iso()
  );
  assert.match(gsc, /Impressions are how often Google showed this site, NOT how many people search per month/);
});

test("site-context phrasings are printed as phrasings, under their own heading, with no number", () => {
  const b = buildBlueprint(
    "iso 27001",
    research({ topic: "iso 27001", siteContextQueries: ["iso 27001 certification cost india", "iso 27001 gap audit dubai"] }),
    iso()
  );
  assert.match(b, /HOW THIS BUSINESS'S OWN CUSTOMERS PHRASE IT/);
  assert.match(b, /phrasings, NOT measured demand; there is no volume figure for any of them/);
  assert.match(b, /- iso 27001 certification cost india/);
  // No fabricated volume anywhere near them.
  assert.ok(!/iso 27001 certification cost india \(\d/.test(b));
});

test("a measured volume is still printed as a measured volume", () => {
  const b = buildBlueprint(
    "iso 27001 cost",
    research({
      source: "dataforseo",
      seedSearchVolume: 880,
      relatedKeywords: [
        { keyword: "iso 27001 cost", searchVolume: 880, competitionLevel: "LOW" },
        { keyword: "iso 27001 price india", searchVolume: 210, competitionLevel: "MEDIUM" },
      ],
    }),
    iso()
  );
  assert.match(b, /Average monthly searches: 880/);
  assert.match(b, /- iso 27001 price india \(210\/mo\)/);
});

// ── the two matchers ────────────────────────────────────────────────────────────────────────

test("matchOfferings ranks by shared words and falls back rather than returning nothing", () => {
  assert.deepEqual(matchOfferings("internal auditor training course", iso(), 3).map((o) => o.name), ["Internal auditor training"]);
  assert.deepEqual(matchOfferings("iso 9001 documentation", iso(), 1).map((o) => o.name), ["ISO 9001 certification"]);
  // No overlap at all: the first offering, so a CTA always has something real to point at.
  assert.deepEqual(matchOfferings("gardening tips", iso(), 3).map((o) => o.name), ["ISO 9001 certification"]);
  // Nothing to match against is still nothing — no invented offering.
  assert.deepEqual(matchOfferings("anything", emptyProfile(), 3), []);
  assert.deepEqual(matchOfferings("anything", null, 3), []);
});

test("nearestCluster matches on the cluster's pages as well as its name, and admits when it cannot", () => {
  assert.equal(nearestCluster("iso 27001 cost", iso())?.name, "ISO 27001 and infosec");
  assert.equal(nearestCluster("internal auditor training", iso())?.name, "training");
  // A keyword sharing nothing with any cluster gets no link suggestion at all — better than a
  // confidently wrong one.
  assert.equal(nearestCluster("gardening tips", iso()), null);
  assert.equal(nearestCluster("anything", emptyProfile()), null);
  assert.equal(nearestCluster("anything", null), null);
});
