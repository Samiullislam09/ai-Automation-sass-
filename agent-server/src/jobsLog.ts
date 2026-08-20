import { supabase } from "./supabase.js";
import { capFor } from "./config/caps.js";

/** Records every job start/finish/error to Supabase jobs_log — the audit trail the
 *  dashboard's "activity feed" and daily reports will eventually read from. */
export async function logJobStart(tenantId: string, agent: string, action: string) {
  const { data, error } = await supabase
    .from("jobs_log")
    .insert({ tenant_id: tenantId, agent, action, status: "running", detail: {} })
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

export async function logJobError(id: string | undefined, message: string) {
  if (!id) return;
  const { error } = await supabase.from("jobs_log").update({ status: "error", detail: { message } }).eq("id", id);
  if (error) console.error("[jobsLog] update (error) failed:", error.message);
}

/** Hard per-tenant daily cap check — counts today's jobs_log rows for this tenant+agent.
 *  Backed by Supabase (not a Redis counter) so it's the same durable source of truth
 *  the dashboard already reads, and survives a Redis flush/restart. */
export async function isOverDailyCap(tenantId: string, agent: string): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("jobs_log")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("agent", agent)
    .gte("created_at", startOfDay.toISOString());

  return (count ?? 0) >= capFor(agent);
}
