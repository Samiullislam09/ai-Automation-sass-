/** Run: cd agent-server && npx tsx --test src/lib/siteProfile.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

// Same reason as dedupe.test.ts: siteProfile.ts imports the Supabase client, whose env.ts
// throws on missing config. profileBlock() and diffProfiles() are pure — nothing below opens
// a connection — so placeholder env goes in first and the module is imported after it.
process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { profileBlock, diffProfiles, emptyProfile, normalizeProfile } = await import("./siteProfile.js");
type SiteProfile = import("./siteProfile.js").SiteProfile;

function iso(): SiteProfile {
  return {
    ...emptyProfile(),
    what_they_do: "ISO certification consultancy — 9001, 14001 and 27001 audits, documentation and training.",
    audience: "SME owners and quality managers",
    buyer_intent: ["how long does iso 9001 take", "how much does certification cost"],
    offerings: [
      { name: "ISO 9001 certification", url: "https://x.test/services/iso-9001", kind: "service" },
      { name: "ISO 27001 gap audit", url: "https://x.test/services/iso-27001-gap-audit", kind: "service" },
    ],
    proof: [{ claim: "IRCA-registered lead auditors", quote: "our IRCA-registered lead auditors", url: "https://x.test/about" }],
    topic_clusters: [
      { name: "ISO 9001", page_urls: ["https://x.test/services/iso-9001"], centroid: [0.1, 0.2], size: 4 },
      { name: "training", page_urls: ["https://x.test/training"], centroid: null, size: 1 },
    ],
    content_gaps: [
      { query: "iso 27001 cost", impressions: 340, position: 14.2, nearest_similarity: 0.41, nearest_url: "https://x.test/iso-27001", nearest_cluster: "ISO 9001" },
    ],
    voice: { tone: "formal, no hype", do: ["use we"], dont: ["no superlatives"], samples: ["We audit against the published standard."] },
    geo: "India and UAE",
    language: "en",
    competitors: ["competitor.test"],
    goals: { primary: "leads", kpis: ["monthly certification enquiries"] },
    confidence: { what_they_do: "high", offerings: "high" },
    sources: { what_they_do: ["https://x.test/"], offerings: ["https://x.test/services/iso-9001"] },
  };
}

// ── profileBlock ────────────────────────────────────────────────────────────────────────────

test("profileBlock: an empty profile produces nothing at all", () => {
  // Not "unknown business", not a heading with blanks under it. A caller that gets "" keeps
  // exactly the prompt it had before, which is the whole point of the fallback.
  assert.equal(profileBlock(emptyProfile()), "");
  assert.equal(profileBlock(null), "");
  assert.equal(profileBlock(undefined), "");
});

test("profileBlock: every populated field appears, under a heading, in plain text", () => {
  const block = profileBlock(iso());

  assert.ok(block.startsWith("\n"), "block should open with a blank line so it drops into a prompt cleanly");
  assert.match(block, /SITE BRAIN/);
  assert.match(block, /WHAT THIS BUSINESS DOES: ISO certification consultancy/);
  assert.match(block, /WHO THEY SELL TO: SME owners and quality managers/);
  assert.match(block, /Location\/service area: India and UAE/);
  assert.match(block, /Language: en/);
  assert.match(block, /- ISO 9001 certification \(service\) — https:\/\/x\.test\/services\/iso-9001/);
  assert.match(block, /- IRCA-registered lead auditors \[https:\/\/x\.test\/about\]/);
  assert.match(block, /- ISO 9001 \(4 pages\)/);
  assert.match(block, /- training \(1 page\)/); // singular, not "1 pages"
  assert.match(block, /- "iso 27001 cost" — 340 impressions, position 14\.2/);
  assert.match(block, /Tone: formal, no hype/);
  assert.match(block, /Primary goal: leads/);
  assert.match(block, /Competitors named by the owner: competitor\.test/);
});

test("profileBlock: it says out loud that what is missing is not known", () => {
  const block = profileBlock(iso());
  assert.match(block, /Everything below is evidence/);
  assert.match(block, /leave it out rather than inventing it/);
});

test("profileBlock: an absent field prints no line, rather than an empty one", () => {
  const partial: SiteProfile = { ...emptyProfile(), what_they_do: "A plumber in Leeds." };
  const block = profileBlock(partial);

  assert.match(block, /WHAT THIS BUSINESS DOES: A plumber in Leeds\./);
  for (const absent of ["WHO THEY SELL TO", "WHAT THEY SELL", "PROVEN FACTS", "TOPICS THIS SITE", "HOUSE VOICE", "Language:", "Competitors"]) {
    assert.ok(!block.includes(absent), `"${absent}" should not appear for a profile that does not have it`);
  }
  // No placeholder ever reaches a prompt: that is what invites the model to fill the blank.
  assert.ok(!/unknown|not specified|n\/a/i.test(block), block);
});

test("profileBlock: 1024-number centroids and the internal confidence map stay out of the prompt", () => {
  const block = profileBlock(iso());
  assert.ok(!block.includes("centroid"), "centroids are for our maths, not for the model");
  assert.ok(!block.includes("confidence"), "confidence is an internal score");
  assert.ok(!block.includes("0.1"), "raw vector components must never be printed");
});

test("profileBlock: long lists are capped so one profile cannot eat the whole prompt", () => {
  const many: SiteProfile = {
    ...emptyProfile(),
    offerings: Array.from({ length: 40 }, (_, i) => ({ name: `Offering ${i}`, url: null, kind: "service" as const })),
  };
  const lines = profileBlock(many).split("\n").filter((l) => l.startsWith("- Offering"));
  assert.equal(lines.length, 12); // the default cap

  const two = profileBlock(many, { maxOfferings: 2 }).split("\n").filter((l) => l.startsWith("- Offering"));
  assert.equal(two.length, 2);
});

test("normalizeProfile: a document written by an older version cannot crash a reader", () => {
  const legacy = normalizeProfile({ what_they_do: "x", offerings: "not an array", proof: null });
  assert.deepEqual(legacy.offerings, []);
  assert.deepEqual(legacy.proof, []);
  assert.equal(legacy.what_they_do, "x");
  assert.equal(profileBlock(legacy), profileBlock(legacy)); // and it renders without throwing
});

// ── diffProfiles ────────────────────────────────────────────────────────────────────────────

test("diffProfiles: identical versions produce no changes", () => {
  assert.deepEqual(diffProfiles(iso(), iso()), []);
  assert.deepEqual(diffProfiles(emptyProfile(), emptyProfile()), []);
});

test("diffProfiles: the freshness card — new pages found, one gone", () => {
  const before = iso();
  const after: SiteProfile = {
    ...iso(),
    offerings: [
      // "ISO 9001 certification" is gone, two new ones appeared.
      { name: "ISO 27001 gap audit", url: "https://x.test/services/iso-27001-gap-audit", kind: "service" },
      { name: "Internal auditor training", url: "https://x.test/training", kind: "service" },
      { name: "ISO 14001 certification", url: "https://x.test/services/iso-14001", kind: "service" },
    ],
  };

  const changes = diffProfiles(before, after);
  const added = changes.find((c) => c.field === "offerings" && c.kind === "added");
  const removed = changes.find((c) => c.field === "offerings" && c.kind === "removed");

  assert.ok(added, "the two new offerings should be reported");
  assert.match(added!.text, /2 new offerings/);
  assert.match(added!.text, /Internal auditor training/);
  assert.ok(removed, "the offering that disappeared should be reported");
  assert.match(removed!.text, /1 offering gone/); // singular
  assert.match(removed!.text, /ISO 9001 certification/);
});

test("diffProfiles: prose fields say what they were as well as what they became", () => {
  const before = iso();
  const after = { ...iso(), what_they_do: "ISO and CE marking consultancy for manufacturers." };
  const change = diffProfiles(before, after).find((c) => c.field === "what_they_do");

  assert.ok(change);
  assert.equal(change!.kind, "changed");
  // Showing the OLD text is what lets someone spot the agent overwriting their correction.
  assert.match(change!.text, /changed from "ISO certification consultancy/);
  assert.match(change!.text, /to "ISO and CE marking consultancy/);
});

test("diffProfiles: a field only whitespace/case apart has not changed", () => {
  const after = { ...iso(), audience: "  SME Owners and Quality   Managers  " };
  assert.equal(diffProfiles(iso(), after).length, 0);
});

test("diffProfiles: adding to and clearing an empty profile read as added / removed", () => {
  const first = diffProfiles(emptyProfile(), iso());
  const fields = new Set(first.map((c) => c.field));
  assert.ok(fields.has("what_they_do") && fields.has("offerings") && fields.has("topic_clusters"));
  assert.ok(first.every((c) => c.kind === "added"), JSON.stringify(first));

  const gone = diffProfiles(iso(), emptyProfile());
  assert.ok(gone.every((c) => c.kind === "removed"), JSON.stringify(gone));
  assert.match(gone.find((c) => c.field === "what_they_do")!.text, /no longer stated on the site/);
});

test("diffProfiles: voice and goals are reported once, as a whole", () => {
  const after: SiteProfile = {
    ...iso(),
    voice: { tone: "plain and direct", do: ["use we"], dont: [], samples: [] },
    goals: { primary: "sales", kpis: [] },
  };
  const changes = diffProfiles(iso(), after);

  const voice = changes.filter((c) => c.field === "voice");
  assert.equal(voice.length, 1);
  assert.match(voice[0].text, /House voice updated \(tone: plain and direct\)/);

  const goals = changes.filter((c) => c.field === "goals");
  assert.equal(goals.length, 1);
  assert.match(goals[0].text, /Goal is now: sales/);
});

test("diffProfiles: every change is one line a human could read out", () => {
  const after = { ...iso(), content_gaps: [] };
  for (const change of diffProfiles(iso(), after)) {
    assert.ok(change.text.length > 0 && !change.text.includes("\n"), `not one line: ${change.text}`);
    assert.ok(["added", "removed", "changed"].includes(change.kind));
  }
});

test("diffProfiles: null and undefined versions are handled, not thrown at", () => {
  assert.deepEqual(diffProfiles(null, null), []);
  assert.ok(diffProfiles(null, iso()).length > 0);
  assert.ok(diffProfiles(iso(), undefined).length > 0);
});
