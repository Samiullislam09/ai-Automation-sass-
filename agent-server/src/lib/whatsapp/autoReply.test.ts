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

const { autoReplyGate, warmupCap, typingMs } = await import("./autoReply.js");

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

test("gate: daily cap respects the warmup for the number's age", () => {
  // brand-new number, cap 20: 19 sent → ok, 20 sent → blocked
  const fresh = { ...base(), firstConnectedAtMs: NOW };
  assert.equal(autoReplyGate({ ...fresh, dailyAutoSendCount: 19 }).ok, true);
  assert.equal(autoReplyGate({ ...fresh, dailyAutoSendCount: 20 }).ok, false);
  // aged number, cap 250: 20 is nowhere near
  assert.equal(autoReplyGate({ ...base(), dailyAutoSendCount: 20 }).ok, true);
});
