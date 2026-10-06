import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Read outreach traffic. With ?leadId= it returns that lead's full thread (both directions,
 *  oldest first — a chat). Without it, the inbox: the most recent message per lead, newest
 *  first, so the UI can show a WhatsApp-style conversation list. RLS scopes both to the tenant. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const leadId = req.nextUrl.searchParams.get("leadId");

  if (leadId) {
    const { data, error } = await supabase
      .from("outreach_messages")
      .select("id, direction, status, body, answered_by, created_at, sent_at, delivered_at, read_at")
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, thread: data });
  }

  // Inbox: pull recent messages and fold to one-per-lead in code (PostgREST has no DISTINCT ON).
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("lead_id, direction, status, body, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Per lead: the last message (for the preview + ordering), and `unanswered` — how many of their
  // incoming messages are newer than our last outgoing (the WhatsApp-style unread count that
  // clears the moment you reply). Messages come newest-first, so the first row per lead is the
  // last message, and we count leading "in" rows until an "out" appears.
  const byLead = new Map<string, { last: any; unanswered: number; done: boolean }>();
  for (const m of data ?? []) {
    if (!m.lead_id) continue;
    let e = byLead.get(m.lead_id);
    if (!e) { e = { last: m, unanswered: 0, done: false }; byLead.set(m.lead_id, e); }
    if (e.done) continue;
    if (m.direction === "in") e.unanswered += 1;
    else e.done = true; // reached our last outgoing — stop counting
  }
  const inbox = Array.from(byLead.entries()).map(([lead_id, e]) => ({
    lead_id,
    body: e.last.body,
    direction: e.last.direction,
    status: e.last.status,
    created_at: e.last.created_at,
    unanswered: e.unanswered,
  }));
  return NextResponse.json({ ok: true, inbox });
}
