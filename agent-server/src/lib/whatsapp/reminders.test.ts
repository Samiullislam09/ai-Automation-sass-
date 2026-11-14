/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/reminders.test.ts
 *
 *  Meeting reminders: when each one is due, that each goes out exactly once however often the sweep runs, and
 *  what it says. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { dueReminders, leadReminderText, bossReminderText, fallbackSummary, summarizeLead, MIN, HOUR } = await import("./reminders.js");

const TZ = 4; // Dubai
// A call on Sunday 15 Nov 2026 at 15:00 Dubai time (11:00 UTC), booked on Friday evening.
const START = Date.UTC(2026, 10, 15, 11, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const meeting = (over: any = {}) => ({ status: "scheduled", start_at: iso(START), created_at: iso(START - 2 * 24 * HOUR), reminders: { booked_at: iso(START - 2 * 24 * HOUR) } as Record<string, string>, ...over });

test("24 h reminder: due inside the day-before window for a call booked well ahead, in daytime hours", () => {
  // 23 h before a 15:00 call = 16:00 the day before: daytime
  assert.deepEqual(dueReminders(meeting(), START - 23 * HOUR, TZ), ["lead_24h"]);
  // 24 h exactly is inside; 25 h before is not yet
  assert.deepEqual(dueReminders(meeting(), START - 24 * HOUR, TZ), ["lead_24h"]);
  assert.deepEqual(dueReminders(meeting(), START - 25 * HOUR, TZ), []);
});

test("24 h reminder: not for a call booked recently (it was just confirmed), not too close, not at night, not twice", () => {
  assert.deepEqual(dueReminders(meeting({ reminders: { booked_at: iso(START - 20 * HOUR) } }), START - 19 * HOUR, TZ), [], "booked 20 h before the call");
  assert.deepEqual(dueReminders(meeting(), START - 2.5 * HOUR, TZ), [], "under 3 h away: too late for a day-before note");
  // 04:00 Dubai time is 00:00 UTC: night
  const night = Date.UTC(2026, 10, 15, 0, 0, 0);
  assert.deepEqual(dueReminders(meeting({ start_at: iso(night + 20 * HOUR), reminders: { booked_at: iso(night - 3 * 24 * HOUR) } }), night, TZ), [], "04:00 local");
  assert.deepEqual(dueReminders(meeting({ reminders: { booked_at: iso(START - 2 * 24 * HOUR), lead_24h: iso(START - 23 * HOUR) } }), START - 22 * HOUR, TZ), [], "already sent");
});

test("1 h reminders: the customer and the owner, between 65 and 10 minutes before", () => {
  assert.deepEqual(dueReminders(meeting(), START - 60 * MIN, TZ).sort(), ["boss_1h", "lead_1h"]);
  assert.deepEqual(dueReminders(meeting(), START - 65 * MIN, TZ).sort(), ["boss_1h", "lead_1h"]);
  assert.deepEqual(dueReminders(meeting(), START - 70 * MIN, TZ), [], "too early");
  assert.deepEqual(dueReminders(meeting(), START - 9 * MIN, TZ), [], "too late: a reminder 9 minutes out is just a late message");
});

test("each reminder is independent: one sent does not block the other", () => {
  const r = { booked_at: iso(START - 2 * 24 * HOUR), lead_1h: iso(START - 59 * MIN) };
  assert.deepEqual(dueReminders(meeting({ reminders: r }), START - 58 * MIN, TZ), ["boss_1h"]);
  assert.deepEqual(dueReminders(meeting({ reminders: { ...r, boss_1h: iso(START - 58 * MIN) } }), START - 50 * MIN, TZ), []);
});

test("nothing for a meeting that is not scheduled, or has no time", () => {
  assert.deepEqual(dueReminders(meeting({ status: "cancelled" }), START - 60 * MIN, TZ), []);
  assert.deepEqual(dueReminders(meeting({ status: "offered" }), START - 60 * MIN, TZ), []);
  assert.deepEqual(dueReminders(meeting({ start_at: null }), START - 60 * MIN, TZ), []);
  assert.deepEqual(dueReminders(meeting({ start_at: "nonsense" }), START - 60 * MIN, TZ), []);
});

test("a call at 07:00 is still reminded at 06:00 (the 1 h reminder has a wider night rule than the 24 h one)", () => {
  const early = Date.UTC(2026, 10, 15, 3, 0, 0); // 07:00 Dubai
  const r = dueReminders(meeting({ start_at: iso(early), reminders: { booked_at: iso(early - 3 * 24 * HOUR) } }), early - 60 * MIN, TZ); // 06:00 local
  assert.ok(r.includes("lead_1h"));
});

test("EXACTLY ONCE: a sweep every 5 minutes across 26 hours sends each reminder one time", () => {
  const m = meeting();
  const sentAt: Record<string, number[]> = { lead_24h: [], lead_1h: [], boss_1h: [] };
  const reminders: Record<string, string> = { ...m.reminders };
  for (let now = START - 26 * HOUR; now <= START; now += 5 * MIN) {
    for (const kind of dueReminders({ ...m, reminders }, now, TZ)) {
      sentAt[kind].push(now);
      reminders[kind] = iso(now); // the stamp the sweep writes BEFORE sending
    }
  }
  assert.equal(sentAt.lead_24h.length, 1, "the day-before reminder goes once");
  assert.equal(sentAt.lead_1h.length, 1, "the 1 h reminder goes once");
  assert.equal(sentAt.boss_1h.length, 1, "the owner's briefing goes once");
  assert.ok(START - sentAt.lead_1h[0] <= 65 * MIN && START - sentAt.lead_1h[0] >= 10 * MIN);
  assert.ok(START - sentAt.lead_24h[0] <= 24 * HOUR && START - sentAt.lead_24h[0] >= 3 * HOUR);
});

test("a failed send takes its stamp back, so the next sweep retries inside the window", () => {
  const m = meeting();
  const reminders: Record<string, string> = { ...m.reminders };
  const t1 = START - 62 * MIN;
  assert.ok(dueReminders({ ...m, reminders }, t1, TZ).includes("lead_1h"));
  reminders.lead_1h = iso(t1);                                            // stamped…
  assert.ok(!dueReminders({ ...m, reminders }, t1 + 5 * MIN, TZ).includes("lead_1h"));
  delete reminders.lead_1h;                                               // …send failed, stamp removed
  assert.ok(dueReminders({ ...m, reminders }, t1 + 5 * MIN, TZ).includes("lead_1h"), "tried again");
  assert.ok(!dueReminders({ ...m, reminders }, START - 8 * MIN, TZ).includes("lead_1h"), "but never once the window has closed");
});

test("wording: the customer's reminders in their language, with the Meet link when there is one", () => {
  const when = "Sun 15 Nov, 3:00 PM";
  const en24 = leadReminderText("lead_24h", "en", when, "https://meet.google.com/abc");
  assert.match(en24, /our call is on Sun 15 Nov, 3:00 PM/);
  assert.match(en24, /Google Meet: https:\/\/meet\.google\.com\/abc/);
  assert.match(en24, /reply here/);
  assert.match(leadReminderText("lead_1h", "en", when, null), /starts in about an hour \(3:00 PM\)\./);
  assert.ok(!leadReminderText("lead_1h", "en", when, null).includes("Google Meet"));
  assert.match(leadReminderText("lead_1h", "hinglish", when, null), /ek ghante mein hai \(3:00 PM\)/);
  assert.match(leadReminderText("lead_24h", "hi", when, null), /[ऀ-ॿ]/);
  assert.doesNotMatch(leadReminderText("lead_24h", "hinglish", when, null), /[ऀ-ॿ]/);
});

test("wording: the owner's briefing names who, when, the link and what was said", () => {
  const t = bossReminderText("Acme Trading", "Sun 15 Nov, 3:00 PM", "https://meet.google.com/abc", "Wants ISO 9001 for tenders, 12 staff.\nAsked about price.");
  assert.match(t, /Call in about an hour with Acme Trading — 3:00 PM/);
  assert.match(t, /Meet: https:\/\/meet\.google\.com\/abc/);
  assert.match(t, /What to know:\nWants ISO 9001/);
  assert.ok(!bossReminderText("X", "Sun 15 Nov, 3:00 PM", null, "").includes("What to know"));
});

test("fallbackSummary: the customer's own last words, never a placeholder", () => {
  const thread = [
    { direction: "out" as const, body: "Hi from wca" },
    { direction: "in" as const, body: "I need ISO 9001 for tenders" },
    { direction: "in" as const, body: "[Voice message]" },
    { direction: "in" as const, body: "what is the price for 12 staff?" },
  ];
  const s = fallbackSummary(thread);
  assert.match(s, /I need ISO 9001 for tenders/);
  assert.match(s, /price for 12 staff/);
  assert.ok(!s.includes("Voice message"));
  assert.equal(fallbackSummary([{ direction: "out", body: "hello" }]), "No messages from them yet.");
});

test("summarizeLead: the model's summary when it works; the fallback when it fails or has nothing", async () => {
  const thread = [{ direction: "in" as const, body: "I need ISO 9001" }, { direction: "out" as const, body: "Sure" }, { direction: "in" as const, body: "12 staff, what price?" }];
  assert.equal(await summarizeLead(thread, async () => ({ summary: "Needs ISO 9001.\nAsked price for 12 staff." })), "Needs ISO 9001.\nAsked price for 12 staff.");
  assert.match(await summarizeLead(thread, async () => { throw new Error("down"); }), /They wrote:/);
  assert.match(await summarizeLead(thread, async () => ({ summary: "" })), /They wrote:/);
  assert.match(await summarizeLead(thread, async () => "junk"), /They wrote:/);
  // one message is not worth a model call
  let called = false;
  await summarizeLead([{ direction: "in", body: "hi" }], async () => { called = true; return {}; });
  assert.equal(called, false);
});
