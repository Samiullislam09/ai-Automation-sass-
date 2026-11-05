import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/supabase/request";
import { listReportItems } from "@/lib/reports-data";

export const dynamic = "force-dynamic";

/** The Reports pages' content rows (slim — see lib/reports-data.ts). Used for refresh; the first
 *  paint reads the same function on the server. */
export async function GET() {
  const { supabase, tenantId } = await getRequestContext();
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { items, truncated, error } = await listReportItems(supabase, tenantId);
  if (error) return NextResponse.json({ ok: false, error }, { status: 500 });
  return NextResponse.json({ ok: true, items, truncated });
}
