import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { AGENTS } from "@/lib/store";

/** Real stat-card numbers for the dashboard — replaces the old demo's made-up figures.
 *  Everything here is a genuine count from Supabase (content_items, jobs_log, site_pages),
 *  not a fake/decorative number. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [{ count: awaiting }, { count: published }, { count: pagesIndexed }, { data: todayJobs }] = await Promise.all([
    supabase.from("content_items").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "awaiting_approval"),
    supabase.from("content_items").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "published"),
    supabase.from("site_pages").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("jobs_log").select("status").eq("tenant_id", tenantId).gte("created_at", startOfDay.toISOString()),
  ]);

  const jobs = todayJobs ?? [];
  const errors = jobs.filter((j) => j.status === "error").length;
  const successes = jobs.filter((j) => j.status === "success").length;
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const successRate = successes + errors > 0 ? Math.round((successes / (successes + errors)) * 100) : 100;

  return NextResponse.json({
    ok: true,
    totalAgents: AGENTS.length,
    liveAgents: AGENTS.filter((a) => a.live).length,
    working: running,
    waiting: awaiting ?? 0,
    errorsToday: errors,
    tasksCompleted: published ?? 0,
    successRate,
    pagesIndexed: pagesIndexed ?? 0,
  });
}
