import type { SupabaseClient } from "@supabase/supabase-js";

/** When a reusable, expensive agent run last actually succeeded for this tenant — the
 *  freshness signal behind chat's "don't redo it, reuse it" gate (lib/chat-brain.ts).
 *
 *  Found live 2026-09-07: a vague chat message ("tell me about my website") got classified
 *  as `audit.audit_site` and started a fresh 156-page Lighthouse-style run for a question
 *  that already had a perfectly good answer sitting in `site_profiles`. The model's own
 *  classification is not going to become perfectly reliable, so the gate has to sit after
 *  it: before anything expensive and reusable actually dispatches, ask "did this already
 *  happen recently enough to just reuse?" — the same discipline the weekly Audit scheduler
 *  already applies to itself (agent-server/src/scheduler.ts's tickAudits), generalised to
 *  every reusable action instead of one.
 *
 *  `jobs_log` is the one table every agent already writes to on success
 *  (agent-server/src/jobsLog.ts's logJobFinish), so it is the single source of truth here
 *  rather than reading three different result tables (site_pages / site_audits /
 *  site_profiles) with three different freshness rules to keep in sync. */
export async function lastSuccessfulRun(supabase: SupabaseClient, tenantId: string, agent: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from("jobs_log")
    .select("created_at")
    .eq("tenant_id", tenantId)
    .eq("agent", agent)
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.created_at) return null;
  const at = new Date(data.created_at as string);
  return Number.isNaN(at.getTime()) ? null : at;
}
