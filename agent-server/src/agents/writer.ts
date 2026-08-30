import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import type { WriterContext } from "../lib/writer.js";
import { writeArticlePipeline, nimComplete } from "../lib/writerPipeline.js";
import { researchTopic } from "../lib/research/gptResearcher.js";
import { gateArticle, summarizeGate } from "../lib/qualityGate.js";
import { supabase } from "../supabase.js";
import { loadInsights, writerBlock } from "../lib/insights.js";
import { buildBlueprint, matchOfferings, nearestCluster, type Research } from "../lib/blueprint.js";
import { publishContentItem } from "../lib/publish.js";
import { loadActiveProfile, profileBlock, type SiteProfile } from "../lib/siteProfile.js";
import { checkDuplicate, type DuplicateVerdict } from "../lib/dedupe.js";
import { brainRefOf } from "../brain/adapter.js";

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
    // The Site Brain, read once and used twice: to rebuild the brief when a choice resolves,
    // and to ground the prompt below. Never fatal — null is the normal state of a tenant whose
    // analyst has not run, and everything downstream of it falls back to what it did before.
    let profile: SiteProfile | null = null;
    try {
      profile = (await loadActiveProfile(tenantId))?.profile ?? null;
    } catch (e: any) {
      console.error("[writer] site profile unreadable, writing without it:", e?.message);
    }

    let chosenBy: "user" | "auto" | null = null;
    if (choiceId) {
      const resolved = await resolveChoice(tenantId, choiceId);
      if (!resolved) throw new Error(`The keyword choice ${choiceId} is gone — nothing was written.`);
      topic = resolved.keyword;
      blueprint = buildBlueprint(resolved.keyword, resolved.research, profile);
      chosenBy = resolved.chosenBy;
      ctx.onProgress({ label: `Writing "${resolved.keyword}" (${chosenBy === "user" ? "you picked it" : "auto-picked"})` });
    }

    if (!topic?.trim()) throw new Error("writer job needs a 'topic' string");

    // ── the duplicate locks, before a single token is spent (§25.5, locks 1 and 3) ────────
    // This is the last gate before an LLM call and a row in content_items, and it is the one
    // that has to hold: everything upstream (chat, planner, scheduler) can and does enqueue
    // the same subject twice. "exists" is NOT a failure — the right answer to "write about ISO
    // 9001 cost" when /iso-9001-cost is already live is to offer to update it, and the update
    // mode itself is Phase 2. We stop, we name the page, we hand the choice back.
    // Exclude THIS job's own task row: the brain flips a task to "running" as soon as its
    // first step starts, so without this a brain-routed order always found itself already
    // "in progress" and refused to write — see dedupe.ts's own comment on findRunningTaskFor.
    const ownTaskId = brainRefOf(job.data)?.task_id ?? null;
    const verdict = await checkDuplicate(tenantId, { title: topic.trim(), topic: topic.trim(), excludeTaskId: ownTaskId });
    if (verdict.status !== "free") {
      const reason = duplicateSentence(verdict);
      ctx.onProgress({ label: reason });
      console.log(`[writer] not writing "${topic.trim()}": ${verdict.status}`);
      // `written: false` is load-bearing: lib/dashboard-data.ts checks it first in describeJob's
      // writer branch, because without that check this result renders as a finished draft
      // waiting for approval — a receipt for work that never happened.
      return {
        topic: topic.trim(),
        written: false,
        duplicate: verdict,
        reason,
        chosenBy,
        scheduleRunId: scheduleRunId ?? null,
      };
    }

    // Ground the draft in THIS business: the Site Brain (what they do, what they sell with
    // real URLs, the proof they may state, their voice), its niche/audience/tone, and its own
    // crawled pages ordered so the ones in this article's own topic cluster come first.
    // Without this the model wrote generic filler that could have belonged to any company.
    const context = await loadWriterContext(tenantId, topic.trim(), profile);

    // Outline → sections in parallel → polish → meta (MASTER_PLAN §16.3 Upgrade E). Sections
    // arrive at the live workspace (§24.4b) AS THEY FINISH, not split out of an already-done
    // draft — ctx.data below fires from writeArticlePipeline's onSection, mid-generation.
    const pipeline = await writeArticlePipeline(topic.trim(), blueprint, context, nimComplete, {
      onSection: (section) => ctx.data("section", { h2: section.h2, words: section.words }),
      researcher: researchTopic,
      onResearch: (result) => ctx.data("research", { used: !!result, sources: result?.sources.length ?? 0 }),
    });
    const body = pipeline.body;
    const title = pipeline.title;

    // The topic IS the primary keyword: buildBlueprint() writes it as "Primary keyword: …"
    // and the writer is told to answer it in the first 100 words. metaTitle/metaDescription
    // now come from the pipeline's own meta step — the checks in qualityGate.ts that scored
    // them have existed since Phase 2 planning began and had nothing to score until today.
    const gate = gateArticle(body, { primaryKeyword: topic.trim(), metaTitle: pipeline.meta.metaTitle, metaDescription: pipeline.meta.metaDescription });
    console.log(`[writer] "${title}" — ${summarizeGate(gate)}`);

    ctx.data("score", { quality: gate.score, passed: gate.passed, words: gate.wordCount, sections: gate.sections });

    const meta: Record<string, unknown> = {
      wordCount: gate.wordCount,
      sections: gate.sections,
      links: gate.links,
      // Full v2 gate (score, checks[], warnings[]) lives here; describeJob reads
      // detail.qualityGate.{passed,reasons,wordCount,sections,links} exactly as before.
      qualityGate: gate,
      qualityScore: gate.score,
      scheduleRunId: scheduleRunId ?? null,
      // Mr. Writer's own meta step (§16.3 Upgrade E) — read by Mr. Publish and Mr. SEO instead
      // of falling back to the H1 and nothing.
      metaTitle: pipeline.meta.metaTitle,
      metaDescription: pipeline.meta.metaDescription,
      slug: pipeline.meta.slug,
      jsonLd: pipeline.meta.jsonLd,
      // What the draft was actually grounded in — so "why did it write this?" is answerable.
      contextUsed: {
        niche: !!context.niche,
        audience: !!context.audience,
        tone: !!context.tone,
        pages: context.pages?.length ?? 0,
        searchConsole: !!context.searchEvidence,
        // §25.3 — was this written for THIS business, or for the topic in the abstract?
        siteBrain: !!context.siteBrain,
        cta: context.cta?.name ?? null,
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
        // §25.5 lock 1 depends on this column being real: findExistingBySlug (lib/dedupe.ts)
        // queries content_items.slug directly, and until the writer's own meta step existed
        // there was nothing to put here — every row's slug stayed null, and the unique index
        // migration 019 added had nothing to enforce. It has something now.
        slug: pipeline.meta.slug || null,
        // migration 021 — the exact string rank-tracking (lib/rankTracking.ts) checks against,
        // captured here because this is the one place it is known exactly, not guessed back
        // out of the title or blueprint prose later.
        primary_keyword: topic.trim(),
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
      meta: pipeline.meta,
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

async function loadWriterContext(tenantId: string, topic: string, profile: SiteProfile | null): Promise<WriterContext> {
  try {
    // 24, not 12: the cluster ordering below needs enough pages to have something to prefer.
    // Only the first 12 ever reach the prompt (lib/writer.ts) — this just decides WHICH 12.
    const [{ data: tenant }, { data: pages }, insights] = await Promise.all([
      supabase.from("tenants").select("name, website_url, niche, tone_profile, icp_profile").eq("id", tenantId).single(),
      supabase.from("site_pages").select("title, url").eq("tenant_id", tenantId).limit(24),
      loadInsights(tenantId),
    ]);
    const tone = (tenant?.tone_profile as any) ?? {};
    const icp = (tenant?.icp_profile as any) ?? {};

    const allPages = (pages ?? []).filter((p: any) => p.title && p.url).map((p: any) => ({ title: String(p.title), url: String(p.url) }));

    // §25.3 — internal links prefer the same topic cluster. The cluster's own page_urls are
    // pulled to the front; everything else keeps its order behind them. A stable partition,
    // not a sort: two pages with equal claim must not swap places between runs.
    const cluster = nearestCluster(topic, profile);
    const clusterUrls = new Set((cluster?.page_urls ?? []).map(normalizeUrl));
    const sameCluster = allPages.filter((p) => clusterUrls.has(normalizeUrl(p.url)));
    const rest = allPages.filter((p) => !clusterUrls.has(normalizeUrl(p.url)));

    // The CTA: the offering whose words match this article's keyword. matchOfferings falls
    // back to the first offering rather than to nothing, because "no match" is exactly when a
    // generic "contact us" used to appear.
    const offering = matchOfferings(topic, profile, 1)[0] ?? null;

    return {
      businessName: tenant?.name ?? null,
      websiteUrl: tenant?.website_url ?? null,
      niche: tenant?.niche ?? null,
      audience: tone.audience ?? icp.businessType ?? null,
      tone: tone.tone ?? null,
      pages: [...sameCluster, ...rest],
      searchEvidence: writerBlock(insights),
      siteBrain: profileBlock(profile, { maxOfferings: 8, maxClusters: 6, maxGaps: 4 }),
      cta: offering ? { name: offering.name, url: offering.url } : null,
    };
  } catch (e: any) {
    // Context is an improvement, not a prerequisite — a lookup failure must not cost the
    // user their article. The draft is simply less specific, and meta.contextUsed says so.
    console.error("[writer] could not load business context:", e?.message);
    return {};
  }
}

/** Trailing slash and case are not a different page. Same normalisation lib/dedupe.ts applies
 *  to slugs, for the same reason: two spellings of one URL must not read as two pages. */
function normalizeUrl(url: string): string {
  return String(url ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

// ── what the user is told when a duplicate stops the article (§25.5) ────────────────────────

/** The sentence a business owner reads instead of a second copy of an article they already
 *  have. It has to do three things, in the product's Hinglish voice: say plainly that nothing
 *  was written, NAME the page that already exists (with its URL, so it is one click away), and
 *  give the choice back — update it, or pick a different angle.
 *
 *  What it deliberately does NOT do is offer to do the update itself. Writer update mode is
 *  Phase 2 (plan §25.8); promising it here would be a button that does nothing.
 *
 *  Exported because agents/boss.ts says the same thing about a suggestion it drops before the
 *  user ever sees it — one wording, one place. */
export function duplicateSentence(verdict: DuplicateVerdict): string {
  if (verdict.status === "in_progress") {
    const what = verdict.label ? `"${verdict.label}"` : "ek job";
    return `Ye topic abhi likha ja raha hai — ${what} already chal raha hai (${verdict.source === "tasks" ? "task" : "job"} ${verdict.task_id}). Maine dobara shuru nahi kiya. Usi ke poora hone ka intezaar karo.`;
  }
  if (verdict.status === "exists") {
    const name = verdict.title ? `"${verdict.title}"` : `"${verdict.slug}"`;
    const where = verdict.where === "site_pages" ? "aapki website par pehle se maujood hai" : "aapke content me pehle se maujood hai";
    const link = verdict.url ? ` — ${verdict.url}` : "";
    return `${name} ${where}${link}. Maine dobara nahi likha, warna aapki hi do pages aapas me compete karte. Do raaste hain: usi page ko update karwao, ya isi topic ka koi naya angle chuno.`;
  }
  return "";
}

