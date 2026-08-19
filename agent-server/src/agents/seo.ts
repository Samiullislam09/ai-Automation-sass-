import type { Job } from "bullmq";
import { Agent, type AgentJobData } from "./base.js";

/** Placeholder — real site audits / WordPress publish land in Step 12 + Phase 2. */
export class SeoAgent extends Agent {
  type = "seo";
  async run(job: Job<AgentJobData>) {
    await new Promise((r) => setTimeout(r, 800));
    return { note: "stub — Step 12 wires in the real quality gate + WP publish", input: job.data };
  }
}
