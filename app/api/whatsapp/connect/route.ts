import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** Start pairing this workspace's WhatsApp. The member must own the tenant; the token is added
 *  server-side by callWhatsapp and never reaches the browser. */
export async function POST() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const r = await callWhatsapp(tenantId, "connect");
  return NextResponse.json(r, { status: r.ok ? 200 : r.status ?? 500 });
}
