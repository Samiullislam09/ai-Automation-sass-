/** Run: cd agent-server && npx tsx --test src/brain/planner.test.ts
 *
 *  The acceptance criteria for this file is plan §5.5's "User ne kaha → Tool → Plan (steps)"
 *  table. There is one test per row below, in the table's order, against TWO registries:
 *
 *    • TODAY — the manifests we actually ship (`MANIFESTS` + `STUB_AGENTS` + `NOT_YET_ROUTED`).
 *      Mr. SEO is a stub, Mr. Publish has no adapter, and there is no image agent at all, so
 *      several rows can only be satisfied as an honest refusal. Those refusals ARE the test:
 *      the planner must say "Mr. SEO abhi available nahi hai", not invent a step.
 *
 *    • PLAN_WORLD — the same manifests with Mr. SEO and Mr. Publish live and an image agent
 *      added, i.e. exactly the registry drawn in §5.5's mermaid
 *      (publish needs [article, images, seo_passed], images optional). This is the registry the
 *      plan's table describes, and against it the counts come out 1 / 1 / 4 / 5 as written.
 *
 *  Keeping both is the point: the second proves the algorithm, the first proves we do not lie
 *  about what the product can do this week.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Manifest } from "../vendor/agent-contract/index.js";
import type { Intent, PlanStep } from "./types.js";
import { MANIFESTS, NOT_YET_ROUTED, STUB_AGENTS } from "./manifests.js";
import { buildRegistry, type Registry, type RegistryOptions } from "./registry.js";
import { plan } from "./planner.js";

// ── registries ────────────────────────────────────────────────────────────────────────────

const TODAY = buildRegistry(MANIFESTS, { stubs: STUB_AGENTS, notRouted: NOT_YET_ROUTED });

/** Mr. Image as §5.5 draws him: works on the article, only publish wants his output, optional. */
const IMAGE_AGENT: Manifest = {
  id: "image",
  name: "Mr. Image",
  version: "1.0.0",
  description: "Makes the hero, thumbnail and OG images for an article.",
  actions: [
    {
      id: "make_images",
      phrases: ["image banao", "is article ki image badlo", "images do"],
      input: { article: "object", style: "string?" },
      output: { hero: "string", thumb: "string", og: "string" },
      provides: "images",
      needs: ["article"],
      optional: true,
      irreversible: false,
      estimated_seconds: 60,
      cost_units: 12,
    },
  ],
  office: { room: "image", ico: "🖼️", color: "#f472b6" },
};

/** The registry §5.5's diagram describes: everyone live, publish also needs images. */
function planWorld(opts: RegistryOptions = {}): Registry {
  const manifests: Manifest[] = structuredClone(MANIFESTS);
  const publish = manifests.find((m) => m.id === "publish")!;
  publish.actions[0].needs = ["article", "images", "seo_passed"];
  return buildRegistry([...manifests, IMAGE_AGENT], { stubs: new Set(), notRouted: new Set(), ...opts });
}

const PLAN_WORLD = planWorld();

/** Today's manifests unchanged (publish needs only [article, seo_passed]) but with every agent
 *  live — the world the day the stubs are finished, with no image agent yet. */
const LIVE_WORLD = buildRegistry(MANIFESTS, { stubs: new Set(), notRouted: new Set() });

// ── helpers ───────────────────────────────────────────────────────────────────────────────

function intent(action: string, params: Record<string, unknown> = {}, delivery: Intent["delivery"] = "approvals"): Intent {
  return {
    action,
    params,
    when: null,
    delivery,
    confidence: 0.95,
    missing: [],
    irreversible: false,
    echo: `${action} — theek?`,
    source: "chat",
  };
}

function okPlan(result: ReturnType<typeof plan>) {
  assert.equal(result.ok, true, result.ok ? "" : `expected a plan, got: ${result.message}`);
  assert.ok(result.ok);
  return result.plan;
}

function failed(result: ReturnType<typeof plan>) {
  assert.equal(result.ok, false, "expected a failure");
  assert.ok(!result.ok);
  return result;
}

const shape = (steps: PlanStep[]) => steps.map((s) => `${s.no}:${s.agent_id}.${s.action}`);

// ══ ROW 1 · "sirf keywords do" → find_keywords → 1 step → Keyword ════════════════════════

test("row 1 · sirf keywords do → find_keywords → 1 step, and the writer never hears about it", () => {
  const p = okPlan(plan(intent("find_keywords", { topic: "solar panels" }), TODAY));

  assert.deepEqual(shape(p.steps), ["1:keyword.find_keywords"]);
  assert.deepEqual(p.steps[0].needs, []);
  assert.deepEqual(p.steps[0].input, { topic: "solar panels" }, "no __from: nothing feeds step 1");
  assert.equal(p.estimated_seconds, 20);
  assert.equal(p.cost_units, 3);
  assert.deepEqual(p.outline, ["1. Mr. Keyword keywords nikalega (~20s)"]);
});

test("row 1b · asking to publish keywords still plans one step — nothing publishes a keyword", () => {
  const p = okPlan(plan(intent("find_keywords", { topic: "solar panels" }, "publish"), TODAY));
  assert.deepEqual(shape(p.steps), ["1:keyword.find_keywords"]);
});

// ══ ROW 2 · "solar pe research karo, likhna mat" → research_brief → 1 step → Writer ═══════

test("row 2 · research karo, likhna mat → research_brief → 1 step, no article is written", () => {
  const p = okPlan(plan(intent("research_brief", { topic: "solar market" }), TODAY));

  assert.deepEqual(shape(p.steps), ["1:writer.research_brief"]);
  assert.equal(p.steps[0].provides, "brief");
  assert.ok(!p.steps.some((s) => s.action === "write_article"), "the writer's OTHER action must stay out");
  assert.equal(p.estimated_seconds, 90);
});

// ══ ROW 3 · "article likho" → write_article → 4 (kw → writer → image ‖ seo) ═══════════════

test("row 3 · article likho, in the registry §5.5 describes → 4 steps, image ‖ seo share a number", () => {
  const p = okPlan(plan(intent("write_article", { topic: "solar panels for homes" }), PLAN_WORLD));

  assert.equal(p.steps.length, 4);
  assert.deepEqual(shape(p.steps), [
    "1:keyword.find_keywords",
    "2:writer.write_article",
    "3:image.make_images",
    "3:seo.check_seo",
  ]);
  // The parallel pair: same `no`, so the orchestrator dispatches them together.
  assert.equal(p.steps[2].no, p.steps[3].no);
  assert.notEqual(p.steps[2].agent_id, p.steps[3].agent_id);
  assert.ok(!p.steps.some((s) => s.action === "publish_article"), "delivery=approvals must not publish");
  assert.ok(!p.steps.some((s) => s.action === "draft_social"), "social only runs when asked for");

  assert.deepEqual(p.outline, [
    "1. Mr. Keyword pehle keywords nikalega (~20s)",
    "2. Mr. Writer article likhega (~5 min)",
    "3a. Mr. Image images banayega (~60s) ‖ saath me",
    "3b. Mr. SEO SEO check karega (~40s) ‖ saath me",
  ]);
});

test("row 3 · article likho, as the product actually stands today → keyword, writer, SEO", () => {
  const p = okPlan(plan(intent("write_article", { topic: "solar panels for homes" }), TODAY));

  // Mr. SEO stopped being a stub on 2026-08-27, so the real plan gained its check. There is
  // still no image agent, and the plan does not invent one — an absent agent produces no step
  // rather than a placeholder.
  assert.deepEqual(shape(p.steps), ["1:keyword.find_keywords", "2:writer.write_article", "3:seo.check_seo"]);
  assert.equal(p.estimated_seconds, 360);
  assert.equal(p.cost_units, 51);
  assert.ok(!p.steps.some((s) => s.agent_id === "image"), "no image agent exists, so no image step is planned");
});

// ══ ROW 4 · "article likh ke publish karo" → write_article + publish → 5 ═════════════════

test("row 4 · article likh ke publish karo, in §5.5's registry → 5 steps, publish last", () => {
  const p = okPlan(plan(intent("write_article", { topic: "solar panels for homes" }, "publish"), PLAN_WORLD));

  assert.equal(p.steps.length, 5);
  assert.deepEqual(shape(p.steps), [
    "1:keyword.find_keywords",
    "2:writer.write_article",
    "3:image.make_images",
    "3:seo.check_seo",
    "4:publish.publish_article",
  ]);
  const publish = p.steps[4];
  assert.deepEqual([...publish.needs].sort(), ["article", "images", "seo_passed"]);
  assert.equal(publish.optional, false, "publish is required once the user asked for it");
});

test("row 3 vs row 4 · the only difference between them is the publish step", () => {
  const draft = okPlan(plan(intent("write_article", { topic: "solar" }), PLAN_WORLD));
  const live = okPlan(plan(intent("write_article", { topic: "solar" }, "publish"), PLAN_WORLD));

  assert.equal(live.steps.length - draft.steps.length, 1);
  assert.deepEqual(
    live.steps.map((s) => s.action).filter((a) => !draft.steps.some((d) => d.action === a)),
    ["publish_article"],
  );
});

test("row 4 · asking to publish today plans the whole chain, ending at the live site", () => {
  // This is the plan's Phase 1 exit criterion, and as of 2026-08-27 it resolves for real:
  // Mr. SEO became a real agent and Mr. Publish got a worker, a queue and a route, so nothing
  // in this chain is a stub any more.
  const p = okPlan(plan(intent("write_article", { topic: "solar" }, "publish"), TODAY));

  assert.deepEqual(shape(p.steps), [
    "1:keyword.find_keywords",
    "2:writer.write_article",
    "3:seo.check_seo",
    "4:publish.publish_article",
  ]);
  const publish = p.steps[3];
  assert.deepEqual([...publish.needs].sort(), ["article", "seo_passed"], "nothing goes live unmeasured");
  assert.equal(publish.optional, false);
});

test("row 4 · with Mr. SEO down, publishing is refused in one sentence before a credit is spent", () => {
  // The refusal still has to be right, because an agent can be down at any moment. Forcing
  // seo into the stub set reproduces exactly that.
  const withoutSeo = buildRegistry(MANIFESTS, { stubs: new Set(["seo", "social", "leads"]), notRouted: new Set() });
  const res = failed(plan(intent("write_article", { topic: "solar" }, "publish"), withoutSeo));

  assert.deepEqual(res.failure, { kind: "agent_unhealthy", agent_id: "seo", required: true });
  assert.equal(
    res.message,
    "Mr. SEO abhi available nahi hai, aur publish ke liye SEO check zaroori hai — isliye ye order abhi nahi chal sakta.",
  );
});

// ══ ROW 5 · "isko publish kar do (existing)" → publish_existing → 1-2 ════════════════════

test("row 5 · publish_existing is not a registered action → unknown_action, pointing at the real one", () => {
  const res = failed(plan(intent("publish_existing", { content_item_id: "abc" }), TODAY));

  assert.deepEqual(res.failure, { kind: "unknown_action", action: "publish_existing" });
  assert.match(res.message, /publish_existing/);
  assert.match(res.message, /publish_article \(Mr\. Publish\)/, "the message must point at the action that does exist");
});

test("row 5 · publishing an existing article, once it is routable, is the 1-2 step plan §5.5 predicts", () => {
  // `publish_article` IS the action behind that row; today its agent has no adapter. The intent
  // carries the article that already exists, so nothing is re-written — exactly the table's
  // "1-2 (seo check agar nahi hua, phir publish)".
  const two = okPlan(plan(intent("publish_article", { content_item_id: "abc", article: { title: "solar" } }, "publish"), LIVE_WORLD));
  assert.deepEqual(shape(two.steps), ["1:seo.check_seo", "2:publish.publish_article"]);

  // …and one step when the SEO check has already happened.
  const one = okPlan(
    plan(intent("publish_article", { content_item_id: "abc", article: { title: "solar" }, seo_passed: true }, "publish"), LIVE_WORLD),
  );
  assert.deepEqual(shape(one.steps), ["1:publish.publish_article"]);
  assert.deepEqual(one.steps[0].needs, [], "nothing to wait for — the user brought both inputs");
});

// ══ ROW 6 · "site audit karo" → audit_site → 1 ═══════════════════════════════════════════

test("row 6 · audit_site is one step, and it needs nothing first", () => {
  // §14's table says one step, and the manifest is what makes that true: auditing reads the
  // live site, so there is nothing for the backward walk to build first. The day it grows a
  // `needs`, this test is the one that notices.
  const p = okPlan(plan(intent("audit_site", {}), TODAY));
  assert.equal(p.steps.length, 1);
  assert.equal(p.steps[0].agent_id, "audit");
  assert.equal(p.steps[0].action, "audit_site");
  // No delivery step appended: reading a site produces nothing anybody publishes, so the
  // backward walk has nowhere else to go.
  assert.equal(p.outline.length, 1);
});

// ══ ROW 7 · "is article ki image badlo" → make_images → 1 ════════════════════════════════

test("row 7 · make_images has no manifest yet → unknown_action", () => {
  const res = failed(plan(intent("make_images", {}), TODAY));
  assert.deepEqual(res.failure, { kind: "unknown_action", action: "make_images" });
});

test("row 7 · with an image agent registered it is the one step the table says", () => {
  // "is article ki image badlo" — the article exists and comes in the params, so the backward
  // walk stops immediately instead of writing a new one.
  const p = okPlan(plan(intent("make_images", { article: { title: "x" } }), PLAN_WORLD));
  assert.deepEqual(shape(p.steps), ["1:image.make_images"]);
  assert.deepEqual(p.steps[0].needs, []);
});

test("row 7b · without the article in hand, the same action does plan the article first", () => {
  const p = okPlan(plan(intent("make_images", { topic: "solar" }), PLAN_WORLD));
  assert.deepEqual(shape(p.steps), ["1:keyword.find_keywords", "2:writer.write_article", "3:image.make_images"]);
});

// ══ ROWS 8 & 9 · "mera schedule kya hai" / "TikTok video banao" → no tool, 0 steps ═══════

test("rows 8-9 · anything the registry does not know is refused, never guessed", () => {
  for (const action of ["", "none", "make_tiktok_video", "mera_schedule"]) {
    const res = failed(plan(intent(action, {}), TODAY));
    assert.equal(res.failure.kind, "unknown_action");
  }
});

// ══ failure modes ════════════════════════════════════════════════════════════════════════

test("2026-08-31 · 'article likho' with no topic no longer dead-ends on 'which topic?' — Mr Lxwa picks one", () => {
  // Was: missing_slots asking the user for a topic. The owner asked for autonomous picking
  // instead (site memory + duplicate locks, no confirmation step) — `topic` moved from a
  // required INPUT slot to a NEED, so the planner's own "the user already handed us this one"
  // rule still short-circuits it the instant a literal topic IS given (see the next test), and
  // only pulls Mr Lxwa's pick_topic in when it is genuinely blank.
  const p = okPlan(plan(intent("write_article", {}), TODAY));
  assert.deepEqual(shape(p.steps), ["1:boss.pick_topic", "2:keyword.find_keywords", "3:writer.write_article", "4:seo.check_seo"]);
});

test("a topic literally given still skips Mr Lxwa entirely — no picking step for the common case", () => {
  const p = okPlan(plan(intent("write_article", { topic: "solar panels" }), TODAY));
  assert.equal(p.steps.some((s) => s.agent_id === "boss"), false, "the topic was given — nothing needed picking");
  assert.deepEqual(shape(p.steps), ["1:keyword.find_keywords", "2:writer.write_article", "3:seo.check_seo"]);
});

test("'sirf keywords do' with no topic also gets Mr Lxwa's pick, same as an article order", () => {
  const p = okPlan(plan(intent("find_keywords", {}), TODAY));
  assert.deepEqual(shape(p.steps), ["1:boss.pick_topic", "2:keyword.find_keywords"]);
});

test("a required slot the model could not fill (not 'topic') → missing_slots, one readable sentence", () => {
  const res = failed(plan(intent("find_leads", {}), TODAY));
  assert.deepEqual(res.failure, { kind: "missing_slots", slots: ["query"] });
  assert.match(res.message, /Ek cheez batani baaki hai: query/);
  assert.match(res.message, /guess nahi karunga/);
});

test("optional slots are not asked for", () => {
  // write_article's `keywords`, `tone`, `words` all end in "?" — only `topic` is required.
  const p = okPlan(plan(intent("write_article", { topic: "solar" }), TODAY));
  assert.ok(p.steps.length > 0);
});

test("slots the intent engine already flagged as missing are carried through", () => {
  const i = { ...intent("find_keywords", { topic: "solar" }), missing: ["country"] };
  const res = failed(plan(i, TODAY));
  assert.deepEqual(res.failure, { kind: "missing_slots", slots: ["country"] });
});

test("a target whose own agent is a stub → agent_unhealthy, named", () => {
  // No agent is a real stub any more, so the mechanism is exercised with a manufactured one.
  // What the test is really about is the shape of the refusal: the agent is named, so the
  // user hears which one, not "something went wrong".
  const stubbed = buildRegistry(MANIFESTS, { stubs: new Set(["social"]), notRouted: new Set() });
  const res = failed(plan(intent("draft_social", { article: {} }), stubbed));
  assert.deepEqual(res.failure, { kind: "agent_unhealthy", agent_id: "social", required: true });
  assert.match(res.message, /^Miss Social abhi available nahi hai/);
});

test("an OPTIONAL step whose agent is down is skipped with a note, and the plan still runs", () => {
  const reg = planWorld({ healthy: { image: false } }); // images optional:true, seo_passed is not
  const p = okPlan(plan(intent("write_article", { topic: "solar" }, "publish"), reg));

  assert.deepEqual(shape(p.steps), [
    "1:keyword.find_keywords",
    "2:writer.write_article",
    "3:seo.check_seo",
    "4:publish.publish_article",
  ]);
  assert.ok(p.outline.some((l) => l.includes("Mr. Image") && l.includes("skip")));
  // The publish step must not wait for a step that will never run.
  assert.deepEqual([...p.steps[3].needs].sort(), ["article", "seo_passed"]);
  assert.equal((p.steps[3].input as { __from?: Record<string, string> }).__from?.images, undefined);
});

test("a REQUIRED step whose agent is down fails the plan — seo_passed is not optional", () => {
  const reg = planWorld({ healthy: { seo: false } });
  const res = failed(plan(intent("write_article", { topic: "solar" }, "publish"), reg));
  assert.deepEqual(res.failure, { kind: "agent_unhealthy", agent_id: "seo", required: true });
});

test("a need nobody provides → no_provider, naming the need and the step that wanted it", () => {
  const orphan: Manifest = {
    id: "orphan",
    name: "Mr. Orphan",
    version: "1.0.0",
    description: "wants something nobody makes",
    actions: [
      {
        id: "do_orphan",
        phrases: ["orphan chalao"],
        input: {},
        output: {},
        provides: "orphan_out",
        needs: ["moon_dust"],
        irreversible: false,
        estimated_seconds: 10,
        cost_units: 1,
      },
    ],
    office: { room: "orphan", ico: "🌙", color: "#cccccc" },
  };
  const reg = buildRegistry([...MANIFESTS, orphan], { stubs: STUB_AGENTS, notRouted: NOT_YET_ROUTED });
  const res = failed(plan(intent("do_orphan", {}), reg));

  assert.deepEqual(res.failure, { kind: "no_provider", need: "moon_dust", forStep: "do_orphan" });
  assert.match(res.message, /moon_dust kaun banata hai/);
});

test("a cycle in the manifests is a value, not a hang", () => {
  const mk = (id: string, provides: string, needs: string[]): Manifest => ({
    id,
    name: `Mr. ${id}`,
    version: "1.0.0",
    description: "cyclic",
    actions: [
      {
        id: `act_${id}`,
        phrases: [`${id} chalao`],
        input: {},
        output: {},
        provides,
        needs,
        irreversible: false,
        estimated_seconds: 10,
        cost_units: 1,
      },
    ],
    office: { room: id, ico: "🔁", color: "#999999" },
  });
  const reg = buildRegistry([mk("aa", "alpha", ["beta"]), mk("bb", "beta", ["alpha"])]);
  const res = failed(plan(intent("act_aa", {}), reg));

  assert.equal(res.failure.kind, "cycle");
  assert.ok(res.failure.kind === "cycle" && res.failure.involved.includes("act_aa"));
  assert.match(res.message, /gol chakkar/);
});

// ══ input threading ══════════════════════════════════════════════════════════════════════

test("__from names the producing step as step:<no>:<agent_id>, the task_steps unique key", () => {
  const p = okPlan(plan(intent("write_article", { topic: "solar", tone: "plain" }, "publish"), PLAN_WORLD));
  const [kw, writer, image, seo, publish] = p.steps;

  assert.deepEqual(kw.input, { topic: "solar" });
  assert.deepEqual(writer.input, { topic: "solar", tone: "plain", __from: { keywords: "step:1:keyword" } });
  assert.deepEqual((image.input as { __from: Record<string, string> }).__from, { article: "step:2:writer" });
  assert.deepEqual((seo.input as { __from: Record<string, string> }).__from, { article: "step:2:writer" });
  assert.deepEqual((publish.input as { __from: Record<string, string> }).__from, {
    article: "step:2:writer",
    images: "step:3:image",
    seo_passed: "step:3:seo",
  });
  // Params that are not fields of the action's input schema are not smuggled in.
  assert.equal((kw.input as Record<string, unknown>).tone, undefined);
});

test("intent params reach every step whose input schema names them, and only those", () => {
  const p = okPlan(plan(intent("write_article", { topic: "solar", count: 3 }), TODAY));
  const [kw, writer] = p.steps.map((s) => s.input as Record<string, unknown>);

  assert.equal(kw.topic, "solar", "topic feeds Mr. Keyword too, without anyone wiring it");
  assert.equal(writer.topic, "solar");
  assert.equal(kw.count, 3, "find_keywords declares `count?`, so it gets it");
  assert.equal(writer.count, undefined, "write_article does not declare `count`, so it is not smuggled in");
});

// ══ arithmetic ═══════════════════════════════════════════════════════════════════════════

test("estimated_seconds is the critical path, cost_units is the sum", () => {
  const p = okPlan(plan(intent("write_article", { topic: "solar" }), PLAN_WORLD));

  // Levels: 1 → kw 20s · 2 → writer 300s · 3 → image 60s ‖ seo 40s.
  assert.equal(p.estimated_seconds, 20 + 300 + 60, "the parallel level costs its slowest member, once");
  assert.notEqual(p.estimated_seconds, 20 + 300 + 60 + 40, "not the sum");
  // Money is different: both parallel steps are paid for.
  assert.equal(p.cost_units, 3 + 40 + 12 + 8);
});

test("the whole publish plan's numbers", () => {
  const p = okPlan(plan(intent("write_article", { topic: "solar" }, "publish"), PLAN_WORLD));
  assert.equal(p.estimated_seconds, 20 + 300 + 60 + 30);
  assert.equal(p.cost_units, 3 + 40 + 12 + 8 + 2);
});

// ══ the guarantee ════════════════════════════════════════════════════════════════════════

test("same intent → same plan, byte for byte (there is no sampling in here)", () => {
  const i = intent("write_article", { topic: "solar panels for homes" }, "publish");
  const a = okPlan(plan(i, PLAN_WORLD));
  const b = okPlan(plan(structuredClone(i), PLAN_WORLD));
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
});

test("every step is insertable into task_steps as-is", () => {
  const p = okPlan(plan(intent("write_article", { topic: "solar" }, "publish"), PLAN_WORLD));
  for (const s of p.steps) {
    assert.deepEqual(Object.keys(s).sort(), ["action", "agent_id", "input", "needs", "no", "optional", "provides"]);
    assert.ok(Number.isInteger(s.no) && s.no >= 1);
    assert.ok(typeof s.provides === "string" && s.provides.length > 0);
    assert.ok(Array.isArray(s.needs));
    assert.equal(typeof s.optional, "boolean");
  }
  // unique (task_id, no, agent_id) — the plan must never violate it before it is inserted.
  const keys = p.steps.map((s) => `${s.no}:${s.agent_id}`);
  assert.equal(new Set(keys).size, keys.length);
});
