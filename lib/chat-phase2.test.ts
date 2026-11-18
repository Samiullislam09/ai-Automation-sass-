/** Phase 2: a yes / no / value read by the model in any language, and system messages in the customer's language. No network: the model is injected. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFollowUpSmart, readAnswer, CONFIRM_SLOT, type ConversationState } from "./chat-conversation";
import { localizeOrder } from "./chat-localize";

const NOW = new Date("2026-11-18T12:00:00Z");
const state = (slot: string, expired = false): ConversationState => ({
  conversation_id: "c", tenant_id: "t", asked_slot: slot, turn_no: 1,
  expires_at: new Date(NOW.getTime() + (expired ? -1000 : 600_000)).toISOString(),
  pending_intent: { v: 1, route: "legacy", action: "legacy:unpublish", echo: "Take the article off the site?", message: "x", legacy: { kind: "unpublish" } },
});
const reads = (answer: string, value: string | null = null) => async () => ({ answer: answer as any, value });

test("a Spanish yes confirms and a Spanish no cancels — the keyword list knew neither", async () => {
  assert.equal((await resolveFollowUpSmart("sí, adelante", state(CONFIRM_SLOT), NOW, reads("yes"))).kind, "confirm");
  assert.equal((await resolveFollowUpSmart("no, mejor déjalo", state(CONFIRM_SLOT), NOW, reads("no"))).kind, "cancel");
  assert.equal((await resolveFollowUpSmart("نعم", state(CONFIRM_SLOT), NOW, reads("yes"))).kind, "confirm");
});

test("safety: a keyword refusal beats a model yes; an answer that is neither lapses; an expired order never runs; nothing pending = no model call", async () => {
  assert.equal((await resolveFollowUpSmart("haan lekin publish mat karna", state(CONFIRM_SLOT), NOW, reads("yes"))).kind, "cancel");
  assert.equal((await resolveFollowUpSmart("what is my schedule?", state(CONFIRM_SLOT), NOW, reads("other"))).kind, "lapsed");
  assert.equal((await resolveFollowUpSmart("yes", state(CONFIRM_SLOT, true), NOW, reads("yes"))).kind, "lapsed");
  let calls = 0;
  const none = await resolveFollowUpSmart("hola", null, NOW, async () => { calls++; return null; });
  assert.equal(none.kind, "none");
  assert.equal(calls, 0);
});

test("the model's reading fills a slot with just the detail, or hands the choice back; an unreachable model falls back to the keyword reading", async () => {
  const slot = state("topic");
  const v: any = await resolveFollowUpSmart("pues sobre certificaciones iso", slot, NOW, reads("value", "certificaciones ISO"));
  assert.deepEqual([v.kind, v.slot, v.value], ["slot", "topic", "certificaciones ISO"]);
  const h: any = await resolveFollowUpSmart("tú decide", slot, NOW, reads("hand_back"));
  assert.deepEqual([h.kind, h.value], ["slot", null]);
  assert.equal((await resolveFollowUpSmart("haan", state(CONFIRM_SLOT), NOW, async () => null)).kind, "confirm", "model down: the old reading still works");
  assert.equal((await resolveFollowUpSmart("nahi", state(CONFIRM_SLOT), NOW, async () => { throw new Error("down"); })).kind, "cancel");
});

test("readAnswer parses the model's JSON and rejects anything else", async () => {
  const p = state(CONFIRM_SLOT).pending_intent!;
  assert.deepEqual(await readAnswer("sí", p, CONFIRM_SLOT, async () => ({ answer: "yes", value: "" }) as any), { answer: "yes", value: null });
  assert.equal(await readAnswer("?", p, CONFIRM_SLOT, async () => ({ answer: "maybe" }) as any), null);
  assert.equal(await readAnswer("?", p, CONFIRM_SLOT, async () => null), null);
});

test("localizeOrder rewrites text, card title/detail and button labels, leaves button payloads alone, and survives a dead model", async () => {
  const order = {
    text: "Ek baar confirm kar dijiye.",
    event: {
      title: "Ye article abhi live site se hata dun?",
      detail: "Ye wapas nahi liya ja sakta.",
      actions: [
        { label: "Haan, karo", action: "confirm", payload: { text: "haan, kar do" } },
        { label: "Nahi", action: "cancel", payload: { text: "nahi, rehne do" } },
      ],
    },
  };
  const fake = async () => ({ text: "Please confirm once.", title: "Take this article off the live site?", detail: "This cannot be undone.", labels: ["Yes, do it", "No"] }) as any;
  const out = await localizeOrder(order, "take it down please", { chatJsonImpl: fake });
  assert.equal(out.text, "Please confirm once.");
  assert.equal(out.event?.title, "Take this article off the live site?");
  assert.deepEqual(out.event?.actions?.map((a) => a.label), ["Yes, do it", "No"]);
  assert.deepEqual(out.event?.actions?.map((a) => a.payload), [{ text: "haan, kar do" }, { text: "nahi, rehne do" }], "a click still sends what it always sent");
  assert.deepEqual(await localizeOrder(order, "take it down", { chatJsonImpl: async () => null }), order, "dead model: the original goes out");
  assert.deepEqual(await localizeOrder(order, "", { chatJsonImpl: fake }), order);
  const onlyEvent = await localizeOrder({ text: "Model wrote this.", event: order.event }, "hola", { chatJsonImpl: fake, text: false });
  assert.equal(onlyEvent.text, "Model wrote this.", "a sentence the model wrote for the customer is never rewritten");
});
