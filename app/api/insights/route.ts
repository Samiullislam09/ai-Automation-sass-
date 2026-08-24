import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** What the team actually knows about this site's performance, for the Memory page.
 *
 *  Same shaping the agents use (agent-server/src/lib/insights.ts) — deliberately kept in
 *  step so the page shows the very rows Mr Lxwa plans from, not a prettier parallel view.
 *  Read-only, and it never fills a gap with an estimate: no Google connection means empty
 *  arrays and `connected: false`, which the page states plainly. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from("site_insights")
    .select("source, kind, key, metrics, period_start, period_end, captured_at")
    .eq("tenant_id", tenantId);

  if (error) {
    return NextResponse.json({ ok: true, connected: false, needsMigration: /site_insights/i.test(error.message), error: error.message });
  }
  if (!data?.length) return NextResponse.json({ ok: true, connected: false });

  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const queries = data
    .filter((r) => r.source === "gsc" && r.kind === "query")
    .map((r: any) => ({
      query: r.key,
      clicks: num(r.metrics?.clicks),
      impressions: num(r.metrics?.impressions),
      position: num(r.metrics?.position),
    }));

  const summary: any = data.find((r) => r.source === "ga4" && r.kind === "summary");
  const location: any = data.find((r) => r.source === "gbp" && r.kind === "location");

  return NextResponse.json({
    ok: true,
    connected: true,
    period: { start: data[0]?.period_start ?? null, end: data[0]?.period_end ?? null },
    capturedAt: data[0]?.captured_at ?? null,
    totals: {
      queries: queries.length,
      pages: data.filter((r) => r.kind === "page").length,
    },
    winning: queries.filter((q) => q.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 10),
    // The list that drives topic planning: real impressions, ranked just off the first page.
    strikingDistance: queries
      .filter((q) => q.position >= 5 && q.position <= 25 && q.impressions >= 20)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10),
    missed: queries
      .filter((q) => q.impressions >= 100 && q.clicks / Math.max(q.impressions, 1) < 0.01)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 6),
    topPages: data
      .filter((r) => r.source === "gsc" && r.kind === "page")
      .map((r: any) => ({ url: r.key, clicks: num(r.metrics?.clicks), impressions: num(r.metrics?.impressions) }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10),
    traffic: summary
      ? { sessions: num(summary.metrics?.sessions), users: num(summary.metrics?.users), pageViews: num(summary.metrics?.pageViews) }
      : null,
    location: location ? { title: location.metrics?.title ?? "", address: location.metrics?.address ?? null } : null,
  });
}
