/** Mr. WhatsApp ACTIVITY — what the AI is doing on WhatsApp right now, in a form a person can read.
 *
 *  One overview, built from what is already in the database (no new table, nothing the senders have to
 *  remember to log):
 *    · who the AI will answer next, and who is held back and WHY (you replied yourself, daily limit, the
 *      lead said STOP, auto replies off, WhatsApp offline);
 *    · the queue of first messages, with the time each one is due;
 *    · follow-ups that are coming due;
 *    · the first messages that were skipped (not on WhatsApp, toll-free, ...) and why;
 *    · messages per hour for the last 24 hours, for the graph.
 *
 *  Both the Activity panel and Mr Lxwa (the chat assistant's lookup tool) read this same object, so the
 *  page and the assistant can never disagree.
 *
 *  The rules mirrored here are the SAME ones the senders enforce (autoReply.ts, outbound.ts, followup.ts);
 *  this file only explains them, it never sends. buildOverview is pure: rows and a clock in, answer out. */
import { supabase } from "../../supabase.js";
import { getWhatsappSettings, type WhatsappSettings } from "../outreach/settings.js";
import { dailyAutoSendCount, warmupCap } from "./autoReply.js";
import { isQuietHours, nextAllowedTime } from "./outbound.js";
import { FOLLOWUP_HOURS } from "./followup.js";
import { sessionStatus } from "./session.js";
import { prepareDraft } from "./opener.js";

/** A reply is sent 30–180s after a message arrives; past this the AI either chose not to answer or it is stuck. */
const REPLY_WINDOW_S = 180;
const SETTLE_S = 360;
const ACTIVE_CONVO_MS = 60 * 60 * 1000;
const HOUR = 3_600_000;

export type StateCode = "in_use_elsewhere" | "running" | "auto_off" | "not_connected" | "reconnecting" | "cap_reached" | "quiet_hours" | "conversation_active";

export type ReplyRow = {
  lead_id: string; name: string; phone: string | null; since: string;
  /** queued = the AI will answer on its own; held = it will not, and `reason` says why; reviewed = it looked and sent nothing. */
  state: "queued" | "held" | "reviewed";
  due_by?: string; reason: string;
};

/** One thing on the "what happens next" timeline. */
export type AgendaItem = {
  kind: "reply" | "first_message" | "followup" | "resume";
  at: string;
  lead_id?: string;
  lead?: string;
  title: string;
  detail: string;
  /** What will be sent. `ready` = the exact text is already written; `ai` = the AI writes it when the time comes (`text` says how). */
  message?: { state: "ready" | "ai"; text: string };
};

export type Overview = {
  generated_at: string;
  /** `sending` = the AI is allowed to send (possibly after a wait). False when it is paused: off, offline, reconnecting, limit. */
  state: { code: StateCode; label: string; detail: string; resumes_at?: string; sending: boolean };
  /** The rules in force, so the page can say them in words. */
  plan: { window_start: number; window_end: number; tz_offset: number; gap_min: number; gap_max: number; followups_enabled: boolean; first_messages_enabled: boolean; number_age_days: number | null };
  today: { sent: number; cap: number; remaining: number };
  counts: { replies_waiting: number; held: number; first_messages_queued: number; followups_due_24h: number; skipped_24h: number };
  next: { kind: "reply" | "first_message" | "followup"; lead: string; at: string } | null;
  replies: ReplyRow[];
  first_messages: { lead_id: string; name: string; at: string }[];
  /** Everything that is about to happen, in time order, with what each message will say. */
  agenda: AgendaItem[];
  agenda_more: number;
  followups: { lead_id: string; name: string; which: number; due_at: string }[];
  skipped: { lead_id: string; name: string; reason: string; at: string }[];
  timeline: { hour: string; ai: number; you: number; received: number }[];
  /** The current hour and the next five, one bucket each: what is scheduled to go out. */
  upcoming: { hour: string; first: number; followups: number }[];
};

export type MsgRow = { lead_id: string | null; direction: "in" | "out"; answered_by: string | null; created_at: string };
export type LeadRow = {
  id: string; company?: string | null; name?: string | null; phone?: string | null; whatsapp?: string | null; stage?: string | null;
  last_intent?: string | null; opt_out?: boolean | null; auto_reply_paused_until?: string | null; needs_attention?: boolean | null; needs_attention_reason?: string | null;
  replied_at?: string | null; contacted_at?: string | null; auto_followups_done?: number | null;
};
export type QueueRow = { lead_id: string; scheduled_at: string; status: string; reason: string | null; updated_at?: string | null };

export type OverviewInput = {
  nowMs: number;
  settings: WhatsappSettings;
  /** Live connection state: connected | reconnecting | pairing | disconnected | logged_out | banned. */
  connection: string;
  /** Who holds the WhatsApp login when it is not this server, for the page to name. */
  holder?: { info: string; seenSecondsAgo: number } | null;
  firstConnectedAtMs: number | null;
  dailyCount: number;
  messages: MsgRow[];          // newest first, at least the last 24h
  leads: Record<string, LeadRow>;
  queue: QueueRow[];           // pending slots + skipped in the last 24h
  /** The written first message of the leads nearest the front of the queue (lead id -> draft), for the preview. */
  drafts?: Record<string, string>;
  /** Show every upcoming item, not just the first few (the "Show all" button). */
  full?: boolean;
};

const nameOf = (l?: LeadRow) => l?.company || l?.name || l?.phone || l?.whatsapp || "Lead";
const clock = (ms: number, tz: number) => {
  const d = new Date(ms + tz * HOUR);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export function buildOverview(inp: OverviewInput): Overview {
  const { nowMs, settings: s, leads } = inp;
  const cap = warmupCap(inp.firstConnectedAtMs, nowMs);
  const quiet = isQuietHours(nowMs, s.tz_offset, s.send_start, s.send_end);
  const online = inp.connection === "connected";

  // ── fold the messages per lead: the last one, and whether they ever wrote ──
  const lastByLead = new Map<string, MsgRow>();
  for (const m of inp.messages) if (m.lead_id && !lastByLead.has(m.lead_id)) lastByLead.set(m.lead_id, m);
  const lastInboundMs = inp.messages.find((m) => m.direction === "in");
  const activeConversation = !!lastInboundMs && nowMs - Date.parse(lastInboundMs.created_at) < ACTIVE_CONVO_MS;

  // ── overall state: the one sentence that answers "is the AI working, and if not, why" ──
  let state: Overview["state"];
  if (inp.connection === "in_use_elsewhere") state = { code: "in_use_elsewhere", label: "WhatsApp is open somewhere else", detail: `Another copy of the server is using this WhatsApp login, and WhatsApp allows only one. ${inp.holder ? `It is held by ${inp.holder.info}, last seen ${inp.holder.seenSecondsAgo}s ago. ` : ""}This one waits instead of fighting, and takes over as soon as the other stops.`, sending: false };
  else if (inp.connection === "reconnecting") state = { code: "reconnecting", label: "Reconnecting", detail: "WhatsApp is coming back online. Nothing is lost and no scan is needed.", sending: false };
  else if (!online) state = { code: "not_connected", label: "WhatsApp is not connected", detail: "The AI cannot send until WhatsApp is linked.", sending: false };
  else if (!s.auto_reply) state = { code: "auto_off", label: "Auto replies are OFF", detail: "The AI will not send anything on its own. Turn Auto replies on to start.", sending: false };
  else if (inp.dailyCount >= cap) state = { code: "cap_reached", label: "Daily limit reached", detail: `${inp.dailyCount} of ${cap} messages sent in the last 24 hours. This keeps a new number safe; sending resumes as older messages age out.`, sending: false };
  else if (quiet) {
    const at = nextAllowedTime(nowMs, s.tz_offset, s.send_start, s.send_end);
    state = { code: "quiet_hours", label: "Quiet hours", detail: `First messages and follow-ups wait until ${clock(at, s.tz_offset)}. Replies to people who write to you still go out.`, resumes_at: new Date(at).toISOString(), sending: true };
  } else if (activeConversation) {
    const resume = Date.parse(lastInboundMs!.created_at) + ACTIVE_CONVO_MS;
    state = { code: "conversation_active", label: "In a conversation", detail: `First messages wait while someone is chatting, and resume ${clock(resume, s.tz_offset)} if it stays quiet. Replies keep going.`, resumes_at: new Date(resume).toISOString(), sending: true };
  } else state = { code: "running", label: "Working", detail: "The AI is sending within its limits.", sending: true };

  // The earliest a FIRST MESSAGE / follow-up can go out. A slot that fell due while the AI was held back is not
  // "26 days ago": it goes out when the hold ends, so that is the time shown.
  const holdUntil = state.resumes_at ? Date.parse(state.resumes_at) : nowMs;
  const goesAt = (ms: number) => Math.max(ms, holdUntil, nowMs);

  // ── replies: every lead whose LAST message is theirs ──
  const replies: ReplyRow[] = [];
  lastByLead.forEach((m, leadId) => {
    if (m.direction !== "in") return;
    const l = leads[leadId];
    if (!l) return;
    const sinceMs = Date.parse(m.created_at);
    const ageS = (nowMs - sinceMs) / 1000;
    const base = { lead_id: leadId, name: nameOf(l), phone: l.phone ?? l.whatsapp ?? null, since: m.created_at };
    const pausedUntil = l.auto_reply_paused_until ? Date.parse(l.auto_reply_paused_until) : 0;
    if (l.opt_out) replies.push({ ...base, state: "held", reason: "Asked to stop. The AI will never write to them again." });
    else if (pausedUntil > nowMs) replies.push({ ...base, state: "held", reason: `You replied yourself, so the AI stays out of this chat until ${clock(pausedUntil, s.tz_offset)}.` });
    else if (inp.connection === "reconnecting") replies.push({ ...base, state: "held", reason: "WhatsApp is reconnecting; the AI answers once it is back." });
    else if (!online) replies.push({ ...base, state: "held", reason: "WhatsApp is not connected." });
    else if (!s.auto_reply) replies.push({ ...base, state: "held", reason: "Auto replies are OFF. Answer this one yourself." });
    else if (inp.dailyCount >= cap) replies.push({ ...base, state: "held", reason: "Daily limit reached, so the AI cannot answer right now." });
    else if (ageS <= REPLY_WINDOW_S + 15) replies.push({ ...base, state: "queued", due_by: new Date(sinceMs + REPLY_WINDOW_S * 1000).toISOString(), reason: "The AI is reading the thread and will answer within about 3 minutes." });
    else if (ageS <= SETTLE_S) replies.push({ ...base, state: "queued", due_by: new Date(nowMs + 60_000).toISOString(), reason: "The AI is finishing this reply." });
    else if (ageS < 7 * 86_400) replies.push({ ...base, state: "reviewed", reason: l.needs_attention ? (l.needs_attention_reason || "Needs you.") : l.last_intent ? `The AI read it (it looks like a ${l.last_intent}) and chose not to reply. Open the chat if it needs an answer.` : "The AI looked at it and sent nothing. Most likely a short acknowledgement such as \"ok\". Open the chat if it needs an answer." });
  });
  replies.sort((a, b) => (a.state === b.state ? Date.parse(a.since) - Date.parse(b.since) : a.state === "queued" ? -1 : b.state === "queued" ? 1 : a.state === "held" ? -1 : 1));

  // ── first messages still queued, and the ones that were skipped ──
  // Slots that fell due while the AI was held all clamp to the moment the hold ends. They will not all go at once:
  // one first message at a time, at least the minimum gap apart, so show them that way.
  const gapMs = s.gap_min_min * 60_000;
  let prevAt = holdUntil - gapMs;
  const first_messages = inp.queue
    .filter((q) => q.status === "pending" || q.status === "sending")
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))
    .map((q) => {
      prevAt = Math.max(goesAt(Date.parse(q.scheduled_at)), prevAt + gapMs);
      return { lead_id: q.lead_id, name: nameOf(leads[q.lead_id]), at: new Date(prevAt).toISOString() };
    });
  const skipped = inp.queue
    .filter((q) => q.status === "skipped")
    .sort((a, b) => Date.parse(b.updated_at ?? b.scheduled_at) - Date.parse(a.updated_at ?? a.scheduled_at))
    .map((q) => ({ lead_id: q.lead_id, name: nameOf(leads[q.lead_id]), reason: q.reason || "Skipped", at: q.updated_at ?? q.scheduled_at }));

  // ── follow-ups: the next nudge for a lead we spoke last to ──
  const followups: Overview["followups"] = [];
  if (s.followups_enabled) {
    for (const l of Object.values(leads)) {
      if (l.opt_out) continue;
      if (!["contacted", "delivered", "read", "replied", "in_conversation", "interested"].includes(String(l.stage))) continue;
      const done = l.auto_followups_done ?? 0;
      if (done >= FOLLOWUP_HOURS.length) continue;
      if (lastByLead.get(l.id)?.direction !== "out") continue; // their turn is not ours to nudge
      const anchor = Date.parse(l.replied_at ?? l.contacted_at ?? "");
      if (!Number.isFinite(anchor)) continue;
      const dueMs = goesAt(anchor + FOLLOWUP_HOURS[done] * HOUR);
      followups.push({ lead_id: l.id, name: nameOf(l), which: done + 1, due_at: new Date(dueMs).toISOString() });
    }
    followups.sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  }

  // ── what is next ──
  const cands: NonNullable<Overview["next"]>[] = [];
  const nextReply = replies.find((r) => r.state === "queued");
  if (nextReply) cands.push({ kind: "reply", lead: nextReply.name, at: nextReply.due_by ?? new Date(nowMs).toISOString() });
  if (first_messages[0]) cands.push({ kind: "first_message", lead: first_messages[0].name, at: first_messages[0].at });
  if (followups[0]) cands.push({ kind: "followup", lead: followups[0].name, at: followups[0].due_at });
  cands.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // ── timeline: 24 hourly buckets ending with the current hour ──
  const endHour = Math.floor(nowMs / HOUR) * HOUR;
  const timeline = Array.from({ length: 24 }, (_, i) => ({ hour: new Date(endHour - (23 - i) * HOUR).toISOString(), ai: 0, you: 0, received: 0 }));
  for (const m of inp.messages) {
    const idx = 23 - Math.floor((endHour - Math.floor(Date.parse(m.created_at) / HOUR) * HOUR) / HOUR);
    if (idx < 0 || idx > 23) continue;
    if (m.direction === "in") timeline[idx].received++;
    else if (m.answered_by === "brain") timeline[idx].ai++;
    else timeline[idx].you++;
  }

  // Bucket 0 is the CURRENT hour (what is still to go out in it), then the next five: it lines up with the last bar of the timeline.
  const upcoming = Array.from({ length: 6 }, (_, i) => ({ hour: new Date(endHour + i * HOUR).toISOString(), first: 0, followups: 0 }));
  const bucket = (iso: string) => Math.floor((Math.floor(Date.parse(iso) / HOUR) * HOUR - endHour) / HOUR);
  if (state.sending) {
    for (const f of first_messages) { const b = bucket(f.at); if (b >= 0 && b < 6) upcoming[b].first++; else if (b < 0) upcoming[0].first++; }
    for (const f of followups) { const b = bucket(f.due_at); if (b >= 0 && b < 6) upcoming[b].followups++; else if (b < 0) upcoming[0].followups++; }
  }

  // ── the agenda: everything about to happen, in time order, with what each message will say ──
  const FIRST_SHOWN = inp.full ? 150 : 12;
  const FOLLOW_SHOWN = inp.full ? 60 : 6;
  const NUDGE = ["a light check-in", "an offer to clarify anything", "a last, no-pressure note"];
  const agenda: AgendaItem[] = [];
  if (state.sending) {
    if (state.code === "quiet_hours" && state.resumes_at) agenda.push({ kind: "resume", at: state.resumes_at, title: "Sending window opens", detail: `First messages and follow-ups start again at ${clock(Date.parse(state.resumes_at), s.tz_offset)}.` });
    if (state.code === "conversation_active" && state.resumes_at) agenda.push({ kind: "resume", at: state.resumes_at, title: "First messages continue", detail: "They were paused while someone was chatting. If it stays quiet, they carry on from here." });
    for (const r of replies) {
      if (r.state !== "queued") continue;
      agenda.push({ kind: "reply", at: r.due_by ?? new Date(nowMs).toISOString(), lead_id: r.lead_id, lead: r.name, title: "Answer their message", detail: "They wrote to you, and the AI is answering.", message: { state: "ai", text: "The AI reads what they wrote and writes the answer just before sending." } });
    }
    for (const f of first_messages.slice(0, FIRST_SHOWN)) {
      const text = inp.drafts?.[f.lead_id] ?? null; // already prepared (branded, shortened) by the loader
      agenda.push({ kind: "first_message", at: f.at, lead_id: f.lead_id, lead: f.name, title: "First message", detail: "Introduces your business and how to opt out.", message: text ? { state: "ready", text } : { state: "ai", text: "The AI writes a short introduction from your business details (Site Brain) just before sending." } });
    }
    for (const f of followups.slice(0, FOLLOW_SHOWN)) {
      agenda.push({ kind: "followup", at: f.due_at, lead_id: f.lead_id, lead: f.name, title: `Follow-up ${f.which} of 3`, detail: "They have not answered.", message: { state: "ai", text: `The AI writes ${NUDGE[f.which - 1] ?? "a short check-in"} that fits the conversation.` } });
    }
    agenda.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  const agendaCap = inp.full ? 400 : 14;
  const agendaTotal = agenda.length + Math.max(0, first_messages.length - FIRST_SHOWN) + Math.max(0, followups.length - FOLLOW_SHOWN);

  const skipped24 = skipped.filter((x) => nowMs - Date.parse(x.at) < 86_400_000);
  return {
    generated_at: new Date(nowMs).toISOString(),
    state,
    plan: {
      window_start: s.send_start, window_end: s.send_end, tz_offset: s.tz_offset, gap_min: s.gap_min_min, gap_max: s.gap_max_min,
      followups_enabled: s.followups_enabled, first_messages_enabled: s.outbound_enabled,
      number_age_days: inp.firstConnectedAtMs ? Math.floor((nowMs - inp.firstConnectedAtMs) / 86_400_000) : null,
    },
    today: { sent: inp.dailyCount, cap, remaining: Math.max(0, cap - inp.dailyCount) },
    counts: {
      replies_waiting: replies.filter((r) => r.state === "queued").length,
      held: replies.filter((r) => r.state === "held").length,
      first_messages_queued: first_messages.length,
      followups_due_24h: followups.filter((f) => Date.parse(f.due_at) - nowMs < 86_400_000).length,
      skipped_24h: skipped24.length,
    },
    next: cands[0] ?? null,
    replies: replies.slice(0, 25),
    first_messages: first_messages.slice(0, 15),
    agenda: agenda.slice(0, agendaCap),
    agenda_more: Math.max(0, agendaTotal - Math.min(agenda.length, agendaCap)),
    followups: followups.slice(0, 10),
    skipped: skipped24.slice(0, 10),
    timeline,
    upcoming,
  };
}

/** Gather the rows and build the overview. Never throws: a missing table just means an emptier answer. */
export async function loadOverview(tenantId: string, nowMs = Date.now(), opts: { full?: boolean } = {}): Promise<Overview> {
  const since = new Date(nowMs - 7 * 86_400_000).toISOString();
  const [settings, dailyCount, { data: sess }, { data: msgs }, { data: queue }] = await Promise.all([
    getWhatsappSettings(tenantId),
    dailyAutoSendCount(tenantId),
    supabase.from("whatsapp_sessions").select("*").eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("outreach_messages").select("lead_id, direction, answered_by, created_at").eq("tenant_id", tenantId).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
    supabase.from("wa_outbound_queue").select("lead_id, scheduled_at, status, reason, updated_at").eq("tenant_id", tenantId).or(`status.in.(pending,sending),and(status.eq.skipped,updated_at.gte.${new Date(nowMs - 86_400_000).toISOString()})`).limit(300),
  ]);
  const messages = (msgs ?? []) as MsgRow[];
  const queueRows = (queue ?? []) as QueueRow[];

  // The leads that matter: those with a last message from them, those in the queue, and those due a nudge.
  const ids = new Set<string>();
  const seen = new Set<string>();
  for (const m of messages) if (m.lead_id && !seen.has(m.lead_id)) { seen.add(m.lead_id); ids.add(m.lead_id); }
  for (const q of queueRows) ids.add(q.lead_id);
  const leads: Record<string, LeadRow> = {};
  const idList = Array.from(ids).slice(0, 400);
  if (idList.length) {
    const { data } = await supabase
      .from("leads")
      .select("id, company, name, phone, whatsapp, stage, opt_out, auto_reply_paused_until, needs_attention, needs_attention_reason, last_intent, replied_at, contacted_at, auto_followups_done")
      .eq("tenant_id", tenantId)
      .in("id", idList);
    for (const l of (data ?? []) as LeadRow[]) leads[l.id] = l;
  }

  const live = sessionStatus(tenantId).status;
  const dbStatus = (sess as any)?.status as string | undefined;
  // Linked (a number is on file, not logged out or banned) but no live socket yet = reconnecting, the same word
  // the chat page uses. Only an UNLINKED number is "not connected".
  const linked = !!(sess as any)?.phone_number && dbStatus !== "logged_out" && dbStatus !== "banned";
  const connection = live === "in_use_elsewhere" ? live : live === "disconnected" && linked ? "reconnecting" : live;
  // The written first message of the leads at the front of the queue, so the page can show what will be sent.
  const front = queueRows.filter((q) => q.status === "pending" || q.status === "sending").sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at)).slice(0, opts.full ? 150 : 12).map((q) => q.lead_id);
  const drafts: Record<string, string> = {};
  if (front.length) {
    const { data: dr } = await supabase.from("leads").select("id, draft").eq("tenant_id", tenantId).in("id", front);
    const { data: tenantRow } = await supabase.from("tenants").select("name, website_url").eq("id", tenantId).maybeSingle();
    for (const d of (dr ?? []) as { id: string; draft: string | null }[]) {
      const ready = d.draft ? prepareDraft(d.draft, tenantRow as any) : null;
      if (ready) drafts[d.id] = ready;
    }
  }
  const sr = (sess ?? {}) as { owner?: string | null; owner_seen_at?: string | null; owner_info?: string | null };
  const holder = connection === "in_use_elsewhere" && sr.owner
    ? { info: sr.owner_info || sr.owner, seenSecondsAgo: sr.owner_seen_at ? Math.max(0, Math.round((nowMs - Date.parse(sr.owner_seen_at)) / 1000)) : 0 }
    : null;
  return buildOverview({
    nowMs, settings, connection, holder, dailyCount, drafts, full: opts.full,
    firstConnectedAtMs: (sess as any)?.first_connected_at ? Date.parse((sess as any).first_connected_at) : null,
    messages, leads, queue: queueRows,
  });
}
