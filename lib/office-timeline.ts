import type { SupabaseClient } from "@supabase/supabase-js";
import { HANDOFF_FROM, AGENTS } from "@/lib/agents-data";
import { nextRunAt } from "@/lib/chat-context";
import type { AgentJobRow } from "@/lib/dashboard-data";

/** The office's running commentary, and the clock on its wall.
 *
 *  THE COMPLAINT THIS ANSWERS. The office animated on a timer: rooms lit up, a character
 *  bobbed, a chai-walla walked about — none of it connected to a job. Asked for an article you
 *  saw motion immediately and had no idea whether anything had actually started. What was
 *  wanted instead was a log along the bottom reading "Mr Lxwa planning… assigned to Mr.
 *  Writer… Mr. Writer accepted…", with the animation following the real work rather than
 *  leading it.
 *
 *  SO EVERY LINE HERE IS A ROW. Each event is one jobs_log row: its agent, the label the
 *  enqueuer wrote, its status right now, and the time it was created. Nothing is inferred from
 *  elapsed time and nothing is invented to fill a gap.
 *
 *  THE ONE THING THAT IS NOT READ OFF A ROW is the arrow between two rooms, and it is not a
 *  guess either: agents/boss.ts enqueues the keyword job and agents/keyword.ts enqueues the
 *  writer job, so "Mr Lxwa → Mr. Keyword" is the pipeline as written in code (HANDOFF_FROM in
 *  lib/agents-data.ts). It is only drawn when the predecessor genuinely ran in the same
 *  window — an arrow from a room that did nothing would be exactly the fiction this replaces.
 *
 *  jobs_log has no finished_at column: logJobFinish UPDATES the row it started. So a finished
 *  event carries the time work STARTED and its outcome, which is what it can honestly say.
 */

export type OfficeEvent = {
  /** jobs_log row id — also the de-dupe key for the client's log. */
  id: string;
  /** office/store agent id (boss, kw, writer, …) */
  agentId: string;
  name: string;
  /** created_at: when this job started. */
  at: string;
  status: string;
  /** The real task label the enqueuer passed. */
  task: string;
  /** describeJob()'s one-liner — only meaningful once the job has an outcome. */
  summary: string;
  /** Who handed it over, when that agent really ran in this window. */
  from: string | null;
};

export type Handoff = { from: string; to: string; at: string };

// Two of these have no room in the office but do write to jobs_log, and the run log is the
// only place their work is ever visible — a ten-minute crawl showing up as the bare word
// "crawler" is worse than not showing it at all.
const NAME: Record<string, string> = {
  ...Object.fromEntries(AGENTS.map((a) => [a.id, a.name])),
  crawler: "Site Reader",
  leads: "Lead Finder",
};
const WINDOW_MS = 90 * 60 * 1000;

/** Turns the recent-jobs feed into the office's log, oldest first.
 *
 *  Takes rows rather than a client so the live route can build this from the same
 *  getRecentJobs() call it already makes — the office and the "who is working" strip must
 *  never be able to disagree about what happened. */
export function buildTimeline(jobs: AgentJobRow[], now = Date.now()): { events: OfficeEvent[]; handoffs: Handoff[] } {
  const recent = jobs
    .filter((j) => now - new Date(j.at).getTime() < WINDOW_MS)
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const ran = new Set(recent.map((j) => j.agentId ?? ""));

  const events: OfficeEvent[] = recent.map((j) => {
    const agentId = j.agentId ?? "";
    const predecessor = HANDOFF_FROM[agentId];
    return {
      id: j.id,
      agentId,
      name: NAME[agentId] ?? agentId,
      at: j.at,
      status: j.status,
      task: j.task,
      summary: j.summary,
      // Only claim a handoff when the agent it would have come from actually has a row in
      // this window. Otherwise this job was started on its own — from the chat, from the
      // button, or by the scheduler — and saying it was "assigned" would be untrue.
      from: predecessor && ran.has(predecessor) ? predecessor : null,
    };
  });

  // One arrow per handoff, at the moment the receiving job started. The office animates the
  // most recent one; the rest are history the client can ignore.
  const handoffs: Handoff[] = events
    .filter((e) => e.from)
    .map((e) => ({ from: e.from as string, to: e.agentId, at: e.at }));

  return { events, handoffs };
}

export type NextRun = {
  kind: string;
  /** ISO instant of the next fire, or null when the schedule is off or unparseable. */
  at: string | null;
  timezone: string;
  timeOfDay: string;
  frequency: string;
  count: number;
  enabled: boolean;
  autoPublish: boolean;
  lastRunAt: string | null;
};

/** The automation clock, for the board on the office wall.
 *
 *  select("*") on purpose — `auto_publish` arrives with migration 014, and naming it in the
 *  column list would make the whole read fail on a database that hasn't run it yet, costing
 *  the office its countdown over one missing column. */
export async function getNextRun(supabase: SupabaseClient, tenantId: string): Promise<NextRun | null> {
  try {
    const { data } = await supabase.from("schedules").select("*").eq("tenant_id", tenantId).eq("kind", "article").maybeSingle();
    if (!data) return null;
    const next = data.enabled ? nextRunAt(data as any) : null;
    return {
      kind: data.kind,
      at: next ? next.toISOString() : null,
      timezone: data.timezone,
      timeOfDay: data.time_of_day,
      frequency: data.frequency,
      count: data.count,
      enabled: !!data.enabled,
      autoPublish: !!data.auto_publish,
      lastRunAt: data.last_run_at ?? null,
    };
  } catch (e: any) {
    // Migration 006 not applied. The office simply shows no board rather than a wrong one.
    console.error("[office] schedule read failed:", e?.message);
    return null;
  }
}
