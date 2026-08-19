import { Worker, type Job } from "bullmq";
import { connection } from "./redis.js";
import { AGENT_TYPES, type AgentType } from "./queues.js";
import { KeywordAgent } from "./agents/keyword.js";
import { WriterAgent } from "./agents/writer.js";
import { SocialAgent } from "./agents/social.js";
import { SeoAgent } from "./agents/seo.js";
import { LeadsAgent } from "./agents/leads.js";
import type { Agent, AgentJobData } from "./agents/base.js";
import { isOverDailyCap, logJobStart, logJobFinish, logJobError } from "./jobsLog.js";
import { emitAgentStatus } from "./socket.js";

const AGENTS: Record<AgentType, Agent> = {
  keyword: new KeywordAgent(),
  writer: new WriterAgent(),
  social: new SocialAgent(),
  seo: new SeoAgent(),
  leads: new LeadsAgent(),
};

async function process(type: AgentType, job: Job<AgentJobData>) {
  const { tenantId } = job.data;

  if (await isOverDailyCap(tenantId, type)) {
    emitAgentStatus({ agent: type, tenant: tenantId, status: "idle", task: "Daily cap reached — skipped" });
    // Not an error — a cap hit is expected/normal, so don't burn BullMQ's retry attempts on it.
    return { skipped: true, reason: "daily cap exceeded" };
  }

  emitAgentStatus({ agent: type, tenant: tenantId, status: "running", task: `Working (attempt ${job.attemptsMade + 1})` });
  const logId = await logJobStart(tenantId, type, job.name);

  try {
    const result = await AGENTS[type].run(job);
    await logJobFinish(logId, result);
    emitAgentStatus({ agent: type, tenant: tenantId, status: "idle", task: "Done" });
    return result;
  } catch (err: any) {
    await logJobError(logId, err?.message ?? String(err));
    emitAgentStatus({ agent: type, tenant: tenantId, status: "error", task: err?.message ?? "Failed" });
    throw err; // rethrow so BullMQ's attempts/backoff (see queues.ts) actually retries
  }
}

export function startWorkers() {
  return AGENT_TYPES.map(
    (type) =>
      new Worker<AgentJobData>(type, (job) => process(type, job), {
        connection,
        concurrency: 2,
      })
  );
}
