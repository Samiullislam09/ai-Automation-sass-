import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** What the Site Brain run is doing RIGHT NOW, for the progress bar on /dashboard/site-brain.
 *
 *  Filling the brain is two jobs, not one: the crawler reads the website
 *  (agent-server/src/agents/crawler.ts) and then enqueues the analyst
 *  (agents/crawler.ts → `enqueue("analyst", …)`), which turns those pages into the profile. So
 *  this returns BOTH rows and lets the page draw one bar across the pair — otherwise the bar
 *  would appear to finish at "summarising" and then sit there for another two minutes while
 *  the analyst thinks.
 *
 *  Same source and same rules as /api/site-audit/status: jobs_log's own row, written by
 *  workers.ts (start → throttled `detail.progress` → success/error with a diagnosable detail).
 *  Nothing is invented here — if a job is not in jobs_log it is not running, and `stalled` is
 *  derived from the last progress write rather than stored. */

export const dynamic = "force-dynamic";

// The analyst's slowest step is one LLM call per Search Console query; the crawler's is one
// page fetch. Neither should go quiet for twelve minutes — that is a run that died holding
// its "running" row, which is exactly what the Audit page's STALL_MS was added for.
const STALL_MS = 12 * 60_000;

type Agent = "crawler" | "analyst";

function shape(row: any) {
  const d = (row.detail ?? {}) as any;
  const p = (d.progress ?? {}) as any;
  const status: string = row.status;
  const lastWriteAt = typeof p.at === "string" ? Date.parse(p.at) : Date.parse(String(row.created_at));
  const stalled = status === "running" && Number.isFinite(lastWriteAt) && Date.now() - lastWriteAt > STALL_MS;
  return {
    id: String(row.id),
    status,
    action: String(row.action ?? ""),
    createdAt: String(row.created_at),
    stalled,
    progress: {
      phase: typeof p.phase === "string" ? p.phase : null,
      label: typeof p.label === "string" ? p.label : null,
      done: typeof p.done === "number" ? p.done : null,
      total: typeof p.total === "number" ? p.total : null,
      current: typeof p.current === "string" ? p.current : null,
      at: typeof p.at === "string" ? p.at : null,
    },
    // Only on a failed row — workers.ts's explainAgentError shape, verbatim.
    error:
      status === "error" || status === "skipped"
        ? {
            message: typeof d.message === "string" ? d.message : "The run failed.",
            cause: typeof d.cause === "string" ? d.cause : null,
            hint: typeof d.hint === "string" ? d.hint : null,
            attempt: typeof d.attempt === "number" ? d.attempt : null,
            attempts: typeof d.attempts === "number" ? d.attempts : null,
            durationMs: typeof d.durationMs === "number" ? d.durationMs : null,
          }
        : null,
  };
}

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const agents: Agent[] = ["crawler", "analyst"];
  const rows = await Promise.all(
    agents.map((agent) =>
      supabase
        .from("jobs_log")
        .select("id, status, action, created_at, detail")
        .eq("tenant_id", tenantId)
        .eq("agent", agent)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    )
  );

  const failed = rows.find((r) => r.error);
  if (failed?.error) {
    console.error("[site-brain/status] read failed:", failed.error.message);
    return NextResponse.json({ ok: false, error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    jobs: {
      crawler: rows[0].data ? shape(rows[0].data) : null,
      analyst: rows[1].data ? shape(rows[1].data) : null,
    },
  });
}
