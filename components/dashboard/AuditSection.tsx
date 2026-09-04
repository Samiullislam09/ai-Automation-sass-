"use client";
import Link from "next/link";
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
type CrawledPage = { url: string; status: number | null; redirectedTo: string | null; ms: number | null; error: string | null; hasIssue?: boolean; blocked?: boolean };
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

type Tab = "overview" | "issues" | "pages" | "progress";
type Bucket = "Healthy" | "Broken" | "Have issues" | "Redirects" | "Blocked";

const RANK: Record<Severity, number> = { block: 0, warn: 1, info: 2 };
const ISSUES_COLLAPSED_COUNT = 5;
const POLL_MS = 6000;
const POLL_TIMEOUT_MS = 8 * 60_000; // ~8 min — real audits (200 pages + 10 Lighthouse runs) can genuinely take this long

function tone(score: number): "good" | "ok" | "bad" {
  return score >= 85 ? "good" : score >= 60 ? "ok" : "bad";
}
const TONE_COLOR: Record<string, string> = { good: "#34d399", ok: "#fbbf24", bad: "#f87171" };
const SEV_LABEL: Record<Severity, string> = { block: "Error", warn: "Warning", info: "Notice" };
const SEV_COLOR: Record<Severity, string> = { block: "#f87171", warn: "#fbbf24", info: "var(--lx-mut)" };
const TRIGGER_LABEL: Record<NonNullable<Trigger>, string> = { manual: "Manual", schedule: "Scheduled" };
const BUCKET_COLOR: Record<Bucket, string> = { Healthy: "#34d399", Broken: "#f87171", "Have issues": "#fb923c", Redirects: "#818cf8", Blocked: "var(--lx-mut)" };
const BUCKET_ORDER: Bucket[] = ["Healthy", "Broken", "Have issues", "Redirects", "Blocked"];
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "issues", label: "Issues" },
  { id: "pages", label: "Crawled Pages" },
  { id: "progress", label: "Progress" },
];

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
  const [polling, setPolling] = useState<{ sinceId: string | null; startedAt: number } | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [pagesModal, setPagesModal] = useState<Issue | null>(null);
  const [fixModal, setFixModal] = useState<Issue | null>(null);
  const [historyModal, setHistoryModal] = useState(false);
  const [sevFilter, setSevFilter] = useState<"all" | Severity>("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [bucketFilter, setBucketFilter] = useState<"all" | Bucket>("all");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    load();
  }, [load]);

  // Real progress, not a fire-and-forget toast — polls the same read endpoint until a NEW
  // report id appears (or times out), so "audit progress" is an honest "still going" / "here's
  // your result" rather than a spinner nobody can check on without leaving the page.
  useEffect(() => {
    if (!polling) return;
    pollTimer.current = setInterval(async () => {
      const d = await load();
      const latestId = d?.latest?.id ?? null;
      if (latestId && latestId !== polling.sinceId) {
        setPolling(null);
        toast("Audit finished.");
        return;
      }
      if (Date.now() - polling.startedAt > POLL_TIMEOUT_MS) {
        setPolling(null);
        toast("This is taking longer than usual — check Workspace to see if it hit an error.", "error");
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
        setPolling({ sinceId: state?.latest?.id ?? null, startedAt: Date.now() });
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
        {starting ? "Starting…" : polling ? "Auditing…" : "Check my site now"}
      </button>
      <Link href="/dashboard/workspace" className="lx-ghost">Watch it work →</Link>
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

  const progressBanner = polling && (
    <div className="lx-card2 lx-audit-noprint flex items-center gap-3 p-3" style={{ borderColor: "var(--lx-cyan)" }}>
      <span className="lx-pulse h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--lx-cyan)" }} />
      <span className="lx-11 flex-1">Auditing your site now — checking pages, then measuring loading speed. This usually takes a few minutes.</span>
      <ElapsedLabel startedAt={polling.startedAt} />
    </div>
  );

  if (loading && !state) {
    return <div className="space-y-4">{head}<div className="lx-card2 p-6"><p className="lx-11 lx-mut">Loading…</p></div></div>;
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
  const measured = vitals.filter((p) => p.ok);
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="lx-card2 p-4">
              <b className="lx-12">Site Health</b>
              <div className="mt-3 flex flex-wrap items-center gap-6">
                <ScoreGauge score={r.score} />
                <div className="min-w-40 flex-1">
                  <p className="lx-11">
                    {diff === null
                      ? "First audit — nothing to compare it to yet."
                      : diff === 0
                        ? `No change since the last audit (${r.previousScore}).`
                        : diff > 0
                          ? `Up ${diff} since the last audit (was ${r.previousScore}).`
                          : `Down ${Math.abs(diff)} since the last audit (was ${r.previousScore}).`}
                  </p>
                  <ul className="mt-2 space-y-1">
                    <li className="flex items-center gap-2 lx-11">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--lx-violet)" }} />
                      <span className="flex-1">Your site</span>
                      <b>{r.score}%</b>
                    </li>
                  </ul>
                </div>
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

          {/* LAST RUN — one line, not the whole table (owner, 2026-09-05: "user sirf last audit
              dekh sake, click karke popup pe all"). The full history is one click away. */}
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
              <p className="lx-10 lx-mut mt-1">Real Chrome (Lighthouse), mobile, {measured.length} of {vitals.length} sampled page{vitals.length === 1 ? "" : "s"} measured.</p>
              {measured.length === 0 ? (
                <p className="lx-11 lx-mut mt-3">Could not measure this run — see the individual page errors below.</p>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <VitalTile label="Largest Contentful Paint" value={avgLcp != null ? `${(avgLcp / 1000).toFixed(1)}s` : "—"} good={avgLcp != null && avgLcp <= 2500} />
                  <VitalTile label="Cumulative Layout Shift" value={avgCls != null ? avgCls.toFixed(2) : "—"} good={avgCls != null && avgCls <= 0.1} />
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
                        {p.ok ? (
                          <>
                            <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.lcpMs != null ? `${(p.lcpMs / 1000).toFixed(1)}s` : "—"}</td>
                            <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.cls != null ? p.cls.toFixed(2) : "—"}</td>
                            <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.performanceScore != null ? `${p.performanceScore}/100` : "—"}</td>
                          </>
                        ) : (
                          <td className="lx-10" style={{ padding: "8px", color: "#f87171" }} colSpan={3}>Not measured{p.error ? ` — ${p.error}` : ""}</td>
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

function VitalTile({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--lx-border)" }}>
      <span className="lx-10 lx-mut">{label}</span>
      <div className="mt-1 flex items-baseline gap-1.5">
        <b className="font-extrabold" style={{ fontSize: 22, color: good ? "#34d399" : "#fbbf24" }}>{value}</b>
        <span className="lx-10" style={{ color: good ? "#34d399" : "#fbbf24" }}>{good ? "Good" : "Needs work"}</span>
      </div>
    </div>
  );
}
