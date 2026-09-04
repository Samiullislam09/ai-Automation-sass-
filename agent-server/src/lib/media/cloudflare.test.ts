import test from "node:test";
import assert from "node:assert/strict";
import { CloudflarePool, parseAccounts, nextUtcMidnight, AllAccountsBusy } from "./cloudflare.js";

/** The pool the owner asked for in his own words (2026-09-05): "agar ek ka limit khatam to 2nd
 *  shuru, agar 2nd ka khatam to 3rd". Every test here drives a fake fetch, so the rotation is
 *  proved without spending a real neuron. */

const PIXEL = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** A Cloudflare-shaped reply. `kind` is what that account is pretending to be this call. */
function reply(kind: "ok" | "quota" | "rate" | "bad-prompt" | "server") {
  const ok = { success: true, errors: [], result: { image: PIXEL.toString("base64"), usage: { neurons: 172.8 } } };
  switch (kind) {
    case "ok":
      return new Response(JSON.stringify(ok), { status: 200 });
    case "quota":
      return new Response(JSON.stringify({ success: false, errors: [{ code: 4006, message: "You have exceeded your daily free neuron limit" }] }), { status: 429 });
    case "rate":
      return new Response(JSON.stringify({ success: false, errors: [{ code: 4004, message: "Too many requests" }] }), { status: 429 });
    case "bad-prompt":
      return new Response(JSON.stringify({ success: false, errors: [{ code: 3018, message: "prompt too long" }] }), { status: 400 });
    case "server":
      return new Response(JSON.stringify({ success: false, errors: [{ code: 1000, message: "internal" }] }), { status: 500 });
  }
}

/** Records which account id each call went to, and answers per a script. */
function fakeFetch(script: Record<string, ("ok" | "quota" | "rate" | "bad-prompt" | "server")[]>) {
  const calls: string[] = [];
  const impl = (async (url: any) => {
    const id = String(url).split("/accounts/")[1].split("/")[0];
    calls.push(id);
    const queue = script[id] ?? ["ok"];
    return reply(queue.length > 1 ? (queue.shift() as any) : queue[0]);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("accounts are parsed as id:token pairs, and the single-pair env is the first account", () => {
  const pool = parseAccounts("a1:tok1, a2:tok2");
  assert.deepEqual(pool, [{ id: "a1", token: "tok1" }, { id: "a2", token: "tok2" }]);

  const withSingle = parseAccounts("a2:tok2", "a1", "tok1");
  assert.deepEqual(withSingle.map((a) => a.id), ["a1", "a2"], "the single pair goes first");

  const dedup = parseAccounts("a1:tok1,a2:tok2", "a1", "tok1");
  assert.equal(dedup.length, 2, "the same account is not added twice");

  const typo = parseAccounts("a1:tok1, nonsense, a2:tok2");
  assert.equal(typo.length, 2, "one bad entry does not take the pool down");

  assert.deepEqual(parseAccounts("a1:tok:with:colons"), [{ id: "a1", token: "tok:with:colons" }], "only the first colon splits");
});

test("a spent account is skipped and the next one takes over — and it stays skipped until UTC midnight", async () => {
  const { impl, calls } = fakeFetch({ a1: ["quota"], a2: ["ok"] });
  const pool = new CloudflarePool([{ id: "a1", token: "t1" }, { id: "a2", token: "t2" }]);

  const first = await pool.image("a roof", 1, { fetchImpl: impl });
  assert.equal(first.account, 2, "account 2 produced it");
  assert.deepEqual(calls, ["a1", "a2"], "account 1 was tried once, then abandoned");
  assert.equal(first.neurons, 172.8);

  // Second image: account 1 is not even asked again.
  const second = await pool.image("a gutter", 2, { fetchImpl: impl });
  assert.equal(second.account, 2);
  assert.deepEqual(calls, ["a1", "a2", "a2"], "the spent account is not retried");

  const status = pool.status();
  assert.equal(status[0].resting, true);
  assert.equal(status[0].reason, "daily neuron quota spent");
  assert.equal(status[0].until, new Date(nextUtcMidnight()).toISOString(), "it comes back when Cloudflare resets, not before");
  assert.equal(status[1].images, 2);
});

test("three accounts: 1 spent, then 2 spent, then 3 answers — the owner's own sequence", async () => {
  const { impl, calls } = fakeFetch({ a1: ["quota"], a2: ["quota"], a3: ["ok"] });
  const pool = new CloudflarePool([
    { id: "a1", token: "t1" },
    { id: "a2", token: "t2" },
    { id: "a3", token: "t3" },
  ]);
  const r = await pool.image("a solar panel", 7, { fetchImpl: impl });
  assert.equal(r.account, 3);
  assert.deepEqual(calls, ["a1", "a2", "a3"]);
  assert.deepEqual(pool.status().map((s) => s.resting), [true, true, false]);
});

test("when every account is spent, that is a named failure the caller can fall back on", async () => {
  const { impl } = fakeFetch({ a1: ["quota"], a2: ["quota"] });
  const pool = new CloudflarePool([{ id: "a1", token: "t1" }, { id: "a2", token: "t2" }]);
  await assert.rejects(() => pool.image("x", 1, { fetchImpl: impl }), (e: any) => {
    assert.ok(e instanceof AllAccountsBusy);
    assert.match(e.message, /out of daily image quota/);
    return true;
  });
});

test("a rate limit rests an account for a minute, not for the day", async () => {
  const { impl } = fakeFetch({ a1: ["rate"], a2: ["ok"] });
  const pool = new CloudflarePool([{ id: "a1", token: "t1" }, { id: "a2", token: "t2" }]);
  const now = Date.now();
  await pool.image("x", 1, { fetchImpl: impl, now: () => now });
  const s = pool.status(now)[0];
  assert.equal(s.resting, true);
  assert.equal(s.reason, "rate limited");
  assert.ok(Date.parse(s.until!) - now <= 60_000, "back within a minute, not tomorrow");
});

test("a bad prompt is this request's fault and is not repeated across the pool", async () => {
  const { impl, calls } = fakeFetch({ a1: ["bad-prompt"], a2: ["ok"] });
  const pool = new CloudflarePool([{ id: "a1", token: "t1" }, { id: "a2", token: "t2" }]);
  await assert.rejects(() => pool.image("x".repeat(3000), 1, { fetchImpl: impl }), /Cloudflare 400/);
  assert.deepEqual(calls, ["a1"], "the second account was never asked to fail the same way");
  assert.equal(pool.status()[0].resting, false, "the account is fine — the prompt was not");
});

test("a network failure moves to the next account instead of failing the image", async () => {
  const calls: string[] = [];
  const impl = (async (url: any) => {
    const id = String(url).split("/accounts/")[1].split("/")[0];
    calls.push(id);
    if (id === "a1") throw new Error("ECONNRESET");
    return reply("ok");
  }) as unknown as typeof fetch;
  const pool = new CloudflarePool([{ id: "a1", token: "t1" }, { id: "a2", token: "t2" }]);
  const r = await pool.image("x", 1, { fetchImpl: impl });
  assert.equal(r.account, 2);
  assert.deepEqual(calls, ["a1", "a2"]);
});

test("no account configured is a clear sentence, not a crash", async () => {
  await assert.rejects(() => new CloudflarePool([]).image("x", 1), /no Cloudflare account is configured/);
});

test("the working account is kept, so a run does not re-walk the pool for every image", async () => {
  const { impl, calls } = fakeFetch({ a1: ["ok"], a2: ["ok"] });
  const pool = new CloudflarePool([{ id: "a1", token: "t1" }, { id: "a2", token: "t2" }]);
  await pool.image("a", 1, { fetchImpl: impl });
  await pool.image("b", 2, { fetchImpl: impl });
  await pool.image("c", 3, { fetchImpl: impl });
  assert.deepEqual(calls, ["a1", "a1", "a1"]);
  assert.equal(pool.status()[0].images, 3);
  assert.equal(Math.round(pool.status()[0].neurons), 518, "3 × 172.8 neurons, the real number from the response");
});
