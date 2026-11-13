/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/phase2.test.ts
 *
 *  Phase 2 (a dedicated communication lane): the reply lane's configuration and the holding message.
 *  The behaviour of the lanes themselves is in lib/keyPool.test.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";
delete process.env.NVIDIA_API_KEYS_WA;
delete process.env.NVIDIA_RPM;
delete process.env.NVIDIA_WA_RESERVE;

const { waReplyConcurrency, WA_WORKER_POLLING } = await import("../../queues.js");
const { llmLanes } = await import("../nvidia.js");
const { HOLDING } = await import("./conversation.js");
const { EMPTY_PROMISE, SORRY_FOR_DELAY } = await import("./golden.js");
const { REPLY_TIMEOUT_MS } = await import("./decide.js");

test("reply workers: default 6, bounded 1..16, a typo cannot starve the other queues", () => {
  assert.equal(waReplyConcurrency(undefined), 6);
  assert.equal(waReplyConcurrency("10"), 10);
  assert.equal(waReplyConcurrency("0"), 6);
  assert.equal(waReplyConcurrency("-3"), 6);
  assert.equal(waReplyConcurrency("abc"), 6);
  assert.equal(waReplyConcurrency("500"), 16);
  assert.equal(waReplyConcurrency("1"), 1);
});

test("the reply queue wakes within seconds, not on the 300 s backstop", () => {
  assert.ok(WA_WORKER_POLLING.pollingIntervalSeconds <= 3);
  assert.ok(WA_WORKER_POLLING.notifyPollingIntervalSeconds <= 5);
  assert.ok(WA_WORKER_POLLING.notifyPollingIntervalSeconds >= WA_WORKER_POLLING.pollingIntervalSeconds, "pg-boss requires notify >= base");
});

test("with no dedicated reply keys, the lanes share and background work is held back", () => {
  assert.equal(llmLanes.dedicated, false);
  assert.equal(llmLanes.reserve, 8);
  assert.equal(llmLanes.wa.limit, 35, "a customer reply may use the whole window");
  assert.equal(llmLanes.bg.limit, 27, "background leaves 8 per key per minute free");
});

test("a reply's model call has a hard, short timeout", () => {
  assert.ok(REPLY_TIMEOUT_MS <= 15_000);
});

test("holding message: one honest line in every language, and not an empty promise or the stock apology", () => {
  for (const lang of ["en", "hinglish", "hi", "ur"] as const) {
    const t = HOLDING[lang];
    assert.ok(t.length > 20 && t.length < 160, lang);
    assert.ok(!EMPTY_PROMISE.test(t), `${lang}: no 'I'll send it now'`);
    assert.ok(!SORRY_FOR_DELAY.test(t), `${lang}: not the stock apology`);
  }
  // Each is genuinely in its language.
  assert.match(HOLDING.hi, /[ऀ-ॿ]/);
  assert.doesNotMatch(HOLDING.hinglish, /[ऀ-ॿ]/);
  assert.match(HOLDING.en, /team member/);
});

const { completeReplyJson } = await import("./decide.js");

test("reply model: one bad answer (garbage / empty) is retried once; a second falls through", async () => {
  let calls = 0;
  const flaky: any = async () => { calls++; if (calls === 1) throw new Error("NVIDIA NIM: model did not return valid JSON: вар"); return { action: "reply", reply: "ok" }; };
  assert.deepEqual(await completeReplyJson("u", "s", flaky), { action: "reply", reply: "ok" });
  assert.equal(calls, 2);

  let c2 = 0;
  const empty: any = async () => { c2++; throw new Error("NVIDIA NIM: unexpected response shape (no text)"); };
  await assert.rejects(() => completeReplyJson("u", "s", empty), /unexpected response shape/);
  assert.equal(c2, 2, "exactly one retry, never a loop");
});

test("reply model: a timeout or rate limit is NOT retried here (nvidiaFetch already did)", async () => {
  let calls = 0;
  const down: any = async () => { calls++; throw new Error("NVIDIA key pool (wa) has been at its rate limit for 8s"); };
  await assert.rejects(() => completeReplyJson("u", "s", down), /rate limit/);
  assert.equal(calls, 1);
});

test("reply model: uses the reply lane settings", async () => {
  let seen: any;
  const spy: any = async (_u: string, o: any) => { seen = o; return {}; };
  await completeReplyJson("u", "SYS", spy);
  assert.equal(seen.lane, "wa");
  assert.equal(seen.system, "SYS");
  assert.equal(seen.maxTokens, 700);
  assert.equal(seen.timeoutMs, 12_000);
});
