/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/activity.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { buildOverview } = await import("./activity.js");
const { DEFAULT_WHATSAPP_SETTINGS } = await import("../outreach/settings.js");

// 2026-11-11 12:00 UTC = 16:00 in Dubai (+4): inside the 9–21 window.
const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const MIN = 60_000, H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const base = (over: any = {}) => ({
  nowMs: NOW, settings: { ...DEFAULT_WHATSAPP_SETTINGS, auto_reply: true }, connection: "connected",
  firstConnectedAtMs: NOW - 30 * 86_400_000, dailyCount: 3, messages: [], leads: {}, queue: [], ...over,
});
const lead = (id: string, o: any = {}) => ({ id, company: `Co ${id}`, phone: "+9715000" + id, stage: "contacted", ...o });
const inbound = (id: string, agoMs: number) => ({ lead_id: id, direction: "in" as const, answered_by: null, created_at: iso(NOW - agoMs) });
const outbound = (id: string, agoMs: number, by = "brain") => ({ lead_id: id, direction: "out" as const, answered_by: by, created_at: iso(NOW - agoMs) });

test("overall state names the one reason the AI is or is not working", () => {
  assert.equal(buildOverview(base()).state.code, "running");
  assert.equal(buildOverview(base({ settings: { ...DEFAULT_WHATSAPP_SETTINGS, auto_reply: false } })).state.code, "auto_off");
  assert.equal(buildOverview(base({ connection: "disconnected" })).state.code, "not_connected");
  assert.equal(buildOverview(base({ connection: "reconnecting" })).state.code, "reconnecting");
  assert.equal(buildOverview(base({ firstConnectedAtMs: NOW, dailyCount: 20 })).state.code, "cap_reached"); // day-0 cap is 20
  const night = buildOverview(base({ nowMs: Date.UTC(2026, 10, 11, 20, 0, 0) })); // 00:00 Dubai
  assert.equal(night.state.code, "quiet_hours");
  assert.ok(night.state.resumes_at);
  const talking = buildOverview(base({ messages: [inbound("1", 10 * MIN)], leads: { "1": lead("1") } }));
  assert.equal(talking.state.code, "conversation_active");
});

test("a reply that just arrived is queued; one the human already took over is held, with the reason", () => {
  const o = buildOverview(base({
    messages: [inbound("1", 40_000), inbound("2", 30 * MIN)],
    leads: { "1": lead("1"), "2": lead("2", { auto_reply_paused_until: iso(NOW + 3 * H) }) },
  }));
  const r1 = o.replies.find((r) => r.lead_id === "1")!;
  const r2 = o.replies.find((r) => r.lead_id === "2")!;
  assert.equal(r1.state, "queued");
  assert.ok(r1.due_by && Date.parse(r1.due_by) > NOW);
  assert.equal(r2.state, "held");
  assert.match(r2.reason, /You replied yourself/);
  assert.equal(o.counts.replies_waiting, 1);
  assert.equal(o.counts.held, 1);
  assert.equal(o.replies[0].lead_id, "1", "queued first, then held");
  assert.deepEqual(o.next && { kind: o.next.kind, lead: o.next.lead }, { kind: "reply", lead: "Co 1" });
});

test("held reasons: opted out, auto replies off, daily limit", () => {
  const msgs = [inbound("1", 20 * MIN)];
  assert.match(buildOverview(base({ messages: msgs, leads: { "1": lead("1", { opt_out: true }) } })).replies[0].reason, /stop/i);
  assert.match(buildOverview(base({ messages: msgs, leads: { "1": lead("1") }, settings: { ...DEFAULT_WHATSAPP_SETTINGS, auto_reply: false } })).replies[0].reason, /OFF/);
  assert.match(buildOverview(base({ messages: msgs, leads: { "1": lead("1") }, firstConnectedAtMs: NOW, dailyCount: 20 })).replies[0].reason, /Daily limit/);
});

test("an old unanswered message the AI never replied to is 'reviewed', not silently ignored", () => {
  const o = buildOverview(base({ messages: [inbound("1", 2 * H)], leads: { "1": lead("1") } }));
  assert.equal(o.replies[0].state, "reviewed");
  assert.match(o.replies[0].reason, /sent nothing/);
  const flagged = buildOverview(base({ messages: [inbound("1", 2 * H)], leads: { "1": lead("1", { needs_attention: true, needs_attention_reason: "asked about price" }) } }));
  assert.equal(flagged.replies[0].reason, "asked about price");
});

test("first messages: queued in due order, skipped ones listed with their reason", () => {
  const o = buildOverview(base({
    leads: { a: lead("a"), b: lead("b"), c: lead("c") },
    queue: [
      { lead_id: "b", scheduled_at: iso(NOW + 20 * MIN), status: "pending", reason: null },
      { lead_id: "a", scheduled_at: iso(NOW + 5 * MIN), status: "pending", reason: null },
      { lead_id: "c", scheduled_at: iso(NOW - 2 * H), status: "skipped", reason: "not on WhatsApp", updated_at: iso(NOW - H) },
    ],
  }));
  assert.deepEqual(o.first_messages.map((f) => f.lead_id), ["a", "b"]);
  assert.equal(o.counts.first_messages_queued, 2);
  assert.deepEqual(o.skipped.map((s) => [s.lead_id, s.reason]), [["c", "not on WhatsApp"]]);
  assert.equal(o.next?.kind, "first_message");
  assert.equal(o.next?.lead, "Co a");
});

test("follow-ups: only for a lead we spoke to last, at 24h / 90h / 160h from the anchor", () => {
  const o = buildOverview(base({
    messages: [outbound("1", 30 * H), outbound("2", 2 * H), inbound("3", 5 * H)],
    leads: {
      "1": lead("1", { contacted_at: iso(NOW - 30 * H), auto_followups_done: 0 }),
      "2": lead("2", { contacted_at: iso(NOW - 2 * H), auto_followups_done: 0 }),
      "3": lead("3", { contacted_at: iso(NOW - 40 * H), replied_at: iso(NOW - 5 * H), auto_followups_done: 0 }),
    },
  }));
  const byId = Object.fromEntries(o.followups.map((f) => [f.lead_id, f]));
  assert.equal(Date.parse(byId["1"].due_at), NOW, "already overdue: due now");
  assert.equal(Date.parse(byId["2"].due_at), NOW - 2 * H + 24 * H);
  assert.equal(byId["3"], undefined, "their message is last: nothing to nudge");
  assert.equal(byId["1"].which, 1);
});

test("timeline: 24 hourly buckets, AI vs you vs received", () => {
  const now = NOW + 45 * MIN; // 12:45 UTC, so "10 minutes ago" is still inside the 12:00 hour
  const at = (ms: number) => iso(now - ms);
  const o = buildOverview(base({
    nowMs: now,
    messages: [
      { lead_id: "1", direction: "out", answered_by: "brain", created_at: at(10 * MIN) },
      { lead_id: "1", direction: "out", answered_by: "human", created_at: at(20 * MIN) },
      { lead_id: "1", direction: "in", answered_by: null, created_at: at(30 * MIN) },
      { lead_id: "1", direction: "out", answered_by: "brain", created_at: at(3 * H) },
      { lead_id: "1", direction: "out", answered_by: "brain", created_at: at(30 * H) },
    ],
    leads: { "1": lead("1") },
  }));
  assert.equal(o.timeline.length, 24);
  const last = o.timeline[23];
  assert.deepEqual([last.ai, last.you, last.received], [1, 1, 1]);
  assert.equal(o.timeline[20].ai, 1, "three hours back");
  assert.equal(o.timeline.reduce((n, b) => n + b.ai, 0), 2, "the 30h-old message is outside the window");
});

test("an empty workspace still answers, with no next step", () => {
  const o = buildOverview(base());
  assert.equal(o.next, null);
  assert.equal(o.replies.length, 0);
  assert.equal(o.timeline.length, 24);
});

test("a slot that fell due while the AI was held shows when the hold ends, never '26 days ago'", () => {
  const o = buildOverview(base({
    messages: [inbound("9", 20 * MIN)], // someone chatted 20 min ago: first messages wait until 60 min after that
    leads: { "9": lead("9"), a: lead("a") },
    queue: [{ lead_id: "a", scheduled_at: iso(NOW - 26 * 86_400_000), status: "pending", reason: null }],
  }));
  assert.equal(o.state.code, "conversation_active");
  assert.equal(o.state.sending, true);
  assert.equal(Date.parse(o.first_messages[0].at), NOW - 20 * MIN + 60 * MIN, "resumes an hour after their message");
  assert.equal(o.next?.kind, "first_message");
});

test("upcoming: the next 6 hours, and nothing promised while the AI is paused", () => {
  const q = [
    { lead_id: "a", scheduled_at: iso(NOW + 10 * MIN), status: "pending", reason: null },
    { lead_id: "b", scheduled_at: iso(NOW + 70 * MIN), status: "pending", reason: null },
  ];
  const running = buildOverview(base({ leads: { a: lead("a"), b: lead("b") }, queue: q }));
  assert.equal(running.upcoming.length, 6);
  assert.deepEqual(running.upcoming.map((u) => u.first), [1, 1, 0, 0, 0, 0]);
  const paused = buildOverview(base({ leads: { a: lead("a"), b: lead("b") }, queue: q, settings: { ...DEFAULT_WHATSAPP_SETTINGS, auto_reply: false } }));
  assert.equal(paused.state.sending, false);
  assert.deepEqual(paused.upcoming.map((u) => u.first), [0, 0, 0, 0, 0, 0]);
});

test("plan: the rules in force are reported so the page can say them in words", () => {
  const o = buildOverview(base());
  assert.deepEqual([o.plan.window_start, o.plan.window_end, o.plan.gap_min, o.plan.gap_max], [9, 21, 4, 14]);
  assert.equal(o.plan.number_age_days, 30);
});
