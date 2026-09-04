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

export async function GET(req: Request) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  // ?run=<id> — ONE older report's issue list, for the Compare Crawls tab (MASTER_PLAN §27.4,
  // Round A, 2026-09-05). Fetched on demand for the run the user picked, tenant-scoped like
  // everything else here; the history list above stays score-and-date only for the reason
  // in this file's own header. Issues come back without their page samples (`pages`) — the
  // diff is by check id and count, and 100 URLs × 70 checks for a run nobody is reading
  // page-by-page is weight for nothing.
  const runId = new URL(req.url).searchParams.get("run");
  if (runId) {
    const { data: row, error: runError } = await supabase
      .from("site_audits")
      .select("id, score, blocks, warns, pages_checked, issues, created_at, run->trigger")
      .eq("tenant_id", tenantId)
      .eq("id", runId)
      .maybeSingle();
    if (runError) {
      console.error("[site-audit] run read failed:", runError.message);
      return NextResponse.json({ ok: false, error: runError.message }, { status: 500 });
    }
    if (!row) return NextResponse.json({ ok: false, error: "No such audit run." }, { status: 404 });
    return NextResponse.json({
      ok: true,
      run: {
        id: String(row.id),
        score: Number(row.score) || 0,
        blocks: Number(row.blocks) || 0,
        warns: Number(row.warns) || 0,
        pagesChecked: Number(row.pages_checked) || 0,
        trigger: (row as any).trigger === "schedule" ? "schedule" : (row as any).trigger === "manual" ? "manual" : null,
        createdAt: String(row.created_at),
        issues: (Array.isArray(row.issues) ? row.issues : []).map((i: any) => ({
          id: String(i.id),
          severity: i.severity === "block" || i.severity === "warn" ? i.severity : "info",
          what: typeof i.what === "string" ? i.what : "",
          count: Number(i.count) || 0,
          category: typeof i.category === "string" ? i.category : null,
        })),
      },
    });
  }

  const [{ data: latest, error }, { data: history }] = await Promise.all([
    supabase
      .from("site_audits")
      .select("id, score, previous_score, pages_checked, blocks, warns, issues, run, summary, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // score/blocks/warns/pages_checked feed the Errors/Warnings trend charts and the history
    // table (manual vs scheduled, MASTER_PLAN 2026-09-05); `run->trigger` pulls just that one
    // key out of the jsonb column rather than the whole thing (`run.pages`/`run.performance`
    // can be large — a 20-row history has no reason to carry 20 of those).
    supabase
      .from("site_audits")
      .select("id, score, blocks, warns, pages_checked, created_at, run->trigger")
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
          // Real per-page crawl summary (status/redirect/response time/hasIssue/blocked) — the
          // Crawled Pages breakdown and the "see more" full-page popup both read this.
          pages: Array.isArray((latest.run as any)?.pages) ? (latest.run as any).pages : [],
          // The real domain audited — the report page's own big heading (2026-09-05, matching
          // Semrush's "Site Audit: domain.com"). Older rows have no `run.websiteUrl`; null then,
          // never guessed from something else on the row.
          websiteUrl: typeof (latest.run as any)?.websiteUrl === "string" ? (latest.run as any).websiteUrl : null,
          // Real robots.txt evaluation for named AI crawlers (agent-server/src/lib/audit/
          // robots.ts) — null when robots.txt could not be read, never an empty array standing
          // in for "everything's fine".
          aiSearch: Array.isArray((latest.run as any)?.aiSearch) ? (latest.run as any).aiSearch : null,
          // The full check catalogue that run could have made (id/category/severity) — the exact
          // denominator for thematic-report % rings. Empty on older rows; the page then says so
          // instead of computing a % over a denominator it does not have.
          catalogue: Array.isArray((latest.run as any)?.catalogue) ? (latest.run as any).catalogue : [],
          // Who asked for this run — a person ("manual") or the weekly scheduler ("schedule").
          // Older rows from before 2026-09-05 have no `run.trigger` at all; reported as null
          // rather than guessed.
          trigger: (latest.run as any)?.trigger === "schedule" ? "schedule" : (latest.run as any)?.trigger === "manual" ? "manual" : null,
          seconds: Number((latest.run as any)?.seconds) || null,
          summary: latest.summary ?? null,
          createdAt: latest.created_at,
        }
      : null,
    // Oldest first, so a chart can render it without reversing and a reader can read it.
    history: (history ?? [])
      .map((r: any) => ({
        id: String(r.id),
        score: Number(r.score) || 0,
        blocks: Number(r.blocks) || 0,
        warns: Number(r.warns) || 0,
        pagesChecked: Number(r.pages_checked) || 0,
        trigger: r.trigger === "schedule" ? "schedule" : r.trigger === "manual" ? "manual" : null,
        createdAt: String(r.created_at),
      }))
      .reverse(),
  });
}
