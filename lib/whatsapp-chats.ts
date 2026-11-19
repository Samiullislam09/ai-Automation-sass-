import type { SupabaseClient } from "@supabase/supabase-js";
import { analyseNumber } from "@/lib/phone-wa";

/** The WhatsApp chat list's data: the leads that have a conversation, the last message of each and the unread counts.
 *  Used by BOTH app/api/whatsapp/chats/route.ts (refresh + polling, adds the ETag) and app/dashboard/(app)/whatsapp/page.tsx (read on the server so the page arrives with its chats). */

// EVERY stage a conversation can be in. meeting_requested / meeting_scheduled / meeting_done / ready_to_buy were missing, so the moment a
// customer asked for a call the assistant moved the lead to meeting_requested and the chat VANISHED from this list (the owner's
// "sainul wala nahi aa raha", 2026-11-16) — the most valuable chats were the ones hidden. opted_out stays visible too: a manager must be
// able to read why someone was marked do-not-contact.
const CHAT_STAGES = ["approved", "contacted", "delivered", "read", "replied", "in_conversation", "interested", "meeting_requested", "meeting_scheduled", "meeting_done", "ready_to_buy", "won", "lost", "opted_out"];
const COLUMNS = [
  "id", "company", "name", "whatsapp", "phone", "stage", "icp_score", "draft", "email", "website", "country", "city",
  "source", "reason", "created_at", "classification", "needs_attention", "needs_attention_reason", "last_intent",
].join(", ");


export type ChatsResult = { items: any[]; inbox: any[] } | { error: string };

export async function loadChats(supabase: SupabaseClient | any, tenantId: string, wanted: string | null = null): Promise<ChatsResult> {
  const [leadsRes, msgsRes, wantedRes] = await Promise.all([
    supabase.from("leads").select(COLUMNS).eq("tenant_id", tenantId).in("stage", CHAT_STAGES).order("created_at", { ascending: false }).limit(300),
    supabase.from("outreach_messages").select("lead_id, direction, status, body, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(400),
    wanted ? supabase.from("leads").select(COLUMNS).eq("tenant_id", tenantId).eq("id", wanted).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (leadsRes.error) return { error: leadsRes.error.message };

  const leads = ((leadsRes.data ?? []) as unknown as { id: string }[]).slice();
  const extra = wantedRes.data as { id: string } | null;
  if (extra && !leads.some((l) => l.id === extra.id)) leads.push(extra);

  // Per lead: the last message and `unanswered` (their messages newer than our last outgoing). Rows are
  // newest-first, so the first row per lead is the last message, and we count leading "in" rows until an "out".
  const byLead = new Map<string, { last: any; unanswered: number; done: boolean; replied: boolean }>();
  for (const m of msgsRes.data ?? []) {
    if (!m.lead_id) continue;
    let e = byLead.get(m.lead_id);
    if (!e) { e = { last: m, unanswered: 0, done: false, replied: false }; byLead.set(m.lead_id, e); }
    if (m.direction === "in") e.replied = true; // they have written to us at some point: that number is plainly reachable
    if (e.done) continue;
    if (m.direction === "in") e.unanswered += 1; else e.done = true;
  }
  const inbox = Array.from(byLead.entries()).map(([lead_id, e]) => ({
    lead_id, body: String(e.last.body ?? "").slice(0, 160), direction: e.last.direction, status: e.last.status, created_at: e.last.created_at, unanswered: e.unanswered, replied: e.replied,
  }));

  // The number to SHOW and dial: international digits made from the lead's country ("0504608157" + United Arab
  // Emirates -> 971504608157). Computed here so the browser does not need the phone-number library.
  const withDial = (leads as unknown as { id: string; phone?: string | null; whatsapp?: string | null; country?: string | null }[]).map((l) => {
    const wa = String(l.whatsapp ?? "").replace(/[^\d]/g, "");
    return { ...l, dial: wa.length >= 8 ? wa : analyseNumber(l.phone, l.country).digits };
  });

  return { items: withDial, inbox };
}
