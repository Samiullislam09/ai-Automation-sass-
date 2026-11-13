/** Run: cd agent-server && npx tsx --test src/lib/keyPool.test.ts
 *
 *  The rate-limit lanes, on a fake clock. What matters: background work can never starve a customer
 *  reply, a full pool fails in bounded time instead of hanging, and the window really slides. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyPool, PoolSaturated, buildLanes, type PoolClock } from "./keyPool.js";

function fakeClock(): PoolClock & { t: number; advance(ms: number): void } {
  const c: any = {
    t: 0,
    now: () => c.t,
    // sleeping just moves the clock forward, so a "wait" completes instantly in the test
    sleep: async (ms: number) => { c.t += ms; },
    advance: (ms: number) => { c.t += ms; },
  };
  return c;
}

test("a key is handed out until its window is full, then the next key, then nothing", () => {
  const clock = fakeClock();
  const pool = new KeyPool(["a", "b"], 3, 60_000, clock);
  const got: string[] = [];
  for (let i = 0; i < 6; i++) got.push(pool.tryReserve(3)!);
  assert.equal(got.filter((k) => k === "a").length, 3);
  assert.equal(got.filter((k) => k === "b").length, 3);
  assert.equal(pool.tryReserve(3), null, "both keys full");
});

test("the window slides: a slot opens exactly when the oldest request ages out", () => {
  const clock = fakeClock();
  const pool = new KeyPool(["a"], 2, 60_000, clock);
  assert.ok(pool.tryReserve(2));
  clock.advance(10_000);
  assert.ok(pool.tryReserve(2));
  assert.equal(pool.tryReserve(2), null);
  clock.advance(49_999); // 59.999 s after the first
  assert.equal(pool.tryReserve(2), null);
  clock.advance(2); // first one is now 60.001 s old
  assert.ok(pool.tryReserve(2), "first request has aged out");
});

test("a reserve keeps the last slots of every key free for the reply lane", () => {
  const clock = fakeClock();
  const lanes = buildLanes({ bgKeys: ["k1", "k2"], waKeys: [], rpm: 10, reserve: 4, clock });
  assert.equal(lanes.dedicated, false);
  assert.equal(lanes.bg.limit, 6, "background may fill only 6 of 10 per key");
  assert.equal(lanes.wa.limit, 10);

  // Background hammers the pool until it is refused…
  let bg = 0;
  while (lanes.bg.pool.tryReserve(lanes.bg.limit)) bg++;
  assert.equal(bg, 12, "2 keys x 6");
  // …and a customer reply still gets through, 8 times over (2 keys x 4 reserved).
  let wa = 0;
  while (lanes.wa.pool.tryReserve(lanes.wa.limit)) wa++;
  assert.equal(wa, 8);
});

test("dedicated reply keys are a separate pool: nothing background does can touch them", () => {
  const clock = fakeClock();
  const lanes = buildLanes({ bgKeys: ["bg1"], waKeys: ["wa1"], rpm: 5, reserve: 4, clock });
  assert.equal(lanes.dedicated, true);
  assert.equal(lanes.reserve, 0, "no reserve needed — the lanes share nothing");
  assert.equal(lanes.bg.limit, 5);
  while (lanes.bg.pool.tryReserve(lanes.bg.limit)) { /* exhaust background */ }
  assert.equal(lanes.wa.pool.tryReserve(lanes.wa.limit), "wa1", "reply lane is untouched");
});

test("the reserve can never leave background work with no budget at all", () => {
  const lanes = buildLanes({ bgKeys: ["k"], waKeys: [], rpm: 5, reserve: 99 });
  assert.ok(lanes.bg.limit >= 1);
});

test("a saturated pool fails within the bounded wait instead of hanging", async () => {
  const clock = fakeClock();
  const pool = new KeyPool(["a"], 1, 60_000, clock);
  assert.ok(pool.tryReserve(1));
  await assert.rejects(() => pool.reserve(1, 20_000), (e: any) => e instanceof PoolSaturated && e.waitedMs >= 20_000);
});

test("reserve waits for a slot that is about to free, and then gets it", async () => {
  const clock = fakeClock();
  const pool = new KeyPool(["a"], 1, 60_000, clock);
  assert.ok(pool.tryReserve(1));
  const key = await pool.reserve(1, 120_000);
  assert.equal(key, "a");
  assert.ok(clock.t >= 60_000, "it waited out the window");
});

test("concurrent callers never take the same slot", async () => {
  const clock = fakeClock();
  const pool = new KeyPool(["a"], 3, 60_000, clock);
  const keys = await Promise.all([pool.reserve(3, 1000), pool.reserve(3, 1000), pool.reserve(3, 1000)]);
  assert.equal(keys.length, 3);
  assert.equal(pool.used(), 3);
  await assert.rejects(() => pool.reserve(3, 0), PoolSaturated);
});

test("an empty pool says so", async () => {
  const pool = new KeyPool([], 5);
  assert.equal(pool.tryReserve(5), null);
  await assert.rejects(() => pool.reserve(5, 100), /No API key/);
});
