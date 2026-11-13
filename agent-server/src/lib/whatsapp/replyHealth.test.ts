/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/replyHealth.test.ts
 *
 *  Phase 3 — measuring the AI instead of trusting it: reply time, repeats, holding lines. The numbers
 *  come from rows that already exist, so what is tested here is the arithmetic that must not lie. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { replySamples, speedStats, sentQuality, buildOverview, FAST_S } = await import("./activity.js");
const { DEFAULT_WHATSAPP_SETTINGS } = await import("../outreach/settings.js");
const { HOLDING } = await import("./conversation.js");

const T0 = Date.UTC(2026, 10, 13, 11, 45, 0);
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
type Row = { lead_id: string; direction: "in" | "out"; answered_by: string | null; created_at: string };
const IN = (lead: string, sec: number): Row => ({ lead_id: lead, direction: "in", answered_by: null, created_at: at(sec) });
const OUT = (lead: string, sec: number, by: string | null = "brain"): Row => ({ lead_id: lead, direction: "out", answered_by: by, created_at: at(sec) });
// buildOverview wants newest first
const newestFirst = (rows: Row[]) => [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

test("a reply is timed from the customer's message to ours", () => {
  const s = replySamples(newestFirst([IN("a", 0), OUT("a", 14)]));
  assert.equal(s.length, 1);
  assert.equal(s[0].seconds, 14);
  assert.equal(s[0].by, "brain");
});

test("a burst of messages is ONE wait, measured from the first of them", () => {
  const s = replySamples(newestFirst([IN("a", 0), IN("a", 6), IN("a", 11), OUT("a", 30)]));
  assert.equal(s.length, 1);
  assert.equal(s[0].seconds, 30, "the customer has been waiting since the first message");
});

test("the real client chat: replies of 4-5 minutes are measured as exactly that", () => {
  // 11:45 'Who are you?' answered 11:50; 11:51 answered 11:55; 11:56 answered 12:00 …
  const min = 60;
  const rows = [IN("c", 0), OUT("c", 5 * min), IN("c", 6 * min), OUT("c", 10 * min), IN("c", 11 * min), OUT("c", 15 * min)];
  const stats = speedStats(replySamples(newestFirst(rows)).map((x) => x.seconds));
  assert.equal(stats.samples, 3);
  assert.ok(stats.p50_s! >= 240);
  assert.equal(stats.health, "bad", "this is exactly what 'bad' has to mean");
  assert.equal(stats.fast_pct, 0);
});

test("an 'ok' the AI chose not to answer, followed by a nudge two days later, is NOT a two-day reply", () => {
  const rows = [IN("a", 0), OUT("a", 2 * 86_400)];
  assert.deepEqual(replySamples(newestFirst(rows)), []);
});

test("a human's reply is kept apart from the AI's", () => {
  const s = replySamples(newestFirst([IN("a", 0), OUT("a", 40, "human")]));
  assert.equal(s[0].by, "human");
});

test("leads are measured independently", () => {
  const s = replySamples(newestFirst([IN("a", 0), IN("b", 5), OUT("b", 20), OUT("a", 60)]));
  const a = s.find((x) => x.lead_id === "a")!, b = s.find((x) => x.lead_id === "b")!;
  assert.equal(a.seconds, 60);
  assert.equal(b.seconds, 15);
});

test("speedStats: percentiles, the fast share and the verdict", () => {
  const good = speedStats([10, 12, 14, 15, 18, 20, 22, 25, 28, 40]);
  assert.equal(good.samples, 10);
  assert.equal(good.p50_s, 18);
  assert.equal(good.p95_s, 40);
  assert.equal(good.fast_pct, 90);
  assert.equal(good.health, "good");
  assert.equal(speedStats([10, 20, 100]).health, "slow", "p95 100 s is slow, not bad");
  assert.equal(speedStats([10, 20, 400]).health, "bad");
  assert.equal(speedStats([20, 25]).health, "no_data", "two samples is an anecdote");
  assert.equal(speedStats([]).health, "no_data");
  assert.equal(speedStats([]).p50_s, null);
  assert.ok(FAST_S > 0);
});

test("repeats: the 'Sorry for the delay' loop is found; ordinary distinct replies are not", () => {
  const loop = [
    "Sorry for the delay — I'll send the ISO 9001 outline right away. Best email or WhatsApp number to share it?",
    "Sorry for the delay — I'll send the ISO 9001 outline now.",
    "Sorry for the delay — I was preparing the ISO 9001 outline. I'll send it now.",
    "Sorry for the delay. I'm here now — sending the ISO 9001 outline shortly.",
  ].map((body, i) => ({ lead_id: "c", body, created_at: at(i * 300) }));
  const q = sentQuality([...loop].reverse());
  assert.equal(q.loops.length, 1);
  assert.equal(q.loops[0].lead_id, "c");
  assert.equal(q.loops[0].repeats, 3);

  const fine = [
    "ISO 9001 certification usually takes 3-4 months. How many employees do you have?",
    "For 50 people it is typically AED 4,000-6,000 depending on scope. Shall I set up a short call?",
  ].map((body, i) => ({ lead_id: "d", body, created_at: at(i * 60) }));
  assert.deepEqual(sentQuality(fine).loops, []);
});

test("holding lines are counted separately and never counted as a repeat", () => {
  const sent = [
    { lead_id: "e", body: HOLDING.en, created_at: at(0) },
    { lead_id: "f", body: HOLDING.hinglish, created_at: at(10) },
    { lead_id: "e", body: HOLDING.en, created_at: at(900) },
  ];
  const q = sentQuality(sent);
  assert.equal(q.holding, 3);
  assert.deepEqual(q.loops, []);
});

test("the overview carries reply_speed and quality, and still builds with no messages at all", () => {
  const base = { nowMs: T0 + 3600_000, settings: { ...DEFAULT_WHATSAPP_SETTINGS }, connection: "connected", firstConnectedAtMs: null, dailyCount: 0, leads: {}, queue: [] };
  const empty = buildOverview({ ...base, messages: [] } as any);
  assert.equal(empty.reply_speed.day.health, "no_data");
  assert.deepEqual(empty.quality, { loops: [], holding: 0, needs_you: [] });

  // Each lead had an earlier exchange a few minutes before, so these are replies in a live chat.
  const live = (id: string, t: number, reply: number) => [IN(id, t - 600), OUT(id, t - 580), IN(id, t), OUT(id, t + reply)];
  const rows = newestFirst([...live("a", 0, 12), ...live("b", 100, 18), ...live("c", 200, 15)]);
  const o = buildOverview({
    ...base, messages: rows,
    leads: { a: { id: "a", company: "Acme", needs_attention: true, needs_attention_reason: "asked for the price — none is set" }, b: { id: "b" }, c: { id: "c" } },
    sent: [],
  } as any);
  assert.equal(o.reply_speed.day.samples, 3, "the three live replies");
  assert.equal(o.reply_speed.day.health, "good");
  assert.equal(o.reply_speed.first_reply.samples, 3, "and the three opening exchanges, reported apart");
  assert.deepEqual(o.quality.needs_you, [{ lead_id: "a", name: "Acme", reason: "asked for the price — none is set" }]);
});

test("a first message's deliberate 1-5 minute pause is NOT 'slow': it is measured apart from live replies", () => {
  // Three customers write for the first time and are answered after 90 s, 150 s, 240 s — exactly as designed.
  const rows = newestFirst([IN("a", 0), OUT("a", 90), IN("b", 10), OUT("b", 160), IN("c", 20), OUT("c", 260)]);
  const samples = replySamples(rows);
  assert.equal(samples.length, 3);
  assert.ok(samples.every((x) => x.opening), "all three are openings");
  const o = buildOverview({
    nowMs: T0 + 3600_000, settings: { ...DEFAULT_WHATSAPP_SETTINGS }, connection: "connected", firstConnectedAtMs: null, dailyCount: 0,
    messages: rows, leads: { a: { id: "a" }, b: { id: "b" }, c: { id: "c" } }, queue: [], sent: [],
  } as any);
  assert.equal(o.reply_speed.day.samples, 0, "no live replies yet → nothing to judge as slow");
  assert.equal(o.reply_speed.day.health, "no_data");
  assert.equal(o.reply_speed.first_reply.samples, 3);
  assert.equal(o.reply_speed.first_reply.p50_s, 150);
});

test("the same lead: the first answer is an opening, the follow-ups inside 5 hours are live", () => {
  const s = replySamples(newestFirst([IN("a", 0), OUT("a", 120), IN("a", 200), OUT("a", 214), IN("a", 300), OUT("a", 309)]));
  assert.deepEqual(s.map((x) => [x.opening, x.seconds]), [[true, 120], [false, 14], [false, 9]]);
});

test("after 5 quiet hours the next exchange is an opening again", () => {
  const s = replySamples(newestFirst([IN("a", 0), OUT("a", 100), IN("a", 100 + 6 * 3600), OUT("a", 100 + 6 * 3600 + 130)]));
  assert.deepEqual(s.map((x) => x.opening), [true, true]);
});

test("answering our opener or a nudge counts as an opening", () => {
  const s = replySamples(newestFirst([OUT("a", -50_000), IN("a", 0), OUT("a", 140)]));
  assert.equal(s[0].opening, true);
});

test("the Activity list says WHEN a first message will be answered", () => {
  const nowMs = T0 + 40_000; // 40 s after the customer's first message
  const rows = newestFirst([IN("a", 0)]);
  const o = buildOverview({
    nowMs, settings: { ...DEFAULT_WHATSAPP_SETTINGS, auto_reply: true }, connection: "connected", firstConnectedAtMs: T0 - 30 * 86400_000, dailyCount: 0,
    messages: rows, leads: { a: { id: "a", company: "Acme", stage: "contacted" } }, queue: [],
  } as any);
  const r = o.replies.find((x) => x.lead_id === "a")!;
  assert.equal(r.state, "queued");
  assert.match(r.reason, /first message.*natural pause/i);
  assert.ok(Date.parse(r.due_by!) >= nowMs, "due in the future");
  assert.ok(Date.parse(r.due_by!) - (T0) <= 300_000 + 1000, "within 5 minutes of the message");
});
