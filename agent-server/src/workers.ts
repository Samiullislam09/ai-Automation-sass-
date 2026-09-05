import type { JobWithMetadata } from "pg-boss";
import { boss, ensureBossStarted } from "./db.js";
import { AGENT_TYPES, BRAIN_QUEUE, type AgentType } from "./queues.js";
import { BossAgent } from "./agents/boss.js";
import { KeywordAgent } from "./agents/keyword.js";
import { WriterAgent } from "./agents/writer.js";
import { SocialAgent } from "./agents/social.js";
import { SeoAgent } from "./agents/seo.js";
import { LeadsAgent } from "./agents/leads.js";
import { AuditAgent } from "./agents/audit.js";
import { ImageAgent } from "./agents/image.js";
import { StoryAgent } from "./agents/story.js";
import { CrawlerAgent } from "./agents/crawler.js";
import { AnalystAgent } from "./agents/analyst.js";
import { PublishAgent } from "./agents/publish.js";
import type { Agent, AgentContext, AgentJobData } from "./agents/base.js";
import { dailyUsage, logJobStart, logJobFinish, logJobError, logJobProgress, logJobSkipped } from "./jobsLog.js";
import { emitAgentStatus } from "./socket.js";
import { explainAgentError } from "./lib/errors.js";
import { brainRefOf } from "./brain/adapter.js";
import { onStepDone, onStepFailed } from "./brain/orchestrator.js";
import { handleBrainDispatch } from "./brain/server.js";
import { emit } from "./brain/events.js";
import { withCostLedger, type CostSnapshot } from "./lib/costLedger.js";

/** Folds a cost snapshot into an agent's result without assuming its shape — every agent's
 *  run() returns `unknown` (base.ts), so this can't just spread onto it blindly. Every real
 *  agent returns a plain object today; the fallback exists so a future agent returning
 *  something else (a string, an array) still gets its cost recorded instead of silently
 *  losing it. */
export function withCost(result: unknown, cost: CostSnapshot): unknown {
  const rounded = { tokens: cost.tokens, calls: cost.calls, usd: Number(cost.costUsd.toFixed(4)) };
  if (result && typeof result === "object" && !Array.isArray(result)) return { ...(result as Record<string, unknown>), cost: rounded };
  return { value: result, cost: rounded };
}

// queues.ts sets retryLimit: 2, i.e. the first run plus two retries.
const MAX_ATTEMPTS = 3;

// Minimum gap between progress writes for one job.
const PROGRESS_MS = 2000;

const AGENT_LABEL: Record<string, string> = {
  boss: "Mr Lxwa", keyword: "Mr. Keyword", writer: "Mr. Writer",
  crawler: "the site crawler", social: "Miss Social", seo: "Mr. SEO", leads: "the leads agent",
  analyst: "Mr. Analyst", publish: "Mr. Publish", audit: "Mr. Audit",
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
  publish: new PublishAgent(),
  audit: new AuditAgent(),
  image: new ImageAgent(),
  story: new StoryAgent(),
};

// Named processJob, not process — a module-scope function called `process` shadows Node's
// global `process` (process.env included) for every line in this file, which is exactly the
// bug concurrencyFor's own env var read tripped over below until this was renamed.
async function processJob(type: AgentType, job: JobWithMetadata<AgentJobData>) {
  const { tenantId } = job.data;

  const attempt = (job.retryCount ?? 0) + 1;

  // A job that belongs to a brain task carries a reference to the step it is. Read before the
  // cap check, because a capped step still has to be reported — otherwise the task sits in
  // `running` forever waiting for a job that was never allowed to start.
  const brainRef = brainRefOf(job.data);

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
      if (brainRef) {
        // Not retryable: the cap will still be there in a second, and the user has been told
        // why. The task stops in needs_attention with this exact sentence.
        await onStepFailed(brainRef.task_id, brainRef.tenant_id, brainRef.step_id, reason, false).catch((e: any) =>
          console.error(`[${type}] capped step could not be reported:`, e?.message),
        );
      }
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
    // The live channel gets every call: a workspace that only updates every two seconds looks
    // stuck, and a broadcast costs nothing. Only the jobs_log write is throttled.
    if (brainRef && typeof (progress as any).label === "string") {
      liveEvent({
        type: "progress",
        fraction: typeof (progress as any).fraction === "number" ? (progress as any).fraction : 0,
        label: (progress as any).label,
      });
    }
    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_MS) return;
    lastProgressAt = now;
    void logJobProgress(logId, progress, attempt);
  };

  /** One place that turns an agent's call into a brain event, or drops it when the job is not
   *  part of a task. Agents therefore never branch on "is anyone watching". */
  const liveEvent = (partial: Record<string, unknown>) => {
    if (!brainRef) return;
    emit({
      run_id: String(job.id),
      tenant_id: tenantId,
      agent_id: type,
      at: new Date().toISOString(),
      task_id: brainRef.task_id,
      step_id: brainRef.step_id,
      ...partial,
    } as any);
  };

  const ctx: AgentContext = {
    onProgress,
    data: (kind, payload) => liveEvent({ type: "data", kind, payload }),
    progress: (fraction, label) => liveEvent({ type: "progress", fraction, label }),
    log: (message, level = "info") => liveEvent({ type: "log", level, message_dev: message }),
    // So an agent can exclude its own in-flight row from a jobs_log search — see the field's
    // own comment in agents/base.ts.
    jobLogId: logId,
  };

  // Everything above and below is unchanged for ordinary jobs — the `brainRef` branches are
  // the whole of the strangler seam (brain/adapter.ts explains why a step rides the agent's
  // own queue instead of a new one).
  try {
    // withCostLedger: every NVIDIA call made anywhere inside AGENTS[type].run() — however many
    // awaits deep — gets attributed here via AsyncLocalStorage (lib/costLedger.ts), not by
    // threading a "record this" parameter through eight agents' own LLM calls. §13 Phase 4's
    // cost dashboard, the capture half.
    const { result: rawResult, ...cost } = await withCostLedger(() => AGENTS[type].run(job, ctx));
    const result = withCost(rawResult, cost);
    await logJobFinish(logId, result);
    emitAgentStatus({ agent: type, tenant: tenantId, status: "idle", task: "Done" });
    if (brainRef) {
      // Reporting back must never turn a finished job into a failed one: the work is done and
      // logged either way, and a retry would repeat it.
      try {
        await onStepDone(brainRef.task_id, brainRef.tenant_id, brainRef.step_id, result);
      } catch (e: any) {
        console.error(`[${type}] step ${brainRef.step_id} finished but the brain could not be told:`, e?.message);
      }
    }
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    const explained = explainAgentError(type, err, durationMs);
    // A job that fails on its last LLM call still spent money on the ones before it —
    // withCostLedger attaches whatever was actually spent to the error as `.costLedger`.
    const partial = err?.costLedger as CostSnapshot | undefined;
    const cost = partial ? { tokens: partial.tokens, calls: partial.calls, usd: Number(partial.costUsd.toFixed(4)) } : undefined;
    await logJobError(logId, { ...explained, attempt, attempts, durationMs, agent: type, at: new Date().toISOString(), cost });
    if (brainRef) {
      // pg-boss owns the retrying (queues.ts: retryLimit 2). The brain is only told once the
      // last attempt is spent, so the two retry policies cannot multiply into nine tries.
      const lastAttempt = attempt >= attempts;
      if (lastAttempt) {
        try {
          await onStepFailed(brainRef.task_id, brainRef.tenant_id, brainRef.step_id, explained.message, false);
        } catch (e: any) {
          console.error(`[${type}] step ${brainRef.step_id} failed and the brain could not be told:`, e?.message);
        }
      }
    }
    // Full detail to the server log too — Railway's log is where you go when even the
    // dashboard can't tell you (e.g. the jobs_log write itself is failing).
    console.error(`[${type}] attempt ${attempt}/${attempts} failed after ${Math.round(durationMs / 1000)}s: ${explained.cause}`);
    emitAgentStatus({ agent: type, tenant: tenantId, status: "error", task: explained.message });
    throw err; // rethrow so pg-boss's retryLimit/retryBackoff (see queues.ts) actually retries
  }
}

// Every agent's queue gets 2 concurrent workers (mirrors the old BullMQ `concurrency: 2`),
// except Writer — MASTER_PLAN §13 Phase 4: "writer ×4-8 instances", because article
// generation is the slowest, most LLM-heavy job and the one users wait on longest, so it is
// the one queue worth widening before any other. Tunable per Railway plan's CPU/RAM via
// WRITER_CONCURRENCY (default 4, the plan's own floor; the plan's own ceiling of 8 is
// enforced here so a typo in the env var can't accidentally starve every other queue's share
// of Postgres connections). Safe to raise: lib/nvidia.ts's rate limiter is a single in-process
// gate shared by every concurrent call, so more writer instances only queue through it more —
// they can never push the account over its requests-per-minute ceiling.
const DEFAULT_CONCURRENCY = 2;
const WRITER_CONCURRENCY_MIN = 4;
const WRITER_CONCURRENCY_MAX = 8;

export function concurrencyFor(type: AgentType): number {
  if (type !== "writer") return DEFAULT_CONCURRENCY;
  const requested = Number(process.env.WRITER_CONCURRENCY);
  const fallback = Number.isFinite(requested) && requested > 0 ? requested : WRITER_CONCURRENCY_MIN;
  return Math.min(WRITER_CONCURRENCY_MAX, Math.max(WRITER_CONCURRENCY_MIN, fallback));
}

export async function startWorkers() {
  await ensureBossStarted();
  for (const type of AGENT_TYPES) {
    // batchSize:1 (default) — handler gets a 1-element array.
    // includeMetadata gives the handler retryCount — without it a retry is indistinguishable
    // from a brand-new job, which is exactly why the dashboard looked like it was failing
    // and restarting for no reason.
    await boss.work<AgentJobData>(type, { localConcurrency: concurrencyFor(type), includeMetadata: true }, async ([job]) =>
      processJob(type, job as JobWithMetadata<AgentJobData>)
    );
  }

  // The brain's own queue carries no work, only "look at task X again" — that is how a retry
  // survives its backoff. It is not in AGENT_TYPES because it has no agent, no cap and no room
  // in the office; giving it one would put a fake worker on the dashboard.
  await boss.work<{ task_id: string; tenant_id: string }>(BRAIN_QUEUE, { localConcurrency: 4 }, async ([job]) => {
    try {
      await handleBrainDispatch(job.data);
    } catch (e: any) {
      // retryLimit is 0 on this queue: re-dispatch is idempotent, so a failure here means the
      // task is stuck for another reason and a retry would only hide it.
      console.error(`[brain] dispatch for task ${job.data?.task_id} failed:`, e?.message);
    }
  });

  console.log(`[workers] pg-boss workers started — agents: ${AGENT_TYPES.join(", ")}, plus ${BRAIN_QUEUE}`);
}
