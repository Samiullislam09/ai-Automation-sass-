import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { nextRunAt } from "@/lib/schedule-time";

/** What the schedule is doing RIGHT NOW, plus a one-line summary of everything it will do next.
 *
 *  This feeds the "Current task" card on the Dashboard and the Leads page. A scheduled run used
 *  to be invisible while it ran: it is not a chat order, so it never lit up the agent grid, and
 *  the only trace was a jobs_log row nobody was looking at. Everything here is read back from
 *  jobs_log / schedules — nothing is estimated and nothing is invented.
 *
 *  HOW A SCHEDULED RUN IS RECOGNISED (agent-server/src/scheduler.ts):
 *   - leads / audit : the job's own label, "Scheduled lead discovery" / "Scheduled site audit".
 *   - articles      : the boss is enqueued as "Scheduled run — …"; keyword/writer/seo/image/
 *                     publish then run as plain jobs with no label of their own. They belong to
 *                     the schedule only when a scheduled boss started before them, so the chain
 *                     is attributed to the newest scheduled boss row inside CHAIN_WINDOW_MS and
 *                     never to a chat order that merely happens to run the same agents.
 *
 *  COST. The card polls this. Each call is three small, indexed reads with narrow columns — the
 *  2026-09-05 egress incident is why nothing here selects a whole `detail`. */

const CHAIN_WINDOW_MS = 3 * 60 * 60 * 1000;
// A "running" row older than this is a job whose process died, not work in progress.
const STALE_MS = 3 * 60 * 60 * 1000;
const CHAIN = ["boss", "keyword", "writer", "seo", "image", "publish"] as const;

const STAGE: Record<string, string> = {
  boss: "Planning topics",
  keyword: "Keyword research",
  writer: "Writing the article",
  seo: "SEO check",
  image: "Creating images",
  publish: "Publishing",
  leads: "Finding leads",
  audit: "Auditing the site",
};

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const since = new Date(Date.now() - CHAIN_WINDOW_MS).toISOString();

  const [sched, running, boss] = await Promise.all([
    supabase
      .from("schedules")
      .select("kind, enabled, frequency, day_of_week, time_of_day, timezone, count, last_run_at")
      .eq("tenant_id", tenantId),
    supabase
      .from("jobs_log")
      .select("id, agent, action, created_at, progress:detail->progress")
      .eq("tenant_id", tenantId)
      .eq("status", "running")
      .in("agent", [...CHAIN, "leads", "audit"])
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(30),
    supabase
      .from("jobs_log")
      .select("id, status, created_at")
      .eq("tenant_id", tenantId)
      .eq("agent", "boss")
      .ilike("action", "Scheduled run%")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const now = Date.now();
  const rows = ((running.data ?? []) as any[]).filter((r) => now - new Date(r.created_at).getTime() < STALE_MS);
  const lineOf = (r: any) => {
    const p = r.progress;
    const label = typeof p?.label === "string" ? p.label : null;
    return label || (r.action && r.action !== r.agent ? String(r.action) : null);
  };

  const countByKind: Record<string, number> = {};
  for (const s of (sched.data ?? []) as any[]) countByKind[s.kind] = s.count;

  const runs: any[] = [];

  // Leads / audit: one job is one run.
  for (const r of rows.filter((x) => x.agent === "leads" && /^Scheduled/i.test(x.action ?? ""))) {
    runs.push({
      id: String(r.id), kind: "leads", agent: "leads",
      title: countByKind.leads ? `Finding ${countByKind.leads} leads` : "Finding leads",
      startedAt: r.created_at, stage: STAGE.leads, line: lineOf(r), steps: null,
    });
  }
  for (const r of rows.filter((x) => x.agent === "audit" && /^Scheduled/i.test(x.action ?? ""))) {
    runs.push({
      id: String(r.id), kind: "audit", agent: "audit",
      title: "Site audit", startedAt: r.created_at, stage: STAGE.audit, line: lineOf(r), steps: null,
    });
  }

  // Articles: the chain behind the newest scheduled boss.
  const bossRow = (boss.data ?? [])[0] as any | undefined;
  if (bossRow) {
    const bossStart = new Date(bossRow.created_at).getTime();
    const chainRunning = rows.filter((r) => (CHAIN as readonly string[]).includes(r.agent) && new Date(r.created_at).getTime() >= bossStart);
    if (chainRunning.length) {
      // Which steps have already happened, so the card can show a real checklist rather than a
      // spinner. Only agents that actually have a row since the boss started count as reached.
      const { data: seen } = await supabase
        .from("jobs_log")
        .select("agent, status")
        .eq("tenant_id", tenantId)
        .in("agent", [...CHAIN])
        .gte("created_at", bossRow.created_at)
        .limit(60);
      const live = new Set(chainRunning.map((r) => r.agent));
      const finished = new Set(((seen ?? []) as any[]).filter((r) => r.status === "success").map((r) => r.agent));
      const current = chainRunning[chainRunning.length - 1];
      runs.push({
        id: String(bossRow.id), kind: "article", agent: current.agent,
        title: countByKind.article ? `Writing ${countByKind.article} article${countByKind.article > 1 ? "s" : ""}` : "Writing articles",
        startedAt: bossRow.created_at,
        stage: STAGE[current.agent] ?? "Working",
        line: lineOf(current),
        steps: CHAIN.map((a) => ({ id: a, label: STAGE[a], state: live.has(a) ? "now" : finished.has(a) ? "done" : "next" })),
      });
    }
  }

  const KIND_LABEL: Record<string, string> = { article: "Articles", leads: "Leads", audit: "Site audit" };
  const schedules = ((sched.data ?? []) as any[])
    .filter((s) => KIND_LABEL[s.kind])
    .map((s) => ({
      kind: s.kind as string,
      label: KIND_LABEL[s.kind],
      enabled: !!s.enabled,
      count: s.count ?? null,
      lastRunAt: s.last_run_at ?? null,
      timezone: s.timezone,
      nextRunAt: s.enabled ? (nextRunAt(s)?.toISOString() ?? null) : null,
    }));

  return NextResponse.json({ ok: true, runs, schedules });
}
