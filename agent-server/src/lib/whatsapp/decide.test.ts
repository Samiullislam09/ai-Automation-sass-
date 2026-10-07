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

const { parseDecision, detectOptOut } = await import("./decide.js");

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
