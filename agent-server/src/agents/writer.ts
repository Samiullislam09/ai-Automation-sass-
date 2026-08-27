import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { writeArticle, type WriterContext } from "../lib/writer.js";
import { gateArticle, extractTitle, summarizeGate } from "../lib/qualityGate.js";
import { supabase } from "../supabase.js";
import { loadInsights, writerBlock } from "../lib/insights.js";
import { buildBlueprint, type Research } from "../lib/blueprint.js";
import { publishContentItem } from "../lib/publish.js";

/** Build Guide Step 11 — Mr. Writer drafts the article.
 *  Currently runs on NVIDIA (Lightning tier) as a temporary stand-in for the
 *  guide's intended Frontier-tier model — see the big comment in lib/writer.ts
 *  for exactly what to change before production.
 *
 *  AUTO-PUBLISH (`autoPublish`, set by the scheduler via migration 014's schedules.auto_publish):
 *  the draft goes straight to the customer's site instead of waiting in Approvals. Two rules
 *  it must never break — the quality gate still decides (a failed draft is never published,
 *  approval in advance was for good articles), and a publish that FAILS falls back to
 *  Approvals with meta.publishError set. A failed publish that looked like a success would be
 *  the worst outcome available: the customer believes an article is live, and it is nowhere. */
export class WriterAgent extends Agent {
  type = "writer";
  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;
    let topic = (job.data as any).topic as string | undefined;
    let blueprint = (job.data as any).blueprint as string | undefined;
    const choiceId = (job.data as any).choiceId as string | undefined;
    const autoPublish = (job.data as any).autoPublish === true;
    // Stamped on the content_items row so /app/schedule can list exactly which articles came
    // out of which scheduled run, by id rather than by "written around the same time".
    const scheduleRunId = (job.data as any).scheduleRunId as string | undefined;

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
    // The topic IS the primary keyword: buildBlueprint() writes it as "Primary keyword: …"
    // and the writer is told to answer it in the first 100 words. No meta title/description
    // exist in the job yet, so those gate checks stay off until something produces them.
    const gate = gateArticle(body, { primaryKeyword: topic.trim() });
    const title = extractTitle(body, topic.trim());
    console.log(`[writer] "${title}" — ${summarizeGate(gate)}`);

    const meta: Record<string, unknown> = {
      wordCount: gate.wordCount,
      sections: gate.sections,
      links: gate.links,
      // Full v2 gate (score, checks[], warnings[]) lives here; describeJob reads
      // detail.qualityGate.{passed,reasons,wordCount,sections,links} exactly as before.
      qualityGate: gate,
      qualityScore: gate.score,
      scheduleRunId: scheduleRunId ?? null,
      // What the draft was actually grounded in — so "why did it write this?" is answerable.
      contextUsed: {
        niche: !!context.niche,
        audience: !!context.audience,
        tone: !!context.tone,
        pages: context.pages?.length ?? 0,
        searchConsole: !!context.searchEvidence,
      },
    };

    // Step 12 — land the draft in content_items so the real Approvals page (not the old
    // demo's fake local state) has something to show. A gate failure still gets a row
    // (status: 'failed') so it's visible/debuggable rather than silently vanishing.
    //
    // The row is written as awaiting_approval even when this run auto-publishes, and only
    // moved to 'published' once the site has actually accepted it. Written the other way
    // round, a crash between insert and delivery would leave a row claiming to be live on a
    // site that never received it.
    const { data: item, error } = await supabase
      .from("content_items")
      .insert({
        tenant_id: tenantId,
        type: "article",
        status: gate.passed ? "awaiting_approval" : "failed",
        title,
        body,
        blueprint: blueprint ? { text: blueprint } : {},
        meta,
      })
      .select("id")
      .single();
    if (error) console.error("[writer] failed to save content_items row:", error.message);

    let publishing: PublishOutcome = { attempted: false };
    if (autoPublish && gate.passed && item?.id) {
      publishing = await autoPublishItem(tenantId, { id: String(item.id), title, body, type: "article" }, meta);
    } else if (autoPublish && gate.passed && !item?.id) {
      // Nothing to publish: the row it would point at does not exist. Say so instead of
      // shipping an article the customer can never find again in the app.
      publishing = { attempted: true, published: false, error: `Draft could not be saved (${error?.message ?? "unknown"}), so it was not published.` };
    } else if (autoPublish && !gate.passed) {
      publishing = { attempted: false, blockedByGate: true };
    }

    return {
      topic,
      chosenBy,
      title,
      blueprint: blueprint ?? null,
      body,
      wordCount: gate.wordCount,
      contentItemId: item?.id,
      qualityGate: gate,
      scheduleRunId: scheduleRunId ?? null,
      autoPublish,
      // Read by lib/dashboard-data.ts describeJob() — this is how the receipt gets to say
      // "published straight to your site" or, just as loudly, that it could not be.
      ...publishing,
    };
  }
}

/** What happened to the auto-publish attempt, flattened into the job's return value.
 *  `attempted:false` covers both "not that kind of run" and "the gate stopped it". */
type PublishOutcome = {
  attempted: boolean;
  published?: boolean;
  publishedUrl?: string | null;
  error?: string;
  blockedByGate?: boolean;
};

/** Publish now, and leave the row telling the truth either way.
 *  Success: status 'published' + meta.publishedUrl. Failure: the row STAYS awaiting_approval
 *  with meta.publishError, so the article is one click from being published by hand rather
 *  than lost — 'failed' would bury a perfectly good draft over a network blip. */
async function autoPublishItem(
  tenantId: string,
  item: { id: string; title: string; body: string; type: string },
  meta: Record<string, unknown>
): Promise<PublishOutcome> {
  const result = await publishContentItem(tenantId, item);

  if (result.ok) {
    const { error } = await supabase
      .from("content_items")
      .update({ status: "published", meta: { ...meta, publishedUrl: result.url ?? null, autoPublished: true } })
      .eq("id", item.id)
      .eq("tenant_id", tenantId);
    if (error) {
      // Live on the site, wrong in our database. The customer must not be told it worked.
      console.error("[writer] published but could not update the row:", error.message);
      return { attempted: true, published: true, publishedUrl: result.url ?? null, error: `Published to your site, but the record here could not be updated: ${error.message}` };
    }
    console.log(`[writer] auto-published "${item.title}"${result.url ? ` -> ${result.url}` : ""}`);
    return { attempted: true, published: true, publishedUrl: result.url ?? null };
  }

  await supabase
    .from("content_items")
    .update({ meta: { ...meta, publishError: result.error, autoPublished: false } })
    .eq("id", item.id)
    .eq("tenant_id", tenantId);
  console.error(`[writer] auto-publish failed for "${item.title}": ${result.error}`);
  return { attempted: true, published: false, error: result.error };
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
