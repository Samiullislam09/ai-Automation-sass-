import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { runSeoChecks, summarizeSeo, SEO_PASS_SCORE, type SeoResult, type CrawledPage } from "../lib/seoChecks.js";
import { loadActiveProfile, normalizeProfile, type SiteProfile } from "../lib/siteProfile.js";
import { supabase } from "../supabase.js";

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
 *  WHAT IT DELIBERATELY DOES NOT DO: it does not send the draft back to the writer. A failing
 *  score means `passed:false` plus the issues, and the ORCHESTRATOR decides what happens next —
 *  §5.5/§17.2 cap that at two writer loops, and a cap only works if one place counts. An agent
 *  that re-queued its own upstream could loop forever and bill for every turn.
 *
 *  It also never publishes and never edits the draft. It measures, and it says what it
 *  measured. Mr. Publish has its own pre-flight (§7.5) and does not trust this one blindly.
 */
export class SeoAgent extends Agent {
  type = "seo";

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

    const result: SeoResult = await runSeoChecks(
      {
        body: draft.body,
        title: draft.title,
        metaTitle: draft.metaTitle,
        metaDescription: draft.metaDescription,
        slug: draft.slug,
      },
      { keywords, profile: site.profile, pages: site.pages, siteUrl: site.siteUrl },
    );

    ctx.progress(0.9, `SEO ${result.score}/100`);
    console.log(`[seo] "${draft.title ?? "(untitled)"}" — ${summarizeSeo(result)}`);

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
    for (const issue of result.issues) ctx.data("issue", issue);

    if (draft.contentItemId) await saveToContentItem(tenantId, draft.contentItemId, result);

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
      /** The decision, not the loop: whoever owns the plan re-runs the writer at most twice
       *  (plan §5.5). This agent only ever reports. */
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
async function saveToContentItem(tenantId: string, itemId: string, result: SeoResult): Promise<void> {
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
