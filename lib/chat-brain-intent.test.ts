/** lib/chat-brain-intent.test.ts — the network half of the intent engine (extractIntent).
 *
 *  planFromToolCall/resolveWhen/resolveDelivery/echoLine are exercised thoroughly in
 *  chat-brain.test.ts against a stub. This file is the other half: extractIntent's OWN network
 *  call, which chat-brain.test.ts deliberately fakes out entirely (it stubs the whole function).
 *  What matters here is the 2026-08-28 change — a fast provider is tried FIRST, and NIM is the
 *  fallback, not the default — proven with injected fakes for both `fastCompletion` and
 *  `fetchImpl` so no real key or network call is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractIntent } from "./chat-brain-intent";
import type { BrainRegistry } from "./brain";

const TZ = "Asia/Karachi";
const NOW = new Date("2026-08-27T12:00:00.000Z");

const REGISTRY: BrainRegistry = {
  capabilities: "",
  problems: [],
  fetchedAt: Date.now(),
  stale: false,
  agents: [
    {
      id: "keyword",
      name: "Mr. Keyword",
      version: "1.0.0",
      description: "Finds keywords.",
      enabled: true,
      healthy: true,
      office: { room: "kw", ico: "🔑", color: "#fbbf24" },
      actions: [
        {
          id: "find_keywords",
          phrases: ["keywords do"],
          input: { topic: "string" },
          irreversible: false,
          estimated_seconds: 20,
          needs: [],
          provides: "keywords",
        },
      ],
    },
  ],
};

function toolCallResponse(name: string, args: Record<string, unknown>) {
  return { choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } } ] } }] };
}

test("the fast provider is tried FIRST — NIM's fetchImpl is never called when it answers", async () => {
  let nimCalls = 0;
  const nimFetch = (async () => {
    nimCalls++;
    throw new Error("must not be called — the fast path answered");
  }) as any;

  const fastCompletion = async (_body: any, _opts: any) => ({
    data: toolCallResponse("find_keywords", { topic: "solar panels" }),
    provider: "groq",
    model: "openai/gpt-oss-120b",
  });

  const plan = await extractIntent("keywords do solar panels", REGISTRY, {
    tz: TZ,
    now: NOW,
    fetchImpl: nimFetch,
    fastCompletion: fastCompletion as any,
  });

  assert.equal(plan.action, "find_keywords");
  assert.equal(plan.params.topic, "solar panels");
  assert.equal(nimCalls, 0, "NIM must never be reached once the fast provider answered");
});

test("no fast provider configured (null) falls straight through to NIM, unchanged", async () => {
  const calls: string[] = [];
  const nimFetch = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(toolCallResponse("find_keywords", { topic: "roofing" })), { status: 200 });
  }) as any;

  const fastCompletion = async () => null;

  const plan = await extractIntent("keywords do roofing", REGISTRY, {
    tz: TZ,
    now: NOW,
    apiKey: "nvapi-test",
    fetchImpl: nimFetch,
    fastCompletion: fastCompletion as any,
  });

  assert.equal(plan.action, "find_keywords");
  assert.equal(plan.params.topic, "roofing");
  assert.equal(calls.length, 1, "NIM was reached exactly once, as before this change");
});

test("a fast-provider answer with no tool call is a conversation, and NIM is never asked to double-check", async () => {
  let nimCalls = 0;
  const nimFetch = (async () => {
    nimCalls++;
    throw new Error("must not be called");
  }) as any;

  // The model answered in prose (no tool_calls) — this is the honest "it's a question" outcome,
  // not a failure to fall back from.
  const fastCompletion = async () => ({ data: { choices: [{ message: {} }] }, provider: "groq", model: "openai/gpt-oss-120b" });

  const plan = await extractIntent("kya haal hai", REGISTRY, {
    tz: TZ,
    now: NOW,
    fetchImpl: nimFetch,
    fastCompletion: fastCompletion as any,
  });

  assert.equal(plan.action, "answer_question");
  assert.equal(nimCalls, 0);
});

test("the fast provider erroring (thrown, not just null) still falls back to NIM instead of losing the message", async () => {
  const nimFetch = (async () =>
    new Response(JSON.stringify(toolCallResponse("find_keywords", { topic: "plumbing" })), { status: 200 })) as any;

  const fastCompletion = async () => {
    throw new Error("ECONNRESET");
  };

  const plan = await extractIntent("keywords do plumbing", REGISTRY, {
    tz: TZ,
    now: NOW,
    apiKey: "nvapi-test",
    fetchImpl: nimFetch,
    fastCompletion: fastCompletion as any,
  });

  assert.equal(plan.action, "find_keywords");
  assert.equal(plan.params.topic, "plumbing");
});

test("with no injected fastCompletion, the real openFastCompletion is inert (no key configured) and NIM answers as before", async () => {
  // Explicit env isolation, not just "the shell probably has nothing set" — a developer's own
  // .env.local (loaded by `next dev`, not by this test runner, but belt-and-suspenders) must
  // never make this test's outcome depend on which machine ran it.
  const keys = ["GROQ_API_KEY", "GROQ_API_KEY_2", "CEREBRAS_API_KEY", "CEREBRAS_API_KEY_2"];
  const prior: Record<string, string | undefined> = {};
  for (const k of keys) { prior[k] = process.env[k]; delete process.env[k]; }
  try {
    const calls: string[] = [];
    const nimFetch = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(toolCallResponse("find_keywords", { topic: "bakery" })), { status: 200 });
    }) as any;

    const plan = await extractIntent("keywords do bakery", REGISTRY, {
      tz: TZ,
      now: NOW,
      apiKey: "nvapi-test",
      fetchImpl: nimFetch,
      // no fastCompletion override — exercises the real lib/ai/fastChat.ts, which is a no-op
      // without GROQ_API_KEY/CEREBRAS_API_KEY set.
    });

    assert.equal(plan.action, "find_keywords");
    assert.equal(plan.params.topic, "bakery");
    assert.equal(calls.length, 1);
  } finally {
    for (const k of keys) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
  }
});
