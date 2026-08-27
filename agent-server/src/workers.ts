import type { JobWithMetadata } from "pg-boss";
import { boss, ensureBossStarted } from "./db.js";
import { AGENT_TYPES, type AgentType } from "./queues.js";
import { BossAgent } from "./agents/boss.js";
import { KeywordAgent } from "./agents/keyword.js";
import { WriterAgent } from "./agents/writer.js";
import { SocialAgent } from "./agents/social.js";
import { SeoAgent } from "./agents/seo.js";
import { LeadsAgent } from "./agents/leads.js";
import { CrawlerAgent } from "./agents/crawler.js";
import { AnalystAgent } from "./agents/analyst.js";
import type { Agent, AgentJobData } from "./agents/base.js";
import { dailyUsage, logJobStart, logJobFinish, logJobError, logJobProgress, logJobSkipped } from "./jobsLog.js";
import { emitAgentStatus } from "./socket.js";
import { explainAgentError } from "./lib/errors.js";

// queues.ts sets retryLimit: 2, i.e. the first run plus two retries.
const MAX_ATTEMPTS = 3;

// Minimum gap between progress writes for one job.
const PROGRESS_MS = 2000;

const AGENT_LABEL: Record<string, string> = {
  boss: "Mr Lxwa", keyword: "Mr. Keyword", writer: "Mr. Writer",
  crawler: "the site crawler", social: "Miss Social", seo: "Mr. SEO", leads: "the leads agent",
  analyst: "Mr. Analyst",
};

/** The human task text whoever enqueued the job passed, falling back to the queue name. */
function rawLabelOf(job: JobWithMetadata<AgentJobData>): string {
  const label = (job.data as any)?.taskLabel;
  return typeof label === "string" && label.trim() ? label.trim() : job.name;
}

const AGENTS: Record<AgentType, Agent> = {
  boss: new BossAgent(),
  keyword: new KeywordAgent(),
  writer: new WriterAgent(),
  social: new SocialAgent(),
  seo: new SeoAgent(),
  leads: new LeadsAgent(),
  crawler: new CrawlerAgent(),
  analyst: new AnalystAgent(),
};

async function process(type: AgentType, job: JobWithMetadata<AgentJobData>) {
  const { tenantId } = job.data;

  const attempt = (job.retryCount ?? 0) + 1;

  // Retries are not new work: the first attempt already paid for this job's slot, and
  // re-checking here meant three failed tries could lock the agent out for the rest of the day.
  if (attempt === 1) {
    const usage = await dailyUsage(tenantId, type);
    if (usage.over) {
      const who = AGENT_LABEL[type] ?? type;
      const reason = usage.runaway
        ? `Safety guard tripped — ${who} started ${usage.runaway.usedThisHour} jobs in the last hour (limit ${usage.runaway.limit}). Nothing was started.`
        : `Daily limit reached on the ${usage.plan} plan — ${who} has already run ${usage.used} time(s) today (limit ${usage.cap}). Nothing was started.`;
      const hint = usage.runaway
        ? `Nobody runs this much by hand, so this is almost certainly a loop somewhere. It clears by itself within the hour; check what is enqueueing jobs before then.`
        : `Your plan's daily allowance. Upgrade the plan, or set this tenant's daily_cap_overrides in Supabase (e.g. {"${type}": null} for no limit at all).`;
      await logJobSkipped(tenantId, type, rawLabelOf(job), reason, hint);
      emitAgentStatus({ agent: type, tenant: tenantId, status: "idle", task: reason });
      console.warn(`[${type}] ${reason}`);
      // Not an error — a cap hit is expected/normal, so don't burn a retry on it.
      return { skipped: true, reason };
    }
  }

  // jobs_log.action used to be job.name, which is just the queue name again ("writer"),
  // so the dashboard had no real task text to show and had to fall back to a generic
  // per-agent label. Whoever enqueues the job can now pass a human one.
  const rawLabel = rawLabelOf(job);

  // pg-boss retries a failed job twice (queues.ts). Those retries used to be logged as if
  // they were three unrelated jobs, so the dashboard looked like it was failing and
  // restarting at random. Say which attempt this is, right in the task text.
  const attempts = MAX_ATTEMPTS;
  const taskLabel = attempt > 1 ? `${rawLabel} (retry ${attempt}/${attempts})` : rawLabel;

  emitAgentStatus({ agent: type, tenant: tenantId, status: "running", task: taskLabel });
  const logId = await logJobStart(tenantId, type, taskLabel, attempt);
  const startedAt = Date.now();

  // One write every PROGRESS_MS at most: a 300-page crawl calling this per page would
  // otherwise be 300 extra round trips, and the dashboard only polls every few seconds anyway.
  let lastProgressAt = 0;
  const onProgress = (progress: Record<string, unknown>) => {
    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_MS) return;
    lastProgressAt = now;
    void logJobProgress(logId, progress, attempt);
  };

  try {
    const result = await AGENTS[type].run(job, { onProgress });
    await logJobFinish(logId, result);
    emitAgentStatus({ agent: type, tenant: tenantId, status: "idle", task: "Done" });
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    const explained = explainAgentError(type, err, durationMs);
    await logJobError(logId, { ...explained, attempt, attempts, durationMs, agent: type, at: new Date().toISOString() });
    // Full detail to the server log too — Railway's log is where you go when even the
    // dashboard can't tell you (e.g. the jobs_log write itself is failing).
    console.error(`[${type}] attempt ${attempt}/${attempts} failed after ${Math.round(durationMs / 1000)}s: ${explained.cause}`);
    emitAgentStatus({ agent: type, tenant: tenantId, status: "error", task: explained.message });
    throw err; // rethrow so pg-boss's retryLimit/retryBackoff (see queues.ts) actually retries
  }
}

export async function startWorkers() {
  await ensureBossStarted();
  for (const type of AGENT_TYPES) {
    // batchSize:1 (default) — handler gets a 1-element array; localConcurrency:2 mirrors
    // the old BullMQ `concurrency: 2` per queue.
    // includeMetadata gives the handler retryCount — without it a retry is indistinguishable
    // from a brand-new job, which is exactly why the dashboard looked like it was failing
    // and restarting for no reason.
    await boss.work<AgentJobData>(type, { localConcurrency: 2, includeMetadata: true }, async ([job]) =>
      process(type, job as JobWithMetadata<AgentJobData>)
    );
  }
  console.log(`[workers] pg-boss workers started — agents: ${AGENT_TYPES.join(", ")}`);
}
