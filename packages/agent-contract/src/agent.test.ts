import { test } from "node:test";
import assert from "node:assert/strict";
import { defineAgent, runAction, AgentError, ManifestError } from "./agent.js";
import { inProcess } from "./adapters/inprocess.js";
import type { AgentEvent } from "./events.js";
import type { LlmClient } from "./context.js";
import { sampleManifest } from "./sample.fixture.js";

const fakeLlm = (): LlmClient & { calls: number } => {
  const c = {
    calls: 0,
    async complete(req: { messages: { content: string }[] }) {
      c.calls += 1;
      return { text: `echo: ${req.messages.at(-1)?.content ?? ""}`, model: "fake", tokens_in: 10, tokens_out: 5 };
    },
  };
  return c;
};

const req = () => ({
  run_id: "run_1",
  tenant_id: "t_1",
  action: "write_article",
  input: { topic: "solar panels", keywords: ["solar cost"] },
  context: { niche: "energy" },
});

function makeAgent(handler?: Parameters<typeof defineAgent>[0]["handlers"]["x"]) {
  return defineAgent({
    manifest: sampleManifest,
    handlers: {
      write_article:
        handler ??
        (async (ctx) => {
          ctx.step("research", "Reading top pages");
          ctx.progress(0.5, "5/10");
          ctx.data("keyword", { kw: "solar cost", vol: 100 });
          await ctx.llm.complete({ messages: [{ role: "user", content: "outline" }] });
          ctx.step("write", "Writing");
          await ctx.llm.complete({ messages: [{ role: "user", content: "section" }] });
          ctx.log("done writing");
          return { markdown: "# Solar", title: "Solar", meta: { d: "x" }, sources: ["https://a"] };
        }),
    },
  });
}

test("defineAgent throws with the error list for a bad manifest", () => {
  assert.throws(
    () => defineAgent({ manifest: { ...sampleManifest, version: "x" }, handlers: { write_article: async () => ({}) } }),
    (e: unknown) => e instanceof ManifestError && e.errors.some((m) => m.includes("semver")),
  );
});

test("defineAgent throws when an action has no handler", () => {
  assert.throws(
    () => defineAgent({ manifest: sampleManifest, handlers: {} }),
    (e: unknown) => e instanceof ManifestError && e.errors.includes('no handler for action "write_article"'),
  );
});

test("runAction happy path: event sequence, llm counting, usage", async () => {
  const events: AgentEvent[] = [];
  const llm = fakeLlm();
  const r = await runAction(makeAgent(), req(), { sink: (e) => { events.push(e); }, llm });

  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.output, { markdown: "# Solar", title: "Solar", meta: { d: "x" }, sources: ["https://a"] });
  assert.equal(r.llm_calls, 2);
  assert.equal(llm.calls, 2);
  assert.equal(r.tokens_in, 20);
  assert.equal(r.tokens_out, 10);
  assert.equal(r.cost_units, 40);
  assert.ok(r.ms >= 0);

  assert.deepEqual(
    events.map((e) => e.type),
    ["run_started", "step_started", "progress", "data", "step_finished", "step_started", "log", "step_finished", "run_finished"],
  );
  for (const e of events) {
    assert.equal(e.run_id, "run_1");
    assert.equal(e.tenant_id, "t_1");
    assert.equal(e.agent_id, "writer");
    assert.ok(!Number.isNaN(Date.parse(e.at)));
  }
  const data = events.find((e) => e.type === "data");
  assert.ok(data && data.type === "data" && data.step_id === "research" && data.kind === "keyword");
  const fin = events.at(-1);
  assert.ok(fin && fin.type === "run_finished" && fin.llm_calls === 2 && fin.tokens_in === 20);
});

test("runAction: timeout → run_error retryable, handler sees aborted signal", async () => {
  const events: AgentEvent[] = [];
  let sawAbort = false;
  const agent = makeAgent(async (ctx) => {
    await new Promise<void>((resolve) => {
      ctx.signal.addEventListener("abort", () => { sawAbort = true; resolve(); });
    });
    await new Promise((r) => setTimeout(r, 50));
    return { markdown: "late" };
  });
  const r = await runAction(agent, req(), { sink: (e) => { events.push(e); }, timeoutMs: 30 });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.retryable, true);
  assert.match(r.error, /timeout/);
  assert.equal(sawAbort, true);
  assert.deepEqual(events.map((e) => e.type), ["run_started", "run_error"]);
  const err = events[1];
  assert.ok(err.type === "run_error" && err.retryable === true);
});

test("runAction: handler throw → run_error (not retryable by default, AgentError controls it)", async () => {
  const r1 = await runAction(makeAgent(async () => { throw new Error("boom"); }), req());
  assert.deepEqual({ ok: r1.ok, error: !r1.ok && r1.error, retryable: !r1.ok && r1.retryable }, { ok: false, error: "boom", retryable: false });

  const r2 = await runAction(makeAgent(async () => { throw new AgentError("apollo 503", true); }), req());
  assert.ok(!r2.ok && r2.retryable === true && r2.error === "apollo 503");
});

test("runAction: invalid input / unknown action / invalid output never throw", async () => {
  const agent = makeAgent();
  const bad = await runAction(agent, { ...req(), input: { keywords: "x" } });
  assert.ok(!bad.ok && bad.error.includes("input.topic is required") && bad.retryable === false);

  const unknown = await runAction(agent, { ...req(), action: "dance" });
  assert.ok(!unknown.ok && unknown.error.includes('unknown action "dance"'));

  const badOut = await runAction(makeAgent(async () => ({ title: "no markdown" })), req());
  assert.ok(!badOut.ok && badOut.error.includes("output.markdown is required"));
});

test("runAction: noLlm default throws a clear error inside the handler", async () => {
  const r = await runAction(makeAgent(async (ctx) => {
    await ctx.llm.complete({ messages: [] });
    return {};
  }), req());
  assert.ok(!r.ok && r.error.includes("no LlmClient was injected"));
});

test("inProcess adapter runs with injected llm + sink", async () => {
  const events: AgentEvent[] = [];
  const a = inProcess(makeAgent(), { llm: fakeLlm(), sink: (e) => { events.push(e); } });
  const r = await a.run(req());
  assert.equal(r.ok, true);
  assert.equal(events[0].type, "run_started");
  assert.equal(events.at(-1)?.type, "run_finished");
});
