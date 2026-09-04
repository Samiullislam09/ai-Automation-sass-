import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** What Mr. Audit is doing RIGHT NOW, for the Audit page's progress bar and its error card
 *  (MASTER_PLAN §7.4, owner 2026-09-04: "real progress bar", "proper error logs").
 *
 *  Read straight from jobs_log — the same row agent-server/src/workers.ts writes for every job
 *  (start → throttled `detail.progress` updates → success/error with a diagnosable detail). No
 *  second bookkeeping: if the job is not in jobs_log it is not running, and if it failed the
 *  sentence a person can act on is already in `detail.message/cause/hint`.
 *
 *  `stalled` is derived, not stored: a "running" row whose last progress write (`progress.at`,
 *  agents/audit.ts stamps it) is older than STALL_MS is a run that stopped answering — the
 *  exact shape of the 2026-09-04 Lighthouse hang, which left rows in "running" forever. */

export const dynamic = "force-dynamic";

const STALL_MS = 12 * 60_000;

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data: row, error } = await supabase
    .from("jobs_log")
    .select("id, status, action, created_at, detail")
    .eq("tenant_id", tenantId)
    .eq("agent", "audit")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[site-audit/status] read failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ ok: true, job: null });

  const d = (row.detail ?? {}) as any;
  const p = (d.progress ?? {}) as any;
  const status: string = row.status;
  const lastWriteAt = typeof p.at === "string" ? Date.parse(p.at) : Date.parse(String(row.created_at));
  const stalled = status === "running" && Number.isFinite(lastWriteAt) && Date.now() - lastWriteAt > STALL_MS;

  return NextResponse.json({
    ok: true,
    job: {
      id: String(row.id),
      status,
      action: String(row.action ?? "audit"),
      createdAt: String(row.created_at),
      stalled,
      progress: {
        phase: typeof p.phase === "string" ? p.phase : null,
        label: typeof p.label === "string" ? p.label : null,
        done: typeof p.done === "number" ? p.done : null,
        total: typeof p.total === "number" ? p.total : null,
        at: typeof p.at === "string" ? p.at : null,
      },
      // Only on an error row — workers.ts's explainAgentError shape, verbatim.
      error:
        status === "error" || status === "skipped"
          ? {
              message: typeof d.message === "string" ? d.message : "The audit failed.",
              cause: typeof d.cause === "string" ? d.cause : null,
              hint: typeof d.hint === "string" ? d.hint : null,
              attempt: typeof d.attempt === "number" ? d.attempt : null,
              attempts: typeof d.attempts === "number" ? d.attempts : null,
              durationMs: typeof d.durationMs === "number" ? d.durationMs : null,
            }
          : null,
    },
  });
}
