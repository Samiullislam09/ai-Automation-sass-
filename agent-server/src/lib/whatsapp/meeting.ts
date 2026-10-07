/** §29.6 (P7) — the Option-B meeting flow: AI offers free slots on WhatsApp, the lead picks one,
 *  AI books a Google Meet and sends the link. Falls back gracefully (admin schedules manually) when
 *  Google Calendar isn't connected or a Calendar call fails — a meeting is never dropped silently.
 *
 *  Slot choice is parsed DETERMINISTICALLY (matchSlotChoice, unit-tested) — "2", "second one", a
 *  postpone phrase — so a wrong model read can't book the wrong time. */
import { supabase } from "../../supabase.js";
import { getWhatsappSettings } from "../outreach/settings.js";
import { isQuietHours } from "./outbound.js";
import { calendarFreeBusy, calendarBook, calendarCancel } from "./calendar.js";
import { sendText, simulateTyping } from "./session.js";
import { recordOutgoing } from "./store.js";
import { notifyAdmins } from "./team.js";

const DUR_MIN = 30;
const NOSHOW_NUDGE_HOURS = [48, 150] as const; // after a missed meeting
const NOSHOW_GRACE_H = 2; // wait this long past end_at before counting a no-show

type Slot = { start: string; end: string };

/* ── Pure: which slot did they pick? ─────────────────────────────────────────────────────────── */
export function matchSlotChoice(text: string, slotCount: number): number | "postpone" | null {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s]/g, " ").replace(/\s+/g, " ")} `;
  const postpone = ["not available", "busy", "another time", "some other time", "next time", "later", "reschedule", "cant", "cannot", "wont work", "baad me", "abhi nahi", "kal nahi", "nahi ho payega", "available nahi"];
  if (postpone.some((p) => t.includes(` ${p} `) || t.includes(p))) return "postpone";

  const ord: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, "first": 0, "1st": 0, "pehla": 0, "pehli": 0, "second": 1, "2nd": 1, "doosra": 1, "dusra": 1, "third": 2, "3rd": 2, "teesra": 2, "fourth": 3, "4th": 3 };
  for (const [k, i] of Object.entries(ord)) {
    if (i < slotCount && (t.includes(` ${k} `) || t.includes(` option ${k} `) || t.includes(` slot ${k} `))) return i;
  }
  return null;
}

/* ── Formatting ──────────────────────────────────────────────────────────────────────────────── */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtSlot(iso: string, tzOffset: number): string {
  const d = new Date(Date.parse(iso) + tzOffset * 3_600_000); // shift so UTC getters read local
  let h = d.getUTCHours();
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${h12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${ap}`;
}

async function leadName(tenantId: string, leadId: string, phone: string): Promise<string> {
  const { data } = await supabase.from("leads").select("company, name").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle();
  return (data as any)?.company || (data as any)?.name || phone;
}

/** Offer (or re-offer) slots. Returns true if an offer went out; false if Calendar wasn't usable
 *  (caller falls back to the manual/admin path). Supersedes any earlier pending offer. */
export async function offerMeeting(tenantId: string, leadId: string, phone: string): Promise<boolean> {
  const s = await getWhatsappSettings(tenantId);
  const fb = await calendarFreeBusy(tenantId, { tzOffset: s.tz_offset, sendStart: s.send_start, sendEnd: s.send_end, durationMin: DUR_MIN, want: 3 });
  if (!fb.ok || !fb.slots?.length) return false;

  await supabase.from("lead_meetings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("lead_id", leadId).eq("status", "offered");
  await supabase.from("lead_meetings").insert({ tenant_id: tenantId, lead_id: leadId, status: "offered", offered_slots: fb.slots });

  const lines = fb.slots.map((sl, i) => `${i + 1}) ${fmtSlot(sl.start, s.tz_offset)}`).join("\n");
  const body = `Happy to set up a quick call. Which time works for you?\n${lines}\n\nJust reply with the number.`;
  try {
    await simulateTyping(tenantId, phone, 2500);
    const { waMessageId } = await sendText(tenantId, phone, body);
    await recordOutgoing(supabase, tenantId, leadId, body, waMessageId, "brain");
  } catch {
    return false;
  }
  return true;
}

/** If the lead has a pending offer and just replied, act on it: book the chosen slot (Google Meet),
 *  re-offer on a postpone, or hand back (return false) when the reply isn't a clear choice. */
export async function handleMeetingReply(tenantId: string, leadId: string, phone: string, inboundText: string): Promise<boolean> {
  const { data: m } = await supabase
    .from("lead_meetings").select("id, offered_slots").eq("tenant_id", tenantId).eq("lead_id", leadId).eq("status", "offered")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!m) return false;
  const slots: Slot[] = Array.isArray((m as any).offered_slots) ? (m as any).offered_slots : [];
  if (!slots.length) return false;

  const choice = matchSlotChoice(inboundText, slots.length);
  if (choice === null) return false; // not a clear pick → let the normal reply ask again
  if (choice === "postpone") {
    const re = await offerMeeting(tenantId, leadId, phone);
    if (!re) {
      const body = "No problem — when would suit you better? Our team will lock it in.";
      try { const { waMessageId } = await sendText(tenantId, phone, body); await recordOutgoing(supabase, tenantId, leadId, body, waMessageId, "brain"); } catch { /* best effort */ }
    }
    return true;
  }

  const s = await getWhatsappSettings(tenantId);
  const slot = slots[choice];
  const who = await leadName(tenantId, leadId, phone);
  const book = await calendarBook(tenantId, { startIso: slot.start, endIso: slot.end, tzOffset: s.tz_offset, summary: `Call with ${who}`, description: "Booked via Mr Lxwa (WhatsApp)." });

  if (book.ok && book.eventId) {
    await supabase.from("lead_meetings").update({ status: "scheduled", start_at: slot.start, end_at: slot.end, calendar_event_id: book.eventId, meet_link: book.meetLink ?? null, updated_at: new Date().toISOString() }).eq("id", (m as any).id);
    await supabase.from("leads").update({ stage: "meeting_scheduled", updated_at: new Date().toISOString() }).eq("id", leadId).eq("tenant_id", tenantId);
    const body = `You're booked for ${fmtSlot(slot.start, s.tz_offset)}.${book.meetLink ? `\nGoogle Meet: ${book.meetLink}` : ""}\nSee you then!`;
    try { const { waMessageId } = await sendText(tenantId, phone, body); await recordOutgoing(supabase, tenantId, leadId, body, waMessageId, "brain"); } catch { /* best effort */ }
    await notifyAdmins(tenantId, { type: "meeting", title: `📅 Meeting booked with ${who}`, body: `${fmtSlot(slot.start, s.tz_offset)}${book.meetLink ? ` · ${book.meetLink}` : ""}`, leadId, whatsappText: `Meeting booked with ${who} for ${fmtSlot(slot.start, s.tz_offset)}.${book.meetLink ? ` Meet: ${book.meetLink}` : ""}` }).catch(() => {});
    return true;
  }

  // Booking failed (no Calendar / API error): don't lose the meeting — note the time, tell the lead
  // the team will confirm, and alert the admins to finish it by hand.
  await supabase.from("lead_meetings").update({ status: "scheduled", start_at: slot.start, end_at: slot.end, updated_at: new Date().toISOString() }).eq("id", (m as any).id);
  await supabase.from("leads").update({ stage: "meeting_scheduled", updated_at: new Date().toISOString() }).eq("id", leadId).eq("tenant_id", tenantId);
  const body = `Great — ${fmtSlot(slot.start, s.tz_offset)} it is. Our team will send the meeting invite shortly.`;
  try { const { waMessageId } = await sendText(tenantId, phone, body); await recordOutgoing(supabase, tenantId, leadId, body, waMessageId, "brain"); } catch { /* best effort */ }
  await notifyAdmins(tenantId, { type: "meeting", title: `📅 Confirm meeting with ${who}`, body: `${fmtSlot(slot.start, s.tz_offset)} — send them the invite (auto-booking was unavailable).`, leadId }).catch(() => {});
  return true;
}

/** The no-show sweep (scheduler.ts): a scheduled meeting whose time has passed with no reply gets a
 *  gentle reschedule nudge at 48h then 150h, then is marked no_show. Quiet-hours + settings gated. */
export async function tickMeetingNoShows(now: Date = new Date()): Promise<number> {
  const nowMs = now.getTime();
  let nudged = 0;
  const { data: mets } = await supabase
    .from("lead_meetings").select("id, tenant_id, lead_id, end_at, nudges_done").eq("status", "scheduled").not("end_at", "is", null)
    .lt("end_at", new Date(nowMs - NOSHOW_GRACE_H * 3_600_000).toISOString()).limit(200);
  for (const m of (mets ?? []) as any[]) {
    try {
      const s = await getWhatsappSettings(m.tenant_id);
      if (!s.auto_reply || isQuietHours(nowMs, s.tz_offset, s.send_start, s.send_end)) continue;
      // If the lead messaged after the meeting ended, they're engaged — leave it to the human/reactive.
      const { data: lastIn } = await supabase.from("outreach_messages").select("created_at").eq("tenant_id", m.tenant_id).eq("lead_id", m.lead_id).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (lastIn?.created_at && Date.parse(lastIn.created_at) > Date.parse(m.end_at)) {
        await supabase.from("lead_meetings").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", m.id);
        continue;
      }
      const hoursSince = (nowMs - Date.parse(m.end_at)) / 3_600_000;
      const done = m.nudges_done ?? 0;
      if (done >= NOSHOW_NUDGE_HOURS.length) {
        if (hoursSince >= NOSHOW_NUDGE_HOURS[NOSHOW_NUDGE_HOURS.length - 1] + 24) {
          await supabase.from("lead_meetings").update({ status: "no_show", updated_at: new Date().toISOString() }).eq("id", m.id);
        }
        continue;
      }
      if (hoursSince < NOSHOW_NUDGE_HOURS[done]) continue;
      const { data: lead } = await supabase.from("leads").select("whatsapp, phone, opt_out").eq("id", m.lead_id).eq("tenant_id", m.tenant_id).maybeSingle();
      const phone = (lead as any)?.whatsapp || (lead as any)?.phone || "";
      if (!lead || (lead as any).opt_out || !phone) { await supabase.from("lead_meetings").update({ nudges_done: done + 1 }).eq("id", m.id); continue; }
      const body = done === 0 ? "Looks like we missed each other — would you like to pick another time?" : "Still happy to set up that call whenever suits you — just say the word.";
      await simulateTyping(m.tenant_id, phone, 2000);
      const { waMessageId } = await sendText(m.tenant_id, phone, body);
      await recordOutgoing(supabase, m.tenant_id, m.lead_id, body, waMessageId, "brain");
      await supabase.from("lead_meetings").update({ nudges_done: done + 1, updated_at: new Date().toISOString() }).eq("id", m.id);
      nudged++;
    } catch (e: any) {
      console.warn(`[meeting] no-show nudge failed for ${m.id}:`, e?.message);
    }
  }
  return nudged;
}

/** Cancel a scheduled/offered meeting (admin action or supersede). Best effort on the Calendar side. */
export async function cancelMeeting(tenantId: string, meetingId: string): Promise<void> {
  const { data: m } = await supabase.from("lead_meetings").select("calendar_event_id").eq("tenant_id", tenantId).eq("id", meetingId).maybeSingle();
  if ((m as any)?.calendar_event_id) await calendarCancel(tenantId, (m as any).calendar_event_id).catch(() => {});
  await supabase.from("lead_meetings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", meetingId);
}
