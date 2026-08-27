import { test } from "node:test";
import assert from "node:assert/strict";
import { activeFastProviders, openFastChatStream, openFastCompletion, FAST_PROVIDERS } from "./fastChat.js";

/** §18.2 item 1's mechanism, proven without a real key: try each configured provider, in
 *  order, and fall through — to the next provider, or to null (NIM) — on anything but a
 *  clean stream. No network call is real here; every `fetchImpl` below is a fake. */

function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  return (async () => {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await run();
    } finally {
      for (const [k, v] of Object.entries(prior)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  })();
}

// Clears the numbered variants too (GROQ_API_KEY_2..5) — otherwise a real GROQ_API_KEY_2 left in
// the environment by a previous test run (or a developer's own .env) would silently change which
// test cases are actually exercising "no key configured".
const ALL_KEYS = Object.fromEntries(
  FAST_PROVIDERS.flatMap((p) => [
    [p.apiKeyEnv, undefined],
    ...[2, 3, 4, 5].map((n) => [`${p.apiKeyEnv}_${n}`, undefined]),
    [p.modelEnv, undefined],
  ])
);

function fakeStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.close(); } });
}

test("no provider configured means null — the caller falls back to NIM, unchanged", async () => {
  await withEnv(ALL_KEYS, async () => {
    assert.deepEqual(activeFastProviders(), []);
    const result = await openFastChatStream([{ role: "user", content: "hi" }], { fetchImpl: (async () => { throw new Error("must not be called"); }) as any });
    assert.equal(result, null);
  });
});

test("a configured provider is used, with its own model and key", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_test" }, async () => {
    assert.deepEqual(activeFastProviders(), ["groq"]);
    const calls: any[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(fakeStream() as any, { status: 200 });
    }) as any;

    const result = await openFastChatStream([{ role: "user", content: "hi" }], { fetchImpl });
    assert.ok(result);
    assert.equal(result!.provider, "groq");
    assert.equal(result!.model, "openai/gpt-oss-120b");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /groq\.com/);
    assert.equal(calls[0].init.headers.Authorization, "Bearer gk_test");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.stream, true);
    assert.equal(body.model, "openai/gpt-oss-120b");
    // The default model is gpt-oss, and gpt-oss without this returns empty content at low
    // max_tokens (verified live against Groq 2026-08-28) — see the file header.
    assert.equal(body.reasoning_effort, "low");
  });
});

test("a model override env var is read, not the default — and gets ITS OWN model's params", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_test", GROQ_CHAT_MODEL: "llama-3.1-8b-instant" }, async () => {
    const calls: any[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push(init);
      return new Response(fakeStream() as any, { status: 200 });
    }) as any;
    const result = await openFastChatStream([], { fetchImpl });
    assert.equal(result!.model, "llama-3.1-8b-instant");
    // A non-gpt-oss override must NOT carry gpt-oss's reasoning_effort — that field is meant
    // for one specific model family, not stamped onto whatever the override happens to be.
    assert.equal(JSON.parse(calls[0].body).reasoning_effort, undefined);
  });
});

test("the first provider refusing (rate limit, bad model) falls through to the second, not to a thrown error", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_test", CEREBRAS_API_KEY: "ck_test" }, async () => {
    assert.deepEqual(activeFastProviders(), ["groq", "cerebras"]);
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      if (/groq/.test(url)) return new Response("rate limited", { status: 429 });
      return new Response(fakeStream() as any, { status: 200 });
    }) as any;

    const result = await openFastChatStream([], { fetchImpl });
    assert.equal(result!.provider, "cerebras");
    assert.equal(seen.length, 2, "both were tried, in order");
  });
});

test("a second key on the SAME provider is tried before the next provider gets a turn", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_first", GROQ_API_KEY_2: "gk_second", CEREBRAS_API_KEY: "ck_test" }, async () => {
    assert.deepEqual(activeFastProviders(), ["groq", "cerebras"], "still one provider id, not two");
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      seen.push(init.headers.Authorization);
      if (init.headers.Authorization === "Bearer gk_first") return new Response("rate limited", { status: 429 });
      return new Response(fakeStream() as any, { status: 200 });
    }) as any;

    const result = await openFastChatStream([], { fetchImpl });
    assert.equal(result!.provider, "groq", "the second Groq key still counts as groq, not cerebras");
    assert.deepEqual(seen, ["Bearer gk_first", "Bearer gk_second"], "cerebras was never even called");
  });
});

test("both Groq keys exhausted still falls through to the next provider", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_first", GROQ_API_KEY_2: "gk_second", CEREBRAS_API_KEY: "ck_test" }, async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      seen.push(init.headers.Authorization);
      if (/groq\.com/.test(url)) return new Response("rate limited", { status: 429 });
      return new Response(fakeStream() as any, { status: 200 });
    }) as any;

    const result = await openFastChatStream([], { fetchImpl });
    assert.equal(result!.provider, "cerebras");
    assert.deepEqual(seen, ["Bearer gk_first", "Bearer gk_second", "Bearer ck_test"]);
  });
});

test("a network error on every configured provider is null, not a throw", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_test" }, async () => {
    const fetchImpl = (async () => { throw new Error("ENOTFOUND"); }) as any;
    const result = await openFastChatStream([], { fetchImpl });
    assert.equal(result, null);
  });
});

test("a 2xx with no body is treated as a refusal, not a stream with nothing in it", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_test" }, async () => {
    const fetchImpl = (async () => new Response(null, { status: 200 })) as any;
    const result = await openFastChatStream([], { fetchImpl });
    assert.equal(result, null);
  });
});

/** openFastCompletion — the non-streaming, tool-calling counterpart used by
 *  lib/chat-brain-intent.ts. Same provider/key fallback machinery as the stream above (proven
 *  there); these tests are about the parts unique to this function: stream:false, the raw JSON
 *  body returned intact, and reasoning_effort still attached for the gpt-oss default. */

test("openFastCompletion: no provider configured means null, no fetch attempted", async () => {
  await withEnv(ALL_KEYS, async () => {
    const result = await openFastCompletion(
      { messages: [] },
      { fetchImpl: (async () => { throw new Error("must not be called"); }) as any }
    );
    assert.equal(result, null);
  });
});

test("openFastCompletion: a configured provider gets stream:false and the caller's own body, plus reasoning_effort for gpt-oss", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_test" }, async () => {
    const calls: any[] = [];
    const fakeToolCallJson = { choices: [{ message: { tool_calls: [{ function: { name: "find_keywords", arguments: "{}" } }] } }] };
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(fakeToolCallJson), { status: 200 });
    }) as any;

    const result = await openFastCompletion(
      { temperature: 0, max_tokens: 300, tools: [{ type: "function" }], tool_choice: "auto", messages: [{ role: "user", content: "hi" }] },
      { fetchImpl }
    );

    assert.ok(result);
    assert.equal(result!.provider, "groq");
    assert.equal(result!.model, "openai/gpt-oss-120b");
    assert.deepEqual(result!.data, fakeToolCallJson, "the raw JSON body is returned intact, unparsed by this file");
    assert.match(calls[0].url, /groq\.com/);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.stream, false);
    assert.equal(body.temperature, 0);
    assert.equal(body.tool_choice, "auto");
    assert.equal(body.reasoning_effort, "low");
  });
});

test("openFastCompletion: a refusal falls through to the next provider, same as the stream", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_test", CEREBRAS_API_KEY: "ck_test" }, async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      if (/groq\.com/.test(url)) return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 });
    }) as any;

    const result = await openFastCompletion({ messages: [] }, { fetchImpl });
    assert.equal(result!.provider, "cerebras");
    assert.equal(seen.length, 2);
  });
});

test("openFastCompletion: a network error on every configured provider is null, not a throw", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_test" }, async () => {
    const fetchImpl = (async () => { throw new Error("ENOTFOUND"); }) as any;
    const result = await openFastCompletion({ messages: [] }, { fetchImpl });
    assert.equal(result, null);
  });
});
