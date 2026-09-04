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
  pages: CrawledPage[];
  websiteUrl: string | null;
  aiSearch: BotAccess[] | null;
  catalogue: CatalogueEntry[];
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

type Tab = "overview" | "issues" | "pages" | "statistics" | "compare" | "progress";
type Bucket = "Healthy" | "Broken" | "Have issues" | "Redirects" | "Blocked";

const RANK: Record<Severity, number> = { block: 0, warn: 1, info: 2 };
const ISSUES_COLLAPSED_COUNT = 5;
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

/** What a Site Health number means, in words (owner 2026-09-04: "kaunsa best hai, kaisa user
 *  samjhe"). Bands follow the house formula's own arithmetic — 100 − 25·block − 5·warn — so
 *  "Excellent" is a site with nothing serious and at most two warnings, "Poor" is a site with
 *  two or more serious problems. */
const HEALTH_BANDS: { min: number; label: string; meaning: string }[] = [
  { min: 90, label: "Excellent", meaning: "Nothing serious, a couple of things worth polishing." },
  { min: 70, label: "Good", meaning: "No more than one serious problem. Fix it and you are in the top band." },
  { min: 50, label: "Needs work", meaning: "One or two serious problems plus a handful of warnings. Errors first." },
  { min: 0, label: "Poor", meaning: "Several serious problems — pages Google cannot reach or read. Start with the Errors list." },
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
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "issues", label: "Issues" },
  { id: "pages", label: "Crawled Pages" },
  { id: "statistics", label: "Statistics" },
  { id: "compare", label: "Compare Crawls" },
  { id: "progress", label: "Progress" },
];

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
  const [fixModal, setFixModal] = useState<Issue | null>(null);
  const [historyModal, setHistoryModal] = useState(false);
  const [sevFilter, setSevFilter] = useState<"all" | Severity>("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [bucketFilter, setBucketFilter] = useState<"all" | Bucket>("all");
  // Compare Crawls: which older run to hold the latest against, and that run once fetched.
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compareRun, setCompareRun] = useState<RunLite | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Default the comparison to the run before the latest, and fetch whichever run is picked.
  useEffect(() => {
    if (tab !== "compare" || !state?.history?.length) return;
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
      if (j && isNewRow && (j.status === "error" || j.status === "skipped")) {
        setPolling(null);
        toast("The audit failed — the reason is on the page.", "error");
        return;
      }
      if (j && isNewRow && j.stalled) {
        setPolling(null);
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

  const actions = (
    <div className="flex flex-wrap items-center gap-2 lx-audit-noprint">
      <button className="lx-grad lx-11 px-3 py-1.5" disabled={starting || !!polling} onClick={runAudit}>
        {starting ? "Starting…" : polling ? "Auditing…" : state?.latest ? "Re-audit" : "Audit my site"}
      </button>
      <button className="lx-ghost" onClick={() => window.print()} title="Opens your browser's print dialog — choose 'Save as PDF' as the destination">
        Export as PDF
      </button>
    </div>
  );

  const head = (
    <div className="flex flex-wrap items-start justify-between gap-4 lx-audit-noprint">
      <div>
        <h1 className="text-lg font-bold">Site audit</h1>
        <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 560 }}>
          What&apos;s broken, hidden from Google, or costing you traffic — across the whole site, not one page at a time. Runs itself every week.
        </p>
      </div>
      {actions}
    </div>
  );

  // The running job's own row, if the one on file is the new run (not the previous run's row
  // still sitting there while pg-boss hands the new job to a worker).
  const liveJob = polling && job && job.id !== polling.sinceJobId && job.status === "running" ? job : null;
  const progressBanner = polling && <AuditProgress job={liveJob} startedAt={polling.startedAt} />;

  // The last run's failure, shown until a newer report exists — the "proper error log" a
  // person can read without opening Workspace (owner, 2026-09-04). A stalled run (no progress
  // write for 12 minutes) is the same card with what it last reported.
  const failedJob =
    !polling && job && (job.status === "error" || job.status === "skipped" || job.stalled) && (!state?.latest || Date.parse(job.createdAt) > Date.parse(state.latest.createdAt))
      ? job
      : null;
  const failureCard = failedJob && <AuditFailure job={failedJob} onRetry={runAudit} busy={starting} />;

  if (loading && !state) {
    // First open: the report's own layout as a skeleton, so the page does not flash a generic
    // header + "Loading…" and then jump to a different shape (owner, live screenshot 2026-09-04).
    return <ReportSkeleton actions={actions} />;
  }

  if (state && !state.schemaReady) {
    return (
      <div className="space-y-4">
        {head}
        <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
          <div className="text-2xl">🧩</div>
          <b className="lx-12">Not set up on this database yet</b>
          <p className="lx-11 lx-mut">Migration 020 hasn&apos;t been applied here, so there&apos;s nowhere to file a report.</p>
        </div>
      </div>
    );
  }

  const r = state?.latest ?? null;

  if (!r) {
    return (
      <div className="space-y-4">
        {head}
        {progressBanner}
        {failureCard}
        <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
          <div className="text-2xl">🩺</div>
          <b className="lx-12">No audit yet</b>
          <p className="lx-11 lx-mut" style={{ maxWidth: 460 }}>Run one now, or leave it — we check every week on our own and tell you when something changes.</p>
          {!polling && (
            <button className="lx-grad lx-11 mt-2 px-3 py-1.5" disabled={starting} onClick={runAudit}>
              {starting ? "Starting…" : "Check my site now"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const history = state!.history;
  const last = history[history.length - 1] ?? null;
  const diff = r.previousScore === null ? null : r.score - r.previousScore;
  const allIssues = [...r.issues].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);
  const topIssues = allIssues.slice(0, ISSUES_COLLAPSED_COUNT);
  const bySev = (s: Severity) => allIssues.filter((i) => i.severity === s);
  const notices = bySev("info").length;

  const vitals = r.performance ?? [];
  // "Measured" means a number came back. Reports from before performance.ts learned to call a
  // numberless Lighthouse run a failure (2026-09-04) have ok:true rows with every metric null;
  // those are not measurements and are not counted as any.
  const measured = vitals.filter((p) => p.ok && (p.lcpMs != null || p.cls != null || p.tbtMs != null || p.performanceScore != null));
  const avgLcp = avg(measured.map((p) => p.lcpMs));
  const avgCls = avg(measured.map((p) => p.cls));

  const pages = r.pages ?? [];
  const bucketCount = (b: Bucket) => pages.filter((p) => bucketOf(p) === b).length;

  // Thematic Reports — Semrush's own category rings, each an exact fraction: checks in that
  // category the run could make (`catalogue`, shipped per run) minus the distinct ones that
  // fired, over the total. No catalogue on file (older report) → no rings, said plainly.
  const categories = Array.from(new Set(r.catalogue.map((c) => c.category)));
  const thematic = categories.map((cat) => {
    const total = r.catalogue.filter((c) => c.category === cat).length;
    const fired = new Set(r.issues.filter((i) => i.category === cat).map((i) => i.id)).size;
    return { cat, total, fired, pct: total ? Math.round(((total - fired) / total) * 100) : 100 };
  });
  const issueCategories = Array.from(new Set(allIssues.map((i) => i.category ?? "Other")));

  const filteredIssues = allIssues.filter((i) => (sevFilter === "all" || i.severity === sevFilter) && (catFilter === "all" || (i.category ?? "Other") === catFilter));
  const domain = r.websiteUrl ? r.websiteUrl.replace(/^https?:\/\//, "") : "your site";

  const chip = (active: boolean, label: string, onClick: () => void, color?: string) => (
    <button
      key={label}
      className="lx-10 rounded-full px-2.5 py-1 font-semibold"
      style={{
        border: `1px solid ${active ? color ?? "var(--lx-violet)" : "var(--lx-border)"}`,
        background: active ? "rgba(139,92,246,.12)" : "transparent",
        color: active ? color ?? "var(--lx-text)" : "var(--lx-mut)",
        cursor: "pointer",
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4" id="lx-audit-report">
      {/* Print-to-PDF: hides everything else on the page (sidebar, chat panel, nav) and shows
          only this report — the standard "print just one element" technique, so it works
          regardless of what the surrounding shell's own class names happen to be today or
          later. No new dependency: every browser's own print dialog already offers "Save as
          PDF". */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #lx-audit-report, #lx-audit-report * { visibility: visible; }
          #lx-audit-report { position: absolute; left: 0; top: 0; width: 100%; }
          .lx-audit-noprint { display: none !important; }
        }
        @media screen { .lx-audit-print-only { display: none !important; } }
        @media print { .lx-audit-print-only { display: block !important; } }
      `}</style>

      {/* Real domain, shown big — Semrush's own "Site Audit: domain.com" heading, from
          agents/audit.ts's own `target.origin` — not a static page title. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Site Audit: {domain}</h1>
          <p className="lx-10 lx-mut mt-1">
            Updated {new Date(r.createdAt).toLocaleString()} · Pages crawled: {r.pagesChecked}
            {r.trigger && ` · ${TRIGGER_LABEL[r.trigger]}`}
            {r.seconds != null && ` · ${Math.round(r.seconds / 60) || 1} min`}
          </p>
        </div>
        {actions}
      </div>
      {progressBanner}
      {failureCard}

      {/* TABS — Semrush's own top nav (the ones this app has real data for; Statistics /
          Compare Crawls / JS Impact are §27 rounds A and C). */}
      <div className="lx-scroll flex gap-5 overflow-x-auto border-b lx-audit-noprint" style={{ borderColor: "var(--lx-border)" }}>
        {TABS.map((t) => (
          <button key={t.id} className={`lx-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "issues" && allIssues.length > 0 && <span className="lx-10 lx-mut ml-1.5">{allIssues.length}</span>}
            {t.id === "pages" && pages.length > 0 && <span className="lx-10 lx-mut ml-1.5">{pages.length}</span>}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════ OVERVIEW ══════════════════════════════ */}
      {tab === "overview" && (
        <>
          {/* LAST RUN — one line, right under the tabs (owner 2026-09-04: "last audit ka tab
              upar karo nav ke niche"). The full history is one click away. */}
          {last && (
            <div className="lx-card2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 lx-audit-noprint">
              <b className="lx-12">Last audit</b>
              <span className="lx-11 lx-mut">{new Date(last.createdAt).toLocaleString()}</span>
              <span className="lx-11 lx-mut">{last.trigger ? TRIGGER_LABEL[last.trigger] : "—"}</span>
              <span className="lx-11">Score <b style={{ color: TONE_COLOR[tone(last.score)] }}>{last.score}</b></span>
              <span className="lx-11">{last.blocks} errors · {last.warns} warnings · {last.pagesChecked} pages</span>
              <button className="lx-11 ml-auto underline" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--lx-cyan)" }} onClick={() => setHistoryModal(true)}>
                View all {history.length} run{history.length === 1 ? "" : "s"} →
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="lx-card2 p-4">
              <b className="lx-12">Site Health</b>
              <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                <ScoreGauge score={r.score} />
                <div className="min-w-0 flex-1">
                  <p className="lx-12">
                    <b style={{ color: "var(--lx-violet)" }}>{healthBand(r.score).label}</b>
                    <span className="lx-mut"> · {healthBand(r.score).meaning}</span>
                  </p>
                  <p className="lx-11 mt-1.5">
                    {diff === null
                      ? "First audit — nothing to compare it to yet."
                      : diff === 0
                        ? `No change since the last audit (${r.previousScore}).`
                        : diff > 0
                          ? `Up ${diff} since the last audit (was ${r.previousScore}).`
                          : `Down ${Math.abs(diff)} since the last audit (was ${r.previousScore}).`}
                  </p>
                </div>
              </div>
              {/* The scale, so a number means something: which band this site is in, and what
                  the others are. Text only — the gauge stays brand violet at every score. */}
              <div className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {[...HEALTH_BANDS].reverse().map((b, i, arr) => {
                  const max = i === arr.length - 1 ? 100 : arr[i + 1].min - 1;
                  const on = healthBand(r.score).min === b.min;
                  return (
                    <div key={b.label} className="rounded-md px-2 py-1.5" style={{ border: `1px solid ${on ? "var(--lx-violet)" : "var(--lx-border)"}`, background: on ? "rgba(139,92,246,.12)" : "transparent" }} title={b.meaning}>
                      <span className="lx-10 block" style={{ color: on ? "var(--lx-text)" : "var(--lx-mut)", fontWeight: on ? 700 : 500 }}>{b.label}</span>
                      <span className="lx-10 lx-mut">{b.min}–{max}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lx-card2 p-4">
              <b className="lx-12">Crawled Pages</b>
              {pages.length > 0 ? (
                <>
                  <div className="mt-1 flex items-center gap-3">
                    <b className="font-extrabold" style={{ fontSize: 22, color: "var(--lx-violet)" }}>{pages.length}</b>
                    <div className="flex h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--lx-border)" }}>
                      {BUCKET_ORDER.map((b) => {
                        const n = bucketCount(b);
                        return n > 0 ? <div key={b} style={{ width: `${(n / pages.length) * 100}%`, background: BUCKET_COLOR[b] }} /> : null;
                      })}
                    </div>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {BUCKET_ORDER.map((b) => (
                      <CrawledRow key={b} color={BUCKET_COLOR[b]} label={b} count={bucketCount(b)} onClick={() => { setBucketFilter(b); setTab("pages"); }} />
                    ))}
                  </ul>
                </>
              ) : (
                <p className="lx-11 lx-mut mt-3">Not on file for this report — the next audit will include a full page-by-page breakdown.</p>
              )}
            </div>
          </div>

          {r.aiSearch && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="lx-card2 p-4">
                <b className="lx-12">AI Search Health</b>
                <p className="lx-10 lx-mut mt-1">Whether the named AI crawlers may read your site, per your own robots.txt.</p>
                <div className="mt-3 flex items-center gap-6">
                  <AiHealthGauge allowed={r.aiSearch.filter((b) => b.allowed).length} total={r.aiSearch.length} />
                  <p className="lx-11 flex-1">
                    {r.aiSearch.every((b) => b.allowed)
                      ? "Every named AI crawler is allowed in."
                      : `${r.aiSearch.filter((b) => !b.allowed).length} of ${r.aiSearch.length} named AI crawlers ${r.aiSearch.filter((b) => !b.allowed).length === 1 ? "is" : "are"} blocked by robots.txt.`}
                  </p>
                </div>
              </div>
              <div className="lx-card2 p-4">
                <b className="lx-12">AI Crawler Access</b>
                <p className="lx-10 lx-mut mt-1">Real robots.txt rules, one per named bot — a directive check, not a traffic log.</p>
                <ul className="mt-3 space-y-2">
                  {r.aiSearch.map((b) => (
                    <li key={b.bot} className="flex items-center gap-2 lx-11">
                      <span className="lx-10 shrink-0 rounded-full px-2 py-0.5 font-semibold" style={{ color: b.allowed ? "#34d399" : "#f87171", border: `1px solid ${b.allowed ? "#34d399" : "#f87171"}` }}>
                        {b.allowed ? "Allowed" : "Blocked"}
                      </span>
                      <span className="flex-1">{b.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SeverityCard label="Errors" sub="Fix first" count={r.blocks} color="#f87171" points={history.map((h) => h.blocks)} />
            <SeverityCard label="Warnings" sub="Worth improving" count={r.warns} color="#fbbf24" points={history.map((h) => h.warns)} />
          </div>

          {/* THEMATIC REPORTS — Semrush's own category rings, every % an exact fraction over the
              run's own catalogue (see the computation above). */}
          <div className="lx-card2 p-4">
            <b className="lx-12">Thematic Reports</b>
            {thematic.length ? (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {thematic.map((t) => (
                  <button
                    key={t.cat}
                    className="rounded-lg p-3 text-left"
                    style={{ border: "1px solid var(--lx-border)", background: "transparent", cursor: "pointer" }}
                    onClick={() => { setCatFilter(t.cat); setSevFilter("all"); setTab("issues"); }}
                    title={`${t.total - t.fired} of ${t.total} checks passed`}
                  >
                    <span className="lx-11 block">{t.cat}</span>
                    <div className="mt-1.5 flex items-center gap-2">
                      <MiniRing pct={t.pct} />
                      <b className="font-extrabold" style={{ fontSize: 20, color: "var(--lx-violet)" }}>{t.pct}%</b>
                    </div>
                    <span className="lx-10 lx-mut">{t.fired ? `${t.fired} issue${t.fired === 1 ? "" : "s"} · View details` : "No issues"}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="lx-11 lx-mut mt-3">Not on file for this report — the next audit will include per-category scores.</p>
            )}
          </div>

          {vitals.length > 0 && (
            <div className="lx-card2 p-4">
              <b className="lx-12">Core Web Vitals</b>
              <p className="lx-10 lx-mut mt-1">
                Real Chrome (Lighthouse), mobile. {measured.length} of {vitals.length} sampled page{vitals.length === 1 ? "" : "s"} measured — the sample is the home page plus up to {Math.max(0, vitals.length - 1)} more, because each Lighthouse run takes 10–20 seconds. Every crawled page&apos;s response time is in Crawled Pages.
              </p>
              {measured.length === 0 ? (
                <p className="lx-11 lx-mut mt-3">Nothing was measured in this run — each page below says why. The next audit tries again.</p>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <VitalTile label="Largest Contentful Paint" value={avgLcp != null ? `${(avgLcp / 1000).toFixed(1)}s` : "—"} good={avgLcp == null ? null : avgLcp <= 2500} hint="Good is 2.5 s or under" />
                  <VitalTile label="Cumulative Layout Shift" value={avgCls != null ? avgCls.toFixed(2) : "—"} good={avgCls == null ? null : avgCls <= 0.1} hint="Good is 0.1 or under" />
                </div>
              )}
              <div className="lx-scroll mt-3" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                  <thead>
                    <tr className="lx-10 lx-mut" style={{ textAlign: "left" }}>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>Page</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>LCP</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>CLS</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vitals.map((p) => (
                      <tr key={p.url} style={{ borderTop: "1px solid var(--lx-border)" }}>
                        <td className="lx-11" style={{ padding: "8px", color: "#e6e6f2", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.url}>{p.url}</td>
                        {p.ok && (p.lcpMs != null || p.cls != null || p.performanceScore != null) ? (
                          <>
                            <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.lcpMs != null ? `${(p.lcpMs / 1000).toFixed(1)}s` : "—"}</td>
                            <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.cls != null ? p.cls.toFixed(2) : "—"}</td>
                            <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.performanceScore != null ? `${p.performanceScore}/100` : "—"}</td>
                          </>
                        ) : (
                          <td className="lx-10 lx-mut" style={{ padding: "8px" }} colSpan={3}>Not measured{p.error ? ` — ${p.error}` : " — Lighthouse returned no numbers for this page"}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="lx-card2 p-4">
            <div className="flex items-center justify-between">
              <b className="lx-12">Top issues</b>
              {notices > 0 && <span className="lx-10 lx-mut">{notices} notice{notices === 1 ? "" : "s"} for the record</span>}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {topIssues.length ? (
                topIssues.map((i) => <IssueRow key={i.id} issue={i} onPages={() => setPagesModal(i)} onFix={() => setFixModal(i)} />)
              ) : (
                <div className="flex flex-col items-center gap-2 p-8 text-center">
                  <div className="text-2xl">✨</div>
                  <p className="lx-11 lx-mut">Nothing to fix — every check passed.</p>
                </div>
              )}
            </div>
            {allIssues.length > ISSUES_COLLAPSED_COUNT && (
              <button className="lx-ghost lx-11 mt-3 w-full lx-audit-noprint" onClick={() => { setSevFilter("all"); setCatFilter("all"); setTab("issues"); }}>
                View all {allIssues.length} issues →
              </button>
            )}
          </div>

          {r.skipped.length > 0 && (
            <div className="lx-card2 p-4">
              <b className="lx-12">What this audit did not measure</b>
              <ul className="mt-2 space-y-1 pl-4" style={{ listStyle: "disc" }}>
                {r.skipped.map((s, n) => <li key={n} className="lx-10 lx-mut">{s}</li>)}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════ ISSUES ════════════════════════════════ */}
      {tab === "issues" && (
        <div className="lx-card2 p-4">
          <div className="flex flex-wrap items-center gap-2 lx-audit-noprint">
            {chip(sevFilter === "all", `All ${allIssues.length}`, () => setSevFilter("all"))}
            {chip(sevFilter === "block", `Errors ${bySev("block").length}`, () => setSevFilter("block"), "#f87171")}
            {chip(sevFilter === "warn", `Warnings ${bySev("warn").length}`, () => setSevFilter("warn"), "#fbbf24")}
            {chip(sevFilter === "info", `Notices ${bySev("info").length}`, () => setSevFilter("info"))}
          </div>
          {issueCategories.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 lx-audit-noprint">
              {chip(catFilter === "all", "All categories", () => setCatFilter("all"))}
              {issueCategories.map((c) => chip(catFilter === c, `${c} ${allIssues.filter((i) => (i.category ?? "Other") === c).length}`, () => setCatFilter(c)))}
            </div>
          )}
          {(["block", "warn", "info"] as Severity[]).map((s) => {
            const group = filteredIssues.filter((i) => i.severity === s);
            if (!group.length) return null;
            return (
              <div key={s} className="mt-4">
                <div className="flex items-center gap-2 pb-2" style={{ borderBottom: `2px solid ${SEV_COLOR[s]}` }}>
                  <b className="lx-12">{SEV_LABEL[s]}s</b>
                  <span className="lx-11 lx-mut">({group.length})</span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {group.map((i) => <IssueRow key={i.id} issue={i} onPages={() => setPagesModal(i)} onFix={() => setFixModal(i)} />)}
                </div>
              </div>
            );
          })}
          {filteredIssues.length === 0 && <p className="lx-11 lx-mut mt-4">No issues match this filter.</p>}
        </div>
      )}

      {/* ══════════════════════════════════════════ CRAWLED PAGES ═════════════════════════ */}
      {tab === "pages" && (
        <div className="lx-card2 p-4">
          {pages.length === 0 ? (
            <p className="lx-11 lx-mut">Not on file for this report — the next audit will include a full page-by-page breakdown.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 lx-audit-noprint">
                {chip(bucketFilter === "all", `All ${pages.length}`, () => setBucketFilter("all"))}
                {BUCKET_ORDER.map((b) => chip(bucketFilter === b, `${b} ${bucketCount(b)}`, () => setBucketFilter(b), BUCKET_COLOR[b]))}
              </div>
              <div className="lx-scroll mt-3" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                  <thead>
                    <tr className="lx-10 lx-mut" style={{ textAlign: "left" }}>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>URL</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Status</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Health</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Response</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>Redirects to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.filter((p) => bucketFilter === "all" || bucketOf(p) === bucketFilter).map((p) => {
                      const b = bucketOf(p);
                      return (
                        <tr key={p.url} style={{ borderTop: "1px solid var(--lx-border)" }}>
                          <td className="lx-11" style={{ padding: "8px", wordBreak: "break-all" }}>
                            <a href={p.url} target="_blank" rel="noreferrer noopener" className="underline" style={{ color: "var(--lx-cyan)" }}>{p.url}</a>
                          </td>
                          <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.status ?? "—"}</td>
                          <td className="lx-10" style={{ padding: "8px", whiteSpace: "nowrap" }}>
                            <span className="rounded-full px-2 py-0.5 font-semibold" style={{ color: BUCKET_COLOR[b], border: `1px solid ${BUCKET_COLOR[b]}` }}>{b}</span>
                          </td>
                          <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.ms != null ? `${p.ms} ms` : "—"}</td>
                          <td className="lx-10 lx-mut" style={{ padding: "8px", wordBreak: "break-all" }}>{p.redirectedTo ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════ STATISTICS ════════════════════════════ */}
      {tab === "statistics" && (() => {
        // Every distribution here is a count of REAL crawled pages in a bucket — the same
        // numbers the checks judged, stored per page since 2026-09-05. An older report has the
        // status/response columns but not the per-page measurements, and says so per card.
        const html = pages.filter((p) => typeof p.titleChars === "number");
        const hasStats = html.length > 0;
        const notOnFile = "Not on file for this report — the next audit records it per page.";
        const statusRows = [
          { label: "200 OK", count: pages.filter((p) => p.status != null && p.status >= 200 && p.status < 300).length, color: BUCKET_COLOR.Healthy },
          { label: "3xx redirect", count: pages.filter((p) => p.status != null && p.status >= 300 && p.status < 400).length, color: BUCKET_COLOR.Redirects },
          { label: "4xx client error", count: pages.filter((p) => p.status != null && p.status >= 400 && p.status < 500).length, color: BUCKET_COLOR.Broken },
          { label: "5xx server error", count: pages.filter((p) => p.status != null && p.status >= 500).length, color: BUCKET_COLOR.Broken },
          { label: "Unreachable", count: pages.filter((p) => p.status == null).length, color: BUCKET_COLOR.Blocked },
        ];
        const avgMs = avg(pages.map((p) => p.ms));
        return (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="Pages crawled" value={String(pages.length || r.pagesChecked)} />
              <StatTile label="Healthy" value={pages.length ? `${Math.round((bucketCount("Healthy") / pages.length) * 100)}%` : "—"} sub={pages.length ? `${bucketCount("Healthy")} of ${pages.length}` : undefined} />
              <StatTile label="Errors" value={String(r.blocks)} color="#f87171" />
              <StatTile label="Warnings" value={String(r.warns)} color="#fbbf24" />
              <StatTile label="Notices" value={String(notices)} />
              <StatTile label="Avg. response" value={avgMs != null ? `${avgMs} ms` : "—"} sub="time to first byte" />
            </div>
            {pages.length === 0 ? (
              <div className="lx-card2 p-4"><p className="lx-11 lx-mut">{notOnFile}</p></div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Distribution title="Status codes" note="Every crawled URL, by what the server answered." rows={statusRows} />
                <Distribution
                  title="Response time"
                  note="Time to first byte per page. Over 1.5 s is the slow-response line."
                  rows={bucketBy(pages, (p) => p.ms, [
                    { label: "Under 200 ms", test: (n) => n < 200 },
                    { label: "200–500 ms", test: (n) => n < 500 },
                    { label: "500 ms – 1 s", test: (n) => n < 1000 },
                    { label: "1 – 1.5 s", test: (n) => n <= 1500 },
                    { label: "Over 1.5 s", test: () => true },
                  ])}
                />
                <Distribution
                  title="Click depth"
                  note="Clicks from the home page over internal links. Past 3 is the deep-page line."
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
                  title="Incoming internal links"
                  note="How many other pages link to each page. Zero is an orphan."
                  empty={hasStats ? undefined : notOnFile}
                  rows={bucketBy(html, (p) => p.inLinks, [
                    { label: "0 (orphan)", test: (n) => n === 0 },
                    { label: "1", test: (n) => n === 1 },
                    { label: "2 – 5", test: (n) => n <= 5 },
                    { label: "6 – 20", test: (n) => n <= 20 },
                    { label: "21+", test: () => true },
                  ])}
                />
                <Distribution
                  title="Title length"
                  note="Characters in <title>. Under 30 is short, over 65 is cut off in search results."
                  empty={hasStats ? undefined : notOnFile}
                  rows={bucketBy(html, (p) => p.titleChars, [
                    { label: "Missing", test: (n) => n === 0 },
                    { label: "1 – 29 (short)", test: (n) => n < 30 },
                    { label: "30 – 65", test: (n) => n <= 65 },
                    { label: "66+ (long)", test: () => true },
                  ])}
                />
                <Distribution
                  title="Description length"
                  note="Characters in the meta description. Google shows roughly the first 160."
                  empty={hasStats ? undefined : notOnFile}
                  rows={bucketBy(html, (p) => p.descriptionChars, [
                    { label: "Missing", test: (n) => n === 0 },
                    { label: "1 – 69", test: (n) => n < 70 },
                    { label: "70 – 160", test: (n) => n <= 160 },
                    { label: "161+", test: () => true },
                  ])}
                />
                <Distribution
                  title="Word count"
                  note="Visible words per page, site furniture removed. Under 150 is thin; over 4,000 is too long for AI answers."
                  empty={hasStats ? undefined : notOnFile}
                  rows={bucketBy(html, (p) => p.words, [
                    { label: "Under 150 (thin)", test: (n) => n < 150 },
                    { label: "150 – 500", test: (n) => n < 500 },
                    { label: "500 – 1,500", test: (n) => n < 1500 },
                    { label: "1,500 – 4,000", test: (n) => n <= 4000 },
                    { label: "Over 4,000", test: () => true },
                  ])}
                />
                <Distribution
                  title="Issues by category"
                  note="Distinct checks that fired in each category — the same rows the Issues tab lists."
                  rows={issueCategories.map((c) => ({ label: c, count: allIssues.filter((i) => (i.category ?? "Other") === c).length }))}
                  unit="checks"
                />
              </div>
            )}
          </>
        );
      })()}

      {/* ══════════════════════════════════════════ COMPARE CRAWLS ════════════════════════ */}
      {tab === "compare" && (() => {
        const older = history.filter((h) => h.id !== r.id);
        if (!older.length) {
          return (
            <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
              <div className="text-2xl">🔁</div>
              <b className="lx-12">Nothing to compare yet</b>
              <p className="lx-11 lx-mut" style={{ maxWidth: 460 }}>A comparison needs two runs. The next audit — yours or the weekly one — will show what got fixed and what is new.</p>
            </div>
          );
        }
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
            <div className="lx-card2 flex flex-wrap items-center gap-3 px-4 py-3 lx-audit-noprint">
              <b className="lx-12">Compare this run with</b>
              <select
                className="lx-11 rounded-md px-2 py-1"
                style={{ background: "transparent", border: "1px solid var(--lx-border)", color: "var(--lx-text)" }}
                value={compareId ?? ""}
                onChange={(e) => setCompareId(e.target.value || null)}
              >
                {[...older].reverse().map((h) => (
                  <option key={h.id} value={h.id}>
                    {new Date(h.createdAt).toLocaleString()} · score {h.score}{h.trigger ? ` · ${TRIGGER_LABEL[h.trigger]}` : ""}
                  </option>
                ))}
              </select>
              <span className="lx-10 lx-mut">This run: {new Date(r.createdAt).toLocaleString()}</span>
            </div>
            {compareError && <div className="lx-card2 p-4"><p className="lx-11" style={{ color: "#f87171" }}>{compareError}</p></div>}
            {!a && !compareError && <div className="lx-card2 p-4"><p className="lx-11 lx-mut">Loading that run…</p></div>}
            {a && (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatTile label="Site Health" value={`${a.score} → ${r.score}`} sub={delta(r.score, a.score)} />
                  <StatTile label="Errors" value={`${a.blocks} → ${r.blocks}`} sub={delta(r.blocks, a.blocks)} color="#f87171" />
                  <StatTile label="Warnings" value={`${a.warns} → ${r.warns}`} sub={delta(r.warns, a.warns)} color="#fbbf24" />
                  <StatTile label="Pages crawled" value={`${a.pagesChecked} → ${r.pagesChecked}`} sub={delta(r.pagesChecked, a.pagesChecked)} />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="lx-card2 p-4">
                    <b className="lx-12" style={{ color: "#34d399" }}>Fixed since then</b>
                    <span className="lx-11 lx-mut ml-2">({fixed.length})</span>
                    <div className="mt-3 grid grid-cols-1 gap-2">
                      {fixed.length ? fixed.map((i) => <CompareRow key={i.id} severity={i.severity} what={i.what} category={i.category ?? undefined} note={`was ${i.count} ${i.count === 1 ? "page" : "pages"}`} />) : <p className="lx-11 lx-mut">Nothing from that run has gone away.</p>}
                    </div>
                  </div>
                  <div className="lx-card2 p-4">
                    <b className="lx-12" style={{ color: "#f87171" }}>New since then</b>
                    <span className="lx-11 lx-mut ml-2">({fresh.length})</span>
                    <div className="mt-3 grid grid-cols-1 gap-2">
                      {fresh.length ? fresh.map((i) => <IssueRow key={i.id} issue={i} onPages={() => setPagesModal(i)} onFix={() => setFixModal(i)} />) : <p className="lx-11 lx-mut">No new kinds of issue.</p>}
                    </div>
                  </div>
                </div>
                <div className="lx-card2 p-4">
                  <b className="lx-12">Still open</b>
                  <span className="lx-11 lx-mut ml-2">({still.length}) — page counts then → now</span>
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    {still.length ? (
                      still.map((i) => {
                        const then = olderById.get(i.id)!.count;
                        return <CompareRow key={i.id} severity={i.severity} what={i.what} category={i.category} note={`${then} → ${i.count} ${i.count === 1 ? "page" : "pages"}${then === i.count ? "" : ` (${delta(i.count, then)})`}`} onClick={i.pages?.length ? () => setPagesModal(i) : undefined} />;
                      })
                    ) : (
                      <p className="lx-11 lx-mut">Nothing carried over.</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        );
      })()}

      {/* ══════════════════════════════════════════ PROGRESS ══════════════════════════════ */}
      {tab === "progress" && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lx-card2 p-4">
              <b className="lx-12">Site Health over time</b>
              <b className="mt-1 block font-extrabold leading-none" style={{ fontSize: 34, color: "var(--lx-violet)" }}>{r.score}</b>
              {history.length > 1 ? <AreaTrend points={history.map((h) => h.score)} color="#8b5cf6" /> : <p className="lx-10 lx-mut mt-2">One run so far — a trend needs two.</p>}
            </div>
            <SeverityCard label="Errors" sub="over time" count={r.blocks} color="#f87171" points={history.map((h) => h.blocks)} />
            <SeverityCard label="Warnings" sub="over time" count={r.warns} color="#fbbf24" points={history.map((h) => h.warns)} />
          </div>
          <div className="lx-card2 p-4">
            <b className="lx-12">Every run</b>
            <HistoryTable rows={history} />
          </div>
        </>
      )}

      {pagesModal && <PagesModal issue={pagesModal} pages={pages} onClose={() => setPagesModal(null)} />}
      {fixModal && <FixModal issue={fixModal} onClose={() => setFixModal(null)} onPages={() => { setPagesModal(fixModal); setFixModal(null); }} />}
      {historyModal && <HistoryModal rows={history} onClose={() => setHistoryModal(false)} />}
    </div>
  );
}

/** One issue, Semrush's own row: severity edge, the issue + its real page-count as one
 *  clickable line, a separate "How to fix" link on the right. Shared by the Overview's top-5
 *  and the Issues tab so the two can never drift. */
function IssueRow({ issue: i, onPages, onFix }: { issue: Issue; onPages: () => void; onFix: () => void }) {
  return (
    <div className="rounded-lg py-2.5 pl-3 pr-3" style={{ borderLeft: `3px solid ${SEV_COLOR[i.severity]}`, background: "rgba(255,255,255,.02)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="lx-10 shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 font-semibold" style={{ color: SEV_COLOR[i.severity], border: `1px solid ${SEV_COLOR[i.severity]}` }}>
          {SEV_LABEL[i.severity]}
        </span>
        <button className="lx-11 min-w-0 flex-1 text-left" style={{ background: "transparent", border: "none", cursor: i.pages?.length ? "pointer" : "default", color: "#e6e6f2" }} onClick={() => i.pages?.length && onPages()}>
          <b>{i.what}</b>
          {i.pages?.length > 0 && (
            <span className="ml-1.5 underline lx-audit-noprint" style={{ color: "var(--lx-cyan)" }}>
              {i.count > i.pages.length ? `${i.pages.length} of ` : ""}{i.count} {i.count === 1 ? "page" : "pages"}
            </span>
          )}
        </button>
        {i.category && <span className="lx-10 lx-mut shrink-0">{i.category}</span>}
        <button className="lx-10 shrink-0 underline lx-audit-noprint" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--lx-violet)" }} onClick={onFix}>
          How to fix
        </button>
      </div>
      {/* Printed report shows the fix and the pages inline — a PDF has no click. */}
      <p className="lx-audit-print-only lx-11 mt-1.5" style={{ display: "none" }}>{i.fix}</p>
      {i.pages?.length > 0 && (
        <ul className="lx-audit-print-only mt-2 space-y-1" style={{ display: "none" }}>
          {i.pages.map((p) => <li key={p} className="lx-11" style={{ wordBreak: "break-all" }}>{p}</li>)}
          {i.count > i.pages.length && <li className="lx-10 lx-mut">…and {i.count - i.pages.length} more</li>}
        </ul>
      )}
    </div>
  );
}

function Modal({ label, onClose, children, maxWidth = 640 }: { label: string; onClose: () => void; children: React.ReactNode; maxWidth?: number }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.6)" }} onClick={onClose} role="dialog" aria-modal="true" aria-label={label}>
      <div className="lx-card2 flex w-full flex-col p-5" style={{ maxWidth, maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** "How to fix" — Semrush's own popup. Real content only: this app's own `fix` sentence for
 *  the check, its severity and category, and a way through to the affected pages. No invented
 *  "About the issue" paragraph — the check never produced one. */
function FixModal({ issue: i, onClose, onPages }: { issue: Issue; onClose: () => void; onPages: () => void }) {
  return (
    <Modal label={`How to fix: ${i.what}`} onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="lx-10 rounded-full px-2 py-0.5 font-semibold" style={{ color: SEV_COLOR[i.severity], border: `1px solid ${SEV_COLOR[i.severity]}` }}>{SEV_LABEL[i.severity]}</span>
            {i.category && <span className="lx-10 lx-mut">{i.category}</span>}
          </div>
          <b className="lx-13 mt-2 block">{i.what}</b>
        </div>
        <button className="lx-icobtn shrink-0" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="mt-4 rounded-lg p-4" style={{ background: "rgba(139,92,246,.08)", border: "1px solid rgba(139,92,246,.25)" }}>
        <b className="lx-11 block" style={{ color: "var(--lx-violet)" }}>How to fix</b>
        <p className="lx-11 mt-1.5" style={{ lineHeight: 1.6 }}>{i.fix}</p>
      </div>
      {i.pages?.length > 0 && (
        <button className="lx-ghost lx-11 mt-4 self-start" onClick={onPages}>
          See the {i.count} affected page{i.count === 1 ? "" : "s"} →
        </button>
      )}
    </Modal>
  );
}

function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  return (
    <div className="lx-scroll mt-3" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
        <thead>
          <tr className="lx-10 lx-mut" style={{ textAlign: "left" }}>
            <th style={{ padding: "6px 8px", fontWeight: 600 }}>Date</th>
            <th style={{ padding: "6px 8px", fontWeight: 600 }}>Triggered</th>
            <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Score</th>
            <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Errors</th>
            <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Warnings</th>
            <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Pages</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((h) => (
            <tr key={h.id} style={{ borderTop: "1px solid var(--lx-border)" }}>
              <td className="lx-11" style={{ padding: "8px", color: "#e6e6f2", whiteSpace: "nowrap" }}>{new Date(h.createdAt).toLocaleString()}</td>
              <td className="lx-11 lx-mut" style={{ padding: "8px" }}>{h.trigger ? TRIGGER_LABEL[h.trigger] : "—"}</td>
              <td className="lx-11" style={{ padding: "8px", color: TONE_COLOR[tone(h.score)], fontWeight: 700 }}>{h.score}</td>
              <td className="lx-11 lx-mut" style={{ padding: "8px" }}>{h.blocks}</td>
              <td className="lx-11 lx-mut" style={{ padding: "8px" }}>{h.warns}</td>
              <td className="lx-11 lx-mut" style={{ padding: "8px" }}>{h.pagesChecked}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryModal({ rows, onClose }: { rows: HistoryRow[]; onClose: () => void }) {
  return (
    <Modal label="Audit history" onClose={onClose} maxWidth={780}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <b className="lx-13">Audit history</b>
          <p className="lx-11 lx-mut mt-1">{rows.length} run{rows.length === 1 ? "" : "s"} — manual and scheduled, newest first.</p>
        </div>
        <button className="lx-icobtn shrink-0" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="lx-scroll flex-1" style={{ overflowY: "auto" }}>
        <HistoryTable rows={rows} />
      </div>
    </Modal>
  );
}

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
      <div className="flex gap-5 border-b pb-3" style={{ borderColor: "var(--lx-border)" }}>
        {TABS.map((t) => <div key={t.id}>{block(t.label.length * 7 + 8, 12)}</div>)}
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

/** The full page list for one issue (or "all crawled pages") — Semrush's own "see more" popup:
 *  a full-page modal, one page, every real URL this audit actually has on file for it (up to
 *  the 100 checks.ts now samples per issue — see its own PAGE_SAMPLE comment). */
function PagesModal({ issue, pages, onClose }: { issue: Issue; pages: CrawledPage[]; onClose: () => void }) {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  return (
    <Modal label={issue.what} onClose={onClose} maxWidth={780}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <b className="lx-13">{issue.what}</b>
          <p className="lx-11 lx-mut mt-1">{issue.count} page{issue.count === 1 ? "" : "s"}{issue.fix ? ` · ${issue.fix}` : ""}</p>
        </div>
        <button className="lx-icobtn shrink-0" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="lx-scroll mt-3 flex-1" style={{ overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr className="lx-10 lx-mut" style={{ textAlign: "left", position: "sticky", top: 0, background: "var(--lx-panel)" }}>
              <th style={{ padding: "6px 4px", fontWeight: 600 }}>URL</th>
              <th style={{ padding: "6px 4px", fontWeight: 600, whiteSpace: "nowrap" }}>Status</th>
              <th style={{ padding: "6px 4px", fontWeight: 600, whiteSpace: "nowrap" }}>Redirects to</th>
            </tr>
          </thead>
          <tbody>
            {issue.pages.map((url) => {
              const p = byUrl.get(url);
              return (
                <tr key={url} style={{ borderTop: "1px solid var(--lx-border)" }}>
                  <td className="lx-11" style={{ padding: "8px 4px", wordBreak: "break-all" }}>
                    <a href={url} target="_blank" rel="noreferrer noopener" className="underline" style={{ color: "var(--lx-cyan)" }}>{url}</a>
                  </td>
                  <td className="lx-11 lx-mut" style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>{p?.status ?? "—"}</td>
                  <td className="lx-10 lx-mut" style={{ padding: "8px 4px", wordBreak: "break-all" }}>{p?.redirectedTo ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {issue.count > issue.pages.length && <p className="lx-10 lx-mut mt-2 px-1">…and {issue.count - issue.pages.length} more not listed individually.</p>}
      </div>
    </Modal>
  );
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

/** Thematic Reports' small ring — same brand violet as the Site Health gauge. */
function MiniRing({ pct }: { pct: number }) {
  const rad = 12;
  const c = 2 * Math.PI * rad;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <svg width={30} height={30} viewBox="0 0 30 30" aria-hidden>
      <circle cx={15} cy={15} r={rad} fill="none" stroke="var(--lx-border)" strokeWidth={4} />
      <circle cx={15} cy={15} r={rad} fill="none" stroke="var(--lx-violet)" strokeWidth={4} strokeLinecap="round" strokeDasharray={`${filled} ${c}`} transform="rotate(-90 15 15)" />
    </svg>
  );
}

/** AI Search Health — real robots.txt evaluation, as a ring: N of M named crawlers allowed.
 *  Green when every bot is let in, amber otherwise — genuinely measured, never a Semrush-style
 *  "traffic score" this app has no log to compute. */
function AiHealthGauge({ allowed, total }: { allowed: number; total: number }) {
  const rad = 34;
  const c = 2 * Math.PI * rad;
  const pct = total > 0 ? Math.round((allowed / total) * 100) : 0;
  const filled = (pct / 100) * c;
  const color = allowed === total ? "#34d399" : "#fb923c";
  return (
    <div className="relative shrink-0" style={{ width: 92, height: 92 }} aria-label={`${allowed} of ${total} AI crawlers allowed`}>
      <svg width={92} height={92} viewBox="0 0 92 92">
        <circle cx={46} cy={46} r={rad} fill="none" stroke="var(--lx-border)" strokeWidth={8} />
        <circle cx={46} cy={46} r={rad} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${filled} ${c}`} transform="rotate(-90 46 46)" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <b className="font-extrabold leading-none" style={{ fontSize: 20, color }}>{pct}%</b>
        <span className="lx-10 lx-mut" style={{ fontSize: 9 }}>{allowed}/{total} allowed</span>
      </div>
    </div>
  );
}

function CrawledRow({ color, label, count, onClick }: { color: string; label: string; count: number; onClick?: () => void }) {
  return (
    <li>
      <button className="flex w-full items-center gap-2 lx-11 text-left" style={{ background: "transparent", border: "none", cursor: onClick ? "pointer" : "default", color: "inherit", padding: 0 }} onClick={onClick}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="flex-1">{label}</span>
        <b style={{ color: "var(--lx-violet)" }}>{count}</b>
      </button>
    </li>
  );
}

/** Errors/Warnings card — the big number plus a real trend line under it, Semrush's own layout
 *  for these two. `points` is that severity's count on every past run, oldest first; a single
 *  point (first-ever audit) draws no line — "nothing to compare it to yet". */
function SeverityCard({ label, sub, count, color, points }: { label: string; sub: string; count: number; color: string; points: number[] }) {
  return (
    <div className="lx-card2 p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <b className="lx-12">{label}</b>
      </div>
      <b className="mt-1 block font-extrabold leading-none" style={{ fontSize: 34, color }}>{count}</b>
      <span className="lx-10 lx-mut">{sub}</span>
      {points.length > 1 && <AreaTrend points={points} color={color} />}
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

/** One number, named — the Statistics / Compare tabs' headline row. Text stays in text tokens;
 *  `color` is only ever a status colour the rest of this file already uses. */
function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--lx-border)" }}>
      <span className="lx-10 lx-mut">{label}</span>
      <b className="mt-1 block font-extrabold leading-none" style={{ fontSize: 20, color: color ?? "var(--lx-violet)" }}>{value}</b>
      {sub && <span className="lx-10 lx-mut">{sub}</span>}
    </div>
  );
}

/** A distribution as a bar list — one brand hue for one series (a status colour per row only
 *  where the row IS a status, e.g. 4xx), a thin bar scaled to the largest bucket, the count and
 *  its share as text beside it, the full label on hover. Rows are the table view. */
function Distribution({ title, note, rows, empty, unit = "pages" }: { title: string; note?: string; rows: { label: string; count: number; color?: string }[]; empty?: string; unit?: string }) {
  const total = rows.reduce((a, b) => a + b.count, 0);
  const max = Math.max(1, ...rows.map((x) => x.count));
  return (
    <div className="lx-card2 p-4">
      <b className="lx-12">{title}</b>
      {note && <p className="lx-10 lx-mut mt-1">{note}</p>}
      {empty ? (
        <p className="lx-11 lx-mut mt-3">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rows.map((x) => (
            <li key={x.label} className="flex items-center gap-2 lx-11" title={`${x.label}: ${x.count} of ${total} ${unit}`}>
              <span className="shrink-0 truncate" style={{ width: 128 }}>{x.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--lx-border)" }}>
                <div style={{ width: `${(x.count / max) * 100}%`, height: "100%", borderRadius: 4, background: x.color ?? "var(--lx-violet)" }} />
              </div>
              <b className="shrink-0 text-right" style={{ width: 36 }}>{x.count}</b>
              <span className="lx-10 lx-mut shrink-0 text-right" style={{ width: 36 }}>{total ? Math.round((x.count / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Compare Crawls row for an issue that has no page list to open (the older run's, or one
 *  shown for its count change) — severity pill, the sentence, the count note. */
function CompareRow({ severity, what, category, note, onClick }: { severity: Severity; what: string; category?: string; note: string; onClick?: () => void }) {
  return (
    <div className="rounded-lg py-2.5 pl-3 pr-3" style={{ borderLeft: `3px solid ${SEV_COLOR[severity]}`, background: "rgba(255,255,255,.02)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="lx-10 shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 font-semibold" style={{ color: SEV_COLOR[severity], border: `1px solid ${SEV_COLOR[severity]}` }}>{SEV_LABEL[severity]}</span>
        <button className="lx-11 min-w-0 flex-1 text-left" style={{ background: "transparent", border: "none", cursor: onClick ? "pointer" : "default", color: "#e6e6f2" }} onClick={onClick}>
          <b>{what}</b>
          <span className="ml-1.5 lx-mut">{note}</span>
        </button>
        {category && <span className="lx-10 lx-mut shrink-0">{category}</span>}
      </div>
    </div>
  );
}

/** `good` null = no number was measured — shown as exactly that, never as "Needs work". */
function VitalTile({ label, value, good, hint }: { label: string; value: string; good: boolean | null; hint?: string }) {
  const color = good === null ? "var(--lx-mut)" : good ? "#34d399" : "#fbbf24";
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--lx-border)" }}>
      <span className="lx-10 lx-mut">{label}</span>
      <div className="mt-1 flex items-baseline gap-1.5">
        <b className="font-extrabold" style={{ fontSize: 22, color }}>{value}</b>
        <span className="lx-10" style={{ color }}>{good === null ? "Not measured" : good ? "Good" : "Needs work"}</span>
      </div>
      {hint && <span className="lx-10 lx-mut">{hint}</span>}
    </div>
  );
}
