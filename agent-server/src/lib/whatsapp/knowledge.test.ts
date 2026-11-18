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

const { detectLanguage, classifyLanguage: classifyLang, offersCall, stripCallOffer } = await import("./conversation.js");

test("sim regressions: a competitor's price is not an 'unverified standard', a standard number still is", () => {
  assert.deepEqual(unverifiedTerms("bohot zyada hai. ek aur company 3500 mein kar rahi hai", FACTS), []);
  assert.deepEqual(unverifiedTerms("they charge 4500 for it", FACTS), []);
  assert.deepEqual(unverifiedTerms("aur ISO 27001 bhi karte ho?", FACTS), ["27001"]);
  assert.deepEqual(unverifiedTerms("do you do ISO27001?", FACTS), ["ISO27001"]);
});

test("sim regressions: a short English-looking line from a Hinglish customer stays Hinglish", () => {
  assert.equal(classifyLang("aur ISO 27001 bhi karte ho?"), "hinglish", "'karte' is Hinglish");
  const th = (rows: string[]) => rows.map((b) => ({ direction: "in" as const, body: b }));
  assert.equal(detectLanguage(th(["bohot zyada hai, kuch kam hoga kya", "kitna time lagega bhai", "ISO 27001 price?"])), "hinglish");
  // …but a customer who is really writing English is not forced into Hinglish.
  assert.equal(detectLanguage(th(["Hello, we are interested in certification", "How long does it take for a small company", "What is the price?"])), "en");
  // …and a long English message from a Hinglish customer is a real switch.
  assert.equal(detectLanguage(th(["bohot zyada hai", "kitna time lagega", "Could you please send me a detailed proposal covering scope, timeline and the exact audit schedule for our three sites?"])), "en");
});

test("call fatigue: a call offer is recognised, and removed from a reply that repeats it", () => {
  assert.equal(offersCall("Samajh gaya. Kya aapko ek 15-minute call helpful lagega?"), true);
  assert.equal(offersCall("Would a short call help? I can send you a few time slots."), true);
  assert.equal(offersCall("We can call you on Monday."), false, "a statement is not an offer");
  assert.equal(offersCall("ISO 9001 takes 3-4 months. How many staff do you have?"), false);
  assert.equal(stripCallOffer("Hum audit tak saath rehte hain. Kya aapko ek call helpful lagega?"), "Hum audit tak saath rehte hain.");
  assert.equal(stripCallOffer("Would a quick call help?"), "Would a quick call help?", "never returns an empty message");
});

test("finalizeDecision: the call question is dropped when one was offered in the last two messages and not taken", async () => {
  const ask = "Hum audit tak saath rehte hain. Kya aapko ek 15-minute call helpful lagega?";
  const base = { handoffFloor: { yes: false, reason: "" }, unverified: [] as string[], lang: "hinglish" as const, rewrite: async () => D("x") };
  const dropped = await finalizeDecision(D(ask), { ...base, recentOut: ["Pehle ek call kar lete hain? Kya aap free hain?"], callWanted: false });
  assert.equal(dropped.reply, "Hum audit tak saath rehte hain.");
  // first offer ever: kept
  assert.equal((await finalizeDecision(D(ask), { ...base, recentOut: ["ISO 9001 takes 3-4 months."], callWanted: false })).reply, ask);
  // they asked for a call themselves: kept
  assert.equal((await finalizeDecision(D(ask), { ...base, recentOut: ["Kya call helpful rahegi?"], callWanted: true })).reply, ask);
  // the model says the customer accepted (intent meeting): the model's own wording stands (it is written in the customer's
  // language and read for invented times/links by the code), and the call is treated as a request
  const acc = await finalizeDecision(D(ask, { intent: "meeting" }), { ...base, recentOut: ["Kya call helpful rahegi?"], callWanted: false });
  assert.equal(acc.reply, ask);
  assert.equal(acc.intent, "meeting");
});

test("the system prompt forbids invented times and personal experiences, and tells the AI to say it is the business's assistant", async () => {
  const { REPLY_SYSTEM } = await import("./decide.js");
  assert.match(REPLY_SYSTEM, /NEVER propose, promise or confirm a specific day or time/);
  assert.match(REPLY_SYSTEM, /never claim to have watched, visited, eaten, travelled/);
  assert.match(REPLY_SYSTEM, /Do NOT give the owner's name as your own name/);
  assert.match(REPLY_SYSTEM, /Use "meeting" when they ASK FOR or ACCEPT a call/);
});

const { missingDetails, proposesTime, stripTimeProposals, claimsExperience, MEETING_FALLBACK, SMALLTALK_DEFLECT, OPT_OUT_ACK } = await import("./conversation.js");

test("missingDetails: an address / phone / hours / licence the customer asks for and we do not hold is found", () => {
  assert.deepEqual(missingDetails("tumhara office kaha hai? address bhejo", FACTS), ["our office address"]);
  assert.deepEqual(missingDetails("what is your office address", FACTS), ["our office address"]);
  assert.deepEqual(missingDetails("aapka phone number do", FACTS), ["our phone number / email"]);
  assert.deepEqual(missingDetails("what are your working hours?", FACTS), ["our working hours"]);
  assert.deepEqual(missingDetails("do you have a trade licence?", FACTS), ["our licence / registration details"]);
  // held facts are not 'missing'
  assert.deepEqual(missingDetails("what is your office address", FACTS + "\nOur address: Office 12, Al Majaz Tower, Sharjah"), []);
  assert.deepEqual(missingDetails("send me your email", FACTS + "\nContact: info@wca-global.com"), []);
  // ordinary questions are not details questions
  assert.deepEqual(missingDetails("how long does ISO 9001 take", FACTS), []);
  assert.deepEqual(missingDetails("mera number 5551234 hai call karo", FACTS), []);
});

test("calls: a time the assistant names for a call is removed; a reply with no time is untouched", () => {
  assert.equal(proposesTime("Kya kal subah 10 baje 10 minute ka call theek rahega?"), true);
  assert.equal(proposesTime("Let's do a call tomorrow at 10 AM."), true);
  assert.equal(proposesTime("Kaam ke din (Mon-Fri) 10 AM - 4 PM ke beech call?"), true);
  assert.equal(proposesTime("ISO 9001 takes 3-4 months."), false, "a duration is not a proposed time");
  assert.equal(proposesTime("Would a short call help?"), false);
  assert.equal(stripTimeProposals("Hum audit tak saath rehte hain. Kal subah 10 baje call karein?"), "Hum audit tak saath rehte hain.");
});

test("small talk: a claimed experience is caught; an honest deflection is not", () => {
  assert.equal(claimsExperience("Haan, match tha toh interesting — last over tak gaya."), true);
  assert.equal(claimsExperience("Haan dekha, kya match tha! 😄"), true);
  assert.equal(claimsExperience("Yes, I watched it yesterday."), true);
  assert.equal(claimsExperience("Main sirf assistant hoon, is baare mein kuch keh nahi sakta."), false);
  assert.equal(claimsExperience("I'm the assistant, so I can't say — back to your ISO question."), false);
});

test("finalizeDecision: a meeting reply with an invented time is rewritten; invented times are stripped elsewhere; small-talk claims replaced", async () => {
  const base = { handoffFloor: { yes: false, reason: "" }, unverified: [] as string[], lang: "hinglish" as const, rewrite: async () => D("Kaunsa din theek rahega?"), recentOut: [] as string[], callWanted: false };
  const m = await finalizeDecision(D("Badhiya — main time slots bhejta hu. Kaam ke din (Mon-Fri) 10 AM - 4 PM theek?", { intent: "meeting", call: { stage: "wants_call", when: null } }), base);
  assert.equal(m.reply, "Kaunsa din theek rahega?");
  const t = await finalizeDecision(D("Hum audit tak saath rehte hain. Kal subah 10 baje call karein?", { intent: "question" }), { ...base, rewrite: async () => D("x") });
  assert.equal(t.reply, "Hum audit tak saath rehte hain.");
  const only = await finalizeDecision(D("Kal subah 10 baje call karein?", { intent: "question" }), base);
  assert.equal(only.reply, MEETING_FALLBACK.hinglish, "nothing left after stripping → the honest fallback");
  const s = await finalizeDecision(D("Haan, match tha toh interesting — last over tak gaya.", { intent: "smalltalk" }), base);
  assert.equal(s.reply, SMALLTALK_DEFLECT.hinglish);
});

test("finalizeDecision: a detail we do not hold (an address) is never invented", async () => {
  const gaps = ["our office address"];
  const base = { handoffFloor: { yes: true, reason: "r" }, unverified: [] as string[], detailGaps: gaps, lang: "hinglish" as const, recentOut: [] as string[], callWanted: false };
  // the model invents an office; the rewrite defers properly → the rewrite is used
  const ok = await finalizeDecision(D("Hamara Dubai office Business Bay mein hai."), { ...base, rewrite: async () => D("Address team member share karenge. Aapki company mein kitne log hain?") });
  assert.match(ok.reply, /team member share/);
  assert.equal(ok.needs_human, true);
  // the rewrite invents again → the safe line, never the invention
  const bad = await finalizeDecision(D("Hamara office Business Bay mein hai."), { ...base, rewrite: async () => D("Office Al Majaz Tower mein hai.") });
  assert.equal(bad.reply, confirmLine("hinglish", gaps));
  assert.ok(!/business bay|majaz/i.test(bad.reply));
  // a reply that already defers is untouched
  const fine = await finalizeDecision(D("Address ke liye team member aapko confirm karenge."), { ...base, rewrite: async () => D("x") });
  assert.equal(fine.reply, "Address ke liye team member aapko confirm karenge.");
});

test("opt-out confirmation: one line in each language", () => {
  for (const l of ["en", "hinglish", "hi", "ur"] as const) assert.ok(OPT_OUT_ACK[l].length > 20 && OPT_OUT_ACK[l].length < 140);
  assert.match(OPT_OUT_ACK.hi, /[ऀ-ॿ]/);
  assert.doesNotMatch(OPT_OUT_ACK.hinglish, /[ऀ-ॿ]/);
  assert.ok(!/\?/.test(OPT_OUT_ACK.en), "no question — they asked us to stop");
});

const { containsPriceAmount, statesPriceUnavailable, PRICE_UNKNOWN_LINE } = await import("./conversation.js");
const { buildBusinessBrief } = await import("./decide.js");

test("containsPriceAmount: an amount in a reply is found in the common shapes; a duration or a count is not", () => {
  for (const t of ["It costs AED 4,000.", "around $500 a month", "4000 AED for 12 staff", "Rs. 15,000 onwards", "₹ 25,000", "roughly 3,500 dirhams", "starting from 2 lakh"]) assert.ok(containsPriceAmount(t), t);
  for (const t of ["It takes 3-4 months.", "We have 300+ clients.", "You need 12 staff trained.", "Call us on 0501234567."]) assert.ok(!containsPriceAmount(t), t);
});

test("statesPriceUnavailable: 'I cannot share the price' is recognised in English, Hinglish and Hindi", () => {
  for (const t of [
    "I can't share the price right now — our team will send an exact quote.",
    "Sorry, I'm unable to share pricing at the moment.",
    "I don't have the price to hand.",
    "Abhi main aapko price nahi bata sakta.",
    "Price abhi nahi de sakta, team quote bhejegi.",
    "Main abhi exact price share nahi kar sakta — team quote bhej degi.",
    "Abhi price share nahi kar sakta — team member aapko exact quote bhejega.",
    "अभी मैं कीमत नहीं बता सकता।",
  ]) assert.ok(statesPriceUnavailable(t), t);
  for (const t of ["ISO 9001 pricing depends on company size — how many employees?", "A team member will send an exact quote.", "It takes 3-4 months."]) assert.ok(!statesPriceUnavailable(t), t);
  for (const l of ["en", "hinglish", "hi", "ur"] as const) assert.ok(PRICE_UNKNOWN_LINE[l].length > 40 && !containsPriceAmount(PRICE_UNKNOWN_LINE[l]));
  assert.ok(statesPriceUnavailable(PRICE_UNKNOWN_LINE.en) && statesPriceUnavailable(PRICE_UNKNOWN_LINE.hinglish) && statesPriceUnavailable(PRICE_UNKNOWN_LINE.hi), "the standard line itself passes its own check");
});

test("no published price: an invented number, or a reply that never says it cannot share one, is rewritten, then replaced", async () => {
  const ctxBase = { handoffFloor: { yes: true, reason: "r" }, unverified: [] as string[], lang: "en" as const, recentOut: [] as string[], callWanted: false, priceUnknown: true };
  // the model invents a figure; the rewrite is clean → the rewrite is sent
  const ok = await finalizeDecision(D("ISO 9001 usually costs AED 4,000 for a small company."), { ...ctxBase, rewrite: async () => D("I can't share the price right now — a team member will send an exact quote. What do you need it for?") });
  assert.match(ok.reply, /can't share the price/);
  assert.ok(!containsPriceAmount(ok.reply));
  assert.equal(ok.needs_human, true);
  // the rewrite STILL gives a number → the standard line, never the number
  const bad = await finalizeDecision(D("It is around $500."), { ...ctxBase, rewrite: async () => D("Prices start from $450.") });
  assert.equal(bad.reply, PRICE_UNKNOWN_LINE.en);
  // no number, but it dodges ("depends on your situation") without ever saying it cannot share → rewritten
  const dodge = await finalizeDecision(D("It depends on your company size — how many employees do you have?"), { ...ctxBase, rewrite: async () => { throw new Error("down"); } });
  assert.equal(dodge.reply, PRICE_UNKNOWN_LINE.en);
  // already correct → untouched, and the rewrite is never called
  let calls = 0;
  const good = await finalizeDecision(D("I can't share the price right now — our team will send an exact quote. What is your requirement?"), { ...ctxBase, rewrite: async () => { calls++; return D("x"); } });
  assert.equal(calls, 0);
  assert.match(good.reply, /can't share the price/);
  // a published price → this net is off
  const published = await finalizeDecision(D("ISO 9001 is AED 4,000-9,000."), { ...ctxBase, priceUnknown: false, factsText: "Pricing: priced per quote — AED 4,000-9,000", handoffFloor: { yes: false, reason: "" }, rewrite: async () => D("x") });
  assert.equal(published.reply, "ISO 9001 is AED 4,000-9,000.");
  // language follows the customer
  const hi = await finalizeDecision(D("Yeh AED 4,000 hai."), { ...ctxBase, lang: "hinglish", rewrite: async () => D("AED 5,000") });
  assert.equal(hi.reply, PRICE_UNKNOWN_LINE.hinglish);
});

test("buildBusinessBrief: three honest pricing states — a figure, 'by quote' with NO figure, and nothing", () => {
  const t = { name: "x", website_url: null };
  assert.match(buildBusinessBrief({ pricing: { model: "quote", range: "AED 4,000-9,000", note: null } }, t), /Pricing: priced per quote — AED 4,000-9,000/);
  const byQuote = buildBusinessBrief({ pricing: { model: "quote", range: null, note: "Pricing is shared on request." } }, t);
  assert.match(byQuote, /NO FIGURE IS PUBLISHED/, "'by quote' is not a price the assistant may estimate");
  assert.match(buildBusinessBrief({ what_they_do: "x" }, t), /Pricing: NOT PROVIDED/);
});

const { PRICE_UNAVAILABLE_PHRASE, signalsBrief, detectSignals: detectSig } = await import("./conversation.js");

test("price unknown: the model is told to say it in the CUSTOMER's language, and to stay in it", () => {
  const s = detectSig("price kitna hai bhai?");
  const hing = signalsBrief(s, false, "hinglish").join(" ");
  assert.ok(hing.includes(PRICE_UNAVAILABLE_PHRASE.hinglish));
  assert.match(hing, /WHOLE reply stays in that one language/);
  assert.ok(!hing.includes(PRICE_UNAVAILABLE_PHRASE.en), "a Hinglish customer is not handed the English sentence");
  assert.ok(signalsBrief(detectSig("what is the price"), false, "en").join(" ").includes(PRICE_UNAVAILABLE_PHRASE.en));
  assert.ok(signalsBrief(detectSig("कीमत क्या है"), false, "hi").join(" ").includes(PRICE_UNAVAILABLE_PHRASE.hi));
  for (const l of ["en", "hinglish", "hi", "ur"] as const) assert.ok(statesPriceUnavailable(PRICE_UNAVAILABLE_PHRASE[l]) || l === "ur", `${l}: the phrase passes the net's own check`);
});

test("missingDetails: the bare word 'address' (email address) does not count as holding our office address", () => {
  assert.deepEqual(missingDetails("what is your office address", FACTS + "\nSend us an email at the address on the contact form."), ["our office address"]);
  assert.deepEqual(missingDetails("what is your office address", FACTS + "\nCompany: WCA GLOBAL, B21-057, SRTI Park, Sharjah, UAE."), [], "a real address in the facts is a held fact");
  assert.deepEqual(missingDetails("where is your office", FACTS + "\nOur office is in Al Majaz, Sharjah."), []);
});
