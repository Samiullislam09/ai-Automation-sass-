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
    // Refused by the daily cap. Amber, not red: nothing is broken, but the room must not sit
    // there looking peacefully asleep when the user just asked it to do something.
    else if (j.status === "skipped" && ageMs < 30 * 60 * 1000) rooms[room] = { state: "waiting", task: "Daily cap reached — nothing ran" };
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

/* ============================ ONE AGENT, IN DETAIL ============================
 * Powers the "click a room and watch that agent work" view (app/app/page.tsx →
 * components/AgentPanel.tsx). Everything here is read back out of jobs_log/content_items —
 * the same rows the agent-server wrote — so the panel shows what an agent ACTUALLY did and
 * what came out of it, not a scripted animation.
 */

// Office/store agent id (lib/agents-data.ts) -> the jobs_log.agent value its queue writes.
// Agents missing from this map have no queue of their own yet: Mr. QA and Mr. Publish are
// stages inside the writer job (quality gate / publish), so their panel reads content_items.
export const AGENT_ID_TO_JOB: Record<string, string> = {
  boss: "boss", kw: "keyword", writer: "writer", seo: "seo", social: "social",
};

export type AgentJobRow = {
  id: string;
  /** office/store agent id (only set by getRecentJobs, which mixes agents together) */
  agentId?: string;
  task: string;
  status: string;
  at: string;
  summary: string;
  /** Real sub-items produced by the job (topics planned, keywords found) — for the list view. */
  items: string[];
};

export type AgentDetail = {
  jobAgent: string | null;
  state: RoomState;
  jobs: AgentJobRow[];
  content: { id: string; title: string; status: string; words: number | null; at: string }[];
  counts: { total: number; success: number; error: number; running: number };
};

export async function getAgentDetail(
  supabase: SupabaseClient,
  tenantId: string,
  agentId: string
): Promise<AgentDetail> {
  const jobAgent = AGENT_ID_TO_JOB[agentId] ?? null;
  const rooms = await getAgentRoomStates(supabase, tenantId);
  // getAgentRoomStates keys rooms by ROOM id ("keyword"), the UI by store id ("kw").
  const state = rooms[jobAgent ?? agentId] ?? rooms[agentId] ?? { state: "off" as const, task: "—" };

  let jobs: AgentJobRow[] = [];
  const counts = { total: 0, success: 0, error: 0, running: 0 };

  if (jobAgent) {
    const { data } = await supabase
      .from("jobs_log")
      .select("id, action, status, detail, created_at")
      .eq("tenant_id", tenantId)
      .eq("agent", jobAgent)
      .order("created_at", { ascending: false })
      .limit(12);

    jobs = (data ?? []).map((j: any) => ({
      id: String(j.id),
      task: j.action && j.action !== jobAgent ? j.action : jobAgent,
      status: j.status,
      at: j.created_at,
      ...describeJob(jobAgent, j.status, j.detail),
    }));

    for (const j of jobs) {
      counts.total++;
      if (j.status === "success") counts.success++;
      // A capped job is not a failure of the agent, but it isn't work either — counting it
      // as "running" (the old catch-all) would leave the panel claiming a job is in flight
      // forever.
      else if (j.status === "error" || j.status === "skipped") counts.error++;
      else counts.running++;
    }
  }

  // Mr. Writer / Mr. QA / Mr. Publish all end at the same place: a content_items row.
  let content: AgentDetail["content"] = [];
  if (["writer", "qa", "publish"].includes(agentId)) {
    const { data } = await supabase
      .from("content_items")
      .select("id, title, status, meta, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(8);
    content = (data ?? []).map((c: any) => ({
      id: String(c.id),
      title: c.title ?? "(untitled)",
      status: c.status,
      words: c.meta?.wordCount ?? null,
      at: c.created_at,
    }));
  }

  return { jobAgent, state, jobs, content, counts };
}

/** Turns one jobs_log row's `detail` jsonb into a human sentence + the real items it produced.
 *  Every branch reads a field the agent actually writes (agent-server/src/agents/*.ts); when a
 *  row has nothing usable we say so rather than inventing a description of the work. */
function describeJob(jobAgent: string, status: string, detail: any): { summary: string; items: string[] } {
  if (status === "error" || status === "skipped") {
    // agent-server enriches failures (agent-server/src/lib/errors.ts): a plain sentence, the
    // raw cause, a hint, which retry it was and how long it ran. Show all of it — "proper
    // error logs" was a fair complaint about the old single opaque line.
    const summary = detail?.message ? String(detail.message) : status === "skipped" ? "Refused before it started." : "Failed.";
    const items: string[] = [];
    if (detail?.hint) items.push(String(detail.hint));
    if (detail?.attempt && detail?.attempts) {
      const secs = detail.durationMs ? ` · ran ${Math.round(Number(detail.durationMs) / 1000)}s` : "";
      items.push(`Attempt ${detail.attempt} of ${detail.attempts}${secs}`);
    }
    // Only when it adds something — repeating the same sentence twice helps nobody.
    if (detail?.cause && String(detail.cause) !== summary) items.push(`Technical: ${String(detail.cause).slice(0, 300)}`);
    return { summary, items };
  }
  if (status !== "success") return { summary: "Working…", items: [] };
  if (!detail || typeof detail !== "object") return { summary: "Finished.", items: [] };

  if (jobAgent === "boss") {
    const topics = Array.isArray(detail.topics) ? detail.topics : [];
    if (!topics.length) return { summary: detail.reason ? String(detail.reason) : "Planned nothing this run.", items: [] };
    return {
      summary: `Planned ${topics.length} topic${topics.length > 1 ? "s" : ""} from your niche and crawled pages, and sent each to Mr. Keyword.`,
      items: topics.map((t: any) => (t?.why ? `${t.topic} — ${t.why}` : String(t?.topic ?? ""))).filter(Boolean),
    };
  }

  if (jobAgent === "keyword") {
    const related = Array.isArray(detail.relatedKeywords) ? detail.relatedKeywords : [];
    const items = related.map((r: any) =>
      r?.searchVolume != null ? `${r.keyword} — ${r.searchVolume}/mo` : String(r?.keyword ?? "")
    ).filter(Boolean);

    if (detail.source === "ai" || detail.searchDataAvailable === false) {
      return {
        summary: `DataForSEO was unavailable (${detail.searchDataError ?? "provider error"}), so these came from the AI as customer questions — suggestions, not measured volumes — and the topic still went to Mr. Writer.`,
        items,
      };
    }
    if (detail.chained === false) return { summary: String(detail.reason ?? "Stopped here."), items };
    const vol = detail.seedSearchVolume != null ? `${detail.seedSearchVolume}/mo for the main keyword, ` : "";
    return { summary: `Found ${vol}${items.length} related quer${items.length === 1 ? "y" : "ies"} — blueprint handed to Mr. Writer.`, items };
  }

  if (jobAgent === "writer") {
    const gate = detail.qualityGate ?? {};
    const title = detail.title ?? detail.topic ?? "the draft";
    const words = detail.wordCount ?? gate.wordCount;
    const verdict = gate.passed === false
      ? `did NOT pass the quality gate (${(gate.reasons ?? []).join("; ") || "unknown reason"})`
      : "passed the quality gate and is waiting for your approval";
    return { summary: `Wrote “${title}”${words ? ` — ${words} words` : ""}; it ${verdict}.`, items: [] };
  }

  if (jobAgent === "crawler") {
    return { summary: `Crawled ${detail.pagesCrawled ?? 0} page(s).${detail.reason ? ` ${detail.reason}` : ""}`, items: [] };
  }

  return { summary: "Finished.", items: [] };
}

/** The last few jobs across ALL agents, each with the same human summary the agent panel
 *  uses. The live poll sends these so the dashboard can announce "Mr. Writer just finished X"
 *  the moment it happens, and so the chat can show who is working without a second query. */
export async function getRecentJobs(supabase: SupabaseClient, tenantId: string, limit = 8): Promise<AgentJobRow[]> {
  const { data } = await supabase
    .from("jobs_log")
    .select("id, agent, action, status, detail, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((j: any) => ({
    id: String(j.id),
    // office/store id, so the client can map a job straight onto a room without a second table
    agentId: Object.keys(AGENT_ID_TO_JOB).find((k) => AGENT_ID_TO_JOB[k] === j.agent) ?? j.agent,
    task: j.action && j.action !== j.agent ? j.action : j.agent,
    status: j.status,
    at: j.created_at,
    ...describeJob(j.agent, j.status, j.detail),
  })) as AgentJobRow[];
}
