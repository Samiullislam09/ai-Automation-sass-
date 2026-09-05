import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** What the schedule has actually DONE — the receipt for every automatic run.
 *
 *  "Schedule chalu hai" was the only thing /app/schedule could ever tell you. Whether 9am
 *  came and went, whether anything was written, whether it blew up at 3am — none of it was
 *  visible anywhere except by scrolling the whole activity feed and guessing which rows
 *  belonged to a scheduled run. Automation you cannot audit is automation you cannot trust.
 *
 *  Everything below is read back from the database. Nothing is estimated.
 *
 *  HOW A RUN IS IDENTIFIED: agent-server/src/scheduler.ts enqueues the boss with
 *  taskLabel "Scheduled run — …" and source:"schedule", and the boss echoes `source` into its
 *  jobs_log detail. Both are matched, because rows written before the echo existed only have
 *  the label.
 *
 *  HOW ITS ARTICLES ARE FOUND: the scheduler mints a `scheduleRunId` and it is threaded
 *  boss -> keyword -> writer, which stamps it on content_items.meta. That is an exact link.
 *  Runs from before that existed have no id to match, so those fall back to "everything
 *  produced between this run and the next one" — the API says which of the two was used
 *  (`linkedBy`) so the page can be honest about it rather than presenting a guess as a fact. */

// How far after a run's start its output can still be attributed to it when there is no
// scheduleRunId to match on. A boss -> keyword -> writer chain for five topics is minutes,
// not hours; six hours is generous and still short enough that tomorrow's run can never be
// swept into today's row.
const FALLBACK_WINDOW_MS = 6 * 60 * 60 * 1000;
const RUNS = 10;

type Article = {
  id: string;
  title: string;
  status: string;
  words: number | null;
  at: string;
  publishedUrl: string | null;
  publishError: string | null;
};

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const runs = await loadScheduledBossRuns(supabase, tenantId);
  if (runs.error) return NextResponse.json({ ok: false, error: runs.error }, { status: 500 });
  if (!runs.rows.length) return NextResponse.json({ ok: true, runs: [] });

  // One read each for the two things a run produces, bounded by the oldest run on screen so
  // this never turns into a full-table scan as the account gets older.
  const since = runs.rows[runs.rows.length - 1].created_at;
  const [{ data: content }, { data: chainJobs }] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, title, status, meta, created_at")
      .eq("tenant_id", tenantId)
      .eq("type", "article")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("jobs_log")
      // `message:detail->>message`, not `detail`. These 150 rows are the keyword and writer
      // jobs — the two fattest receipts in the table — and the only thing read out of them
      // below is the failure sentence. (2026-09-05 egress audit, finding #2.)
      .select("id, agent, action, status, message:detail->>message, created_at")
      .eq("tenant_id", tenantId)
      .in("agent", ["keyword", "writer"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(150),
  ]);

  const items = content ?? [];
  const jobs = chainJobs ?? [];

  const out = runs.rows.map((run: any, i: number) => {
    const firedAt = new Date(run.created_at).getTime();
    // Rows come back newest first, so the run BEFORE this one in the array is the newer one —
    // its start is where this run's window has to end.
    const nextRunStart = i === 0 ? Infinity : new Date(runs.rows[i - 1].created_at).getTime();
    const windowEnd = Math.min(nextRunStart, firedAt + FALLBACK_WINDOW_MS);
    const inWindow = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= firedAt && t < windowEnd;
    };

    const runId: string | null = run.detail?.scheduleRunId ?? null;
    const stamped = runId ? items.filter((c: any) => c.meta?.scheduleRunId === runId) : [];
    // Exact match wins whenever there is one. The window is only for runs that predate the id.
    const linkedBy: "run-id" | "time" = runId && stamped.length ? "run-id" : "time";
    const matched = linkedBy === "run-id" ? stamped : items.filter((c: any) => inWindow(c.created_at));

    const articles: Article[] = matched.map((c: any) => ({
      id: String(c.id),
      title: c.title ?? "(untitled)",
      status: c.status,
      words: c.meta?.wordCount ?? null,
      at: c.created_at,
      publishedUrl: c.meta?.publishedUrl ?? null,
      publishError: c.meta?.publishError ?? null,
    }));

    const windowJobs = jobs.filter((j: any) => inWindow(j.created_at));
    const failures = windowJobs
      .filter((j: any) => j.status === "error" || j.status === "skipped")
      .map((j: any) => ({
        agent: j.agent,
        task: j.action && j.action !== j.agent ? j.action : j.agent,
        message: String(j.message ?? "Failed."),
        at: j.created_at,
      }));
    const stillWorking = windowJobs.some((j: any) => j.status === "running");

    const topics = Array.isArray(run.detail?.topics)
      ? run.detail.topics.map((t: any) => String(t?.topic ?? "")).filter(Boolean)
      : [];

    return {
      id: String(run.id),
      firedAt: run.created_at,
      status: runStatus(run.status, stillWorking, articles.length, failures.length),
      planned: typeof run.detail?.planned === "number" ? run.detail.planned : null,
      // Why nothing was planned, straight from the boss (e.g. "no niche set and no crawled
      // pages yet"). A run that produced nothing on purpose must not look like a failure.
      reason: run.status === "success" && !topics.length ? (run.detail?.reason ?? null) : null,
      // The boss echoes the flag it was started with, so a row can say whether THAT run was
      // set to publish on its own — not merely what the toggle says today.
      autoPublish: typeof run.detail?.autoPublish === "boolean" ? run.detail.autoPublish : null,
      bossError: run.status === "error" || run.status === "skipped" ? String(run.detail?.message ?? "Failed.") : null,
      topics,
      linkedBy,
      articles,
      failures,
    };
  });

  return NextResponse.json({ ok: true, runs: out });
}

function runStatus(bossStatus: string, stillWorking: boolean, articles: number, failures: number):
  "running" | "finished" | "partial" | "failed" {
  if (bossStatus === "error" || bossStatus === "skipped") return "failed";
  if (bossStatus === "running" || stillWorking) return "running";
  if (failures && articles) return "partial";
  if (failures) return "failed";
  return "finished";
}

/** Boss jobs that a schedule started, newest first. */
async function loadScheduledBossRuns(supabase: any, tenantId: string): Promise<{ rows: any[]; error?: string }> {
  const base = () =>
    supabase
      .from("jobs_log")
      .select("id, action, status, detail, created_at")
      .eq("tenant_id", tenantId)
      .eq("agent", "boss")
      .order("created_at", { ascending: false })
      .limit(RUNS);

  // The label is quoted because it contains a space — PostgREST's or() splits on commas and
  // is happier with an explicit string than with a bare one.
  const { data, error } = await base().or('action.ilike."Scheduled run%",detail->>source.eq.schedule');
  if (!error) return { rows: data ?? [] };

  // The jsonb half of that filter is the fragile half. Rather than showing nothing, fall back
  // to the label the scheduler has always written — which is what every existing row has.
  console.error("[schedule/history] combined filter failed, falling back to the label:", error.message);
  const { data: byLabel, error: labelError } = await base().ilike("action", "Scheduled run%");
  if (labelError) return { rows: [], error: labelError.message };
  return { rows: byLabel ?? [] };
}
