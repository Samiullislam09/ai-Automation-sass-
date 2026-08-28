/** Run: cd agent-server && npx tsx --test src/scheduler.test.ts
 *
 *  isDue and jitterMinutes only — the rest of scheduler.ts (tick/tickOrders/tickAudits)
 *  reads Supabase and enqueues real jobs, exercised by hand (docs/MANUAL_STEPS.md), same as
 *  every other boss.work()/boss.send() wiring in this codebase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { isDue, jitterMinutes, pickDueKeyword } = await import("./scheduler.js");

const UTC = "UTC";

function row(overrides: Partial<{ id: string; frequency: string; day_of_week: number; time_of_day: string; timezone: string; last_run_at: string | null }> = {}) {
  return {
    id: "row-a",
    frequency: "daily",
    day_of_week: 0,
    time_of_day: "09:00",
    timezone: UTC,
    last_run_at: null,
    ...overrides,
  };
}

/* ---------------------------------------------------------------- jitterMinutes ---------- */

test("jitterMinutes is deterministic — same id always gives the same offset", () => {
  const a = jitterMinutes("tenant-123");
  const b = jitterMinutes("tenant-123");
  assert.equal(a, b);
});

test("jitterMinutes stays within the plan's own ±30 minute range", () => {
  for (const id of ["a", "row-a", "row-b", "11111111-1111-1111-1111-111111111111", "z".repeat(40)]) {
    const j = jitterMinutes(id);
    assert.ok(j >= -30 && j <= 30, `jitter for "${id}" was ${j}, outside [-30, 30]`);
  }
});

test("different ids spread across the range, not all to the same offset", () => {
  const ids = Array.from({ length: 50 }, (_, i) => `tenant-${i}`);
  const offsets = new Set(ids.map(jitterMinutes));
  assert.ok(offsets.size > 10, `only ${offsets.size} distinct offsets across 50 ids — jitter is not spreading`);
});

/* ---------------------------------------------------------------- isDue ------------------- */

test("fires inside its jittered window, not at the raw time_of_day when jitter is nonzero", () => {
  const r = row({ id: "spread-me", time_of_day: "09:00" });
  const j = jitterMinutes("spread-me");
  const slotMinutes = ((9 * 60 + j) % 1440 + 1440) % 1440;
  const dueAt = new Date(Date.UTC(2026, 0, 5, Math.floor(slotMinutes / 60), slotMinutes % 60));
  assert.equal(isDue(r, dueAt), true);
});

test("two different schedules for the same time_of_day are NOT both due at the raw time_of_day, unless jitter happens to be 0", () => {
  const rawNine = new Date(Date.UTC(2026, 0, 5, 9, 0));
  const results = Array.from({ length: 30 }, (_, i) => isDue(row({ id: `sched-${i}`, time_of_day: "09:00" }), rawNine));
  // At least one of 30 differently-jittered schedules should NOT be due at exactly the raw
  // 09:00 mark — if every single one were, jitter would not be doing anything.
  assert.ok(results.some((due) => due === false), "every schedule fired at the exact same minute — jitter had no effect");
});

test("does not fire before its window, does not fire long after it", () => {
  const r = row({ id: "fixed", time_of_day: "09:00" });
  const j = jitterMinutes("fixed");
  const slotMinutes = ((9 * 60 + j) % 1440 + 1440) % 1440;
  const before = new Date(Date.UTC(2026, 0, 5, Math.floor((slotMinutes - 1 + 1440) / 60) % 24, (slotMinutes - 1 + 1440) % 60));
  const wayAfter = new Date(Date.UTC(2026, 0, 5, Math.floor((slotMinutes + 60) / 60) % 24, (slotMinutes + 60) % 60));
  assert.equal(isDue(r, before), false);
  assert.equal(isDue(r, wayAfter), false);
});

test("already run today (same local date) does not fire again, jitter or not", () => {
  const r = row({ id: "already-ran", time_of_day: "09:00", last_run_at: new Date(Date.UTC(2026, 0, 5, 9, 0)).toISOString() });
  const j = jitterMinutes("already-ran");
  const slotMinutes = ((9 * 60 + j) % 1440 + 1440) % 1440;
  const dueAt = new Date(Date.UTC(2026, 0, 5, Math.floor(slotMinutes / 60), slotMinutes % 60));
  assert.equal(isDue(r, dueAt), false);
});

test("weekly frequency still gates on day_of_week, jitter does not bypass it", () => {
  // 2026-01-05 is a Monday (day_of_week 1). Ask for Tuesday (2) only.
  const r = row({ id: "weekly-one", frequency: "weekly", day_of_week: 2, time_of_day: "09:00" });
  const monday = new Date(Date.UTC(2026, 0, 5, 9, 30));
  assert.equal(isDue(r, monday), false);
});

test("an invalid timezone is refused, not thrown", () => {
  const r = row({ timezone: "Not/ARealZone" });
  assert.equal(isDue(r, new Date()), false);
});

/* ---------------------------------------------------------------- pickDueKeyword --------- */

const NOW = new Date("2026-08-28T12:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

test("a keyword never checked before is due", () => {
  const articles = [{ id: "a1", primary_keyword: "emergency plumber leeds" }];
  const due = pickDueKeyword(articles, new Map(), NOW);
  assert.equal(due?.id, "a1");
});

test("a keyword checked less than a week ago is not due", () => {
  const articles = [{ id: "a1", primary_keyword: "emergency plumber leeds" }];
  const lastCheckedAt = new Map([["emergency plumber leeds", NOW.getTime() - WEEK_MS / 2]]);
  assert.equal(pickDueKeyword(articles, lastCheckedAt, NOW), undefined);
});

test("a keyword checked more than a week ago is due again", () => {
  const articles = [{ id: "a1", primary_keyword: "emergency plumber leeds" }];
  const lastCheckedAt = new Map([["emergency plumber leeds", NOW.getTime() - WEEK_MS - 1000]]);
  const due = pickDueKeyword(articles, lastCheckedAt, NOW);
  assert.equal(due?.id, "a1");
});

test("picks the first due keyword in the given (oldest-first) order, not just any", () => {
  const articles = [
    { id: "recent", primary_keyword: "kw-recent" },
    { id: "overdue", primary_keyword: "kw-overdue" },
  ];
  const lastCheckedAt = new Map([
    ["kw-recent", NOW.getTime() - 1000],
    ["kw-overdue", NOW.getTime() - WEEK_MS - 1000],
  ]);
  const due = pickDueKeyword(articles, lastCheckedAt, NOW);
  assert.equal(due?.id, "overdue");
});

test("an empty article list has nothing due", () => {
  assert.equal(pickDueKeyword([], new Map(), NOW), undefined);
});
