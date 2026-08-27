import { boss, ensureBossStarted } from "./db.js";
import type { AgentJobData } from "./agents/base.js";

// "boss" is the orchestrator (agents/boss.ts) — it plans topics and starts the
// keyword -> writer chain. Listed first because it is the entry point of a real run.
// "analyst" (agents/analyst.ts) runs straight after the crawler: it reads the crawled pages
// and writes the versioned site_profile every other agent then starts from (plan §25).
export const AGENT_TYPES = ["boss", "keyword", "writer", "social", "seo", "leads", "crawler", "analyst"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

// Mirrors the old BullMQ config (attempts: 3, exponential backoff 3s/6s/12s):
// retryLimit 2 = 2 retries after the first attempt = 3 tries total.
const QUEUE_OPTIONS = {
  retryLimit: 2,
  retryBackoff: true,
  retryDelay: 3, // seconds
};

// A full-site crawl (up to ~300 pages, one fetch+embed each, sequential) can genuinely run
// long. pg-boss's default expireInSeconds (900 = 15min) would kill/retry it mid-crawl on a
// bigger site — 1 hour gives real headroom.
//
// The analyst belongs in the same class: six LLM calls plus one embedding per Search Console
// query it checks, all of them through the shared 30 rpm limiter (lib/nvidia.ts), so a busy
// account can put it well past 15 minutes even though it is doing nothing wrong.
const CRAWLER_QUEUE_OPTIONS = { ...QUEUE_OPTIONS, expireInSeconds: 3600 };
const LONG_RUNNING: AgentType[] = ["crawler", "analyst"];

/** Declares each agent's queue in Postgres. Must run once before send()/work() calls
 *  (pg-boss requires a queue to exist before it's used) — called from index.ts on boot. */
export async function initQueues() {
  await ensureBossStarted();
  for (const type of AGENT_TYPES) {
    await boss.createQueue(type, LONG_RUNNING.includes(type) ? CRAWLER_QUEUE_OPTIONS : QUEUE_OPTIONS);
  }
}

/** `startAfter` (seconds) is how the keyword agent holds a writer job open while the human
 *  gets a chance to pick a different keyword — pg-boss keeps it and hands it to a worker when
 *  the window closes, so the article gets written whether or not anyone was watching. */
export async function enqueue(type: AgentType, data: AgentJobData, options?: { startAfter?: number }) {
  await ensureBossStarted();
  return boss.send(type, data as unknown as object, options ?? {});
}
