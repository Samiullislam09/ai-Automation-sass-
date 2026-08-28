/** Run: npx tsx --test lib/dashboard-data.test.ts
 *
 *  Only `summarizeCostRows` (MASTER_PLAN §13 Phase 4 cost dashboard) is under test —
 *  everything else in dashboard-data.ts takes a live SupabaseClient and is exercised by hand,
 *  same as every other Supabase-touching function in this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeCostRows } from "./dashboard-data.js";

test("sums usd and tokens across rows that carry a cost", () => {
  const rows = [
    { agent: "writer", detail: { cost: { tokens: 5000, calls: 6, usd: 0.0015 } } },
    { agent: "writer", detail: { cost: { tokens: 3000, calls: 4, usd: 0.0009 } } },
  ];
  const out = summarizeCostRows(rows);
  assert.equal(out.totalTokens, 8000);
  assert.equal(out.totalUsd, 0.0024);
  assert.equal(out.jobsWithCost, 2);
});

test("rows with no cost field (an agent that made no LLM calls, e.g. publish) are skipped, not zero-counted", () => {
  const rows = [
    { agent: "publish", detail: { published: true } },
    { agent: "writer", detail: { cost: { tokens: 1000, calls: 1, usd: 0.0003 } } },
  ];
  const out = summarizeCostRows(rows);
  assert.equal(out.jobsWithCost, 1);
  assert.equal(out.byAgent.publish, undefined);
});

test("older rows (no detail at all, or detail null) don't crash the summary", () => {
  const rows = [
    { agent: "keyword", detail: null },
    { agent: "keyword", detail: undefined },
    { agent: "keyword", detail: { cost: { tokens: 200, calls: 1, usd: 0.00006 } } },
  ];
  const out = summarizeCostRows(rows);
  assert.equal(out.jobsWithCost, 1);
  assert.equal(out.totalTokens, 200);
});

test("byAgent buckets separately, and each bucket's own usd is rounded independently", () => {
  const rows = [
    { agent: "writer", detail: { cost: { tokens: 100000, calls: 6, usd: 0.030001 } } },
    { agent: "keyword", detail: { cost: { tokens: 10000, calls: 1, usd: 0.003 } } },
  ];
  const out = summarizeCostRows(rows);
  assert.equal(out.byAgent.writer.usd, 0.03);
  assert.equal(out.byAgent.keyword.usd, 0.003);
  assert.equal(out.byAgent.writer.jobs, 1);
});

test("a cost.usd that isn't a number (corrupt row) is treated as no cost", () => {
  const rows = [{ agent: "writer", detail: { cost: { tokens: 100, usd: "not-a-number" } } }];
  const out = summarizeCostRows(rows);
  assert.equal(out.jobsWithCost, 0);
  assert.equal(out.totalUsd, 0);
});

test("an empty row set returns all-zero, not throwing or undefined fields", () => {
  const out = summarizeCostRows([]);
  assert.deepEqual(out, { totalUsd: 0, totalTokens: 0, jobsWithCost: 0, byAgent: {} });
});

test("a missing/empty agent name buckets under \"unknown\" rather than dropping the cost", () => {
  const rows = [{ agent: "", detail: { cost: { tokens: 500, usd: 0.0002 } } }];
  const out = summarizeCostRows(rows);
  assert.equal(out.byAgent.unknown.usd, 0.0002);
});
