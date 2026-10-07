/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/outbound.test.ts
 *
 *  The outbound timeline's SCHEDULING maths and its DISPATCH gate are pure — tested here. The
 *  dispatcher's DB claim/send needs a real socket and Postgres and is not unit-tested.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { isQuietHours, nextAllowedTime, computeSlots, canDispatchTenant, localHour } = await import("./outbound.js");

// A UTC midnight; with tz_offset +4 that is 04:00 local.
const MIDNIGHT_UTC = Date.UTC(2026, 9, 7, 0, 0, 0);
const H = 3_600_000;

test("localHour applies the UTC offset and wraps", () => {
  assert.equal(localHour(MIDNIGHT_UTC, 4), 4);
  assert.equal(localHour(MIDNIGHT_UTC, -4), 20);
  assert.equal(localHour(MIDNIGHT_UTC + 22 * H, 4), 2, "22:00 UTC +4 = 02:00 next day");
});

test("isQuietHours: outside a 9-21 window is quiet, inside is not", () => {
  const at = (localH: number) => MIDNIGHT_UTC + (localH - 4) * H; // build a UTC ms that reads localH at +4
  assert.equal(isQuietHours(at(4), 4, 9, 21), true, "4am is quiet");
  assert.equal(isQuietHours(at(9), 4, 9, 21), false, "9am opens the window");
  assert.equal(isQuietHours(at(20), 4, 9, 21), false, "8pm still inside");
  assert.equal(isQuietHours(at(21), 4, 9, 21), true, "9pm closes the window");
  assert.equal(isQuietHours(at(23), 4, 9, 21), true, "11pm is quiet");
  assert.equal(isQuietHours(at(3), 4, 9, 9), false, "start===end means always allowed");
});

test("nextAllowedTime: a quiet-hours ms jumps to the window start, an allowed one is unchanged", () => {
  const at = (localH: number) => MIDNIGHT_UTC + (localH - 4) * H;
  const q = at(3); // 3am local, quiet
  const pushed = nextAllowedTime(q, 4, 9, 21);
  assert.equal(localHour(pushed, 4), 9, "pushed to 9am");
  assert.ok(pushed > q);
  const ok = at(14); // 2pm, allowed
  assert.equal(nextAllowedTime(ok, 4, 9, 21), ok, "allowed time returned unchanged");
});

test("computeSlots: count slots, strictly increasing, all inside the allowed window", () => {
  const start = MIDNIGHT_UTC + (10 - 4) * H; // 10am local
  const rng = () => 0.5; // deterministic mid gap
  const slots = computeSlots(7, start, 4 * 60_000, 14 * 60_000, 4, 9, 21, rng);
  assert.equal(slots.length, 7);
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i] > slots[i - 1], "slots increase");
  for (const s of slots) assert.equal(isQuietHours(s, 4, 9, 21), false, "every slot is inside the window");
});

test("computeSlots: slots that overflow the window roll to the next day's window, not into the night", () => {
  const start = MIDNIGHT_UTC + (20 - 4) * H + 50 * 60_000; // 20:50 local, near the 21:00 close
  const slots = computeSlots(5, start, 10 * 60_000, 15 * 60_000, 4, 9, 21, () => 0.9);
  for (const s of slots) assert.equal(isQuietHours(s, 4, 9, 21), false, "no slot lands at night");
});

test("canDispatchTenant: opens only when everything is clear", () => {
  const base = { autoReply: true, outboundEnabled: true, inQuietHours: false, hasActiveConversation: false, dailyCount: 0, cap: 50 };
  assert.equal(canDispatchTenant(base).ok, true);
  assert.equal(canDispatchTenant({ ...base, autoReply: false }).ok, false);
  assert.equal(canDispatchTenant({ ...base, outboundEnabled: false }).ok, false);
  assert.equal(canDispatchTenant({ ...base, inQuietHours: true }).ok, false);
  assert.equal(canDispatchTenant({ ...base, hasActiveConversation: true }).reason, "a conversation is active — timeline paused");
  assert.equal(canDispatchTenant({ ...base, dailyCount: 50 }).ok, false, "at cap → stop");
});
