/** Run: cd agent-server && npx tsx --test src/agents/seo.test.ts
 *
 *  No network, no database. Same env-then-dynamic-import pattern as lib/dedupe.test.ts: env.ts
 *  throws on a missing DATABASE_URL, and DATAFORSEO_* is emptied so the optional SERP call is
 *  skipped rather than attempted.
 *
 *  The agent reads the Site Brain and the crawled page list from Supabase when it is not given
 *  them. Every test below HANDS THEM DOWN in the job (`profile` + `pages`), which is a real
 *  code path — the brain may already have both — and is what keeps these tests off the
 *  database. The content_items path is exercised in production, not here: it needs a row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";
process.env.DATAFORSEO_LOGIN = "";
process.env.DATAFORSEO_PASSWORD = "";

const { SeoAgent } = await import("./seo.js");
const { MANIFESTS, STUB_AGENTS } = await import("../brain/manifests.js");
const { validateAgainstSchema } = await import("../vendor/agent-contract/index.js");

const SPEC = MANIFESTS.find((m) => m.id === "seo")!.actions.find((a) => a.id === "check_seo")!;

const KW = "emergency plumber in Leeds";
const PAGES = [{ url: "https://leedsplumbing.co.uk/emergency", title: "Emergency call-out" }];

function body(good: boolean): string {
  const heads = good
    ? [`## When you need an emergency plumber in Leeds`, `## What counts as an emergency`, `## What it costs`]
    : [`## Some thoughts`];
  const filler = [
    `Most homeowners only think about their pipes when something goes wrong.`,
    `By then the water is usually already on the floor.`,
    `A quick check of the stopcock each spring saves a lot of that trouble.`,
    `Turn it off, turn it on again, and make sure it moves freely.`,
    `If the valve is seized, do not force it, because a snapped valve on a Sunday is worse than a stiff one.`,
    `Insulating the pipework in the loft is the other cheap job worth doing.`,
  ].join(" ");
  const parts = [
    good ? `# Emergency plumber in Leeds: what to do in the first hour` : `# A note about pipes`,
    ``,
    good
      ? `If you need an emergency plumber in Leeds tonight, the first hour matters more than the price.`
      : `Water on the floor is never a good sign, and this note is about that.`,
    ``,
  ];
  for (const h of heads) {
    parts.push(h, ``);
    if (good) parts.push(`A good emergency plumber in Leeds will isolate the water first.`, ``);
    for (let i = 0; i < 4; i++) parts.push(filler, ``);
  }
  parts.push(`Our [emergency call-out page](https://leedsplumbing.co.uk/emergency) lists the areas we cover, and the [WaterSafe register](https://www.watersafe.org.uk/) is where to check credentials.`);
  return parts.join("\n");
}

type Emitted = { kind: string; payload: any };

function fakeCtx() {
  const data: Emitted[] = [];
  const progress: { fraction: number; label?: string }[] = [];
  const logs: string[] = [];
  return {
    data,
    progress,
    logs,
    ctx: {
      onProgress: () => {},
      data: (kind: string, payload: unknown) => data.push({ kind, payload }),
      progress: (fraction: number, label?: string) => progress.push({ fraction, label }),
      log: (message: string) => logs.push(message),
    },
  };
}

function job(data: Record<string, unknown>) {
  return { id: "job-1", name: "seo", data: { tenantId: "t-1", pages: PAGES, profile: {}, ...data } } as any;
}

/* ---------------------------------------------------------------- the contract ---------- */

test("the output matches the manifest's declared shape, field for field", async () => {
  const { ctx } = fakeCtx();
  const out: any = await new SeoAgent().run(job({ article: { body: body(true), contentItemId: null }, keywords: [KW] }), ctx as any);

  // Asserted against the manifest itself, not against a copy of it: change
  // brain/manifests.ts's `output` and this test fails before production does.
  assert.deepEqual(validateAgainstSchema(SPEC.output, out, "seo.check_seo output"), []);
  assert.equal(typeof out.score, "number");
  assert.equal(typeof out.passed, "boolean");
  assert.ok(Array.isArray(out.issues));
  for (const issue of out.issues) {
    for (const k of ["id", "severity", "what", "fix"]) assert.ok(k in issue, `issue is missing ${k}`);
    assert.ok(["block", "warn", "info"].includes(issue.severity), issue.severity);
  }
});

test("the manifest still says what this agent was built against", () => {
  // If someone renames the action or changes what it provides, the planner's chain to
  // publish_article changes with it — and this agent's whole reason to exist is that chain.
  assert.equal(SPEC.provides, "seo_passed");
  assert.deepEqual(SPEC.needs, ["article"]);
  assert.equal(SPEC.irreversible, false);
  assert.deepEqual(Object.keys(SPEC.output).sort(), ["issues", "passed", "score"]);
});

test("seo is no longer registered as a stub", () => {
  // The one-line change that lets the planner offer this tool at all. Without it, "article
  // likh ke publish karo" is refused before a credit is spent (brain/adapter.ts).
  assert.equal(STUB_AGENTS.has("seo"), false);
  assert.equal(STUB_AGENTS.has("social"), true, "the other stub is untouched");
});

/* ---------------------------------------------------------------- behaviour ------------- */

test("a good draft passes; the score is emitted once and every issue separately", async () => {
  const { ctx, data, progress } = fakeCtx();
  const out: any = await new SeoAgent().run(job({ article: { body: body(true) }, keywords: [KW] }), ctx as any);

  assert.equal(out.passed, true, out.summary);
  assert.ok(out.score >= 75, out.summary);
  assert.equal(out.sendBackToWriter, false);

  const scores = data.filter((d) => d.kind === "score");
  assert.equal(scores.length, 1, "exactly one score event");
  assert.equal(scores[0].payload.score, out.score);
  assert.equal(scores[0].payload.threshold, 75);
  assert.equal(scores[0].payload.serpCompared, false);
  assert.equal(scores[0].payload.keyword, KW);

  const issues = data.filter((d) => d.kind === "issue");
  assert.equal(issues.length, out.issues.length, "one event per issue, no more and no fewer");
  assert.deepEqual(issues.map((i) => i.payload.id), out.issues.map((i: any) => i.id));
  assert.deepEqual(data.map((d) => d.kind).filter((k, i, a) => a.indexOf(k) === i), ["score", "issue"]);

  assert.equal(progress[progress.length - 1].fraction, 1);
});

test("a bad draft fails, names the blockers, and asks for the writer — without re-queueing one", async () => {
  const { ctx, data } = fakeCtx();
  const out: any = await new SeoAgent().run(job({ article: { body: body(false) }, keywords: [KW] }), ctx as any);

  assert.equal(out.passed, false, out.summary);
  assert.equal(out.sendBackToWriter, true);
  const blocking = out.issues.filter((i: any) => i.severity === "block");
  assert.ok(blocking.length >= 2, out.summary);
  // Every blocker arrives with an instruction, because the next hop is a writer, not a human.
  for (const i of blocking) assert.ok(i.fix.length > 10, `${i.id} has no fix`);
  // The agent reports; it does not restart the pipeline. Nothing but score/issue is emitted.
  assert.deepEqual([...new Set(data.map((d) => d.kind))].sort(), ["issue", "score"]);
});

test("the SERP comparison is absent and said to be absent when DataForSEO is unconfigured", async () => {
  const { ctx } = fakeCtx();
  const out: any = await new SeoAgent().run(job({ article: { body: body(true) }, keywords: [KW] }), ctx as any);
  assert.equal(out.serpCompared, false);
  assert.match(out.serpNote, /DataForSEO is not configured/);
  assert.ok(!out.checks.some((c: any) => c.id.startsWith("serp-") && c.severity !== "info"));
});

/* ---------------------------------------------------------------- inputs ---------------- */

test("keywords are read from a list, from Mr. Keyword's output, or from the blueprint", async () => {
  const run = async (extra: Record<string, unknown>) => {
    const { ctx } = fakeCtx();
    return (await new SeoAgent().run(job({ article: { body: body(true) }, ...extra }), ctx as any)) as any;
  };

  assert.equal((await run({ keywords: [KW, "burst pipe"] })).primaryKeyword, KW);
  assert.equal((await run({ keywords: { recommended: KW, relatedKeywords: [{ keyword: "burst pipe" }] } })).primaryKeyword, KW);
  assert.equal((await run({ blueprint: `Primary keyword: ${KW}\n\nRelated queries:` })).primaryKeyword, KW);
  assert.equal((await run({ topic: KW })).primaryKeyword, KW);
  // Nothing to go on: the keyword checks report themselves skipped rather than invented.
  const blind = await run({});
  assert.equal(blind.primaryKeyword, null);
  assert.equal(blind.checks.find((c: any) => c.id === "keyword-density").severity, "info");
});

test("no draft at all is an error with a sentence, never a score on nothing", async () => {
  const { ctx } = fakeCtx();
  await assert.rejects(() => new SeoAgent().run(job({}), ctx as any), /article hi nahi mila/);
});
