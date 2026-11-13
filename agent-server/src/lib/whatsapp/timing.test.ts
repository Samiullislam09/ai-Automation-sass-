/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/timing.test.ts
 *
 *  When the assistant answers: a human pause on a first message (1–5 min), immediate for the 5 hours
 *  after we have replied. Every situation a real inbox produces. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { replyTiming, openingDelayS, activeDelayS, delayUntilReplyS, OPENING_MIN_S, OPENING_MAX_S, ACTIVE_MIN_S, ACTIVE_MAX_S, ACTIVE_WINDOW_MS } from "./timing.js";

const T0 = Date.UTC(2026, 10, 14, 10, 0, 0);
const MIN = 60_000, H = 3_600_000;
const at = (ms: number) => new Date(T0 + ms).toISOString();
const IN = (ms: number) => ({ direction: "in" as const, created_at: at(ms) });
const OUT = (ms: number) => ({ direction: "out" as const, created_at: at(ms) });

test("a brand-new contact's first message is an OPENING: due 1-5 minutes after it", () => {
  const t = replyTiming([IN(0)], "lead-a");
  assert.equal(t.mode, "opening");
  assert.equal(t.burstStartMs, T0);
  const waitS = (t.dueAtMs! - T0) / 1000;
  assert.ok(waitS >= OPENING_MIN_S && waitS <= OPENING_MAX_S, String(waitS));
});

test("messages sent during the pause are ONE wait: the clock does not restart", () => {
  const one = replyTiming([IN(0)], "lead-a");
  const three = replyTiming([IN(0), IN(20_000), IN(70_000)], "lead-a");
  assert.equal(three.mode, "opening");
  assert.equal(three.burstStartMs, T0);
  assert.equal(three.dueAtMs, one.dueAtMs, "same due time however many messages arrive");
});

test("every job that looks at the same burst computes the same due time (so jobs cannot race each other)", () => {
  const a = replyTiming([IN(0), IN(30_000)], "lead-x").dueAtMs;
  const b = replyTiming([IN(30_000), IN(0)], "lead-x").dueAtMs; // order of rows does not matter
  assert.equal(a, b);
  assert.notEqual(replyTiming([IN(0)], "lead-y").dueAtMs, replyTiming([IN(0)], "lead-x").dueAtMs, "different leads spread out");
});

test("opening delays spread over the whole 1-5 minute range across many customers", () => {
  const delays = Array.from({ length: 300 }, (_, i) => openingDelayS(`lead-${i}`, T0 + i * 1000));
  assert.ok(delays.every((d) => d >= OPENING_MIN_S && d <= OPENING_MAX_S));
  const under2 = delays.filter((d) => d < 120).length, over4 = delays.filter((d) => d > 240).length;
  assert.ok(under2 > 30 && over4 > 30, `spread: ${under2} under 2 min, ${over4} over 4 min`);
});

test("after we have replied, the next message is ACTIVE: no pause", () => {
  const t = replyTiming([IN(0), OUT(3 * MIN), IN(4 * MIN)], "lead-a");
  assert.equal(t.mode, "active");
  assert.equal(t.dueAtMs, null);
  // and keeps being active, message after message
  assert.equal(replyTiming([IN(0), OUT(3 * MIN), IN(4 * MIN), OUT(4 * MIN + 20_000), IN(5 * MIN)], "lead-a").mode, "active");
});

test("it stays active for 5 hours after our reply, then the next message is an opening again", () => {
  const base = [IN(0), OUT(3 * MIN)];
  assert.equal(replyTiming([...base, IN(3 * MIN + 4 * H)], "lead-a").mode, "active", "4 h later: still a live chat");
  assert.equal(replyTiming([...base, IN(3 * MIN + ACTIVE_WINDOW_MS - 1000)], "lead-a").mode, "active", "just inside 5 h");
  assert.equal(replyTiming([...base, IN(3 * MIN + ACTIVE_WINDOW_MS + 1000)], "lead-a").mode, "opening", "just past 5 h");
  assert.equal(replyTiming([...base, IN(3 * MIN + 2 * 24 * H)], "lead-a").mode, "opening", "two days later");
});

test("answering OUR opener is an opening (they are starting a conversation, not continuing one)", () => {
  assert.equal(replyTiming([OUT(-2 * 24 * H), IN(0)], "lead-a").mode, "opening");
  assert.equal(replyTiming([OUT(-10 * MIN), IN(0)], "lead-a").mode, "opening", "even 10 minutes after our opener");
});

test("answering one of our follow-up nudges is an opening too", () => {
  // opener, silence, nudge 1, silence, nudge 2 — then they finally answer
  assert.equal(replyTiming([OUT(0), OUT(48 * H), OUT(48 * H + 120 * H), IN(48 * H + 120 * H + 30 * MIN)], "lead-a").mode, "opening");
});

test("a person's reply from the dashboard keeps the chat active, like ours", () => {
  // direction only — who sent it does not matter
  assert.equal(replyTiming([IN(0), OUT(2 * MIN), IN(10 * MIN)], "lead-a").mode, "active");
});

test("nothing to answer when the last message is ours; empty and junk rows are safe", () => {
  assert.equal(replyTiming([IN(0), OUT(MIN)], "lead-a").mode, "none");
  assert.equal(replyTiming([], "lead-a").mode, "none");
  assert.equal(replyTiming([{ direction: "in", created_at: "not a date" }], "lead-a").mode, "none");
});

test("delayUntilReplyS: an opening waits out the REMAINING time; active is a few seconds", () => {
  const t = replyTiming([IN(0)], "lead-a");
  const full = delayUntilReplyS(t, T0);
  const later = delayUntilReplyS(t, T0 + 30_000);
  assert.ok(full >= OPENING_MIN_S && full <= OPENING_MAX_S);
  assert.equal(full - later, 30, "30 s into the pause, 30 s less to wait");
  assert.equal(delayUntilReplyS(t, T0 + 10 * MIN), 1, "already past due: run now, never negative");
  const a = replyTiming([IN(0), OUT(MIN), IN(2 * MIN)], "lead-a");
  for (const r of [0, 0.5, 0.999]) {
    const d = delayUntilReplyS(a, T0 + 2 * MIN, () => r);
    assert.ok(d >= ACTIVE_MIN_S && d <= ACTIVE_MAX_S, String(d));
  }
  assert.equal(activeDelayS(() => 0), ACTIVE_MIN_S);
  assert.equal(activeDelayS(() => 0.9999), ACTIVE_MAX_S);
});
