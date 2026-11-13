/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/autoReply.test.ts
 *
 *  The auto-reply SAFETY GATE is pure (no DB, no clock), which is the whole point — these rules are
 *  what keep a linked WhatsApp number safe, so they are tested in isolation. The queue wiring and
 *  the actual send need a real socket and are not unit-tested here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { autoReplyGate, warmupCap, typingMs, reactiveCeiling } = await import("./autoReply.js");

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0); // a fixed noon

/** The happy path every other test varies from: an opted-in lead whose last message is theirs,
 *  under cap, number a week old. */
function base() {
  return {
    optOut: false,
    pausedUntilMs: null as number | null,
    nowMs: NOW,
    lastMessageDirection: "in" as "in" | "out" | null,
    dailyAutoSendCount: 0,
    firstConnectedAtMs: NOW - 10 * DAY,
  };
}

test("warmup ramp: a brand-new number is tightly capped, an aged one is not", () => {
  assert.equal(warmupCap(NOW, NOW), 20, "day 0");
  assert.equal(warmupCap(NOW - 1 * DAY, NOW), 35, "day 1");
  assert.equal(warmupCap(NOW - 3 * DAY, NOW), 70, "day 3");
  assert.equal(warmupCap(NOW - 5 * DAY, NOW), 120, "day 5");
  assert.equal(warmupCap(NOW - 30 * DAY, NOW), 250, "aged");
  assert.equal(warmupCap(null, NOW), 20, "unknown age is treated as brand new");
});

test("typingMs is clamped to a human 1.2s–5s", () => {
  assert.equal(typingMs("ok"), 1200, "short reply floors at 1.2s");
  assert.equal(typingMs("x".repeat(1000)), 5000, "long reply caps at 5s");
  assert.ok(typingMs("x".repeat(100)) > 1200 && typingMs("x".repeat(100)) < 5000, "mid scales");
});

test("gate: opens on the happy path", () => {
  assert.deepEqual(autoReplyGate(base()), { ok: true });
});

test("gate: opt-out is a hard stop", () => {
  const g = autoReplyGate({ ...base(), optOut: true });
  assert.equal(g.ok, false);
});

test("gate: a human handling the chat pauses auto-reply", () => {
  const g = autoReplyGate({ ...base(), pausedUntilMs: NOW + 60_000 });
  assert.equal(g.ok, false);
  // once the pause has passed, it opens again
  assert.equal(autoReplyGate({ ...base(), pausedUntilMs: NOW - 1 }).ok, true);
});

test("gate: never twice in a row — our own last message blocks a second", () => {
  assert.equal(autoReplyGate({ ...base(), lastMessageDirection: "out" }).ok, false);
  assert.equal(autoReplyGate({ ...base(), lastMessageDirection: null }).ok, false);
});

test("gate: replies have their own ceiling — the warm-up cap is for what WE start, not for answering people who wrote first", () => {
  const fresh = { ...base(), firstConnectedAtMs: NOW };
  // A new number's warm-up cap is 20, but replies are allowed up to max(150, 4 x cap) in 24 h.
  assert.equal(reactiveCeiling(NOW, NOW), 150);
  assert.equal(autoReplyGate({ ...fresh, dailyAutoSendCount: 20 }).ok, true, "past the warm-up cap: still answers");
  assert.equal(autoReplyGate({ ...fresh, dailyAutoSendCount: 149 }).ok, true);
  const hit = autoReplyGate({ ...fresh, dailyAutoSendCount: 150 });
  assert.equal(hit.ok, false);
  assert.match(hit.reason!, /ceiling/, "the reason names the ceiling so autoReply can alert the owner instead of staying silent");
  // an aged number: cap 250 -> ceiling 1000
  assert.equal(reactiveCeiling(NOW - 30 * DAY, NOW), 1000);
  assert.equal(autoReplyGate({ ...base(), dailyAutoSendCount: 999 }).ok, true);
  assert.equal(autoReplyGate({ ...base(), dailyAutoSendCount: 1000 }).ok, false);
});

const { makePingGate } = await import("./ownerPing.js");

test("owner pings: one WhatsApp per tenant per window, the next one says how many it stands for", () => {
  let t = 1_000_000;
  const g = makePingGate(180_000, () => t);
  assert.deepEqual(g.take("t1"), { send: true, held: 0 }, "the first goes out");
  for (let i = 1; i <= 5; i++) { t += 10_000; assert.equal(g.take("t1").send, false, `#${i} is held`); }
  t += 200_000; // window over
  assert.deepEqual(g.take("t1"), { send: true, held: 5 }, "the next one carries the count of the five it replaces");
  assert.equal(g.take("t1").send, false, "and the window restarts");
  // tenants do not ration each other
  assert.equal(g.take("t2").send, true);
});
