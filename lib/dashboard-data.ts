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
  // Mr. Publish became a real agent when the chat learned to schedule a publish
  // (agent-server/src/scheduler.ts, tickOrders). Before that his room was decoration: the
  // office drew him, the log never mentioned him, and the count of jobs he had ever run was
  // zero — which is exactly what made a fabricated "Mr. Publish — queued for immediate
  // publish" impossible for anyone to catch.
  publish: "publish",
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
    // `progress:detail->progress`, not `detail`. This query runs on EVERY live poll — every
    // four seconds, every 1.2s while a job runs — and the only thing the room states read out
    // of the receipt is "12 of 40". Asking for the whole jsonb pulled the agent's entire
    // result back forty rows at a time (see trimJobDetail in agent-server/src/jobsLog.ts for
    // what used to be in there and what it cost).
    .select("agent, action, status, progress:detail->progress, created_at")
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
    if (j.status === "running" || j.status === "queued") {
      // "Researching X · 12/40" reads as progress; the label on its own reads as a spinner.
      const p = (j as any).progress;
      const suffix = p?.total ? ` · ${p.done ?? 0}/${p.total}` : "";
      rooms[room] = { state: "working", task: label + suffix };
    }
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

/** The site crawl, while it is happening.
 *
 *  The crawler is the longest job in the product — up to ~300 pages, one embedding call each,
 *  paced under NVIDIA's rate limit, so ten minutes is normal. It also has no room in the
 *  office (JOB_AGENT_TO_ROOM above), so without this there was nowhere at all to see that it
 *  was running, and the only symptom was that nothing appeared to be happening.
 *
 *  Returns null unless a crawl is genuinely in flight. A "running" row older than 30 minutes
 *  is a crashed worker, not progress, and claiming otherwise would be worse than silence. */
export async function getRunningCrawl(supabase: SupabaseClient, tenantId: string) {
  const { data } = await supabase
    .from("jobs_log")
    .select("progress:detail->progress, created_at")
    .eq("tenant_id", tenantId)
    .eq("agent", "crawler")
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  if (Date.now() - new Date(data.created_at).getTime() > 30 * 60 * 1000) return null;

  const p = ((data as any).progress ?? {}) as any;
  return {
    startedAt: data.created_at,
    phase: p.phase ?? "starting",
    done: Number(p.done ?? 0),
    total: Number(p.total ?? 0),
    current: p.current ?? null,
    label: p.label ?? null,
  };
}

/** The keyword choice waiting on the user right now, if there is one.
 *
 *  "Pending" means genuinely pending: not yet picked, not yet consumed by the writer, and not
 *  past its deadline. Showing a countdown for an article that already started being written
 *  would be a lie, and a lie that invites a click that does nothing. */
export async function getPendingKeywordChoice(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("keyword_choices")
    .select("id, topic, candidates, recommended, chosen, status, expires_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Migration 012 not applied yet — the pipeline still works, it just doesn't ask first.
  if (error || !data) return null;
  return data;
}

const TASKS: Record<string, string> = {
  boss: "Planning this week’s content",
  keyword: "Researching keywords",
  writer: "Writing article",
  seo: "Analyzing SEO",
  social: "Drafting social posts",
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
  boss: "boss", kw: "keyword", writer: "writer", seo: "seo", social: "social", publish: "publish",
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
  if (status !== "success") {
    // A job that is still running now reports where it has got to (see the AgentContext
    // handed to every agent) — "Working…" for ten minutes is indistinguishable from stuck.
    const p = detail?.progress;
    if (p?.total) {
      const done = p.done ?? 0;
      const where = p.current ? ` — ${String(p.current).replace(/^https?:\/\//, "")}` : "";
      return { summary: `${done} of ${p.total} pages read${where}`, items: [] };
    }
    if (p?.label) return { summary: String(p.label), items: [] };
    return { summary: "Working…", items: [] };
  }
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
    // Each query with the evidence behind it, and never a number the source can't support:
    // DataForSEO measures monthly volume; Search Console counts impressions for THIS site;
    // the AI fallback has no number at all and is shown without one.
    const items = related.map((r: any) => {
      if (!r?.keyword) return "";
      if (r.searchVolume != null) {
        const comp = r.competitionLevel ? `, ${String(r.competitionLevel).toLowerCase()} competition` : "";
        return `${r.keyword} — ${r.searchVolume}/mo searches${comp}`;
      }
      if (r.impressions != null) {
        const pos = r.position != null ? `, currently position ${Number(r.position).toFixed(1)}` : "";
        return `${r.keyword} — ${r.impressions} impressions on your site${pos}`;
      }
      return String(r.keyword);
    }).filter(Boolean);

    // Search Console — real measured data, just not market volume. This has to be checked
    // BEFORE the searchDataAvailable test below, which is false for this source too and
    // would otherwise credit the AI for queries Google actually reported.
    // Research only — the user explicitly asked for keywords and no article. Say so, and say
    // what to type next, because "here are your keywords" with no next step is a dead end.
    if (detail.researchOnly) {
      const rec = detail.recommended ? ` Best of these: “${detail.recommended}”${detail.recommendedWhy ? ` — ${detail.recommendedWhy}` : ""}` : "";
      return {
        summary: `Found ${items.length} keyword(s) for “${detail.topic}”. No article was written, because none was asked for.${rec}`,
        items,
      };
    }

    // Waiting on a human. The countdown itself lives in components/KeywordChoice.tsx.
    if (detail.awaitingChoice) {
      return {
        summary: `Found ${items.length} option(s) for “${detail.topic}” — waiting for you to pick one, or “${detail.recommended}” starts automatically.`,
        items,
      };
    }

    if (detail.source === "gsc") {
      return {
        summary: `The keyword provider was down, so these came from your own Search Console — real searches Google already shows your site for. Blueprint handed to Mr. Writer.`,
        items,
      };
    }
    if (detail.source === "autocomplete") {
      return {
        summary: `These are Google Autocomplete suggestions — real phrases people type around “${detail.topic}”, in Google's own order, no volume numbers. Blueprint handed to Mr. Writer.`,
        items,
      };
    }
    if (detail.source === "ai" || detail.searchDataAvailable === false) {
      return {
        summary: `No live search data was available (${detail.searchDataError ?? "provider error"}), so these came from the AI as customer questions — suggestions, not measured volumes — and the topic still went to Mr. Writer.`,
        items,
      };
    }
    if (detail.chained === false) return { summary: String(detail.reason ?? "Stopped here."), items };
    const vol = detail.seedSearchVolume != null ? `${detail.seedSearchVolume}/mo for the main keyword, ` : "";
    return { summary: `Found ${vol}${items.length} related quer${items.length === 1 ? "y" : "ies"} — blueprint handed to Mr. Writer.`, items };
  }

  if (jobAgent === "writer") {
    // Nothing was written, and saying so is the whole point. Mr. Writer now refuses a topic
    // the site already covers (duplicate lock, plan §25.5) and returns the reason instead of
    // a draft — without this branch the receipt below would happily report a quality-gated
    // article waiting for approval, which is a lie about work that never happened.
    if (detail.written === false) {
      return { summary: String(detail.reason ?? "Kuch nahi likha gaya."), items: [] };
    }
    const gate = detail.qualityGate ?? {};
    const title = detail.title ?? detail.topic ?? "the draft";
    const words = detail.wordCount ?? gate.wordCount;
    // A scheduled run can be set to publish without a review (schedules.auto_publish,
    // migration 014). The receipt has to distinguish three endings, because they are three
    // completely different things to have happened to your website — and a publish that
    // failed must never read like one that worked.
    const verdict = gate.passed === false
      ? `did NOT pass the quality gate (${(gate.reasons ?? []).join("; ") || "unknown reason"})`
      : detail.published === true
        ? "passed the quality gate and went straight to your site — you had already approved this run, so it did not wait in Approvals"
        : detail.attempted === true
          ? `passed the quality gate, but publishing it failed (${detail.error ?? "unknown error"}) — it is waiting in Approvals instead, nothing was lost`
          : "passed the quality gate and is waiting for your approval";
    // Facts about the draft that actually exists, read off the quality gate that measured it.
    const items: string[] = [];
    if (words) items.push(`${words} words`);
    if (gate.sections != null) items.push(`${gate.sections} sections`);
    if (gate.links != null) items.push(`${gate.links} internal link${gate.links === 1 ? "" : "s"}`);
    const used = detail.contextUsed ?? {};
    if (used.pages) items.push(`Grounded in ${used.pages} page(s) crawled from your site`);
    if (used.searchConsole) items.push("Used your Search Console data for links and vocabulary");
    if (gate.passed === false && Array.isArray(gate.reasons) && gate.reasons.length) {
      items.push(`Gate flagged: ${gate.reasons.join("; ")}`);
    }
    // Which keyword this was written about, and whether the human chose it. Six weeks later
    // "why is this article about THAT?" is a fair question with a real answer.
    if (detail.chosenBy) {
      items.unshift(detail.chosenBy === "user" ? `Keyword you picked: ${detail.topic}` : `Keyword auto-picked (recommended): ${detail.topic}`);
    }
    if (detail.published === true) items.unshift(detail.publishedUrl ? `Published: ${detail.publishedUrl}` : "Published to your connected destination");
    if (detail.attempted === true && detail.published !== true) items.unshift(`Auto-publish failed, so it is in Approvals: ${detail.error ?? "unknown error"}`);
    if (detail.blockedByGate === true) items.unshift("Auto-publish was on, but the quality gate stopped it — nothing was sent to your site.");
    return { summary: `Wrote “${title}”${words ? ` — ${words} words` : ""}; it ${verdict}.`, items };
  }

  if (jobAgent === "crawler") {
    const crawled = detail.pagesCrawled ?? 0;
    const skipped = detail.skipped ?? 0;
    const found = detail.urlsFound;
    // Skipped pages are holes in the knowledge base every agent reads from, so they belong in
    // the receipt rather than in a server log nobody opens.
    const summary = detail.reason
      ? String(detail.reason)
      : `Read and indexed ${crawled} page(s)${found ? ` of ${found} found` : ""}${skipped ? ` — ${skipped} skipped` : ""}.`;
    const items = Array.isArray(detail.failures)
      ? detail.failures.slice(0, 6).map((f: any) => `${f.url} — ${f.error}`)
      : [];
    return { summary, items };
  }

  if (jobAgent === "publish") {
    // Written from the result, never from the attempt. This agent exists because the chat can
    // now be told "kal 9 baje isko publish kar do", and the one thing that must never happen
    // again on this path is a success message for a publish that did not happen.
    const title = detail.title ? String(detail.title) : "the article";
    if (detail.published === true) {
      return {
        summary: `Published “${title}” to your site.`,
        items: detail.url ? [String(detail.url)] : [],
      };
    }
    return {
      summary: `Could not publish “${title}”: ${detail.error ?? "unknown error"}. It is NOT live.`,
      items: detail.hint ? [String(detail.hint)] : [],
    };
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

/** MASTER_PLAN §13 Phase 4's cost dashboard. agent-server/src/workers.ts (via
 *  lib/costLedger.ts) folds `{ tokens, calls, usd }` onto every job's own jobs_log.detail —
 *  on a failed job too, since a run that dies on its last LLM call still spent money on the
 *  ones before it (jobsLog.ts's JobErrorDetail.cost). Summing happens here rather than in
 *  Postgres because Supabase's REST layer has no easy jsonb-path SUM(); at today's per-tenant
 *  job volume that is a non-issue, and it keeps this consistent with every other stat on this
 *  page (getDashboardStats above sums plain rows in JS the same way). */
export type CostSummary = {
  totalUsd: number;
  totalTokens: number;
  jobsWithCost: number;
  byAgent: Record<string, { usd: number; tokens: number; jobs: number }>;
  sinceIso: string;
};

/** The actual aggregation, pulled out of getCostSummary so it's testable without a Supabase
 *  client — every other pure decision in this codebase (scheduler.ts's isDue, workers.ts's
 *  concurrencyFor/withCost) gets the same treatment, and nothing in this repo yet unit-tests
 *  a function that takes a SupabaseClient (there is no fake query builder to reuse), so this
 *  is the boundary that keeps the untested part to "one query, no branching". */
export function summarizeCostRows(rows: { agent: string; detail: unknown }[]): Omit<CostSummary, "sinceIso"> {
  const byAgent: Record<string, { usd: number; tokens: number; jobs: number }> = {};
  let totalUsd = 0;
  let totalTokens = 0;
  let jobsWithCost = 0;

  for (const row of rows) {
    const cost = (row.detail as any)?.cost;
    if (!cost || typeof cost.usd !== "number") continue; // older rows, or an agent that made no LLM calls
    jobsWithCost++;
    totalUsd += cost.usd;
    totalTokens += cost.tokens ?? 0;
    const agent = row.agent || "unknown";
    const bucket = (byAgent[agent] ??= { usd: 0, tokens: 0, jobs: 0 });
    bucket.usd += cost.usd;
    bucket.tokens += cost.tokens ?? 0;
    bucket.jobs += 1;
  }

  for (const agent of Object.keys(byAgent)) byAgent[agent].usd = Number(byAgent[agent].usd.toFixed(4));

  return { totalUsd: Number(totalUsd.toFixed(4)), totalTokens, jobsWithCost, byAgent };
}

export async function getCostSummary(supabase: SupabaseClient, tenantId: string, days = 7): Promise<CostSummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("jobs_log")
    // `cost:detail->cost` — five thousand whole receipts were being pulled across the wire to
    // add up one number each.
    .select("agent, cost:detail->cost")
    .eq("tenant_id", tenantId)
    .in("status", ["success", "error"])
    .gte("created_at", since.toISOString())
    .limit(5000);

  const summary = summarizeCostRows(
    !error && data ? (data as any[]).map((r) => ({ agent: r.agent, detail: { cost: r.cost } })) : []
  );
  return { ...summary, sinceIso: since.toISOString() };
}
