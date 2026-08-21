import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { getDashboardStats, getAgentRoomStates } from "@/lib/dashboard-data";
import { AGENTS as STORE_AGENTS } from "@/lib/store";

/** Powers the AI Command Center pixel scene — the ONLY source of truth for what animates
 *  in the office. No random/demo loop: the client polls this on an interval and diffs
 *  `jobs` + `contentItems` against what it saw last poll to decide which real event just
 *  happened (a job started/finished/errored, an article went to review or got published),
 *  then calls window.engine.startWork/completeWork/incident for that one room. See the
 *  [BACKEND-EVENTS] comment inside components/dashboard/AICommandCenter.tsx. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const since = req.nextUrl.searchParams.get("since");
  const sinceIso = since && !isNaN(Date.parse(since)) ? since : new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const [rooms, stats, { data: jobs }, { data: contentItems }, { data: pendingItems }] = await Promise.all([
    getAgentRoomStates(supabase, tenantId),
    getDashboardStats(supabase, tenantId),
    supabase.from("jobs_log").select("id, agent, status, created_at").eq("tenant_id", tenantId).gte("created_at", sinceIso).order("created_at", { ascending: true }).limit(40),
    supabase.from("content_items").select("id, status, title, type, updated_at").eq("tenant_id", tenantId).gte("updated_at", sinceIso).order("updated_at", { ascending: true }).limit(40),
    supabase.from("content_items").select("id, title, type, created_at").eq("tenant_id", tenantId).eq("status", "awaiting_approval").order("created_at", { ascending: false }).limit(5),
  ]);

  // Donut breakdown — real content_items lifecycle counts, mapped onto the reference card's
  // 4 legend buckets (draft="in progress", awaiting_approval="review", published="waiting"
  // isn't quite right semantically, so: draft/awaiting_approval/published/failed).
  const { data: allStatuses } = await supabase.from("content_items").select("status").eq("tenant_id", tenantId);
  const counts = { draft: 0, awaiting_approval: 0, published: 0, failed: 0, rejected: 0 };
  for (const c of allStatuses ?? []) if (c.status in counts) (counts as any)[c.status]++;
  const donutTotal = counts.draft + counts.awaiting_approval + counts.published + counts.failed;

  // Recent real activity for the feed card's initial hydrate (published or failed = "done").
  const { data: recentDone } = await supabase
    .from("content_items")
    .select("title, type, status, updated_at")
    .eq("tenant_id", tenantId)
    .in("status", ["published", "failed", "awaiting_approval"])
    .order("updated_at", { ascending: false })
    .limit(5);

  // NOTE: plan (free/starter/growth) isn't a real DB column yet — it's still client-side-only
  // demo state in lib/store.tsx (applyPlan() is explicitly marked TODO(backend): Paddle/
  // LemonSqueezy webhook). The client already has its own plan name via useStore(); this
  // endpoint only supplies the parts that ARE real: live-agent capacity + crawl coverage.

  return NextResponse.json({
    ok: true,
    serverTime: new Date().toISOString(),
    agentStates: rooms,
    jobs: jobs ?? [],
    contentEvents: contentItems ?? [],
    pending: (pendingItems ?? []).map((p) => ({ id: p.id, title: p.title ?? p.type, createdAt: p.created_at })),
    feed: (recentDone ?? []).map((r) => ({ title: r.title ?? r.type, status: r.status, at: r.updated_at })),
    donut: { inProgress: counts.draft, review: counts.awaiting_approval, published: counts.published, error: counts.failed, total: donutTotal },
    stats,
    capacity: { liveAgents: STORE_AGENTS.filter((a) => a.live).length, totalAgents: STORE_AGENTS.length, pagesIndexed: stats.pagesIndexed },
  });
}
