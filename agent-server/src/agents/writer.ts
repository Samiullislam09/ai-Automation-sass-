import type { Job } from "pg-boss";
import { Agent, type AgentJobData } from "./base.js";
import { writeArticle } from "../lib/writer.js";
import { gateArticle, extractTitle } from "../lib/qualityGate.js";
import { supabase } from "../supabase.js";

/** Build Guide Step 11 — Mr. Writer drafts the article.
 *  Currently runs on NVIDIA (Lightning tier) as a temporary stand-in for the
 *  guide's intended Frontier-tier model — see the big comment in lib/writer.ts
 *  for exactly what to change before production. */
export class WriterAgent extends Agent {
  type = "writer";
  async run(job: Job<AgentJobData>) {
    const { tenantId } = job.data;
    const topic = (job.data as any).topic as string | undefined;
    const blueprint = (job.data as any).blueprint as string | undefined;
    if (!topic?.trim()) throw new Error("writer job needs a 'topic' string");

    const body = await writeArticle(topic.trim(), blueprint);
    const gate = gateArticle(body);
    const title = extractTitle(body, topic.trim());

    // Step 12 — land the draft in content_items so the real Approvals page (not the old
    // demo's fake local state) has something to show. A gate failure still gets a row
    // (status: 'failed') so it's visible/debuggable rather than silently vanishing.
    const { data: item, error } = await supabase
      .from("content_items")
      .insert({
        tenant_id: tenantId,
        type: "article",
        status: gate.passed ? "awaiting_approval" : "failed",
        title,
        body,
        blueprint: blueprint ? { text: blueprint } : {},
        meta: { wordCount: gate.wordCount, sections: gate.sections, links: gate.links, qualityGate: gate },
      })
      .select("id")
      .single();
    if (error) console.error("[writer] failed to save content_items row:", error.message);

    return { topic, blueprint: blueprint ?? null, body, wordCount: gate.wordCount, contentItemId: item?.id, qualityGate: gate };
  }
}
