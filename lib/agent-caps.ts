import type { SupabaseClient } from "@supabase/supabase-js";

/** How much of today's allowance an agent has used, for the tenant's actual plan.
 *
 *  The cap table lives on agent-server (agent-server/src/config/caps.ts) and is served from
 *  GET /version, so the dashboard never keeps a second copy that could drift from the numbers
 *  the server actually enforces — the panel must not promise headroom the server disagrees
 *  with. A `null` cap means the plan has no daily limit for that agent.
 *
 *  This exists because the cap was invisible until you hit it: a tenant could sit at 6/6 and
 *  the only symptom was that nothing happened. */

type CapTable = { plans: Record<string, Record<string, number | null>>; runawayPerHour: Record<string, number> };

let cache: { caps: CapTable; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

async function loadCapTable(): Promise<CapTable | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.caps;

  const base = process.env.AGENT_SERVER_URL;
  if (!base) return null;

  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/version`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return cache?.caps ?? null;
    const data = await res.json();
    if (!data?.caps?.plans) return cache?.caps ?? null;
    cache = { caps: data.caps as CapTable, at: Date.now() };
    return cache.caps;
  } catch {
    // Older agent-server builds have no /version. Not knowing the cap is fine — the panel
    // then shows the count on its own rather than inventing a limit.
    return cache?.caps ?? null;
  }
}

export type AgentUsage = { used: number; cap: number | null; plan: string; known: boolean };

export async function getDailyUsage(
  supabase: SupabaseClient,
  tenantId: string,
  jobAgent: string
): Promise<AgentUsage | null> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [capTable, tenantRow, { count, error }] = await Promise.all([
    loadCapTable(),
    supabase.from("tenants").select("plan, daily_cap_overrides").eq("id", tenantId).single(),
    supabase
      .from("jobs_log")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("agent", jobAgent)
      .gte("created_at", startOfDay.toISOString())
      // Must match agent-server's own count exactly (jobsLog.ts countSince): retries don't
      // count; rows written before `attempt` existed have no field and still do.
      .or("detail->>attempt.is.null,detail->>attempt.eq.1"),
  ]);

  if (error) return null;

  // Before migration 009 the columns don't exist; mirror agent-server's fallback rather than
  // showing a free-trial limit to someone who is paying.
  const plan: string = tenantRow.error ? "starter" : ((tenantRow.data as any)?.plan ?? "free");
  const overrides: Record<string, unknown> = tenantRow.error ? {} : (((tenantRow.data as any)?.daily_cap_overrides as any) ?? {});

  let cap: number | null = null;
  let known = false;

  if (Object.prototype.hasOwnProperty.call(overrides, jobAgent)) {
    const v = overrides[jobAgent];
    cap = v === null ? null : Number(v);
    known = true;
  } else if (capTable?.plans) {
    const planCaps = capTable.plans[plan] ?? capTable.plans.free;
    if (planCaps && jobAgent in planCaps) {
      cap = planCaps[jobAgent];
      known = true;
    }
  }

  return { used: count ?? 0, cap, plan, known };
}
