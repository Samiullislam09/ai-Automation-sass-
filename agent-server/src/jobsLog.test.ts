import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://unit-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";
process.env.DATABASE_URL ||= "postgres://unit-test/none";

const { trimJobDetail } = await import("./jobsLog.js");

test("drops the whole-article body Mr. Writer used to file as its receipt", () => {
  const out: any = trimJobDetail({
    topic: "how to clean a rug",
    title: "How to clean a rug",
    body: "x".repeat(15_000),
    blueprint: { sections: ["a", "b"] },
    wordCount: 1420,
    contentItemId: "abc",
  });
  assert.equal(out.body, undefined);
  assert.equal(out.blueprint, undefined);
  // Everything describeJob() actually reads survives.
  assert.equal(out.title, "How to clean a rug");
  assert.equal(out.wordCount, 1420);
  assert.equal(out.contentItemId, "abc");
});

test("drops the audit's per-page table but keeps the rest of its run block", () => {
  const out: any = trimJobDetail({
    score: 72,
    issues: new Array(40).fill({ what: "w", fix: "f" }),
    run: { seconds: 310, trigger: "schedule", pages: new Array(200).fill({ url: "u", words: 900 }) },
  });
  assert.equal(out.issues, undefined);
  assert.equal(out.run.pages, undefined);
  assert.equal(out.run.seconds, 310);
  assert.equal(out.run.trigger, "schedule");
  assert.equal(out.score, 72);
});

test("an unforeseen giant falls back to the keys the dashboard is known to read", () => {
  const out: any = trimJobDetail({
    message: "Finished.",
    cost: { usd: 0.02 },
    somethingNobodyPlannedFor: "y".repeat(20_000),
  });
  assert.equal(out.detail_trimmed, true);
  assert.equal(out.somethingNobodyPlannedFor, undefined);
  assert.equal(out.message, "Finished.");
  assert.deepEqual(out.cost, { usd: 0.02 });
});

test("a failure keeps what makes it diagnosable, with the cause capped", () => {
  const out: any = trimJobDetail({
    message: "Mr. Writer gave up waiting.",
    cause: "z".repeat(9_000),
    hint: "Redeploy agent-server.",
    attempt: 2,
    attempts: 3,
    durationMs: 61_000,
  });
  assert.equal(out.message, "Mr. Writer gave up waiting.");
  assert.equal(out.hint, "Redeploy agent-server.");
  assert.equal(out.attempt, 2);
  assert.ok(out.cause.length < 2_100, "cause is truncated, not dropped");
  assert.ok(out.cause.endsWith("…[truncated]"));
});

test("leaves a small ordinary receipt exactly as it is", () => {
  const detail = { pagesCrawled: 42, urlsFound: 50, skipped: 8, failures: [] };
  assert.deepEqual(trimJobDetail(detail), detail);
});

test("a non-object detail is passed through rather than mangled", () => {
  assert.equal(trimJobDetail(null), null);
  assert.equal(trimJobDetail("done"), "done");
});
