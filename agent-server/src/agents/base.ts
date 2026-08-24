import type { Job } from "pg-boss";

export type AgentJobData = {
  tenantId: string;
  [key: string]: unknown;
};

/** Every agent (Keyword, Writer, Social, SEO, Leads) is a class with a run(job) method.
 *  Step 6 only builds the framework — real logic per agent lands in later Build Guide
 *  steps (9: Keyword, 10-11: SERP/Writer, Phase 2: Social/SEO, Phase 3: Leads).
 *
 *  Queue backend: Postgres via pg-boss (not Redis/BullMQ — see db.ts for why). */
/** Handed to every agent so a long job can say where it has got to.
 *  A crawl takes ten minutes; without this the dashboard shows a spinner for ten minutes and
 *  nobody can tell the difference between "working" and "stuck". */
export type AgentContext = {
  /** Merged into this job's jobs_log detail. Throttled by the worker — call it freely. */
  onProgress: (progress: Record<string, unknown>) => void;
};

export abstract class Agent {
  abstract type: string;
  // Subclasses that don't need progress can still declare run(job) — TypeScript allows a
  // method to take fewer parameters than the signature it implements.
  abstract run(job: Job<AgentJobData>, ctx: AgentContext): Promise<unknown>;
}
