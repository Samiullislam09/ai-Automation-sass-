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
export abstract class Agent {
  abstract type: string;
  abstract run(job: Job<AgentJobData>): Promise<unknown>;
}
