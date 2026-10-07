import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** Which of a batch of phone numbers are on WhatsApp — powers the green/red badge on every chat
 *  in the list, in one agent-server call. Returns { results: { "<phone>": true|false|null } }.
 *  null = unknown (not connected / check failed); the UI shows no badge then. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const phones = Array.isArray(body?.phones) ? body.phones.slice(0, 200) : [];
  const r = await callWhatsapp(tenantId, "check", { method: "POST", body: { phones } });
  return NextResponse.json({ ok: true, results: r.ok ? (r.results ?? {}) : {} });
}
