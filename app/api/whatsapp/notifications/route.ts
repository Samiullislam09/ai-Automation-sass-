import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** The dashboard bell feed (replies, meeting requests, hot leads). */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const r = await callWhatsapp(tenantId, "notifications", { method: "GET" });
  return NextResponse.json(r.ok ? { ok: true, items: r.items, unread: r.unread } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 500 });
}

/** Mark read: body { action:'read', id? } — a single id, or all unread when omitted. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const r = await callWhatsapp(tenantId, "notifications", { method: "POST", body });
  return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 500 });
}
