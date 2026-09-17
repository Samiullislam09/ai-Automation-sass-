/** What the chat must refuse to answer, and — just as important — what it must NOT refuse.
 *
 *  Every "must not fire" case below is a question the product CAN answer from data it really
 *  holds (156 crawled pages, Mr. Analyst's profile, content_items, the schedule). A refusal
 *  matcher that creeps into those is worse than no matcher at all: it would turn working
 *  answers into "connect Google first", and the failure would be invisible in a diff.
 *
 *  The "must fire" cases are the owner's own words from the live chat history, which is why
 *  they are Hinglish rather than textbook English — "kitne user active ha" never matches an
 *  English-shaped pattern like "active users", and that gap is exactly how a model ends up
 *  inventing a traffic number.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerWhatWeCannotKnow, looksLikeMetricQuestion, type DataSources } from "./chat-no-data";

/** Nothing connected — the live state of the database this was written against. */
const NOTHING: DataSources = { ga4: false, gsc: false, social: [] };
/** Google fully wired: connected, property chosen, rows synced. */
const GOOGLE: DataSources = { ga4: true, gsc: true, social: [] };

const refused = (q: string, s: DataSources = NOTHING) => answerWhatWeCannotKnow(q, s);

/* ── must refuse: traffic, with no Google ─────────────────────────────────────────────────── */

test("traffic questions in the owner's own Hinglish are refused, not guessed", () => {
  for (const q of [
    "abhi mere site pe kitne user active ha",
    "mere site pe kitne log aaye",
    "kitna traffic hai",
    "how many visitors this week",
    "site ke sessions batao",
    "bounce rate kya hai",
  ]) {
    const r = refused(q);
    assert.ok(r, `should have been refused: ${q}`);
    assert.equal(r.missing, "ga4", q);
    assert.match(r.answer, /Google/i, "the answer has to say what to connect");
  }
});

test("a traffic question is answered normally once GA4 really has rows", () => {
  assert.equal(refused("kitna traffic hai", GOOGLE), null);
  assert.equal(refused("abhi kitne user active ha", GOOGLE), null);
});

/* ── must refuse: search performance, with no Search Console ──────────────────────────────── */

test("impressions, clicks and ranking are refused without Search Console", () => {
  for (const q of ["kitne impressions aaye", "mere clicks kitne hain", "what is my ranking", "CTR batao", "kaunsa keyword rank kar raha hai"]) {
    const r = refused(q);
    assert.ok(r, `should have been refused: ${q}`);
    assert.equal(r.missing, "gsc", q);
  }
});

test("search questions fall through once Search Console has rows", () => {
  assert.equal(refused("kitne impressions aaye", GOOGLE), null);
});

/* ── must refuse: social, connected or not ───────────────────────────────────────────────── */

test("follower growth is refused, and the answer does not pretend connecting would fix it", () => {
  const r = refused("mere social media pe kitna follower badha");
  assert.ok(r);
  assert.equal(r.missing, "social");
  // There is no follower-reading code anywhere in the product, so telling them to connect an
  // account would be a lie. The answer must own that it is unbuilt.
  assert.doesNotMatch(r.answer, /Connect page/i);
  assert.match(r.answer, /banaya nahi|nahi bata/i);
});

test("social metrics stay refused even with a social account connected", () => {
  const connected: DataSources = { ga4: true, gsc: true, social: ["social_instagram", "social_linkedin"] };
  const r = answerWhatWeCannotKnow("instagram pe kitna engagement hai", connected);
  assert.ok(r, "a connected social account still yields no metrics today");
  assert.equal(r.missing, "social");
});

test("a named platform makes 'impressions' a social question, not a Search Console one", () => {
  const r = refused("instagram pe kitne impressions aaye");
  assert.ok(r);
  assert.equal(r.missing, "social", "platform named → social, even though GSC also uses 'impressions'");
});

/* ── must refuse: money, which nothing tracks ─────────────────────────────────────────────── */

test("revenue and conversions are refused even with Google fully connected", () => {
  for (const q of ["kitni sales hui", "what is my revenue", "conversion rate batao"]) {
    const r = refused(q, GOOGLE);
    assert.ok(r, `should have been refused: ${q}`);
    assert.equal(r.missing, "revenue", q);
  }
});

/* ── must NOT fire: everything the product genuinely knows ───────────────────────────────── */

test("site issues and SEO health are NOT refused — that data really exists", () => {
  for (const q of [
    "mere site pe kiya issue ha",
    "mere site ka issue batou",
    "seo optimize kaisa ha",
    "mere site ka 2-3 issue bata sakte ho ?",
    "audit my site",
    "analyse my site again",
  ]) {
    assert.equal(refused(q), null, `must stay answerable: ${q}`);
  }
});

test("counts we really keep are NOT refused", () => {
  for (const q of [
    "kitne artical likhe",
    "ok or kitne task schudle pe ha",
    "ispe total kitne agnt ha",
    "kuya status ha",
    "kitne item approval pe hain",
  ]) {
    assert.equal(refused(q), null, `must stay answerable: ${q}`);
  }
});

test("ordinary chat and real orders are never touched", () => {
  for (const q of [
    "hi",
    "who are you",
    "kiya tum mere companey ke bare main jante ho",
    "write an article about ISO 9001 audit preparation",
    "ek keyword dhundo mere next artical ke liya",
    "find leads for restaurants in Dubai",
    "webstory b bana do ok",
  ]) {
    assert.equal(refused(q), null, `must not be refused: ${q}`);
  }
});

/* ── must NOT fire: advice about a metric is not a request for the metric ─────────────────── */

test("asking HOW TO improve a metric is answered, never refused", () => {
  // This whole block exists because the first draft of this module failed all of it: 9 of 10
  // advice-shaped questions were refused, including the owner's own live message below. A
  // question about changing a number does not need access to the number.
  for (const q of [
    "traffic kaise badhaun",
    "traffic badhane ke liye kya karun",
    "how do I increase traffic",
    "iske liye mujhe bata sakte ho kya optimize karna hoga taki mujhe jyada traffic mile",
    "ranking kaise improve karun",
    "mere clicks kaise badhenge",
    "followers kaise badhaun",
    "sales kaise badhaun",
    "seo optimize kaisa ha",
  ]) {
    assert.equal(refused(q), null, `advice must not be refused: ${q}`);
  }
});

test("which keyword WILL rank is Mr. Keyword's job; which one IS ranking is a number we lack", () => {
  assert.equal(refused("konsa keyword rank karega"), null, "a recommendation, not a measurement");
  assert.ok(refused("kaunsa keyword rank kar raha hai"), "a current position we cannot see");
});

test("advice plus an explicit quantity still refuses the quantity", () => {
  // "kitna traffic hai aur kaise badhaun" — answering the advice half while inventing the
  // number would be the exact failure this module exists to stop.
  const r = refused("kitna traffic hai aur kaise badhaun");
  assert.ok(r);
  assert.equal(r.missing, "ga4");
});

test("'kitna traffic badha' asks for a value, not for advice", () => {
  const r = refused("kitna traffic badha");
  assert.ok(r, "bare 'badha' is past tense — it asks how much it grew");
  assert.equal(r.missing, "ga4");
});

test("an empty or blank message is not a metric question", () => {
  assert.equal(refused(""), null);
  assert.equal(refused("   "), null);
  assert.equal(looksLikeMetricQuestion(""), false);
});

/* ── the pre-filter must never be narrower than the decision ─────────────────────────────── */

test("the pre-filter says yes to everything the matcher would refuse", () => {
  const wouldRefuse = [
    "kitne user active ha",
    "kitna traffic hai",
    "kitne impressions aaye",
    "mere follower kitne badhe",
    "kitni sales hui",
    "instagram pe kitna engagement hai",
  ];
  for (const q of wouldRefuse) {
    assert.ok(refused(q), `precondition: ${q} is refused`);
    assert.equal(looksLikeMetricQuestion(q), true, `pre-filter must not skip the DB read for: ${q}`);
  }
});

test("the pre-filter skips the read for ordinary messages", () => {
  for (const q of ["hi", "mere site pe kiya issue ha", "write an article about ISO 9001", "kitne artical likhe"]) {
    assert.equal(looksLikeMetricQuestion(q), false, `should not pay for the sources read: ${q}`);
  }
});
