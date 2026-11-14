/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/chatFlow.test.ts
 *
 *  The audit of a real chat (2026-11-14): silence after "subah", replies of 172-390 characters, a price answer that blended a
 *  whole range at a three-person buyer. Each failure is a test below. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { finalizeDecision, parseDecision, REPLY_SYSTEM } = await import("./decide.js");
const { parseMeetingPreference, MEETING_ACK, MEETING_REASK, MEETING_FALLBACK, isMeetingAsk, tooLongForChat, splitForChat } = await import("./conversation.js");
const { unsupportedAmounts } = await import("../pricing.js");
const { ACTIVE_MIN_S, ACTIVE_MAX_S } = await import("./timing.js");

const D = (reply: string, extra: any = {}) => parseDecision({ intent: "question", confidence: 0.9, action: "reply", reply, ...extra });
const ctx = (over: any = {}) => ({
  handoffFloor: { yes: false, reason: "" }, unverified: [] as string[], lang: "en" as const, recentOut: [] as string[],
  callWanted: false, priceUnknown: false, lastInbound: "", factsText: "", rewrite: async () => D("x"), ...over,
});

test("audit regression: 'subah' after 'morning, afternoon or evening?' is ACKNOWLEDGED — not the same question again, not silence", async () => {
  // the exact line sent live, and the customer's one-word answer; the model flagged it a meeting request, as it did live
  const r = await finalizeDecision(
    D("Zaroor — hamari team ka member aapse contact karke time fix kar lega. Subah, dopahar ya shaam?", { intent: "meeting" }),
    ctx({ lang: "hinglish", recentOut: [MEETING_FALLBACK.hinglish], lastInbound: "subah" }),
  );
  assert.equal(r.reply, MEETING_ACK.hinglish("morning"));
  assert.notEqual(r.reply, MEETING_FALLBACK.hinglish);
  assert.equal(r.meeting_pref, "morning");
  assert.equal(r.templated, true, "exempt from the repeat guard that ended in silence");
  assert.equal(r.needs_human, true, "the team is told to arrange it");
  assert.ok((r.notes ?? []).some((n: string) => /call time noted/.test(n)));
  // even if the model took it for small talk
  const r2 = await finalizeDecision(D("Thik hai!", { intent: "other" }), ctx({ lang: "hinglish", recentOut: [MEETING_FALLBACK.hinglish], lastInbound: "subah" }));
  assert.equal(r2.meeting_pref, "morning");
});

test("the call flow: the first request asks WHEN; an unclear answer asks again in other words; a clear one is noted", async () => {
  const first = await finalizeDecision(D("Sure, let's do a call at 10 AM tomorrow!", { intent: "meeting" }), ctx({ lastInbound: "ek meeting kare?" }));
  assert.equal(first.reply, MEETING_FALLBACK.en);
  assert.ok(first.templated && !first.meeting_pref);
  const unclear = await finalizeDecision(D("ok", { intent: "meeting" }), ctx({ recentOut: [MEETING_FALLBACK.en], lastInbound: "hmm not sure" }));
  assert.equal(unclear.reply, MEETING_REASK.en);
  assert.notEqual(unclear.reply, MEETING_FALLBACK.en);
  assert.ok(isMeetingAsk(MEETING_REASK.en), "…and it is itself a question the next answer is read against");
  const clear = await finalizeDecision(D("ok", { intent: "meeting" }), ctx({ recentOut: [MEETING_REASK.en], lastInbound: "tomorrow at 5 pm" }));
  assert.equal(clear.meeting_pref, "tomorrow 5 PM");
  assert.match(clear.reply, /Noted — tomorrow 5 PM/);
});

test("parseMeetingPreference: day, part of the day and time, in English, Hinglish and Hindi", () => {
  const p = (s: string) => parseMeetingPreference(s);
  assert.deepEqual(p("subah"), { any: true, label: "morning" });
  assert.deepEqual(p("kal shaam"), { any: true, label: "kal evening" });
  assert.deepEqual(p("tomorrow morning please"), { any: true, label: "tomorrow morning" });
  assert.deepEqual(p("Monday 4 pm"), { any: true, label: "monday 4 PM" });
  assert.deepEqual(p("dopahar 2 baje"), { any: true, label: "2 o'clock" });
  assert.deepEqual(p("सुबह"), { any: true, label: "morning" });
  assert.equal(p("hmm let me think").any, false);
  assert.equal(p("").any, false);
  assert.ok(MEETING_ACK.hi("morning").includes("ठीक है"));
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
