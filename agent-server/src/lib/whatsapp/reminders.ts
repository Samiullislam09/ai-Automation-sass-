/** Meeting reminders — a booked call that nobody turns up to is a lost sale.
 *
 *  Three messages per booked meeting (all optional per tenant: settings.meeting_reminders, default on):
 *   · the CUSTOMER, 24 hours before — only if the call was booked well before that point;
 *   · the CUSTOMER, 1 hour before — with the Google Meet link;
 *   · the OWNER / team, 1 hour before — a short briefing on who they are about to speak to and what was said.
 *
 *  EXACTLY ONCE. The sweep runs every few minutes and sees the same meeting many times, so a reminder is
 *  stamped on the meeting (lead_meetings.reminders, migration 043) BEFORE it is sent. If the stamp cannot be
 *  written — the migration is not applied — nothing is sent at all, and that is said once in the log: reminding
 *  the same customer every five minutes is far worse than not reminding.
 *
 *  A failed send takes its stamp back, so the next sweep tries again while the window is still open.
 *
 *  The rules (when is each reminder due?) and the wording are pure and unit-tested; only `tickMeetingReminders`
 *  touches the database and the WhatsApp socket. */
import { supabase } from "../../supabase.js";
import { completeJson } from "../llm.js";
import { getWhatsappSettings } from "../outreach/settings.js";
import { fmtSlot } from "./meeting.js";
import { sendText, simulateTyping } from "./session.js";
import { leadDialDigits } from "./phone.js";
import { recordOutgoing } from "./store.js";
import { notifyAdmins } from "./team.js";
import { loadRecentThread } from "./decide.js";
import { detectLanguage, type Lang, type Msg } from "./conversation.js";

export const MIN = 60_000;
export const HOUR = 3_600_000;

export type ReminderKind = "lead_24h" | "lead_1h" | "boss_1h";

export type MeetingForReminder = {
  status: string;
  start_at: string | null;
  created_at?: string | null;
  reminders?: Record<string, string> | null;
};

/** The customer is not woken or interrupted at night: 24-hour reminders only 07:00–22:00 local, the 1-hour
 *  one 06:00–23:00 (a 07:00 call is reminded at 06:00, which has to be allowed). */
const localHour = (nowMs: number, tzOffset: number) => new Date(nowMs + tzOffset * HOUR).getUTCHours();

/** Which reminders are due for this meeting right now and have not been sent. Pure. */
export function dueReminders(m: MeetingForReminder, nowMs: number, tzOffset: number): ReminderKind[] {
  if (m.status !== "scheduled" || !m.start_at) return [];
  const start = Date.parse(m.start_at);
  if (!Number.isFinite(start)) return [];
  const until = start - nowMs;
  const done = m.reminders ?? {};
  const hour = localHour(nowMs, tzOffset);
  const out: ReminderKind[] = [];

  // 24 h before: inside the window 24 h .. 3 h out, and only for a call booked at least 26 h ahead — a call
  // booked this morning for tomorrow afternoon has just been confirmed; reminding about it now is noise.
  const bookedAt = Date.parse(String(done.booked_at ?? m.created_at ?? ""));
  if (!done.lead_24h && until <= 24 * HOUR && until >= 3 * HOUR && hour >= 7 && hour < 22 && Number.isFinite(bookedAt) && start - bookedAt >= 26 * HOUR) out.push("lead_24h");

  // 1 h before: 65 .. 10 minutes out. Closer than 10 minutes a reminder is just a late message.
  if (until <= 65 * MIN && until >= 10 * MIN) {
    if (!done.lead_1h && hour >= 6 && hour < 23) out.push("lead_1h");
    if (!done.boss_1h) out.push("boss_1h");
  }
  return out;
}

/* ── wording ─────────────────────────────────────────────────────────────────────────────── */

/** "Sat 14 Nov, 3:00 PM" -> "3:00 PM". */
const timeOf = (when: string) => when.split(", ").slice(1).join(", ") || when;

export function leadReminderText(kind: "lead_24h" | "lead_1h", lang: Lang, when: string, meetLink: string | null): string {
  const link = meetLink ? `\nGoogle Meet: ${meetLink}` : "";
  const t = timeOf(when);
  if (kind === "lead_24h") {
    switch (lang) {
      case "hinglish": case "ur": return `Yaad dilana tha — hamari call ${when} ko hai.${link}\nAgar time suit nahi karta to yahin reply kar dijiye, hum naya time dekh lenge.`;
      case "hi": return `याद दिलाना था — हमारी कॉल ${when} को है।${link}\nअगर समय ठीक नहीं है तो यहीं जवाब दें, हम नया समय देख लेंगे।`;
      default: return `Friendly reminder — our call is on ${when}.${link}\nIf that no longer works, just reply here and we'll find another time.`;
    }
  }
  switch (lang) {
    case "hinglish": case "ur": return `Hamari call lagbhag ek ghante mein hai (${t}).${link}`;
    case "hi": return `हमारी कॉल लगभग एक घंटे में है (${t})।${link}`;
    default: return `Our call starts in about an hour (${t}).${link}`;
  }
}

/** What the owner reads an hour before: who, when, the link, and what the customer has said. */
export function bossReminderText(who: string, when: string, meetLink: string | null, summary: string): string {
  return [`⏰ Call in about an hour with ${who} — ${timeOf(when)}`, meetLink ? `Meet: ${meetLink}` : "", summary ? `\nWhat to know:\n${summary}` : ""].filter(Boolean).join("\n");
}

/** A deterministic briefing for when the model is unavailable: the customer's own last words. */
export function fallbackSummary(thread: Msg[]): string {
  const theirs = thread.filter((m) => m.direction === "in" && m.body && !String(m.body).startsWith("[")).slice(-3);
  if (!theirs.length) return "No messages from them yet.";
  return "They wrote: " + theirs.map((m) => `"${String(m.body).replace(/\s+/g, " ").slice(0, 110)}"`).join(" · ");
}

/** A three-line briefing from the conversation. The model only summarises what was said; if it fails, the
 *  fallback is used — a reminder is never held back for want of a summary. */
export async function summarizeLead(thread: Msg[], complete: (p: string, o?: any) => Promise<any> = completeJson): Promise<string> {
  const fallback = fallbackSummary(thread);
  if (thread.length < 2) return fallback;
  try {
    const transcript = thread.map((m) => `${m.direction === "in" ? "CUSTOMER" : "US"}: ${String(m.body).replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    const a = await complete(
      [
        "The business owner is about to join a call with this customer. From the WhatsApp conversation below, write at most 3 short lines:",
        "what they need, what was said about price or timeline, and any worry or objection. Use ONLY what is in the conversation; if something was not discussed, leave that line out. No greetings.",
        "",
        transcript,
        "",
        'Reply with ONLY JSON: {"summary":"line one\\nline two\\nline three"}',
      ].join("\n"),
      { timeoutMs: 20_000, retries: 1, maxTokens: 300 },
    );
    const s = typeof a?.summary === "string" ? a.summary.replace(/[ \t]+/g, " ").trim().slice(0, 420) : "";
    return s || fallback;
  } catch {
    return fallback;
  }
}

/* ── the sweep ───────────────────────────────────────────────────────────────────────────── */

let warnedNoColumn = false;

/** Stamp (or un-stamp) a reminder on the meeting. Returns false if it could not be written. */
async function stamp(meetingId: string, current: Record<string, string>, kind: string, on: boolean): Promise<boolean> {
  const next = { ...current };
  if (on) next[kind] = new Date().toISOString(); else delete next[kind];
  const { error } = await supabase.from("lead_meetings").update({ reminders: next }).eq("id", meetingId);
  if (error) {
    if (!warnedNoColumn) { warnedNoColumn = true; console.warn(`[meeting] cannot record reminders (apply migration 043?): ${error.message} — sending none`); }
    return false;
  }
  Object.assign(current, next);
  if (!on) delete current[kind];
  return true;
}

/** One pass: send whatever is due. Returns how many messages went out. Never throws. */
export async function tickMeetingReminders(now: Date = new Date()): Promise<number> {
  const nowMs = now.getTime();
  let sent = 0;
  const { data: rows, error } = await supabase
    .from("lead_meetings")
    .select("*")
    .eq("status", "scheduled")
    .gte("start_at", new Date(nowMs + 10 * MIN).toISOString())
    .lte("start_at", new Date(nowMs + 25 * HOUR).toISOString())
    .limit(300);
  if (error || !rows?.length) return 0;

  const settingsCache = new Map<string, Awaited<ReturnType<typeof getWhatsappSettings>>>();
  for (const m of rows as any[]) {
    try {
      let s = settingsCache.get(m.tenant_id);
      if (!s) { s = await getWhatsappSettings(m.tenant_id); settingsCache.set(m.tenant_id, s); }
      if (!s.auto_reply || !s.meeting_reminders) continue;

      const reminders: Record<string, string> = { ...(m.reminders ?? {}) };
      const due = dueReminders({ status: m.status, start_at: m.start_at, created_at: m.created_at, reminders }, nowMs, s.tz_offset);
      if (!due.length) continue;

      const { data: lead } = await supabase.from("leads").select("company, name, phone, whatsapp, country, opt_out").eq("id", m.lead_id).eq("tenant_id", m.tenant_id).maybeSingle();
      const who = (lead as any)?.company || (lead as any)?.name || "your customer";
      const when = fmtSlot(m.start_at, s.tz_offset);

      for (const kind of due) {
        if (!(await stamp(m.id, reminders, kind, true))) return sent; // cannot record → send nothing, ever
        try {
          if (kind === "boss_1h") {
            const thread = await loadRecentThread(supabase, m.tenant_id, m.lead_id, 20);
            const summary = await summarizeLead(thread);
            const text = bossReminderText(who, when, m.meet_link ?? null, summary);
            await notifyAdmins(m.tenant_id, { type: "meeting", title: `⏰ Call in about an hour with ${who}`, body: text, leadId: m.lead_id, whatsappText: text });
          } else {
            if (!lead || (lead as any).opt_out) continue; // an opted-out customer is never messaged — the stamp stays, nothing is retried
            const dial = leadDialDigits(lead as any);
            if (!dial.ok) continue;
            const lang = detectLanguage(await loadRecentThread(supabase, m.tenant_id, m.lead_id, 12));
            const text = leadReminderText(kind, lang, when, m.meet_link ?? null);
            await simulateTyping(m.tenant_id, dial.digits, 1500);
            const { waMessageId } = await sendText(m.tenant_id, dial.digits, text);
            await recordOutgoing(supabase, m.tenant_id, m.lead_id, text, waMessageId, "brain");
          }
          sent++;
        } catch (e: any) {
          // Not sent (WhatsApp offline, a timeout): take the stamp back so the next sweep tries again, for as
          // long as the window is open.
          await stamp(m.id, reminders, kind, false);
          console.warn(`[meeting] ${kind} reminder for ${m.id} not sent:`, e?.message);
        }
      }
    } catch (e: any) {
      console.warn(`[meeting] reminder sweep failed for ${m?.id}:`, e?.message);
    }
  }
  return sent;
}
