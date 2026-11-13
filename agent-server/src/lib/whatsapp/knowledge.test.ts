/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/knowledge.test.ts
 *
 *  The website lookup: what is worth looking up, how a page becomes passages, which passages are kept,
 *  and — most important — that a failure of any kind returns nothing instead of blocking a reply. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { queryTerms, shouldRetrieve, queryFor, splitPassages, lexicalScore, pickPassages, renderKnowledge, retrieveKnowledge } = await import("./knowledge.js");

const PAGE = [
  "ISO 14001 — Environmental Management",
  "ISO 14001 is the international standard for environmental management systems. It helps an organisation reduce its environmental impact and meet legal obligations.",
  "How long does it take?",
  "Implementation typically takes 4 to 6 months depending on the size of the organisation and how mature its environmental controls already are.",
  "What we need from you",
  "A nominated management representative, a list of your sites and processes, and access to your existing environmental permits and records.",
  "Contact us today for a free consultation and see how we can help your business grow.",
].join("\n");

test("shouldRetrieve: a real question is looked up; an ack, a greeting or a placeholder is not", () => {
  assert.equal(shouldRetrieve("How long does ISO 14001 take?"), true);
  assert.equal(shouldRetrieve("iska process kya hai"), true);
  assert.equal(shouldRetrieve("tell me about your certification services"), true);
  for (const t of ["Ok", "ok thanks", "Thanks!", "haan", "theek hai", "👍", "hi", "[Voice message]", "hello"]) assert.equal(shouldRetrieve(t), false, t);
});

test("queryTerms: content words only, stop words and short words dropped", () => {
  assert.deepEqual(queryTerms("How long does ISO 14001 take and what do you need from us?"), ["long", "iso", "14001", "take"]);
  assert.deepEqual(queryTerms("kya aap ISO 9001 karte ho"), ["iso", "9001", "karte"]);
});

test("queryFor: a short follow-up borrows the topic of the message before it", () => {
  const t = (rows: [string, string][]) => rows.map(([d, b]) => ({ direction: d as "in" | "out", body: b }));
  assert.equal(queryFor(t([["in", "How long does ISO 14001 certification usually take for a small company?"]])), "How long does ISO 14001 certification usually take for a small company?");
  assert.equal(queryFor(t([["in", "Tell me about ISO 14001 please"], ["out", "Sure — it is the environmental standard."], ["in", "and the timeline?"]])), "Tell me about ISO 14001 please and the timeline?");
  assert.equal(queryFor(t([["in", "[Voice message]"]])), "", "a placeholder is not a question");
});

test("splitPassages: headings are merged into the paragraph they introduce; long text is cut at a sentence", () => {
  const ps = splitPassages(PAGE);
  assert.ok(ps.length >= 3 && ps.length <= 7, String(ps.length));
  assert.ok(ps.every((p) => p.length >= 40 && p.length <= 700));
  // The heading travels with its answer…
  assert.ok(ps.some((p) => /^How long does it take\? Implementation typically takes 4 to 6 months/.test(p)));
  // …and the call to action is its own passage, not glued onto the one before it.
  assert.ok(!ps.some((p) => /records/.test(p) && /free consultation/.test(p)));
  const long = "Our process is thorough. ".repeat(80);
  const cut = splitPassages(long);
  assert.ok(cut.length >= 3);
  assert.ok(cut.every((p) => p.length <= 600));
  assert.deepEqual(splitPassages(""), []);
});

test("lexicalScore: more of the question's words, closer together, scores higher", () => {
  const terms = queryTerms("how long does ISO 14001 take");
  const answer = lexicalScore("ISO 14001 implementation typically takes 4 to 6 months.", terms);
  const vague = lexicalScore("Contact us today for a free consultation about quality.", terms);
  assert.ok(answer > vague);
  assert.equal(vague, 0);
  assert.equal(lexicalScore("anything", []), 0);
});

test("pickPassages: the timeline question gets the timeline paragraph first, not the marketing line", () => {
  const out = pickPassages([{ url: "https://wca-global.com/iso-14001", title: "ISO 14001", similarity: 0.7, text: PAGE }], "How long does ISO 14001 take?");
  assert.ok(out.length >= 1);
  assert.match(out[0].text, /4 to 6 months/);
  assert.ok(!out.some((p) => /free consultation/.test(p.text)), "a paragraph that shares no word is not shown");
});

test("pickPassages: stays inside its budget and never repeats a passage", () => {
  const page = { url: "u", title: "t", similarity: 0.6, text: Array.from({ length: 30 }, (_, i) => `ISO certification paragraph number ${i} explains the audit process in some detail for the customer.`).join("\n") };
  const out = pickPassages([page, page], "ISO certification audit process", { maxChars: 500, maxPassages: 4 });
  assert.ok(out.reduce((n, p) => n + p.text.length, 0) <= 500);
  assert.equal(new Set(out.map((p) => p.text)).size, out.length);
});

test("pickPassages: a Hinglish question over an English page falls back to the page's opening when the page is the right one", () => {
  const near = pickPassages([{ url: "u", title: "t", similarity: 0.62, text: PAGE }], "iska process kya hota hai");
  assert.ok(near.length >= 1, "page similarity rescues a question with no shared words");
  const far = pickPassages([{ url: "u", title: "t", similarity: 0.2, text: PAGE }], "iska process kya hota hai");
  assert.deepEqual(far, [], "a page that is not about it is not shown");
});

test("pickPassages: nothing relevant means nothing — the model is not handed filler to build an answer from", () => {
  assert.deepEqual(pickPassages([{ url: "u", title: "t", similarity: 0.1, text: PAGE }], "do you certify in Saudi Arabia for ISO 27001"), []);
  assert.deepEqual(pickPassages([], "anything at all"), []);
});

test("renderKnowledge: address without the scheme, one line per passage", () => {
  const s = renderKnowledge([{ url: "https://wca-global.com/iso", title: "t", text: "ISO takes 4 months.", score: 1 }]);
  assert.equal(s, "- (wca-global.com/iso) ISO takes 4 months.");
});

/* ── the network part, with a fake database and a fake embedder ─────────────────────────── */

function fakeSupabase(opts: { rpc: () => Promise<{ data: any; error: any }>; pages?: Record<string, string>; onTextRead?: () => void }) {
  return {
    rpc: (_name: string, _args: any) => opts.rpc(),
    from: (_t: string) => {
      const q: any = {
        select: () => q, eq: () => q,
        in: (_c: string, ids: string[]) => { opts.onTextRead?.(); return Promise.resolve({ data: ids.map((id) => ({ id, content_text: opts.pages?.[id] ?? "" })), error: null }); },
      };
      return q;
    },
  } as any;
}

test("retrieveKnowledge: no lookup at all for an 'ok' (no embedding, no query)", async () => {
  let called = false;
  const sb = fakeSupabase({ rpc: async () => { called = true; return { data: [], error: null }; } });
  assert.deepEqual(await retrieveKnowledge(sb, "t1", "Ok"), []);
  assert.equal(called, false);
});

test("retrieveKnowledge: a missing function (migration not applied) or an RPC error returns [] — the reply carries on", async () => {
  const sb = fakeSupabase({ rpc: async () => ({ data: null, error: { message: "function match_site_pages does not exist" } }) });
  // embed() needs the network; with no key configured it throws, which must ALSO come back as [].
  assert.deepEqual(await retrieveKnowledge(sb, "t1", "How long does ISO 14001 take?"), []);
});

test("retrieveKnowledge: never throws, whatever the embedder does", async () => {
  const sb = fakeSupabase({ rpc: async () => { throw new Error("boom"); } });
  await assert.doesNotReject(() => retrieveKnowledge(sb, "t1", "What does the audit involve for a small company?"));
});

const { riskyClaim } = await import("./conversation.js");

test("riskyClaim: 'we don't offer X' made without facts is caught; ordinary answers are not", () => {
  for (const t of [
    "We don't currently offer ISO 27001 — our focus is ISO 9001.",
    "ISO 27001 isn't one of the standards we cover directly — a colleague can confirm.",
    "Sorry, we do not provide that service.",
    "That is not available with us.",
  ]) assert.ok(riskyClaim(t), t);
  for (const t of [
    "ISO 14001 typically takes 4 to 6 months depending on company size.",
    "I'll have a team member confirm whether we can support ISO 27001.",
    "I don't have that in my notes — a team member can confirm.",
    "We help companies implement ISO 9001, 14001 and 45001.",
    "Which standard are you looking at?",
  ]) assert.equal(riskyClaim(t), null, t);
});

const { unverifiedTerms, assertsUnverified, confirmLine, CONFIRM_LANG } = await import("./conversation.js");
const { finalizeDecision, parseDecision, buildReplyPrompt } = await import("./decide.js");

const FACTS = "Business name: wca-global.com\nWe offer: ISO 9001 certification, ISO 14001, ISO 45001\nUS: Hi, we help companies get ISO 9001 certified.";

test("unverifiedTerms: a standard number or a place nobody told us about is found; things we know are not", () => {
  assert.deepEqual(unverifiedTerms("Do you also certify companies in Saudi Arabia for ISO 27001?", FACTS), ["27001", "Saudi", "Arabia"]);
  assert.deepEqual(unverifiedTerms("How long does ISO 14001 take?", FACTS), [], "14001 is in our facts");
  assert.deepEqual(unverifiedTerms("Give me the price for ISO 9001", FACTS), []);
  assert.deepEqual(unverifiedTerms("what is the process?", FACTS), []);
  assert.deepEqual(unverifiedTerms("Do you work across the GCC?", FACTS), ["GCC"]);
});

test("unverifiedTerms: the customer's own company and city are not 'unverified'; their words are not facts about us", () => {
  assert.deepEqual(unverifiedTerms("We are in Dubai, can you help?", FACTS, ["Acme Trading", "Dubai"]), []);
  // The customer said "Saudi" earlier — that does not make it something WE know. Only the facts count.
  assert.deepEqual(unverifiedTerms("Do you serve customers in Saudi?", FACTS), ["Saudi"]);
});

test("assertsUnverified: a statement about it is caught; a question or a deferral is not", () => {
  const t = ["27001", "Saudi"];
  assert.equal(assertsUnverified("We focus on 9001 and 14001 — not ISO 27001.", t), true);
  assert.equal(assertsUnverified("We do work with companies in Saudi Arabia for those standards.", t), true);
  assert.equal(assertsUnverified("A team member will confirm ISO 27001 and Saudi coverage for you. Which standard matters most?", t), false);
  assert.equal(assertsUnverified("Are you looking at ISO 27001 specifically?", t), false);
  assert.equal(assertsUnverified("We help with ISO 9001.", t), false);
  assert.equal(assertsUnverified("anything", []), false);
  assert.ok(CONFIRM_LANG.test("I'll have a team member confirm"));
  assert.ok(CONFIRM_LANG.test("team se confirm karwa deta hoon"));
});

test("buildReplyPrompt: the model is TOLD which of the customer's terms are not in the facts, and a person is flagged", () => {
  const built = buildReplyPrompt({
    business: "Business name: wca-global.com\nWe offer: ISO 9001, ISO 14001, ISO 45001",
    pricingProvided: false, lead: { company: "Acme Trading", city: "Dubai" },
    thread: [{ direction: "out", body: "Hi, we help companies get ISO 9001 certified." }, { direction: "in", body: "Do you also certify companies in Saudi Arabia for ISO 27001?" }],
  });
  assert.deepEqual(built.unverified, ["27001", "Saudi", "Arabia"]);
  assert.match(built.user, /appear NOWHERE in the facts you were given/);
  assert.equal(built.handoffFloor.yes, true);
  assert.match(built.handoffFloor.reason, /27001/);
  // and the customer's own city is labelled as theirs, not ours
  assert.match(built.user, /not us — their company and their city, NOT ours/);
});

const D = (reply: string, extra: any = {}) => parseDecision({ intent: "question", confidence: 0.9, action: "reply", reply, ...extra });
const ctx = (rewrite: any, unverified = ["27001", "Saudi"]) => ({ handoffFloor: { yes: unverified.length > 0, reason: "r" }, unverified, lang: "en" as const, rewrite });

test("finalizeDecision: an assertion about an unverified term is rewritten once, and the rewrite is used when it is clean", async () => {
  let calls = 0;
  const out = await finalizeDecision(D("We focus on 9001 — not ISO 27001. We work in Saudi Arabia."), ctx(async (instr: string) => {
    calls++; assert.match(instr, /27001, Saudi/); return D("Good question — a team member will confirm ISO 27001 and Saudi coverage. Which standard matters most to you?");
  }));
  assert.equal(calls, 1);
  assert.match(out.reply, /team member will confirm/);
  assert.equal(out.needs_human, true);
});

test("finalizeDecision: if the rewrite STILL asserts, or fails, the safe line is sent — never the assertion", async () => {
  const stillBad = await finalizeDecision(D("We don't do ISO 27001."), ctx(async () => D("Saudi Arabia is part of our coverage.")));
  assert.equal(stillBad.reply, confirmLine("en", ["27001", "Saudi"]));
  assert.ok(!assertsUnverified(stillBad.reply, ["27001", "Saudi"]) || CONFIRM_LANG.test(stillBad.reply));
  const failed = await finalizeDecision(D("We don't do ISO 27001."), ctx(async () => { throw new Error("model down"); }));
  assert.equal(failed.reply, confirmLine("en", ["27001", "Saudi"]));
  assert.equal(failed.needs_human, true);
});

test("finalizeDecision: a clean reply with nothing unverified is untouched; the escalation floor still applies", async () => {
  let calls = 0;
  const clean = await finalizeDecision(D("ISO 14001 takes 4 to 6 months."), { handoffFloor: { yes: false, reason: "" }, unverified: [], lang: "en", rewrite: async () => { calls++; return D("x"); } });
  assert.equal(calls, 0);
  assert.equal(clean.reply, "ISO 14001 takes 4 to 6 months.");
  assert.equal(clean.needs_human, false);
  const floored = await finalizeDecision(D("Sure, here you go."), { handoffFloor: { yes: true, reason: "customer sounds upset" }, unverified: [], lang: "en", rewrite: async () => D("x") });
  assert.equal(floored.needs_human, true);
  assert.equal(floored.reason, "customer sounds upset");
});

test("finalizeDecision: a 'we don't offer X' with no unverified term is still flagged for a person, not blocked", async () => {
  const out = await finalizeDecision(D("We don't offer that service."), { handoffFloor: { yes: false, reason: "" }, unverified: [], lang: "en", rewrite: async () => D("x") });
  assert.equal(out.reply, "We don't offer that service.");
  assert.equal(out.needs_human, true);
  assert.match(out.reason, /check:/);
});

test("confirmLine: one line in each language, naming what will be confirmed", () => {
  for (const l of ["en", "hinglish", "hi", "ur"] as const) assert.ok(confirmLine(l, ["27001"]).includes("27001"));
  assert.match(confirmLine("hi", ["27001"]), /[ऀ-ॿ]/);
  assert.doesNotMatch(confirmLine("hinglish", ["27001"]), /[ऀ-ॿ]/);
});
