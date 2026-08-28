import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { auditSite, summarizeAudit, topIssues, type AuditIssue } from "../lib/audit/checks.js";
import { auditTarget, chooseUrls, fetchAllPages, fetchSiteContext, DEFAULT_PAGE_LIMIT } from "../lib/audit/fetchSite.js";
import { runPerformanceAudit, issuesFromVitals, type PerformanceRun } from "../lib/audit/performance.js";
import { supabase } from "../supabase.js";

/** §17.3's "top 10 pages" for the browser-based performance pass — the homepage plus a handful
 *  of others, never the whole site: each page costs 10-20s of real Chrome time, and the
 *  deterministic catalogue above already covers every page for everything a browser is not
 *  needed for. */
const PERFORMANCE_PAGE_LIMIT = 10;

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

    ctx.onProgress({ phase: "fetch", label: `Checking ${urls.length} pages…`, total: urls.length });

    const pages = await fetchAllPages(urls, (done, total, url) => {
      // Every page, as it happens — this is what turns the workspace into a thing you watch
      // rather than a spinner (§24.4b). The renderer keys off `kind: "page"`.
      ctx.data("page", { url, done, total });
      ctx.progress(0.1 + 0.75 * (done / Math.max(1, total)), `Checked ${done} of ${total} pages`);
    });

    ctx.onProgress({ phase: "perf", label: "Measuring loading speed…" });
    ctx.progress(0.9, "Measuring loading speed");

    // Homepage first (always in the sample), then whichever other pages were already fetched —
    // not necessarily "latest articles" (nothing here knows publish dates), but the same "the
    // pages that matter most" bias fetchAllPages/chooseUrls already applied upstream.
    const perfUrls = [target.origin, ...urls.filter((u) => u !== target.origin)].slice(0, PERFORMANCE_PAGE_LIMIT);
    const perf: PerformanceRun = await runPerformanceAudit(perfUrls).catch((e: any) => ({
      ran: false,
      skippedReason: `Loading speed check crashed rather than measuring anything: ${e?.message ?? "unknown error"}.`,
      pages: [],
    }));
    if (perf.ran) ctx.log(`Measured loading speed on ${perf.pages.length} page(s).`);
    else if (perf.skippedReason) ctx.log(perf.skippedReason, "warn");

    ctx.onProgress({ phase: "checks", label: "Looking for problems…" });
    ctx.progress(0.95, "Looking for problems");

    const result = auditSite(pages, site, {
      issues: issuesFromVitals(perf.pages),
      skippedReason: perf.ran ? null : perf.skippedReason,
    });
    for (const issue of result.issues) ctx.data("issue", issue);
    ctx.data("score", { score: result.score, blocks: result.blocks, warns: result.warns, pages: result.pagesChecked });

    const previous = await previousScore(tenantId);
    const summary = summarizeAudit(result, previous);

    const seconds = Math.round((Date.now() - t0) / 1000);
    const { data: saved, error } = await supabase
      .from("site_audits")
      .insert({
        tenant_id: tenantId,
        score: result.score,
        previous_score: previous,
        pages_checked: result.pagesChecked,
        blocks: result.blocks,
        warns: result.warns,
        issues: result.issues,
        run: {
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          seconds,
          limit,
          skipped: result.skipped,
          // Per-page LCP/CLS/TBT — the derived issues are in `issues` above; this is the raw
          // numbers behind them, for a future report page that wants to chart them per page.
          performance: perf.pages,
        },
        summary,
      })
      .select("id")
      .single();

    if (error) {
      // The audit is real whether or not it was filed. Losing the report is worth a loud log
      // and a note to the user; it is not worth throwing away three minutes of measurement.
      console.error("[audit] could not save the report:", error.message);
      ctx.log(`The audit ran but the report could not be saved: ${error.message}`, "error");
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
