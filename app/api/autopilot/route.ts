import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { loadAutopilotInputs, shapeAutopilot } from "@/lib/chat-lead-tools";
import { applyAutopilot, cleanPatch, summariseAutopilot } from "@/lib/autopilot";

/** GET /api/autopilot — the whole lead chain as one picture: each step on/off, what is connected, how many leads sit where, what is missing, and the settings.
 *  POST /api/autopilot — switch it or tune it ({ on, leads_per_day, run_time, send_start, send_end, followups, reminders, daily_summary, auto_replies }).
 *  The same functions the chat's manage_autopilot tool uses, so the page and the chat can never disagree. */
export const dynamic = "force-dynamic";

async function who() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return { supabase, tenantId };
}

export async function GET() {
  const { supabase, tenantId } = await who();
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const inputs = await loadAutopilotInputs(supabase, tenantId);
  return NextResponse.json({ ok: true, autopilot: shapeAutopilot(inputs), settings: summariseAutopilot(inputs) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const { supabase, tenantId } = await who();
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const cleaned = cleanPatch(body && typeof body === "object" ? body : {});
  if ("error" in cleaned) return NextResponse.json({ ok: false, error: cleaned.error }, { status: 400 });
  if (Object.keys(cleaned.patch).length === 0) return NextResponse.json({ ok: false, error: "Nothing to change." }, { status: 400 });
  const result = await applyAutopilot(supabase, tenantId, cleaned.patch);
  const inputs = await loadAutopilotInputs(supabase, tenantId);
  return NextResponse.json({ ok: result.ok, result, autopilot: shapeAutopilot(inputs), settings: summariseAutopilot(inputs), error: result.ok ? undefined : result.verdict }, { status: result.ok ? 200 : 502 });
}
