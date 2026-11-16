import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** GET /api/whatsapp/calendar-check — can the assistant really book a Google Meet? The agent server asks Google (through this app) for free
 *  slots and returns { working, code, message }: the message says exactly what to fix when it is not working. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const r = await callWhatsapp(tenantId, "calendar-check", {});
  return NextResponse.json(r, { status: r.ok ? 200 : r.status ?? 500, headers: { "Cache-Control": "private, no-store" } });
}
