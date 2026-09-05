import { boss, ensureBossStarted } from "./db.js";
import type { AgentJobData } from "./agents/base.js";

// "boss" is the orchestrator (agents/boss.ts) — it plans topics and starts the
// keyword -> writer chain. Listed first because it is the entry point of a real run.
// "analyst" (agents/analyst.ts) runs straight after the crawler: it reads the crawled pages
// and writes the versioned site_profile every other agent then starts from (plan §25).
// "publish" is the only agent that changes something outside our own database — a page on
// the customer's live site. It is a queue like any other; what makes it different is the
// manifest flag (irreversible) that forces a confirmation before the brain ever queues it.
export const AGENT_TYPES = ["boss", "keyword", "writer", "social", "seo", "leads", "crawler", "analyst", "publish", "audit", "image", "story"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

// Mirrors the old BullMQ config (attempts: 3, exponential backoff 3s/6s/12s):
// retryLimit 2 = 2 retries after the first attempt = 3 tries total.
const QUEUE_OPTIONS = {
  retryLimit: 2,
  retryBackoff: true,
  retryDelay: 3, // seconds
  // Wake the worker with a Postgres NOTIFY the instant a job is created (db.ts turns the
  // listener on). Without it, "start now" means "start within one polling interval" — and
  // that interval is what WORKER_POLLING below stretches from 2s to 30s to stop this server
  // from burning the Supabase free tier's egress while idle.
  notify: true,
};

/** How often a worker asks the database for work when NOTIFY has not woken it.
 *
 *  pg-boss's default is every 2 seconds, per worker. Thirteen queues at that rate is ~6.5
 *  queries a second, 24 hours a day, whether or not a single person is using the product —
 *  roughly 560,000 queries a day of pure "anything for me?". That idling is what put the
 *  project over Supabase's free 5 GB egress in four days (7.67 GB, 2026-09-05) with one
 *  active user and a 36 MB database, and got the whole organisation restricted.
 *
 *  With `notify: true` above, a new job wakes its worker immediately, so this poll is only a
 *  backstop for the case where the NOTIFY listener could not be established — hence 30s while
 *  notify is live, and 15s as the base, which is the worst case a job would ever wait. The
 *  Site Brain and Audit pages already say "Queued - waiting for a worker to pick it up", so
 *  that wait is visible rather than mysterious. */
const WORKER_POLLING = { pollingIntervalSeconds: 15, notifyPollingIntervalSeconds: 30 };
export { WORKER_POLLING };

// A full-site crawl (up to ~300 pages, one fetch+embed each, sequential) can genuinely run
// long. pg-boss's default expireInSeconds (900 = 15min) would kill/retry it mid-crawl on a
// bigger site — 1 hour gives real headroom.
//
// The analyst belongs in the same class: six LLM calls plus one embedding per Search Console
// query it checks, all of them through the shared 30 rpm limiter (lib/nvidia.ts), so a busy
// account can put it well past 15 minutes even though it is doing nothing wrong.
//
// The audit too (2026-09-04): 200 pages at 400ms apart plus up to ten Lighthouse runs is
// 8-10 minutes on a normal day. At the 15-minute default, one slow site meant pg-boss expired
// and retried it three times — every retry stuck in the same place, no report ever filed.
const CRAWLER_QUEUE_OPTIONS = { ...QUEUE_OPTIONS, expireInSeconds: 3600 };
const LONG_RUNNING: AgentType[] = ["crawler", "analyst", "audit"];

/** The brain's own queue. Not an agent: the only thing it carries is "look at task X again",
 *  which is how a retry survives its backoff and how a step wakes up after a delay. Kept off
 *  AGENT_TYPES on purpose — it has no agent class, no cap, and must never appear in the office.
 *
 *  retryLimit 0: re-dispatching is already idempotent (it reads the rows and sends whatever is
 *  ready), so a pg-boss retry on top would be a second opinion nobody asked for. */
export const BRAIN_QUEUE = "brain-dispatch";
const BRAIN_QUEUE_OPTIONS = { retryLimit: 0, notify: true };

/** Declares each agent's queue in Postgres. Must run once before send()/work() calls
 *  (pg-boss requires a queue to exist before it's used) — called from index.ts on boot. */
export async function initQueues() {
  await ensureBossStarted();
  for (const type of AGENT_TYPES) {
    const options = LONG_RUNNING.includes(type) ? CRAWLER_QUEUE_OPTIONS : QUEUE_OPTIONS;
    await boss.createQueue(type, options);
    // createQueue is a no-op for a queue that already exists, so a changed expiry (audit,
    // above) would never reach a database that has had the queue since day one. updateQueue
    // applies the options to the existing row.
    await boss.updateQueue(type, options).catch((e: any) => console.error(`[queues] updateQueue ${type} failed:`, e?.message));
  }
  await boss.createQueue(BRAIN_QUEUE, BRAIN_QUEUE_OPTIONS);
  await boss.updateQueue(BRAIN_QUEUE, BRAIN_QUEUE_OPTIONS).catch((e: any) => console.error(`[queues] updateQueue ${BRAIN_QUEUE} failed:`, e?.message));
}

/** Ask the brain to look at a task again, now or after a delay. */
export async function enqueueBrainDispatch(data: { task_id: string; tenant_id: string }, options?: { startAfter?: number }) {
  await ensureBossStarted();
  return boss.send(BRAIN_QUEUE, data, options ?? {});
}

/** `startAfter` (seconds) is how the keyword agent holds a writer job open while the human
 *  gets a chance to pick a different keyword — pg-boss keeps it and hands it to a worker when
 *  the window closes, so the article gets written whether or not anyone was watching. */
export async function enqueue(type: AgentType, data: AgentJobData, options?: { startAfter?: number }) {
  await ensureBossStarted();
  return boss.send(type, data as unknown as object, options ?? {});
}
