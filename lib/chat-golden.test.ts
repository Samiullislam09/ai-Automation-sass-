/** The golden set's own integrity, offline (no network): every expected tool really exists, the languages are covered, the real client's questions are all in, and the
 *  reply checks catch what they exist to catch. The live run against the real model is lib/chat-golden.live.ts (`npm run golden:chat`). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTING, ANSWERS, FIXTURE_STATS, checkAnswer, numbersIn, type AnswerCase } from "./chat-golden";
import { toolsFromRegistry } from "./chat-tools";
import { buildMessages, sectionsOf } from "./chat-prompt";
import { PLATFORM_KNOWLEDGE } from "./platform-knowledge";

// The router sees the registry's actions plus the fixed tools. Names of registry actions the golden set expects (the live runner builds the same small registry).
const REGISTRY_ACTIONS = ["find_keywords", "find_leads", "write_article", "make_image"];
const universe = new Set([...toolsFromRegistry(null).map((t) => t.function.name), ...REGISTRY_ACTIONS]);

test("every tool the routing cases expect exists — a typo here would make a case pass or fail for the wrong reason", () => {
  for (const c of ROUTING) for (const t of c.expect) assert.ok(universe.has(t), `${c.id}: unknown tool "${t}"`);
  for (const c of ANSWERS) assert.ok(c.tool === "answer_question" || universe.has(c.tool), `${c.id}: unknown tool "${c.tool}"`);
});

test("ids are unique and every case says why it exists", () => {
  const ids = [...ROUTING, ...ANSWERS].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of [...ROUTING, ...ANSWERS]) assert.ok(c.why.length >= 8 && c.message.trim().length > 0, c.id);
});

test("the set is multi-language: at least six languages across routing, and non-Latin scripts in the answers", () => {
  const langs = new Set(ROUTING.map((c) => c.lang));
  for (const l of ["en", "hinglish", "es", "ar", "bn", "fr"]) assert.ok(langs.has(l as any), `no routing case in ${l}`);
  assert.ok(ANSWERS.some((c) => c.script === "bengali") && ANSWERS.some((c) => c.script === "arabic"));
  assert.ok(ROUTING.length >= 40, `only ${ROUTING.length} routing cases`);
});

test("every question from the real client chat of 2026-11-18 is in the set", () => {
  const all = ROUTING.map((c) => c.message.toLowerCase());
  for (const q of ["kiya tum hamare leads se bat kr sakte ho", "kitne log ha", "jo keyword nikala", "konsa keyword ha", "sainiul ki chat history", "ek image banao black friday"]) {
    assert.ok(all.some((m) => m.includes(q)), `missing: ${q}`);
  }
});

test("the answer cases are built through the SAME prompt production uses (lib/chat-prompt.ts), including the platform knowledge", () => {
  const msgs = buildMessages("hi", {}, { business: "A test business", counts: null, toolResult: "TOOL RESULT" }, []);
  assert.equal(msgs[0].role, "system");
  assert.ok(msgs[0].content.includes(PLATFORM_KNOWLEDGE));
  assert.ok(msgs[0].content.includes("A test business"));
  assert.match(msgs[1].content, /TOOL RESULT/);
  assert.match(msgs[1].content, /only source for this answer/);
  assert.equal(msgs[msgs.length - 1].content, "hi");
  assert.equal(sectionsOf({ toolResult: "x" }), "tool");
  assert.equal(sectionsOf({}), "none");
  const noTool = buildMessages("hi", {}, { business: null, counts: null }, []);
  assert.match(noTool[1].content, /No account data was looked up/);
});

const C = (over: Partial<AnswerCase>): AnswerCase => ({ id: "x", lang: "en", message: "q", tool: "answer_question", fixture: null, why: "a test case", ...over });

test("checkAnswer: must / mustNot / length / script / invented numbers", () => {
  assert.deepEqual(checkAnswer(C({ must: [/whatsapp/i] }), "Yes, through WhatsApp."), []);
  assert.deepEqual(checkAnswer(C({ must: [/whatsapp/i] }), "Yes."), ["should match /whatsapp/i"]);
  assert.match(checkAnswer(C({ mustNot: [/cannot/i] }), "I cannot do that")[0], /must not match/);
  assert.match(checkAnswer(C({ maxChars: 10 }), "this is far too long")[0], /too long/);
  assert.deepEqual(checkAnswer(C({}), ""), ["the reply is empty"]);
  assert.deepEqual(checkAnswer(C({ script: "bengali" }), "হ্যাঁ, পারি"), []);
  assert.match(checkAnswer(C({ script: "bengali" }), "Yes I can")[0], /bengali/);
  assert.match(checkAnswer(C({ script: "latin" }), "Yes نعم")[0], /different script/);
  // numbers: only ones in the fixture or in the customer's own message may appear
  const withData = C({ noInventedNumbers: true, fixture: { total: 2400, n: 6 }, message: "we have 3 staff" });
  assert.deepEqual(checkAnswer(withData, "6 leads, from $2,400, for your 3 staff"), []);
  assert.match(checkAnswer(withData, "about 7 leads")[0], /states 7/);
  assert.deepEqual(numbersIn("$2,400 and 12.5% of 3"), ["2400", "12.5", "3"]);
});

test("the checks catch the real failure: 'I can't message your leads' fails, a correct answer passes", () => {
  const c = ANSWERS.find((a) => a.id === "ans-leads-can-you")!;
  assert.ok(checkAnswer(c, "I can't directly communicate with your leads.").length > 0);
  assert.ok(checkAnswer(c, "Main leads se message nahi kar sakta.").length > 0);
  assert.deepEqual(checkAnswer(c, "Haan, main WhatsApp pe leads se baat karta hoon aur reply bhi deta hoon."), []);
  const g = ANSWERS.find((a) => a.id === "ans-greeting")!;
  assert.ok(checkAnswer(g, "Hi! You have 162 leads and 14 articles waiting.").length > 0, "a greeting answered with a status report fails");
  assert.deepEqual(checkAnswer(g, "Hey! What do you need?"), []);
  const w = ANSWERS.find((a) => a.id === "ans-whatsapp-count")!;
  assert.ok(checkAnswer(w, "Aapka Google Analytics connected nahi hai.").length > 0, "the old refusal fails");
  assert.ok(FIXTURE_STATS.total_leads === 6);
});
