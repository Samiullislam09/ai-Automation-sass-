import type { Job } from "pg-boss";
import { Agent, type AgentJobData } from "./base.js";
import { writeArticle, type WriterContext } from "../lib/writer.js";
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

    // Ground the draft in THIS business: its niche, audience, tone and its own crawled
    // pages (for real internal links). Without this the model wrote generic filler that
    // could have belonged to any company.
    const context = await loadWriterContext(tenantId);

    const body = await writeArticle(topic.trim(), blueprint, context);
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
        meta: {
          wordCount: gate.wordCount,
          sections: gate.sections,
          links: gate.links,
          qualityGate: gate,
          // What the draft was actually grounded in — so "why did it write this?" is answerable.
          contextUsed: {
            niche: !!context.niche,
            audience: !!context.audience,
            tone: !!context.tone,
            pages: context.pages?.length ?? 0,
          },
        },
      })
      .select("id")
      .single();
    if (error) console.error("[writer] failed to save content_items row:", error.message);

    return {
      topic,
      title,
      blueprint: blueprint ?? null,
      body,
      wordCount: gate.wordCount,
      contentItemId: item?.id,
      qualityGate: gate,
    };
  }
}

async function loadWriterContext(tenantId: string): Promise<WriterContext> {
  try {
    const [{ data: tenant }, { data: pages }] = await Promise.all([
      supabase.from("tenants").select("name, website_url, niche, tone_profile, icp_profile").eq("id", tenantId).single(),
      supabase.from("site_pages").select("title, url").eq("tenant_id", tenantId).limit(12),
    ]);
    const tone = (tenant?.tone_profile as any) ?? {};
    const icp = (tenant?.icp_profile as any) ?? {};
    return {
      businessName: tenant?.name ?? null,
      websiteUrl: tenant?.website_url ?? null,
      niche: tenant?.niche ?? null,
      audience: tone.audience ?? icp.businessType ?? null,
      tone: tone.tone ?? null,
      pages: (pages ?? []).filter((p: any) => p.title && p.url).map((p: any) => ({ title: p.title, url: p.url })),
    };
  } catch (e: any) {
    // Context is an improvement, not a prerequisite — a lookup failure must not cost the
    // user their article. The draft is simply less specific, and meta.contextUsed says so.
    console.error("[writer] could not load business context:", e?.message);
    return {};
  }
}
