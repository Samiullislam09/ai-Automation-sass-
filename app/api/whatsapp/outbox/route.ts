import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** The outbound timeline: upcoming cold first-messages, soonest first (read-only view). */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const r = await callWhatsapp(tenantId, "outbox", { method: "GET" });
  return NextResponse.json(r.ok ? { ok: true, items: r.items, pending: r.pending } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 500 });
}

/** Cancel one lead's scheduled send: body { action:'cancel', id }. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const r = await callWhatsapp(tenantId, "outbox", { method: "POST", body });
  return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 500 });
}
