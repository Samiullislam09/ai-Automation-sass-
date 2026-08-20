import type { Job } from "bullmq";
import { Agent, type AgentJobData } from "./base.js";
import { writeArticle } from "../lib/writer.js";

/** Build Guide Step 11 — Mr. Writer drafts the article.
 *  Currently runs on NVIDIA (Lightning tier) as a temporary stand-in for the
 *  guide's intended Frontier-tier model — see the big comment in lib/writer.ts
 *  for exactly what to change before production. */
export class WriterAgent extends Agent {
  type = "writer";
  async run(job: Job<AgentJobData>) {
    const topic = (job.data as any).topic as string | undefined;
    const blueprint = (job.data as any).blueprint as string | undefined;
    if (!topic?.trim()) throw new Error("writer job needs a 'topic' string");

    const body = await writeArticle(topic.trim(), blueprint);
    const wordCount = body.trim().split(/\s+/).length;

    return { topic, blueprint: blueprint ?? null, body, wordCount };
  }
}
