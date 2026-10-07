/** §28.5 Phase 4 — FOLLOW-UPS: a gentle nudge to a lead who went quiet, then stop.
 *
 *  Owner timing (2026-10-07): three nudges at 24h → 90h → 160h after they went silent, then the
 *  lead is marked `lost`. A reply at any point resets the counter (store.ts) so the clock starts
 *  over. Follow-ups are PROACTIVE, so — unlike a reactive reply — they respect quiet hours and the
 *  shared daily cap, count toward it, and never touch an opted-out or human-handled lead.
 *
 *  Anchor (when the clock starts) = the lead's last inbound (`replied_at`) if they ever replied,
 *  else `contacted_at` (a cold lead that never answered the first message). The nudge itself is an
 *  outbound message, which does NOT move the anchor, so the 24/90/160 schedule stays fixed to the
 *  moment they went quiet rather than drifting each time we nudge. */
import { supabase } from "../../supabase.js";
import { completeJson } from "../llm.js";
import { loadActiveProfile } from "../siteProfile.js";
import { getWhatsappSettings } from "../outreach/settings.js";
import { warmupCap, dailyAutoSendCount } from "./autoReply.js";
import { isQuietHours } from "./outbound.js";
import { sendText, simulateTyping } from "./session.js";
import { recordOutgoing } from "./store.js";

/** Hours after the anchor at which nudge 1, 2, 3 fire. */
export const FOLLOWUP_HOURS = [24, 90, 160] as const;
/** After all 3 nudges, a lead still silent this long past the anchor is marked lost. */
const LOST_AFTER_HOURS = 208; // 160 + a ~2-day grace
const FOLLOWUPS_PER_TENANT_PER_TICK = 2;

/** The pure schedule decision: given how many nudges have gone and how long since the anchor, do
 *  we send the next one, mark the lead lost, or do nothing yet? No DB, no clock — unit-tested. */
export function pickFollowup(done: number, hoursSinceAnchor: number): { action: "send" | "lost" | "none"; which?: 1 | 2 | 3 } {
  if (done >= FOLLOWUP_HOURS.length) {
    return hoursSinceAnchor >= LOST_AFTER_HOURS ? { action: "lost" } : { action: "none" };
  }
  if (hoursSinceAnchor >= FOLLOWUP_HOURS[done]) return { action: "send", which: (done + 1) as 1 | 2 | 3 };
  return { action: "none" };
}

type ThreadMsg = { direction: "in" | "out"; body: string };

/** Draft the nudge. Tone softens then bows out across the three: a light check-in, an offer to
 *  clarify, a last no-pressure touch. Grounded in the thread + Site Brain; short. */
async function draftFollowup(tenantId: string, leadId: string, which: 1 | 2 | 3): Promise<string> {
  const [{ data: lead }, { data: msgs }, profile] = await Promise.all([
    supabase.from("leads").select("company, name, reason, city").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("outreach_messages").select("direction, body, created_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: true }).limit(30),
    loadActiveProfile(tenantId),
  ]);
  const thread = (msgs ?? []) as ThreadMsg[];
  const p = profile?.profile;
  const business = [
    p?.what_they_do ? `What we do: ${p.what_they_do}` : "",
    p?.voice?.tone ? `Our tone: ${p.voice.tone}` : "",
  ].filter(Boolean).join("\n");
  const transcript = thread.map((m) => `${m.direction === "in" ? "THEM" : "US"}: ${String(m.body).replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
  const brief =
    which === 1 ? "A LIGHT check-in — they went quiet after our last message. One friendly line, no pressure."
    : which === 2 ? "A SECOND nudge — offer to clarify or answer anything holding them back. Still warm, still brief."
    : "A FINAL, no-pressure touch — let them know you'll leave it with them and they can reply any time. Graceful exit.";

  const prompt = [
    "You are writing a short WhatsApp FOLLOW-UP to a lead who stopped replying.",
    business ? `ABOUT US:\n${business}` : "",
    lead?.company ? `THE LEAD: ${lead.company}${lead.city ? `, ${lead.city}` : ""}` : "",
    "",
    "CONVERSATION SO FAR (oldest first):",
    transcript || "(our first message was sent; no reply yet)",
    "",
    `THIS FOLLOW-UP: ${brief}`,
    "Rules: 1 short line, no 'Dear', no signature, no re-pitching, match their language. Never invent a price/date.",
    'Reply with ONLY JSON: {"reply":"...your one line..."}',
  ].filter(Boolean).join("\n");

  const answer = await completeJson<{ reply?: string }>(prompt);
  return String(answer?.reply ?? "").trim().slice(0, 500);
}

async function lastMessageDirection(tenantId: string, leadId: string): Promise<"in" | "out" | null> {
  const { data } = await supabase.from("outreach_messages").select("direction").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = (data as any)?.direction;
  return d === "in" || d === "out" ? d : null;
}

/** One tenant's due follow-ups this tick (at most FOLLOWUPS_PER_TENANT_PER_TICK). Returns count sent. */
async function followupTenant(tenantId: string, nowMs: number): Promise<number> {
  const s = await getWhatsappSettings(tenantId);
  if (!s.auto_reply || !s.followups_enabled) return 0;
  if (isQuietHours(nowMs, s.tz_offset, s.send_start, s.send_end)) return 0;

  const { data: session } = await supabase.from("whatsapp_sessions").select("first_connected_at, status").eq("tenant_id", tenantId).maybeSingle();
  if ((session as any)?.status !== "connected") return 0;
  const cap = warmupCap((session as any)?.first_connected_at ? Date.parse((session as any).first_connected_at) : null, nowMs);
  let dailyCount = await dailyAutoSendCount(tenantId);
  if (dailyCount >= cap) return 0;

  // Candidates: engaged-or-contacted, not opted out, not under human handoff, nudges remaining.
  const { data: leads } = await supabase
    .from("leads")
    .select("id, stage, replied_at, contacted_at, auto_followups_done, auto_reply_paused_until, whatsapp, phone, opt_out")
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
    const anchorIso = l.replied_at ?? l.contacted_at;
    if (!anchorIso) continue;
    const hours = (nowMs - Date.parse(anchorIso)) / 3_600_000;
    const pick = pickFollowup(l.auto_followups_done ?? 0, hours);
    if (pick.action === "none") continue;

    if (pick.action === "lost") {
      await supabase.from("leads").update({ stage: "lost", updated_at: new Date().toISOString() }).eq("id", l.id).eq("tenant_id", tenantId).in("stage", ["contacted", "delivered", "read", "replied", "in_conversation", "interested"]);
      continue;
    }

    // Only nudge if WE spoke last (we're waiting on them). If their last message is inbound, the
    // reactive lane owns it — a follow-up would talk over an unanswered question.
    if ((await lastMessageDirection(tenantId, l.id)) !== "out") continue;

    const phone = l.whatsapp || l.phone || "";
    if (!phone) continue;
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
