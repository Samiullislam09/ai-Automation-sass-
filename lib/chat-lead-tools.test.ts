/** The lead lookups and what the chat now knows about the product's biggest feature.
 *  Every case is a line from the real client chat of 2026-11-18 that the assistant got wrong. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shapeLeadStats, matchLeads, shapeLeadConversation, shapeRecentConversations, shapeKeywords, shapeAutopilot,
  LOOKUP_LEAD_CONVERSATION, LOOKUP_LEAD_STATS, LOOKUP_KEYWORDS, LOOKUP_AUTOPILOT, LEAD_TOOLS_RAW, FUNNEL,
} from "./chat-lead-tools";
import { READ_TOOLS, isReadTool, lookupOutreachShape } from "./chat-data-tools";
import { capabilitiesPrompt } from "./chat-tools";
import { PLATFORM_KNOWLEDGE } from "./platform-knowledge";
import { answerWhatWeCannotKnow, looksLikeMetricQuestion } from "./chat-no-data";

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
  const names = [LOOKUP_LEAD_CONVERSATION, LOOKUP_LEAD_STATS, LOOKUP_KEYWORDS, LOOKUP_AUTOPILOT];
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
  assert.equal(out.calls[0].status, "offered");
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

test("'is mein se whatsapp par kitne log hain' is a lead question, not a Google Analytics refusal", () => {
  const none = { ga4: false, gsc: false, social: [] } as any;
  for (const q of ["Is main se whatapp par kitne log ha", "kitne log ne reply diya", "leads mein kitne log hain", "how many leads have whatsapp"]) {
    assert.equal(answerWhatWeCannotKnow(q, none), null, q);
    assert.equal(looksLikeMetricQuestion(q), false, q);
  }
  // the real traffic question is still refused honestly
  assert.ok(answerWhatWeCannotKnow("site pe kitne log aaye", none));
});
