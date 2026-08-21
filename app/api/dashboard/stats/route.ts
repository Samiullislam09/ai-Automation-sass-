import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { getDashboardStats } from "@/lib/dashboard-data";

/** Real stat-card numbers for the dashboard — replaces the old demo's made-up figures.
 *  Everything here is a genuine count from Supabase (content_items, jobs_log, site_pages),
 *  not a fake/decorative number. Query logic lives in lib/dashboard-data.ts, shared with
 *  /api/dashboard/live so the pixel scene and these cards never disagree. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const stats = await getDashboardStats(supabase, tenantId);
  return NextResponse.json({ ok: true, ...stats });
}
