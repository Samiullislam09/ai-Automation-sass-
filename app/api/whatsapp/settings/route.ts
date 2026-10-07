import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** WhatsApp engine settings (auto-reply master + outbound timeline knobs + quiet hours). */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const r = await callWhatsapp(tenantId, "settings", { method: "GET" });
  return NextResponse.json(r.ok ? { ok: true, settings: r.settings } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 500 });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const r = await callWhatsapp(tenantId, "settings", { method: "POST", body });
  return NextResponse.json(r.ok ? { ok: true, settings: r.settings } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 500 });
}
