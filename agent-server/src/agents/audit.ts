import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { auditSite, summarizeAudit, topIssues, type AuditIssue, type AuditPage, type AuditResult } from "../lib/audit/checks.js";
import { auditTarget, chooseUrls, fetchAllPages, fetchSiteContext, DEFAULT_PAGE_LIMIT } from "../lib/audit/fetchSite.js";
import { runPerformanceAudit, issuesFromVitals, type PageVitals, type PerformanceRun } from "../lib/audit/performance.js";
import { aiSearchAccess } from "../lib/audit/robots.js";
import { supabase } from "../supabase.js";

/** §17.3's "top 10 pages" for the browser-based performance pass — the homepage plus a handful
 *  of others, never the whole site: each page costs 10-20s of real Chrome time, and the
 *  deterministic catalogue above already covers every page for everything a browser is not
 *  needed for. */
const PERFORMANCE_PAGE_LIMIT = 10;
/** Absolute ceiling on the loading-speed phase (performance.ts's own 5-minute budget + slack). */
const PERF_PHASE_CEILING_MS = 7 * 60_000;

/** Mr. Audit — "is anything on my site broken or quietly costing me traffic?" (§7.4).
 *
 *  The one agent that looks at the site as a whole rather than at one page. Two of its findings
 *  cannot exist per-page at all — duplicate titles and orphan pages are relationships between
 *  pages — which is the reason it is not Mr. SEO in a loop.
 *
 *  THE SHAPE OF A RUN
 *    1. work out what to audit: the sitemap if the site has one (it is the site's own statement
 *       of what matters), otherwise the pages we already crawled, otherwise the home page;
 *    2. fetch them one at a time, politely, reporting each one to the workspace (§24);
 *    3. run the deterministic catalogue (lib/audit/checks.ts) on every page fetched;
 *    4. run real Lighthouse (lib/audit/performance.ts) against a SAMPLE of them — real Chrome,
 *       so this step is capped at §17.3's "top 10 pages", not every page;
 *    5. write the whole report to `site_audits` with the previous score copied in, so a report
 *       renders identically in six months and the trend arrow needs no window function;
 *    6. return the top five issues in plain language — §7.4's exit criterion is "3 min me
 *       top-5 issues chat me", not a 40-row table nobody reads.
 *
 *  WHAT IT WILL NOT DO
 *   · It will not invent a performance score. Real Core Web Vitals come from step 4 (a real
 *     headless Chrome, `lighthouse`); if that browser cannot be launched on this deploy, the
 *     report says so in words (`skipped`) rather than deriving a plausible number from HTML
 *     size — the gap moved from "nobody built it" (2026-08-27) to "this specific deploy has no
 *     Chrome binary" (2026-08-28, see docs/MANUAL_STEPS.md), and both are told honestly.
 *   · It will not change anything. Every issue is a finding plus a fix; acting on one is a
 *     separate, human-approved decision.
 *   · It will not fail the run because the site is broken. An unreachable site IS the audit's
 *     answer, and it is reported as findings with a score, not as a job that crashed.
 */
export class AuditAgent extends Agent {
  type = "audit";

  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;
    const d = job.data as Record<string, any>;
    const limit = Math.max(1, Math.min(200, Number(d.pages) || DEFAULT_PAGE_LIMIT));
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    ctx.onProgress({ phase: "target", label: "Finding your site…" });
    ctx.progress(0.03, "Finding your site");

    const { data: tenant } = await supabase.from("tenants").select("website_url").eq("id", tenantId).single();
    const target = auditTarget(tenant?.website_url);
    if (!target.ok) {
      // Returned, not thrown: nothing here is retryable and the fix is a sentence from the
      // user. Same contract the leads agent uses for a missing ICP.
      ctx.log(target.reason, "warn");
      return { audited: false, question: target.reason, score: null, issues: [] };
    }

    ctx.onProgress({ phase: "map", label: "Reading robots.txt and your sitemap…" });
    ctx.progress(0.08, "Reading robots.txt and your sitemap");

    const site = await fetchSiteContext(target.origin);
    ctx.log(site.sitemapUrls ? `Sitemap lists ${site.sitemapUrls.length} pages.` : "No sitemap found — auditing the pages we already know about.");

    const { data: crawledRows } = await supabase.from("site_pages").select("url").eq("tenant_id", tenantId).limit(limit * 2);
    const urls = chooseUrls(target.origin, site.sitemapUrls, (crawledRows ?? []).map((r: any) => String(r.url)), limit);

    ctx.onProgress({ phase: "fetch", label: `Checking ${urls.length} pages…`, done: 0, total: urls.length, at: new Date().toISOString() });

    const pages = await fetchAllPages(urls, (done, total, url) => {
      // Every page, as it happens — this is what turns the workspace into a thing you watch
      // rather than a spinner (§24.4b). The renderer keys off `kind: "page"`.
      ctx.data("page", { url, done, total });
      ctx.progress(0.1 + 0.75 * (done / Math.max(1, total)), `Checked ${done} of ${total} pages`);
      // …and into jobs_log (throttled by workers.ts), which is what the Audit page's own
      // progress bar reads (2026-09-04) — `ctx.progress` above only reaches the live channel,
      // and only for brain tasks; a manual audit is not one. `at` lets the reader tell a run
      // that is still moving from one that has stopped writing.
      ctx.onProgress({ phase: "fetch", label: `Checked ${done} of ${total} pages`, done, total, at: new Date().toISOString() });
    });

    /* ── STAGE 1: file the report from the crawl alone, BEFORE the browser phase ─────────────
     *
     * Railway killed this process out of memory three times on 2026-09-05, every time inside
     * Lighthouse, and every time the 156-page crawl and its 40+ checks died with it — nothing
     * was filed. So the deterministic report is written first (score, issues, pages, catalogue;
     * `performancePending: true`, and a skipped line that says the speed check is still
     * running). Stage 2 below measures speed and UPDATES this same row. If stage 2 never
     * returns, the customer still has a complete audit minus one section, and the section says
     * so — the report page reads `performancePending` and tells the truth about it. */
    ctx.onProgress({ phase: "checks", label: "Looking for problems…", at: new Date().toISOString() });
    ctx.progress(0.85, "Looking for problems");

    const trigger: "manual" | "schedule" = d.source === "schedule" ? "schedule" : "manual";
    const previous = await previousScore(tenantId);
    const aiSearch = aiSearchAccess(site.robotsTxt);

    const stage1 = auditSite(pages, site, {
      issues: [],
      skippedReason: "Loading speed (Core Web Vitals) is being measured now — this report updates itself when that finishes.",
    });
    for (const issue of stage1.issues) ctx.data("issue", issue);
    ctx.data("score", { score: stage1.score, blocks: stage1.blocks, warns: stage1.warns, pages: stage1.pagesChecked });

    const { data: saved, error: saveError } = await supabase
      .from("site_audits")
      .insert(auditRow(tenantId, stage1, previous, [], true, { startedAt, t0, limit, trigger, websiteUrl: target.origin, pages, aiSearch }))
      .select("id")
      .single();
    if (saveError) {
      // The audit is real whether or not it was filed. Losing the report is worth a loud log
      // and a note to the user; it is not worth throwing away three minutes of measurement.
      console.error("[audit] could not save the report:", saveError.message);
      ctx.log(`The audit ran but the report could not be saved: ${saveError.message}`, "error");
    } else {
      ctx.log(`Report filed (score ${stage1.score}/100, ${stage1.pagesChecked} pages) — now measuring loading speed.`);
    }

    /* ── STAGE 2: real Chrome, on a sample, updating the row above ───────────────────────── */

    // Homepage first (always in the sample), then whichever other pages were already fetched —
    // not necessarily "latest articles" (nothing here knows publish dates), but the same "the
    // pages that matter most" bias fetchAllPages/chooseUrls already applied upstream.
    const perfUrls = [target.origin, ...urls.filter((u) => u !== target.origin)].slice(0, PERFORMANCE_PAGE_LIMIT);
    ctx.onProgress({ phase: "perf", label: `Measuring loading speed on ${perfUrls.length} pages…`, done: 0, total: perfUrls.length, at: new Date().toISOString() });
    ctx.progress(0.9, "Measuring loading speed");

    // performance.ts has its own per-page and whole-run ceilings; this outer one is the last
    // line — if even those fail to return, the audit still files its report without a speed
    // section rather than sitting here until pg-boss expires it (which is exactly what every
    // audit did on 2026-09-04).
    const perfGuard = new Promise<PerformanceRun>((resolve) =>
      setTimeout(() => resolve({ ran: false, skippedReason: "Loading speed could not be measured this run — the browser stopped answering and the audit went on without it.", pages: [] }), PERF_PHASE_CEILING_MS),
    );
    const perf: PerformanceRun = await Promise.race([
      runPerformanceAudit(perfUrls, (done, total, url) => {
        ctx.data("page", { url, done, total, phase: "perf" });
        ctx.onProgress({ phase: "perf", label: `Measured loading speed on ${done} of ${total} pages`, done, total, at: new Date().toISOString() });
      }).catch((e: any) => ({
        ran: false,
        skippedReason: `Loading speed check crashed rather than measuring anything: ${e?.message ?? "unknown error"}.`,
        pages: [],
      })),
      perfGuard,
    ]);
    if (perf.ran) ctx.log(`Measured loading speed on ${perf.pages.filter((p) => p.ok).length} of ${perf.pages.length} page(s).`);
    else if (perf.skippedReason) ctx.log(perf.skippedReason, "warn");

    ctx.onProgress({ phase: "checks", label: "Adding loading speed to the report…", at: new Date().toISOString() });
    ctx.progress(0.97, "Adding loading speed to the report");

    // Same catalogue, now with the real vitals folded in — the score can only move by the
    // performance issues (slow-lcp / layout-shift / slow-interactivity), never by anything
    // that changed underneath: the pages are the same objects stage 1 judged.
    const result = auditSite(pages, site, {
      issues: issuesFromVitals(perf.pages),
      skippedReason: perf.ran ? null : perf.skippedReason,
    });
    for (const issue of result.issues) if (!stage1.issues.some((i) => i.id === issue.id)) ctx.data("issue", issue);
    ctx.data("score", { score: result.score, blocks: result.blocks, warns: result.warns, pages: result.pagesChecked });
    const summary = summarizeAudit(result, previous);

    if (saved?.id) {
      const { error: updateError } = await supabase
        .from("site_audits")
        .update(auditRow(tenantId, result, previous, perf.pages, false, { startedAt, t0, limit, trigger, websiteUrl: target.origin, pages, aiSearch }))
        .eq("id", saved.id);
      if (updateError) {
        console.error("[audit] report filed but the loading-speed update failed:", updateError.message);
        ctx.log(`The report is filed, but the loading-speed section could not be added: ${updateError.message}`, "error");
      }
    }

    ctx.progress(1, "Audit finished");

    return {
      audited: true,
      auditId: saved?.id ?? null,
      score: result.score,
      previousScore: previous,
      pagesChecked: result.pagesChecked,
      blocks: result.blocks,
      warns: result.warns,
      // §7.4's "top-5 issues plain language me" — the whole list is in the report; this is what
      // goes in the chat card.
      issues: topIssues(result).map(short),
      allIssues: result.issues.length,
      skipped: result.skipped,
      summary,
    };
  }
}

/** The site_audits row, built the same way for stage 1 (insert, no vitals yet) and stage 2
 *  (update, vitals in) — one function so the two can never drift in shape. */
function auditRow(
  tenantId: string,
  result: AuditResult,
  previous: number | null,
  performance: PageVitals[],
  performancePending: boolean,
  meta: { startedAt: string; t0: number; limit: number; trigger: "manual" | "schedule"; websiteUrl: string; pages: AuditPage[]; aiSearch: ReturnType<typeof aiSearchAccess> },
) {
  // A light per-page summary — status, redirect, response time, and (2026-09-05) which of the
  // report's OWN two exact sets a page falls in (`result.pagesWithIssues`/`blockedPages` —
  // never approximated, see checks.ts's own comment on those fields) plus checks.ts's
  // per-page `pageStats` for the Statistics tab — never the full `html`/`bytes` (that stays
  // transient; checks.ts's network-free reasoning applies here too). null on a page with no
  // HTML (a 404, a PDF, a timeout): not measured, not zero.
  const issuePages = new Set(result.pagesWithIssues);
  const blockedPages = new Set(result.blockedPages);
  const stats = new Map(result.pageStats.map((s) => [s.url, s]));
  const pageSummary = meta.pages.map((p) => {
    const st = stats.get(p.url) ?? null;
    return {
      url: p.url,
      status: p.status,
      redirectedTo: p.finalUrl && p.finalUrl !== p.url ? p.finalUrl : null,
      ms: p.ms,
      error: p.error ?? null,
      hasIssue: issuePages.has(p.url),
      blocked: blockedPages.has(p.url),
      depth: st ? st.depth : null,
      titleChars: st ? st.titleChars : null,
      descriptionChars: st ? st.descriptionChars : null,
      words: st ? st.words : null,
      inLinks: st ? st.inLinks : null,
      outLinks: st ? st.outLinks : null,
    };
  });

  return {
    tenant_id: tenantId,
    score: result.score,
    previous_score: previous,
    pages_checked: result.pagesChecked,
    blocks: result.blocks,
    warns: result.warns,
    issues: result.issues,
    run: {
      started_at: meta.startedAt,
      finished_at: new Date().toISOString(),
      seconds: Math.round((Date.now() - meta.t0) / 1000),
      limit: meta.limit,
      skipped: result.skipped,
      // Who asked for this run — the scheduler's weekly sweep or a person. Anything
      // unrecognised defaults to "manual" rather than claiming a schedule that did not happen.
      trigger: meta.trigger,
      // The real domain, for the report page's own big heading.
      websiteUrl: meta.websiteUrl,
      pages: pageSummary,
      // Per-page LCP/CLS/TBT — the derived issues are in `issues` above; this is the raw
      // numbers behind them. Empty in stage 1.
      performance,
      // True between stage 1 and stage 2. A row that still says true long after
      // `started_at` is a run whose browser phase never came back (OOM, restart) — the report
      // page says exactly that instead of "0 of 0 pages measured".
      performancePending,
      // Real, named-bot robots.txt evaluation — null only when robots.txt could not be read.
      aiSearch: meta.aiSearch,
      // Every check this run COULD have made, with its category — the exact denominator the
      // report page's thematic rings divide by (MASTER_PLAN §27). Stored per run.
      catalogue: result.catalogue,
    },
    summary: summarizeAudit(result, previous),
  };
}

/** The chat card's row: what is wrong, what to do, how many pages. Not the full issue — the
 *  page list belongs on the report page, and a chat card with 40 URLs in it is a wall. */
function short(i: AuditIssue) {
  return { id: i.id, severity: i.severity, what: i.what, fix: i.fix, pages: i.count };
}

async function previousScore(tenantId: string): Promise<number | null> {
  const { data } = await supabase
    .from("site_audits")
    .select("score")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const n = Number(data?.score);
  return Number.isFinite(n) ? n : null;
}
