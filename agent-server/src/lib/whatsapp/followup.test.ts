/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/followup.test.ts
 *
 *  The follow-up SCHEDULE decision is pure (when to nudge, when to give up) — tested here. The
 *  drafting and sending need a real model + socket and are not unit-tested.
 *
 *  Owner timing (2026-11-13): first message → 48 h of silence → follow-up 1 → 5 days → follow-up 2
 *  → 7 days → follow-up 3. Every gap runs from OUR LAST MESSAGE.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { pickFollowup, FOLLOWUP_GAP_HOURS } = await import("./followup.js");

test("the three nudges are due after 48 h, 5 days and 7 days of silence — not before", () => {
  assert.deepEqual(FOLLOWUP_GAP_HOURS, [48, 120, 168]);

  // done=0: follow-up 1 waits for 48h after the first message
  assert.equal(pickFollowup(0, 47).action, "none");
  assert.deepEqual(pickFollowup(0, 48), { action: "send", which: 1 });

  // done=1: follow-up 2 waits 5 days (120h) after follow-up 1
  assert.equal(pickFollowup(1, 119).action, "none");
  assert.deepEqual(pickFollowup(1, 120), { action: "send", which: 2 });

  // done=2: follow-up 3 waits 7 days (168h) after follow-up 2
  assert.equal(pickFollowup(2, 167).action, "none");
  assert.deepEqual(pickFollowup(2, 168), { action: "send", which: 3 });
});

test("after the last follow-up, a still-silent lead is eventually marked lost", () => {
  assert.equal(pickFollowup(3, 71).action, "none", "not lost immediately — a grace window");
  assert.equal(pickFollowup(3, 72).action, "lost");
});

test("a late tick still sends the EARLIEST due nudge, never skips ahead", () => {
  assert.deepEqual(pickFollowup(0, 500), { action: "send", which: 1 });
  assert.deepEqual(pickFollowup(1, 500), { action: "send", which: 2 });
});
