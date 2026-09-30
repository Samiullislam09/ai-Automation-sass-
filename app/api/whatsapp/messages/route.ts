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

  const seen = new Set<string>();
  const inbox: any[] = [];
  for (const m of data ?? []) {
    if (!m.lead_id || seen.has(m.lead_id)) continue;
    seen.add(m.lead_id);
    inbox.push(m);
  }
  return NextResponse.json({ ok: true, inbox });
}
