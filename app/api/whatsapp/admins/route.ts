import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** The alert team — owner + managers whose WhatsApp numbers get meeting / hot-lead pings. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const r = await callWhatsapp(tenantId, "admins", { method: "GET" });
  return NextResponse.json(r.ok ? { ok: true, admins: r.admins } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 500 });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const r = await callWhatsapp(tenantId, "admins", { method: "POST", body });
  return NextResponse.json(r.ok ? { ok: true, admin: r.admin } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 500 });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const r = await callWhatsapp(tenantId, "admins", { method: "DELETE", query: `id=${encodeURIComponent(id)}` });
  return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 500 });
}
