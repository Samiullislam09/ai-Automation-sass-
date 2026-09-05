/** "User ne X kaha to Y hi ho" — the plan's §14 table, for the half that lives on this side.
 *
 *  §14 is written as a chat-level table, and the rows about wording ("hello" → one line) are
 *  tested in the web app where the words are produced. What is testable HERE is the part that
 *  no amount of good prompting can fix: given an intent, does the machinery do the right thing?
 *  These run the real registry, the real planner and the real orchestrator together against an
 *  in-memory database, so a regression in any one of the three fails here rather than in front
 *  of a customer.
 *
 *  Each test names the §14 row it covers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeDb.js";
import { configureEvents, type LiveEvent } from "./events.js";
import { buildRegistry, assertHealthyRegistry, enabledActions, isAvailable } from "./registry.js";
import { plan as makePlan } from "./planner.js";
import { configureOrchestrator, createTask, confirmTask, onStepDone } from "./orchestrator.js";
import { MANIFESTS, STUB_AGENTS, NOT_YET_ROUTED } from "./manifests.js";
import type { Intent } from "./types.js";

const TENANT = "tenant-acceptance";

function world(opts: { stubs?: Set<string>; notRouted?: Set<string> } = {}) {
  const registry = buildRegistry(MANIFESTS, {
    stubs: opts.stubs ?? STUB_AGENTS,
    notRouted: opts.notRouted ?? NOT_YET_ROUTED,
  });
  const db = new FakeDb({ uniques: [{ table: "tasks", columns: ["tenant_id", "idempotency_key"] }] });
  const events: LiveEvent[] = [];
  const calls: any[] = [];
  configureEvents({ client: db as any, broadcast: (_t, e) => events.push(e) });
  configureOrchestrator({
    db: db as any,
    now: () => new Date("2026-08-27T10:00:00.000Z"),
    runStep: async (c) => {
      calls.push(c);
    },
    schedule: async () => {},
  });
  return { registry, db, events, calls };
}

/** write_article's `with_story` slot (2026-09-05, §19.4.6) is answered "no" by default here:
 *  these tests are about the §14 acceptance rows, not about that question. */
const intent = (over: Partial<Intent>): Intent => ({
  action: "write_article",
  when: null,
  delivery: "approvals",
  confidence: 0.95,
  missing: [],
  irreversible: false,
  echo: "",
  source: "chat",
  ...over,
  params:
    (over.action ?? "write_article") === "write_article" && (over.params ?? {}).with_story === undefined
      ? { ...(over.params ?? {}), with_story: false }
      : (over.params ?? {}),
});

/** The brain's own front-door rule, mirrored from `readIntent` in server.ts: irreversibility
 *  comes from the manifest or from the delivery, never from the caller. */
function harden(i: Intent, registry: ReturnType<typeof buildRegistry>): Intent {
  const action = registry.actions.get(i.action);
  if (!action) return i;
  return { ...i, irreversible: action.spec.irreversible || i.delivery === "publish", agent: action.agent_id };
}

test("§14 · the registry the product actually ships is self-consistent", () => {
  const { registry } = world();
  assert.doesNotThrow(() => assertHealthyRegistry(registry), "two agents claiming a phrase, or a cycle, must be impossible to ship");
  assert.equal(registry.problems.length, 0);
  assert.ok(enabledActions(registry).length >= 4, "a user must have something to ask for");
});

test('§14 "sirf keywords do" · one step, no article, nothing irreversible', () => {
  const { registry } = world();
  const i = harden(intent({ action: "find_keywords", params: { topic: "solar panels" } }), registry);
  const res = makePlan(i, registry);

  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.plan.steps.length, 1);
  assert.equal(res.plan.steps[0].agent_id, "keyword");
  assert.equal(i.irreversible, false, "research asks nobody's permission");
});

test('§14 "solar panels pe article likho" · a task starts, and nothing asks for a confirmation', async () => {
  const { registry, calls, db } = world();
  const i = harden(intent({ action: "write_article", params: { topic: "solar panels" }, echo: "1 article on solar panels" }), registry);
  const res = makePlan(i, registry);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const created: any = await createTask(TENANT, i, res.plan);
  assert.equal(created.ok, true);
  assert.notEqual(created.status, "awaiting_confirm", "a draft is reversible — do not make the user confirm it");
  assert.equal(calls[0].agent_id, "keyword", "Mr. Keyword is always first, because his needs are empty");
  assert.equal(db.rows("task_steps")[0].status, "running");
});

test('§14 "isko publish kar do" · irreversible waits for a yes, and nothing runs before it', async () => {
  const { registry, calls } = world({ stubs: new Set(), notRouted: new Set() });
  const i = harden(
    intent({ action: "publish_article", params: { content_item_id: "item-1" }, delivery: "publish", echo: "'Solar' live karun?" }),
    registry,
  );
  assert.equal(i.irreversible, true, "irreversibility comes from the manifest, not from the caller");

  const res = makePlan(i, registry);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const created: any = await createTask(TENANT, i, res.plan);
  assert.equal(created.status, "awaiting_confirm");
  assert.equal(calls.length, 0, "nothing at all happens before the confirmation");

  await confirmTask(created.task_id, TENANT);
  assert.ok(calls.length >= 1, "and it does happen after");
});

test('§14 "publish mat karna" · delivery approvals plans no publish step', () => {
  const { registry } = world({ stubs: new Set(), notRouted: new Set() });
  const approvals = makePlan(harden(intent({ action: "write_article", params: { topic: "solar" }, delivery: "approvals" }), registry), registry);
  const publish = makePlan(harden(intent({ action: "write_article", params: { topic: "solar" }, delivery: "publish" }), registry), registry);

  assert.equal(approvals.ok && publish.ok, true);
  if (!approvals.ok || !publish.ok) return;

  const hasPublish = (p: typeof approvals.plan) => p.steps.some((s) => s.agent_id === "publish");
  assert.equal(hasPublish(approvals.plan), false, "the one word the user said must be the whole difference");
  assert.equal(hasPublish(publish.plan), true);
  assert.ok(publish.plan.steps.length > approvals.plan.steps.length);
});

test("§14 · a stub agent is never offered, and asking for it is refused rather than accepted", () => {
  // No agent is a real stub any more (STUB_AGENTS is empty as of the leads/social wiring), so
  // the mechanism is exercised with a manufactured one rather than asserting nothing.
  const { registry } = world({ stubs: new Set(["social"]), notRouted: new Set() });
  const offered = enabledActions(registry).some((a) => a.agent_id === "social");
  assert.equal(offered, false, "a stub — offering it would promise work that returns a placeholder");
  assert.equal(isAvailable(registry, "draft_social"), false);
});

test("§14 · with no stubs left, every registered action is offered", () => {
  const { registry } = world();
  assert.equal(STUB_AGENTS.size, 0);
  assert.equal(isAvailable(registry, "draft_social"), true);
});

test("§14 · a required agent that is down fails the plan with a sentence, not a stack trace", () => {
  // Mr. SEO down, and publish requires seo_passed.
  const { registry } = world({ stubs: new Set(["seo"]), notRouted: new Set() });
  const res = makePlan(harden(intent({ action: "write_article", params: { topic: "solar" }, delivery: "publish" }), registry), registry);

  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.ok(res.message.length > 20, "the user gets a sentence they can act on");
  assert.match(res.message, /seo|SEO/, "and it names what is actually missing");
});

test("§14 · the same order twice is one task, one article, one bill", async () => {
  const { registry, db } = world();
  const i = harden(intent({ action: "find_keywords", params: { topic: "solar" }, idempotency_key: "same-minute" }), registry);
  const res = makePlan(i, registry);
  if (!res.ok) return assert.fail("plan should succeed");

  const a: any = await createTask(TENANT, i, res.plan);
  const b: any = await createTask(TENANT, i, res.plan);
  assert.equal(b.duplicate, true);
  assert.equal(a.task_id, b.task_id);
  assert.equal(db.rows("tasks").length, 1);
});

test('§14 "mere liye TikTok video banao" · an unregistered action is refused, never improvised', () => {
  const { registry } = world();
  const res = makePlan(harden(intent({ action: "make_tiktok_video", params: {} }), registry), registry);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.failure.kind, "unknown_action");
});

test("§14 · a topic of 'null', 'undefined' or blank is never sent to Mr. Keyword as a literal string — Mr Lxwa picks a real one instead", () => {
  // 2026-08-31: `topic` moved from a required slot to a `need` so "article likho" (no topic)
  // does not dead-end asking the user — but the ORIGINAL point of this test still has to hold:
  // an empty/whitespace string must never reach find_keywords as if it were a real topic.
  const { registry } = world();
  for (const bad of [undefined, "", "   "]) {
    const res = makePlan(harden(intent({ action: "find_keywords", params: bad === undefined ? {} : { topic: bad } }), registry), registry);
    assert.equal(res.ok, true, `topic ${JSON.stringify(bad)} should now plan a Mr Lxwa pick, not fail`);
    if (!res.ok) continue;
    assert.equal(res.plan.steps[0].agent_id, "boss", "Mr Lxwa picks first, before Mr. Keyword ever runs");
    const kw = res.plan.steps.find((s) => s.agent_id === "keyword")!;
    // The plan's own literal field can still carry whatever blank string came in (it is only
    // ever read as a fallback) — what actually matters is that a real __from reference is
    // present too, which is what makes the orchestrator overwrite it with Mr Lxwa's real pick
    // at dispatch time (see orchestrator.ts's resolveInput).
    assert.equal((kw.input as any).__from?.topic, `step:1:boss`);
  }
});

test("§14 · the plan a user is shown is the plan that runs — same intent, same steps, every time", () => {
  const { registry } = world();
  const i = harden(intent({ action: "write_article", params: { topic: "solar panels for homes" } }), registry);
  const a = makePlan(i, registry);
  const b = makePlan(i, registry);
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b), "planning is code, so it cannot drift between the preview and the run");
});

test("§14 · an order that finishes lands in Approvals, not in 'done and gone'", async () => {
  const { registry, calls, db } = world();
  const i = harden(intent({ action: "find_keywords", params: { topic: "solar" }, delivery: "approvals" }), registry);
  const res = makePlan(i, registry);
  if (!res.ok) return assert.fail("plan should succeed");

  const created: any = await createTask(TENANT, i, res.plan);
  await onStepDone(created.task_id, TENANT, db.rows("task_steps")[0].id, { relatedKeywords: [] });

  assert.equal(db.rows("tasks")[0].status, "awaiting_approval");
  assert.equal(calls.length, 1);
});
