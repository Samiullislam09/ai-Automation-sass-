import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { loadGoogle, accessTokenFor, freeBusySlots, createMeetEvent, cancelMeetEvent, SCOPE_CALENDAR } from "@/lib/google";

/** §29.6 (P7) — Google Calendar for WhatsApp meetings. The web app owns this because only it can
 *  decrypt the Google refresh token; the agent-server worker reaches it with the shared agent token
 *  (same pattern as /api/integrations/google/sync), and the dashboard UI uses the signed-in cookie.
 *
 *  Actions (POST body { action }):
 *   · "freebusy" { tzOffset, sendStart, sendEnd, durationMin?, want? } → { slots:[{start,end}] }
 *   · "book"     { startIso, endIso, tzOffset, summary, description? } → { eventId, meetLink, htmlLink }
 *   · "cancel"   { eventId } → { ok }
 *  Returns { ok:false, error, code } with code "not_connected" | "no_scope" | "token" so the caller
 *  can degrade gracefully (fall back to a manual, admin-scheduled meeting). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));

  const machineToken = req.headers.get("x-agent-token");
  let supabase: SupabaseClient;
  let tenantId: string | null;
  if (machineToken) {
    if (!process.env.AGENT_SERVER_TOKEN || machineToken !== process.env.AGENT_SERVER_TOKEN) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    supabase = createAdminClient();
    tenantId = typeof body?.tenantId === "string" ? body.tenantId : null;
    if (!tenantId) return NextResponse.json({ ok: false, error: "tenantId is required" }, { status: 400 });
  } else {
    supabase = await createClient();
    tenantId = await getCurrentTenantId(supabase);
    if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const creds = await loadGoogle(supabase, tenantId);
  if (!creds) return NextResponse.json({ ok: false, error: "Google is not connected.", code: "not_connected" }, { status: 400 });
  if (!(creds.scopes ?? []).includes(SCOPE_CALENDAR)) {
    return NextResponse.json({ ok: false, error: "Reconnect Google to allow Calendar access.", code: "no_scope" }, { status: 400 });
  }

  let token: string;
  try {
    token = await accessTokenFor(creds);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Google token refresh failed: ${e?.message}`, code: "token" }, { status: 502 });
  }

  try {
    if (body.action === "freebusy") {
      const slots = await freeBusySlots(token, {
        tzOffset: Number(body.tzOffset ?? 4),
        sendStart: Number(body.sendStart ?? 9),
        sendEnd: Number(body.sendEnd ?? 21),
        durationMin: Number(body.durationMin ?? 30),
        want: Number(body.want ?? 3),
      });
      return NextResponse.json({ ok: true, slots });
    }
    if (body.action === "book") {
      if (!body.startIso || !body.endIso) return NextResponse.json({ ok: false, error: "startIso and endIso are required" }, { status: 400 });
      const r = await createMeetEvent(token, { startIso: body.startIso, endIso: body.endIso, tzOffset: Number(body.tzOffset ?? 4), summary: String(body.summary ?? "Meeting"), description: body.description });
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "cancel") {
      if (!body.eventId) return NextResponse.json({ ok: false, error: "eventId is required" }, { status: 400 });
      await cancelMeetEvent(token, String(body.eventId));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Calendar request failed", code: "calendar" }, { status: 502 });
  }
}
