import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpAgent, verifyCallbackSignature, signRun, expressBridge, type CallbackMessage } from "./adapters/http.js";
import { remoteAgent, RemoteAgentError } from "./client.js";
import { defineAgent } from "./agent.js";
import { sampleManifest } from "./sample.fixture.js";

const agent = defineAgent({
  manifest: sampleManifest,
  handlers: {
    write_article: async (ctx) => {
      ctx.step("research", "Reading");
      ctx.data("keyword", { kw: "solar" });
      await ctx.llm.complete({ messages: [{ role: "user", content: "x" }] });
      ctx.step("write", "Writing");
      return { markdown: "# hi", title: "hi", meta: {}, sources: [] };
    },
  },
});

const llm = { async complete() { return { text: "ok", model: "fake", tokens_in: 3, tokens_out: 2 }; } };

interface Posted { url: string; headers: Record<string, string>; msg: CallbackMessage }
function fakeFetch(failFirst = 0) {
  const posted: Posted[] = [];
  let fails = failFirst;
  const fetch = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    posted.push({ url, headers: init.headers, msg: JSON.parse(init.body) });
    if (fails > 0) { fails -= 1; return { ok: false, status: 503 }; }
    return { ok: true, status: 200 };
  };
  return { posted, fetch };
}

const runBody = (run_id = "r1") => ({
  run_id,
  tenant_id: "t1",
  action: "write_article",
  input: { topic: "solar", keywords: ["a"] },
  context: {},
  callback_url: "http://brain.local/callback",
});

test("GET /health and /manifest need no token", async () => {
  const { handle } = createHttpAgent(agent, { token: "s3cret", llm });
  const h = await handle({ method: "GET", path: "/health", headers: {} });
  assert.equal(h.status, 200);
  assert.deepEqual({ ...(h.body as object), uptime: 0 }, { ok: true, version: "1.2.0", uptime: 0 });
  const m = await handle({ method: "GET", path: "/manifest", headers: {} });
  assert.equal(m.status, 200);
  assert.equal((m.body as { id: string }).id, "writer");
  const nf = await handle({ method: "GET", path: "/nope", headers: {} });
  assert.equal(nf.status, 404);
});

test("POST /run → 401 without / with wrong token", async () => {
  const { handle } = createHttpAgent(agent, { token: "s3cret", llm });
  const r1 = await handle({ method: "POST", path: "/run", headers: {}, body: runBody() });
  assert.equal(r1.status, 401);
  const r2 = await handle({ method: "POST", path: "/run", headers: { "x-agent-token": "wrong" }, body: runBody() });
  assert.equal(r2.status, 401);
});

test("POST /run → 400 on bad body, 409 on duplicate run_id", async () => {
  const { handle, drain } = createHttpAgent(agent, { token: "s3cret", llm, fetch: fakeFetch().fetch });
  const bad = await handle({ method: "POST", path: "/run", headers: { "X-Agent-Token": "s3cret" }, body: { run_id: "x" } });
  assert.equal(bad.status, 400);
  assert.ok((bad.body as { details: string[] }).details.includes("callback_url must be a non-empty string"));
  const ok = await handle({ method: "POST", path: "/run", headers: { "x-agent-token": "s3cret" }, body: runBody("dup") });
  assert.equal(ok.status, 202);
  const dup = await handle({ method: "POST", path: "/run", headers: { "x-agent-token": "s3cret" }, body: runBody("dup") });
  assert.equal(dup.status, 409);
  await drain();
});

test("POST /run → 202 immediately; callback receives events then signed result", async () => {
  const { posted, fetch } = fakeFetch();
  const { handle, drain } = createHttpAgent(agent, { token: "s3cret", callbackToken: "cb", llm, fetch, batchMs: 10 });

  const res = await handle({ method: "POST", path: "/run", headers: { "x-agent-token": "s3cret" }, body: JSON.stringify(runBody()) });
  assert.equal(res.status, 202);
  assert.deepEqual(res.body, { accepted: true, run_id: "r1" });
  assert.equal(posted.length, 0, "202 must be returned before any callback");

  await drain();

  assert.ok(posted.length >= 2);
  const eventMsgs = posted.filter((p) => p.msg.kind === "event");
  const resultMsgs = posted.filter((p) => p.msg.kind === "result");
  assert.equal(resultMsgs.length, 1);
  assert.equal(posted.at(-1)?.msg.kind, "result", "result must be the last message");

  const types = eventMsgs.flatMap((p) => (p.msg.kind === "event" ? p.msg.events.map((e) => e.type) : []));
  assert.deepEqual(types, ["run_started", "step_started", "data", "step_finished", "step_started", "step_finished"]);

  const result = resultMsgs[0];
  assert.equal(result.url, "http://brain.local/callback");
  assert.equal(result.headers["x-agent-token"], "s3cret");
  assert.ok(result.msg.kind === "result" && result.msg.result.ok === true);
  assert.equal(result.msg.kind === "result" && result.msg.result.ok && result.msg.result.llm_calls, 1);
  assert.equal(verifyCallbackSignature("cb", "r1", "ok", result.headers["x-run-signature"]), true);
  assert.equal(verifyCallbackSignature("s3cret", "r1", "ok", result.headers["x-run-signature"]), false, "signed with callbackToken, not token");
  for (const ev of eventMsgs) assert.equal(verifyCallbackSignature("cb", "r1", "event", ev.headers["x-run-signature"]), true);
});

test("result POST retries 3× with backoff", async () => {
  const { posted, fetch } = fakeFetch(2);
  const { handle, drain } = createHttpAgent(agent, { token: "t", llm, fetch, batchMs: 5 });
  await handle({ method: "POST", path: "/run", headers: { "x-agent-token": "t" }, body: runBody("retry") });
  await drain();
  // the first 2 POSTs (event batch) fail, they are not retried; result then fails once more and succeeds on retry
  const results = posted.filter((p) => p.msg.kind === "result");
  assert.ok(results.length >= 2 && results.length <= 3, `result posted ${results.length} times`);
});

test("failed run posts result with status 'error' signature", async () => {
  const failing = defineAgent({
    manifest: sampleManifest,
    handlers: { write_article: async () => { throw new Error("nope"); } },
  });
  const { posted, fetch } = fakeFetch();
  const { handle, drain } = createHttpAgent(failing, { token: "t", fetch });
  await handle({ method: "POST", path: "/run", headers: { "x-agent-token": "t" }, body: runBody("f1") });
  await drain();
  const result = posted.find((p) => p.msg.kind === "result")!;
  assert.ok(result.msg.kind === "result" && result.msg.result.ok === false && result.msg.result.error === "nope");
  assert.equal(verifyCallbackSignature("t", "f1", "error", result.headers["x-run-signature"]), true);
});

test("verifyCallbackSignature rejects tampered status / run_id / garbage", () => {
  const sig = signRun("secret", "r1", "ok");
  assert.equal(verifyCallbackSignature("secret", "r1", "ok", sig), true);
  assert.equal(verifyCallbackSignature("secret", "r1", "error", sig), false);
  assert.equal(verifyCallbackSignature("secret", "r2", "ok", sig), false);
  assert.equal(verifyCallbackSignature("other", "r1", "ok", sig), false);
  assert.equal(verifyCallbackSignature("secret", "r1", "ok", undefined), false);
  assert.equal(verifyCallbackSignature("secret", "r1", "ok", "zz"), false);
});

test("expressBridge adapts (req, res) structurally", async () => {
  const { handle } = createHttpAgent(agent, { token: "t", llm });
  const bridge = expressBridge(handle);
  let status = 0;
  let body: unknown;
  await bridge(
    { method: "GET", path: "/health", headers: {} },
    { status(c) { status = c; return this; }, json(b) { body = b; } },
  );
  assert.equal(status, 200);
  assert.equal((body as { ok: boolean }).ok, true);
});

test("remoteAgent client: health, manifest, run via in-memory fetch; errors include status + agent id", async () => {
  const { handle } = createHttpAgent(agent, { token: "t", llm, fetch: fakeFetch().fetch });
  const memFetch: typeof globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    const out = await handle({
      method: init?.method ?? "GET",
      path: u.pathname,
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { "content-type": "application/json" } });
  };

  const ok = remoteAgent({ baseUrl: "http://writer.local/", token: "t", fetch: memFetch });
  assert.equal((await ok.health()).ok, true);
  assert.equal((await ok.manifest()).id, "writer");
  assert.deepEqual(await ok.run(runBody("c1")), { accepted: true, run_id: "c1" });

  const bad = remoteAgent({ baseUrl: "http://writer.local", token: "wrong", fetch: memFetch, agentId: "writer" });
  await assert.rejects(bad.run(runBody("c2")), (e: unknown) => e instanceof RemoteAgentError && e.status === 401 && e.message.includes("[agent writer]"));

  const slow = remoteAgent({ baseUrl: "http://x", token: "t", timeoutMs: 20, agentId: "slow", fetch: (_u, init) =>
    new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))) });
  await assert.rejects(slow.health(), (e: unknown) => e instanceof RemoteAgentError && /timeout after 20ms/.test(e.message));
});
