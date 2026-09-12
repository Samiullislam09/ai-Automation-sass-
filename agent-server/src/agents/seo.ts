import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { runSeoChecks, summarizeSeo, SEO_PASS_SCORE, type SeoResult, type CrawledPage } from "../lib/seoChecks.js";
import { reviseArticle, nimComplete, type Completer } from "../lib/writerPipeline.js";
import { loadActiveProfile, normalizeProfile, type SiteProfile } from "../lib/siteProfile.js";
import { supabase } from "../supabase.js";

/** Plan §5.5 / §17.2: "re-runs the writer at most twice". Until this file's own rewrite loop
 *  existed, that line described an intention, not a behaviour — see the long comment above
 *  SeoAgent for the exact history (found 2026-08-31, still true as of this comment). */
const MAX_SEO_REVISE_ATTEMPTS = 2;

/** Mr. SEO — the draft's last measured opinion before anyone is asked to approve it.
 *
 *  This is the agent `publish_article` cannot run without: the manifest makes `seo_passed` a
 *  hard need precisely because a page on a customer's live site is the one thing that cannot be
 *  quietly undone, so it does not go up unmeasured (brain/manifests.ts).
 *
 *  WHAT IT DOES, in the plan's own order (§17.2):
 *    1. reads the draft — from the step input, or from `content_items` when given an id;
 *    2. runs lib/seoChecks.ts: ~22 deterministic on-page checks, each with a measured value
 *       and a fix a writer could act on;
 *    3. IF DataForSEO is configured, compares the draft against the live top 10 (word count vs
 *       their median, topics they cover that we do not). Unconfigured ⇒ skipped, said out
 *       loud, never faked, never fatal;
 *    4. emits the score and every issue as it goes, so the workspace renders the checks
 *       happening rather than a spinner (§24);
 *    5. returns `{score, passed, issues}` — exactly the manifest's output shape.
 *
 *  THE REWRITE LOOP (built 2026-09-12 — until now this section described an intention, not a
 *  behaviour; see the same-dated note in documnet/Article_Writing_Rules.md Part 3 for why a
 *  gate with no way to ask for a fix is not actually an enforcement mechanism):
 *    6. IF the checks failed on at least one block-level ("blockers"), this agent calls
 *       Mr. Writer's own `reviseArticle` (lib/writerPipeline.ts — the exact function
 *       qualityGate.ts's retry loop uses) with those blocker sentences, capped at
 *       MAX_SEO_REVISE_ATTEMPTS (2, matching plan §5.5/§17.2's own number), re-running the SEO
 *       checks after each attempt;
 *    7. the FINAL result (after however many rewrite attempts) is what gets returned, saved to
 *       `content_items`, and reported — `sendBackToWriter` now means "still failing after the
 *       loop ran out", not "nobody tried". The loop lives here, in this one agent, rather than
 *       as a job re-enqueue through the orchestrator: it never left this process, so a cap of 2
 *       is trivially real (a local `while`, not a job counter that could be bypassed by two
 *       different callers), and there is no queue-hop latency between "SEO found a problem" and
 *       "the writer is already fixing it".
 *
 *  It still never publishes. It measures, tries a bounded self-fix when the measurement fails,
 *  and reports the outcome either way. Mr. Publish has its own pre-flight (§7.5) and does not
 *  trust this one blindly.
 */
/** The buckets the live SEO screen draws one bar each for. `lib/seoChecks.ts` has no category
 *  field on its checks — only comment bands grouping them — so the grouping lives here, keyed on
 *  the check ids that file already exports as its stable contract ("Stable id — the UI, the trend
 *  and the tests key off this, never off the prose"). Order is the order the bars appear in. */
const SEO_CATEGORIES: { label: string; match: RegExp }[] = [
  { label: "Title & meta", match: /^(title|meta-description|slug)/ },
  { label: "Headings", match: /^(h1-unique|h2-count|heading-order)/ },
  { label: "Keyword usage", match: /^(keyword-|secondary-keyword|title-keyword)/ },
  { label: "Links", match: /^(internal-links|external-links)/ },
  { label: "Readability", match: /^readability-/ },
  { label: "Trust & authorship", match: /^(eeat-|schema-suggestion|image-alt)/ },
  { label: "Depth vs the top 10", match: /^(serp-|content-depth)/ },
];

export class SeoAgent extends Agent {
  type = "seo";

  // Injectable the same way writerPipeline.ts's own steps take a `Completer` — defaults to the
  // real NVIDIA call in production, and lets seo.test.ts's "no network, no database" contract
  // (this file's own header comment) hold even for the rewrite-loop tests, by passing a fake
  // one instead of hitting a real 20-30s API call on every test run.
  constructor(private reviser: Completer = nimComplete) {
    super();
  }

  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;
    const d = job.data as Record<string, any>;

    ctx.onProgress({ phase: "reading", label: "Reading the draft…" });
    ctx.progress(0.1, "Reading the draft…");

    const draft = await loadDraft(tenantId, d);
    const keywords = readKeywords(d);

    ctx.onProgress({
      phase: "checking",
      label: keywords[0] ? `Checking the draft against "${keywords[0]}"…` : "Running the on-page checks…",
    });
    ctx.progress(0.35, "Running the on-page checks…");

    const site = await loadSiteContext(tenantId, d);

    let body = draft.body;
    let result: SeoResult = await runSeoChecks(
      {
        body,
        title: draft.title,
        metaTitle: draft.metaTitle,
        metaDescription: draft.metaDescription,
        slug: draft.slug,
        jsonLd: draft.jsonLd,
      },
      { keywords, profile: site.profile, pages: site.pages, siteUrl: site.siteUrl },
    );
    console.log(`[seo] "${draft.title ?? "(untitled)"}" first pass — ${summarizeSeo(result)}`);

    // The rewrite loop — see the class comment above for why it lives here rather than as an
    // orchestrator-level job re-enqueue. Only block-level failures are worth a rewrite attempt
    // (the same "warnings are a human's glance, not a retry" rule qualityGate.ts's loop uses);
    // a draft with only warnings is already `passed` and never enters this loop at all.
    let seoReviseAttempts = 0;
    while (!result.passed && result.blockers.length && seoReviseAttempts < MAX_SEO_REVISE_ATTEMPTS) {
      seoReviseAttempts++;
      ctx.onProgress({
        phase: "revising",
        label: `Sending ${result.blockers.length} SEO issue(s) back to the writer (attempt ${seoReviseAttempts}/${MAX_SEO_REVISE_ATTEMPTS})…`,
      });
      ctx.progress(0.5, `Fixing ${result.blockers.length} SEO issue(s)…`);

      try {
        body = await reviseArticle(draft.title ?? keywords[0] ?? "this article", keywords[0] ?? draft.title ?? "the topic", body, result.blockers, this.reviser);
      } catch (e: any) {
        // Same rule as qualityGate.ts's loop: a failed rewrite call keeps the last-known-good
        // body and stops trying, rather than losing the draft or throwing the whole SEO check
        // away over one bad NVIDIA call.
        console.error(`[seo] revise attempt ${seoReviseAttempts} failed, keeping the previous draft:`, e?.message);
        break;
      }

      result = await runSeoChecks(
        { body, title: draft.title, metaTitle: draft.metaTitle, metaDescription: draft.metaDescription, slug: draft.slug, jsonLd: draft.jsonLd },
        { keywords, profile: site.profile, pages: site.pages, siteUrl: site.siteUrl },
      );
      console.log(`[seo] "${draft.title ?? "(untitled)"}" revise ${seoReviseAttempts}/${MAX_SEO_REVISE_ATTEMPTS} — ${summarizeSeo(result)}`);
    }

    // The rewritten body has to actually reach the reader: content_items.body is what Mr.
    // Publish reads, and a chat/queue caller reads it straight off this job's own return value
    // (below). Saving it here, not only in `meta.seo`, is what makes a passed-after-revise
    // draft anything more than a report nobody applied.
    if (seoReviseAttempts > 0 && draft.contentItemId) {
      const { error } = await supabase.from("content_items").update({ body }).eq("id", draft.contentItemId).eq("tenant_id", tenantId);
      if (error) console.error("[seo] revised body could not be saved to content_items:", error.message);
    }

    ctx.progress(0.9, `SEO ${result.score}/100`);
    console.log(`[seo] "${draft.title ?? "(untitled)"}" final — ${summarizeSeo(result)}`);

    // ── what the workspace renders ────────────────────────────────────────────────────────
    // The score first (it is the headline the Approvals card shows), then one event per issue
    // so they appear as a list the user can read down rather than a single blob at the end.
    // One event per user-meaningful thing, never per token — base.ts's rule.
    ctx.data("score", {
      // `label` + `max` are what the workspace's gauge reads (components/WorkspaceRenderers.tsx
      // ScoreBoard): one dial named "SEO" out of 100, moved by the latest event rather than a
      // second dial per run.
      label: "SEO",
      max: 100,
      score: result.score,
      passed: result.passed,
      threshold: SEO_PASS_SCORE,
      blockers: result.blockers.length,
      warnings: result.warnings.length,
      serpCompared: result.serpCompared,
      keyword: result.primaryKeyword,
      wordCount: result.wordCount,
    });
    // Per-category bars for the live screen (owner, 2026-09-11 — the reference design shows the
    // overall score broken down, not one number). Each bucket's value is computed with the SAME
    // arithmetic rollUp() already uses for the overall score (lib/seoChecks.ts: 100 − 25·block
    // − 5·warn, over that bucket's own checks) — a derived number, never an invented one, and
    // `passed`/`total` travel with it so the screen can show what it is made of. Buckets come
    // from the check ids themselves; a check whose id matches no bucket is simply not shown
    // rather than dropped into a catch-all that would make one bar mean nothing.
    for (const bucket of SEO_CATEGORIES) {
      const mine = result.checks.filter((c) => bucket.match.test(c.id));
      if (!mine.length) continue;
      const blocks = mine.filter((c) => !c.ok && c.severity === "block").length;
      const warns = mine.filter((c) => !c.ok && c.severity === "warn").length;
      ctx.data("score_category", {
        label: bucket.label,
        value: Math.max(0, Math.min(100, 100 - blocks * 25 - warns * 5)),
        passed: mine.filter((c) => c.ok).length,
        total: mine.length,
      });
    }
    for (const issue of result.issues) ctx.data("issue", issue);

    if (draft.contentItemId) await saveToContentItem(tenantId, draft.contentItemId, result, seoReviseAttempts);

    ctx.progress(1, result.passed ? `SEO ${result.score}/100 — clear` : `SEO ${result.score}/100 — ${result.issues.length} issue(s) to fix`);

    return {
      // ── the manifest's output (brain/manifests.ts → seo.check_seo) ──────────────────────
      score: result.score,
      passed: result.passed,
      issues: result.issues,
      // ── everything else is context, not contract ───────────────────────────────────────
      checks: result.checks,
      serpCompared: result.serpCompared,
      serpNote: result.serpNote,
      primaryKeyword: result.primaryKeyword,
      wordCount: result.wordCount,
      contentItemId: draft.contentItemId,
      summary: summarizeSeo(result),
      // The revised body, when this run's own loop changed it — a chat/queue caller with no
      // content_items row (loadDraft's inline-body path) has nowhere else to get it back from.
      body: seoReviseAttempts > 0 ? body : undefined,
      // How many of MAX_SEO_REVISE_ATTEMPTS actually ran, 0 when the first pass already passed
      // or nothing failed at block level. Visible rather than silent, same reasoning as
      // agents/writer.ts's own `reviseAttempts` field.
      seoReviseAttempts,
      /** True now means "still failing after the rewrite loop ran its course", not "nobody
       *  tried" — see the class comment's REWRITE LOOP section for what changed 2026-09-12. */
      sendBackToWriter: !result.passed,
    };
  }
}

/* ---------------------------------------------------------------- the draft ------------- */

type Draft = {
  body: string;
  title: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  slug: string | null;
  jsonLd: string | null;
  contentItemId: string | null;
};

/** The article can arrive three ways, and all three are real:
 *   · `article` — the writer step's output, handed straight down by the planner;
 *   · `content_item_id` — "isko publish kar do" on something written yesterday (plan §5.5's
 *     `publish_existing`: seo check first, then publish);
 *   · `body`/`markdown` — a draft posted at the queue directly.
 *  Nothing is guessed: an empty body is an error with a sentence, not a 100/100 on nothing. */
async function loadDraft(tenantId: string, d: Record<string, any>): Promise<Draft> {
  const article = isRecord(d.article) ? d.article : null;
  const itemId = firstString([d.content_item_id, d.contentItemId, article?.contentItemId, article?.content_item_id, article?.id]);

  const inlineBody = firstString([article?.body, article?.markdown, article?.content, d.body, d.markdown]);
  if (inlineBody) {
    return {
      body: inlineBody,
      title: firstString([article?.title, d.title]),
      metaTitle: firstString([article?.metaTitle, article?.meta_title, d.metaTitle]),
      metaDescription: firstString([article?.metaDescription, article?.meta_description, d.metaDescription]),
      slug: firstString([article?.slug, d.slug]),
      jsonLd: firstString([article?.jsonLd, d.jsonLd]),
      contentItemId: itemId,
    };
  }

  if (!itemId) {
    throw new Error(
      "SEO check ke liye article hi nahi mila — na koi draft aaya, na koi content_item_id. " +
        "(Writer step ka output is job me aana chahiye tha.)",
    );
  }

  const { data: item, error } = await supabase
    .from("content_items")
    .select("id, title, body, meta")
    .eq("id", itemId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw new Error(`Draft nahi padha ja saka: ${error.message}`);
  if (!item) throw new Error("Wo draft mila hi nahi — shayad delete ho gaya.");
  if (!String(item.body ?? "").trim()) throw new Error("Draft khaali hai — SEO check karne ko kuch nahi.");

  const meta = isRecord(item.meta) ? (item.meta as Record<string, any>) : {};
  return {
    body: String(item.body),
    title: firstString([item.title]),
    metaTitle: firstString([meta.metaTitle, meta.meta_title]),
    metaDescription: firstString([meta.metaDescription, meta.meta_description]),
    slug: firstString([meta.slug]),
    jsonLd: firstString([meta.jsonLd]),
    contentItemId: String(item.id),
  };
}

/** Keywords arrive as a list, as Mr. Keyword's whole output object, or not at all (the
 *  manifest has them optional). Last resort: the blueprint's own "Primary keyword: …" line,
 *  which is what the writer was actually briefed with — better than checking a draft against
 *  a keyword nobody chose. */
function readKeywords(d: Record<string, any>): string[] {
  const raw = d.keywords ?? (isRecord(d.article) ? d.article.keywords : undefined);
  const out: string[] = [];

  const push = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : typeof (v as any)?.keyword === "string" ? String((v as any).keyword).trim() : "";
    if (s && !out.some((k) => k.toLowerCase() === s.toLowerCase())) out.push(s);
  };

  if (typeof raw === "string") push(raw);
  else if (Array.isArray(raw)) raw.forEach(push);
  else if (isRecord(raw)) {
    push(raw.recommended);
    if (Array.isArray(raw.relatedKeywords)) raw.relatedKeywords.forEach(push);
  }

  if (!out.length) {
    const blueprint = firstString([d.blueprint, isRecord(d.blueprint) ? d.blueprint.text : undefined]);
    const m = blueprint?.match(/^Primary keyword:\s*(.+)$/im);
    if (m) push(m[1]);
  }
  if (!out.length) push(d.topic);
  // Nothing else. A title is not a keyword, and inventing one here would mean scoring the
  // draft against a query nobody is searching for — the keyword checks say "skipped" instead.
  return out;
}

/* ---------------------------------------------------------------- site context ---------- */

type SiteContext = { profile: SiteProfile | null; pages: CrawledPage[]; siteUrl: string | null };

/** The Site Brain and the crawled page list, so "this internal link is real" and "this link is
 *  in the same topic cluster" are answerable. Handed down by the caller when it already has
 *  them; read here otherwise. Never fatal — without them those two checks report themselves as
 *  skipped, which is the honest answer, and every other check is unaffected. */
async function loadSiteContext(tenantId: string, d: Record<string, any>): Promise<SiteContext> {
  const inlineProfile = isRecord(d.profile) ? normalizeProfile(d.profile) : undefined;
  const inlinePages = Array.isArray(d.pages) ? normalizePages(d.pages) : undefined;
  const inlineUrl = firstString([d.siteUrl, d.website_url]);
  if (inlineProfile !== undefined && inlinePages !== undefined) {
    return { profile: inlineProfile, pages: inlinePages, siteUrl: inlineUrl };
  }

  try {
    const [profileRow, pagesRes, tenantRes] = await Promise.all([
      loadActiveProfile(tenantId),
      supabase.from("site_pages").select("url, title").eq("tenant_id", tenantId).limit(300),
      supabase.from("tenants").select("website_url").eq("id", tenantId).maybeSingle(),
    ]);
    return {
      profile: inlineProfile ?? profileRow?.profile ?? null,
      pages: inlinePages ?? normalizePages(pagesRes.data ?? []),
      siteUrl: inlineUrl ?? (tenantRes.data?.website_url ? String(tenantRes.data.website_url) : null),
    };
  } catch (e: any) {
    console.error("[seo] site context unreadable, checking the draft without it:", e?.message);
    return { profile: inlineProfile ?? null, pages: inlinePages ?? [], siteUrl: inlineUrl };
  }
}

function normalizePages(rows: unknown[]): CrawledPage[] {
  return rows
    .map((r) => (isRecord(r) ? { url: String(r.url ?? "").trim(), title: r.title == null ? null : String(r.title) } : { url: "", title: null }))
    .filter((p) => p.url);
}

/* ---------------------------------------------------------------- writeback ------------- */

/** The score belongs on the row the Approvals card reads, so "SEO 82/100" survives the job
 *  log rolling over. Best-effort: a failed write must not fail a check that already ran. */
async function saveToContentItem(tenantId: string, itemId: string, result: SeoResult, seoReviseAttempts = 0): Promise<void> {
  try {
    const { data: row } = await supabase.from("content_items").select("meta").eq("id", itemId).eq("tenant_id", tenantId).maybeSingle();
    const meta = isRecord(row?.meta) ? (row!.meta as Record<string, unknown>) : {};
    const { error } = await supabase
      .from("content_items")
      .update({
        meta: {
          ...meta,
          seo: {
            score: result.score,
            passed: result.passed,
            issues: result.issues,
            // The dashboard's per-category checklist (Keyword Usage, Readability, ...) needs to
            // know what PASSED too, not just what failed — `issues` alone can't tell "checked
            // and fine" from "never measured". Full checklist, same one summarizeSeo() prints.
            checks: result.checks,
            serpCompared: result.serpCompared,
            checkedAt: new Date().toISOString(),
            // How many rewrite attempts it took to reach this result, 0 when the first pass
            // already cleared or nothing failed at block level. Same visibility rule as
            // agents/writer.ts's own reviseAttempts field on the writer's own gate.
            seoReviseAttempts,
          },
          seoScore: result.score,
          seoPassed: result.passed,
        },
      })
      .eq("id", itemId)
      .eq("tenant_id", tenantId);
    if (error) console.error("[seo] could not save the score to content_items:", error.message);
  } catch (e: any) {
    console.error("[seo] could not save the score to content_items:", e?.message);
  }
}

/* ---------------------------------------------------------------- tiny helpers ---------- */

function isRecord(x: unknown): x is Record<string, any> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function firstString(candidates: unknown[]): string | null {
  for (const c of candidates) if (typeof c === "string" && c.trim()) return c.trim();
  return null;
}
