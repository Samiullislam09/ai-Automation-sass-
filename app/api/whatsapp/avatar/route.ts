import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** The real WhatsApp profile photo URL for a number (?phone=), proxied from agent-server. Returns
 *  { url: string | null } — null when the number has no visible photo, isn't on WhatsApp, or the
 *  session isn't connected. The UI shows its default avatar then. Never errors the UI. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const phone = req.nextUrl.searchParams.get("phone") ?? "";
  if (!phone) return NextResponse.json({ ok: true, url: null });

  const r = await callWhatsapp(tenantId, "avatar", { query: `phone=${encodeURIComponent(phone)}` });
  return NextResponse.json({ ok: true, url: r.ok ? (r.url ?? null) : null, onWhatsapp: r.ok ? (r.onWhatsapp ?? null) : null });
}
