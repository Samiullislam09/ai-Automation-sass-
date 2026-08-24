import type { Job } from "pg-boss";
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

const AGENTS: Record<AgentType, Agent> = {
  boss: new BossAgent(),
  keyword: new KeywordAgent(),
  writer: new WriterAgent(),
  social: new SocialAgent(),
  seo: new SeoAgent(),
  leads: new LeadsAgent(),
  crawler: new CrawlerAgent(),
};

async function process(type: AgentType, job: Job<AgentJobData>) {
  const { tenantId } = job.data;

  if (await isOverDailyCap(tenantId, type)) {
    emitAgentStatus({ agent: type, tenant: tenantId, status: "idle", task: "Daily cap reached — skipped" });
    // Not an error — a cap hit is expected/normal, so don't burn a retry on it.
    return { skipped: true, reason: "daily cap exceeded" };
  }

  // jobs_log.action used to be job.name, which is just the queue name again ("writer"),
  // so the dashboard had no real task text to show and had to fall back to a generic
  // per-agent label. Whoever enqueues the job can now pass a human one.
  const taskLabel = typeof (job.data as any).taskLabel === "string" && (job.data as any).taskLabel.trim()
    ? ((job.data as any).taskLabel as string).trim()
    : job.name;

  emitAgentStatus({ agent: type, tenant: tenantId, status: "running", task: taskLabel });
  const logId = await logJobStart(tenantId, type, taskLabel);

  try {
    const result = await AGENTS[type].run(job);
    await logJobFinish(logId, result);
    emitAgentStatus({ agent: type, tenant: tenantId, status: "idle", task: "Done" });
    return result;
  } catch (err: any) {
    await logJobError(logId, err?.message ?? String(err));
    emitAgentStatus({ agent: type, tenant: tenantId, status: "error", task: err?.message ?? "Failed" });
    throw err; // rethrow so pg-boss's retryLimit/retryBackoff (see queues.ts) actually retries
  }
}

export async function startWorkers() {
  await ensureBossStarted();
  for (const type of AGENT_TYPES) {
    // batchSize:1 (default) — handler gets a 1-element array; localConcurrency:2 mirrors
    // the old BullMQ `concurrency: 2` per queue.
    await boss.work<AgentJobData>(type, { localConcurrency: 2 }, async ([job]) => process(type, job));
  }
  console.log(`[workers] pg-boss workers started — agents: ${AGENT_TYPES.join(", ")}`);
}
