import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** GET /api/whatsapp/log — the live log: every message and decision of the AI, newest first (?lead=, ?before=, ?limit=). */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  for (const k of ["lead", "before", "limit", "kind"]) { const v = sp.get(k); if (v) q.set(k, v); }
  const r = await callWhatsapp(tenantId, "log", q.toString() ? { query: q.toString() } : {});
  return NextResponse.json(r, { status: r.ok ? 200 : r.status ?? 500, headers: { "Cache-Control": "private, no-store" } });
}
