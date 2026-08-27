import { test } from "node:test";
import assert from "node:assert/strict";
import { activeFastProviders, openFastChatStream, FAST_PROVIDERS } from "./fastChat.js";

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

const ALL_KEYS = Object.fromEntries(FAST_PROVIDERS.flatMap((p) => [[p.apiKeyEnv, undefined], [p.modelEnv, undefined]]));

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
    assert.equal(result!.model, "llama-3.3-70b-versatile");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /groq\.com/);
    assert.equal(calls[0].init.headers.Authorization, "Bearer gk_test");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.stream, true);
    assert.equal(body.model, "llama-3.3-70b-versatile");
  });
});

test("a model override env var is read, not the default", async () => {
  await withEnv({ ...ALL_KEYS, GROQ_API_KEY: "gk_test", GROQ_CHAT_MODEL: "llama-3.1-8b-instant" }, async () => {
    const fetchImpl = (async () => new Response(fakeStream() as any, { status: 200 })) as any;
    const result = await openFastChatStream([], { fetchImpl });
    assert.equal(result!.model, "llama-3.1-8b-instant");
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
