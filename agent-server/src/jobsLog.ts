import { supabase } from "./supabase.js";
import { capFor } from "./config/caps.js";

/** Records every job start/finish/error to Supabase jobs_log — the audit trail the
 *  dashboard's "activity feed" and daily reports will eventually read from. */
export async function logJobStart(tenantId: string, agent: string, action: string) {
  const { data } = await supabase
    .from("jobs_log")
    .insert({ tenant_id: tenantId, agent, action, status: "running", detail: {} })
    .select("id")
    .single();
  return data?.id as string | undefined;
}

export async function logJobFinish(id: string | undefined, detail: unknown) {
  if (!id) return;
  await supabase.from("jobs_log").update({ status: "success", detail }).eq("id", id);
}

export async function logJobError(id: string | undefined, message: string) {
  if (!id) return;
  await supabase.from("jobs_log").update({ status: "error", detail: { message } }).eq("id", id);
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
