/** §28.5 Phase 4 — FOLLOW-UPS: a gentle nudge to a lead who went quiet, then stop.
 *
 *  Owner timing (2026-11-13), replacing the old 24h/90h/160h-from-anchor ladder:
 *      first message → 48 h silence → follow-up 1
 *                    → 5 days silence → follow-up 2
 *                    → 7 days silence → follow-up 3 (the last, a graceful close)
 *  Each gap is measured from OUR LAST MESSAGE to them (the previous nudge, or the first message),
 *  which is how a person actually spaces a chase: "I wrote on Monday, nothing, so Wednesday I
 *  nudge; nothing, so five days later again; then one last time a week on".
 *
 *  A REPLY AT ANY POINT ENDS THE LADDER. The reply is answered immediately by the reactive lane
 *  (autoReply.ts), store.ts resets the counter to 0, and from then on the clock restarts: if the
 *  conversation goes quiet after our answer, follow-up 1 is due 48 h after THAT message. A lead
 *  whose last message is theirs is never nudged — the reactive lane owns it.
 *
 *  Follow-ups are PROACTIVE, so — unlike a reactive reply — they respect quiet hours and the shared
 *  daily cap, count toward it, and never touch an opted-out or human-handled lead. */
import { supabase } from "../../supabase.js";
import { completeJson } from "../llm.js";
import { loadActiveProfile } from "../siteProfile.js";
import { getWhatsappSettings } from "../outreach/settings.js";
import { warmupCap, dailyAutoSendCount } from "./autoReply.js";
import { isQuietHours } from "./outbound.js";
import { sendText, simulateTyping, senderOnline } from "./session.js";
import { leadDialDigits } from "./phone.js";
import { recordOutgoing } from "./store.js";
import { buildBusinessBrief, loadRecentThread, isNearDuplicate } from "./decide.js";

/** Hours of silence — counted from our last message — before follow-up 1, 2, 3 are due:
 *  48 h, then 5 days, then 7 days. */
export const FOLLOWUP_GAP_HOURS = [48, 120, 168] as const;
/** After the third follow-up, a lead still silent this long is marked lost. */
const LOST_AFTER_HOURS = 72;
const FOLLOWUPS_PER_TENANT_PER_TICK = 2;

/** The pure schedule decision: given how many nudges have gone and how many hours it has been
 *  since OUR LAST MESSAGE, do we send the next one, mark the lead lost, or wait? No DB, no clock —
 *  unit-tested. */
export function pickFollowup(done: number, hoursSinceLastMessage: number): { action: "send" | "lost" | "none"; which?: 1 | 2 | 3 } {
  if (done >= FOLLOWUP_GAP_HOURS.length) {
    return hoursSinceLastMessage >= LOST_AFTER_HOURS ? { action: "lost" } : { action: "none" };
  }
  if (hoursSinceLastMessage >= FOLLOWUP_GAP_HOURS[done]) return { action: "send", which: (done + 1) as 1 | 2 | 3 };
  return { action: "none" };
}

type ThreadMsg = { direction: "in" | "out"; body: string };

/** Draft the nudge. Each of the three has a different job, the way a good salesperson's chase does:
 *   1 (48 h)  a light, specific check-in tied to what they last asked about
 *   2 (5 d)   NEW value — a useful fact or an easy next step — never just "checking in again"
 *   3 (7 d)   the graceful close: leave the door open, make replying effortless, no guilt
 *  Grounded in the thread and the Site Brain; short; never invents a price or a date. */
async function draftFollowup(tenantId: string, leadId: string, which: 1 | 2 | 3): Promise<string> {
  const [{ data: lead }, thread, profile, { data: tenant }] = await Promise.all([
    supabase.from("leads").select("company, name, reason, city").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle(),
    // The NEWEST 30 messages — not the oldest 30.
    loadRecentThread(supabase, tenantId, leadId, 30),
    loadActiveProfile(tenantId),
    supabase.from("tenants").select("name, website_url").eq("id", tenantId).maybeSingle(),
  ]);
  const business = buildBusinessBrief(profile?.profile, (tenant as any) ?? null);
  const transcript = thread.map((m) => `${m.direction === "in" ? "THEM" : "US"}: ${String(m.body).replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
  const weSaid = thread.filter((m) => m.direction === "out").slice(-4).map((m) => m.body);
  const brief =
    which === 1
      ? "FOLLOW-UP 1 (two days of silence). A light, friendly check-in tied to the SPECIFIC thing they showed interest in. One easy question they can answer in a word. No pressure."
      : which === 2
        ? "FOLLOW-UP 2 (five more days of silence). Bring something NEW: one useful fact, a short tip, or a concrete easy next step (e.g. a 10-minute call). Do NOT just say 'checking in again'. Still warm, still brief."
        : "FOLLOW-UP 3 — the LAST one (a week of silence). A graceful, no-guilt close: say you will not keep pinging, the door stays open, and they can reply with a single word whenever it suits them. Warm, respectful, short.";

  const prompt = [
    "You write one short WhatsApp FOLLOW-UP to a lead who stopped replying, the way a thoughtful person at a respected company would.",
    `ABOUT US (the only facts you may state):\n${business}`,
    lead?.company ? `THE LEAD: ${lead.company}${lead.city ? `, ${lead.city}` : ""}` : "",
    "",
    "CONVERSATION SO FAR (oldest first):",
    transcript || "(our first message was sent; no reply yet)",
    "",
    brief,
    "Rules: 1-2 short lines, no 'Dear', no signature, no emoji spam (at most one), match their language and script (Hinglish in Roman letters if they write that). You can ONLY send text — never say you will send a file/PDF/brochure. Never invent a price, date or guarantee. Do not apologise. Do NOT repeat or paraphrase anything we already said:",
    weSaid.map((w) => `- ${String(w).replace(/\s+/g, " ").slice(0, 200)}`).join("\n"),
    'Reply with ONLY JSON: {"reply":"...your message..."}',
  ].filter(Boolean).join("\n");

  const answer = await completeJson<{ reply?: string }>(prompt);
  const reply = String(answer?.reply ?? "").trim().slice(0, 500);
  // Belt and braces: a follow-up that is a copy of something already sent is exactly the failure
  // the customer complained about. Better no nudge this tick than a repeat.
  if (reply && weSaid.some((w) => isNearDuplicate(reply, w))) return "";
  return reply;
}

async function lastMessageInfo(tenantId: string, leadId: string): Promise<{ direction: "in" | "out" | null; at: string | null }> {
  const { data } = await supabase.from("outreach_messages").select("direction, created_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = (data as any)?.direction;
  return { direction: d === "in" || d === "out" ? d : null, at: (data as any)?.created_at ?? null };
}

/** One tenant's due follow-ups this tick (at most FOLLOWUPS_PER_TENANT_PER_TICK). Returns count sent. */
async function followupTenant(tenantId: string, nowMs: number): Promise<number> {
  const s = await getWhatsappSettings(tenantId);
  if (!s.auto_reply || !s.followups_enabled) return 0;
  if (isQuietHours(nowMs, s.tz_offset, s.send_start, s.send_end)) return 0;

  const { data: session } = await supabase.from("whatsapp_sessions").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!(await senderOnline(supabase, tenantId, (session as any)?.status))) return 0;
  const cap = warmupCap((session as any)?.first_connected_at ? Date.parse((session as any).first_connected_at) : null, nowMs);
  let dailyCount = await dailyAutoSendCount(tenantId);
  if (dailyCount >= cap) return 0;

  // Candidates: engaged-or-contacted, not opted out, not under human handoff, nudges remaining.
  const { data: leads } = await supabase
    .from("leads")
    .select("id, stage, replied_at, contacted_at, auto_followups_done, auto_reply_paused_until, whatsapp, phone, country, opt_out")
    .eq("tenant_id", tenantId)
    .in("stage", ["contacted", "delivered", "read", "replied", "in_conversation", "interested"])
    .eq("opt_out", false)
    .lt("auto_followups_done", 3 + 1) // includes done=3 so we can mark them lost
    .limit(100);

  let sent = 0;
  for (const l of (leads ?? []) as any[]) {
    if (sent >= FOLLOWUPS_PER_TENANT_PER_TICK) break;
    if (dailyCount >= cap) break;
    if (l.auto_reply_paused_until && Date.parse(l.auto_reply_paused_until) > nowMs) continue; // human has it
    // Cheap pre-filter from columns already loaded: our last message is never OLDER than the lead's
    // newest of contacted_at / replied_at, so if even that is too recent the follow-up cannot be due
    // yet — and we skip the per-lead message lookup below for almost every lead on almost every tick.
    const cheapAnchor = Math.max(l.replied_at ? Date.parse(l.replied_at) : 0, l.contacted_at ? Date.parse(l.contacted_at) : 0);
    if (!cheapAnchor) continue;
    if (pickFollowup(l.auto_followups_done ?? 0, (nowMs - cheapAnchor) / 3_600_000).action === "none") continue;

    // The real anchor is OUR LAST MESSAGE. Only nudge if WE spoke last (we're waiting on them). If
    // their last message is inbound, the reactive lane owns it — a follow-up would talk over an
    // unanswered question.
    const lastMsg = await lastMessageInfo(tenantId, l.id);
    if (lastMsg.direction !== "out" || !lastMsg.at) continue;
    const hours = (nowMs - Date.parse(lastMsg.at)) / 3_600_000;
    const pick = pickFollowup(l.auto_followups_done ?? 0, hours);
    if (pick.action === "none") continue;

    if (pick.action === "lost") {
      await supabase.from("leads").update({ stage: "lost", updated_at: new Date().toISOString() }).eq("id", l.id).eq("tenant_id", tenantId).in("stage", ["contacted", "delivered", "read", "replied", "in_conversation", "interested"]);
      continue;
    }

    const dial = leadDialDigits(l);
    if (!dial.ok) continue;
    const phone = dial.digits;
    try {
      const body = await draftFollowup(tenantId, l.id, pick.which!);
      if (!body) continue;
      await simulateTyping(tenantId, phone, Math.min(5000, Math.max(1500, body.length * 35)));
      const { waMessageId } = await sendText(tenantId, phone, body);
      await recordOutgoing(supabase, tenantId, l.id, body, waMessageId, "brain");
      await supabase.from("leads").update({ auto_followups_done: pick.which, updated_at: new Date().toISOString() }).eq("id", l.id).eq("tenant_id", tenantId);
      dailyCount++;
      sent++;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/isn't on WhatsApp|not on WhatsApp/i.test(msg)) {
        await supabase.from("leads").update({ stage: "invalid", updated_at: new Date().toISOString() }).eq("id", l.id).eq("tenant_id", tenantId);
      } else {
        console.warn(`[followup] send failed for lead ${l.id}:`, msg);
      }
    }
  }
  return sent;
}

/** The once-a-minute follow-up sweep, called from scheduler.ts. Never throws past here. */
export async function tickFollowups(now: Date = new Date()): Promise<number> {
  const nowMs = now.getTime();
  let tenantIds: string[] = [];
  try {
    const { data } = await supabase.from("agent_settings").select("tenant_id, settings").eq("agent", "whatsapp");
    tenantIds = ((data ?? []) as any[]).filter((r) => r?.settings?.auto_reply === true).map((r) => r.tenant_id);
  } catch (e: any) {
    console.error("[followup] tick could not list tenants:", e?.message);
    return 0;
  }
  let sent = 0;
  for (const tenantId of tenantIds) {
    try {
      sent += await followupTenant(tenantId, nowMs);
    } catch (e: any) {
      console.error(`[followup] tenant ${tenantId} tick failed:`, e?.message);
    }
  }
  return sent;
}
