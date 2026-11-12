import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** The live view of ONE scheduled run: what it has produced so far.
 *
 *  Called by the run view (components/dashboard/ScheduledRunView.tsx) every few seconds while it
 *  is open — and only then. `id` is the jobs_log row of the run (the leads/audit job, or the
 *  scheduled boss for articles); `since` is its start time. Leads and articles are read from
 *  their own tables as they are written, so what the person watches is the real output, not a
 *  re-enactment of it. Rows are scoped to the tenant AND bounded by `since`, so a run can never
 *  show another run's output. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const kind = req.nextUrl.searchParams.get("kind");
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const sinceRaw = req.nextUrl.searchParams.get("since") ?? "";
  if (!["leads", "article", "audit"].includes(kind ?? "") || !id || isNaN(Date.parse(sinceRaw))) {
    return NextResponse.json({ ok: false, error: "kind, id and since are required." }, { status: 400 });
  }
  const since = new Date(sinceRaw).toISOString();

  const { data: job } = await supabase
    .from("jobs_log")
    .select("status, created_at, message:detail->>message, saved:detail->>saved, found:detail->>found, progress:detail->progress")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const j = job as any;
  const status: "running" | "finished" | "failed" | "unknown" = !j
    ? "unknown"
    : j.status === "running" ? "running" : j.status === "success" ? "finished" : "failed";

  let items: any[] = [];
  if (kind === "leads") {
    const { data } = await supabase
      .from("leads")
      .select("id, company, name, website, city, country, icp_score, created_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(100);
    items = data ?? [];
  } else if (kind === "article") {
    const { data } = await supabase
      .from("content_items")
      .select("id, title, status, created_at, words:meta->wordCount")
      .eq("tenant_id", tenantId)
      .eq("type", "article")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(20);
    items = data ?? [];
  }

  return NextResponse.json({
    ok: true,
    status,
    progress: typeof j?.progress?.label === "string" ? j.progress.label : null,
    message: status === "failed" ? (j?.message ?? "The run failed.") : null,
    saved: j?.saved != null ? Number(j.saved) : null,
    found: j?.found != null ? Number(j.found) : null,
    items,
  });
}
