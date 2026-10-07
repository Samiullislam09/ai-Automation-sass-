import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { loadGoogle, accessTokenFor, cancelMeetEvent } from "@/lib/google";

/** §29.6 (P9) — cancel a scheduled meeting from the dashboard. Cancels the Google Calendar event
 *  (best effort), marks the lead_meetings row cancelled, and moves the lead back to in_conversation
 *  so it isn't stuck at "meeting set". Cookie-authenticated (an admin action). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  if (body?.action !== "cancel" || !body?.meetingId) {
    return NextResponse.json({ ok: false, error: "action:'cancel' and meetingId are required" }, { status: 400 });
  }

  const { data: meeting } = await supabase
    .from("lead_meetings")
    .select("id, lead_id, calendar_event_id, status")
    .eq("tenant_id", tenantId)
    .eq("id", String(body.meetingId))
    .maybeSingle();
  if (!meeting) return NextResponse.json({ ok: false, error: "Meeting not found." }, { status: 404 });

  // Cancel the Google event if one exists — best effort, never blocks the local cancel.
  if ((meeting as any).calendar_event_id) {
    try {
      const creds = await loadGoogle(supabase, tenantId);
      if (creds) await cancelMeetEvent(await accessTokenFor(creds), (meeting as any).calendar_event_id);
    } catch { /* the local cancel below is what matters to the UI */ }
  }

  await supabase.from("lead_meetings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", (meeting as any).id).eq("tenant_id", tenantId);
  await supabase.from("leads").update({ stage: "in_conversation", updated_at: new Date().toISOString() }).eq("id", (meeting as any).lead_id).eq("tenant_id", tenantId).in("stage", ["meeting_requested", "meeting_scheduled"]);

  return NextResponse.json({ ok: true });
}
