import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Mr. Audit's reports, read by the Site audit page (MASTER_PLAN §7.4).
 *
 *  Read-only. Starting an audit goes through /api/agents/trigger like every other agent, so
 *  there is one path to the queue rather than a second one that has to learn the token, the
 *  tenant scoping and the cap all over again.
 *
 *  The newest report comes back whole — it is what the page renders — and the rest come back
 *  as score + date only, which is everything a trend line needs and nothing it doesn't. A
 *  history endpoint that ships fifty reports' worth of issue lists to draw a sparkline is how
 *  a page ends up taking four seconds to open.
 */

export const dynamic = "force-dynamic";

const MISSING_TABLE = "42P01";

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const [{ data: latest, error }, { data: history }] = await Promise.all([
    supabase
      .from("site_audits")
      .select("id, score, previous_score, pages_checked, blocks, warns, issues, run, summary, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("site_audits")
      .select("id, score, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // 020 not applied yet is a fact about the database, not a broken page — the same handling
  // the Site Brain route gives 019.
  if (error && (error as any).code === MISSING_TABLE) {
    return NextResponse.json({ ok: true, schemaReady: false, latest: null, history: [] });
  }
  if (error) {
    console.error("[site-audit] read failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    schemaReady: true,
    latest: latest
      ? {
          id: String(latest.id),
          score: Number(latest.score) || 0,
          previousScore: latest.previous_score === null ? null : Number(latest.previous_score),
          pagesChecked: Number(latest.pages_checked) || 0,
          blocks: Number(latest.blocks) || 0,
          warns: Number(latest.warns) || 0,
          issues: Array.isArray(latest.issues) ? latest.issues : [],
          skipped: Array.isArray((latest.run as any)?.skipped) ? (latest.run as any).skipped : [],
          // Real Lighthouse results (agent-server/src/lib/audit/performance.ts) — already
          // stored in `run.performance` since that file shipped, never surfaced here until now.
          performance: Array.isArray((latest.run as any)?.performance) ? (latest.run as any).performance : [],
          seconds: Number((latest.run as any)?.seconds) || null,
          summary: latest.summary ?? null,
          createdAt: latest.created_at,
        }
      : null,
    // Oldest first, so a chart can render it without reversing and a reader can read it.
    history: (history ?? [])
      .map((r: any) => ({ id: String(r.id), score: Number(r.score) || 0, createdAt: String(r.created_at) }))
      .reverse(),
  });
}
