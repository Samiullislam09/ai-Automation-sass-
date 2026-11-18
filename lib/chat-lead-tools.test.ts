/** The lead lookups and what the chat now knows about the product's biggest feature.
 *  Every case is a line from the real client chat of 2026-11-18 that the assistant got wrong. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shapeLeadStats, matchLeads, describeCall, windowEnd, editDistance, startOfLocalDay, windowStart, shapeOutreachActivity, shapeConnections, LOOKUP_OUTREACH_ACTIVITY, LOOKUP_CONNECTIONS, shapeLeadConversation, shapeRecentConversations, shapeKeywords, shapeAutopilot,
  LOOKUP_LEAD_CONVERSATION, LOOKUP_LEAD_STATS, LOOKUP_KEYWORDS, LOOKUP_AUTOPILOT, LOOKUP_DATA_SOURCES, LEAD_TOOLS_RAW, FUNNEL,
} from "./chat-lead-tools";
import { READ_TOOLS, isReadTool, lookupOutreachShape } from "./chat-data-tools";
import { capabilitiesPrompt } from "./chat-tools";
import { PLATFORM_KNOWLEDGE } from "./platform-knowledge";
import { shapeDataSources } from "./data-sources";

const LEADS = [
  { id: "1", company: "Sainiul Traders", name: "Sainiul", whatsapp: "+91 76024 68881", stage: "meeting_requested", wa_status: "yes", needs_attention: true },
  { id: "2", company: "Falcon Mechanical", whatsapp: "+971 50 123 4567", stage: "replied", wa_status: "yes" },
  { id: "3", company: "Falcon Aerospace", phone: "0504608157", stage: "contacted" },
  { id: "4", company: "No Number Ltd", stage: "approved" },
  { id: "5", company: "Gone Ltd", whatsapp: "+44 20 7946 0000", stage: "invalid", wa_status: "no" },
  { id: "6", company: "Stopped Co", phone: "+1 202 555 0100", stage: "opted_out", opt_out: true },
  { id: "7", company: "Booked Co", whatsapp: "+971 55 000 1111", stage: "meeting_scheduled", wa_status: "yes" },
];

test("the four lead tools exist, are lookups, and need no argument from the model", () => {
  const names = [LOOKUP_LEAD_CONVERSATION, LOOKUP_LEAD_STATS, LOOKUP_KEYWORDS, LOOKUP_AUTOPILOT, LOOKUP_DATA_SOURCES];
  for (const n of names) {
    assert.ok(READ_TOOLS.some((t) => t.function.name === n), `${n} is offered to the model`);
    assert.equal(isReadTool(n), true);
  }
  for (const t of LEAD_TOOLS_RAW) assert.deepEqual(t.function.parameters.required, []);
  // they carry the customer's own words, so Hinglish questions find them
  const blob = LEAD_TOOLS_RAW.map((t) => t.function.description).join(" ");
  for (const w of ["sainiul ki chat history", "kitne leads", "whatsapp hai", "konsa keyword", "autopilot kaisa"]) assert.ok(blob.includes(w), w);
});

test("'is mein se kitno ke paas WhatsApp hai': leads are counted by what is on file and by what WhatsApp confirmed, and never mixed up", () => {
  const s = shapeLeadStats(LEADS);
  assert.equal(s.total_leads, 7);
  assert.equal(s.with_a_phone_or_whatsapp_number, 6, "only 'No Number Ltd' has none");
  assert.equal(s.without_any_number, 1);
  assert.equal(s.confirmed_on_whatsapp, 3);
  assert.equal(s.confirmed_NOT_on_whatsapp, 1);
  assert.equal(s.not_checked_yet, 3);
  assert.equal(s.messaged, 4, "contacted, replied, meeting requested and meeting scheduled have all been messaged");
  assert.equal(s.replied, 3);
  assert.equal(s.asked_for_a_call, 1);
  assert.equal(s.call_booked, 1);
  assert.equal(s.need_you_now, 1);
  assert.equal(s.asked_not_to_be_contacted, 1);
  assert.equal(s.by_stage["asked for a call"], 1, "meeting stages are counted (they were missing from the old outreach lookup)");
  assert.equal(s.by_stage["call booked"], 1);
  assert.equal(Object.keys(s.by_stage).length, FUNNEL.length);
});

test("the old outreach lookup no longer loses leads that asked for a call", () => {
  const o: any = lookupOutreachShape(LEADS as any, [], "meeting");
  assert.equal(o.pipeline.meeting_requested, 1);
  assert.equal(o.pipeline.meeting_scheduled, 1);
  assert.equal(o.summary.messaged, 4);
  assert.equal(o.focused_list.length, 2, "focus 'meeting' lists the requested and the booked");
});

test("matchLeads: a phone tail, an exact name, a prefix — and a tie returns BOTH so the assistant asks instead of guessing", () => {
  assert.deepEqual(matchLeads(LEADS, "7602468881").map((l) => l.id), ["1"], "phone digits");
  assert.deepEqual(matchLeads(LEADS, "+91 76024 68881").map((l) => l.id), ["1"]);
  assert.deepEqual(matchLeads(LEADS, "sainiul").map((l) => l.id), ["1"], "matches the contact name");
  assert.deepEqual(matchLeads(LEADS, "Sainiul Traders").map((l) => l.id), ["1"], "exact company");
  assert.deepEqual(matchLeads(LEADS, "falcon").map((l) => l.id).sort(), ["2", "3"], "two Falcons: ambiguous");
  assert.deepEqual(matchLeads(LEADS, "falcon mech").map((l) => l.id), ["2"]);
  assert.deepEqual(matchLeads(LEADS, "nobody here"), []);
  assert.deepEqual(matchLeads(LEADS, ""), []);
});

test("one lead's conversation: oldest first, who said what, calls included — the shape the assistant summarises from", () => {
  const out: any = shapeLeadConversation(
    { ...LEADS[0], needs_attention_reason: "Wants a call — tonight", last_intent: "meeting" } as any,
    [
      { direction: "out", body: "Koi baat nahi — kaunsa din theek rahega?", created_at: "2026-11-14T11:27:00Z", answered_by: "brain" },
      { direction: "in", body: "Aj rat ko", created_at: "2026-11-14T11:28:00Z" },
      { direction: "out", body: "Hello, this is the owner", created_at: "2026-11-14T11:30:00Z", answered_by: "person" },
    ],
    [{ status: "offered", start_at: null, meet_link: null }],
  );
  assert.deepEqual(out.conversation.map((m: any) => m.from), ["the AI assistant", "the lead", "the owner"]);
  assert.equal(out.conversation[0].at, "2026-11-14T11:27:00Z");
  assert.equal(out.lead.needs_you, true);
  assert.equal(out.lead.needs_you_reason, "Wants a call — tonight");
  assert.match(out.calls[0].state, /has not chosen/);
  assert.match(out.note, /ONLY from `conversation`/);
  const recent: any = shapeRecentConversations([{ ...LEADS[1], last: { direction: "in", body: "ok thanks", created_at: "2026-11-14T10:00:00Z" } }] as any);
  assert.equal(recent.recent_conversations[0].last_message_from, "the lead");
});

test("keyword results are READ, not re-ordered: both the choice rows AND the research-only jobs, newest first, with measured numbers", () => {
  const k: any = shapeKeywords(
    [{
      topic: "iso 9001", recommended: "iso 9001 certification cost", status: "pending", created_at: "2026-11-14T20:43:00Z",
      candidates: [{ keyword: "iso 9001 certification cost", searchVolume: 1900, competitionLevel: "medium", source: "dataforseo", recommended: true }, { keyword: "iso 9001 checklist", searchVolume: null }],
    }],
    [{
      action: 'Keywords for "ISO 9001:2025 transition"', created_at: "2026-11-18T15:14:00Z",
      detail: { topic: "ISO 9001:2025 transition", researchOnly: true, chained: false, searchDataAvailable: true, recommended: "iso 9001 2025 transition guide", recommendedWhy: "Highest volume that fits the site",
        relatedKeywords: [{ keyword: "iso 9001 2025 transition guide", searchVolume: 720, competition: "low" }], fit: { dropped: [{ keyword: "gap analysis uae" }] } },
    }, { action: "x", created_at: "2026-11-18T15:00:00Z", detail: null }],
  );
  assert.equal(k.research_runs.length, 2, "a job with no detail is not a result");
  assert.equal(k.research_runs[0].recommended_keyword, "iso 9001 2025 transition guide", "newest first: the research-only job beats the older choice row");
  assert.equal(k.research_runs[0].kind, "research only (no article written)");
  assert.equal(k.research_runs[0].candidates[0].monthly_searches, 720);
  assert.deepEqual(k.research_runs[0].dropped_as_off_topic, ["gap analysis uae"]);
  assert.equal(k.research_runs[1].status, "waiting for the customer to choose");
  assert.equal(k.research_runs[1].candidates[1].monthly_searches, null, "a number that was not measured stays null");
  assert.match(shapeKeywords([], []).note, /No keyword research has been saved/);
});

test("autopilot: what is on, what is connected, and exactly what is MISSING for the chain to run end to end", () => {
  const stats = shapeLeadStats(LEADS);
  const unknown: any = shapeAutopilot({ stats });
  assert.ok(!unknown.missing_for_end_to_end.some((m: string) => /not linked|No team number|booking link/.test(m)), "an unreachable agent server is UNKNOWN, never reported as 'not linked'");
  assert.ok(unknown.could_not_read_right_now.length >= 2);
  assert.match(unknown.verdict, /could not check/);
  assert.equal(unknown.chain[1].on, null, "an unchecked step is null, not false");
  assert.equal(unknown.chain[3].on, null);
  const none: any = shapeAutopilot({ stats, whatsapp: { connected: false, autoReply: null }, settings: {}, teamNumbers: 0 });
  assert.equal(none.chain.length, 6);
  assert.ok(none.missing_for_end_to_end.length >= 4);
  assert.ok(none.missing_for_end_to_end.some((m: string) => /WhatsApp is not linked/.test(m)));
  assert.ok(none.missing_for_end_to_end.some((m: string) => /Google Calendar or add a booking link/.test(m)));
  assert.ok(none.missing_for_end_to_end.some((m: string) => /No team number/.test(m)));
  const full: any = shapeAutopilot({
    stats, leadSchedule: { enabled: true, frequency: "daily", time_of_day: "09:00", timezone: "Asia/Dubai", count: 10, last_run_at: "2026-11-17T05:00:00Z" },
    whatsapp: { connected: true, autoReply: true }, settings: { outbound_enabled: true, followups_enabled: true, send_start: 9, send_end: 21, meeting_reminders: true, daily_summary: true },
    teamNumbers: 2, googleCalendar: "connected",
  });
  assert.deepEqual(full.missing_for_end_to_end, []);
  assert.match(full.verdict, /Everything needed/);
  assert.ok(full.chain.every((c: any) => c.on));
  assert.equal(full.leads_now.waiting_for_first_message, 1);
  const off: any = shapeAutopilot({ stats, whatsapp: { connected: true, autoReply: false }, settings: { outbound_enabled: false }, teamNumbers: 1, googleCalendar: "connected", leadSchedule: { enabled: true } });
  assert.ok(off.missing_for_end_to_end.some((m: string) => /Auto-replies are switched OFF/.test(m)));
  assert.ok(off.missing_for_end_to_end.some((m: string) => /First messages .* switched off/.test(m)));
});

test("the root cause of 'I can't message your leads': the capabilities the model is told to answer FROM now include the WhatsApp lead chain", () => {
  const text = capabilitiesPrompt({ capabilities: "TEAM (1 kaam)\nCAN DO NOW\n  Mr. Lead — leads dhundo" } as any);
  assert.ok(text.includes(PLATFORM_KNOWLEDGE));
  assert.match(text, /TALKS TO THEM ON WHATSAPP/);
  assert.match(text, /Never say you cannot/);
  assert.match(text, /BOOKS CALLS/);
  assert.match(text, /Email outreach is planned, not live yet/, "no overclaiming: email is not built");
});

test("what we can measure is DATA the model reads (any language), not a keyword refusal that fires before it", () => {
  const none = shapeDataSources({ ga4: false, gsc: false, social: [] });
  assert.equal((none.website_visitors_traffic_sessions as any).available, false);
  assert.match((none.website_visitors_traffic_sessions as any).reason, /Google Analytics is not connected/);
  assert.equal((none.social_followers_likes_engagement_reach as any).available, false);
  assert.match((none.social_followers_likes_engagement_reach as any).reason, /Do NOT point them to the Connect page/);
  assert.equal((none.revenue_sales_conversions as any).available, false);
  assert.equal((none.lead_and_whatsapp_numbers as any).available, true, "'kitne log' about leads/WhatsApp IS countable — it is never refused as traffic");
  const live = shapeDataSources({ ga4: true, gsc: true, social: [] });
  assert.equal((live.website_visitors_traffic_sessions as any).available, true);
  assert.equal((live.search_clicks_impressions_rankings as any).available, true);
  assert.match(String(none.rule), /never estimate/);
  assert.ok(READ_TOOLS.some((t) => t.function.name === LOOKUP_DATA_SOURCES));
  const desc = READ_TOOLS.find((t) => t.function.name === LOOKUP_DATA_SOURCES)!.function.description;
  for (const w of ["kitne visitor", "cuántos seguidores", "how many people visited"]) assert.ok(desc.includes(w), w);
});

test("a typo still finds the lead: 'Sainul' for 'Sainiul' (the client typed it that way and was told nobody matched)", () => {
  assert.equal(editDistance("sainul", "sainiul"), 1);
  assert.equal(editDistance("abc", "abc"), 0);
  assert.deepEqual(matchLeads(LEADS, "sainul").map((l) => l.id), ["1"]);
  assert.deepEqual(matchLeads(LEADS, "Saynul traders").map((l) => l.id), ["1"], "company words are matched too");
  assert.deepEqual(matchLeads(LEADS, "falkon").map((l) => l.id).sort(), ["2", "3"], "two Falcons stay ambiguous: ask, never pick");
  assert.deepEqual(matchLeads(LEADS, "xq"), [], "too short to be a typo of anything");
  assert.deepEqual(matchLeads(LEADS, "zzzzzzzzzz"), [], "nothing close: no guess");
});

test("'today' is the customer's today, not UTC's", () => {
  const now = new Date("2026-11-18T20:00:00Z"); // 01:30 on 19 Nov in Calcutta, 00:00 on 19 Nov in Dubai... and still 18 Nov in UTC
  assert.equal(startOfLocalDay(now, "Asia/Calcutta").toISOString(), "2026-11-18T18:30:00.000Z");
  assert.equal(startOfLocalDay(now, "UTC").toISOString(), "2026-11-18T00:00:00.000Z");
  assert.equal(startOfLocalDay(now, "Not/AZone").toISOString(), "2026-11-18T00:00:00.000Z", "a bad zone falls back to UTC");
  assert.equal(windowStart("24h", now, "UTC")!.toISOString(), "2026-11-17T20:00:00.000Z");
  assert.equal(windowStart("7d", now, "UTC")!.toISOString(), "2026-11-11T20:00:00.000Z");
  assert.equal(windowStart("all", now, "UTC"), null);
});

test("outreach activity names who was messaged, which was a FIRST message, who replied, and what was said last", () => {
  const leads = [
    { id: "a", company: "Alpha Co", stage: "contacted", created_at: "2026-11-18T10:00:00Z" },
    { id: "b", company: "Beta Ltd", stage: "replied", created_at: "2026-11-10T10:00:00Z" },
    { id: "c", company: "Old Co", stage: "contacted", created_at: "2026-10-01T10:00:00Z" },
  ];
  const msgs = [
    { lead_id: "a", direction: "out", body: "Hello Alpha, we are WCA Global.", created_at: "2026-11-18T12:00:00Z", answered_by: null },
    { lead_id: "b", direction: "out", body: "Following up on ISO 9001.", created_at: "2026-11-18T13:00:00Z", answered_by: null },
    { lead_id: "b", direction: "in", body: "yes send price", created_at: "2026-11-18T13:30:00Z" },
    { lead_id: "b", direction: "out", body: "Essential starts from $2,400.", created_at: "2026-11-18T13:31:00Z", answered_by: "brain" },
    { lead_id: "c", direction: "out", body: "Too old to count today.", created_at: "2026-11-01T13:00:00Z", answered_by: null },
  ];
  const earliestOut = { a: "2026-11-18T12:00:00Z", b: "2026-11-12T09:00:00Z", c: "2026-11-01T13:00:00Z" };
  const r: any = shapeOutreachActivity({ window: "24h", since: new Date("2026-11-17T20:00:00Z"), msgs, leads, foundLeads: leads, earliestOut });
  assert.equal(r.counts.messages_sent, 3, "the old message is outside the window");
  assert.equal(r.counts.different_people_messaged, 2);
  assert.equal(r.counts.first_messages_to_new_people, 1, "only Alpha was messaged for the first time");
  assert.equal(r.counts.follow_ups_and_answers, 2);
  assert.equal(r.counts.replies_received_from_leads, 1);
  assert.equal(r.counts.leads_found, 1, "only Alpha was created in the window");
  assert.equal(r.most_recent_message_sent_in_this_window.lead, "Beta Ltd");
  assert.equal(r.most_recent_message_sent_in_this_window.by, "the AI");
  assert.deepEqual(r.people_messaged.map((p: any) => p.lead).sort(), ["Alpha Co", "Beta Ltd"]);
  assert.deepEqual(r.first_messages.map((x: any) => x.lead), ["Alpha Co"]);
  assert.equal(r.replies[0].said, "yes send price");
  assert.deepEqual(shapeOutreachActivity({ window: "today", since: new Date("2026-11-19T00:00:00Z"), msgs, leads, foundLeads: leads, earliestOut }).most_recent_message_sent_in_this_window, null, "nothing in the window = null, never a guess");
});

test("connections: what is linked, what is not, and 'could not check' for what could not be read", () => {
  const none: any = shapeConnections({ integrations: [], whatsapp: null, google: "not_connected", bookingLink: null, teamNumbers: null });
  assert.equal(none.whatsapp, "could not be checked just now");
  assert.equal(none.google_account, "not connected");
  const full: any = shapeConnections({
    integrations: [{ type: "wordpress", status: "connected", label: "https://wca-global.com" }, { type: "google", status: "connected" }, { type: "linkedin", status: "disconnected" }],
    whatsapp: { connected: true, phone: "971500000000" }, google: "connected", googleSources: { ga4: false, gsc: true }, bookingLink: false, teamNumbers: 1,
  });
  assert.match(full.whatsapp, /linked \(\+971500000000\)/);
  assert.deepEqual(full.websites_and_other_connections, [{ type: "wordpress", name: "https://wca-global.com" }], "google has its own line; a disconnected one is not listed");
  assert.deepEqual(full.google_analytics_and_search_console, { analytics_data_flowing: false, search_console_data_flowing: true });
  assert.ok(READ_TOOLS.some((x) => x.function.name === LOOKUP_OUTREACH_ACTIVITY) && READ_TOOLS.some((x) => x.function.name === LOOKUP_CONNECTIONS));
  const d = READ_TOOLS.find((x) => x.function.name === LOOKUP_OUTREACH_ACTIVITY)!.function.description;
  for (const w of ["last whatsapp pe kisko msg kiya", "un 15 ka list do", "aaj kitne leads find kiye", "latest message sent"]) assert.ok(d.includes(w), w);
});

test("'last message' never comes back empty because the window was quiet: the latest message ever sent rides along", () => {
  const leads = [{ id: "a", company: "Alpha Co", stage: "contacted" }];
  const old = { lead_id: "a", direction: "out", body: "Hello Alpha, this was two days ago.", created_at: "2026-11-16T12:00:00Z", answered_by: "brain" };
  const r: any = shapeOutreachActivity({ window: "today", since: new Date("2026-11-18T18:30:00Z"), msgs: [], leads, foundLeads: leads, earliestOut: { a: "2026-11-16T12:00:00Z" }, lastEver: old });
  assert.equal(r.counts.messages_sent, 0, "nothing today");
  assert.equal(r.most_recent_message_sent_in_this_window, null);
  assert.equal(r.most_recent_message_sent_ever.lead, "Alpha Co");
  assert.equal(r.most_recent_message_sent_ever.at, "2026-11-16T12:00:00Z");
  assert.match(r.most_recent_message_sent_ever.text, /two days ago/);
  // yesterday is a closed window: it has an end
  const now = new Date("2026-11-18T20:00:00Z");
  assert.equal(windowStart("yesterday", now, "UTC")!.toISOString(), "2026-11-17T00:00:00.000Z");
  assert.equal(windowEnd("yesterday", now, "UTC")!.toISOString(), "2026-11-18T00:00:00.000Z");
  assert.equal(windowEnd("today", now, "UTC"), null);
  const y: any = shapeOutreachActivity({ window: "yesterday", since: windowStart("yesterday", now, "UTC"), until: windowEnd("yesterday", now, "UTC"), msgs: [
    { lead_id: "a", direction: "out", body: "yesterday msg", created_at: "2026-11-17T10:00:00Z" },
    { lead_id: "a", direction: "out", body: "today msg", created_at: "2026-11-18T10:00:00Z" },
  ], leads, foundLeads: leads, earliestOut: {} });
  assert.equal(y.counts.messages_sent, 1, "today's message is outside 'yesterday'");
});

test("a call is described by what the system KNOWS: 'done' means the time passed, never that it took place — the Sainiul case", () => {
  const passed: any = describeCall({ status: "done", outcome: "unconfirmed", start_at: "2026-11-16T15:00:00Z", meet_link: "https://meet.google.com/x" });
  assert.match(passed.state, /time has passed \(not confirmed whether it took place\)/);
  assert.match(passed.attendance, /NOT KNOWN/);
  assert.equal(describeCall({ status: "done", start_at: null }).attendance.includes("NOT KNOWN"), true, "an old row with no outcome is also unknown");
  assert.match(describeCall({ status: "done", outcome: "attended" }).attendance, /confirmed they joined/);
  assert.match(describeCall({ status: "no_show", outcome: "no_show" }).attendance, /did NOT join/);
  assert.match(describeCall({ status: "scheduled" }).state, /time has not passed/);
  assert.match(describeCall({ status: "offered" }).state, /has not chosen/);
  const conv: any = shapeLeadConversation({ id: "1", company: "Sainiul", stage: "meeting_done" } as any, [], [{ status: "done", outcome: "unconfirmed", start_at: "2026-11-16T15:00:00Z" }]);
  assert.match(conv.note, /never say it happened or did not happen/);
  assert.equal(conv.calls[0].has_meet_link, false);
});
