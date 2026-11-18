/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/chatFlow.test.ts
 *
 *  The audit of a real chat (2026-11-14): silence after "subah", replies of 172-390 characters, a price answer that blended a
 *  whole range at a three-person buyer. Each failure is a test below. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { finalizeDecision, parseDecision, inventedSchedule, stopVerdict, detectOptOut, REPLY_SYSTEM } = await import("./decide.js");
const { MEETING_ACK, MEETING_FALLBACK, tooLongForChat, splitForChat } = await import("./conversation.js");
const { unsupportedAmounts } = await import("../pricing.js");
const { ACTIVE_MIN_S, ACTIVE_MAX_S } = await import("./timing.js");

const D = (reply: string, extra: any = {}) => parseDecision({ intent: "question", confidence: 0.9, action: "reply", reply, ...extra });
const ctx = (over: any = {}) => ({
  handoffFloor: { yes: false, reason: "" }, unverified: [] as string[], lang: "en" as const, recentOut: [] as string[],
  callWanted: false, priceUnknown: false, lastInbound: "", factsText: "", rewrite: async () => D("x"), ...over,
});

const CALL = (stage: string, when: string | null = null) => ({ call: { stage, when } });

test("the model READS the call state, in any language: the code acts on it and keeps the model's own reply", async () => {
  // Hinglish, English, Hindi, Spanish, Arabic, Bengali — the code never inspects the words, only `call`
  const cases: [string, string, string, string][] = [
    ["Theek hai, subah ka time note kar liya. Team confirm karegi.", "time_given", "morning", "subah"],
    ["Noted, tonight. The team will confirm and send the link here.", "time_given", "tonight", "Aj rat ko"],
    ["Perfecto, mañana por la tarde. El equipo confirmará la hora aquí.", "time_given", "tomorrow afternoon", "mañana por la tarde"],
    ["ঠিক আছে, আজ রাতে। আমাদের টিম সময় নিশ্চিত করবে।", "time_given", "tonight", "আজ রাতে"],
    ["تمام، سأخبر الفريق الآن وسيراسلك هنا.", "wants_now", null as any, "الآن"],
  ];
  for (const [reply, stage, when, said] of cases) {
    const r = await finalizeDecision(D(reply, { intent: "meeting", ...CALL(stage, when) }), ctx({ lastInbound: said }));
    assert.equal(r.reply, reply, "the model's reply, in the customer's language, goes out unchanged");
    assert.equal(r.intent, "meeting");
    assert.equal(r.needs_human, true, "the team is told");
    assert.equal(r.meeting_pref, stage === "wants_now" ? "right now" : when);
    assert.ok(!r.templated, "not a canned line");
  }
});

test("a call with no time yet: the model's own question goes out; an invented clock time or link is removed", async () => {
  const ask = await finalizeDecision(D("Sure! Which day suits you, and morning, afternoon or evening?", { intent: "meeting", ...CALL("wants_call") }), ctx({ lastInbound: "can we have a call?" }));
  assert.equal(ask.reply, "Sure! Which day suits you, and morning, afternoon or evening?");
  assert.ok(!ask.meeting_pref && !ask.needs_human, "nothing to arrange yet");
  // the model invents "10 AM": rewritten once; if it still does, the standard line
  const fixed = await finalizeDecision(D("Sure, let's do 10 AM tomorrow!", { intent: "meeting", ...CALL("wants_call") }), ctx({ lastInbound: "call?", rewrite: async () => D("Happy to — which day suits you?") }));
  assert.equal(fixed.reply, "Happy to — which day suits you?");
  const stubborn = await finalizeDecision(D("Let's do 10 AM tomorrow!", { intent: "meeting", ...CALL("wants_call") }), ctx({ lastInbound: "call?", rewrite: async () => D("How about 11:30 am?") }));
  assert.equal(stubborn.reply, MEETING_FALLBACK.en);
  assert.ok((stubborn.notes ?? []).some((n: string) => /invented call time or link removed/.test(n)));
  // an intent "meeting" with no call field at all is treated as a call request
  const bare = await finalizeDecision(D("Which day suits you?", { intent: "meeting" }), ctx({}));
  assert.equal(bare.reply, "Which day suits you?");
  // asked twice already, still nothing: the model says "unclear"; the team is told to message them
  const unclear = await finalizeDecision(D("No worries — a team member will message you directly to fix a time.", { intent: "meeting", ...CALL("unclear") }), ctx({ lastInbound: "pata nahi" }));
  assert.equal(unclear.meeting_pref, "time not clear — read the chat");
  assert.equal(unclear.needs_human, true);
});

test("inventedSchedule: clock times and links are caught in any language; what the customer or the facts said is allowed", () => {
  assert.equal(inventedSchedule("Perfecto, a las 5 pm.", "mañana", ""), true);
  assert.equal(inventedSchedule("ठीक है, 10:30 बजे।", "kal", ""), true);
  assert.equal(inventedSchedule("Book here: https://meet.google.com/abc", "call", ""), true);
  assert.equal(inventedSchedule("5 pm works, noted.", "5 pm please", ""), false, "echoing the customer's own time is fine");
  assert.equal(inventedSchedule("Our link: https://cal.example.com/x", "call", "Booking: https://cal.example.com/x"), false);
  assert.equal(inventedSchedule("Noted — tonight.", "tonight", ""), false);
  assert.equal(inventedSchedule("It takes 3 months.", "how long", ""), false);
});

test("the prompt makes the model read the call state itself, in any language", () => {
  assert.match(REPLY_SYSTEM, /"call":\{"stage":"none","when":null\}/);
  assert.match(REPLY_SYSTEM, /judged from THEIR words in any language or spelling/);
  assert.match(REPLY_SYSTEM, /do NOT ask again and do NOT ask for a 'specific time'/);
  assert.match(REPLY_SYSTEM, /already asked when twice/);
  assert.equal(parseDecision({ intent: "meeting", reply: "x", call: { stage: "time_given", when: "tonight" } }).call?.stage, "time_given");
  assert.equal(parseDecision({ intent: "meeting", reply: "x", call: { stage: "bogus" } }).call?.stage, "none", "a malformed stage is ignored");
});

test("short messages: the real 390-character reply is detected, and split the way a person would send it", () => {
  const essay = "Thank you — 3 employees at one site in West Bengal. Based on that, the ISO 9001:2015 certification would be at the lower end of our range ($2,400–$18,000 per standard, per site). For an exact quote, a team member will need a few more details (scope of operations, current QMS maturity, preferred timeline). Would you like me to have them reach out on this WhatsApp with the formal proposal?";
  assert.equal(tooLongForChat(essay), true);
  assert.equal(tooLongForChat("Samajh gaya — Essential package $2,400 se shuru hota hai. Aapko kab tak chahiye?"), false);
  assert.equal(tooLongForChat("One. Two. Three. Four."), true, "more than three sentences");
  const parts = splitForChat(essay);
  assert.ok(parts.length >= 2 && parts.length <= 3, String(parts.length));
  assert.ok(parts.every((x: string) => x.length <= 260), parts.map((x: string) => x.length).join(","));
  assert.equal(parts.join(" ").replace(/\s+/g, " "), essay.replace(/\s+/g, " "), "nothing is lost, only cut at sentence ends");
  assert.deepEqual(splitForChat("Short one."), ["Short one."]);
  assert.ok(splitForChat("a".repeat(500)).length <= 3);
});

test("an essay is rewritten once, short; if the model will not, it stays and is sent as short messages", async () => {
  const essay = ("Thank you for that. " + "Based on what you told me the certification would take a few months and a team member will need many more details about scope, maturity and timeline. ".repeat(2)).trim();
  const short = await finalizeDecision(D(essay), ctx({ rewrite: async () => D("About 3-4 months. How many sites?") }));
  assert.equal(short.reply, "About 3-4 months. How many sites?");
  assert.ok((short.notes ?? []).some((n: string) => /shortened/.test(n)));
  assert.equal((await finalizeDecision(D(essay), ctx({ rewrite: async () => D(essay) }))).reply, essay);
  assert.equal((await finalizeDecision(D(essay), ctx({ rewrite: async () => { throw new Error("down"); } }))).reply, essay);
});

test("accuracy: a price not in the facts is corrected, a published one passes, the customer's own figure may be echoed", async () => {
  const facts = "Pricing: from $2,400 to $18,000 depending on the package\nPackages:\n- Essential — from $2,400 — one standard, one site";
  const c = (rewrite: any, lastInbound = "price?") => ctx({ factsText: facts, lastInbound, rewrite });
  assert.deepEqual(unsupportedAmounts("It starts from $2,400.", facts), []);
  assert.deepEqual(unsupportedAmounts("About $5,000 for you.", facts), ["$5,000"]);
  assert.deepEqual(unsupportedAmounts("It takes 4 months and 12 staff.", facts), []);
  const fixed = await finalizeDecision(D("It would be about $5,000 for a team your size."), c(async () => D("Essential starts from $2,400 for one standard at one site.")));
  assert.match(fixed.reply, /\$2,400/);
  assert.ok((fixed.notes ?? []).some((n: string) => /price corrected/.test(n)));
  const dropped = await finalizeDecision(D("Hello there. It would be about $5,000 for you."), c(async () => D("Around $6,000.")));
  assert.equal(dropped.reply, "Hello there.");
  const safe = await finalizeDecision(D("It would be about $5,000 for you."), c(async () => D("Around $6,000.")));
  assert.match(safe.reply, /team member will send you the exact figure/);
  assert.equal(safe.needs_human, true);
  const echo = await finalizeDecision(D("A $3,000 budget is workable for one site."), c(async () => D("x"), "mera budget $3,000 hai"));
  assert.equal(echo.reply, "A $3,000 budget is workable for one site.");
  let calls = 0;
  const ok = await finalizeDecision(D("Essential is from $2,400."), c(async () => { calls++; return D("x"); }));
  assert.equal(calls, 0);
  assert.equal(ok.reply, "Essential is from $2,400.");
});

test("the writing rules and the sales playbook are in the system prompt", () => {
  assert.match(REPLY_SYSTEM, /like a real person texting on WhatsApp, not a company brochure/);
  assert.match(REPLY_SYSTEM, /about 25 words in all, never more than 40/);
  assert.match(REPLY_SYSTEM, /No lists, no bullet points/);
  assert.match(REPLY_SYSTEM, /Do NOT repeat back what they just told you/);
  assert.match(REPLY_SYSTEM, /SELLING — you are this business's best salesperson/);
  assert.match(REPLY_SYSTEM, /ONE next step per message/);
  assert.match(REPLY_SYSTEM, /lead with the specific PACKAGE that fits/);
  assert.match(REPLY_SYSTEM, /never say 'at the lower end of our range'/i);
  assert.match(REPLY_SYSTEM, /you have no authority to discount/);
  assert.match(REPLY_SYSTEM, /a manager can discuss options/);
  assert.match(MEETING_ACK.en("morning"), /send the meeting link here shortly/);
});

test("speed: the pause before a live-chat reply is 1-3 seconds, and the typing indicator is shown while the model works", () => {
  assert.equal(ACTIVE_MIN_S, 1);
  assert.equal(ACTIVE_MAX_S, 3);
});

const { groundedPackages } = await import("../pricing.js");

test("packages: kept only when the site prints the name and the figures", () => {
  const pages = [{ url: "https://x.test/pricing", text: "Essential from $2,400 for teams under 50. Professional from $7,500. Enterprise on request." }] as any;
  const out = groundedPackages([
    { name: "Essential", from: "from $2,400", best_for: "teams under 50", duration: null, covers: null },
    { name: "Professional", from: "from $9,999", best_for: null, duration: null, covers: null },
    { name: "Platinum", from: "from $2,400", best_for: null, duration: null, covers: null },
  ], pages);
  assert.deepEqual(out.map((p: any) => p.name), ["Essential"]);
  assert.equal(out[0].best_for, "teams under 50");
  assert.deepEqual(groundedPackages("nope", pages), []);
});

const { mergeSignals, missingFromKeys, detectSignals } = await import("./conversation.js");

test("understanding in any language: the model's reading is parsed, merged with the keywords, and checked against our facts", () => {
  const d = parseDecision({
    intent: "question", reply: "x",
    read: { price: true, delay_complaint: false, angry: true, wants_call: true, bogus: true },
    stop: "yes", commit: true, asks_missing: ["address", "pizza", "hours"],
  });
  assert.equal(d.read?.price, true);
  assert.equal(d.read?.angry, true);
  assert.equal(d.read?.wantsCall, true);
  assert.equal(d.stop, "yes");
  assert.equal(d.commit, true);
  assert.deepEqual(d.asks_missing, ["address", "hours"], "unknown kinds are dropped");
  // malformed or absent: safe defaults, never a stop or a purchase by accident
  const none = parseDecision({ intent: "question", reply: "x", stop: "definitely", commit: "yes", read: "oops" });
  assert.equal(none.stop, "no");
  assert.equal(none.commit, false);
  assert.equal(none.read?.price, false);

  // a Spanish price question: no keyword sees it, the model does — the merged signal drives the "no published price" net
  const kw = detectSignals("¿Cuánto cuesta la certificación?");
  assert.equal(kw.price, false);
  assert.equal(mergeSignals(kw, d.read).price, true);
  assert.equal(mergeSignals(detectSignals("what is the price"), {}).price, true, "the keyword reading still counts");

  // the model says they asked for an address: only a MISSING one is a gap
  assert.deepEqual(missingFromKeys(["address", "phone"], "We do ISO consulting."), ["our office address", "our phone number / email"]);
  assert.deepEqual(missingFromKeys(["address"], "Our office is at Al Majaz Tower, Sharjah. Address: Office 12"), []);
  assert.deepEqual(missingFromKeys([], "anything"), []);
});

test("the prompt tells the model to read stop requests, anger, price, buying and missing details in any language", () => {
  assert.match(REPLY_SYSTEM, /"stop":"no","commit":false,"asks_missing":\[\]/);
  assert.match(REPLY_SYSTEM, /in ANY form — any language, spelling, slang, emoji or hint — they do not want us to message them/);
  assert.match(REPLY_SYSTEM, /action "ignore" and reply ""/);
  assert.match(REPLY_SYSTEM, /judged from its MEANING in any language/);
  assert.match(REPLY_SYSTEM, /asking for the invoice or for how to pay IS a commitment/);
});

test("an AUTOMATIC reply (auto-responder, 'send us an email') is never answered and never gets a call offered — the Royal Joinery case", async () => {
  const autoReply = "Thank you for contacting Royal Joinery! To ensure faster processing of your inquiries, quotations and project requirements, kindly send us an email at rj.marketing@royalric.ae";
  const r = await finalizeDecision(
    D("Thanks for the email address. I'm Sami from WCA Global.", { automated: true, redirect: "rj.marketing@royalric.ae", intent: "meeting", call: { stage: "wants_call", when: null } }),
    ctx({ lastInbound: autoReply }),
  );
  assert.equal(r.action, "ignore", "nothing is sent back to a machine");
  assert.equal(r.reply, "");
  assert.equal(r.needs_human, true, "the owner is told");
  assert.match(r.reason, /rj\.marketing@royalric\.ae/, "...with where the message says to go instead");
  assert.equal(r.call?.stage, "none", "and no call is arranged, whatever else the model said");
  assert.equal(r.meeting_pref, undefined);
  assert.ok((r.notes ?? []).some((n: string) => /automatic reply/.test(n)));
  // parsing: the flag and the address survive, junk does not
  const p = parseDecision({ intent: "other", reply: "", automated: true, redirect: "  info@x.ae  " });
  assert.equal(p.automated, true);
  assert.equal(p.redirect, "info@x.ae");
  assert.equal(parseDecision({ intent: "other", reply: "x", automated: "yes" }).automated, false, "only a real true counts");
});

test("a bare intent 'meeting' is NOT a call request: only the customer's own words (call.stage) arrange one", async () => {
  const r = await finalizeDecision(D("Happy to share more about the process.", { intent: "meeting" }), ctx({ lastInbound: "tell me more about your process" }));
  assert.equal(r.meeting_pref, undefined, "no preference, no team alert");
  assert.equal(r.needs_human, false);
  assert.equal(r.call?.stage, "none");
  assert.equal(r.reply, "Happy to share more about the process.", "the model's own reply stands; nothing is replaced by the call-asking line");
});

test("a stop-like WORD is only a hint: the model decides, the keywords are the backup, and the bare STOP of our own footer always stops", () => {
  // the false positives that used to silently opt a customer out
  for (const m of ["can you stop by our office tomorrow?", "please don't stop the service, I want to continue"]) {
    assert.equal(detectOptOut(m), true, "the keyword list still sees the word");
    assert.equal(stopVerdict({ keyword: true, text: m, model: { stop: "no", intent: "question" } }), "continue", `the model reads it correctly: ${m}`);
  }
  assert.equal(stopVerdict({ keyword: true, text: "please stop messaging me", model: { stop: "yes", intent: "stop" } }), "stop");
  assert.equal(stopVerdict({ keyword: false, text: "no me escriban más", model: { stop: "yes", intent: "stop" } }), "stop", "any language, no keyword needed");
  assert.equal(stopVerdict({ keyword: false, text: "I'm busy", model: { stop: "maybe", intent: "other" } }), "flag");
  assert.equal(stopVerdict({ keyword: true, text: "band karo bhai", model: null }), "stop", "model down: the keyword acts, the safe direction");
  assert.equal(stopVerdict({ keyword: false, text: "hello", model: null }), "continue");
  for (const bare of ["STOP", "stop.", " Stop! ", "unsubscribe"]) assert.equal(stopVerdict({ keyword: true, text: bare, model: { stop: "no" } }), "stop", `the footer promises it: "${bare}"`);
  assert.equal(stopVerdict({ keyword: true, text: "stop by tomorrow", model: { stop: "no" } }), "continue", "only the bare word is exempt");
});
