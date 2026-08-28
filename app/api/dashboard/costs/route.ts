import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { getCostSummary } from "@/lib/dashboard-data";

/** MASTER_PLAN §13 Phase 4's "cost dashboard" exit criterion ("cost per article measured aur
 *  tier pricing se compare"). Real numbers from jobs_log.detail.cost (agent-server/src/
 *  lib/costLedger.ts), not a decorative figure — same "genuine Supabase data" rule
 *  /api/dashboard/stats already follows.
 *
 *  No UI page reads this yet — /app's reports/billing pages are still the pre-rebuild demo
 *  (client-side lib/store.tsx state, docs/MASTER_PLAN.html §23), and bolting a real number
 *  onto a page that fakes everything else around it would be more misleading than useful.
 *  This route is the capture layer's read side; wiring a real page to it is its own UI-rebuild
 *  task (§23), tracked there rather than pretended-done here. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const daysParam = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 90 ? daysParam : 7;

  const summary = await getCostSummary(supabase, tenantId, days);
  return NextResponse.json({ ok: true, days, ...summary });
}
