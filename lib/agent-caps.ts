import type { SupabaseClient } from "@supabase/supabase-js";

/** How much of today's allowance an agent has used.
 *
 *  The caps themselves live on agent-server (agent-server/src/config/caps.ts) and can be
 *  overridden per deployment with DAILY_CAP_*, so the dashboard asks it rather than keeping
 *  a second copy that would drift the moment someone raises one. GET /version reports the
 *  caps actually in force.
 *
 *  This exists because the cap was invisible: a tenant could sit at 6/6 and the only symptom
 *  was that nothing happened. Now the number is on screen before you walk into it. */

let cache: { caps: Record<string, number>; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

async function loadCaps(): Promise<Record<string, number> | null> {
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
    const caps = data?.dailyCaps;
    if (!caps || typeof caps !== "object") return cache?.caps ?? null;
    cache = { caps, at: Date.now() };
    return caps;
  } catch {
    // Older agent-server builds have no /version at all. Not knowing the cap is fine — the
    // panel then shows the count on its own instead of a wrong limit.
    return cache?.caps ?? null;
  }
}

export async function getDailyUsage(
  supabase: SupabaseClient,
  tenantId: string,
  jobAgent: string
): Promise<{ used: number; cap: number | null } | null> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [caps, { count, error }] = await Promise.all([
    loadCaps(),
    supabase
      .from("jobs_log")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("agent", jobAgent)
      .gte("created_at", startOfDay.toISOString())
      // Must match agent-server's own count exactly (jobsLog.ts dailyUsage), or the panel
      // would promise headroom the server doesn't agree exists. Retries don't count; rows
      // written before `attempt` existed have no field and still do.
      .or("detail->>attempt.is.null,detail->>attempt.eq.1"),
  ]);

  if (error) return null;
  return { used: count ?? 0, cap: caps?.[jobAgent] ?? null };
}
