/** Run: npx tsx --test lib/chat-model.test.ts
 *
 *  THE ONE THING THIS FILE EXISTS FOR. On 2026-09-18 the brain's fallback was set to
 *  `openai/gpt-oss-120b` because that had been the primary for weeks and was assumed to work.
 *  It does not: NIM answers every call to it with HTTP 410, "has reached its end of life on
 *  2026-09-03". It is STILL LISTED by GET /v1/models, so nothing short of a real request reveals
 *  it — and a dead fallback is invisible until the primary has already failed, which is the
 *  worst possible moment to discover it.
 *
 *  So this asserts the invariant a catalogue listing cannot: no model known to be retired may
 *  appear in the chat's own model order. When a model on this list comes back, delete it from
 *  the list — after calling it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_MODEL, CHAT_FALLBACK_MODEL, chatModelsInOrder, modelParams } from "./chat-model";

/** Models measured returning HTTP 410 from NIM, with the date NIM reported. */
const RETIRED_ON_NIM = [{ model: "openai/gpt-oss-120b", eol: "2026-09-03" }];

test("no retired model is in the chat's model order", () => {
  const order = chatModelsInOrder();
  for (const { model, eol } of RETIRED_ON_NIM) {
    assert.ok(
      !order.includes(model),
      `${model} reached end of life on NIM (${eol}) and returns HTTP 410 — it cannot be the primary OR the fallback. Current order: ${order.join(", ")}`,
    );
  }
});

test("the fallback is a different model from the primary, or the order is one model long", () => {
  const order = chatModelsInOrder();
  assert.equal(new Set(order).size, order.length, "trying the same dead model twice is not a fallback");
  if (CHAT_MODEL === CHAT_FALLBACK_MODEL) assert.equal(order.length, 1);
  else assert.equal(order.length, 2);
});

test("every model in the order gets its own reasoning-off switch", () => {
  // Sending the wrong one is worse than sending none: gpt-oss without reasoning_effort returns
  // empty content, and a Nemotron without thinking:false streams its scratchpad as the answer.
  for (const model of chatModelsInOrder()) {
    const params = modelParams(model);
    assert.notDeepEqual(params, {}, `${model} has no reasoning-off switch — add a branch to modelParams`);
  }
});

test("modelParams picks the switch by the model actually being sent", () => {
  assert.deepEqual(modelParams("nvidia/nemotron-3-ultra-550b-a55b"), { chat_template_kwargs: { thinking: false } });
  assert.deepEqual(modelParams("nvidia/nemotron-3-super-120b-a12b"), { chat_template_kwargs: { thinking: false } });
  assert.deepEqual(modelParams("openai/gpt-oss-120b"), { reasoning_effort: "low" });
  assert.deepEqual(modelParams("some/unknown-model"), {});
});
