/** The orchestrator's promises, one test each.
 *
 *  Every test here corresponds to a row of the plan's "panga" table (§5.5) or its retry and
 *  resume rules (§5.4). If one of these goes red, a user somewhere gets two articles, or one
 *  that silently never arrives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeDb.js";
import { configureEvents, type LiveEvent } from "./events.js";
import {
  configureOrchestrator,
  createTask,
  confirmTask,
  cancelTask,
  onStepDone,
  onStepFailed,
  runDueTasks,
  resumeAfterRestart,
  FROM_STEP,
} from "./orchestrator.js";
import type { Intent, Plan } from "./types.js";

const TENANT = "tenant-1";

function harness(opts: { at?: string } = {}) {
  const db = new FakeDb({ uniques: [{ table: "tasks", columns: ["tenant_id", "idempotency_key"] }] });
  const events: LiveEvent[] = [];
  const calls: any[] = [];
  const scheduled: any[] = [];
  let clock = new Date(opts.at ?? "2026-08-27T10:00:00.000Z");

  configureEvents({ client: db as any, broadcast: (_t, e) => events.push(e) });
  configureOrchestrator({
    db: db as any,
    now: () => clock,
    runStep: async (c) => {
      calls.push(c);
    },
    schedule: async (when, job) => {
      if (when) scheduled.push({ when, job });
    },
  });

  return {
    db,
    events,
    calls,
    scheduled,
    tick: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    steps: () => db.rows("task_steps"),
    task: () => db.rows("tasks")[0],
    stepFor: (agent: string) => db.rows("task_steps").find((s) => s.agent_id === agent),
  };
}

const intent = (over: Partial<Intent> = {}): Intent => ({
  action: "write_article",
  agent: "writer",
  params: { topic: "solar panels" },
  when: null,
  delivery: "approvals",
  confidence: 0.95,
  missing: [],
  irreversible: false,
  echo: "1 article on solar panels, Approvals me",
  source: "chat",
  ...over,
});

/** keyword → writer → (image ‖ seo): the plan's own example, with a parallel pair.
 *
 *  `input` shape matches planner.ts's real output exactly: literal fields flat, every `__from`
 *  reference nested under its own `__from` key, keyed by "step:<no>:<agent_id>" — not the flat
 *  top-level `"step:<provides>"` fields this fixture used until 2026-08-31, which matched an
 *  orchestrator.ts that had drifted away from what `plan()` actually emits. Keeping this fixture
 *  in the planner's real shape is what makes these tests catch that kind of drift again. */
const articlePlan = (): Plan => ({
  steps: [
    { no: 1, agent_id: "keyword", action: "find_keywords", needs: [], provides: "keywords", optional: false, input: { topic: "solar panels" } },
    { no: 2, agent_id: "writer", action: "write_article", needs: ["keywords"], provides: "article", optional: false, input: { topic: "solar panels", __from: { keywords: `${FROM_STEP}1:keyword` } } },
    { no: 3, agent_id: "image", action: "make_images", needs: ["article"], provides: "images", optional: true, input: { __from: { article: `${FROM_STEP}2:writer` } } },
    { no: 3, agent_id: "seo", action: "check_seo", needs: ["article"], provides: "seo_passed", optional: false, input: { __from: { article: `${FROM_STEP}2:writer` } } },
  ],
  outline: ["Mr. Keyword", "Mr. Writer", "Mr. Image ‖ Mr. SEO"],
  estimated_seconds: 360,
  cost_units: 55,
});

const onePlan = (): Plan => ({
  steps: [{ no: 1, agent_id: "keyword", action: "find_keywords", needs: [], provides: "keywords", optional: false, input: { topic: "solar" } }],
  outline: ["Mr. Keyword"],
  estimated_seconds: 20,
  cost_units: 3,
});

test("a reversible order starts immediately and dispatches only the step whose needs are met", async () => {
  const h = harness();
  const res = await createTask(TENANT, intent(), articlePlan());

  assert.equal(res.ok, true);
  assert.equal(h.task().status, "running");
  assert.equal(h.calls.length, 1, "only Mr. Keyword may start — the writer is waiting on keywords");
  assert.equal(h.calls[0].agent_id, "keyword");
  assert.equal(h.steps().filter((s) => s.status === "pending").length, 3);
});

test("parallel steps go out together, and the task only finishes when both are back", async () => {
  const h = harness();
  const { task_id } = (await createTask(TENANT, intent(), articlePlan())) as any;

  await onStepDone(task_id, TENANT, h.stepFor("keyword")!.id, { relatedKeywords: ["a", "b"] });
  assert.equal(h.calls.at(-1).agent_id, "writer");

  await onStepDone(task_id, TENANT, h.stepFor("writer")!.id, { title: "Solar" });
  const lastTwo = h.calls.slice(-2).map((c) => c.agent_id).sort();
  assert.deepEqual(lastTwo, ["image", "seo"], "3a and 3b dispatch at the same time");

  await onStepDone(task_id, TENANT, h.stepFor("image")!.id, { hero: "x.webp" });
  assert.equal(h.task().status, "running", "one half of a parallel pair is not the end");

  await onStepDone(task_id, TENANT, h.stepFor("seo")!.id, { score: 82, passed: true });
  assert.equal(h.task().status, "awaiting_approval", "delivery was approvals, so it waits for a human");
});

test("a step's input is resolved from the earlier step's real output, not from the plan", async () => {
  const h = harness();
  const { task_id } = (await createTask(TENANT, intent(), articlePlan())) as any;
  await onStepDone(task_id, TENANT, h.stepFor("keyword")!.id, { recommended: "solar panel cost dubai" });

  const writerCall = h.calls.find((c) => c.agent_id === "writer")!;
  assert.deepEqual(writerCall.input.keywords, { recommended: "solar panel cost dubai" });
  assert.equal(writerCall.input.topic, "solar panels", "plain params survive resolution");
});

test("an irreversible order waits for a yes, and the yes is recorded", async () => {
  const h = harness();
  const res: any = await createTask(TENANT, intent({ irreversible: true, delivery: "publish", echo: "'Solar' live karun?" }), onePlan());

  assert.equal(res.status, "awaiting_confirm");
  assert.equal(h.calls.length, 0, "nothing runs before the confirmation");
  assert.equal(h.events.some((e) => e.type === "task_created"), true);

  await confirmTask(res.task_id, TENANT);
  assert.equal(h.task().status, "running");
  assert.equal(typeof h.task().confirmed_at, "string");
  assert.equal(h.calls.length, 1);
});

test("the same order twice is one task", async () => {
  const h = harness();
  const i = intent({ idempotency_key: "abc123" });
  const first: any = await createTask(TENANT, i, onePlan());
  const second: any = await createTask(TENANT, i, onePlan());

  assert.equal(second.duplicate, true);
  assert.equal(second.task_id, first.task_id);
  assert.equal(h.db.rows("tasks").length, 1, "one row, one article, one bill");
});

test("a retryable failure backs off and retries, then stops in needs_attention with a reason", async () => {
  const h = harness();
  const { task_id } = (await createTask(TENANT, intent(), onePlan())) as any;
  const stepId = h.stepFor("keyword")!.id;

  await onStepFailed(task_id, TENANT, stepId, "NIM timed out", true);
  assert.equal(h.stepFor("keyword")!.status, "pending", "back to pending for another go");
  assert.deepEqual(h.scheduled.at(-1).when, { startAfterSeconds: 4 });

  // Second and third attempts.
  h.stepFor("keyword")!.attempts = 2;
  await onStepFailed(task_id, TENANT, stepId, "NIM timed out", true);
  assert.deepEqual(h.scheduled.at(-1).when, { startAfterSeconds: 16 });

  h.stepFor("keyword")!.attempts = 3;
  await onStepFailed(task_id, TENANT, stepId, "NIM timed out", true);

  assert.equal(h.stepFor("keyword")!.status, "failed");
  assert.equal(h.task().status, "needs_attention");
  assert.equal(h.task().error, "NIM timed out", "the user is told what actually went wrong");
  assert.equal(h.events.some((e) => e.type === "task_failed"), true);
});

test("an optional step that fails is skipped; a required one stops the task", async () => {
  const h = harness();
  const { task_id } = (await createTask(TENANT, intent(), articlePlan())) as any;
  await onStepDone(task_id, TENANT, h.stepFor("keyword")!.id, {});
  await onStepDone(task_id, TENANT, h.stepFor("writer")!.id, {});

  await onStepFailed(task_id, TENANT, h.stepFor("image")!.id, "FLUX is down", false);
  assert.equal(h.stepFor("image")!.status, "skipped");
  assert.equal(h.task().status, "running", "a missing image does not strand the article");
  assert.equal(h.events.some((e) => e.type === "step_skipped"), true);

  await onStepFailed(task_id, TENANT, h.stepFor("seo")!.id, "SEO agent unavailable", false);
  assert.equal(h.task().status, "needs_attention", "SEO is required before anything goes live");
});

test("a check_seo step that ran fine but failed the draft (sendBackToWriter) stops the task honestly, not silently done", async () => {
  const h = harness();
  const { task_id } = (await createTask(TENANT, intent(), articlePlan())) as any;
  await onStepDone(task_id, TENANT, h.stepFor("keyword")!.id, {});
  await onStepDone(task_id, TENANT, h.stepFor("writer")!.id, {});
  await onStepDone(task_id, TENANT, h.stepFor("image")!.id, { hero: "x.webp" });

  // agents/seo.ts never throws on a low score — it returns normally with `passed:false` and
  // `sendBackToWriter:true`. Before this fix, onStepDone had no idea what that field meant and
  // marked the step "done" like any other, so the whole task finished "awaiting_approval" over
  // an article that failed its own checks.
  await onStepDone(task_id, TENANT, h.stepFor("seo")!.id, {
    score: 40,
    passed: false,
    sendBackToWriter: true,
    summary: "SEO 40/100 · BLOCKED (2): title missing keyword; no meta description",
  });

  assert.equal(h.stepFor("seo")!.status, "failed", "not silently marked done over a failed check");
  assert.equal(h.task().status, "needs_attention");
  assert.match(h.task().error, /SEO 40\/100/, "the real score and blockers reach the user, not a generic message");
});

test("a cap refusal stops the step with the cap's own sentence, and never retries it", async () => {
  const db = new FakeDb();
  const events: LiveEvent[] = [];
  configureEvents({ client: db as any, broadcast: (_t, e) => events.push(e) });
  configureOrchestrator({
    db: db as any,
    now: () => new Date("2026-08-27T10:00:00.000Z"),
    runStep: async () => assert.fail("a capped step must never reach an agent"),
    schedule: async () => {},
    checkCap: async () => "Aaj ke 10 article ho gaye — kal reset hoga.",
  });

  await createTask(TENANT, intent(), onePlan());
  const step = db.rows("task_steps")[0];
  assert.equal(step.status, "failed");
  assert.equal(db.rows("tasks")[0].error, "Aaj ke 10 article ho gaye — kal reset hoga.");
});

test("a future order is booked, not started, and runs when its time comes", async () => {
  const h = harness({ at: "2026-08-27T10:00:00.000Z" });
  const res: any = await createTask(
    TENANT,
    intent({ when: { at: "2026-08-27T10:40:00.000Z", kind: "relative", matched: "40 min baad" } }),
    onePlan(),
  );

  assert.equal(res.status, "scheduled");
  assert.equal(h.calls.length, 0);
  assert.equal(h.events.some((e) => e.type === "task_scheduled"), true);

  assert.equal(await runDueTasks(), 0, "not due yet");
  h.tick(41 * 60 * 1000);
  assert.equal(await runDueTasks(), 1);
  assert.equal(h.calls.length, 1);
  assert.equal(await runDueTasks(), 0, "a claimed task is not started twice");
});

test("a restart picks the work back up without redoing what finished", async () => {
  const h = harness();
  const { task_id } = (await createTask(TENANT, intent(), articlePlan())) as any;
  await onStepDone(task_id, TENANT, h.stepFor("keyword")!.id, { recommended: "solar" });
  const before = h.calls.length;

  // The writer was running when the process died.
  const resumed = await resumeAfterRestart();
  assert.equal(resumed, 1);
  assert.equal(h.stepFor("keyword")!.status, "done", "finished work stays finished");
  assert.equal(h.calls.length, before + 1);
  assert.equal(h.calls.at(-1).agent_id, "writer", "it resumes at the step that was interrupted");
});

test("cancel stops a booked order and says who cancelled it", async () => {
  const h = harness();
  const res: any = await createTask(
    TENANT,
    intent({ when: { at: "2026-08-27T18:00:00.000Z", kind: "absolute", matched: "6 baje" } }),
    onePlan(),
  );
  const out = await cancelTask(res.task_id, TENANT, "user");
  assert.equal(out.ok, true);
  assert.equal(h.task().status, "cancelled");
  assert.equal(h.steps().every((s) => s.status === "cancelled"), true);

  const again = await cancelTask(res.task_id, TENANT, "user");
  assert.equal(again.ok, false, "cancelling twice is not an error the user should see twice");
});

test("a plan whose remaining steps can never run says so instead of hanging in running", async () => {
  const h = harness();
  const orphan: Plan = {
    steps: [
      { no: 1, agent_id: "keyword", action: "find_keywords", needs: [], provides: "keywords", optional: false, input: {} },
      { no: 2, agent_id: "publish", action: "publish_article", needs: ["article"], provides: "published_url", optional: false, input: {} },
    ],
    outline: [],
    estimated_seconds: 50,
    cost_units: 5,
  };
  const { task_id } = (await createTask(TENANT, intent(), orphan)) as any;
  await onStepDone(task_id, TENANT, h.stepFor("keyword")!.id, {});

  assert.equal(h.task().status, "needs_attention");
  assert.match(h.task().error, /aage nahi badh sakta/);
});
