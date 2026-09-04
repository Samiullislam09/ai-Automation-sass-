"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

/** /dashboard/audit ("Audit") — same real logic and API calls as the old app/app/audit/page.tsx
 *  (kept verbatim: /api/site-audit, /api/agents/trigger for a manual run, and the two rules
 *  noted there — never show a number nobody measured, never auto-fix anything). Restyled to
 *  the new dashboard theme per the owner's standing instruction (2026-08-29).
 *
 *  Rebuilt 2026-09-05 against a Semrush Site Audit "Overview" screenshot the owner sent, own
 *  words: "100% same UI... but sirf brand hamara". Matched where we have a REAL source for the
 *  number; deliberately NOT built where Semrush's own card has none here:
 *   - "AI Search Health" / "Blocked from AI Search" (ChatGPT-User, Googlebot, etc. hit counts) —
 *     that is Semrush's own bot-traffic product, this app has no such log to read from. Building
 *     that card would mean showing invented numbers, the one thing this whole product refuses to
 *     do (see lib/seoChecks.ts's own header).
 *   - "Top-10% websites: 92%" industry benchmark on the Site Health gauge — no benchmark dataset
 *     exists here either; the gauge shows only "Your site", never a comparison nobody measured.
 *  Everything else — Site Health gauge, Crawled Pages breakdown, Errors/Warnings cards with a
 *  real trend line, the top-issues list with "How to fix" and "View all issues", a full-page
 *  "see more" popup, and an Export-as-PDF button — is built from data this file's own API
 *  already returns or was extended to return (this session): `run.pages` (per-page crawl
 *  status/redirect, agents/audit.ts), `run.trigger` (manual vs the weekly scheduler), and the
 *  history array's blocks/warns/pagesChecked (was score-only before). */

type Issue = { id: string; severity: "block" | "warn" | "info"; what: string; fix: string; pages: string[]; count: number };
type PageVitals = { url: string; ok: boolean; error?: string; performanceScore: number | null; lcpMs: number | null; cls: number | null; tbtMs: number | null };
type CrawledPage = { url: string; status: number | null; redirectedTo: string | null; ms: number | null; error: string | null };
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
  trigger: Trigger;
  seconds: number | null;
  summary: string | null;
  createdAt: string;
};

type HistoryRow = { id: string; score: number; blocks: number; warns: number; pagesChecked: number; trigger: Trigger; createdAt: string };
type Payload = { ok: boolean; schemaReady: boolean; latest: Report | null; history: HistoryRow[] };

const RANK = { block: 0, warn: 1, info: 2 } as const;
const ISSUES_COLLAPSED_COUNT = 5;
const POLL_MS = 6000;
const POLL_TIMEOUT_MS = 8 * 60_000; // ~8 min — real audits (200 pages + 10 Lighthouse runs) can genuinely take this long

function tone(score: number): "good" | "ok" | "bad" {
  return score >= 85 ? "good" : score >= 60 ? "ok" : "bad";
}
const TONE_COLOR: Record<string, string> = { good: "#34d399", ok: "#fbbf24", bad: "#f87171" };
const SEV_LABEL: Record<Issue["severity"], string> = { block: "Fix first", warn: "Improve", info: "Note" };
const SEV_COLOR: Record<Issue["severity"], string> = { block: "#f87171", warn: "#fbbf24", info: "var(--lx-mut)" };
const TRIGGER_LABEL: Record<NonNullable<Trigger>, string> = { manual: "Manual", schedule: "Scheduled" };

/** Mean of whatever pages actually measured — never padded with a guess for the ones that
 *  didn't (a page with ok:false contributes nothing, not a zero). */
function avg(nums: (number | null)[]): number | null {
  const real = nums.filter((n): n is number => typeof n === "number");
  if (!real.length) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

export default function AuditSection() {
  const { toast } = useStore();
  const [state, setState] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [polling, setPolling] = useState<{ sinceId: string | null; startedAt: number } | null>(null);
  const [pagesModal, setPagesModal] = useState<Issue | null>(null);
  const [issuesExpanded, setIssuesExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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

  const head = (
    <div className="flex flex-wrap items-start justify-between gap-4 lx-audit-noprint">
      <div>
        <h1 className="text-lg font-bold">Site audit</h1>
        <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 560 }}>
          What&apos;s broken, hidden from Google, or costing you traffic — across the whole site, not one page at a time. Runs itself every week.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="lx-ghost" disabled={starting || !!polling} onClick={runAudit}>
          {starting ? "Starting…" : polling ? "Auditing…" : "Check my site now"}
        </button>
        <Link href="/dashboard/workspace" className="lx-ghost">Watch it work →</Link>
      </div>
    </div>
  );

  const progressBanner = polling && (
    <div className="lx-card2 lx-audit-noprint flex items-center gap-3 p-3" style={{ borderColor: "var(--lx-cyan)" }}>
      <span className="lx-pulse h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--lx-cyan)" }} />
      <span className="lx-11 flex-1">
        Auditing your site now — checking pages, then measuring loading speed. This usually takes a few minutes.
      </span>
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
          <p className="lx-11 lx-mut" style={{ maxWidth: 460 }}>
            Run one now, or leave it — we check every week on our own and tell you when something changes.
          </p>
          {!polling && (
            <button className="lx-grad lx-11 mt-2 px-3.5 py-2" disabled={starting} onClick={runAudit}>
              {starting ? "Starting…" : "Check my site now"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const diff = r.previousScore === null ? null : r.score - r.previousScore;
  const allIssues = [...r.issues].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);
  const issues = issuesExpanded ? allIssues : allIssues.slice(0, ISSUES_COLLAPSED_COUNT);
  const notices = r.issues.filter((i) => i.severity === "info").length;
  const scoreTone = tone(r.score);

  const vitals = r.performance ?? [];
  const measured = vitals.filter((p) => p.ok);
  const avgLcp = avg(measured.map((p) => p.lcpMs));
  const avgCls = avg(measured.map((p) => p.cls));

  // Crawled Pages breakdown — Semrush's own "Healthy/Broken/Have issues/Redirects/Blocked"
  // list, trimmed to the three this app can compute EXACTLY from the real per-page crawl
  // (status + redirect target), rather than approximate a 4th/5th bucket from data that isn't
  // fully known here (see the file header). Every page in `r.pages` lands in exactly one.
  const pages = r.pages ?? [];
  const broken = pages.filter((p) => p.status == null || p.status >= 400);
  const redirected = pages.filter((p) => !broken.includes(p) && p.redirectedTo);
  const healthy = pages.filter((p) => !broken.includes(p) && !redirected.includes(p));

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

      {head}
      {progressBanner}

      {/* ROW 1 — Site Health gauge (left) + Crawled Pages breakdown (right), Semrush's own
          top-row layout. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="lx-card2 p-4">
          <div className="flex items-center justify-between lx-audit-noprint">
            <b className="lx-12">Site Health</b>
            <button
              className="lx-ghost lx-11"
              onClick={() => window.print()}
              title="Opens your browser's print dialog — choose 'Save as PDF' as the destination"
            >
              Export as PDF
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-6">
            <ScoreGauge score={r.score} scoreTone={scoreTone} />
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
              <p className="lx-10 lx-mut mt-1">
                {r.pagesChecked} pages checked · {new Date(r.createdAt).toLocaleString()}
                {r.seconds != null && ` · ${Math.round(r.seconds / 60) || 1} min`}
                {r.trigger && ` · ${TRIGGER_LABEL[r.trigger]}`}
              </p>
              {state!.history.length > 1 && <Trend points={state!.history} />}
            </div>
          </div>
        </div>

        <div className="lx-card2 p-4">
          <b className="lx-12">Crawled Pages</b>
          <p className="lx-10 lx-mut mt-1">{pages.length} pages, this audit</p>
          {pages.length > 0 && (
            <>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full" style={{ background: "var(--lx-border)" }}>
                {healthy.length > 0 && <div style={{ width: `${(healthy.length / pages.length) * 100}%`, background: "#34d399" }} />}
                {redirected.length > 0 && <div style={{ width: `${(redirected.length / pages.length) * 100}%`, background: "#38bdf8" }} />}
                {broken.length > 0 && <div style={{ width: `${(broken.length / pages.length) * 100}%`, background: "#f87171" }} />}
              </div>
              <ul className="mt-3 space-y-2">
                <CrawledRow color="#34d399" label="Healthy" count={healthy.length} />
                <CrawledRow color="#38bdf8" label="Redirects" count={redirected.length} />
                <CrawledRow color="#f87171" label="Broken" count={broken.length} />
              </ul>
              <button className="lx-11 mt-3 underline lx-audit-noprint" style={{ color: "var(--lx-cyan)" }} onClick={() => setPagesModal({ id: "__all_pages__", severity: "info", what: "All crawled pages", fix: "", pages: pages.map((p) => p.url), count: pages.length })}>
                See all {pages.length} pages
              </button>
            </>
          )}
        </div>
      </div>

      {/* ROW 2 — Errors / Warnings, each with a real trend line built from history, matching
          Semrush's own layout (a mini area chart under the big number). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SeverityCard label="Errors" sub="Fix first" count={r.blocks} color="#f87171" points={state!.history.map((h) => h.blocks)} />
        <SeverityCard label="Warnings" sub="Worth improving" count={r.warns} color="#fbbf24" points={state!.history.map((h) => h.warns)} />
      </div>

      {notices > 0 && (
        <div className="lx-card2 p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--lx-mut)" }} />
            <b className="lx-12">Notices</b>
            <span className="lx-11 lx-mut">{notices} for the record — not blocking, not urgent</span>
          </div>
        </div>
      )}

      {/* CORE WEB VITALS — real Lighthouse (agent-server/src/lib/audit/performance.ts). Shown
          only when at least one page actually measured; a run where every page failed says so
          honestly instead of rendering an empty table that looks like a bug. */}
      {vitals.length > 0 && (
        <div className="lx-card2 p-4">
          <b className="lx-12">Loading speed (Core Web Vitals)</b>
          <p className="lx-10 lx-mut mt-1">
            Real Chrome, mobile, {measured.length} of {vitals.length} sampled page{vitals.length === 1 ? "" : "s"} measured.
          </p>
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
                    <td className="lx-11" style={{ padding: "8px", color: "#e6e6f2", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.url}>
                      {p.url}
                    </td>
                    {p.ok ? (
                      <>
                        <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.lcpMs != null ? `${(p.lcpMs / 1000).toFixed(1)}s` : "—"}</td>
                        <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.cls != null ? p.cls.toFixed(2) : "—"}</td>
                        <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.performanceScore != null ? `${p.performanceScore}/100` : "—"}</td>
                      </>
                    ) : (
                      <td className="lx-10" style={{ padding: "8px", color: "#f87171" }} colSpan={3}>
                        Not measured{p.error ? ` — ${p.error}` : ""}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ISSUE LIST — collapsed to the top 5 (Semrush's own pattern), "View all issues" to see
          the rest; the per-issue page list opens the SAME full-page popup as "See all pages"
          above. */}
      <div className="lx-card2 p-4">
        <b className="lx-12">Issues</b>
        <div className="mt-3 grid grid-cols-1 gap-2.5">
          {issues.length ? (
            issues.map((i) => (
              <div key={i.id} className="rounded-lg p-3" style={{ border: "1px solid var(--lx-border)" }}>
                <div className="flex items-start gap-3">
                  <span
                    className="lx-10 shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 font-semibold"
                    style={{ color: SEV_COLOR[i.severity], border: `1px solid ${SEV_COLOR[i.severity]}` }}
                  >
                    {SEV_LABEL[i.severity]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="lx-12 block">{i.what}</b>
                    <p className="lx-11 lx-mut mt-1.5">{i.fix}</p>
                  </div>
                </div>
                {i.pages?.length > 0 && (
                  <button
                    className="lx-11 mt-2.5 underline lx-audit-noprint"
                    style={{ color: "var(--lx-cyan)" }}
                    onClick={() => setPagesModal(i)}
                  >
                    See {i.count > i.pages.length ? `${i.pages.length} of ` : ""}{i.count} {i.count === 1 ? "page" : "pages"} →
                  </button>
                )}
                {/* Printed report shows every affected page inline — a PDF has no click. */}
                {i.pages?.length > 0 && (
                  <ul className="lx-audit-print-only mt-2 space-y-1" style={{ display: "none" }}>
                    {i.pages.map((p) => (
                      <li key={p} className="lx-11" style={{ wordBreak: "break-all" }}>{p}</li>
                    ))}
                    {i.count > i.pages.length && <li className="lx-10 lx-mut">…and {i.count - i.pages.length} more</li>}
                  </ul>
                )}
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <div className="text-2xl">✨</div>
              <p className="lx-11 lx-mut">Nothing to fix — every check passed.</p>
            </div>
          )}
        </div>
        {allIssues.length > ISSUES_COLLAPSED_COUNT && (
          <button
            className="lx-ghost lx-11 mt-3 w-full lx-audit-noprint"
            onClick={() => setIssuesExpanded((v) => !v)}
          >
            {issuesExpanded ? "Show fewer" : `View all ${allIssues.length} issues →`}
          </button>
        )}
      </div>

      {r.skipped.length > 0 && (
        <div className="lx-card2 p-4">
          <b className="lx-12">What this audit did not measure</b>
          <ul className="mt-2 space-y-1 pl-4" style={{ listStyle: "disc" }}>
            {r.skipped.map((s, n) => (
              <li key={n} className="lx-10 lx-mut">{s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* HISTORY — every past run, manual vs the weekly scheduler, so "kab manual hua, kab
          schedule pe hua" has an actual answer instead of only ever showing the newest one. */}
      <div className="lx-card2 p-4 lx-audit-noprint">
        <button className="flex w-full items-center justify-between" style={{ background: "transparent", border: "none", cursor: "pointer" }} onClick={() => setHistoryOpen((v) => !v)}>
          <b className="lx-12">Audit history</b>
          <span className="lx-11" style={{ color: "var(--lx-cyan)" }}>{historyOpen ? "hide" : `show ${state!.history.length}`}</span>
        </button>
        {historyOpen && (
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
                {[...state!.history].reverse().map((h) => (
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
        )}
      </div>

      {pagesModal && <PagesModal issue={pagesModal} pages={pages} onClose={() => setPagesModal(null)} />}
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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,.6)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={issue.what}
    >
      <div
        className="lx-card2 flex w-full flex-col p-5"
        style={{ maxWidth: 780, maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
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
          {issue.count > issue.pages.length && (
            <p className="lx-10 lx-mut mt-2 px-1">…and {issue.count - issue.pages.length} more not listed individually.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The score, as a ring — the one visual a Semrush-style report leads with. Pure SVG, no
 *  charting dependency: one number between 0 and 100 is a single arc. */
function ScoreGauge({ score, scoreTone }: { score: number; scoreTone: "good" | "ok" | "bad" }) {
  const rad = 34;
  const c = 2 * Math.PI * rad;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: 92, height: 92 }} aria-label={`Site health score: ${score} out of 100`}>
      <svg width={92} height={92} viewBox="0 0 92 92">
        <circle cx={46} cy={46} r={rad} fill="none" stroke="var(--lx-border)" strokeWidth={8} />
        <circle
          cx={46}
          cy={46}
          r={rad}
          fill="none"
          stroke={TONE_COLOR[scoreTone]}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          transform="rotate(-90 46 46)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <b className="font-extrabold leading-none" style={{ fontSize: 26, color: TONE_COLOR[scoreTone] }}>{score}</b>
        <span className="lx-10 lx-mut" style={{ fontSize: 9 }}>/ 100</span>
      </div>
    </div>
  );
}

function CrawledRow({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <li className="flex items-center gap-2 lx-11">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="flex-1">{label}</span>
      <b>{count}</b>
    </li>
  );
}

/** Errors/Warnings card — the big number plus a real trend line under it, Semrush's own layout
 *  for these two. `points` is that severity's count on every past run, oldest first; a single
 *  point (first-ever audit) draws no line, matching the score Trend's own "nothing to compare
 *  it to yet" honesty. */
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

/** A filled line chart, pure SVG — the same "no charting dependency" call the score Trend bars
 *  already made, just for a continuous line instead of discrete bars (Semrush draws its Errors/
 *  Warnings history this way, not as bars). */
function AreaTrend({ points, color }: { points: number[]; color: string }) {
  const w = 240;
  const h = 44;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const coords = points.map((p, i) => [i * step, h - (p / max) * h] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg className="mt-2" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={area} fill={color} opacity={0.15} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} />
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

/** The score, as bars. Deliberately not a charting library: twenty numbers between 0 and 100
 *  are a row of divs, and a dependency for that would be the tail wagging the dog. */
function Trend({ points }: { points: { id: string; score: number; createdAt: string }[] }) {
  return (
    <div className="mt-3 flex items-end gap-1" style={{ height: 44 }} aria-label="Audit score over time">
      {points.map((p) => (
        <span
          key={p.id}
          className="w-2 rounded-t-sm"
          style={{ height: `${Math.max(4, p.score)}%`, background: TONE_COLOR[tone(p.score)] }}
          title={`${p.score}/100 · ${new Date(p.createdAt).toLocaleDateString()}`}
        />
      ))}
    </div>
  );
}
