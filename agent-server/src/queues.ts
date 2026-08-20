import { boss, ensureBossStarted } from "./db.js";
import type { AgentJobData } from "./agents/base.js";

export const AGENT_TYPES = ["keyword", "writer", "social", "seo", "leads"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

// Mirrors the old BullMQ config (attempts: 3, exponential backoff 3s/6s/12s):
// retryLimit 2 = 2 retries after the first attempt = 3 tries total.
const QUEUE_OPTIONS = {
  retryLimit: 2,
  retryBackoff: true,
  retryDelay: 3, // seconds
};

/** Declares each agent's queue in Postgres. Must run once before send()/work() calls
 *  (pg-boss requires a queue to exist before it's used) — called from index.ts on boot. */
export async function initQueues() {
  await ensureBossStarted();
  for (const type of AGENT_TYPES) {
    await boss.createQueue(type, QUEUE_OPTIONS);
  }
}

export async function enqueue(type: AgentType, data: AgentJobData) {
  await ensureBossStarted();
  return boss.send(type, data as unknown as object);
}
