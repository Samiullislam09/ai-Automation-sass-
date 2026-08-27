/** Run: cd agent-server && npx tsx --test src/agents/keyword.test.ts
 *
 *  §25.3 — Mr. Keyword reading the site. The product owner's sentence is the spec: "agar
 *  website health ke upar hai to mr keyword health ke upar pehle website ka samjhe kya aur kis
 *  tarha ka content hai, fir us tarha ke keyword nikale."
 *
 *  Three behaviours are pinned here, plus the one that matters most — that NONE of them fire
 *  when there is no profile, so a tenant whose analyst has not run gets yesterday's agent.
 *
 *  No database and no network: every function under test is pure or takes its expensive
 *  dependency (the embedder, the LLM) as an injected argument. */
import { test } from "node:test";
import assert from "node:assert/strict";

// keyword.ts reaches supabase/pg-boss through its imports, and env.ts throws on a missing
// DATABASE_URL. Placeholders first, dynamic import second — same trick as dedupe.test.ts.
process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const {
  chooseSeed,
  resolveSeed,
  profileIsThin,
  scoreFitAgainstSite,
  gscOpportunityFor,
  expandInSiteContext,
  profileNote,
  FIT_MIN_SCORE,
  FIT_MAX_EMBEDDINGS,
} = await import("./keyword.js");
const { emptyProfile } = await import("../lib/siteProfile.js");

type SiteProfile = import("../lib/siteProfile.js").SiteProfile;
type Related = import("../lib/blueprint.js").Related;
type SiteInsights = import("../lib/insights.js").SiteInsights;

// ── a health site, in four readable dimensions ──────────────────────────────────────────────
// Real embeddings are 1024-dim; the maths is identical at 4, and at 4 a human can read the
// test and check the arithmetic by hand. The axes are [clinical, nutrition, money, unknown] —
// "money" is orthogonal to both of the site's subjects, which is exactly the situation the fit
// score exists for, and "unknown" is where anything we have never seen lands.
const HEALTH: Record<string, number[]> = {
  "diabetes diet plan": [0.7, 0.7, 0, 0],
  "blood sugar monitoring": [0.98, 0.2, 0, 0],
  "type 2 diabetes symptoms": [0.99, 0.1, 0, 0],
  "crypto tax": [0, 0, 1, 0],
  "best crypto exchange": [0, 0.05, 0.998, 0],
};

function healthSite(over: Partial<SiteProfile> = {}): SiteProfile {
  return {
    ...emptyProfile(),
    what_they_do: "A diabetes clinic — screening, diet counselling and long-term monitoring.",
    audience: "adults recently diagnosed with type 2 diabetes",
    geo: "Pune",
    offerings: [{ name: "Diabetes screening", url: "https://h.test/screening", kind: "service" }],
    topic_clusters: [
      // Both centroids sit at zero on the money and unknown axes, so a crypto keyword and a
      // phrase we have never seen both score 0 against the whole site.
      { name: "diabetes care", page_urls: ["https://h.test/screening"], centroid: [1, 0, 0, 0], size: 6 },
      { name: "nutrition", page_urls: ["https://h.test/diet"], centroid: [0.8, 0.6, 0, 0], size: 3 },
    ],
    content_gaps: [
      { query: "diabetes diet plan indian", impressions: 340, position: 14.2, nearest_similarity: 0.41, nearest_url: "https://h.test/diet", nearest_cluster: "nutrition" },
      { query: "hba1c normal range", impressions: 120, position: 18.0, nearest_similarity: 0.5, nearest_url: null, nearest_cluster: null },
    ],
    ...over,
  };
}

/** A stand-in embedder. Anything not in the table lands on the "unknown" axis and therefore
 *  scores 0 against both clusters — the honest default for a phrase we have never seen. */
async function fakeEmbed(text: string): Promise<number[]> {
  const v = HEALTH[text.trim().toLowerCase()];
  if (v) return [...v];
  return [0, 0, 0, 1];
}

function related(...keywords: string[]): Related[] {
  return keywords.map((k) => ({ keyword: k, searchVolume: null }));
}

// ── 1 · seeding from the site ───────────────────────────────────────────────────────────────

test("no topic, no profile: the old error, word for word", () => {
  // Everything downstream (and every log a support person has read for months) knows this
  // sentence. Seeding from the site is an ADDITION, not a change to what happens without one.
  assert.throws(() => resolveSeed(undefined, null), /keyword job needs a 'topic' string/);
  assert.throws(() => resolveSeed("   ", null), /keyword job needs a 'topic' string/);
  assert.throws(() => resolveSeed(null, emptyProfile()), /keyword job needs a 'topic' string/);
});

test("a topic that was given always wins — we expand the user's words, never replace them", () => {
  const r = resolveSeed("  ISO 27001  ", healthSite());
  assert.equal(r.topic, "ISO 27001");
  assert.equal(r.seed, null, "a given topic is not a seed and must not be reported as one");
});

test("no topic, with a profile: the first seed is a content gap, and it says why", () => {
  const seed = chooseSeed(healthSite(), 0);
  assert.ok(seed);
  assert.equal(seed!.keyword, "diabetes diet plan indian");
  assert.equal(seed!.from, "content_gap");
  // The "why this" column: a measured number and a measured hole, in a sentence an owner reads.
  assert.match(seed!.why, /Google already shows your site for "diabetes diet plan indian" — 340 times/);
  assert.match(seed!.why, /no page on your site answers it/);
});

test("gaps come in impression order, then the rotation carries on into the clusters", () => {
  const p = healthSite();
  assert.equal(chooseSeed(p, 0)!.keyword, "diabetes diet plan indian"); // 340 impressions
  assert.equal(chooseSeed(p, 1)!.keyword, "hba1c normal range"); // 120
  // Gaps exhausted — now every cluster gets its turn, biggest first.
  assert.equal(chooseSeed(p, 2)!.from, "topic_cluster");
  assert.equal(chooseSeed(p, 2)!.keyword, "diabetes care");
  assert.equal(chooseSeed(p, 3)!.keyword, "nutrition");
  // And it wraps rather than running out.
  assert.equal(chooseSeed(p, 4)!.keyword, chooseSeed(p, 0)!.keyword);
  assert.match(chooseSeed(p, 3)!.why, /this run's turn in the rotation/);
});

test("a profile with clusters but no gaps rotates the clusters from the start", () => {
  const p = healthSite({ content_gaps: [] });
  assert.equal(chooseSeed(p, 0)!.from, "topic_cluster");
  assert.equal(chooseSeed(p, 0)!.keyword, "diabetes care");
});

test("nothing to seed from is null, not a guess", () => {
  assert.equal(chooseSeed(null, 0), null);
  assert.equal(chooseSeed(emptyProfile(), 0), null);
  assert.equal(chooseSeed(healthSite({ content_gaps: [], topic_clusters: [] }), 0), null);
});

test("a nonsense rotation offset cannot crash the seed picker", () => {
  for (const offset of [-5, 1e9, NaN, Infinity]) {
    assert.ok(chooseSeed(healthSite(), offset), `offset ${offset} produced no seed`);
  }
});

// ── thin profiles ───────────────────────────────────────────────────────────────────────────

test("a profile that says nothing useful counts as no profile", () => {
  assert.equal(profileIsThin(null), true);
  assert.equal(profileIsThin(emptyProfile()), true);
  // Clusters with no centroids cannot be scored against, and nothing else is filled in.
  assert.equal(
    profileIsThin({ ...emptyProfile(), topic_clusters: [{ name: "x", page_urls: [], centroid: null, size: 1 }] }),
    true
  );
  assert.equal(profileIsThin(healthSite()), false);
});

// ── 2 · expanding a topic in the site's context ─────────────────────────────────────────────

test("expansion asks in the site's own terms and returns phrasings only", async () => {
  let prompt = "";
  const queries = await expandInSiteContext("diet plan", healthSite(), async (p: string) => {
    prompt = p;
    return { queries: ["diabetes diet plan pune", "indian diet chart for diabetics", "diet plan"] };
  });

  // What the model was told about this business — this is the whole point of the call.
  assert.match(prompt, /A diabetes clinic — screening, diet counselling/);
  assert.match(prompt, /Where they work: Pune/);
  assert.match(prompt, /Diabetes screening/);
  assert.match(prompt, /do NOT invent a service, product, price, certificate or location/);

  // The topic itself is not an expansion of itself.
  assert.deepEqual(queries, ["diabetes diet plan pune", "indian diet chart for diabetics"]);
});

test("expansion output is capped, deduped and never absurdly long", async () => {
  const queries = await expandInSiteContext("diet", healthSite(), async () => ({
    queries: ["a diet plan", "A DIET PLAN", "b", "c", "d", "e", "f", "g", "x".repeat(200), ""],
  }));
  assert.ok(queries.length <= 6, `${queries.length} queries came back`);
  assert.equal(new Set(queries.map((q: string) => q.toLowerCase())).size, queries.length, "duplicates survived");
  assert.ok(queries.every((q: string) => q.length <= 90));
});

// ── 3 · the fit score ───────────────────────────────────────────────────────────────────────

test("a health site does not return crypto tax", async () => {
  const fit = await scoreFitAgainstSite(
    related("diabetes diet plan", "crypto tax", "blood sugar monitoring", "best crypto exchange"),
    healthSite(),
    { embedFn: fakeEmbed }
  );

  assert.deepEqual(fit.kept.map((r) => r.keyword), ["diabetes diet plan", "blood sugar monitoring"]);
  assert.deepEqual(fit.dropped.map((d) => d.keyword), ["crypto tax", "best crypto exchange"]);
  assert.equal(fit.scored, 4);
  assert.equal(fit.available, true);
  assert.equal(fit.error, null);

  // Every survivor carries its number AND the subject it matched — which is the whole "why
  // this" column: a diet plan belongs to nutrition, a glucose meter to diabetes care.
  for (const r of fit.kept) {
    assert.ok(typeof r.fitScore === "number" && r.fitScore! >= FIT_MIN_SCORE, `${r.keyword} kept with fit ${r.fitScore}`);
  }
  assert.equal(fit.kept.find((r) => r.keyword === "diabetes diet plan")!.fitCluster, "nutrition");
  assert.equal(fit.kept.find((r) => r.keyword === "blood sugar monitoring")!.fitCluster, "diabetes care");
  // And every drop can be explained to the user without opening the source.
  const crypto = fit.dropped[0];
  assert.ok(crypto.fitScore < FIT_MIN_SCORE);
  assert.match(crypto.why, /Not what this site is about/);
  assert.match(crypto.why, /anything under 0\.45 is a different business's keyword/);
});

test("the keyword the user typed is never deleted, whatever the maths says", async () => {
  // They asked for it by name. A tool that silently drops what you typed is broken.
  const fit = await scoreFitAgainstSite(related("crypto tax", "best crypto exchange"), healthSite(), {
    embedFn: fakeEmbed,
    protect: ["crypto tax"],
  });
  assert.deepEqual(fit.kept.map((r) => r.keyword), ["crypto tax"]);
  assert.deepEqual(fit.dropped.map((d) => d.keyword), ["best crypto exchange"]);
  // Kept, but honestly scored — the low number is still on the row.
  assert.ok(fit.kept[0].fitScore! < FIT_MIN_SCORE);
});

test("no profile, no clusters, no centroids: nothing is scored and nothing is dropped", async () => {
  for (const profile of [null, emptyProfile(), healthSite({ topic_clusters: [{ name: "x", page_urls: [], centroid: null, size: 2 }] })]) {
    const fit = await scoreFitAgainstSite(related("crypto tax", "diabetes diet plan"), profile, { embedFn: fakeEmbed });
    assert.equal(fit.available, false);
    assert.equal(fit.dropped.length, 0, "a candidate must never be dropped by a measurement that did not happen");
    assert.deepEqual(fit.kept.map((r) => r.keyword), ["crypto tax", "diabetes diet plan"]);
    assert.equal(fit.scored, 0);
  }
});

test("past the embedding cap candidates are unscored and KEPT, never dropped", async () => {
  let calls = 0;
  const counting = async (t: string) => { calls++; return fakeEmbed(t); };
  const fit = await scoreFitAgainstSite(related("diabetes diet plan", "crypto tax", "best crypto exchange"), healthSite(), {
    embedFn: counting,
    cap: 2,
  });

  assert.equal(calls, 2, "the cap must actually stop the calls, not just the scoring");
  assert.equal(fit.capped, true);
  assert.equal(fit.scored, 2);
  // "crypto tax" was inside the cap and dropped; "best crypto exchange" was past it and
  // survives unscored — we did not measure it, so we cannot say it is off topic.
  assert.deepEqual(fit.dropped.map((d) => d.keyword), ["crypto tax"]);
  const survivor = fit.kept.find((r) => r.keyword === "best crypto exchange");
  assert.ok(survivor);
  assert.equal(survivor!.fitScore, null);
  assert.equal(survivor!.fitCluster, null);
});

test("the default cap is the documented one", async () => {
  let calls = 0;
  const many = related(...Array.from({ length: 40 }, (_, i) => `keyword ${i}`));
  const fit = await scoreFitAgainstSite(many, healthSite(), {
    embedFn: async (t) => { calls++; return fakeEmbed(t); },
    // Everything here embeds to the "unknown" axis, which scores 0 — protect them all so the
    // test measures the cap and not the threshold.
    protect: many.map((r) => r.keyword),
  });
  assert.equal(calls, FIT_MAX_EMBEDDINGS);
  assert.equal(fit.kept.length, 40, "capping must not lose candidates");
});

test("an embedding failure costs the score, never the run and never a candidate", async () => {
  const fit = await scoreFitAgainstSite(related("diabetes diet plan", "crypto tax"), healthSite(), {
    embedFn: async () => { throw new Error("NVIDIA_API_KEY missing"); },
  });
  assert.equal(fit.available, false);
  assert.equal(fit.dropped.length, 0);
  assert.equal(fit.kept.length, 2);
  assert.equal(fit.error, "NVIDIA_API_KEY missing");
  assert.ok(fit.kept.every((r) => r.fitScore === null));
});

test("a profile built by a different embedding model is ignored, not misread", async () => {
  // A 2-dim vector against 4-dim centroids: comparing them would produce a confident nonsense
  // number. Unscored and kept is the only honest answer.
  const fit = await scoreFitAgainstSite(related("crypto tax"), healthSite(), { embedFn: async () => [0.1, 0.2] });
  assert.equal(fit.dropped.length, 0);
  assert.equal(fit.kept[0].fitScore, null);
});

test("site-context candidates ride the same pass and keep their flag", async () => {
  const fit = await scoreFitAgainstSite(
    [{ keyword: "diabetes diet plan", searchVolume: null, fromSiteContext: true }, { keyword: "crypto tax", searchVolume: null }],
    healthSite(),
    { embedFn: fakeEmbed }
  );
  assert.equal(fit.kept.length, 1);
  assert.equal(fit.kept[0].fromSiteContext, true);
});

// ── the third column: Search Console ────────────────────────────────────────────────────────

function insights(over: Partial<SiteInsights> = {}): SiteInsights {
  return {
    connected: true,
    period: { start: "2026-07-01", end: "2026-07-31" },
    winning: [],
    strikingDistance: [{ query: "blood sugar monitoring", clicks: 3, impressions: 900, position: 11.4 }],
    missed: [],
    topPages: [],
    traffic: null,
    location: null,
    ...over,
  };
}

test("the GSC opportunity is its own column, from a measured source, named", () => {
  const gap = gscOpportunityFor("Diabetes Diet Plan Indian", insights(), healthSite());
  assert.deepEqual(gap, { query: "diabetes diet plan indian", impressions: 340, position: 14.2, clicks: null, from: "content-gap" });

  const striking = gscOpportunityFor("blood sugar monitoring", insights(), healthSite());
  assert.deepEqual(striking, { query: "blood sugar monitoring", impressions: 900, position: 11.4, clicks: 3, from: "striking-distance" });
});

test("no measurement means null — one query's impressions are never lent to another", () => {
  assert.equal(gscOpportunityFor("diabetes diet", insights(), healthSite()), null, "a near-miss must not borrow the gap's 340");
  assert.equal(gscOpportunityFor("crypto tax", insights(), healthSite()), null);
  assert.equal(gscOpportunityFor("", insights(), healthSite()), null);
  assert.equal(gscOpportunityFor("blood sugar monitoring", null, null), null);
});

test("fit and GSC opportunity stay separable — a keyword can have one and not the other", async () => {
  const fit = await scoreFitAgainstSite(related("type 2 diabetes symptoms"), healthSite(), { embedFn: fakeEmbed });
  const row = fit.kept[0];
  assert.ok(row.fitScore! > FIT_MIN_SCORE, "it fits the site");
  assert.equal(gscOpportunityFor(row.keyword, insights(), healthSite()), null, "and has no Search Console history");
});

// ── the receipt ─────────────────────────────────────────────────────────────────────────────

test("the note tells a business owner what happened and what to do about it", async () => {
  const none = profileNote(null, true, { kept: [], dropped: [], scored: 0, capped: false, available: false, error: null });
  assert.match(none, /Site crawl \+ analysis chalao/);

  const thin = profileNote(emptyProfile(), true, { kept: [], dropped: [], scored: 0, capped: false, available: false, error: null });
  assert.match(thin, /Settings → Site Brain/);

  const fit = await scoreFitAgainstSite(related("diabetes diet plan", "crypto tax"), healthSite(), { embedFn: fakeEmbed });
  const used = profileNote(healthSite(), false, fit);
  assert.match(used, /2 keyword check kiye/);
  assert.match(used, /1 jo aapke business ke baare me nahi the wo hata diye/);
});
