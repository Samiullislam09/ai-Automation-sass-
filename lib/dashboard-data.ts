import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENTS as STORE_AGENTS } from "@/lib/agents-data";

/** Shared real-data queries for the dashboard (stat cards, the AI Command Center scene,
 *  and its polling feed). One place so /api/dashboard/stats and /api/dashboard/live can't
 *  drift out of sync — both are genuine Supabase counts, nothing here is a made-up number. */

// jobs_log.agent values that a pg-boss queue actually writes (agent-server/src/queues.ts
// AGENT_TYPES). "leads"/"crawler" have no seat in the pixel office scene, so they're not
// mapped to a room — they still count toward the plain stat cards below.
const JOB_AGENT_TO_ROOM: Record<string, string> = {
  boss: "boss", keyword: "keyword", writer: "writer", seo: "seo", social: "social",
};

export type RoomState = { state: "working" | "off" | "error" | "waiting"; task: string };

export async function getDashboardStats(supabase: SupabaseClient, tenantId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [{ count: awaiting }, { count: published }, { count: pagesIndexed }, { data: todayJobs }] = await Promise.all([
    supabase.from("content_items").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "awaiting_approval"),
    supabase.from("content_items").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "published"),
    supabase.from("site_pages").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("jobs_log").select("status").eq("tenant_id", tenantId).gte("created_at", startOfDay.toISOString()),
  ]);

  const jobs = todayJobs ?? [];
  const errors = jobs.filter((j) => j.status === "error").length;
  const successes = jobs.filter((j) => j.status === "success").length;
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const successRate = successes + errors > 0 ? Math.round((successes / (successes + errors)) * 100) : 100;

  return {
    totalAgents: STORE_AGENTS.length,
    liveAgents: STORE_AGENTS.filter((a) => a.live).length,
    working: running,
    waiting: awaiting ?? 0,
    errorsToday: errors,
    tasksCompleted: published ?? 0,
    successRate,
    pagesIndexed: pagesIndexed ?? 0,
  };
}

/** Resting-state snapshot for every room in the pixel office. Only the 6 rooms with real
 *  backend wiring (see AGENTS[].live in lib/store.tsx) ever show anything but "off" — the
 *  rest stay shuttered, same honesty rule the stat cards already follow. */
export async function getAgentRoomStates(supabase: SupabaseClient, tenantId: string): Promise<Record<string, RoomState>> {
  const rooms: Record<string, RoomState> = {
    // Boss is only "working" when a real orchestrator job is running (see agents/boss.ts);
    // it used to be hardcoded to working, which made an idle office look busy.
    boss: { state: "off", task: "—" },
    keyword: { state: "off", task: "—" },
    writer: { state: "off", task: "—" },
    seo: { state: "off", task: "—" },
    social: { state: "off", task: "—" },
    qa: { state: "off", task: "—" },
    publish: { state: "off", task: "—" },
    image: { state: "off", task: "—" },
    reply: { state: "off", task: "—" },
    email: { state: "off", task: "—" },
    analytics: { state: "off", task: "—" },
    webstory: { state: "off", task: "—" },
    backup: { state: "off", task: "—" },
  };

  const { data: recentJobs } = await supabase
    .from("jobs_log")
    // `action` is the real human task label the enqueuer passed (e.g. Writing "how to ..."),
    // see agent-server/src/workers.ts. Older rows only carry the queue name, so TASKS below
    // is still the fallback rather than showing the word "writer" as a task.
    .select("agent, action, status, created_at")
    .eq("tenant_id", tenantId)
    .in("agent", Object.keys(JOB_AGENT_TO_ROOM))
    .order("created_at", { ascending: false })
    .limit(40);

  const seen = new Set<string>();
  for (const j of recentJobs ?? []) {
    const room = JOB_AGENT_TO_ROOM[j.agent];
    if (!room || seen.has(room)) continue; // keep only the latest row per agent type
    seen.add(room);
    const ageMs = Date.now() - new Date(j.created_at).getTime();
    const label = j.action && j.action !== j.agent ? j.action : (TASKS[room] ?? "Working…");
    if (j.status === "running" || j.status === "queued") rooms[room] = { state: "working", task: label };
    else if (j.status === "error" && ageMs < 10 * 60 * 1000) rooms[room] = { state: "error", task: "Needs a restart" };
    // status === "success" (or an old error) → stays "off" until the next real job
  }

  const { count: awaitingCount } = await supabase
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "awaiting_approval");
  if ((awaitingCount ?? 0) > 0) rooms.qa = { state: "waiting", task: `${awaitingCount} item(s) awaiting review` };

  return rooms;
}

const TASKS: Record<string, string> = {
  boss: "Planning this week’s content",
  keyword: "Researching keywords",
  writer: "Writing article",
  seo: "Analyzing SEO",
  social: "Scheduling posts",
};
