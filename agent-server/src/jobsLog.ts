import { supabase } from "./supabase.js";
import { capFor } from "./config/caps.js";

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

export async function logJobFinish(id: string | undefined, detail: unknown) {
  if (!id) return;
  const { error } = await supabase.from("jobs_log").update({ status: "success", detail }).eq("id", id);
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
};

export async function logJobError(id: string | undefined, detail: JobErrorDetail) {
  if (!id) return;
  const { error } = await supabase.from("jobs_log").update({ status: "error", detail }).eq("id", id);
  if (error) console.error("[jobsLog] update (error) failed:", error.message);
}

/** Hard per-tenant daily cap check — counts today's jobs_log rows for this tenant+agent.
 *  Backed by Supabase (not a Redis counter) so it's the same durable source of truth
 *  the dashboard already reads, and survives a Redis flush/restart. */
export async function dailyUsage(tenantId: string, agent: string): Promise<{ used: number; cap: number; over: boolean }> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("jobs_log")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("agent", agent)
    .gte("created_at", startOfDay.toISOString())
    // First attempts only. Rows written before this field existed have no `attempt` at all,
    // so they still count — dropping them would silently reset everyone's usage to zero.
    .or("detail->>attempt.is.null,detail->>attempt.eq.1");

  const cap = capFor(agent);
  if (error) {
    // Fail OPEN. A cap is a budget guard, not a security control, and refusing every job
    // because a COUNT query hiccuped is far worse than briefly overshooting the budget.
    console.error("[jobsLog] daily cap count failed, allowing the job:", error.message);
    return { used: 0, cap, over: false };
  }

  const used = count ?? 0;
  return { used, cap, over: used >= cap };
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
