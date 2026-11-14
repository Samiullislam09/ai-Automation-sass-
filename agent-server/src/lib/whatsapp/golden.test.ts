/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/golden.test.ts
 *
 *  OFFLINE half of the golden conversations (golden.ts): what the engine DETECTS and what the model
 *  would be TOLD for each scenario. No network, no model. The live half is golden.live.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { SCENARIOS, EMPTY_PROMISE, SORRY_FOR_DELAY } = await import("./golden.js");
const { buildReplyPrompt, loadRecentThread, REPLY_SYSTEM } = await import("./decide.js");
const { classifyLanguage, detectLanguage, detectSignals, conversationStage, mustHandOff } = await import("./conversation.js");

for (const sc of SCENARIOS) {
  test(`golden/${sc.id}: ${sc.why}`, () => {
    const built = buildReplyPrompt({ business: "Business name: wca-global.com", pricingProvided: sc.pricing, lead: null, thread: sc.thread, knowledge: sc.knowledge });
    assert.equal(built.lang, sc.expect.lang, "reply language");
    assert.equal(built.handoffFloor.yes, sc.expect.handoff, `handoff floor (${built.handoffFloor.reason || "none"})`);
    // The model is always told the language and always sees the customer's newest line last.
    assert.match(built.user, /REPLY LANGUAGE:/);
    const lastIn = [...sc.thread].reverse().find((m) => m.direction === "in")!;
    assert.ok(built.user.trimEnd().includes(`THEM: ${lastIn.body}`), "the newest customer message is in the transcript");
    assert.ok(built.user.indexOf(`THEM: ${lastIn.body}`) > built.user.indexOf("THE CONVERSATION SO FAR"), "…inside the transcript");
    // Website facts reach the model exactly when there are some, and only then.
    if (sc.knowledge?.length) {
      assert.match(built.user, /FACTS FROM OUR WEBSITE \(passages/);
      assert.ok(built.user.includes(sc.knowledge[0].text.slice(0, 40)));
    } else {
      assert.doesNotMatch(built.user, /FACTS FROM OUR WEBSITE \(passages/);
    }
  });
}

test("the system prompt carries the rules that stopped the 2026-11-13 failures", () => {
  assert.match(REPLY_SYSTEM, /CANNOT send files/);
  assert.match(REPLY_SYSTEM, /NEVER repeat or rephrase/);
  assert.match(REPLY_SYSTEM, /ANSWER THEIR QUESTION FIRST/);
  assert.match(REPLY_SYSTEM, /never claim to be a human/i);
  assert.match(REPLY_SYSTEM, /Do NOT apologise for delays/);
  assert.match(REPLY_SYSTEM, /do NOT guess and do NOT fill the gap with general knowledge/);
});

test("price: the model is told to lead with the price when we hold one, and to hand off when we do not", () => {
  const thread = SCENARIOS.find((s) => s.id === "price-given")!.thread;
  const given = buildReplyPrompt({ business: "x", pricingProvided: true, lead: null, thread });
  assert.match(given.user, /state the pricing from the facts in your FIRST sentence/);
  const none = buildReplyPrompt({ business: "x", pricingProvided: false, lead: null, thread });
  assert.match(none.user, /published NO price you may quote/);
  assert.match(none.user, /cannot share the price right now/);
  assert.match(none.user, /Set handoff true/);
});

test("the stock-apology loop and the empty promise are exactly what the live checks reject", () => {
  // The four real replies from the client chat.
  for (const t of [
    "Sorry for the delay — I'll send the ISO 9001 outline right away. Best email or WhatsApp number to share it?",
    "Sorry for the delay — I'll send the ISO 9001 outline now.",
    "Sorry for the delay — I was preparing the ISO 9001 outline. I'll send it now.",
    "Sorry for the delay. I'm here now — sending the ISO 9001 outline shortly.",
  ]) assert.ok(SORRY_FOR_DELAY.test(t), t);
  assert.ok(EMPTY_PROMISE.test("I'll send the ISO 9001 outline now."));
  assert.ok(EMPTY_PROMISE.test("I'll share the outline right away."));
  assert.ok(!EMPTY_PROMISE.test("ISO 9001 usually takes 3-4 months. How many employees do you have?"));
});

test("language: Hinglish vs English vs Devanagari, and a bare 'Ok' never flips it", () => {
  assert.equal(classifyLanguage("Tum message karke kaha chale jate ho ? Reply pe itna time kiyoun"), "hinglish");
  assert.equal(classifyLanguage("Yaha pe vejo jaldi"), "hinglish");
  assert.equal(classifyLanguage("haan batao, iska price kitna hoga bhai"), "hinglish");
  assert.equal(classifyLanguage("Ok give me some information about iso"), "en");
  assert.equal(classifyLanguage("Give me price"), "en");
  assert.equal(classifyLanguage("I would like to know more about your services"), "en");
  assert.equal(classifyLanguage("आपकी कीमत क्या है"), "hi");
  assert.equal(classifyLanguage("Ok"), null);
  assert.equal(classifyLanguage("[Voice message]"), null);
  assert.equal(detectLanguage([{ direction: "in", body: "mujhe iso chahiye, kitna time lagega" }, { direction: "out", body: "3-4 mahine" }, { direction: "in", body: "Ok" }]), "hinglish");
});

test("signals: the things a customer asks for are read correctly", () => {
  assert.ok(detectSignals("Give me price").price);
  assert.ok(detectSignals("iska rate kya hai").price);
  assert.ok(detectSignals("how much will it cost").price);
  assert.ok(detectSignals("send the outline please").document);
  assert.ok(detectSignals("Tum message karke kaha chale jate ho ? Reply pe itna time kiyoun").delayComplaint);
  assert.ok(detectSignals("Who are you ?").whoAreYou);
  assert.ok(detectSignals("aap kaun ho").whoAreYou);
  assert.ok(detectSignals("are you a bot").botQuestion);
  assert.ok(detectSignals("this is a scam").angry);
  assert.ok(detectSignals("please call me").wantsCall);
  // and the plain ones are NOT over-read
  const calm = detectSignals("Sounds good, tell me about the timeline");
  assert.equal(calm.angry, false);
  assert.equal(calm.price, false);
  assert.equal(calm.document, false);
});

test("stage: first reply, returning after silence, mid-conversation", () => {
  const h = (n: number) => new Date(Date.UTC(2026, 10, 13, 12) + n * 3_600_000).toISOString();
  assert.equal(conversationStage([{ direction: "out", body: "hi", created_at: h(0) }, { direction: "in", body: "yes", created_at: h(1) }]), "first_reply");
  assert.equal(conversationStage([
    { direction: "out", body: "a", created_at: h(0) }, { direction: "in", body: "b", created_at: h(1) },
    { direction: "out", body: "c", created_at: h(2) }, { direction: "in", body: "d", created_at: h(60) },
  ]), "returning");
  assert.equal(conversationStage([
    { direction: "out", body: "a", created_at: h(0) }, { direction: "in", body: "b", created_at: h(1) },
    { direction: "out", body: "c", created_at: h(2) }, { direction: "in", body: "d", created_at: h(3) },
  ]), "engaged");
});

test("escalation floor: upset / document / call / unpriced price always pull a person in", () => {
  assert.equal(mustHandOff(detectSignals("this is a scam"), true).yes, true);
  assert.equal(mustHandOff(detectSignals("send the outline"), true).yes, true);
  assert.equal(mustHandOff(detectSignals("call me"), true).yes, true);
  assert.equal(mustHandOff(detectSignals("what is the price"), false).yes, true);
  assert.equal(mustHandOff(detectSignals("what is the price"), true).yes, false, "a known price is just answered");
  assert.equal(mustHandOff(detectSignals("sounds good"), false).yes, false);
});

test("history: the NEWEST messages are what the model reads once a chat passes 30", async () => {
  // 40 messages, m1 (oldest) … m40 (newest). The old query (ascending + limit 30) returned m1..m30
  // and the model never saw m40 — the root of the 2026-11-13 repetition.
  const all = Array.from({ length: 40 }, (_, i) => ({ direction: i % 2 ? "out" : "in", body: `m${i + 1}`, created_at: new Date(1_700_000_000_000 + i * 60_000).toISOString() }));
  const fake: any = {
    from: () => {
      let asc = true, lim = 1000;
      const q: any = {
        select: () => q, eq: () => q,
        order: (_c: string, o: { ascending: boolean }) => { asc = o.ascending; return q; },
        limit: (n: number) => { lim = n; const rows = (asc ? all : [...all].reverse()).slice(0, lim); return Promise.resolve({ data: rows, error: null }); },
      };
      return q;
    },
  };
  const thread = await loadRecentThread(fake, "t", "l", 30);
  assert.equal(thread.length, 30);
  assert.equal(thread[thread.length - 1].body, "m40", "newest last");
  assert.equal(thread[0].body, "m11", "oldest of the window first");
});
