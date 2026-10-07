/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/meeting.test.ts
 *
 *  Slot choice is parsed deterministically so a model can't book the wrong time — tested here. The
 *  Calendar calls and DB writes need the web hop + Postgres and are not unit-tested.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { matchSlotChoice, fmtSlot } = await import("./meeting.js");

test("matchSlotChoice: picks a slot by number or ordinal word (EN + Hinglish)", () => {
  assert.equal(matchSlotChoice("2", 3), 1);
  assert.equal(matchSlotChoice("option 3 please", 3), 2);
  assert.equal(matchSlotChoice("the first one works", 3), 0);
  assert.equal(matchSlotChoice("doosra theek hai", 3), 1);
  assert.equal(matchSlotChoice("3rd", 3), 2);
});

test("matchSlotChoice: a number beyond the offered count is not accepted", () => {
  assert.equal(matchSlotChoice("4", 3), null, "only 3 offered → '4' is not a valid pick");
});

test("matchSlotChoice: postpone / can't-make-it phrases → postpone", () => {
  assert.equal(matchSlotChoice("sorry I'm not available then", 3), "postpone");
  assert.equal(matchSlotChoice("can we do another time?", 3), "postpone");
  assert.equal(matchSlotChoice("abhi nahi, baad me", 3), "postpone");
  assert.equal(matchSlotChoice("let's reschedule", 3), "postpone");
});

test("matchSlotChoice: an unclear reply returns null (ask again, don't guess)", () => {
  assert.equal(matchSlotChoice("ok sounds good", 3), null);
  assert.equal(matchSlotChoice("what's the agenda?", 3), null);
});

test("fmtSlot: renders the slot in the tenant's local offset", () => {
  // 2026-10-08T11:00Z at +4 → 15:00 local = 3:00 PM
  const s = fmtSlot("2026-10-08T11:00:00.000Z", 4);
  assert.match(s, /3:00 PM/);
  assert.match(s, /8 Oct/);
});
