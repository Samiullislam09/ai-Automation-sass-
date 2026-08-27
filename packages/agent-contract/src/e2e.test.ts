/**
 * End-to-end round trip over real sockets — no mocks, no fake fetch.
 *
 * Two `node:http` servers on ephemeral ports:
 *   1. the echo agent (examples/echo-agent/server.ts) hosting `createHttpAgent`
 *   2. a fake "brain" that receives the signed callbacks
 *
 * and the real `remoteAgent` client in between. This is the Phase 0 exit
 * criterion: a dummy echo agent serves a manifest and /run → callback
 * round-trips.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { validateManifest } from "./manifest.js";
import { verifyCallbackSignature, type CallbackMessage } from "./adapters/http.js";
import { remoteAgent, RemoteAgentError } from "./client.js";
import type { AgentEvent } from "./events.js";
import { startEchoServer, type EchoServer } from "../examples/echo-agent/server.js";

const TOKEN = "e2e-secret-token";

// --------------------------------------------------------------------------
// the fake brain: collects every callback POST exactly as it arrives
// --------------------------------------------------------------------------
interface Received {
  headers: IncomingHttpHeaders;
  msg: CallbackMessage;
}

interface Brain {
  url: string;
  received: Received[];
  /** All `kind: "event"` messages flattened, in receipt order. */
  events(): AgentEvent[];
  result(): Extract<CallbackMessage, { kind: "result" }> | undefined;
  waitForResult(timeoutMs?: number): Promise<Received>;
  close(): Promise<void>;
}

async function startBrain(): Promise<Brain> {
  const received: Received[] = [];
  let notify: (() => void) | undefined;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        received.push({ headers: req.headers, msg: JSON.parse(Buffer.concat(chunks).toString("utf8")) as CallbackMessage });
      } catch {
        res.writeHead(400).end();
        return;
      }
      notify?.();
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const findResult = () => received.find((r) => r.msg.kind === "result");

  return {
    url: `http://127.0.0.1:${port}/callback`,
    received,
    events: () => received.flatMap((r) => (r.msg.kind === "event" ? r.msg.events : [])),
    result: () => findResult()?.msg as Extract<CallbackMessage, { kind: "result" }> | undefined,
    waitForResult: (timeoutMs = 5_000) =>
      new Promise<Received>((resolve, reject) => {
        const done = findResult();
        if (done) return resolve(done);
        const timer = setTimeout(() => {
          notify = undefined;
          reject(new Error(`no result callback within ${timeoutMs}ms (got ${received.length} message(s))`));
        }, timeoutMs);
        notify = () => {
          const hit = findResult();
          if (!hit) return;
          clearTimeout(timer);
          notify = undefined;
          resolve(hit);
        };
      }),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

async function bothUp(batchMs?: number): Promise<{ echo: EchoServer; brain: Brain; close: () => Promise<void> }> {
  const echo = await startEchoServer({ token: TOKEN, port: 0, ...(batchMs !== undefined ? { batchMs } : {}) });
  const brain = await startBrain();
  return {
    echo,
    brain,
    close: async () => {
      await echo.close();
      await brain.close();
    },
  };
}

// --------------------------------------------------------------------------

test("e2e: health + manifest + /run → signed callbacks round-trip over real HTTP", async (t) => {
  const { echo, brain, close } = await bothUp(50);
  t.after(close);

  const client = remoteAgent({ baseUrl: `http://127.0.0.1:${echo.port}`, token: TOKEN });

  // ---- GET /health --------------------------------------------------------
  const health = await client.health();
  assert.equal(health.ok, true);
  assert.equal(health.version, "1.0.0");
  assert.equal(typeof health.uptime, "number");

  // ---- GET /manifest ------------------------------------------------------
  const manifest = await client.manifest();
  const v = validateManifest(manifest);
  assert.equal(v.ok, true, v.ok ? "" : `manifest invalid: ${v.errors.join("; ")}`);
  assert.equal(manifest.id, "echo");
  assert.equal(manifest.actions.length, 1);
  const spec = manifest.actions[0];
  assert.equal(spec.id, "echo");
  assert.equal(spec.provides, "echo", "provides defaults to the action id");
  assert.deepEqual(spec.input, { text: "string", delay_seconds: "number?" });
  assert.deepEqual(spec.output, { text: "string", steps: "number" });
  assert.equal(spec.cost_units, 0);
  assert.deepEqual(spec.needs, []);
  assert.ok(spec.phrases.includes("echo karo"));

  // ---- POST /run → 202 immediately, long before the run finishes -----------
  const run_id = "run_e2e_1";
  const text = "the quick brown fox";
  const started = performance.now();
  const accepted = await client.run({
    run_id,
    tenant_id: "tenant_e2e",
    action: "echo",
    input: { text, delay_seconds: 0.3 },
    context: { locale: "en" },
    callback_url: brain.url,
  });
  const acceptMs = performance.now() - started;

  assert.deepEqual(accepted, { accepted: true, run_id });
  assert.ok(acceptMs < 100, `202 must return immediately, took ${acceptMs.toFixed(1)}ms`);
  assert.equal(brain.result(), undefined, "the run cannot have finished before the 202");

  // ---- callbacks ----------------------------------------------------------
  const resultHit = await brain.waitForResult();
  const totalMs = performance.now() - started;
  assert.ok(totalMs > 250, `the run really took ~300ms, not ${totalMs.toFixed(1)}ms`);

  const events = brain.events();
  assert.deepEqual(
    events.map((e) => e.type),
    [
      "run_started",
      "step_started", "log", "step_finished",           // parse
      "step_started",                                    // echo
      "data", "progress", "data", "progress", "data", "progress", "data", "progress",
      "step_finished",
      "step_started", "log", "step_finished",            // assemble
    ],
  );
  assert.ok(brain.received.length >= 2, "events arrive before the result, in their own message(s)");
  assert.equal(brain.received.at(-1)?.msg.kind, "result", "the result message is always last");

  // every event carries the run identity
  for (const e of events) {
    assert.equal(e.run_id, run_id);
    assert.equal(e.tenant_id, "tenant_e2e");
    assert.equal(e.agent_id, "echo");
    assert.ok(!Number.isNaN(Date.parse(e.at)), `at must be ISO-8601, got ${e.at}`);
  }

  // the data chunks: one per word, in order
  const chunks = events.filter((e): e is Extract<AgentEvent, { type: "data" }> => e.type === "data");
  assert.deepEqual(
    chunks.map((c) => c.payload),
    [{ index: 0, word: "the" }, { index: 1, word: "quick" }, { index: 2, word: "brown" }, { index: 3, word: "fox" }],
  );
  assert.ok(chunks.every((c) => c.kind === "chunk" && c.step_id === "echo"));

  const fractions = events.filter((e) => e.type === "progress").map((e) => (e as { fraction: number }).fraction);
  assert.deepEqual(fractions, [0.25, 0.5, 0.75, 1]);

  // steps, in order, each with a duration
  assert.deepEqual(
    events.filter((e) => e.type === "step_started").map((e) => (e as { step_id: string }).step_id),
    ["parse", "echo", "assemble"],
  );
  assert.ok(events.filter((e) => e.type === "step_finished").every((e) => (e as { ms: number }).ms >= 0));

  // ---- the result message -------------------------------------------------
  const msg = resultHit.msg;
  assert.equal(msg.kind, "result");
  if (msg.kind !== "result") throw new Error("unreachable");
  assert.equal(msg.run_id, run_id);
  if (!msg.result.ok) assert.fail(`run failed: ${msg.result.error} (retryable: ${msg.result.retryable})`);
  assert.equal(msg.result.ok, true);
  assert.deepEqual(msg.result.output, { text, steps: 3 });
  assert.equal(msg.result.cost_units, 0);
  assert.equal(msg.result.llm_calls, 0);
  assert.equal(msg.result.tokens_in, 0);
  assert.equal(msg.result.tokens_out, 0);
  assert.ok(msg.result.ms >= 250, `run duration reported as ${msg.result.ms}ms`);

  // ---- headers + signature ------------------------------------------------
  const sig = resultHit.headers["x-run-signature"] as string | undefined;
  assert.equal(resultHit.headers["x-agent-id"], "echo");
  assert.equal(resultHit.headers["x-agent-token"], TOKEN);
  assert.match(sig ?? "", /^[0-9a-f]{64}$/);
  assert.equal(verifyCallbackSignature(TOKEN, run_id, "ok", sig), true);
  // tampering with the status, the run_id or the secret invalidates it
  assert.equal(verifyCallbackSignature(TOKEN, run_id, "error", sig), false);
  assert.equal(verifyCallbackSignature(TOKEN, "run_e2e_2", "ok", sig), false);
  assert.equal(verifyCallbackSignature("other-secret", run_id, "ok", sig), false);
  assert.equal(verifyCallbackSignature(TOKEN, run_id, "ok", undefined), false);

  // event messages are signed with status "event"
  const eventHit = brain.received.find((r) => r.msg.kind === "event");
  assert.ok(eventHit, "at least one event message");
  assert.equal(verifyCallbackSignature(TOKEN, run_id, "event", eventHit.headers["x-run-signature"] as string), true);
  assert.equal(verifyCallbackSignature(TOKEN, run_id, "ok", eventHit.headers["x-run-signature"] as string), false);
});

test("e2e: /run with the wrong token is 401 and never calls back", async (t) => {
  const { echo, brain, close } = await bothUp(50);
  t.after(close);

  const impostor = remoteAgent({ baseUrl: `http://127.0.0.1:${echo.port}`, token: "wrong-token", agentId: "echo" });

  await assert.rejects(
    () =>
      impostor.run({
        run_id: "run_e2e_401",
        tenant_id: "tenant_e2e",
        action: "echo",
        input: { text: "should never run" },
        context: {},
        callback_url: brain.url,
      }),
    (e: unknown) => {
      assert.ok(e instanceof RemoteAgentError);
      assert.equal(e.status, 401);
      assert.match(e.message, /unauthorized/);
      return true;
    },
  );

  // /health and /manifest need no token at all — only /run is protected
  assert.equal((await impostor.health()).ok, true);
  assert.equal((await impostor.manifest()).id, "echo");

  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(brain.received, [], "an unauthorised run must produce no callback");
});

test("e2e: a duplicate run_id is 409 and a bad body is 400", async (t) => {
  const { echo, brain, close } = await bothUp(50);
  t.after(close);

  const base = `http://127.0.0.1:${echo.port}`;
  const post = (body: unknown, token = TOKEN) =>
    fetch(`${base}/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-token": token },
      body: JSON.stringify(body),
    });

  const body = {
    run_id: "run_e2e_dup",
    tenant_id: "tenant_e2e",
    action: "echo",
    input: { text: "hello world" },
    context: {},
    callback_url: brain.url,
  };

  assert.equal((await post(body)).status, 202);
  const dup = await post(body);
  assert.equal(dup.status, 409);
  assert.deepEqual(await dup.json(), { error: "duplicate run_id", run_id: "run_e2e_dup" });

  const bad = await post({ ...body, run_id: "run_e2e_bad", input: "not-an-object", callback_url: "ftp://nope" });
  assert.equal(bad.status, 400);
  const badBody = (await bad.json()) as { error: string; details: string[] };
  assert.equal(badBody.error, "invalid run request");
  assert.deepEqual(badBody.details.sort(), ["callback_url must be an http(s) URL", "input must be an object"]);

  const unknown = await post({ ...body, run_id: "run_e2e_unknown", action: "shout" });
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { error: 'unknown action "shout"', actions: ["echo"] });

  const notFound = await fetch(`${base}/nope`);
  assert.equal(notFound.status, 404);

  await brain.waitForResult();
  const result = brain.result();
  assert.equal(result?.result.ok, true);
});
