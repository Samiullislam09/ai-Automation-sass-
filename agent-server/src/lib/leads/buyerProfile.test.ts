/** Run: cd agent-server && npx tsx --test src/lib/leads/buyerProfile.test.ts
 *
 *  Proves the buyer-profile drafter's CODE rules hold whatever the model says — especially that a
 *  category listed as both a buyer and a competitor never survives on the buyer side, and that
 *  nothing is industry-specific: the same code, given two different Site Brains, produces two
 *  different profiles with no shared hardcoded word. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { draftBuyerProfile, validateDraft, buildDraftPrompt } = await import("./buyerProfile.js");
const { emptyProfile, buyerProfileReady, normalizeProfile } = await import("../siteProfile.js");

type SiteProfile = import("../siteProfile.js").SiteProfile;

function brain(over: Partial<SiteProfile>): SiteProfile {
  return { ...emptyProfile(), ...over };
}

const ISO_BRAIN = brain({
  what_they_do: "We help factories get ISO 9001 and ISO 22000 certified.",
  audience: "Manufacturers and food processors in the UAE",
  geo: "UAE",
  offerings: [{ name: "ISO 9001 certification consulting", url: null, kind: "service" }],
});

// What a well-behaved model returns for the ISO consultancy: buyers are factories; the peer set
// (other ISO consultants) is kept separate; and it (wrongly) repeats one buyer as a competitor to
// test that the code removes it from the buyer side.
const ISO_DRAFT = {
  offer: "ISO certification consulting for factories",
  lead_goal: "customer",
  buyer_segments: [
    { name: "Manufacturers", why_buy: "need ISO to win contracts", search_terms: ["manufacturers", "factories"], evidence_from: "WHO THEY SELL TO" },
    { name: "Food processors", why_buy: "need ISO 22000", search_terms: ["food processing company", "food manufacturers"], evidence_from: "WHAT THIS BUSINESS DOES" },
    { name: "ISO consultants", why_buy: "???", search_terms: ["iso consultant"], evidence_from: "x" }, // ALSO a competitor — must be dropped as a buyer
    { name: "Empty", why_buy: "no terms", search_terms: [], evidence_from: "x" }, // no terms — dropped
  ],
  competitor_segments: [
    { name: "ISO consultants", cues: ["iso consultant", "certification body"], evidence_from: "WHAT THIS BUSINESS DOES" },
  ],
  buying_signals: [
    { name: "No certification shown", look_for: "no ISO logo on their site", weight: 99, evidence_from: "WHAT THIS BUSINESS DOES" },
    { name: "", look_for: "x", weight: 3, evidence_from: "x" }, // no name — dropped
  ],
  geo_scope: ["UAE", "Dubai"],
};

const fakeLlm = (payload: unknown) => async (_prompt: string) => payload;

test("draftBuyerProfile: keeps buyers, drops a buyer that is also a competitor, drops empties", async () => {
  const res = await draftBuyerProfile(ISO_BRAIN, fakeLlm(ISO_DRAFT));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const bp = res.buyerProfile;

  const names = bp.buyer_segments.map((s) => s.name);
  assert.deepEqual(names, ["Manufacturers", "Food processors"]); // consultants + empty gone
  assert.ok(res.warnings.some((w) => /also listed as a competitor/i.test(w)));
  assert.ok(res.warnings.some((w) => /no search terms/i.test(w)));

  // competitor set stays, with its cues
  assert.equal(bp.competitor_segments.length, 1);
  assert.deepEqual(bp.competitor_segments[0].cues, ["iso consultant", "certification body"]);

  // signal weight clamped into 1..10, nameless signal dropped
  assert.equal(bp.buying_signals.length, 1);
  assert.equal(bp.buying_signals[0].weight, 10);

  // every kept item carries an evidence tag
  assert.ok(bp.buyer_segments.every((s) => s.evidence && s.evidence.from));

  // never auto-confirmed
  assert.equal(bp.confirmed, false);
  assert.equal(bp.drafted_by, "agent:buyer-profile");
});

test("buyer and competitor sets are DIFFERENT after validation (the core acceptance test)", () => {
  const { buyerProfile } = validateDraft(ISO_DRAFT, ISO_BRAIN);
  const buyers = new Set(buyerProfile.buyer_segments.map((s) => s.name.toLowerCase()));
  const comps = new Set(buyerProfile.competitor_segments.map((s) => s.name.toLowerCase()));
  for (const c of comps) assert.equal(buyers.has(c), false, `"${c}" must not be a buyer`);
});

test("nothing is hardcoded: a blog Site Brain yields a different, sponsor-shaped profile", async () => {
  const BLOG_BRAIN = brain({
    what_they_do: "A travel blog about budget backpacking in South-East Asia.",
    audience: "Young budget travellers",
    goals: { primary: "traffic", kpis: [], focus: [] },
  });
  const BLOG_DRAFT = {
    offer: "Sponsored posts and banner placement to a travel audience",
    lead_goal: "sponsor",
    buyer_segments: [
      { name: "Hostels", why_buy: "want bookings from backpackers", search_terms: ["hostels", "backpacker hostels"], evidence_from: "WHO THEY SELL TO" },
      { name: "Travel gear brands", why_buy: "reach travellers", search_terms: ["travel gear brand", "backpack brand"], evidence_from: "WHAT THIS BUSINESS DOES" },
    ],
    competitor_segments: [{ name: "Other travel blogs", cues: ["travel blog"], evidence_from: "WHAT THIS BUSINESS DOES" }],
    buying_signals: [{ name: "Runs ads", look_for: "advertises elsewhere", weight: 6, evidence_from: "WHO THEY SELL TO" }],
    geo_scope: [],
  };

  const res = await draftBuyerProfile(BLOG_BRAIN, fakeLlm(BLOG_DRAFT));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.buyerProfile.lead_goal, "sponsor");
  assert.deepEqual(res.buyerProfile.buyer_segments.map((s) => s.name), ["Hostels", "Travel gear brands"]);
  // the ISO profile and the blog profile share no buyer-segment name — proof the words come from data
  const isoRes = await draftBuyerProfile(ISO_BRAIN, fakeLlm(ISO_DRAFT));
  if (!isoRes.ok) return assert.fail("iso draft failed");
  const blogNames = new Set(res.buyerProfile.buyer_segments.map((s) => s.name.toLowerCase()));
  for (const n of isoRes.buyerProfile.buyer_segments.map((s) => s.name.toLowerCase())) {
    assert.equal(blogNames.has(n), false);
  }
});

test("geo_scope falls back to the Site Brain geo when the model gives none", () => {
  const { buyerProfile } = validateDraft({ ...ISO_DRAFT, geo_scope: [] }, ISO_BRAIN);
  assert.deepEqual(buyerProfile.geo_scope, ["UAE"]);
});

test("a thin Site Brain cannot be drafted from — it asks rather than guesses", async () => {
  const res = await draftBuyerProfile(emptyProfile(), fakeLlm(ISO_DRAFT));
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.reason, /Site Brain/i);
});

test("a draft with zero usable buyer segments is a failure, not an empty profile", async () => {
  const res = await draftBuyerProfile(ISO_BRAIN, fakeLlm({ ...ISO_DRAFT, buyer_segments: [] }));
  assert.equal(res.ok, false);
});

test("buyerProfileReady: false until confirmed AND a segment has a search term", () => {
  const { buyerProfile } = validateDraft(ISO_DRAFT, ISO_BRAIN);
  // drafted but not confirmed
  const p1 = normalizeProfile({ ...emptyProfile(), buyer_profile: buyerProfile });
  assert.equal(buyerProfileReady(p1), false);
  // confirmed → ready
  const p2 = normalizeProfile({ ...emptyProfile(), buyer_profile: { ...buyerProfile, confirmed: true } });
  assert.equal(buyerProfileReady(p2), true);
  // confirmed but no segments → still not ready
  const p3 = normalizeProfile({ ...emptyProfile(), buyer_profile: { ...buyerProfile, confirmed: true, buyer_segments: [] } });
  assert.equal(buyerProfileReady(p3), false);
});

test("the prompt tells the model buyers are customers, not peers, and forbids inventing", () => {
  const prompt = buildDraftPrompt("SITE BRAIN — test");
  assert.match(prompt, /A BUYER is a CUSTOMER/);
  assert.match(prompt, /NEVER an organisation that provides the same/i);
  assert.match(prompt, /do\s*\n?\s*NOT invent/i);
});
