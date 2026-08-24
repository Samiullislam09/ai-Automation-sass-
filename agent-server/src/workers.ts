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
import type { Agent, AgentJobData } from "./agents/base.js";
import { isOverDailyCap, logJobStart, logJobFinish, logJobError } from "./jobsLog.js";
import { emitAgentStatus } from "./socket.js";
import { explainAgentError } from "./lib/errors.js";

// queues.ts sets retryLimit: 2, i.e. the first run plus two retries.
const MAX_ATTEMPTS = 3;

const AGENTS: Record<AgentType, Agent> = {
  boss: new BossAgent(),
  keyword: new KeywordAgent(),
  writer: new WriterAgent(),
  social: new SocialAgent(),
  seo: new SeoAgent(),
  leads: new LeadsAgent(),
  crawler: new CrawlerAgent(),
};

async function process(type: AgentType, job: JobWithMetadata<AgentJobData>) {
  const { tenantId } = job.data;

  if (await isOverDailyCap(tenantId, type)) {
    emitAgentStatus({ agent: type, tenant: tenantId, status: "idle", task: "Daily cap reached — skipped" });
    // Not an error — a cap hit is expected/normal, so don't burn a retry on it.
    return { skipped: true, reason: "daily cap exceeded" };
  }

  // jobs_log.action used to be job.name, which is just the queue name again ("writer"),
  // so the dashboard had no real task text to show and had to fall back to a generic
  // per-agent label. Whoever enqueues the job can now pass a human one.
  const rawLabel = typeof (job.data as any).taskLabel === "string" && (job.data as any).taskLabel.trim()
    ? ((job.data as any).taskLabel as string).trim()
    : job.name;

  // pg-boss retries a failed job twice (queues.ts). Those retries used to be logged as if
  // they were three unrelated jobs, so the dashboard looked like it was failing and
  // restarting at random. Say which attempt this is, right in the task text.
  const attempt = (job.retryCount ?? 0) + 1;
  const attempts = MAX_ATTEMPTS;
  const taskLabel = attempt > 1 ? `${rawLabel} (retry ${attempt}/${attempts})` : rawLabel;

  emitAgentStatus({ agent: type, tenant: tenantId, status: "running", task: taskLabel });
  const logId = await logJobStart(tenantId, type, taskLabel);
  const startedAt = Date.now();

  try {
    const result = await AGENTS[type].run(job);
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
