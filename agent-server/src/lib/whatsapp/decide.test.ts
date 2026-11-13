/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/decide.test.ts
 *
 *  The decision engine's SAFE parsing (a malformed model answer must never send garbage or crash)
 *  and the DETERMINISTIC opt-out (which must never be left to the model) are pure — tested here.
 *  decideReply itself makes a real model call and is not unit-tested.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { parseDecision, detectOptOut, detectBuyIntent } = await import("./decide.js");

test("detectBuyIntent: fires only on an EXPLICIT buy signal, not a lukewarm yes", () => {
  assert.equal(detectBuyIntent("send me the invoice please"), true);
  assert.equal(detectBuyIntent("ok let's start"), true);
  assert.equal(detectBuyIntent("where do I pay?"), true);
  assert.equal(detectBuyIntent("invoice bhejo"), true);
  assert.equal(detectBuyIntent("start karte hain"), true);
  // not explicit → must NOT auto-convert
  assert.equal(detectBuyIntent("sounds good, let me think"), false);
  assert.equal(detectBuyIntent("interesting, tell me more"), false);
  assert.equal(detectBuyIntent("ok"), false);
});

test("detectOptOut: catches English + Hinglish stop phrases, ignores normal text", () => {
  assert.equal(detectOptOut("STOP"), true);
  assert.equal(detectOptOut("please unsubscribe me"), true);
  assert.equal(detectOptOut("bhai band karo ye messages"), true);
  assert.equal(detectOptOut("mat bhejo"), true);
  assert.equal(detectOptOut("do not contact me again"), true);
  assert.equal(detectOptOut("yes I want to stop by your office"), true, "contains 'stop' as a word — conservative, we'd rather over-stop");
  assert.equal(detectOptOut("sounds good, what's the price?"), false);
  assert.equal(detectOptOut("haan theek hai"), false);
});

test("parseDecision: a valid reply decision passes through, clamped", () => {
  const d = parseDecision({ intent: "question", confidence: 0.9, action: "reply", reply: "Sure — ISO 9001 covers your QMS.", reason: "asked scope" });
  assert.equal(d.intent, "question");
  assert.equal(d.action, "reply");
  assert.equal(d.confidence, 0.9);
  assert.equal(d.needs_human, false);
});

test("parseDecision: reply with empty text is downgraded to ignore", () => {
  const d = parseDecision({ intent: "affirmation", confidence: 0.8, action: "reply", reply: "   ", reason: "" });
  assert.equal(d.action, "ignore");
});

test("parseDecision: objection or low confidence flags needs_human (but may still reply)", () => {
  const obj = parseDecision({ intent: "objection", confidence: 0.9, action: "reply", reply: "I understand — happy to clarify." });
  assert.equal(obj.needs_human, true, "objection → flag");
  const unsure = parseDecision({ intent: "question", confidence: 0.3, action: "reply", reply: "..." });
  assert.equal(unsure.needs_human, true, "low confidence → flag");
});

test("parseDecision: garbage / missing fields fall back safely, never throw", () => {
  const d = parseDecision({ intent: "banana", action: "nuke", confidence: "lots" });
  assert.equal(d.intent, "other");
  assert.equal(d.action, "ignore", "no reply text → ignore, not a bad send");
  assert.equal(d.confidence, 0.5);
  assert.equal(parseDecision(null).intent, "other");
  assert.equal(parseDecision("nope").action, "ignore");
});

test("parseDecision: clamps confidence to 0..1 and trims long replies", () => {
  assert.equal(parseDecision({ confidence: 5, action: "ignore" }).confidence, 1);
  assert.equal(parseDecision({ confidence: -2, action: "ignore" }).confidence, 0);
  const long = parseDecision({ action: "reply", reply: "x".repeat(2000), confidence: 0.9 });
  assert.ok(long.reply.length <= 900);
});

const { isNearDuplicate, buildBusinessBrief } = await import("./decide.js");

test("isNearDuplicate: the 'Sorry for the delay' loop from the real client chat is caught", () => {
  // The four replies the bot actually sent on 2026-11-13, each one a rewording of the last.
  const sent = [
    "Sorry for the delay — I'll send the ISO 9001 outline right away. Best email or WhatsApp number to share it?",
    "Sorry for the delay — I'll send the ISO 9001 outline now.",
    "Sorry for the delay — I was preparing the ISO 9001 outline. I'll send it now.",
    "Sorry for the delay. I'm here now — sending the ISO 9001 outline shortly.",
  ];
  assert.equal(isNearDuplicate(sent[1], sent[0]), true);
  assert.equal(isNearDuplicate(sent[2], sent[1]), true);
  assert.equal(isNearDuplicate(sent[3], sent[2]), true);
});

test("isNearDuplicate: a genuinely new answer is not flagged", () => {
  const old = "Sorry for the delay — I'll send the ISO 9001 outline now.";
  const fresh = "ISO 9001 certification usually takes 3-4 months and costs depend on your company size. How many employees do you have?";
  assert.equal(isNearDuplicate(fresh, old), false);
  assert.equal(isNearDuplicate("Yes, we can start next week.", "Which city are you in?"), false);
});

test("parseDecision: handoff=true flags the lead for a person even at high confidence", () => {
  const d = parseDecision({ intent: "question", confidence: 0.95, action: "reply", reply: "Our range is X.", handoff: true });
  assert.equal(d.needs_human, true);
  assert.equal(parseDecision({ intent: "question", confidence: 0.95, action: "reply", reply: "Hi", handoff: false }).needs_human, false);
});

test("buildBusinessBrief: carries the name and the price, and says so when there is no price", () => {
  const withPrice = buildBusinessBrief(
    { what_they_do: "ISO consultancy", pricing: { model: "quote", range: "AED 4,000-9,000", note: "depends on company size" }, owner_name: "Sami" },
    { name: "heysamiul09", website_url: "https://www.wca-global.com" },
  );
  assert.match(withPrice, /Business name: wca-global\.com/);
  assert.match(withPrice, /You write as: Sami from wca-global\.com/);
  assert.match(withPrice, /AED 4,000-9,000/);
  const noPrice = buildBusinessBrief({ what_they_do: "ISO consultancy" }, { name: "x", website_url: null });
  assert.match(noPrice, /Pricing: NOT PROVIDED/);
});
