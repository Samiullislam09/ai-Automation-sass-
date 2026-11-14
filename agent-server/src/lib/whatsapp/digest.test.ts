/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/digest.test.ts
 *
 *  The owner's evening summary: when it is due, that it goes once a day, and that it says only what happened. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { localDate, localDayStartMs, digestDue, renderDigest, emptyDigest, hotWhy, dayLabel } = await import("./digest.js");

const HOUR = 3_600_000;
// Saturday 14 Nov 2026, 20:30 in Dubai (UTC+4) = 16:30 UTC
const EVENING = Date.UTC(2026, 10, 14, 16, 30, 0);
const base = { auto_reply: true, daily_summary: true, summary_hour: 20, summary_last_sent: "", tz_offset: 4 };

test("localDate and the start of the local day follow the tenant's timezone, not the server's", () => {
  assert.equal(localDate(EVENING, 4), "2026-11-14");
  // 23:30 UTC on the 14th is already 03:30 on the 15th in Dubai
  assert.equal(localDate(Date.UTC(2026, 10, 14, 23, 30), 4), "2026-11-15");
  assert.equal(localDate(Date.UTC(2026, 10, 14, 3, 0), -5), "2026-11-13", "and the day before in New York");
  assert.equal(new Date(localDayStartMs(EVENING, 4)).toISOString(), "2026-11-13T20:00:00.000Z", "local midnight Dubai = 20:00 UTC the day before");
  assert.equal(new Date(localDayStartMs(EVENING, -5)).toISOString(), "2026-11-14T05:00:00.000Z");
});

test("digestDue: at the chosen hour, once a day, only when enabled", () => {
  assert.equal(digestDue(base, EVENING), true, "20:30 with the hour set to 20");
  assert.equal(digestDue(base, EVENING - 2 * HOUR), false, "18:30 is too early");
  assert.equal(digestDue({ ...base, summary_hour: 21 }, EVENING), false, "the hour has not come");
  assert.equal(digestDue({ ...base, summary_last_sent: "2026-11-14" }, EVENING), false, "already sent today");
  assert.equal(digestDue({ ...base, summary_last_sent: "2026-11-13" }, EVENING), true, "yesterday's does not count");
  assert.equal(digestDue({ ...base, daily_summary: false }, EVENING), false);
  assert.equal(digestDue({ ...base, auto_reply: false }, EVENING), false, "auto-replies off pauses everything");
});

test("digestDue: a sweep that runs all evening sends it once when the last-sent date is written", () => {
  let lastSent = "";
  let sent = 0;
  for (let t = EVENING - 3 * HOUR; t <= EVENING + 3 * HOUR; t += 10 * 60_000) {
    if (digestDue({ ...base, summary_last_sent: lastSent }, t)) { sent++; lastSent = localDate(t, 4); }
  }
  assert.equal(sent, 1);
  // …and again the next evening
  for (let t = EVENING + 21 * HOUR; t <= EVENING + 27 * HOUR; t += 10 * 60_000) {
    if (digestDue({ ...base, summary_last_sent: lastSent }, t)) { sent++; lastSent = localDate(t, 4); }
  }
  assert.equal(sent, 2);
});

const FULL = {
  ...emptyDigest(),
  received: 42, customers: 17, aiReplies: 38, humanReplies: 4, firstMessagesSent: 12,
  liveSpeed: { samples: 20, p50_s: 9, fast_pct: 94 }, firstReplies: 6,
  hot: [{ name: "Acme Trading", why: "ready to buy" }, { name: "Gulf Traders", why: "asked for a call" }],
  meetingsBookedToday: 2, upcoming: [{ name: "Acme Trading", when: "Sun 15 Nov, 11:00 AM" }],
  needsYou: [{ name: "Beta LLC", reason: "asked for the price — none is published" }], optOuts: 1,
};

test("renderDigest: a full day, every section, readable on a phone", () => {
  const t = renderDigest(FULL, { brand: "wca-global.com", dayLabel: "Sat 14 Nov", dashboardUrl: "https://app.example.com/dashboard/whatsapp" })!;
  assert.match(t, /^📊 Daily summary — wca-global\.com · Sat 14 Nov/);
  assert.match(t, /42 messages received from 17 customers/);
  assert.match(t, /Replied: 38 by the assistant, 4 by you/);
  assert.match(t, /Reply speed: typically 9s, 94% within 30 s/);
  assert.match(t, /6 new conversations started/);
  assert.match(t, /12 new leads contacted today/);
  assert.match(t, /🔥 Hot today\n   • Acme Trading — ready to buy\n   • Gulf Traders — asked for a call/);
  assert.match(t, /2 calls booked today/);
  assert.match(t, /Next 24 h: Acme Trading — Sun 15 Nov, 11:00 AM/);
  assert.match(t, /🙋 Needs you \(1\)\n   • Beta LLC — asked for the price/);
  assert.match(t, /1 person asked to stop/);
  assert.match(t, /Open: https:\/\/app\.example\.com\/dashboard\/whatsapp$/);
  assert.ok(t.length < 1500, "short enough for one WhatsApp message");
});

test("renderDigest: a day with nothing in it sends nothing", () => {
  assert.equal(renderDigest(emptyDigest(), { brand: "x", dayLabel: "Sat 14 Nov" }), null);
});

test("renderDigest: only what happened — empty sections are left out, singulars are singular", () => {
  const t = renderDigest({ ...emptyDigest(), received: 1, customers: 1, aiReplies: 1 }, { brand: "x", dayLabel: "d" })!;
  assert.match(t, /1 message received from 1 customer\b/);
  assert.ok(!t.includes("Hot today") && !t.includes("Needs you") && !t.includes("Calls") && !t.includes("asked to stop") && !t.includes("Open:"));
  assert.ok(!t.includes("Reply speed"), "fewer than three live replies is not a speed");
  assert.ok(!t.includes("by you"), "no human replies, no 'by you'");
  // only an upcoming call is already worth a message
  const onlyCall = renderDigest({ ...emptyDigest(), upcoming: [{ name: "Zed", when: "Sun 15 Nov, 9:00 AM" }] }, { brand: "x", dayLabel: "d" })!;
  assert.match(onlyCall, /Next 24 h: Zed/);
});

test("renderDigest: long names and reasons are shortened, not allowed to blow the message up", () => {
  const long = "A".repeat(200);
  const t = renderDigest({ ...emptyDigest(), received: 1, customers: 1, needsYou: [{ name: long, reason: long }] }, { brand: "x", dayLabel: "d" })!;
  assert.ok(t.length < 400);
  assert.match(t, /…/);
});

test("hotWhy and dayLabel", () => {
  assert.equal(hotWhy("ready_to_buy"), "ready to buy");
  assert.equal(hotWhy("meeting_requested"), "asked for a call");
  assert.equal(hotWhy("some_new_stage"), "some new stage");
  assert.equal(dayLabel(EVENING, 4), "Sat 14 Nov");
  assert.equal(dayLabel(Date.UTC(2026, 10, 14, 23, 0), 4), "Sun 15 Nov", "the tenant's own date");
});
