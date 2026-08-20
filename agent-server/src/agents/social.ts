import type { Job } from "pg-boss";
import { Agent, type AgentJobData } from "./base.js";

/** Placeholder — real social auto-post (Meta/X/LinkedIn) lands in Phase 2. */
export class SocialAgent extends Agent {
  type = "social";
  async run(job: Job<AgentJobData>) {
    await new Promise((r) => setTimeout(r, 800));
    return { note: "stub — Phase 2 wires in real social platform posting", input: job.data };
  }
}
