import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** Ask Mr. Brain for a suggested reply to a conversation. Returns text only — the human still
 *  sends it from the compose box. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body?.leadId) return NextResponse.json({ ok: false, error: "leadId is required." }, { status: 400 });
  const r = await callWhatsapp(tenantId, "suggest", { method: "POST", body: { leadId: body.leadId } });
  return NextResponse.json(r, { status: r.ok ? 200 : r.status ?? 500 });
}
