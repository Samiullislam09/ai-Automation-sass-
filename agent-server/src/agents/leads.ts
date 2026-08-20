import type { Job } from "pg-boss";
import { Agent, type AgentJobData } from "./base.js";

/** Placeholder — real Lead Hunter (Google Places + email-finder + scoring) lands in Phase 3. */
export class LeadsAgent extends Agent {
  type = "leads";
  async run(job: Job<AgentJobData>) {
    await new Promise((r) => setTimeout(r, 800));
    return { note: "stub — Phase 3 wires in the real Lead Hunter agent", input: job.data };
  }
}
