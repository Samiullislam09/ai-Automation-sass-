/** Run: cd agent-server && npx tsx --test src/brain/adapter.test.ts
 *
 *  Found live 2026-08-31: boss.pick_topic's step returned a bare string, workers.ts's own
 *  withCost() silently wrapped it as `{ value: "<topic>", cost }` before it ever reached
 *  task_steps.output, and translate() then handed Mr. Keyword/Mr. Writer that whole object as
 *  `topic` — "topic?.trim is not a function", a task stuck in needs_attention with 0 of its
 *  real steps ever completing. Nothing in the suite exercised translate() against what a
 *  resolved `__from` value actually looks like once withCost() has touched it, so this file
 *  exists to make sure that specific shape is never silently un-handled again. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { translate } = await import("./adapter.js");

test("keyword.find_keywords: a literal topic string survives untouched", () => {
  const { data } = translate("keyword", "find_keywords", { topic: "solar panels" });
  assert.equal(data.topic, "solar panels");
});

test("keyword.find_keywords: boss.pick_topic's resolved output ({ topic, why, cost }) unwraps to a plain string", () => {
  // Exactly the shape resolveInput() hands over once workers.ts's withCost() has merged `cost`
  // into boss's `{ topic, why }` return value — see boss.ts's own comment on why it is an
  // object and not a bare string.
  const resolved = { topic: "ISO 14001 certification cost in UAE", why: "content gap", cost: { tokens: 1208, calls: 1, usd: 0.0004 } };
  const { data } = translate("keyword", "find_keywords", { topic: resolved });
  assert.equal(data.topic, "ISO 14001 certification cost in UAE");
  assert.equal(typeof data.topic, "string", "must be a plain string — keyword.ts calls topic?.trim() on it");
});

test("writer.write_article: the same resolved-object shape unwraps too, and taskLabel never shows [object Object]", () => {
  const resolved = { topic: "solar panel ROI", cost: { tokens: 500, calls: 1, usd: 0.0002 } };
  const { data } = translate("writer", "write_article", { topic: resolved, keywords: { relatedKeywords: [] } });
  assert.equal(data.topic, "solar panel ROI");
  assert.equal(data.taskLabel, 'Writing "solar panel ROI"');
});

test("a topic that resolves to null (the provider step never ran) is undefined, not a crash", () => {
  const { data } = translate("keyword", "find_keywords", { topic: null });
  assert.equal(data.topic, undefined);
});
