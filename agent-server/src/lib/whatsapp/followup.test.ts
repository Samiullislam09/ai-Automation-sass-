/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/followup.test.ts
 *
 *  The follow-up SCHEDULE decision is pure (when to nudge, when to give up) — tested here. The
 *  drafting and sending need a real model + socket and are not unit-tested.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { pickFollowup, FOLLOWUP_HOURS } = await import("./followup.js");

test("the three nudges fire at 24h, 90h, 160h — not before", () => {
  assert.deepEqual(FOLLOWUP_HOURS, [24, 90, 160]);

  // done=0: nudge 1 waits for 24h
  assert.equal(pickFollowup(0, 23).action, "none");
  assert.deepEqual(pickFollowup(0, 24), { action: "send", which: 1 });

  // done=1: nudge 2 waits for 90h (even though 24h long passed)
  assert.equal(pickFollowup(1, 89).action, "none");
  assert.deepEqual(pickFollowup(1, 90), { action: "send", which: 2 });

  // done=2: nudge 3 waits for 160h
  assert.equal(pickFollowup(2, 159).action, "none");
  assert.deepEqual(pickFollowup(2, 160), { action: "send", which: 3 });
});

test("after all three, a still-silent lead is eventually marked lost", () => {
  assert.equal(pickFollowup(3, 160).action, "none", "not lost immediately — a grace window");
  assert.equal(pickFollowup(3, 207).action, "none");
  assert.equal(pickFollowup(3, 208).action, "lost");
});

test("the schedule is anchored, not cumulative — a late check still fires the right nudge", () => {
  // Nobody ran the tick for a while: at 200h with 0 done, we still send nudge 1 (the earliest due),
  // never skip ahead to 3.
  assert.deepEqual(pickFollowup(0, 200), { action: "send", which: 1 });
});
