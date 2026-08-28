/** Run: cd agent-server && npx tsx --test src/workers.test.ts
 *
 *  Only `concurrencyFor` is under test — startWorkers() itself needs a real pg-boss/Postgres
 *  connection and is exercised by hand (docs/MANUAL_STEPS.md), same as every other
 *  boss.work()/boss.send() wiring in this codebase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { concurrencyFor } = await import("./workers.js");

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
