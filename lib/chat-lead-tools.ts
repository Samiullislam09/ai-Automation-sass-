/** lib/chat-lead-tools.ts — the lookups that make the chat know the product's biggest feature: finding leads and talking to them.
 *
 *  WHY THIS FILE EXISTS (audit of a real client chat, 2026-11-18). The chat was asked, in turn:
 *      "can you communicate with our leads?"   -> "I can't message your leads"   (it can: WhatsApp is the core feature)
 *      "kitne leads ke paas WhatsApp hai?"      -> a Google Analytics refusal     (no tool counted them)
 *      "jo keyword nikala wo chat pe do"        -> started ANOTHER keyword job    (no tool showed the result)
 *      "sainiul ki chat history do"             -> impossible                      (no tool read one lead's conversation)
 *  and could not say whether the lead-to-meeting chain was running at all. The cause was never the model: it was handed no
 *  tool that could see any of this, so it guessed from the little it knew.
 *
 *  Four read tools (nothing here writes or sends): one lead's conversation, the lead numbers, the keyword research results, and the state of
 *  the whole lead -> message -> reply -> meeting -> reminder chain ("autopilot"). Each has a PURE shape function that is unit-tested; the
 *  I/O wrappers only fetch. The model keeps the language; the numbers and the words customers wrote arrive as tool results it did not write. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatTool } from "@/lib/chat-tools";
import { callWhatsapp } from "@/lib/whatsapp-proxy";
import { loadGoogle, SCOPE_CALENDAR } from "@/lib/google";

export const LOOKUP_LEAD_CONVERSATION = "lookup_lead_conversation";
export const LOOKUP_LEAD_STATS = "lookup_lead_stats";
export const LOOKUP_KEYWORDS = "lookup_keywords";
export const LOOKUP_AUTOPILOT = "lookup_autopilot";

type ReadResult = { ok: boolean; tool: string; data?: unknown; note?: string };

/** Every stage a lead can be in (supabase/migrations/036). The funnel order is the order a lead moves through. */
export const FUNNEL: { stage: string; label: string }[] = [
  { stage: "new", label: "found" },
  { stage: "pending_approval", label: "waiting for your approval" },
  { stage: "approved", label: "approved, first message due" },
  { stage: "queued", label: "queued to send" },
  { stage: "contacted", label: "first message sent" },
  { stage: "delivered", label: "delivered" },
  { stage: "read", label: "read" },
  { stage: "replied", label: "replied" },
  { stage: "in_conversation", label: "in conversation" },
  { stage: "interested", label: "interested" },
  { stage: "meeting_requested", label: "asked for a call" },
  { stage: "meeting_scheduled", label: "call booked" },
  { stage: "meeting_done", label: "call done" },
  { stage: "ready_to_buy", label: "ready to buy" },
  { stage: "won", label: "became a client" },
  { stage: "lost", label: "lost" },
  { stage: "rejected", label: "rejected by you" },
  { stage: "opted_out", label: "asked not to be contacted" },
  { stage: "invalid", label: "number not on WhatsApp / invalid" },
  { stage: "failed", label: "failed" },
];

/** From "contacted" onward a lead has been messaged at least once. */
export const MESSAGED_STAGES = ["contacted", "delivered", "read", "replied", "in_conversation", "interested", "meeting_requested", "meeting_scheduled", "meeting_done", "ready_to_buy", "won", "lost"];
/** Stages that only a reply can lead to. "won" is left out on purpose: a lead can be marked won by hand without ever writing; a real reply is also caught by `replied_at`. */
export const REPLIED_STAGES = ["replied", "in_conversation", "interested", "meeting_requested", "meeting_scheduled", "meeting_done", "ready_to_buy"];

const digits = (s: unknown) => String(s ?? "").replace(/[^\d]/g, "");
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/* ── tool definitions ───────────────────────────────────────────────────────────────────── */

export const LEAD_TOOLS_RAW: ChatTool[] = [
  {
    type: "function",
    function: {
      name: LOOKUP_LEAD_CONVERSATION,
      description:
        "Read ONE lead's WhatsApp conversation with us: who they are, their stage, what they and the assistant wrote (newest messages), whether a call " +
        "was requested or booked, and whether they need the owner. Pass `who` = the name, company or phone number the customer mentioned. " +
        'Call this for "sainiul ki chat history do", "is lead se kya baat hui", "summary do Falcon ki chat ka", "kya bola usne", ' +
        '"what did Acme say", "show me the conversation with +91…", "us lead ka status kya hai". Then SUMMARISE it in the customer\'s language, using only ' +
        "what the messages say. With no `who` it lists the most recent conversations so the customer can pick one. If several leads match, it returns " +
        "the candidates: ask which one — never guess.",
      parameters: {
        type: "object",
        properties: { who: { type: "string", description: "Name, company or phone number as the customer said it. Omit to list recent conversations." } },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_LEAD_STATS,
      description:
        "Count the customer's leads: the total, how many have a WhatsApp number, how many are confirmed on WhatsApp or NOT on WhatsApp, how many were " +
        "messaged, replied, asked for a call, booked a call, became clients, asked to stop, and how many are at each stage. " +
        'Call this for "kitne leads hain", "inme se kitno ke paas whatsapp hai", "kitno ko message gaya", "kitne reply aaye", "kitne call book hue", ' +
        '"how many leads have WhatsApp", "leads ka breakdown do", "pipeline kaisi hai". Always call it instead of guessing a number about leads.',
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_KEYWORDS,
      description:
        "Read the keyword research the team has ALREADY DONE: the topics researched, the keyword it recommended, and the candidate keywords with " +
        "search volume and competition. This only reads saved results; it starts nothing. " +
        'Call this when they want to SEE or ask about results: "konsa keyword mila", "jo keyword nikala wo chat pe do", "keyword research ka result dikhao", ' +
        '"show me the keywords you found", "best keyword kya hai", "pehle wale keywords kya the". ' +
        'Do NOT call it when they ask for NEW research ("naya keyword research karo", "find keywords for X") — that is work and the keyword ACTION must run.',
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_AUTOPILOT,
      description:
        "The state of the whole lead chain — finding leads, approving, the first WhatsApp message, follow-ups, replies, booking calls, reminders, the daily " +
        "summary — as it is RIGHT NOW: which parts are switched on, what is connected (WhatsApp, Google Calendar, a booking link, team numbers), how many leads " +
        "sit at each step, and what is missing for the chain to run end to end. " +
        'Call this for "autopilot kaisa chal raha hai", "leads se baat kaun karta hai", "kya meeting khud set hoti hai", "kya sab auto chal raha hai", ' +
        '"leads ka kaam kahan tak hua", "what is running automatically", "is lead generation on", "kya missing hai", "can you talk to my leads".',
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
];

/* ── pure shapes (unit-tested) ──────────────────────────────────────────────────────────── */

export type LeadRow = {
  id?: string; company?: string | null; name?: string | null; whatsapp?: string | null; phone?: string | null;
  stage?: string | null; wa_status?: string | null; needs_attention?: boolean | null; opt_out?: boolean | null;
  icp_score?: number | null; replied_at?: string | null; contacted_at?: string | null;
};

export function shapeLeadStats(leads: LeadRow[]) {
  const by: Record<string, number> = {};
  for (const l of leads) by[String(l.stage ?? "unknown")] = (by[String(l.stage ?? "unknown")] ?? 0) + 1;
  const stage_counts = Object.fromEntries(FUNNEL.map((f) => [f.label, by[f.stage] ?? 0]));
  const hasNumber = (l: LeadRow) => digits(l.whatsapp).length >= 8 || digits(l.phone).length >= 8;
  const withNumber = leads.filter(hasNumber).length;
  const confirmedYes = leads.filter((l) => l.wa_status === "yes").length;
  const confirmedNo = leads.filter((l) => l.wa_status === "no" || l.stage === "invalid").length;
  const messaged = leads.filter((l) => MESSAGED_STAGES.includes(String(l.stage))).length;
  const replied = leads.filter((l) => REPLIED_STAGES.includes(String(l.stage)) || !!l.replied_at).length;
  return {
    total_leads: leads.length,
    with_a_phone_or_whatsapp_number: withNumber,
    without_any_number: leads.length - withNumber,
    confirmed_on_whatsapp: confirmedYes,
    confirmed_NOT_on_whatsapp: confirmedNo,
    not_checked_yet: leads.length - confirmedYes - confirmedNo,
    messaged,
    replied,
    asked_for_a_call: by.meeting_requested ?? 0,
    call_booked: by.meeting_scheduled ?? 0,
    call_done: by.meeting_done ?? 0,
    ready_to_buy: by.ready_to_buy ?? 0,
    became_clients: by.won ?? 0,
    need_you_now: leads.filter((l) => l.needs_attention).length,
    asked_not_to_be_contacted: leads.filter((l) => l.opt_out || l.stage === "opted_out").length,
    by_stage: stage_counts,
    note: "'with a number' means a phone or WhatsApp number is on file; 'confirmed' means WhatsApp itself said the number is registered. Say which one you mean.",
  };
}

export type MessageRow = { direction?: string | null; body?: string | null; created_at?: string | null; answered_by?: string | null; status?: string | null };
export type MeetingRow = { status?: string | null; start_at?: string | null; meet_link?: string | null };

/** Which lead did the customer mean? Phone digits first (exact tail match), then company/name: exact, then starts-with, then contains.
 *  Returns every candidate that ties for the best match, so the caller can ask instead of guessing. */
export function matchLeads(leads: LeadRow[], who: string): LeadRow[] {
  const q = clip(who, 80).toLowerCase();
  if (!q) return [];
  const qd = digits(q);
  if (qd.length >= 6) {
    const hit = leads.filter((l) => [l.whatsapp, l.phone].some((p) => { const d = digits(p); return d.length >= 6 && (d.endsWith(qd) || qd.endsWith(d)); }));
    if (hit.length) return hit;
  }
  const names = (l: LeadRow) => [l.company, l.name].map((x) => String(x ?? "").toLowerCase()).filter(Boolean);
  const exact = leads.filter((l) => names(l).some((n) => n === q));
  if (exact.length) return exact;
  const starts = leads.filter((l) => names(l).some((n) => n.startsWith(q)));
  if (starts.length) return starts;
  return leads.filter((l) => names(l).some((n) => n.includes(q) || (n.length >= 3 && q.includes(n))));
}

export function shapeLeadConversation(lead: LeadRow & { needs_attention_reason?: string | null; last_intent?: string | null; city?: string | null; country?: string | null }, messages: MessageRow[], meetings: MeetingRow[]) {
  // Oldest first, so it reads as the conversation it was.
  const thread = [...messages].sort((a, b) => Date.parse(String(a.created_at)) - Date.parse(String(b.created_at)));
  return {
    lead: {
      name: lead.company || lead.name || "(no name)",
      stage: lead.stage,
      phone: lead.whatsapp || lead.phone || null,
      on_whatsapp: lead.wa_status === "yes" ? "confirmed" : lead.wa_status === "no" ? "no" : "not checked",
      city: lead.city ?? null,
      country: lead.country ?? null,
      score: lead.icp_score ?? null,
      last_intent_understood: lead.last_intent ?? null,
      needs_you: !!lead.needs_attention,
      needs_you_reason: lead.needs_attention_reason ?? null,
      asked_not_to_be_contacted: !!(lead.opt_out || lead.stage === "opted_out"),
    },
    messages_shown: thread.length,
    conversation: thread.map((m) => ({
      at: m.created_at,
      from: m.direction === "in" ? "the lead" : m.answered_by === "person" ? "the owner" : "the AI assistant",
      text: clip(m.body, 420),
    })),
    calls: meetings.map((m) => ({ status: m.status, at: m.start_at ?? null, has_meet_link: !!m.meet_link })),
    note: "Summarise ONLY from `conversation`. If it is empty, say no messages are saved for this lead.",
  };
}

export function shapeRecentConversations(leads: (LeadRow & { last?: MessageRow })[]) {
  return {
    recent_conversations: leads.slice(0, 10).map((l) => ({
      name: l.company || l.name || "(no name)",
      stage: l.stage,
      last_message_from: l.last?.direction === "in" ? "the lead" : "us",
      last_message: clip(l.last?.body, 140),
      at: l.last?.created_at ?? null,
    })),
    note: "Ask the customer which one they want to read.",
  };
}

export type KeywordChoiceRow = { topic?: string | null; recommended?: string | null; chosen?: string | null; status?: string | null; created_at?: string | null; candidates?: any };
/** A finished keyword job from jobs_log. A "research only" run (the chat's "keyword research karo") saves its result HERE, in `detail`
 *  — not in keyword_choices, which only the write-an-article chain fills. Reading only keyword_choices made every research result invisible. */
export type KeywordJobRow = { action?: string | null; created_at?: string | null; detail?: any };

const kwList = (list: any, n: number) =>
  (Array.isArray(list) ? list : []).slice(0, n).map((c: any) => ({
    keyword: c?.keyword,
    monthly_searches: c?.searchVolume ?? null,
    competition: c?.competitionLevel ?? c?.competition ?? null,
    source: c?.source ?? null,
    recommended: !!c?.recommended,
  }));

export function shapeKeywords(choices: KeywordChoiceRow[], jobs: KeywordJobRow[] = []) {
  const fromChoices = choices.map((r) => ({
    topic_researched: r.topic ?? null,
    recommended_keyword: r.recommended ?? null,
    chosen: r.chosen ?? null,
    status: r.status === "pending" ? "waiting for the customer to choose" : r.status === "chosen" ? "chosen" : r.status === "used" ? "used for an article" : r.status ?? null,
    researched_at: r.created_at ?? null,
    candidates: kwList(r.candidates, 8),
  }));
  const fromJobs = jobs
    .filter((j) => j.detail && typeof j.detail === "object" && (j.detail.topic || j.detail.relatedKeywords))
    .map((j) => {
      const d = j.detail;
      return {
        topic_researched: d.topic ?? null,
        recommended_keyword: d.recommended ?? null,
        why_recommended: d.recommendedWhy ?? null,
        kind: d.researchOnly ? "research only (no article written)" : d.chained ? "research that led to an article" : "research",
        search_data: d.searchDataAvailable === false ? "no search-volume data was available, so numbers are not measured" : "measured search data",
        researched_at: j.created_at ?? null,
        candidates: kwList(d.relatedKeywords, 8),
        dropped_as_off_topic: Array.isArray(d.fit?.dropped) ? d.fit.dropped.slice(0, 4).map((x: any) => x?.keyword) : [],
      };
    });
  // Newest first across both sources.
  const runs = [...fromChoices, ...fromJobs]
    .sort((a: any, b: any) => Date.parse(String(b.researched_at ?? 0)) - Date.parse(String(a.researched_at ?? 0)))
    .slice(0, 5);
  return {
    research_runs: runs,
    note: runs.length ? "These are saved results. Read the numbers exactly; a null means it was not measured. The FIRST run is the latest." : "No keyword research has been saved yet.",
  };
}

export type AutopilotInput = {
  leadSchedule?: { enabled?: boolean | null; frequency?: string | null; time_of_day?: string | null; timezone?: string | null; count?: number | null; last_run_at?: string | null } | null;
  whatsapp?: { connected: boolean; autoReply: boolean | null } | null;
  settings?: { outbound_enabled?: boolean; followups_enabled?: boolean; send_start?: number; send_end?: number; booking_link?: string; meeting_reminders?: boolean; daily_summary?: boolean } | null;
  teamNumbers?: number | null;
  googleCalendar?: "connected" | "needs_reconnect" | "not_connected" | null;
  stats: ReturnType<typeof shapeLeadStats>;
};

/** What is on, what is connected, how many leads sit where, and — most useful — what is MISSING for the chain to run end to end. */
export function shapeAutopilot(i: AutopilotInput) {
  const s = i.settings ?? {};
  const wa = i.whatsapp;
  const sched = i.leadSchedule;
  const missing: string[] = [];
  // null/undefined = the agent server could not be reached: that is "unknown", NOT "not linked". Reporting a guess as a fact is the one thing this tool must not do.
  const waUnknown = wa == null;
  const couldNotRead: string[] = [];
  if (waUnknown) couldNotRead.push("whether WhatsApp is linked and auto-replies are on");
  if (i.settings == null) couldNotRead.push("the WhatsApp settings (sending hours, follow-ups, booking link, reminders)");
  if (i.teamNumbers == null) couldNotRead.push("the team numbers");
  if (!sched?.enabled) missing.push("Daily lead discovery is not scheduled (Schedule page).");
  if (!waUnknown && !wa!.connected) missing.push("WhatsApp is not linked (Connect page), so nothing can be sent.");
  else if (!waUnknown && wa!.autoReply === false) missing.push("Auto-replies are switched OFF, so the assistant will not answer customers.");
  if (s.outbound_enabled === false) missing.push("First messages to new leads are switched off (WhatsApp settings > Sending).");
  if (s.followups_enabled === false) missing.push("Follow-ups are switched off.");
  if (i.settings != null && i.googleCalendar !== "connected" && !String(s.booking_link ?? "").trim()) missing.push("No way to make a meeting link: connect Google Calendar or add a booking link.");
  if (i.teamNumbers != null && i.teamNumbers === 0) missing.push("No team number is set, so nobody is alerted when a lead wants a call.");
  const st = i.stats;
  return {
    chain: [
      { step: "1. Find leads", on: !!sched?.enabled, detail: sched?.enabled ? `${sched.frequency ?? "daily"} at ${sched.time_of_day ?? "?"} (${sched.timezone ?? "?"}), up to ${sched.count ?? "?"} per run, last run ${sched.last_run_at ?? "never"}` : "not scheduled" },
      { step: "2. First WhatsApp message", on: waUnknown || i.settings == null ? null : wa!.connected ? s.outbound_enabled !== false : false, detail: waUnknown ? "could not be checked just now" : `sends between ${s.send_start ?? 9}:00 and ${s.send_end ?? 21}:00, one at a time with a natural pause` },
      { step: "3. Follow-ups", on: i.settings == null ? null : s.followups_enabled !== false, detail: "after 48 hours, 5 days and 7 days of silence, then stops" },
      { step: "4. Answer replies", on: waUnknown ? null : !!wa!.connected && wa!.autoReply !== false, detail: "replies in the customer's language; hands anything it cannot settle to a person" },
      { step: "5. Book the call", on: i.googleCalendar === "connected" ? true : i.settings == null ? null : !!String(s.booking_link ?? "").trim(), detail: i.googleCalendar === "connected" ? "offers free slots and creates the Google Meet link" : s.booking_link ? "sends your booking link" : "the team is alerted to arrange it by hand" },
      { step: "6. Reminders and report", on: i.settings == null ? null : s.meeting_reminders !== false || s.daily_summary !== false, detail: `meeting reminders ${s.meeting_reminders === false ? "off" : "on"}, daily summary ${s.daily_summary === false ? "off" : "on"}, ${i.teamNumbers ?? 0} team number(s)` },
    ],
    connected: { whatsapp: waUnknown ? "could not be checked just now" : !!wa!.connected, google_calendar: i.googleCalendar ?? "not_connected", booking_link: !!String(s.booking_link ?? "").trim(), team_numbers: i.teamNumbers ?? 0 },
    leads_now: {
      total: st.total_leads, waiting_for_first_message: st.by_stage["approved, first message due"] + st.by_stage["queued to send"], messaged: st.messaged, replied: st.replied,
      asked_for_a_call: st.asked_for_a_call, call_booked: st.call_booked, became_clients: st.became_clients, need_you_now: st.need_you_now,
    },
    missing_for_end_to_end: missing,
    ...(couldNotRead.length ? { could_not_read_right_now: couldNotRead } : {}),
    verdict: couldNotRead.length
      ? `${missing.length} thing(s) known to be missing; I could not check: ${couldNotRead.join("; ")}. Say so rather than guessing.`
      : missing.length === 0 ? "Everything needed for the full chain is on." : `${missing.length} thing(s) stop the chain from running fully end to end.`,
  };
}

/* ── I/O ────────────────────────────────────────────────────────────────────────────────── */

const LEAD_COLS = "id, company, name, whatsapp, phone, stage, wa_status, needs_attention, needs_attention_reason, last_intent, opt_out, icp_score, replied_at, contacted_at, city, country";
const LEAD_COLS_OLD = "id, company, name, whatsapp, phone, stage, needs_attention, opt_out, icp_score, replied_at, contacted_at, city, country";

/** Select with the newest columns, and again without the ones an older database may lack (wa_status, last_intent…) so a missing column is not an outage. */
async function selectLeads(supabase: SupabaseClient, tenantId: string, cols: [string, string], limit = 2000) {
  let r: any = await supabase.from("leads").select(cols[0]).eq("tenant_id", tenantId).limit(limit);
  if (r.error && /column .* does not exist/i.test(r.error.message)) r = await supabase.from("leads").select(cols[1]).eq("tenant_id", tenantId).limit(limit);
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as any[];
}

export async function lookupLeadStats(supabase: SupabaseClient, tenantId: string): Promise<ReadResult> {
  const leads = await selectLeads(supabase, tenantId, [LEAD_COLS, LEAD_COLS_OLD]);
  return { ok: true, tool: LOOKUP_LEAD_STATS, data: shapeLeadStats(leads) };
}

export async function lookupLeadConversation(supabase: SupabaseClient, tenantId: string, who: string): Promise<ReadResult> {
  const q = clip(who, 80);
  if (!q) {
    // No name given: the most recently active conversations, so the customer can pick.
    const { data: msgs } = await supabase.from("outreach_messages").select("lead_id, direction, body, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(60);
    const seen = new Map<string, MessageRow>();
    for (const m of (msgs ?? []) as any[]) if (m.lead_id && !seen.has(m.lead_id)) seen.set(m.lead_id, m);
    const ids = Array.from(seen.keys()).slice(0, 10);
    if (!ids.length) return { ok: true, tool: LOOKUP_LEAD_CONVERSATION, data: { recent_conversations: [], note: "No conversations with leads are saved yet." } };
    const { data: ls } = await supabase.from("leads").select("id, company, name, stage").eq("tenant_id", tenantId).in("id", ids);
    const rows = ids.map((id) => ({ ...(((ls ?? []) as any[]).find((l) => l.id === id) ?? {}), last: seen.get(id) }));
    return { ok: true, tool: LOOKUP_LEAD_CONVERSATION, data: shapeRecentConversations(rows as any) };
  }

  const leads = await selectLeads(supabase, tenantId, [LEAD_COLS, LEAD_COLS_OLD]);
  const found = matchLeads(leads, q);
  if (found.length === 0) return { ok: true, tool: LOOKUP_LEAD_CONVERSATION, data: { found: false, searched_for: q, note: "No lead matches that name or number. Ask the customer to check the spelling, or to give the phone number." } };
  if (found.length > 1) {
    return { ok: true, tool: LOOKUP_LEAD_CONVERSATION, data: { found: "several", searched_for: q, candidates: found.slice(0, 8).map((l) => ({ name: l.company || l.name, stage: l.stage, phone: l.whatsapp || l.phone || null })), note: "More than one lead matches. Ask the customer which one — do not pick." } };
  }
  const lead = found[0];
  const { data: msgs, error } = await supabase.from("outreach_messages").select("direction, body, created_at, answered_by, status").eq("tenant_id", tenantId).eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(40);
  if (error) throw new Error(error.message);
  let meetings: MeetingRow[] = [];
  try {
    const m = await supabase.from("lead_meetings").select("status, start_at, meet_link").eq("tenant_id", tenantId).eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(5);
    if (!m.error) meetings = (m.data ?? []) as any[];
  } catch { /* meetings table not migrated: no calls to report */ }
  return { ok: true, tool: LOOKUP_LEAD_CONVERSATION, data: shapeLeadConversation(lead as any, (msgs ?? []) as any[], meetings) };
}

export async function lookupKeywords(supabase: SupabaseClient, tenantId: string): Promise<ReadResult> {
  const [choices, jobs] = await Promise.all([
    supabase.from("keyword_choices").select("topic, recommended, chosen, status, created_at, candidates").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5),
    supabase.from("jobs_log").select("action, created_at, detail").eq("tenant_id", tenantId).eq("agent", "keyword").eq("status", "success").order("created_at", { ascending: false }).limit(5),
  ]);
  const choiceRows = choices.error ? [] : ((choices.data ?? []) as any[]);
  const jobRows = jobs.error ? [] : ((jobs.data ?? []) as any[]);
  if (choices.error && jobs.error) throw new Error(jobs.error.message);
  return { ok: true, tool: LOOKUP_KEYWORDS, data: shapeKeywords(choiceRows, jobRows) };
}

export async function lookupAutopilot(supabase: SupabaseClient, tenantId: string): Promise<ReadResult> {
  const [leads, sched, status, settings, admins, google] = await Promise.all([
    selectLeads(supabase, tenantId, [LEAD_COLS, LEAD_COLS_OLD]).catch(() => [] as any[]),
    supabase.from("schedules").select("enabled, frequency, time_of_day, timezone, count, last_run_at").eq("tenant_id", tenantId).eq("kind", "leads").maybeSingle().then((r: any) => r.data ?? null, () => null),
    callWhatsapp(tenantId, "status").catch(() => null as any),
    callWhatsapp(tenantId, "settings").catch(() => null as any),
    callWhatsapp(tenantId, "admins").catch(() => null as any),
    loadGoogle(supabase, tenantId).catch(() => null),
  ]);
  const googleCalendar = google ? ((google.scopes ?? []).includes(SCOPE_CALENDAR) ? "connected" : "needs_reconnect") : "not_connected";
  const data = shapeAutopilot({
    leadSchedule: sched,
    whatsapp: status?.ok ? { connected: status.status === "connected" || status.status === "reconnecting" || status.linked === true, autoReply: typeof status.autoReply === "boolean" ? status.autoReply : null } : null,
    settings: settings?.ok ? settings.settings : null,
    teamNumbers: admins?.ok && Array.isArray(admins.admins) ? admins.admins.filter((a: any) => a?.notify !== false).length : null,
    googleCalendar,
    stats: shapeLeadStats(leads),
  });
  return { ok: true, tool: LOOKUP_AUTOPILOT, data };
}
