import type { Job } from "bullmq";
import { Agent, type AgentJobData } from "./base.js";

/** Placeholder — real DataForSEO logic lands in Build Guide Step 9. */
export class KeywordAgent extends Agent {
  type = "keyword";
  async run(job: Job<AgentJobData>) {
    await new Promise((r) => setTimeout(r, 800));
    return { note: "stub — Step 9 wires in real DataForSEO keyword validation", input: job.data };
  }
}
