import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { writeArticle, type WriterContext } from "../lib/writer.js";
import { gateArticle, extractTitle } from "../lib/qualityGate.js";
import { supabase } from "../supabase.js";
import { loadInsights, writerBlock } from "../lib/insights.js";
import { buildBlueprint, type Research } from "../lib/blueprint.js";

/** Build Guide Step 11 — Mr. Writer drafts the article.
 *  Currently runs on NVIDIA (Lightning tier) as a temporary stand-in for the
 *  guide's intended Frontier-tier model — see the big comment in lib/writer.ts
 *  for exactly what to change before production. */
export class WriterAgent extends Agent {
  type = "writer";
  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;
    let topic = (job.data as any).topic as string | undefined;
    let blueprint = (job.data as any).blueprint as string | undefined;
    const choiceId = (job.data as any).choiceId as string | undefined;

    // Scheduled behind a keyword choice: the human had a window to pick, and this is where we
    // find out what they picked. The blueprint is rebuilt for the keyword that actually won —
    // reusing the recommended one's brief would write about the wrong thing.
    let chosenBy: "user" | "auto" | null = null;
    if (choiceId) {
      const resolved = await resolveChoice(tenantId, choiceId);
      if (!resolved) throw new Error(`The keyword choice ${choiceId} is gone — nothing was written.`);
      topic = resolved.keyword;
      blueprint = buildBlueprint(resolved.keyword, resolved.research);
      chosenBy = resolved.chosenBy;
      ctx.onProgress({ label: `Writing "${resolved.keyword}" (${chosenBy === "user" ? "you picked it" : "auto-picked"})` });
    }

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
            searchConsole: !!context.searchEvidence,
          },
        },
      })
      .select("id")
      .single();
    if (error) console.error("[writer] failed to save content_items row:", error.message);

    return {
      topic,
      chosenBy,
      title,
      blueprint: blueprint ?? null,
      body,
      wordCount: gate.wordCount,
      contentItemId: item?.id,
      qualityGate: gate,
    };
  }
}

/** Reads the choice the human was given, marks it used, and reports which way it went.
 *  Marking it used is what stops the dashboard showing a countdown for an article that has
 *  already started being written. */
async function resolveChoice(
  tenantId: string,
  choiceId: string
): Promise<{ keyword: string; research: Research; chosenBy: "user" | "auto" } | null> {
  const { data, error } = await supabase
    .from("keyword_choices")
    .select("recommended, chosen, research, status")
    .eq("id", choiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) {
    console.error("[writer] could not read keyword choice:", error?.message ?? "not found");
    return null;
  }

  const chosenBy: "user" | "auto" = data.chosen ? "user" : "auto";
  const keyword = (data.chosen as string) || (data.recommended as string);

  await supabase
    .from("keyword_choices")
    .update({ status: "used", chosen: keyword, chosen_by: chosenBy })
    .eq("id", choiceId)
    .eq("tenant_id", tenantId);

  return { keyword, research: (data.research ?? {}) as Research, chosenBy };
}

async function loadWriterContext(tenantId: string): Promise<WriterContext> {
  try {
    const [{ data: tenant }, { data: pages }, insights] = await Promise.all([
      supabase.from("tenants").select("name, website_url, niche, tone_profile, icp_profile").eq("id", tenantId).single(),
      supabase.from("site_pages").select("title, url").eq("tenant_id", tenantId).limit(12),
      loadInsights(tenantId),
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
      searchEvidence: writerBlock(insights),
    };
  } catch (e: any) {
    // Context is an improvement, not a prerequisite — a lookup failure must not cost the
    // user their article. The draft is simply less specific, and meta.contextUsed says so.
    console.error("[writer] could not load business context:", e?.message);
    return {};
  }
}
