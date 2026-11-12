import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** GET /api/whatsapp/activity — what Mr. WhatsApp is doing right now (queue, who is next, who is held and why,
 *  the 24-hour timeline). Built on agent-server from the real tables; the member must own the tenant. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  // ?full=1 is the "Show all" button: every upcoming item instead of the first few.
  const full = req.nextUrl.searchParams.get("full") === "1";
  const r = await callWhatsapp(tenantId, "activity", full ? { query: "full=1" } : {});
  return NextResponse.json(r, { status: r.ok ? 200 : r.status ?? 500, headers: { "Cache-Control": "private, no-store" } });
}
