import { Queue } from "bullmq";
import { connection } from "./redis.js";
import type { AgentJobData } from "./agents/base.js";

export const AGENT_TYPES = ["keyword", "writer", "social", "seo", "leads"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 3000 }, // 3s, 6s, 12s between retries
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 500 },
};

export const queues: Record<AgentType, Queue<AgentJobData>> = Object.fromEntries(
  AGENT_TYPES.map((type) => [type, new Queue<AgentJobData>(type, { connection, defaultJobOptions })])
) as Record<AgentType, Queue<AgentJobData>>;

export async function enqueue(type: AgentType, data: AgentJobData) {
  return queues[type].add(type, data);
}
