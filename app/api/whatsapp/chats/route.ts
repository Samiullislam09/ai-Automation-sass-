import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** GET /api/whatsapp/chats — everything the WhatsApp page's chat list needs, in ONE round trip.
 *
 *  The page used to call /api/leads (select("*") of 200 leads, drafts, evidence and score breakdowns
 *  included: kilobytes a row that a chat list never shows) and then /api/whatsapp/messages, one after
 *  the other. Now: the chat-list columns only, the last message per lead and the unread counts, both read
 *  at the same time, with an ETag so an unchanged inbox comes back as an empty 304. The heavy fields load
 *  for ONE lead when its details panel opens (GET /api/leads/[id]).
 *
 *  ?lead=<id> also returns that lead even if it is not in a chat stage yet (the WhatsApp button on the
 *  Leads page deep-links to a lead that is only approved). */

const CHAT_STAGES = ["approved", "contacted", "delivered", "read", "replied", "in_conversation", "interested", "won", "lost"];
const COLUMNS = [
  "id", "company", "name", "whatsapp", "phone", "stage", "icp_score", "draft", "email", "website", "country", "city",
  "source", "reason", "created_at", "classification", "needs_attention", "needs_attention_reason", "last_intent",
].join(", ");

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const wanted = req.nextUrl.searchParams.get("lead");

  const [leadsRes, msgsRes, wantedRes] = await Promise.all([
    supabase.from("leads").select(COLUMNS).eq("tenant_id", tenantId).in("stage", CHAT_STAGES).order("created_at", { ascending: false }).limit(300),
    supabase.from("outreach_messages").select("lead_id, direction, status, body, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(400),
    wanted ? supabase.from("leads").select(COLUMNS).eq("tenant_id", tenantId).eq("id", wanted).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (leadsRes.error) return NextResponse.json({ ok: false, error: leadsRes.error.message }, { status: 500 });

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

  const body = JSON.stringify({ ok: true, items: leads, inbox });
  const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 27)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}
