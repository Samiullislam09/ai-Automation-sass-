/** Run: cd agent-server && npx tsx --test src/brain/registry.test.ts
 *
 *  The registry's job is to refuse contradictions, so most of these tests inject a
 *  contradiction on purpose and check it is caught with the right shape. The first test is the
 *  important one though: the manifests we actually ship have zero problems, and it will fail
 *  the day somebody adds an agent that steals another agent's phrase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActionSpec, Manifest } from "../vendor/agent-contract/index.js";
import { MANIFESTS, NOT_YET_ROUTED, STUB_AGENTS } from "./manifests.js";
import {
  assertHealthyRegistry,
  buildRegistry,
  describeCapabilities,
  enabledActions,
  normalizePhrase,
  syncToDatabase,
  toAgentRows,
  type AgentRow,
  type SupabaseLike,
} from "./registry.js";

const REAL_OPTS = { stubs: STUB_AGENTS, notRouted: NOT_YET_ROUTED };

/** A minimal valid manifest, so a test can state only the thing it is testing. */
function fakeAgent(id: string, actions: Array<Partial<ActionSpec> & { id: string }>): Manifest {
  return {
    id,
    name: `Mr. ${id}`,
    version: "1.0.0",
    description: `test agent ${id}`,
    actions: actions.map((a) => ({
      phrases: [`${a.id} phrase`],
      input: {},
      output: {},
      irreversible: false,
      estimated_seconds: 10,
      cost_units: 1,
      needs: [],
      provides: a.id,
      ...a,
    })) as ActionSpec[],
    office: { room: id, ico: "🧪", color: "#123456" },
  };
}

// ── the manifests we actually ship ────────────────────────────────────────────────────────

test("the real manifests build a registry with zero problems", () => {
  const reg = buildRegistry(MANIFESTS, REAL_OPTS);
  assert.deepEqual(reg.problems, [], `registry problems: ${JSON.stringify(reg.problems, null, 2)}`);
  assert.equal(reg.agents.size, MANIFESTS.length);
  assert.equal(reg.actions.size, MANIFESTS.reduce((n, m) => n + m.actions.length, 0));
  assert.doesNotThrow(() => assertHealthyRegistry(reg));
});

test("every action resolves to the agent that declared it", () => {
  const reg = buildRegistry(MANIFESTS, REAL_OPTS);
  assert.equal(reg.actions.get("find_keywords")?.agent_id, "keyword");
  assert.equal(reg.actions.get("write_article")?.agent_id, "writer");
  assert.equal(reg.actions.get("research_brief")?.agent_id, "writer");
  assert.equal(reg.actions.get("publish_article")?.agent_id, "publish");
  assert.equal(reg.actions.get("make_images"), undefined); // no image agent exists today
});

// ── the four problem kinds ────────────────────────────────────────────────────────────────

test("two agents claiming one action id → duplicate_action, and the first one keeps it", () => {
  const rival = fakeAgent("rival", [{ id: "find_keywords", phrases: ["rival keywords"] }]);
  const reg = buildRegistry([...MANIFESTS, rival], REAL_OPTS);

  const dupes = reg.problems.filter((p) => p.kind === "duplicate_action");
  assert.equal(dupes.length, 1);
  assert.deepEqual(dupes[0], { kind: "duplicate_action", action: "find_keywords", agents: ["keyword", "rival"] });
  assert.equal(reg.actions.get("find_keywords")?.agent_id, "keyword");
  // Not fatal: the rest of the team still works.
  assert.doesNotThrow(() => assertHealthyRegistry(reg));
});

test("two actions claiming one phrase → phrase_collision, case and whitespace insensitive", () => {
  const rival = fakeAgent("story", [{ id: "write_story", phrases: ["Article   LIKHO"] }]);
  const reg = buildRegistry([...MANIFESTS, rival], REAL_OPTS);

  const collisions = reg.problems.filter((p) => p.kind === "phrase_collision");
  assert.equal(collisions.length, 1);
  assert.deepEqual(collisions[0], {
    kind: "phrase_collision",
    phrase: "article likho",
    actions: ["write_article", "write_story"],
  });
});

test("a phrase collision is fatal and the error names exactly what collides", () => {
  const rival = fakeAgent("story", [{ id: "write_story", phrases: ["article likho"] }]);
  const reg = buildRegistry([...MANIFESTS, rival], REAL_OPTS);
  assert.throws(
    () => assertHealthyRegistry(reg),
    (err: Error) =>
      /refuses to start/.test(err.message) &&
      err.message.includes('"article likho"') &&
      err.message.includes("write_article") &&
      err.message.includes("write_story"),
  );
});

test("one action listing the same phrase twice is not a collision", () => {
  const twice = fakeAgent("twice", [{ id: "do_thing", phrases: ["do thing", "DO  THING"] }]);
  const reg = buildRegistry([twice]);
  assert.deepEqual(reg.problems, []);
});

test("a cycle in needs/provides → cycle problem, and it is fatal", () => {
  const a = fakeAgent("cyc_a", [{ id: "act_a", provides: "alpha", needs: ["beta"] }]);
  const b = fakeAgent("cyc_b", [{ id: "act_b", provides: "beta", needs: ["alpha"] }]);
  const reg = buildRegistry([a, b]);

  const cycles = reg.problems.filter((p) => p.kind === "cycle");
  assert.equal(cycles.length, 1, `expected one cycle, got ${JSON.stringify(reg.problems)}`);
  assert.deepEqual([...cycles[0].involved].sort(), ["act_a", "act_a", "act_b"].sort());
  assert.throws(() => assertHealthyRegistry(reg), /cycle in needs\/provides/);
});

test("an invalid manifest → invalid_manifest, and none of its actions are registered", () => {
  const broken = { id: "broken", name: "", version: "not-semver", description: "x", actions: [], office: {} };
  const reg = buildRegistry([...MANIFESTS, broken], REAL_OPTS);

  const invalid = reg.problems.filter((p) => p.kind === "invalid_manifest");
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].agent_id, "broken");
  assert.ok(invalid[0].errors.length >= 3, `expected several errors, got ${JSON.stringify(invalid[0].errors)}`);
  assert.equal(reg.agents.has("broken"), false);
  // Not fatal — the healthy agents still boot.
  assert.doesNotThrow(() => assertHealthyRegistry(reg));
});

test("a manifest that is not even an object is reported, not thrown", () => {
  const reg = buildRegistry([null, 42, "writer"]);
  assert.equal(reg.problems.length, 3);
  assert.ok(reg.problems.every((p) => p.kind === "invalid_manifest"));
  assert.equal(reg.agents.size, 0);
});

// ── stubs and health ──────────────────────────────────────────────────────────────────────

test("stub and not-yet-routed agents are registered but disabled", () => {
  const reg = buildRegistry(MANIFESTS, REAL_OPTS);
  // seo and publish left this list on 2026-08-27 when they got real implementations. The list
  // is read from the shipped sets rather than written out, so the next agent to graduate makes
  // this test follow it instead of failing it.
  for (const id of [...STUB_AGENTS, ...NOT_YET_ROUTED]) {
    const agent = reg.agents.get(id);
    assert.ok(agent, `${id} should still be registered`);
    assert.equal(agent.enabled, false, `${id} should be disabled`);
    assert.equal(agent.healthy, false, `${id} should not be healthy`);
  }
  assert.equal(reg.agents.get("keyword")?.enabled, true);
  assert.equal(reg.agents.get("keyword")?.healthy, true);
});

test("enabledActions offers every action once its agent stops being a stub", () => {
  // Miss Social was the last stub; the day it un-stubbed, this list grew by one rather than
  // needing a hidden-tools branch — the whole point of driving this off STUB_AGENTS.
  const reg = buildRegistry(MANIFESTS, REAL_OPTS);
  const offered = enabledActions(reg).map((a) => a.spec.id);

  assert.deepEqual(offered, [
    "audit_site",
    "build_site_profile",
    "check_seo",
    "crawl_site",
    "draft_social",
    "find_keywords",
    "find_leads",
    "plan_topics",
    "publish_article",
    "research_brief",
    "write_article",
  ]);
});

test("a stub agent's action is registered but never offered — the seam this whole mechanism protects", () => {
  const reg = buildRegistry(MANIFESTS, { stubs: new Set(["social"]), notRouted: NOT_YET_ROUTED });
  const offered = enabledActions(reg).map((a) => a.spec.id);
  assert.ok(!offered.includes("draft_social"), "a stub must not be offered to the model");
  assert.ok(reg.actions.has("draft_social"), "but it stays in the graph so the planner can explain it");
});

test("an enabled agent that failed its health check is also kept out of enabledActions", () => {
  const reg = buildRegistry(MANIFESTS, { ...REAL_OPTS, healthy: { keyword: false } });
  assert.equal(reg.agents.get("keyword")?.enabled, true);
  assert.equal(reg.agents.get("keyword")?.healthy, false);
  assert.ok(!enabledActions(reg).some((a) => a.spec.id === "find_keywords"));
});

test("baseUrls are attached; absent means in-process", () => {
  const reg = buildRegistry(MANIFESTS, { ...REAL_OPTS, baseUrls: { writer: "https://writer.example" } });
  assert.equal(reg.agents.get("writer")?.base_url, "https://writer.example");
  assert.equal(reg.agents.get("keyword")?.base_url, null);
});

// ── capabilities text ─────────────────────────────────────────────────────────────────────

test("describeCapabilities is all CAN DO NOW once nothing is a stub", () => {
  const text = describeCapabilities(buildRegistry(MANIFESTS, REAL_OPTS));
  assert.match(text, /CAN DO NOW/);
  assert.match(text, /Mr\. Keyword \(.*\) — .*keyword/i);
  assert.match(text, /Mr\. SEO/);
  assert.match(text, /Miss Social/);
  assert.equal(text.includes("CANNOT DO YET"), false, "nothing is a stub, so there is nothing to be honest about not doing");
  assert.ok(text.length < 2000, "this block is prepended to every chat turn — keep it small");
  // No internal registry key in customer-facing text (live 2026-08-27: the model read
  // "build_site_profile" here as the action's name and repeated it verbatim to a customer).
  assert.equal(/find_keywords|check_seo|draft_social|build_site_profile/.test(text), false, "action ids must never reach the model's context — phrases already say the same thing in plain language");
});

test("describeCapabilities puts a stub agent's action in CANNOT DO YET, not CAN DO NOW", () => {
  const text = describeCapabilities(buildRegistry(MANIFESTS, { stubs: new Set(["social"]), notRouted: NOT_YET_ROUTED }));
  assert.match(text, /CANNOT DO YET/);
  const [can, cannot] = text.split("CANNOT DO YET");
  assert.ok(can.includes("Mr. SEO"), "a real agent must be offered");
  assert.ok(!cannot.includes("Mr. SEO"));
  assert.ok(cannot.includes("Miss Social"), "a stub must be listed as something we cannot do");
});

// ── database sync ─────────────────────────────────────────────────────────────────────────

test("toAgentRows matches the agents table in migration 017", () => {
  const reg = buildRegistry(MANIFESTS, REAL_OPTS);
  const rows = toAgentRows(reg, "2026-08-27T10:00:00.000Z");
  const kw = rows.find((r) => r.id === "keyword")!;

  assert.deepEqual(Object.keys(kw).sort(), ["base_url", "enabled", "healthy_at", "id", "manifest", "name", "updated_at", "version"]);
  assert.equal(kw.name, "Mr. Keyword");
  assert.equal(kw.version, "2.0.0");
  assert.equal(kw.enabled, true);
  assert.equal(kw.healthy_at, "2026-08-27T10:00:00.000Z");
  assert.equal(kw.manifest.actions[0].id, "find_keywords");

  // With REAL_OPTS (no stubs left), every registered agent is enabled — Miss Social included.
  const social = rows.find((r) => r.id === "social")!;
  assert.equal(social.enabled, true, "Miss Social became a real agent on 2026-08-27");

  const seo = rows.find((r) => r.id === "seo")!;
  assert.equal(seo.enabled, true, "Mr. SEO became a real agent on 2026-08-27");
});

test("syncToDatabase upserts on id and never touches a real database in tests", async () => {
  const captured: { table?: string; rows?: AgentRow[]; opts?: { onConflict?: string } } = {};
  const fake: SupabaseLike = {
    from(table) {
      captured.table = table;
      return {
        upsert(rows, options) {
          captured.rows = rows;
          captured.opts = options;
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const reg = buildRegistry(MANIFESTS, REAL_OPTS);
  const res = await syncToDatabase(fake, reg, "2026-08-27T10:00:00.000Z");

  assert.equal(res.upserted, MANIFESTS.length);
  assert.equal(captured.table, "agents");
  assert.deepEqual(captured.opts, { onConflict: "id" });
  assert.equal(captured.rows?.length, MANIFESTS.length);
});

test("syncToDatabase surfaces a database error instead of pretending it worked", async () => {
  const fake: SupabaseLike = {
    from: () => ({ upsert: () => Promise.resolve({ error: { message: "permission denied" } }) }),
  };
  await assert.rejects(() => syncToDatabase(fake, buildRegistry(MANIFESTS, REAL_OPTS)), /registry sync failed: permission denied/);
});

// ── small things ──────────────────────────────────────────────────────────────────────────

test("normalizePhrase folds case and whitespace only", () => {
  assert.equal(normalizePhrase("  Article   LIKHO "), "article likho");
  assert.equal(normalizePhrase("publish?"), "publish?");
});

test("building the registry twice gives the same answer", () => {
  const a = buildRegistry(MANIFESTS, REAL_OPTS);
  const b = buildRegistry(MANIFESTS, REAL_OPTS);
  assert.deepEqual([...a.actions.keys()], [...b.actions.keys()]);
  assert.deepEqual(a.problems, b.problems);
});
