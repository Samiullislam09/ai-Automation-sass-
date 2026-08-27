/** Run: cd agent-server && npx tsx --test src/agents/boss.test.ts
 *
 *  §25.5, at the planner. A duplicate has to die where the suggestion is made, not three jobs
 *  later in the writer: by then the user has already been told "planning 3 articles" and two of
 *  them quietly never appear. So the planner checks every topic before anything is enqueued,
 *  drops what is already covered, and REPORTS THE COUNT — a planner repeating itself is a
 *  fact the owner should be able to see, not something buried in a log line.
 *
 *  The check is injected, so none of this needs a database. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { dropDuplicateTopics } = await import("./boss.js");
type DuplicateVerdict = import("../lib/dedupe.js").DuplicateVerdict;

const PLAN = [
  { topic: "ISO 9001 cost in India", why: "340 impressions, position 14" },
  { topic: "ISO 27001 gap audit checklist", why: "no page covers it" },
  { topic: "Internal auditor training", why: "already being written" },
];

/** A stand-in for checkDuplicate: whatever the table says, otherwise free. */
function checker(table: Record<string, DuplicateVerdict>) {
  const seen: string[] = [];
  const fn = async (topic: string) => {
    seen.push(topic);
    return table[topic] ?? ({ status: "free" } as DuplicateVerdict);
  };
  return { fn, seen };
}

test("a topic that already exists never reaches the queue, and its page is named", async () => {
  const { fn } = checker({
    "ISO 9001 cost in India": { status: "exists", where: "site_pages", url: "https://x.test/iso-9001-cost", item_id: null, title: "ISO 9001 Cost", slug: "iso-9001-cost" },
  });
  const { kept, dropped } = await dropDuplicateTopics(PLAN, fn);

  assert.deepEqual(kept.map((t) => t.topic), ["ISO 27001 gap audit checklist", "Internal auditor training"]);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].topic, "ISO 9001 cost in India");
  assert.equal(dropped[0].status, "exists");
  // The URL is carried separately so the dashboard can link it, and the sentence is the same
  // one Mr. Writer uses — one wording for one situation.
  assert.equal(dropped[0].url, "https://x.test/iso-9001-cost");
  assert.match(dropped[0].reason, /"ISO 9001 Cost" aapki website par pehle se maujood hai/);
  assert.match(dropped[0].reason, /update karwao, ya isi topic ka koi naya angle chuno/);
});

test("a topic already in flight is dropped too, and says which job is doing it", async () => {
  const { fn } = checker({
    "Internal auditor training": { status: "in_progress", task_id: "job-42", source: "jobs_log", label: 'Writing "Internal auditor training"' },
  });
  const { kept, dropped } = await dropDuplicateTopics(PLAN, fn);

  assert.equal(kept.length, 2);
  assert.equal(dropped[0].status, "in_progress");
  assert.equal(dropped[0].url, null);
  assert.match(dropped[0].reason, /job-42/);
});

test("the count is reported even when every topic survives", async () => {
  const { fn, seen } = checker({});
  const { kept, dropped } = await dropDuplicateTopics(PLAN, fn);
  assert.equal(kept.length, 3);
  assert.deepEqual(dropped, []);
  assert.deepEqual(seen, PLAN.map((t) => t.topic), "every topic must be checked, not just the first");
});

test("a plan where everything is already covered keeps nothing, and every drop is explained", async () => {
  const table: Record<string, DuplicateVerdict> = {};
  for (const t of PLAN) {
    table[t.topic] = { status: "exists", where: "content_items", url: null, item_id: "x", title: t.topic, slug: "s" };
  }
  const { fn } = checker(table);
  const { kept, dropped } = await dropDuplicateTopics(PLAN, fn);

  // The planner then returns planned: 0 with a sentence — not silence, and not three keyword
  // jobs that will each be refused by the writer a minute later.
  assert.deepEqual(kept, []);
  assert.equal(dropped.length, PLAN.length);
  assert.deepEqual(dropped.map((d) => d.topic), PLAN.map((t) => t.topic));
});

test("two topics in one plan that are the same topic: the second is dropped", async () => {
  // Neither exists in the database yet, so no lock can catch this — only the planner can.
  const { fn } = checker({});
  const { kept, dropped } = await dropDuplicateTopics(
    [
      { topic: "ISO 9001 Cost", why: "a" },
      { topic: "iso-9001 cost", why: "b" },
      { topic: "ISO 14001 audit", why: "c" },
    ],
    fn
  );
  assert.deepEqual(kept.map((t) => t.topic), ["ISO 9001 Cost", "ISO 14001 audit"]);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].reason, /isi plan me pehle se hai/);
});

test("a broken duplicate check keeps the topic — a half-applied migration must not stop planning", async () => {
  const { kept, dropped } = await dropDuplicateTopics(PLAN, async () => {
    throw new Error('relation "content_items" does not exist');
  });
  assert.equal(kept.length, 3, "the safe direction is to plan it; the writer checks again before writing");
  assert.equal(dropped.length, 0);
});

test("every dropped topic carries a sentence the user can act on", async () => {
  const { fn } = checker({
    "ISO 9001 cost in India": { status: "exists", where: "site_pages", url: "https://x.test/a", item_id: null, title: "A", slug: "a" },
    "Internal auditor training": { status: "in_progress", task_id: "t9", source: "tasks", label: null },
  });
  const { dropped } = await dropDuplicateTopics(PLAN, fn);
  assert.equal(dropped.length, 2);
  for (const d of dropped) {
    assert.ok(d.reason.length > 40 && !d.reason.includes("\n"), d.reason);
    assert.ok(!/content_items|site_pages|jobs_log/.test(d.reason), d.reason);
  }
});
