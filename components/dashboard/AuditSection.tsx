"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

/** /dashboard/audit ("Audit") — same real logic and API calls as the old app/app/audit/page.tsx
 *  (kept verbatim: /api/site-audit, /api/agents/trigger for a manual run, and the two rules
 *  noted there — never show a number nobody measured, never auto-fix anything). Restyled to
 *  the new dashboard theme per the owner's standing instruction (2026-08-29).
 *
 *  Rebuilt 2026-09-05 against 6 real Semrush Site Audit screenshots the owner sent (their own
 *  live account, wca-global.com), own words: "100% same UI... but sirf brand hamara" / "koi
 *  dummy nahi, accurate", and MASTER_PLAN §27 (Semrush's own 100-check list mapped one by one
 *  against what this app really measures). Three rounds so far:
 *   1. AI Search Health / AI Crawler Access were first (wrongly) skipped as a Semrush-only
 *      traffic product; they are a robots.txt DIRECTIVE check and this app already fetches
 *      robots.txt — built for real in agent-server/src/lib/audit/robots.ts.
 *   2. Live-screenshot bugs: a flat-line chart rendering as a solid block, "0 pages" on an
 *      older report, a yellow score gauge (now the brand violet gradient — Semrush's own gauge
 *      never shifts colour by score either), double-padded buttons.
 *   3. (this file) Semrush's own page structure: tabs (Overview / Issues / Crawled Pages /
 *      Progress), "How to fix" in a popup, history collapsed to the last run with a popup for
 *      all of it, Issues grouped by severity with category filter chips, and Thematic Reports
 *      rings — each % is (checks in that category that did NOT fire) / (checks in that category
 *      the run could make), the denominator shipped per run as `catalogue`. Older reports have
 *      no catalogue and say so instead of computing a % over a denominator they don't have.
 *  Still deliberately NOT built: the "Top-10% websites" benchmark (no dataset), Semrush's
 *  proprietary "Content not optimized (AI)" score, and Local SEO — which is not part of Semrush
 *  Site Audit at all (their separate Listing Management tool) and needs a Google Business
 *  Profile integration this app does not have. All recorded in §27, not silently dropped. */

type Severity = "block" | "warn" | "info";
type Issue = { id: string; severity: Severity; what: string; fix: string; pages: string[]; count: number; category?: string };
type CatalogueEntry = { id: string; category: string; severity: Severity };
type PageVitals = { url: string; ok: boolean; error?: string; performanceScore: number | null; lcpMs: number | null; cls: number | null; tbtMs: number | null };
type CrawledPage = {
  url: string;
  status: number | null;
  redirectedTo: string | null;
  ms: number | null;
  error: string | null;
  hasIssue?: boolean;
  blocked?: boolean;
  /** Per-page measurements (agent-server checks.ts `pageStats`, stored since 2026-09-05) for
   *  the Statistics tab. Absent on older reports; null on a page with no HTML (not measured). */
  depth?: number | null;
  titleChars?: number | null;
  descriptionChars?: number | null;
  words?: number | null;
  inLinks?: number | null;
  outLinks?: number | null;
};
/** One older run, as /api/site-audit?run=<id> returns it for Compare Crawls — issues by id and
 *  count, without page samples. */
type RunLite = { id: string; score: number; blocks: number; warns: number; pagesChecked: number; trigger: Trigger; createdAt: string; issues: { id: string; severity: Severity; what: string; count: number; category: string | null }[] };
type BotAccess = { bot: string; label: string; allowed: boolean };
type Trigger = "manual" | "schedule" | null;

type Report = {
  id: string;
  score: number;
  previousScore: number | null;
  pagesChecked: number;
  blocks: number;
  warns: number;
  issues: Issue[];
  skipped: string[];
  performance: PageVitals[];
  /** True while the browser phase is still running for this report, or forever if it never
   *  came back — the CWV card says which, by age. */
  performancePending?: boolean;
  startedAt?: string | null;
  pages: CrawledPage[];
  websiteUrl: string | null;
  aiSearch: BotAccess[] | null;
  catalogue: CatalogueEntry[];
  /** Per-category health from the report itself (same arithmetic as the score). Empty on
   *  reports from before 2026-09-05; the page then computes the old checks-passed fraction. */
  thematic?: { category: string; health: number; issues: number; checks: number }[];
  trigger: Trigger;
  seconds: number | null;
  summary: string | null;
  createdAt: string;
};

type HistoryRow = { id: string; score: number; blocks: number; warns: number; pagesChecked: number; trigger: Trigger; createdAt: string };
type Payload = { ok: boolean; schemaReady: boolean; latest: Report | null; history: HistoryRow[] };
/** /api/site-audit/status — the audit job as jobs_log has it right now (2026-09-04). */
type AuditJob = {
  id: string;
  status: "queued" | "running" | "success" | "error" | "skipped" | string;
  action: string;
  createdAt: string;
  stalled: boolean;
  progress: { phase: string | null; label: string | null; done: number | null; total: number | null; at: string | null };
  error: { message: string; cause: string | null; hint: string | null; attempt: number | null; attempts: number | null; durationMs: number | null } | null;
};

type Tab = "overview" | "issues" | "pages" | "statistics" | "history";
type Bucket = "Healthy" | "Broken" | "Have issues" | "Redirects" | "Blocked";

const RANK: Record<Severity, number> = { block: 0, warn: 1, info: 2 };
const ISSUES_COLLAPSED_COUNT = 5;
const CACHE_KEY = "lx-site-audit-v1";
const POLL_MS = 3000;
// The server now gives up on a hung page after 75s and on the whole speed phase after 7 min
// (agent-server performance.ts / agents/audit.ts, 2026-09-04), so a real audit is ~2-10 min;
// 15 is the "something else is wrong" line, and /api/site-audit/status's `stalled` usually
// says so first.
const POLL_TIMEOUT_MS = 15 * 60_000;

function tone(score: number): "good" | "ok" | "bad" {
  return score >= 85 ? "good" : score >= 60 ? "ok" : "bad";
}
const TONE_COLOR: Record<string, string> = { good: "#34d399", ok: "#fbbf24", bad: "#f87171" };

/** What a Site Health number means, in words. The score is the average health of the crawled
 *  pages (agent-server checks.ts), so the bands are about how many pages are healthy. */
const HEALTH_BANDS: { min: number; label: string; meaning: string }[] = [
  { min: 90, label: "Excellent", meaning: "Almost every page is healthy." },
  { min: 70, label: "Good", meaning: "Most pages are healthy. A few have warnings or errors." },
  { min: 50, label: "Needs work", meaning: "A large share of your pages have problems." },
  { min: 0, label: "Poor", meaning: "Most pages have errors or cannot be reached. Start with the errors below." },
];
function healthBand(score: number) {
  return HEALTH_BANDS.find((b) => score >= b.min) ?? HEALTH_BANDS[HEALTH_BANDS.length - 1];
}

/** The audit's five phases, in order, with the share of the bar each one owns — the same
 *  fractions agents/audit.ts reports to its live channel, so the bar here and the Workspace
 *  agree. Inside "fetch" and "perf" the bar moves with the real done/total. */
const AUDIT_PHASES: { id: string; label: string; from: number; to: number }[] = [
  { id: "target", label: "Finding your site", from: 0, to: 0.05 },
  { id: "map", label: "Reading robots.txt and sitemap", from: 0.05, to: 0.1 },
  { id: "fetch", label: "Checking pages", from: 0.1, to: 0.8 },
  { id: "perf", label: "Measuring loading speed", from: 0.8, to: 0.95 },
  { id: "checks", label: "Looking for problems", from: 0.95, to: 1 },
];
function jobFraction(p: AuditJob["progress"] | null): number {
  if (!p?.phase) return 0.01;
  const ph = AUDIT_PHASES.find((x) => x.id === p.phase);
  if (!ph) return 0.01;
  const inner = p.total && p.done != null ? Math.min(1, p.done / p.total) : 0;
  return ph.from + (ph.to - ph.from) * inner;
}
const SEV_LABEL: Record<Severity, string> = { block: "Error", warn: "Warning", info: "Notice" };
const SEV_COLOR: Record<Severity, string> = { block: "#f87171", warn: "#fbbf24", info: "var(--lx-mut)" };
const TRIGGER_LABEL: Record<NonNullable<Trigger>, string> = { manual: "Manual", schedule: "Scheduled" };
const BUCKET_COLOR: Record<Bucket, string> = { Healthy: "#34d399", Broken: "#f87171", "Have issues": "#fb923c", Redirects: "#818cf8", Blocked: "var(--lx-mut)" };
const BUCKET_ORDER: Bucket[] = ["Healthy", "Broken", "Have issues", "Redirects", "Blocked"];
const TABS: Tab[] = ["overview", "issues", "pages", "statistics", "history"];

/** Buckets for the Statistics tab's distributions — each edge is the same number the matching
 *  check uses (30/65 title chars are `short-title`/`long-title`, 150 words is `thin-content`,
 *  4,000 is `ai-too-much-content`, 1.5 s is `slow-response`, 3 clicks is `deep-page`), so a
 *  bar here and an issue row there can never disagree about the same page. */
function bucketBy<T>(items: T[], pick: (t: T) => number | null | undefined, edges: { label: string; test: (n: number) => boolean }[], unmeasured = "Not measured"): { label: string; count: number }[] {
  const rows = edges.map((e) => ({ label: e.label, count: 0 }));
  let missing = 0;
  for (const it of items) {
    const n = pick(it);
    if (typeof n !== "number") {
      missing++;
      continue;
    }
    const hit = edges.findIndex((e) => e.test(n));
    if (hit >= 0) rows[hit].count++;
  }
  return missing > 0 ? [...rows, { label: unmeasured, count: missing }] : rows;
}

/** Mean of whatever pages actually measured — never padded with a guess for the ones that
 *  didn't (a page with ok:false contributes nothing, not a zero). */
function avg(nums: (number | null)[]): number | null {
  const real = nums.filter((n): n is number => typeof n === "number");
  if (!real.length) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

/** Semrush's own Crawled Pages buckets, mutually exclusive by priority — a page's own most
 *  actionable fact about itself wins (a broken page's brokenness over whether it also has an
 *  on-page issue). Every page lands in exactly one, so the five counts sum to the total the
 *  way Semrush's own numbers do. `hasIssue`/`blocked` are exact (checks.ts pageIssueIds +
 *  robots.ts), never approximated. */
function bucketOf(p: CrawledPage): Bucket {
  if (p.status == null || p.status >= 400) return "Broken";
  if (p.blocked) return "Blocked";
  if (p.redirectedTo) return "Redirects";
  if (p.hasIssue) return "Have issues";
  return "Healthy";
}

export default function AuditSection() {
  const { toast } = useStore();
  const [state, setState] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  // `sinceJobId`: the jobs_log row that existed when polling began — the previous run's — so
  // a "success" that is still the OLD row is not mistaken for the new run finishing.
  const [polling, setPolling] = useState<{ sinceId: string | null; sinceJobId: string | null; startedAt: number } | null>(null);
  const [job, setJob] = useState<AuditJob | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [pagesModal, setPagesModal] = useState<Issue | null>(null);
  const [openIssue, setOpenIssue] = useState<string | null>(null);
  const [pageQuery, setPageQuery] = useState("");
  const [pageLimit, setPageLimit] = useState(PAGE_STEP);
  const [showMath, setShowMath] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [sevFilter, setSevFilter] = useState<"all" | Severity>("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [bucketFilter, setBucketFilter] = useState<"all" | Bucket>("all");
  // Compare Crawls: which older run to hold the latest against, and that run once fetched.
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compareRun, setCompareRun] = useState<RunLite | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reloadedFor = useRef<string | null>(null);

  // Default the comparison to the run before the latest, and fetch whichever run is picked.
  useEffect(() => {
    if (tab !== "history" || !state?.history?.length) return;
    const latestId = state.latest?.id ?? null;
    const older = state.history.filter((h) => h.id !== latestId);
    if (!compareId && older.length) setCompareId(older[older.length - 1].id);
  }, [tab, state, compareId]);

  useEffect(() => {
    if (!compareId) return;
    let cancelled = false;
    setCompareRun(null);
    setCompareError(null);
    fetch(`/api/site-audit?run=${encodeURIComponent(compareId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok && d.run) setCompareRun(d.run as RunLite);
        else setCompareError(d.error || "Couldn't load that run.");
      })
      .catch(() => !cancelled && setCompareError("Couldn't load that run — network error."));
    return () => {
      cancelled = true;
    };
  }, [compareId]);

  const load = useCallback((): Promise<Payload | null> => {
    setLoading(true);
    return fetch("/api/site-audit")
      .then((r) => r.json())
      .then((d: Payload) => {
        if (d.ok) {
          setState(d);
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { /* too big or private mode: fine */ }
          return d;
        }
        toast("Couldn't load your audit.", "error");
        return null;
      })
      .catch(() => {
        toast("Couldn't load your audit — try refreshing.", "error");
        return null;
      })
      .finally(() => setLoading(false));
  }, [toast]);

  /** The audit job as jobs_log has it now — progress while it runs, the diagnosable error
   *  when it failed. Null when the status endpoint could not be read (never a guess). */
  const fetchStatus = useCallback(async (): Promise<AuditJob | null> => {
    try {
      const d = await fetch("/api/site-audit/status").then((r) => r.json());
      if (d.ok) {
        setJob(d.job ?? null);
        return d.job ?? null;
      }
    } catch {
      /* the next poll will try again */
    }
    return null;
  }, []);

  useEffect(() => {
    // Paint the last report at once; the fetch below refreshes it behind the scenes.
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const d: Payload = JSON.parse(raw);
        if (d?.ok) { setState((cur) => cur ?? d); setLoading(false); }
      }
    } catch { /* ignore a bad cache */ }
    // A run the weekly schedule (or another tab) started is shown the same way as one started
    // here: if jobs_log says "running" when the page opens, follow it.
    load().then(async (d) => {
      const j = await fetchStatus();
      if (j && j.status === "running" && !j.stalled) {
        setPolling({ sinceId: d?.latest?.id ?? null, sinceJobId: null, startedAt: Date.parse(j.createdAt) || Date.now() });
      }
    });
  }, [load, fetchStatus]);

  // Real progress: polls jobs_log (via /api/site-audit/status) for the run's own phase and
  // done/total, and the report endpoint for the finished report. Ends on the new report, on
  // the job's own error row, on a stall, or on the ceiling — each with its own sentence.
  useEffect(() => {
    if (!polling) return;
    pollTimer.current = setInterval(async () => {
      const j = await fetchStatus();
      const isNewRow = !!j && j.id !== polling.sinceJobId;
      // Two-stage save: the crawl report is on file once the run reaches the browser phase —
      // show it then (once per run), with its Core Web Vitals card saying "being measured".
      if (j && isNewRow && (j.progress.phase === "perf" || j.progress.phase === "checks") && reloadedFor.current !== j.id) {
        reloadedFor.current = j.id;
        await load();
      }
      if (j && isNewRow && (j.status === "error" || j.status === "skipped")) {
        setPolling(null);
        await load(); // whatever stage 1 filed is still a real report
        toast("The audit failed — the reason is on the page.", "error");
        return;
      }
      if (j && isNewRow && j.stalled) {
        setPolling(null);
        await load();
        toast("The audit stopped responding — details on the page.", "error");
        return;
      }
      if (j && isNewRow && j.status === "success") {
        const d = await load();
        if ((d?.latest?.id ?? null) !== polling.sinceId) {
          setPolling(null);
          toast("Audit finished.");
          return;
        }
      }
      if (Date.now() - polling.startedAt > POLL_TIMEOUT_MS) {
        setPolling(null);
        toast("This is taking far longer than it should — the last thing it reported is on the page.", "error");
      }
    }, POLL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling?.startedAt]);

  const runAudit = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/agents/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "audit", source: "manual" }),
      });
      const d = await res.json();
      if (d.ok) {
        toast("Checking your whole site — this takes a few minutes.");
        setPolling({ sinceId: state?.latest?.id ?? null, sinceJobId: job?.id ?? null, startedAt: Date.now() });
      } else {
        toast(d.error || "Couldn't start the audit.", "error");
      }
    } catch {
      toast("Couldn't start the audit — network error.", "error");
    } finally {
      setStarting(false);
    }
  };

  /** "Export PDF" prints the WHOLE report (overview, every issue with its fix, every page,
   *  insights), not just the tab that happens to be open, so every section is rendered first. */
  const printReport = () => {
    setPrinting(true);
    window.addEventListener("afterprint", () => setPrinting(false), { once: true });
    setTimeout(() => window.print(), 250);
  };
  const show = (t: Tab) => tab === t || (printing && t !== "history");

  const actions = (
    <div className="au-actions lx-audit-noprint">
      <button className="au-btn au-btn-pri" disabled={starting || !!polling} onClick={runAudit}>
        {starting ? "Starting…" : polling ? "Auditing…" : state?.latest ? "Re-audit" : "Audit my site"}
      </button>
      <button className="au-btn" onClick={printReport} title="Opens your browser's print dialog. Choose 'Save as PDF' as the destination.">
        Export PDF
      </button>
    </div>
  );

  const head = (
    <div className="au-head lx-audit-noprint">
      <div className="min-w-0">
        <h1 className="au-h1">Site audit</h1>
        <p className="au-sub">What is broken, hidden from Google or costing you visitors, checked across your whole site. It also runs by itself every week.</p>
      </div>
      {actions}
    </div>
  );

  // The running job's own row, if the one on file is the new run (not the previous run's row
  // still sitting there while pg-boss hands the new job to a worker).
  const liveJob = polling && job && job.id !== polling.sinceJobId && job.status === "running" ? job : null;
  const progressBanner = polling && <AuditProgress job={liveJob} startedAt={polling.startedAt} />;

  // The last run's failure, shown until a newer report exists.
  const failedJob =
    !polling && job && (job.status === "error" || job.status === "skipped" || job.stalled) && (!state?.latest || Date.parse(job.createdAt) > Date.parse(state.latest.createdAt))
      ? job
      : null;
  const failureCard = failedJob && <AuditFailure job={failedJob} onRetry={runAudit} busy={starting} />;

  if (loading && !state) {
    return <ReportSkeleton actions={actions} />;
  }

  if (state && !state.schemaReady) {
    return (
      <div className="au-page">
        <style dangerouslySetInnerHTML={{ __html: AUDIT_CSS }} />
        {head}
        <div className="au-card au-empty">
          <b>Not set up on this database yet</b>
          <p>Migration 020 has not been applied here, so there is nowhere to save a report. This one is for whoever runs the database.</p>
        </div>
      </div>
    );
  }

  const r = state?.latest ?? null;

  if (!r) {
    return (
      <div className="au-page">
        <style dangerouslySetInnerHTML={{ __html: AUDIT_CSS }} />
        {head}
        {progressBanner}
        {failureCard}
        <div className="au-card au-empty">
          <b>No audit yet</b>
          <p>Run one now to see what is wrong on your site. It takes a few minutes. After that it runs by itself every week and shows what changed.</p>
          {!polling && (
            <button className="au-btn au-btn-pri" disabled={starting} onClick={runAudit}>
              {starting ? "Starting…" : "Audit my site now"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const history = state!.history;
  const diff = r.previousScore === null ? null : r.score - r.previousScore;
  const allIssues = [...r.issues].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);
  const bySev = (s: Severity) => allIssues.filter((i) => i.severity === s);
  const fixFirst = allIssues.filter((i) => i.severity !== "info").slice(0, ISSUES_COLLAPSED_COUNT);
  const notices = bySev("info").length;
  const band = healthBand(r.score);

  const vitals = r.performance ?? [];
  // "Measured" means a number came back. Reports from before performance.ts learned to call a
  // numberless Lighthouse run a failure have ok:true rows with every metric null; those are
  // not measurements and are not counted as any.
  const measured = vitals.filter((p) => p.ok && (p.lcpMs != null || p.cls != null || p.tbtMs != null || p.performanceScore != null));
  const avgLcp = avg(measured.map((p) => p.lcpMs));
  const avgCls = avgDec(measured.map((p) => p.cls), 2);
  const avgPerf = avg(measured.map((p) => p.performanceScore));

  const pages = r.pages ?? [];
  const bucketCount = (b: Bucket) => pages.filter((p) => bucketOf(p) === b).length;
  const withProblems = bucketCount("Broken") + bucketCount("Have issues");

  // Site health by area: the report ships each category's health (same arithmetic as the
  // headline score). Older reports fall back to checks-that-did-not-fire / checks-in-category.
  const categories = Array.from(new Set(r.catalogue.map((c) => c.category)));
  const thematic = (r.thematic?.length
    ? r.thematic.map((t) => ({ cat: t.category, total: t.checks, fired: t.issues, pct: t.health }))
    : categories.map((cat) => {
        const total = r.catalogue.filter((c) => c.category === cat).length;
        const fired = new Set(r.issues.filter((i) => i.category === cat).map((i) => i.id)).size;
        return { cat, total, fired, pct: total ? Math.round(((total - fired) / total) * 100) : 100 };
      })
  ).sort((a, b) => a.pct - b.pct);
  const issueCategories = Array.from(new Set(allIssues.map((i) => i.category ?? "Other")));

  const filteredIssues = allIssues.filter((i) => (sevFilter === "all" || i.severity === sevFilter) && (catFilter === "all" || (i.category ?? "Other") === catFilter));
  const domain = r.websiteUrl ? r.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "your site";

  const q = pageQuery.trim().toLowerCase();
  const filteredPages = pages.filter((p) => (bucketFilter === "all" || bucketOf(p) === bucketFilter) && (!q || p.url.toLowerCase().includes(q)));

  const chip = (active: boolean, label: string, onClick: () => void, _color?: string) => (
    <button key={label} className={`au-chip ${active ? "on" : ""}`} onClick={onClick}>
      {label}
    </button>
  );

  const toggleIssue = (id: string) => setOpenIssue((cur) => (cur === id ? null : id));
  const issueCard = (i: Issue) => (
    <IssueCard key={i.id} issue={i} open={openIssue === i.id} onToggle={() => toggleIssue(i.id)} onPages={() => setPagesModal(i)} />
  );

  const TAB_LABEL: Record<Tab, string> = { overview: "Overview", issues: "Issues", pages: "Pages", statistics: "Insights", history: "History" };
  const tabCount = (t: Tab) => (t === "issues" ? allIssues.length : t === "pages" ? pages.length : 0);

  return (
    <div className="au-page" id="lx-audit-report">
      <style dangerouslySetInnerHTML={{ __html: AUDIT_CSS }} />

      <div className="au-head">
        <div className="min-w-0">
          <h1 className="au-h1">Site audit: <span className="au-domain">{domain}</span></h1>
          <p className="au-sub">
            Checked {ago(r.createdAt)} · {r.pagesChecked} pages
            {r.trigger && ` · ${TRIGGER_LABEL[r.trigger]}`}
            {r.seconds != null && ` · took ${r.seconds < 90 ? `${r.seconds} sec` : `${Math.round(r.seconds / 60)} min`}`}
          </p>
        </div>
        {actions}
      </div>
      {progressBanner}
      {failureCard}

      <div className="au-tabs lx-scroll lx-audit-noprint" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`au-tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
            {tabCount(t) > 0 && <span className="au-tab-n">{tabCount(t)}</span>}
          </button>
        ))}
      </div>

      {/* ═════════════════════════════════ OVERVIEW ═════════════════════════════════ */}
      {show("overview") && (
        <>
          <section className="au-card au-hero">
            <ScoreGauge score={r.score} />
            <div className="au-hero-b">
              <div className="au-verdict"><b>{band.label}</b> <span>{band.meaning}</span></div>
              <p className="au-trend">
                {diff === null
                  ? "This is your first audit, so there is nothing to compare it with yet."
                  : diff === 0
                    ? `No change since the last audit (it was ${r.previousScore}).`
                    : diff > 0
                      ? `Up ${diff} points since the last audit (it was ${r.previousScore}).`
                      : `Down ${Math.abs(diff)} points since the last audit (it was ${r.previousScore}).`}
              </p>
              <button className="au-link lx-audit-noprint" onClick={() => setShowMath((v) => !v)}>{showMath ? "Hide how this is worked out" : "How is this score worked out?"}</button>
              {showMath && (
                <p className="au-math">
                  Every page starts at 100. A page with an error scores 0, and each warning takes 5 points off. Site Health is the average of all your pages, minus 25 points for each serious site-wide file problem (such as a missing or blocking robots.txt). Notices never change the score.
                </p>
              )}
            </div>
          </section>

          <div className="au-kpis">
            <Kpi label="Pages checked" value={String(r.pagesChecked)} />
            <Kpi label="Pages with problems" value={pages.length ? String(withProblems) : "—"} sub={pages.length ? `of ${pages.length} pages` : "not on file"} color={withProblems > 0 ? "#fb923c" : "#34d399"} onClick={pages.length ? () => { setBucketFilter("Have issues"); setTab("pages"); } : undefined} />
            <Kpi label="Errors" value={String(r.blocks)} sub="types of problem" color={r.blocks > 0 ? "#f87171" : "#34d399"} onClick={() => { setSevFilter("block"); setCatFilter("all"); setTab("issues"); }} />
            <Kpi label="Warnings" value={String(r.warns)} sub="types of problem" color={r.warns > 0 ? "#fbbf24" : "#34d399"} onClick={() => { setSevFilter("warn"); setCatFilter("all"); setTab("issues"); }} />
          </div>

          <section className="au-card">
            <div className="au-card-h">
              <div><b>Fix these first</b><span className="au-hint">Biggest problems first. Tap one to see how to fix it.</span></div>
            </div>
            {fixFirst.length ? (
              <div className="au-list">{fixFirst.map(issueCard)}</div>
            ) : (
              <p className="au-ok">Nothing to fix. Every check passed.</p>
            )}
            {allIssues.length > fixFirst.length && (
              <button className="au-btn au-block lx-audit-noprint" onClick={() => { setSevFilter("all"); setCatFilter("all"); setTab("issues"); }}>
                See all {allIssues.length} findings{notices > 0 ? ` (including ${notices} notice${notices === 1 ? "" : "s"})` : ""}
              </button>
            )}
          </section>

          <div className="au-two">
            <section className="au-card">
              <div className="au-card-h"><div><b>Your pages</b><span className="au-hint">{pages.length ? `${pages.length} pages we visited` : "Page-by-page list not on file for this report"}</span></div></div>
              {pages.length > 0 ? (
                <>
                  <div className="au-stack" aria-hidden>
                    {BUCKET_ORDER.map((b) => {
                      const n = bucketCount(b);
                      return n > 0 ? <i key={b} style={{ width: `${(n / pages.length) * 100}%`, background: BUCKET_COLOR[b] }} /> : null;
                    })}
                  </div>
                  <ul className="au-buckets">
                    {BUCKET_ORDER.map((b) => {
                      const n = bucketCount(b);
                      return (
                        <li key={b}>
                          <button onClick={() => { setBucketFilter(b); setTab("pages"); }} disabled={n === 0}>
                            <span className="au-dot" style={{ background: BUCKET_COLOR[b] }} />
                            <span className="au-b-t"><b>{BUCKET_LABEL[b]}</b><small>{BUCKET_HELP[b]}</small></span>
                            <span className="au-b-n">{n}<small>{Math.round((n / pages.length) * 100)}%</small></span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className="au-mut">The next audit will include the full list.</p>
              )}
            </section>

            <section className="au-card">
              <div className="au-card-h"><div><b>Health by area</b><span className="au-hint">Weakest first. Tap an area to see its issues.</span></div></div>
              {thematic.length ? (
                <ul className="au-areas">
                  {thematic.map((t) => (
                    <li key={t.cat}>
                      <button onClick={() => { setCatFilter(t.cat); setSevFilter("all"); setTab("issues"); }}>
                        <span className="au-a-top"><b>{t.cat}</b><em style={{ color: TONE_COLOR[tone(t.pct)] }}>{t.pct}%</em></span>
                        <span className="au-bar"><i style={{ width: `${t.pct}%`, background: TONE_COLOR[tone(t.pct)] }} /></span>
                        <small>{t.fired ? `${t.fired} issue${t.fired === 1 ? "" : "s"} found` : "No issues"} · {t.total} checks</small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="au-mut">Not on file for this report. The next audit will include it.</p>
              )}
            </section>
          </div>

          {/* LOADING SPEED */}
          <section className="au-card">
            <div className="au-card-h">
              <div>
                <b>Loading speed (mobile)</b>
                <span className="au-hint">
                  {vitals.length > 0
                    ? `Measured in real Chrome on ${measured.length} of ${vitals.length} sampled page${vitals.length === 1 ? "" : "s"} (the home page plus a few others, because each test takes 10 to 20 seconds).`
                    : "Measured in real Chrome on a sample of your pages."}
                </span>
              </div>
            </div>
            {r.performancePending && vitals.length === 0 ? (
              polling ? (
                <p className="au-mut">Being measured right now. Everything else in this report is already final.</p>
              ) : (
                <p className="au-warn">The speed test did not finish for this report because the server stopped during it. Everything else is complete. Re-audit to measure speed.</p>
              )
            ) : vitals.length === 0 ? (
              <p className="au-mut">Not measured in this report.</p>
            ) : measured.length === 0 ? (
              <p className="au-mut">Nothing could be measured this time. The reason is listed per page below, and the next audit tries again.</p>
            ) : (
              <div className="au-vitals">
                <VitalTile label="Loading time" short="LCP" value={avgLcp != null ? `${(avgLcp / 1000).toFixed(1)}s` : "—"} good={avgLcp == null ? null : avgLcp <= 2500} hint="Good: 2.5 s or less" />
                <VitalTile label="Layout jumping" short="CLS" value={avgCls != null ? avgCls.toFixed(2) : "—"} good={avgCls == null ? null : avgCls <= 0.1} hint="Good: 0.1 or less" />
                <VitalTile label="Speed score" short="Lighthouse" value={avgPerf != null ? `${avgPerf}/100` : "—"} good={avgPerf == null ? null : avgPerf >= 90} hint="Good: 90 or more" />
              </div>
            )}
            {vitals.length > 0 && (
              <details className="au-more lx-audit-noprint">
                <summary>Speed of each tested page</summary>
                <div className="au-plist">
                  {vitals.map((p) => (
                    <div key={p.url} className="au-vrow">
                      <span className="au-url" title={p.url}>{p.url}</span>
                      {p.ok && (p.lcpMs != null || p.cls != null || p.performanceScore != null) ? (
                        <span className="au-vm">
                          <span>Load <b>{p.lcpMs != null ? `${(p.lcpMs / 1000).toFixed(1)}s` : "—"}</b></span>
                          <span>Jump <b>{p.cls != null ? p.cls.toFixed(2) : "—"}</b></span>
                          <span>Score <b>{p.performanceScore != null ? `${p.performanceScore}/100` : "—"}</b></span>
                        </span>
                      ) : (
                        <span className="au-mut">Not measured{p.error ? `: ${p.error}` : ""}</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>

          {r.aiSearch && (
            <section className="au-card">
              <div className="au-card-h">
                <div><b>AI search access</b><span className="au-hint">Whether AI assistants such as ChatGPT and Perplexity may read your site, according to your robots.txt. This is a rules check, not traffic.</span></div>
              </div>
              <p className={r.aiSearch.every((b) => b.allowed) ? "au-ok" : "au-warn"}>
                {r.aiSearch.every((b) => b.allowed)
                  ? `All ${r.aiSearch.length} AI crawlers we checked are allowed in.`
                  : `${r.aiSearch.filter((b) => !b.allowed).length} of ${r.aiSearch.length} AI crawlers are blocked by your robots.txt, so those assistants cannot read your site.`}
              </p>
              <div className="au-bots">
                {r.aiSearch.map((b) => (
                  <span key={b.bot} className={`au-bot ${b.allowed ? "ok" : "no"}`}>{b.allowed ? "✓" : "✕"} {b.label}</span>
                ))}
              </div>
            </section>
          )}

          {r.skipped.length > 0 && (
            <section className="au-card">
              <div className="au-card-h"><div><b>Not measured in this audit</b></div></div>
              <ul className="au-skip">{r.skipped.map((s, n) => <li key={n}>{s}</li>)}</ul>
            </section>
          )}
        </>
      )}

      {/* ═════════════════════════════════ ISSUES ═════════════════════════════════ */}
      {show("issues") && (
        <section className="au-card">
          <p className="au-legend">
            <span><i style={{ background: SEV_COLOR.block }} /> <b>Error</b> hurts ranking or blocks pages. Fix first.</span>
            <span><i style={{ background: SEV_COLOR.warn }} /> <b>Warning</b> worth improving.</span>
            <span><i style={{ background: "var(--lx-mut)" }} /> <b>Notice</b> for your information, no score impact.</span>
          </p>
          <div className="au-chips lx-audit-noprint">
            {chip(sevFilter === "all", `All ${allIssues.length}`, () => setSevFilter("all"))}
            {chip(sevFilter === "block", `Errors ${bySev("block").length}`, () => setSevFilter("block"), "#f87171")}
            {chip(sevFilter === "warn", `Warnings ${bySev("warn").length}`, () => setSevFilter("warn"), "#fbbf24")}
            {chip(sevFilter === "info", `Notices ${bySev("info").length}`, () => setSevFilter("info"))}
          </div>
          {issueCategories.length > 1 && (
            <div className="au-chips lx-audit-noprint">
              {chip(catFilter === "all", "All areas", () => setCatFilter("all"))}
              {issueCategories.map((c) => chip(catFilter === c, `${c} ${allIssues.filter((i) => (i.category ?? "Other") === c).length}`, () => setCatFilter(c)))}
            </div>
          )}
          {(["block", "warn", "info"] as Severity[]).map((s) => {
            const group = filteredIssues.filter((i) => i.severity === s);
            if (!group.length) return null;
            return (
              <div key={s} className="au-group">
                <div className="au-group-h" style={{ borderColor: SEV_COLOR[s] }}><b>{SEV_LABEL[s]}s</b><span>{group.length}</span></div>
                <div className="au-list">{group.map(issueCard)}</div>
              </div>
            );
          })}
          {filteredIssues.length === 0 && <p className="au-mut" style={{ marginTop: 16 }}>{allIssues.length === 0 ? "Nothing found. Every check passed." : "No issues match these filters."}</p>}
        </section>
      )}

      {/* ═════════════════════════════════ PAGES ═════════════════════════════════ */}
      {show("pages") && (
        <section className="au-card">
          {pages.length === 0 ? (
            <p className="au-mut">Not on file for this report. The next audit will include a full page-by-page list.</p>
          ) : (
            <>
              <input className="au-search lx-audit-noprint" type="search" placeholder="Search pages by address…" value={pageQuery} onChange={(e) => { setPageQuery(e.target.value); setPageLimit(PAGE_STEP); }} aria-label="Search pages" />
              <div className="au-chips lx-audit-noprint">
                {chip(bucketFilter === "all", `All ${pages.length}`, () => { setBucketFilter("all"); setPageLimit(PAGE_STEP); })}
                {BUCKET_ORDER.map((b) => chip(bucketFilter === b, `${BUCKET_LABEL[b]} ${bucketCount(b)}`, () => { setBucketFilter(b); setPageLimit(PAGE_STEP); }, BUCKET_COLOR[b]))}
              </div>
              <div className="au-prow au-prow-h"><span>Page</span><span>Status</span><span>Health</span><span>Response</span></div>
              <div className="au-plist">
                {filteredPages.slice(0, printing ? filteredPages.length : pageLimit).map((p) => {
                  const b = bucketOf(p);
                  return (
                    <div key={p.url} className="au-prow">
                      <span className="au-pcell">
                        <a href={p.url} target="_blank" rel="noreferrer noopener" className="au-url">{p.url}</a>
                        {p.redirectedTo && <small>Redirects to {p.redirectedTo}</small>}
                        {p.error && <small className="au-err">{p.error}</small>}
                      </span>
                      <span className="au-pm"><em>Status</em>{p.status ?? "—"}</span>
                      <span className="au-pm"><em>Health</em><span className="au-badge" style={{ color: BUCKET_COLOR[b], borderColor: BUCKET_COLOR[b] }}>{BUCKET_LABEL[b]}</span></span>
                      <span className="au-pm"><em>Response</em>{p.ms != null ? `${p.ms} ms` : "—"}</span>
                    </div>
                  );
                })}
              </div>
              {filteredPages.length === 0 && <p className="au-mut" style={{ marginTop: 12 }}>No pages match.</p>}
              {filteredPages.length > pageLimit && (
                <button className="au-btn au-block lx-audit-noprint" onClick={() => setPageLimit((n) => n + PAGE_STEP)}>
                  Show more ({filteredPages.length - pageLimit} left)
                </button>
              )}
            </>
          )}
        </section>
      )}

      {/* ═════════════════════════════════ INSIGHTS ═════════════════════════════════ */}
      {show("statistics") && (() => {
        // Every distribution is a count of REAL crawled pages in a bucket, the same numbers the
        // checks judged. An older report has status/response but not the per-page measurements.
        const html = pages.filter((p) => typeof p.titleChars === "number");
        const hasStats = html.length > 0;
        const notOnFile = "Not on file for this report. The next audit records it per page.";
        const statusRows = [
          { label: "200 OK", count: pages.filter((p) => p.status != null && p.status >= 200 && p.status < 300).length, color: BUCKET_COLOR.Healthy },
          { label: "3xx redirect", count: pages.filter((p) => p.status != null && p.status >= 300 && p.status < 400).length, color: BUCKET_COLOR.Redirects },
          { label: "4xx not found / denied", count: pages.filter((p) => p.status != null && p.status >= 400 && p.status < 500).length, color: BUCKET_COLOR.Broken },
          { label: "5xx server error", count: pages.filter((p) => p.status != null && p.status >= 500).length, color: BUCKET_COLOR.Broken },
          { label: "Unreachable", count: pages.filter((p) => p.status == null).length, color: BUCKET_COLOR.Blocked },
        ];
        const avgMs = avg(pages.map((p) => p.ms));
        return (
          <>
            <div className="au-kpis">
              <Kpi label="Pages visited" value={String(pages.length || r.pagesChecked)} />
              <Kpi label="Healthy pages" value={pages.length ? `${Math.round((bucketCount("Healthy") / pages.length) * 100)}%` : "—"} sub={pages.length ? `${bucketCount("Healthy")} of ${pages.length}` : undefined} color="#34d399" />
              <Kpi label="Avg. response" value={avgMs != null ? `${avgMs} ms` : "—"} sub="time to first byte" />
              <Kpi label="Notices" value={String(notices)} sub="no score impact" />
            </div>
            {pages.length === 0 ? (
              <section className="au-card"><p className="au-mut">{notOnFile}</p></section>
            ) : (
              <div className="au-two">
                <Distribution title="What the server answered" note="Every visited page, by response." rows={statusRows} />
                <Distribution
                  title="Response time"
                  note="Time until the server starts answering. Over 1.5 s is slow."
                  rows={bucketBy(pages, (p) => p.ms, [
                    { label: "Under 200 ms", test: (n) => n < 200 },
                    { label: "200 to 500 ms", test: (n) => n < 500 },
                    { label: "500 ms to 1 s", test: (n) => n < 1000 },
                    { label: "1 to 1.5 s", test: (n) => n <= 1500 },
                    { label: "Over 1.5 s", test: () => true },
                  ])}
                />
                <Distribution
                  title="Clicks from the home page"
                  note="Pages more than 3 clicks deep are hard to find."
                  empty={hasStats ? undefined : notOnFile}
                  rows={bucketBy(html, (p) => p.depth, [
                    { label: "Home page", test: (n) => n === 0 },
                    { label: "1 click", test: (n) => n === 1 },
                    { label: "2 clicks", test: (n) => n === 2 },
                    { label: "3 clicks", test: (n) => n === 3 },
                    { label: "4+ clicks", test: () => true },
                  ], "No link path from home")}
                />
                <Distribution
                  title="Links pointing to each page"
                  note="From other pages of your site. Zero means nobody links to it."
                  empty={hasStats ? undefined : notOnFile}
                  rows={bucketBy(html, (p) => p.inLinks, [
                    { label: "0 (orphan)", test: (n) => n === 0 },
                    { label: "1", test: (n) => n === 1 },
                    { label: "2 to 5", test: (n) => n <= 5 },
                    { label: "6 to 20", test: (n) => n <= 20 },
                    { label: "21+", test: () => true },
                  ])}
                />
                <Distribution
                  title="Title length"
                  note="Characters in the page title. Under 30 is short, over 65 gets cut off in Google."
                  empty={hasStats ? undefined : notOnFile}
                  rows={bucketBy(html, (p) => p.titleChars, [
                    { label: "Missing", test: (n) => n === 0 },
                    { label: "1 to 29 (short)", test: (n) => n < 30 },
                    { label: "30 to 65 (good)", test: (n) => n <= 65 },
                    { label: "66+ (long)", test: () => true },
                  ])}
                />
                <Distribution
                  title="Description length"
                  note="Characters in the meta description. Google shows about the first 160."
                  empty={hasStats ? undefined : notOnFile}
                  rows={bucketBy(html, (p) => p.descriptionChars, [
                    { label: "Missing", test: (n) => n === 0 },
                    { label: "1 to 69 (short)", test: (n) => n < 70 },
                    { label: "70 to 160 (good)", test: (n) => n <= 160 },
                    { label: "161+ (long)", test: () => true },
                  ])}
                />
                <Distribution
                  title="Words per page"
                  note="Under 150 words is thin content."
                  empty={hasStats ? undefined : notOnFile}
                  rows={bucketBy(html, (p) => p.words, [
                    { label: "Under 150 (thin)", test: (n) => n < 150 },
                    { label: "150 to 500", test: (n) => n < 500 },
                    { label: "500 to 1,500", test: (n) => n < 1500 },
                    { label: "1,500 to 4,000", test: (n) => n <= 4000 },
                    { label: "Over 4,000", test: () => true },
                  ])}
                />
                <Distribution
                  title="Issue types by area"
                  note="Number of different problems found in each area."
                  rows={issueCategories.map((c) => ({ label: c, count: allIssues.filter((i) => (i.category ?? "Other") === c).length }))}
                  unit="issue types"
                />
              </div>
            )}
          </>
        );
      })()}

      {/* ═════════════════════════════════ HISTORY ═════════════════════════════════ */}
      {tab === "history" && (() => {
        const older = history.filter((h) => h.id !== r.id);
        const a = compareRun;
        const latestById = new Map(allIssues.map((i) => [i.id, i]));
        const olderById = new Map((a?.issues ?? []).map((i) => [i.id, i]));
        const fresh = a ? allIssues.filter((i) => !olderById.has(i.id)) : [];
        const fixed = a ? a.issues.filter((i) => !latestById.has(i.id)).sort((x, y) => RANK[x.severity] - RANK[y.severity] || y.count - x.count) : [];
        const still = a ? allIssues.filter((i) => olderById.has(i.id)) : [];
        const delta = (now: number, then: number) => {
          const d = now - then;
          return d === 0 ? "no change" : d > 0 ? `+${d}` : `${d}`;
        };
        return (
          <>
            <div className="au-three">
              <section className="au-card">
                <div className="au-card-h"><div><b>Site Health over time</b></div></div>
                <b className="au-big" style={{ color: "var(--lx-violet)" }}>{r.score}</b>
                {history.length > 1 ? <AreaTrend points={history.map((h) => h.score)} color="#8b5cf6" /> : <p className="au-mut">One audit so far. A trend needs two.</p>}
              </section>
              <SeverityCard label="Errors" sub="types of problem, over time" count={r.blocks} color="#f87171" points={history.map((h) => h.blocks)} />
              <SeverityCard label="Warnings" sub="types of problem, over time" count={r.warns} color="#fbbf24" points={history.map((h) => h.warns)} />
            </div>

            <section className="au-card">
              <div className="au-card-h"><div><b>What changed since an earlier audit</b></div></div>
              {!older.length ? (
                <p className="au-mut">A comparison needs two audits. After the next one (yours or the weekly one) this shows what got fixed and what is new.</p>
              ) : (
                <>
                  <label className="au-cmp lx-audit-noprint">
                    <span>Compare with</span>
                    <select value={compareId ?? ""} onChange={(e) => setCompareId(e.target.value || null)}>
                      {[...older].reverse().map((h) => (
                        <option key={h.id} value={h.id}>{new Date(h.createdAt).toLocaleDateString()} · score {h.score}{h.trigger ? ` · ${TRIGGER_LABEL[h.trigger]}` : ""}</option>
                      ))}
                    </select>
                  </label>
                  {compareError && <p className="au-warn">{compareError}</p>}
                  {!a && !compareError && <p className="au-mut">Loading that audit…</p>}
                  {a && (
                    <>
                      <div className="au-kpis">
                        <Kpi label="Site Health" value={`${a.score} → ${r.score}`} sub={delta(r.score, a.score)} />
                        <Kpi label="Errors" value={`${a.blocks} → ${r.blocks}`} sub={delta(r.blocks, a.blocks)} color="#f87171" />
                        <Kpi label="Warnings" value={`${a.warns} → ${r.warns}`} sub={delta(r.warns, a.warns)} color="#fbbf24" />
                        <Kpi label="Pages checked" value={`${a.pagesChecked} → ${r.pagesChecked}`} sub={delta(r.pagesChecked, a.pagesChecked)} />
                      </div>
                      <div className="au-group"><div className="au-group-h" style={{ borderColor: "#34d399" }}><b>Fixed</b><span>{fixed.length}</span></div>
                        <div className="au-list">{fixed.length ? fixed.map((i) => <CompareRow key={i.id} severity={i.severity} what={i.what} category={i.category ?? undefined} note={`was on ${i.count} ${i.count === 1 ? "page" : "pages"}`} />) : <p className="au-mut">Nothing from that audit has gone away.</p>}</div></div>
                      <div className="au-group"><div className="au-group-h" style={{ borderColor: "#f87171" }}><b>New</b><span>{fresh.length}</span></div>
                        <div className="au-list">{fresh.length ? fresh.map(issueCard) : <p className="au-mut">No new kinds of problem.</p>}</div></div>
                      <div className="au-group"><div className="au-group-h" style={{ borderColor: "var(--lx-mut)" }}><b>Still open</b><span>{still.length}</span></div>
                        <div className="au-list">{still.length ? still.map((i) => {
                          const then = olderById.get(i.id)!.count;
                          return <CompareRow key={i.id} severity={i.severity} what={i.what} category={i.category} note={`${then} → ${i.count} ${i.count === 1 ? "page" : "pages"}${then === i.count ? "" : ` (${delta(i.count, then)})`}`} onClick={i.pages?.length ? () => setPagesModal(i) : undefined} />;
                        }) : <p className="au-mut">Nothing carried over.</p>}</div></div>
                    </>
                  )}
                </>
              )}
            </section>

            <section className="au-card">
              <div className="au-card-h"><div><b>Every audit</b><span className="au-hint">{history.length} run{history.length === 1 ? "" : "s"}, newest first.</span></div></div>
              <HistoryTable rows={history} />
            </section>
          </>
        );
      })()}

      {pagesModal && <PagesModal issue={pagesModal} pages={pages} onClose={() => setPagesModal(null)} />}
    </div>
  );
}

const BUCKET_LABEL: Record<Bucket, string> = { Healthy: "Healthy", Broken: "Broken", "Have issues": "Have issues", Redirects: "Redirects", Blocked: "Blocked" };
const BUCKET_HELP: Record<Bucket, string> = {
  Healthy: "No errors or warnings",
  Broken: "Not found, server error or unreachable",
  "Have issues": "Errors or warnings on the page",
  Redirects: "Send visitors to another address",
  Blocked: "Blocked for Google by robots.txt",
};
const PAGE_STEP = 40;

/** "3 hours ago" / "yesterday" / a date, so the report's age is obvious without reading a
 *  timestamp. Past a week it is the plain date. */
function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 8) return days === 1 ? "yesterday" : `${days} days ago`;
  return `on ${new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Mean to `dp` decimals of whatever pages actually measured. Needed for CLS (0.05 must not be
 *  rounded to a whole number the way `avg` does it). */
function avgDec(nums: (number | null)[], dp: number): number | null {
  const real = nums.filter((n): n is number => typeof n === "number");
  if (!real.length) return null;
  const k = 10 ** dp;
  return Math.round((real.reduce((a, b) => a + b, 0) / real.length) * k) / k;
}

function Kpi({ label, value, sub, color, onClick }: { label: string; value: string; sub?: string; color?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="au-k-l">{label}</span>
      <b className="au-k-v" style={color ? { color } : undefined}>{value}</b>
      {sub && <span className="au-k-s">{sub}</span>}
    </>
  );
  return onClick ? <button className="au-kpi au-kpi-btn" onClick={onClick}>{inner}</button> : <div className="au-kpi">{inner}</div>;
}

/** One finding, as an accordion: what is wrong and how many pages, and on tap the plain fix and
 *  a way to the affected pages. Used by Overview, Issues and History so they cannot drift. */
function IssueCard({ issue: i, open, onToggle, onPages }: { issue: Issue; open: boolean; onToggle: () => void; onPages: () => void }) {
  const n = i.pages?.length ? i.count : i.count > 1 ? i.count : 0;
  return (
    <div className={`au-issue ${open ? "open" : ""}`}>
      <button className="au-issue-h" onClick={onToggle} aria-expanded={open}>
        <span className="au-sev" style={{ color: SEV_COLOR[i.severity], borderColor: SEV_COLOR[i.severity] }}>{SEV_LABEL[i.severity]}</span>
        <span className="au-issue-t">
          <b>{i.what}</b>
          <small>{n > 0 ? `${n} ${n === 1 ? "page" : "pages"} affected` : "Affects the whole site"}{i.category ? ` · ${i.category}` : ""}</small>
        </span>
        <span className="au-chev" aria-hidden>{open ? "−" : "+"}</span>
      </button>
      <div className="au-fix">
        <b>How to fix</b>
        <p>{i.fix}</p>
        {i.pages?.length > 0 && (
          <>
            <button className="au-btn au-btn-sm lx-audit-noprint" onClick={onPages}>See the {i.count > i.pages.length ? `first ${i.pages.length} of ${i.count}` : i.count} affected page{i.count === 1 ? "" : "s"}</button>
            <ul className="au-print-pages">
              {i.pages.map((p) => <li key={p}>{p}</li>)}
              {i.count > i.pages.length && <li>…and {i.count - i.pages.length} more</li>}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}


/** Bottom sheet on a phone, centred card on a desktop. */
function Modal({ label, onClose, children, maxWidth = 640 }: { label: string; onClose: () => void; children: React.ReactNode; maxWidth?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="au-modal" onClick={onClose} role="dialog" aria-modal="true" aria-label={label}>
      <style dangerouslySetInnerHTML={{ __html: AUDIT_CSS }} />
      <div className="au-sheet" style={{ maxWidth }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  return (
    <div className="au-hist">
      <div className="au-hrow au-hrow-h"><span>Date</span><span>Score</span><span>Errors</span><span>Warnings</span><span>Pages</span></div>
      {[...rows].reverse().map((h) => (
        <div key={h.id} className="au-hrow">
          <span className="au-h-d">{new Date(h.createdAt).toLocaleString()}<small>{h.trigger ? TRIGGER_LABEL[h.trigger] : ""}</small></span>
          <span><em>Score</em><b style={{ color: TONE_COLOR[tone(h.score)] }}>{h.score}</b></span>
          <span><em>Errors</em>{h.blocks}</span>
          <span><em>Warnings</em>{h.warns}</span>
          <span><em>Pages</em>{h.pagesChecked}</span>
        </div>
      ))}
    </div>
  );
}

/** Every affected address for one finding, with what the server answered for it. */
function PagesModal({ issue, pages, onClose }: { issue: Issue; pages: CrawledPage[]; onClose: () => void }) {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  return (
    <Modal label={issue.what} onClose={onClose} maxWidth={760}>
      <div className="au-sheet-h">
        <div className="min-w-0">
          <b>{issue.what}</b>
          <p>{issue.count} page{issue.count === 1 ? "" : "s"} affected{issue.fix ? `. ${issue.fix}` : ""}</p>
        </div>
        <button className="au-x" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="lx-scroll au-sheet-b">
        {issue.pages.map((url) => {
          const p = byUrl.get(url);
          return (
            <div key={url} className="au-prow au-prow-m">
              <span className="au-pcell">
                <a href={url} target="_blank" rel="noreferrer noopener" className="au-url">{url}</a>
                {p?.redirectedTo && <small>Redirects to {p.redirectedTo}</small>}
              </span>
              <span className="au-pm"><em>Status</em>{p?.status ?? "—"}</span>
            </div>
          );
        })}
        {issue.count > issue.pages.length && <p className="au-mut" style={{ marginTop: 10 }}>…and {issue.count - issue.pages.length} more not listed individually (the report keeps the first {issue.pages.length}).</p>}
      </div>
    </Modal>
  );
}

/** Errors / Warnings card for the History tab: the big number plus its trend. */
function SeverityCard({ label, sub, count, color, points }: { label: string; sub: string; count: number; color: string; points: number[] }) {
  return (
    <section className="au-card">
      <div className="au-card-h"><div><b><i className="au-dot" style={{ background: color }} /> {label}</b><span className="au-hint">{sub}</span></div></div>
      <b className="au-big" style={{ color }}>{count}</b>
      {points.length > 1 ? <AreaTrend points={points} color={color} /> : <p className="au-mut">One audit so far. A trend needs two.</p>}
    </section>
  );
}

/** A distribution as a bar list: count and share beside each bar, the full label on hover. */
function Distribution({ title, note, rows, empty, unit = "pages" }: { title: string; note?: string; rows: { label: string; count: number; color?: string }[]; empty?: string; unit?: string }) {
  const total = rows.reduce((a, b) => a + b.count, 0);
  const max = Math.max(1, ...rows.map((x) => x.count));
  return (
    <section className="au-card">
      <div className="au-card-h"><div><b>{title}</b>{note && <span className="au-hint">{note}</span>}</div></div>
      {empty ? (
        <p className="au-mut">{empty}</p>
      ) : (
        <ul className="au-dist">
          {rows.map((x) => (
            <li key={x.label} title={`${x.label}: ${x.count} of ${total} ${unit}`}>
              <span className="au-d-l">{x.label}</span>
              <span className="au-d-b"><i style={{ width: `${(x.count / max) * 100}%`, background: x.color ?? "var(--lx-violet)" }} /></span>
              <b>{x.count}</b>
              <small>{total ? Math.round((x.count / total) * 100) : 0}%</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CompareRow({ severity, what, category, note, onClick }: { severity: Severity; what: string; category?: string; note: string; onClick?: () => void }) {
  return (
    <div className="au-issue">
      <button className="au-issue-h" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
        <span className="au-sev" style={{ color: SEV_COLOR[severity], borderColor: SEV_COLOR[severity] }}>{SEV_LABEL[severity]}</span>
        <span className="au-issue-t"><b>{what}</b><small>{note}{category ? ` · ${category}` : ""}</small></span>
      </button>
    </div>
  );
}

/** `good` null = no number was measured: shown as exactly that, never as "Needs work". */
function VitalTile({ label, short, value, good, hint }: { label: string; short: string; value: string; good: boolean | null; hint?: string }) {
  const color = good === null ? "var(--lx-mut)" : good ? "#34d399" : "#fbbf24";
  return (
    <div className="au-vital">
      <span className="au-k-l">{label} <small>({short})</small></span>
      <b className="au-k-v" style={{ color }}>{value}</b>
      <span className="au-v-s" style={{ color }}>{good === null ? "Not measured" : good ? "Good" : "Needs work"}</span>
      {hint && <span className="au-k-s">{hint}</span>}
    </div>
  );
}

/* One stylesheet for the whole page, on the theme tokens (so light and dark both work), mobile
   first: one column on a phone, two or three from 720px. Injected with dangerouslySetInnerHTML
   because React escapes ">" inside a <style> text child. */
const AUDIT_CSS = `
.au-page{display:flex;flex-direction:column;gap:14px;min-width:0;max-width:1100px;margin:0 auto;width:100%}
.au-page *{box-sizing:border-box}
.au-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px}
.au-h1{font-size:20px;font-weight:700;letter-spacing:-.01em;line-height:1.25;color:var(--lx-text);overflow-wrap:anywhere}
.au-domain{color:var(--lx-violet)}
.au-sub{margin-top:4px;font-size:12.5px;line-height:1.5;color:var(--lx-mut);max-width:620px}
.au-actions{display:flex;gap:8px;flex-wrap:wrap}
.au-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border-radius:9px;
  background:var(--lx-in);border:1px solid var(--lx-border);color:var(--lx-text);font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;transition:.15s}
.au-btn:hover:not(:disabled){border-color:var(--lx-sel-border)}
.au-btn:disabled{opacity:.55;cursor:not-allowed}
.au-btn-pri{background:#4f46e5;border-color:#6366f1;color:#fff}
.au-btn-pri:hover:not(:disabled){background:#5b52ea;border-color:#818cf8}
.au-btn-sm{height:32px;padding:0 12px;font-size:12px}
.au-block{width:100%;margin-top:12px}
.au-link{background:none;border:none;padding:0;margin-top:8px;font-size:12px;font-weight:600;color:#8f95ff;cursor:pointer;text-align:left}
.au-link:hover{text-decoration:underline}
.au-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--lx-border);position:sticky;top:-1px;z-index:5;background:var(--lx-bg);scrollbar-width:none}
.au-tabs::-webkit-scrollbar{display:none}
.au-tab{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;height:42px;padding:0 14px;background:none;border:none;border-bottom:2px solid transparent;
  color:var(--lx-mut);font-size:13px;font-weight:600;cursor:pointer;margin-bottom:-1px}
.au-tab:hover{color:var(--lx-text)}
.au-tab.on{color:var(--lx-sel-text);border-bottom-color:rgba(129,140,248,.9);background:var(--lx-sel-bg)}
.au-tab-n{padding:1px 7px;border-radius:999px;background:var(--lx-in);font-size:10.5px;color:var(--lx-mut)}
.au-page{--au-line:color-mix(in srgb,var(--lx-text) 13%,transparent)}
.au-card{padding:16px;border-radius:14px;background:var(--lx-card);border:1px solid var(--au-line);min-width:0}
.au-card-h{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}
.au-card-h b{font-size:14px;font-weight:700;color:var(--lx-text);display:block}
.au-hint{display:block;margin-top:3px;font-size:12px;line-height:1.5;color:var(--lx-mut);font-weight:400}
.au-mut{font-size:12.5px;line-height:1.55;color:var(--lx-mut)}
.au-ok{font-size:13px;line-height:1.5;color:#34d399;font-weight:600}
.au-warn{font-size:12.5px;line-height:1.55;color:#fbbf24}
.au-empty{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:32px 20px}
.au-empty b{font-size:15px;color:var(--lx-text)}
.au-empty p{max-width:440px;font-size:12.5px;line-height:1.6;color:var(--lx-mut)}
.au-hero{display:flex;align-items:center;gap:18px}
.au-hero-b{min-width:0;flex:1;display:flex;flex-direction:column;align-items:flex-start}
.au-verdict{font-size:14px;line-height:1.5;color:var(--lx-mut)}
.au-verdict b{font-size:17px;color:var(--lx-text)}
.au-trend{margin-top:6px;font-size:13px;line-height:1.5;color:var(--lx-text)}
.au-math{margin-top:8px;padding:10px 12px;border-radius:10px;background:var(--lx-in);font-size:12px;line-height:1.6;color:var(--lx-mut)}
.au-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.au-kpi{display:flex;flex-direction:column;gap:3px;padding:12px 14px;border-radius:12px;background:var(--lx-card);border:1px solid var(--au-line);text-align:left;min-width:0;font-family:inherit}
.au-kpi-btn{cursor:pointer;transition:.15s}
.au-kpi-btn:hover{border-color:var(--lx-sel-border)}
.au-k-l{font-size:11.5px;color:var(--lx-mut);line-height:1.3}
.au-k-l small{font-size:10.5px}
.au-k-v{font-size:22px;font-weight:800;line-height:1.1;color:var(--lx-text);font-variant-numeric:tabular-nums}
.au-k-s{font-size:11px;color:var(--lx-mut);line-height:1.35}
.au-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.au-three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.au-list{display:flex;flex-direction:column;gap:8px}
.au-issue{border-radius:10px;border:1px solid var(--au-line);background:var(--lx-in);overflow:hidden;min-width:0}
.au-issue-h{display:flex;align-items:center;gap:10px;width:100%;padding:11px 12px;background:none;border:none;color:inherit;text-align:left;cursor:pointer;font-family:inherit}
.au-issue-t{display:block;flex:1;min-width:0}
.au-issue-t b{display:block;font-size:13px;font-weight:650;line-height:1.4;color:var(--lx-text)}
.au-issue-t small{display:block;margin-top:2px;font-size:11.5px;color:var(--lx-mut)}
.au-sev{flex-shrink:0;padding:2px 8px;border-radius:999px;border:1px solid;font-size:10.5px;font-weight:700;white-space:nowrap}
.au-chev{flex-shrink:0;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;color:var(--lx-mut);font-size:16px;background:var(--lx-card)}
.au-fix{display:none;padding:2px 14px 14px;border-top:1px solid var(--lx-border);background:var(--lx-in)}
.au-issue.open .au-fix{display:block}
.au-fix b{display:block;margin-top:10px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--lx-violet)}
.au-fix p{margin:4px 0 10px;font-size:13px;line-height:1.6;color:var(--lx-text)}
.au-print-pages{display:none}
.au-group{margin-top:16px}
.au-group-h{display:flex;align-items:center;gap:8px;padding-bottom:8px;margin-bottom:8px;border-bottom:2px solid}
.au-group-h b{font-size:13px;color:var(--lx-text)}
.au-group-h span{font-size:12px;color:var(--lx-mut)}
.au-legend{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;font-size:12px;line-height:1.5;color:var(--lx-mut)}
.au-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.au-legend b{color:var(--lx-text)}
.au-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.au-chip{height:30px;padding:0 12px;border-radius:999px;background:transparent;border:1px solid var(--lx-border);color:var(--lx-mut);font-size:12px;font-weight:600;cursor:pointer}
.au-chip:hover{color:var(--lx-text)}
.au-chip.on{background:var(--lx-sel-bg);border-color:var(--lx-sel-border);box-shadow:var(--lx-sel-glow);color:var(--lx-sel-text)}
.au-search{width:100%;height:38px;margin-bottom:10px;padding:0 12px;border-radius:10px;background:var(--lx-in);border:1px solid var(--lx-border);color:var(--lx-text);font-size:13px;outline:none}
.au-search:focus{border-color:var(--lx-sel-border)}
.au-stack{display:flex;height:10px;border-radius:999px;overflow:hidden;background:var(--lx-border)}
.au-stack i{display:block;height:100%}
.au-buckets{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column}
.au-buckets button{display:flex;align-items:center;gap:10px;width:100%;padding:9px 6px;background:none;border:none;border-radius:8px;color:inherit;text-align:left;cursor:pointer;font-family:inherit}
.au-buckets button:hover:not(:disabled){background:var(--lx-in)}
.au-buckets button:disabled{cursor:default;opacity:.55}
.au-dot{display:inline-block;flex-shrink:0;width:9px;height:9px;border-radius:50%}
.au-b-t{flex:1;min-width:0}
.au-b-t b{display:block;font-size:13px;font-weight:600;color:var(--lx-text)}
.au-b-t small{display:block;font-size:11.5px;color:var(--lx-mut)}
.au-b-n{display:flex;flex-direction:column;align-items:flex-end;font-size:15px;font-weight:700;color:var(--lx-text);font-variant-numeric:tabular-nums}
.au-b-n small{font-size:11px;font-weight:500;color:var(--lx-mut)}
.au-areas{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.au-areas button{display:block;width:100%;padding:9px 6px;background:none;border:none;border-radius:8px;color:inherit;text-align:left;cursor:pointer;font-family:inherit}
.au-areas button:hover{background:var(--lx-in)}
.au-a-top{display:flex;justify-content:space-between;gap:8px;font-size:13px}
.au-a-top b{font-weight:600;color:var(--lx-text)}
.au-a-top em{font-style:normal;font-weight:700;font-variant-numeric:tabular-nums}
.au-bar{display:block;height:6px;margin:6px 0 4px;border-radius:999px;background:var(--lx-border);overflow:hidden}
.au-bar i{display:block;height:100%;border-radius:999px}
.au-areas small{font-size:11.5px;color:var(--lx-mut)}
.au-vitals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.au-vital{display:flex;flex-direction:column;gap:3px;padding:12px 14px;border-radius:12px;background:var(--lx-in);border:1px solid var(--au-line)}
.au-v-s{font-size:12px;font-weight:700}
.au-more{margin-top:12px}
.au-more summary{cursor:pointer;font-size:12.5px;font-weight:600;color:#8f95ff;padding:4px 0}
.au-vrow{display:flex;flex-direction:column;gap:4px;padding:9px 0;border-top:1px solid var(--lx-border)}
.au-vm{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--lx-mut)}
.au-vm b{color:var(--lx-text)}
.au-bots{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.au-bot{padding:5px 11px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid}
.au-bot.ok{color:#34d399;border-color:rgba(52,211,153,.45)}
.au-bot.no{color:#f87171;border-color:rgba(248,113,113,.5)}
.au-skip{margin:0;padding-left:18px;list-style:disc;font-size:12.5px;line-height:1.6;color:var(--lx-mut)}
.au-plist{display:flex;flex-direction:column}
.au-prow{display:grid;grid-template-columns:minmax(0,1fr) 70px 120px 90px;align-items:center;gap:12px;padding:10px 4px;border-top:1px solid var(--lx-border);font-size:12.5px;color:var(--lx-text)}
.au-prow-h{border-top:none;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--lx-mut)}
.au-prow-m{grid-template-columns:minmax(0,1fr) 70px}
.au-pcell{display:flex;flex-direction:column;gap:2px;min-width:0}
.au-pcell small{font-size:11px;color:var(--lx-mut);overflow-wrap:anywhere}
.au-err{color:#f87171!important}
.au-url{color:var(--lx-cyan);text-decoration:none;overflow-wrap:anywhere;font-size:12.5px;line-height:1.45}
.au-url:hover{text-decoration:underline}
.au-vrow .au-url{color:var(--lx-text)}
.au-pm em{display:none;font-style:normal;color:var(--lx-mut);margin-right:6px}
.au-badge{display:inline-block;padding:1px 9px;border-radius:999px;border:1px solid;font-size:11px;font-weight:600}
.au-dist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
.au-dist li{display:grid;grid-template-columns:130px minmax(0,1fr) 34px 38px;align-items:center;gap:8px;font-size:12.5px;color:var(--lx-text)}
.au-d-l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.au-d-b{height:8px;border-radius:999px;background:var(--lx-border);overflow:hidden}
.au-d-b i{display:block;height:100%;border-radius:999px}
.au-dist b{text-align:right}
.au-dist small{text-align:right;font-size:11px;color:var(--lx-mut)}
.au-big{display:block;font-size:34px;line-height:1.1;font-weight:800;font-variant-numeric:tabular-nums}
.au-cmp{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px;font-size:12.5px;color:var(--lx-mut)}
.au-cmp select{height:36px;max-width:100%;padding:0 10px;border-radius:9px;background:var(--lx-in);border:1px solid var(--lx-border);color:var(--lx-text);font-size:12.5px}
.au-hist{display:flex;flex-direction:column}
.au-hrow{display:grid;grid-template-columns:minmax(0,1.6fr) repeat(4,minmax(0,1fr));gap:10px;align-items:center;padding:10px 4px;border-top:1px solid var(--lx-border);font-size:12.5px;color:var(--lx-text)}
.au-hrow-h{border-top:none;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--lx-mut)}
.au-hrow em{display:none;font-style:normal;color:var(--lx-mut);margin-right:6px}
.au-h-d small{display:block;font-size:11px;color:var(--lx-mut)}
.au-modal{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(4,4,10,.66)}
.au-sheet{display:flex;flex-direction:column;width:100%;max-height:86vh;border-radius:16px;background:var(--lx-card);border:1px solid var(--lx-border);box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden}
.au-sheet-h{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px;border-bottom:1px solid var(--lx-border)}
.au-sheet-h b{font-size:15px;color:var(--lx-text);line-height:1.35}
.au-sheet-h p{margin-top:4px;font-size:12px;line-height:1.5;color:var(--lx-mut)}
.au-sheet-b{flex:1;min-height:0;overflow-y:auto;padding:6px 16px 16px}
.au-x{flex-shrink:0;width:30px;height:30px;border-radius:8px;background:var(--lx-in);border:1px solid var(--lx-border);color:var(--lx-mut);cursor:pointer}
@media (max-width:899px){
  .au-three{grid-template-columns:1fr}
}
@media (max-width:719px){
  .au-two{grid-template-columns:1fr}
  .au-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .au-vitals{grid-template-columns:1fr}
  .au-h1{font-size:18px}
  .au-head .au-actions{width:100%}
  .au-head .au-btn{flex:1;height:40px}
  .au-card{padding:14px;border-radius:12px}
  .au-hero{flex-direction:column;align-items:flex-start;gap:14px}
  .au-prow{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:12px 2px}
  .au-prow-h{display:none}
  .au-prow .au-pcell{flex:1 1 100%}
  .au-pm em{display:inline}
  .au-dist li{grid-template-columns:104px minmax(0,1fr) 30px 34px}
  .au-hrow{grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 10px}
  .au-hrow-h{display:none}
  .au-hrow .au-h-d{grid-column:1/-1}
  .au-hrow em{display:inline}
  .au-modal{align-items:flex-end;padding:0}
  .au-sheet{max-width:none!important;max-height:90dvh;border-radius:18px 18px 0 0}
  .au-tab{padding:0 9px;font-size:12.5px;gap:4px}
  .au-cmp select{width:100%}
}
@media (max-width:360px){
  .au-kpis{grid-template-columns:1fr 1fr}
  .au-k-v{font-size:20px}
}
@media print{
  body *{visibility:hidden}
  #lx-audit-report,#lx-audit-report *{visibility:visible}
  #lx-audit-report{position:absolute;left:0;top:0;width:100%;max-width:none}
  .lx-audit-noprint{display:none!important}
  .au-fix{display:block!important}
  .au-print-pages{display:block;margin:0 0 8px;padding-left:16px;font-size:11px;word-break:break-all}
  .au-tabs{display:none}
}
`;

/** The report's shape while it loads — heading, tab strip, the Overview's card grid — drawn as
 *  soft blocks in the same places the real content lands. No numbers, no words that could be
 *  read as a result. The action buttons are real and usable straight away. */
function ReportSkeleton({ actions }: { actions: React.ReactNode }) {
  const block = (w: string | number, h: number, extra: React.CSSProperties = {}) => (
    <div className="lx-sk" style={{ width: w, height: h, borderRadius: 6, ...extra }} />
  );
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading your site audit">
      <style>{`
        .lx-sk{background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.10) 50%,rgba(255,255,255,.05) 75%);background-size:200% 100%;animation:lx-sk 1.4s ease-in-out infinite}
        @keyframes lx-sk{0%{background-position:200% 0}100%{background-position:-200% 0}}
      `}</style>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {block(260, 22)}
          <div className="mt-2">{block(200, 12)}</div>
        </div>
        {actions}
      </div>
      <div className="flex gap-5 overflow-hidden border-b pb-3" style={{ borderColor: "var(--lx-border)" }}>
        {TABS.map((t) => <div key={t} className="shrink-0">{block(t.length * 7 + 20, 12)}</div>)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="lx-card2 p-4">
          {block(80, 14)}
          <div className="mt-3 flex items-center gap-6">
            {block(92, 92, { borderRadius: "50%" })}
            <div className="flex-1 space-y-2">{block("70%", 12)}{block("45%", 12)}</div>
          </div>
        </div>
        <div className="lx-card2 p-4">
          {block(110, 14)}
          <div className="mt-3 flex items-center gap-3">{block(40, 26)}{block("100%", 8, { borderRadius: 999 })}</div>
          <div className="mt-3 space-y-2">{block("60%", 12)}{block("55%", 12)}{block("50%", 12)}</div>
        </div>
      </div>
      <div className="lx-card2 px-4 py-3">{block("55%", 12)}</div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="lx-card2 p-4">{block(60, 14)}<div className="mt-2">{block(48, 34)}</div><div className="mt-3">{block("100%", 44)}</div></div>
        <div className="lx-card2 p-4">{block(80, 14)}<div className="mt-2">{block(48, 34)}</div><div className="mt-3">{block("100%", 44)}</div></div>
      </div>
    </div>
  );
}

/** The running audit, as a real bar: the phase it is in, how far through that phase (done of
 *  total pages, from jobs_log), the five steps with the current one lit, and the clock. `job`
 *  is null while pg-boss is still handing the job to a worker — said as "Queued", not faked
 *  as progress. */
function AuditProgress({ job, startedAt }: { job: AuditJob | null; startedAt: number }) {
  const p = job?.progress ?? null;
  const fraction = job ? jobFraction(p) : 0;
  const pct = Math.max(1, Math.round(fraction * 100));
  const phaseIdx = p?.phase ? AUDIT_PHASES.findIndex((x) => x.id === p.phase) : -1;
  const label = !job ? "Queued — waiting for a worker to pick it up" : p?.label ?? "Starting…";
  const detail = p?.total && p.done != null ? `${p.done} of ${p.total}` : null;
  return (
    <div className="lx-card2 lx-audit-noprint p-4" style={{ borderColor: "rgba(139,92,246,.45)" }} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="lx-pulse h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--lx-violet)" }} />
        <b className="lx-12 flex-1">{label}</b>
        {detail && <span className="lx-11 lx-mut">{detail}</span>}
        <b className="lx-12" style={{ color: "var(--lx-violet)" }}>{pct}%</b>
        <ElapsedLabel startedAt={startedAt} />
      </div>
      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--lx-border)" }}>
        <div className="h-full" style={{ width: `${pct}%`, borderRadius: 999, transition: "width .6s ease", background: "linear-gradient(90deg,#4f46e5,#7c3aed,#8b5cf6)" }} />
      </div>
      <ol className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-5">
        {AUDIT_PHASES.map((ph, i) => {
          const state = i < phaseIdx ? "done" : i === phaseIdx ? "now" : "next";
          return (
            <li key={ph.id} className="lx-10 flex items-center gap-1.5" style={{ color: state === "next" ? "var(--lx-mut)" : "var(--lx-text)", fontWeight: state === "now" ? 700 : 500 }}>
              <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full" style={{ fontSize: 9, border: `1px solid ${state === "next" ? "var(--lx-border)" : "var(--lx-violet)"}`, background: state === "done" ? "var(--lx-violet)" : "transparent", color: state === "done" ? "#fff" : "var(--lx-violet)" }}>
                {state === "done" ? "✓" : i + 1}
              </span>
              {ph.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The last run's failure, readable on the page: what failed, the raw cause under it, what to
 *  do, which attempt, how long it ran. Every field is jobs_log's own (workers.ts's
 *  explainAgentError) — nothing here is composed by the page. A stalled run shows what it last
 *  reported and when. */
function AuditFailure({ job, onRetry, busy }: { job: AuditJob; onRetry: () => void; busy: boolean }) {
  const stalled = job.status === "running" && job.stalled;
  const e = job.error;
  const mins = e?.durationMs != null ? Math.round(e.durationMs / 60000) : null;
  return (
    <div className="lx-card2 lx-audit-noprint p-4" style={{ borderColor: "rgba(248,113,113,.5)" }} role="alert">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <b className="lx-12" style={{ color: "#f87171" }}>{stalled ? "The last audit stopped responding" : "The last audit failed"}</b>
          <p className="lx-11 mt-1">
            {stalled
              ? `It last reported "${job.progress.label ?? job.progress.phase ?? "starting"}"${job.progress.at ? ` at ${new Date(job.progress.at).toLocaleTimeString()}` : ""} and has written nothing since. Started ${new Date(job.createdAt).toLocaleString()}.`
              : e?.message ?? "No reason was recorded."}
          </p>
          {!stalled && e?.cause && (
            <pre className="lx-10 mt-2 overflow-x-auto rounded-md p-2" style={{ background: "rgba(0,0,0,.35)", border: "1px solid var(--lx-border)", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--lx-mut)" }}>{e.cause}</pre>
          )}
          <p className="lx-11 mt-2" style={{ color: "var(--lx-text)" }}>
            {stalled
              ? "The server now gives up on a page that hangs for more than 75 seconds and on the whole speed check after 7 minutes, so a run started now cannot get stuck the same way."
              : e?.hint ?? "Run it again. If it fails the same way twice, the cause above is what to send to support."}
          </p>
          <p className="lx-10 lx-mut mt-2">
            {job.action}
            {e?.attempt != null && e?.attempts != null && ` · attempt ${e.attempt} of ${e.attempts}`}
            {mins != null && ` · ran ${mins || "<1"} min`}
            {` · ${new Date(job.createdAt).toLocaleString()}`}
          </p>
        </div>
        <button className="lx-grad lx-11 shrink-0 px-3 py-1.5" disabled={busy} onClick={onRetry}>{busy ? "Starting…" : "Run it again"}</button>
      </div>
    </div>
  );
}

function ElapsedLabel({ startedAt }: { startedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return <span className="lx-10 lx-mut shrink-0">{m}:{String(s).padStart(2, "0")}</span>;
}

/** The score, as a ring — the one visual a Semrush-style report leads with. Pure SVG, no
 *  charting dependency: one number between 0 and 100 is a single arc. Brand colour, not a
 *  red/amber/green tone — Semrush's own Site Health gauge doesn't shift colour by score either.
 *  Uses the SAME gradient as this app's own primary button (`.lx-grad`). */
function ScoreGauge({ score }: { score: number }) {
  const rad = 34;
  const c = 2 * Math.PI * rad;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: 92, height: 92 }} aria-label={`Site health score: ${score} out of 100`}>
      <svg width={92} height={92} viewBox="0 0 92 92">
        <defs>
          <linearGradient id="lx-audit-score-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="55%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <circle cx={46} cy={46} r={rad} fill="none" stroke="var(--lx-border)" strokeWidth={8} />
        <circle cx={46} cy={46} r={rad} fill="none" stroke="url(#lx-audit-score-grad)" strokeWidth={8} strokeLinecap="round" strokeDasharray={`${filled} ${c}`} transform="rotate(-90 46 46)" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <b className="font-extrabold leading-none" style={{ fontSize: 26, color: "var(--lx-violet)" }}>{score}%</b>
        <span className="lx-10 lx-mut" style={{ fontSize: 9 }}>site health</span>
      </div>
    </div>
  );
}

/** A filled line chart with a dot per run, pure SVG — Semrush draws its Errors/Warnings history
 *  this way. Headroom (PAD) so a line that is flat AT THE MAX (every run had the same count —
 *  the exact case that once rendered as a solid block, found live 2026-09-05) keeps visible
 *  space above it and a visible stroke instead of clipping on the SVG's top edge. */
function AreaTrend({ points, color }: { points: number[]; color: string }) {
  const w = 240;
  const h = 44;
  const PAD = 6;
  const usable = h - PAD * 2;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const coords = points.map((p, i) => [i * step, PAD + usable - (p / max) * usable] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg className="mt-2" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {coords.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} fill={color} />)}
    </svg>
  );
}

