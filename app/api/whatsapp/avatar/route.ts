import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";
import { analyseNumber } from "@/lib/phone-wa";

/** The real WhatsApp profile photo URL for a number (?phone=), proxied from agent-server. Returns
 *  { url: string | null } — null when the number has no visible photo, isn't on WhatsApp, or the
 *  session isn't connected. The UI shows its default avatar then. Never errors the UI. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let phone = req.nextUrl.searchParams.get("phone") ?? "";
  // By lead id: use the lead's country to make a local number dialable. Looking up the raw digits ("0504608157")
  // asked WhatsApp about a number that does not exist, so a perfectly good chat was labelled "Not on WhatsApp".
  const leadId = req.nextUrl.searchParams.get("leadId");
  if (leadId) {
    const { data: lead } = await supabase.from("leads").select("phone, whatsapp, country").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle();
    const wa = String((lead as any)?.whatsapp ?? "").replace(/[^\d]/g, "");
    const digits = wa.length >= 8 ? wa : analyseNumber((lead as any)?.phone, (lead as any)?.country).digits;
    if (!digits) return NextResponse.json({ ok: true, url: null, onWhatsapp: null }); // cannot tell: say nothing rather than guess "no"
    phone = digits;
  }
  if (!phone) return NextResponse.json({ ok: true, url: null });

  const r = await callWhatsapp(tenantId, "avatar", { query: `phone=${encodeURIComponent(phone)}` });
  return NextResponse.json({ ok: true, url: r.ok ? (r.url ?? null) : null, onWhatsapp: r.ok ? (r.onWhatsapp ?? null) : null });
}
