/** The fast path: what a message means before any model is asked.
 *
 *  `detectChatIntent` is the 0ms, ₹0 layer in front of the LLM (plan §5.1). Everything here is
 *  a real message from the product's own chat history, and most of the cases exist because the
 *  product got them wrong in front of a user:
 *
 *   - "no mujhe 30 min bad published karna ha isko" was read as "write another article",
 *     because "isko" (this one) was not understood as pointing at what had just been written;
 *   - "no publish mat karna" was read as an order to publish, because the negation was lost —
 *     the single most expensive class of mistake this product can make;
 *   - the literal string "null" arrived as a topic and was researched as a subject.
 *
 *  These lived in a scratch runner and protected nothing. They are in the repo now because
 *  this function decides whether a user's sentence turns into work, and a regression here is
 *  invisible until someone's article is on their live site.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectChatIntent, isRealTopic, wantsAutoPublish } from "./chat-intent";
import { parseWhen } from "./when";

const TZ = "Asia/Calcutta";
const NOW = new Date("2026-08-26T10:32:00.000Z"); // Wed 26 Aug 2026, 16:02 IST

/** One message, three questions: what kind of order is it, does it also ask to go live, and
 *  when. They are asked together because a message means all three at once, and the bugs have
 *  always been in the combination rather than in any one of them. */
function reads(msg: string, kind: string | null, publish: boolean, minutes: number | null) {
  const i = detectChatIntent(msg);
  const w = parseWhen(msg, TZ, NOW);
  const gotMinutes = w ? Math.round((w.at.getTime() - NOW.getTime()) / 60000) : null;

  assert.equal(i ? i.kind : null, kind, `${JSON.stringify(msg)} → kind`);
  assert.equal(wantsAutoPublish(msg), publish, `${JSON.stringify(msg)} → publish?`);
  assert.equal(gotMinutes, minutes, `${JSON.stringify(msg)} → when (minutes)`);
}

test("the two messages that started all of this", () => {
  // Wants a NEW article, published, in 30 minutes. Previously: started writing immediately.
  reads("mujhe 30mmin bad ek artical ko apne webiset pe published karna ha ok tum schule kar sakte ho", null, true, 30);
  // "isko" = the article that had just been written. Previously: read as "write another one".
  reads("no mujhe 30 min bad published karna ha isko", "publish", true, 30);
});

test("publishing something that already exists is not writing a new one", () => {
  reads("isko publish kar do", "publish", true, null);
  reads("ise abhi live kar do", "publish", true, null);
  reads("publish the last one", "publish", true, null);
  reads("kal 9 baje isko publish karna", "publish", true, 16 * 60 + 58);
});

test("write, with and without publishing", () => {
  reads("write an article about solar panels", "write", false, null);
  reads("solar panels pe ek article likh kar publish kar do", "write", true, null);
  reads("30 min baad solar panels pe article likho", "write", false, 30);
  reads("ek article likho, no need to publish", "write", false, null);
  reads("ek article likho lekin publish mat karna", "write", false, null);
  reads("artical nahi likhna, sirf keyword nikalo", "research", false, null);
});

test("a negation is a refusal, never an instruction — the most expensive mistake available", () => {
  // "publish mat karna" must not become a publish, and must not cancel anything either.
  reads("no publish mat karna", null, false, null);
  reads("sirf draft banao, publish nahi", null, false, null);
  reads("don't write it", null, false, null);
});

test("a question is a question — it must never quietly become work", () => {
  reads("kya update hai", null, false, null);
  reads("tum kon ho", null, false, null);
  reads("kiya mere system pe kuch schudule ha ?", null, false, null);
  reads("article kaise likhte ho", null, false, null);
});

test("the string 'null' is not a topic, and neither is a sentence with no subject in it", () => {
  for (const bad of ["null", "None", "undefined", "n/a", "--", "mujhe 30mmin bad ko apne webiset", "i want an article"]) {
    assert.equal(isRealTopic(bad), false, `${JSON.stringify(bad)} must not be researched as a subject`);
  }
});

test("a real subject is recognised as one", () => {
  for (const good of ["solar panel cleaning", "ISO 9001 certification", "local SEO"]) {
    assert.equal(isRealTopic(good), true, `${JSON.stringify(good)} is a topic`);
  }
});
