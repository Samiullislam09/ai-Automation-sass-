/** Run: cd agent-server && npx tsx --test src/workers.test.ts
 *
 *  `concurrencyFor` and `withCost` are under test — startWorkers()/processJob() themselves need
 *  a real pg-boss/Postgres connection and are exercised by hand (docs/MANUAL_STEPS.md), same as
 *  every other boss.work()/boss.send() wiring in this codebase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { concurrencyFor, withCost } = await import("./workers.js");

test("every non-writer agent stays at 2, unaffected by WRITER_CONCURRENCY", () => {
  process.env.WRITER_CONCURRENCY = "8";
  for (const type of ["boss", "keyword", "social", "seo", "leads", "crawler", "analyst", "publish", "audit"] as const) {
    assert.equal(concurrencyFor(type), 2);
  }
  delete process.env.WRITER_CONCURRENCY;
});

test("writer defaults to 4 (the plan's floor) with no env var set", () => {
  delete process.env.WRITER_CONCURRENCY;
  assert.equal(concurrencyFor("writer"), 4);
});

test("WRITER_CONCURRENCY is honoured within the plan's 4-8 range", () => {
  process.env.WRITER_CONCURRENCY = "6";
  assert.equal(concurrencyFor("writer"), 6);
  delete process.env.WRITER_CONCURRENCY;
});

test("WRITER_CONCURRENCY above 8 is clamped to the plan's own ceiling", () => {
  process.env.WRITER_CONCURRENCY = "50";
  assert.equal(concurrencyFor("writer"), 8);
  delete process.env.WRITER_CONCURRENCY;
});

test("WRITER_CONCURRENCY below 4 is clamped up to the plan's own floor", () => {
  process.env.WRITER_CONCURRENCY = "1";
  assert.equal(concurrencyFor("writer"), 4);
  delete process.env.WRITER_CONCURRENCY;
});

test("garbage WRITER_CONCURRENCY falls back to the floor, not to NaN or 0", () => {
  process.env.WRITER_CONCURRENCY = "not-a-number";
  assert.equal(concurrencyFor("writer"), 4);
  delete process.env.WRITER_CONCURRENCY;
});

/* ---------------------------------------------------------------- withCost --------------- */

test("withCost folds cost onto a plain-object result without dropping its own fields", () => {
  const out: any = withCost({ topic: "x", wordCount: 800 }, { tokens: 5000, calls: 3, costUsd: 0.0015 });
  assert.equal(out.topic, "x");
  assert.equal(out.wordCount, 800);
  assert.deepEqual(out.cost, { tokens: 5000, calls: 3, usd: 0.0015 });
});

test("withCost rounds usd to 4 decimal places", () => {
  const out: any = withCost({}, { tokens: 1234, calls: 1, costUsd: 0.00037019999999 });
  assert.equal(out.cost.usd, 0.0004);
});

test("withCost falls back to a {value, cost} wrapper for a non-object result", () => {
  const out: any = withCost("just a string", { tokens: 0, calls: 0, costUsd: 0 });
  assert.equal(out.value, "just a string");
  assert.deepEqual(out.cost, { tokens: 0, calls: 0, usd: 0 });
});

test("withCost falls back to a wrapper for null too, rather than spreading it away", () => {
  const out: any = withCost(null, { tokens: 0, calls: 0, costUsd: 0 });
  assert.equal(out.value, null);
  assert.deepEqual(out.cost, { tokens: 0, calls: 0, usd: 0 });
});

test("withCost falls back to a wrapper for an array result", () => {
  const out: any = withCost([1, 2, 3], { tokens: 10, calls: 1, costUsd: 0.000003 });
  assert.deepEqual(out.value, [1, 2, 3]);
});
