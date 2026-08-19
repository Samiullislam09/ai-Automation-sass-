import type { Job } from "bullmq";
import { Agent, type AgentJobData } from "./base.js";

/** Placeholder — real Writer (DeepSeek/Gemini/Claude adapter) lands in Step 11. */
export class WriterAgent extends Agent {
  type = "writer";
  async run(job: Job<AgentJobData>) {
    await new Promise((r) => setTimeout(r, 800));
    return { note: "stub — Step 11 wires in the real Writer model adapter", input: job.data };
  }
}
