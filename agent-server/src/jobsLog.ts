import { supabase } from "./supabase.js";
import { capFor, runawayLimit } from "./config/caps.js";

/** Records every job start/finish/error to Supabase jobs_log — the audit trail the
 *  dashboard's "activity feed" and daily reports will eventually read from. */
export async function logJobStart(tenantId: string, agent: string, action: string, attempt = 1) {
  const { data, error } = await supabase
    .from("jobs_log")
    // `attempt` is written on the START row too, because that is the only place the daily-cap
    // count can see it — without it a retry looked exactly like a fresh job and ate the
    // tenant's allowance a second and third time.
    .insert({ tenant_id: tenantId, agent, action, status: "running", detail: { attempt } })
    .select("id")
    .single();
  // Previously swallowed silently — a bad SUPABASE_URL/SERVICE_ROLE_KEY meant jobs ran
  // fine but left zero audit trail, with no error anywhere to explain why.
  if (error) console.error("[jobsLog] insert failed (check SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY):", error.message);
  return data?.id as string | undefined;
}

/** Live progress on a job that is still running. Overwrites `detail.progress` only — the
 *  attempt number written at start has to survive, because the daily-cap count reads it. */
export async function logJobProgress(id: string | undefined, progress: Record<string, unknown>, attempt: number) {
  if (!id) return;
  const { error } = await supabase
    .from("jobs_log")
    .update({ detail: { attempt, progress } })
    .eq("id", id)
    .eq("status", "running"); // a finished job must never be dragged back to "in progress"
  if (error) console.error("[jobsLog] progress update failed:", error.message);
}

/** Keys an agent returns that must never be copied into jobs_log.
 *
 *  `detail` is the receipt: what happened, in the words the dashboard shows. It was being
 *  handed the agent's ENTIRE return value (workers.ts: `logJobFinish(logId, result)`), which
 *  meant Mr. Writer filed a second copy of the whole article in it (~15 KB) and Mr. Audit filed
 *  the whole report — every issue plus a per-page row, with LCP/CLS/TBT, for up to 200 pages
 *  (100 KB+). Every one of those bytes is already stored properly somewhere else:
 *  content_items.body holds the article (detail keeps `contentItemId`), site_audits holds the
 *  report.
 *
 *  Nothing reads them from here. lib/dashboard-data.ts's describeJob() — the only thing that
 *  turns a detail into a sentence — never touches `body`, `blueprint`, `issues`, `meta` or
 *  `run.pages`; it reads counts, titles, reasons and the quality gate.
 *
 *  What they DID do was cost money. The live poll re-read 61 of these rows every four seconds
 *  (getAgentRoomStates 40 + getRecentJobs 20 + getRunningCrawl 1), and the schedule history
 *  reads 150 keyword/writer rows at a time. That is how a 36 MB database with one user burned
 *  through Supabase's 5 GB monthly egress in four days (2026-09-05) and got the whole
 *  organisation restricted. */
const HEAVY_KEYS = ["body", "blueprint", "issues", "meta", "pages", "pageSummary", "html", "markdown"];

/** Belt to the blacklist's braces: a `detail` bigger than this is something new and unforeseen
 *  that would be re-read sixty times every four seconds, so it is cut down to the keys the
 *  dashboard is known to read rather than filed whole. */
const MAX_DETAIL_BYTES = 8_000;
const SAFE_KEYS = [
  "attempt", "message", "reason", "topic", "topics", "title", "planned", "written", "published",
  "publishedUrl", "attempted", "error", "hint", "chosenBy", "wordCount", "qualityGate", "source",
  "chained", "awaitingChoice", "researchOnly", "recommended", "contentItemId", "scheduleRunId",
  "autoPublish", "blockedByGate", "pagesCrawled", "urlsFound", "skipped", "built", "version", "cost",
  // A failure's own fields. They are the whole point of the row when something breaks, so they
  // survive the cut — the Audit and Site Brain pages read them straight back out.
  "cause", "stack", "attempts", "durationMs", "agent", "at", "progress",
];

/** A `cause` is whatever the failing library said, which can be an entire API error body. Two
 *  thousand characters is more than anyone reads and enough to identify any of them. */
const MAX_CAUSE_CHARS = 2_000;

/** Drops the heavy keys from a job result before it becomes the row's receipt. Shallow by
 *  design, plus the one nested case that matters (`run.pages`, the audit's per-page table) —
 *  a deep walk over every agent result would be a lot of machinery for one known shape. */
export function trimJobDetail(detail: unknown): unknown {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return detail;
  const out: Record<string, unknown> = { ...(detail as Record<string, unknown>) };
  for (const k of HEAVY_KEYS) delete out[k];

  if (typeof out.cause === "string" && out.cause.length > MAX_CAUSE_CHARS) {
    out.cause = out.cause.slice(0, MAX_CAUSE_CHARS) + " …[truncated]";
  }

  const run = out.run;
  if (run && typeof run === "object" && !Array.isArray(run)) {
    const { pages, ...restOfRun } = run as Record<string, unknown>;
    out.run = restOfRun;
  }

  if (JSON.stringify(out).length <= MAX_DETAIL_BYTES) return out;

  const small: Record<string, unknown> = { detail_trimmed: true };
  for (const k of SAFE_KEYS) if (k in out) small[k] = out[k];
  return small;
}

export async function logJobFinish(id: string | undefined, detail: unknown) {
  if (!id) return;
  const { error } = await supabase
    .from("jobs_log")
    .update({ status: "success", detail: trimJobDetail(detail) })
    .eq("id", id);
  if (error) console.error("[jobsLog] update (success) failed:", error.message);
}

/** Everything a failure needs to be diagnosable from the dashboard alone, without SSHing
 *  into anything: what failed in plain words, the raw cause under it, what to do about it,
 *  which retry this was, and how long it ran before dying. Previously this column held a
 *  single opaque sentence and nothing else. */
export type JobErrorDetail = {
  message: string;
  cause?: string;
  hint?: string;
  stack?: string;
  attempt?: number;
  attempts?: number;
  durationMs?: number;
  agent?: string;
  at?: string;
  /** Whatever was spent (lib/costLedger.ts) before the failure — a job that dies on its last
   *  LLM call still paid for the ones before it. */
  cost?: { tokens: number; calls: number; usd: number };
};

export async function logJobError(id: string | undefined, detail: JobErrorDetail) {
  if (!id) return;
  const { error } = await supabase.from("jobs_log").update({ status: "error", detail: trimJobDetail(detail) }).eq("id", id);
  if (error) console.error("[jobsLog] update (error) failed:", error.message);
}

/** Rows left in "running" by a process that no longer exists. This server is one instance
 *  (Railway); when it restarts — a deploy, a crash, pg-boss expiring a hung job and the
 *  process being replaced — every job the OLD process had in flight is gone, but its jobs_log
 *  row still says "running" and would say so forever (found 2026-09-04: four audit rows from
 *  one day, all "running", the Audit page showing "stopped responding" for a run that had in
 *  fact died hours earlier). pg-boss's retry, if any, is a separate row with its own attempt
 *  number, so closing these is correct, not destructive. Rows younger than GRACE_MS are left
 *  alone — a job that started seconds before boot might belong to this very process. */
export async function sweepOrphanedJobs(bootedAt = new Date()): Promise<number> {
  const GRACE_MS = 60_000;
  const before = new Date(bootedAt.getTime() - GRACE_MS).toISOString();
  // Read first, so the row keeps its own `progress` (which step it was on, and when) and its
  // `attempt` — the Audit page's error card shows where the run stopped, and the daily-cap
  // count reads the attempt number.
  const { data: rows, error } = await supabase.from("jobs_log").select("id, agent, detail").eq("status", "running").lt("created_at", before);
  if (error) {
    console.error("[jobsLog] orphan sweep failed:", error.message);
    return 0;
  }
  let n = 0;
  for (const row of rows ?? []) {
    const prev = ((row as any).detail ?? {}) as Record<string, unknown>;
    const progress = prev.progress as { label?: string; phase?: string; at?: string } | undefined;
    const where = progress?.label ? ` It had got as far as "${progress.label}"${progress.at ? ` (${progress.at})` : ""}.` : "";
    const { error: upErr } = await supabase
      .from("jobs_log")
      .update({
        status: "error",
        detail: {
          ...prev,
          message: "This job did not finish — the server restarted while it was running.",
          cause: `Row was still "running" when the agent server booted at ${bootedAt.toISOString()}; the process that owned it is gone.${where}`,
          hint: "Run it again. If it stops at the same step twice, that step is what to look at — the reason is recorded here next time.",
          at: new Date().toISOString(),
          orphaned: true,
        },
      })
      .eq("id", (row as any).id)
      .eq("status", "running");
    if (upErr) console.error(`[jobsLog] orphan sweep could not close ${(row as any).agent} ${(row as any).id}:`, upErr.message);
    else n++;
  }
  if (n) console.log(`[jobsLog] closed ${n} job row(s) left "running" by a previous process`);
  return n;
}

/** Hard per-tenant daily cap check — counts today's jobs_log rows for this tenant+agent.
 *  Backed by Supabase (not a Redis counter) so it's the same durable source of truth
 *  the dashboard already reads, and survives a Redis flush/restart. */
export type Usage = {
  used: number;
  /** null = no daily cap for this tenant+agent (top plan, or a custom override). */
  cap: number | null;
  over: boolean;
  plan: string;
  /** Set only when the technical runaway guard fired, never for an ordinary plan cap. */
  runaway?: { usedThisHour: number; limit: number };
};

/** The tenant's commercial position: which plan they're on and any per-tenant overrides.
 *  One small select; the alternative is a flat cap for everyone, which is what made a paying
 *  customer hit the same wall as a free trial. */
async function tenantPlan(tenantId: string): Promise<{ plan: string; overrides: Record<string, unknown> }> {
  const { data, error } = await supabase
    .from("tenants")
    .select("plan, daily_cap_overrides")
    .eq("id", tenantId)
    .single();

  // Before migration 009 these columns don't exist. Falling back to "free" would ration a
  // paying customer on a schema detail, so the fallback is the paid tier — the worst case is
  // a slightly generous day, not a customer being told no.
  if (error) return { plan: "starter", overrides: {} };
  return { plan: (data as any)?.plan ?? "free", overrides: ((data as any)?.daily_cap_overrides as any) ?? {} };
}

async function countSince(tenantId: string, agent: string, sinceIso: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("jobs_log")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("agent", agent)
    .gte("created_at", sinceIso)
    // First attempts only. Rows written before this field existed have no `attempt` at all,
    // so they still count — dropping them would silently reset everyone's usage to zero.
    .or("detail->>attempt.is.null,detail->>attempt.eq.1");

  if (error) {
    console.error("[jobsLog] usage count failed:", error.message);
    return null;
  }
  return count ?? 0;
}

export async function dailyUsage(tenantId: string, agent: string): Promise<Usage> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [{ plan, overrides }, used, usedThisHour] = await Promise.all([
    tenantPlan(tenantId),
    countSince(tenantId, agent, startOfDay.toISOString()),
    countSince(tenantId, agent, hourAgo.toISOString()),
  ]);

  const cap = capFor(agent, plan, overrides);

  // Fail OPEN. A cap is a budget guard, not a security control, and refusing every job
  // because a COUNT query hiccuped is far worse than briefly overshooting the budget.
  if (used === null) return { used: 0, cap, over: false, plan };

  // The technical guard, applied to every plan including the uncapped one. It is not a
  // rationing decision — it is the only thing standing between a runaway loop and a very
  // large bill, so "unlimited" stops here and nowhere else.
  const limit = runawayLimit(agent);
  if (usedThisHour !== null && usedThisHour >= limit) {
    return { used, cap, over: true, plan, runaway: { usedThisHour, limit } };
  }

  if (cap === null) return { used, cap: null, over: false, plan };
  return { used, cap, over: used >= cap, plan };
}

export async function isOverDailyCap(tenantId: string, agent: string): Promise<boolean> {
  return (await dailyUsage(tenantId, agent)).over;
}

/** A job that was refused, not attempted. It MUST leave a row: the cap check used to run
 *  before logJobStart, so hitting it produced total silence — the chat happily said "On it",
 *  the office stayed asleep, and nothing anywhere said why. */
export async function logJobSkipped(tenantId: string, agent: string, action: string, reason: string, hint: string) {
  const { error } = await supabase
    .from("jobs_log")
    .insert({ tenant_id: tenantId, agent, action, status: "skipped", detail: { message: reason, hint } });

  // 'skipped' needs migration 008. Before that lands the insert is rejected by the status
  // check constraint — and being visible as an error beats being invisible.
  if (error) {
    console.error("[jobsLog] could not write skipped row (apply migration 008):", error.message);
    await supabase
      .from("jobs_log")
      .insert({ tenant_id: tenantId, agent, action, status: "error", detail: { message: reason, hint } });
  }
}
