"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";

/** /dashboard/audit ("Audit") — same real logic and API calls as the old app/app/audit/page.tsx
 *  (kept verbatim: /api/site-audit, /api/agents/trigger for a manual run, and the two rules
 *  noted there — never show a number nobody measured, never auto-fix anything). Restyled to
 *  the new dashboard theme per the owner's standing instruction (2026-08-29).
 *
 *  Redesigned 2026-09-04, owner's own words: "Semrush jaisa audit report... hamare brand ke
 *  saath" (a comprehensive report card, in this app's own theme, not a copy of Semrush's UI) —
 *  a score gauge, Errors/Warnings/Notices tiles (the same severities checks.ts already emits,
 *  just counted up front instead of only visible per-row), a real Core Web Vitals section (now
 *  that /api/site-audit actually forwards `run.performance` — it was already stored, just never
 *  read by this page), and an "Export as PDF" button. PDF export is the browser's own
 *  print-to-PDF (`window.print()` + a `@media print` rule scoped to this report), not a new
 *  dependency — every browser already does this correctly, and it never has to be told what a
 *  PDF library's API looks like this month. */

type Issue = { id: string; severity: "block" | "warn" | "info"; what: string; fix: string; pages: string[]; count: number };
type PageVitals = { url: string; ok: boolean; error?: string; performanceScore: number | null; lcpMs: number | null; cls: number | null; tbtMs: number | null };

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
  seconds: number | null;
  summary: string | null;
  createdAt: string;
};

type Payload = { ok: boolean; schemaReady: boolean; latest: Report | null; history: { id: string; score: number; createdAt: string }[] };

const RANK = { block: 0, warn: 1, info: 2 } as const;

function tone(score: number): "good" | "ok" | "bad" {
  return score >= 85 ? "good" : score >= 60 ? "ok" : "bad";
}
const TONE_COLOR: Record<string, string> = { good: "#34d399", ok: "#fbbf24", bad: "#f87171" };
const SEV_LABEL: Record<Issue["severity"], string> = { block: "Fix first", warn: "Improve", info: "Note" };
const SEV_COLOR: Record<Issue["severity"], string> = { block: "#f87171", warn: "#fbbf24", info: "var(--lx-mut)" };

const LCP_GOOD_MS = 2500;
const CLS_GOOD = 0.1;

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
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/site-audit")
      .then((r) => r.json())
      .then((d: Payload) => {
        if (d.ok) setState(d);
        else toast("Couldn't load your audit.", "error");
      })
      .catch(() => toast("Couldn't load your audit — try refreshing.", "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const runAudit = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/agents/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "audit" }),
      });
      const d = await res.json();
      if (d.ok) toast("Checking your whole site — this takes a few minutes. Watch it in the Workspace.");
      else toast(d.error || "Couldn't start the audit.", "error");
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
        <button className="lx-ghost" disabled={starting} onClick={runAudit}>{starting ? "Starting…" : "Check my site now"}</button>
        <Link href="/dashboard/workspace" className="lx-ghost">Watch it work →</Link>
      </div>
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
        <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
          <div className="text-2xl">🩺</div>
          <b className="lx-12">No audit yet</b>
          <p className="lx-11 lx-mut" style={{ maxWidth: 460 }}>
            Run one now, or leave it — we check every week on our own and tell you when something changes.
          </p>
          <button className="lx-grad lx-11 mt-2 px-3.5 py-2" disabled={starting} onClick={runAudit}>
            {starting ? "Starting…" : "Check my site now"}
          </button>
        </div>
      </div>
    );
  }

  const diff = r.previousScore === null ? null : r.score - r.previousScore;
  const issues = [...r.issues].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);
  const notices = r.issues.filter((i) => i.severity === "info").length;
  const scoreTone = tone(r.score);

  const vitals = r.performance ?? [];
  const measured = vitals.filter((p) => p.ok);
  const avgLcp = avg(measured.map((p) => p.lcpMs));
  const avgCls = avg(measured.map((p) => p.cls));

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
      `}</style>

      {head}

      {/* SCORE CARD — the gauge, the trend, and the three severity tiles a Semrush-style report
          leads with. Every number here is one already computed by agent-server (score, blocks,
          warns) or counted from the real issues array (notices) — nothing new is invented for
          this layout. */}
      <div className="lx-card2 p-4">
        <div className="flex flex-wrap items-center gap-6">
          <ScoreGauge score={r.score} scoreTone={scoreTone} />
          <div className="min-w-56 flex-1">
            <p className="lx-12">
              {diff === null
                ? "First audit — there's nothing to compare it to yet."
                : diff === 0
                  ? `No change since the last audit (${r.previousScore}).`
                  : diff > 0
                    ? `Up ${diff} since the last audit (was ${r.previousScore}).`
                    : `Down ${Math.abs(diff)} since the last audit (was ${r.previousScore}).`}
            </p>
            <p className="lx-10 lx-mut mt-1.5">
              {r.pagesChecked} pages checked · {new Date(r.createdAt).toLocaleString()}
              {r.seconds != null && ` · ${Math.round(r.seconds / 60) || 1} min`}
            </p>
            {state!.history.length > 1 && <Trend points={state!.history} />}
          </div>
          <button
            className="lx-ghost lx-11 lx-audit-noprint"
            onClick={() => window.print()}
            title="Opens your browser's print dialog — choose 'Save as PDF' as the destination"
          >
            Export as PDF
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <SeverityTile label="Errors" sub="Fix first" count={r.blocks} color="#f87171" />
          <SeverityTile label="Warnings" sub="Worth improving" count={r.warns} color="#fbbf24" />
          <SeverityTile label="Notices" sub="For the record" count={notices} color="var(--lx-mut)" />
        </div>
      </div>

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
              <VitalTile label="Largest Contentful Paint" value={avgLcp != null ? `${(avgLcp / 1000).toFixed(1)}s` : "—"} good={avgLcp != null && avgLcp <= LCP_GOOD_MS} />
              <VitalTile label="Cumulative Layout Shift" value={avgCls != null ? avgCls.toFixed(2) : "—"} good={avgCls != null && avgCls <= CLS_GOOD} />
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

      {/* FULL ISSUE LIST — unchanged real behaviour, every issue with its real affected pages. */}
      <div className="grid grid-cols-1 gap-2.5">
        {issues.length ? (
          issues.map((i) => (
            <div key={i.id} className="lx-card2 p-4">
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
                <div className="mt-2.5">
                  <button
                    className="lx-11 underline lx-audit-noprint"
                    style={{ color: "var(--lx-cyan)" }}
                    onClick={() => setOpen(open === i.id ? null : i.id)}
                  >
                    {open === i.id ? "hide" : "show"} {i.count > i.pages.length ? `${i.pages.length} of ${i.count}` : `${i.count}`} {i.count === 1 ? "page" : "pages"}
                  </button>
                  {/* Always rendered, not conditionally mounted — a printed report has no click
                      to expand it with, so `lx-audit-print-only` (below) forces it visible
                      there regardless of `open`; on screen, the inline style is what actually
                      toggles it. */}
                  <ul
                    className={open === i.id ? "mt-2 space-y-1" : "mt-2 space-y-1 lx-audit-print-only"}
                    style={{ display: open === i.id ? undefined : "none" }}
                  >
                    {i.pages.map((p) => (
                      <li key={p} className="lx-11" style={{ wordBreak: "break-all" }}>
                        <a href={p} target="_blank" rel="noreferrer noopener" className="underline" style={{ color: "var(--lx-cyan)" }}>{p}</a>
                      </li>
                    ))}
                    {i.count > i.pages.length && <li className="lx-10 lx-mut">…and {i.count - i.pages.length} more</li>}
                  </ul>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
            <div className="text-2xl">✨</div>
            <p className="lx-11 lx-mut">Nothing to fix — every check passed.</p>
          </div>
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

      <style>{`
        @media screen { .lx-audit-print-only { display: none !important; } }
        @media print { .lx-audit-print-only { display: block !important; } }
      `}</style>
    </div>
  );
}

/** The score, as a ring — the one visual a Semrush-style report leads with. Pure SVG, no
 *  charting dependency: one number between 0 and 100 is a single arc. */
function ScoreGauge({ score, scoreTone }: { score: number; scoreTone: "good" | "ok" | "bad" }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: 92, height: 92 }} aria-label={`Site health score: ${score} out of 100`}>
      <svg width={92} height={92} viewBox="0 0 92 92">
        <circle cx={46} cy={46} r={r} fill="none" stroke="var(--lx-border)" strokeWidth={8} />
        <circle
          cx={46}
          cy={46}
          r={r}
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

function SeverityTile({ label, sub, count, color }: { label: string; sub: string; count: number; color: string }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--lx-border)" }}>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="lx-11 font-semibold">{label}</span>
      </div>
      <b className="mt-1 block font-extrabold" style={{ fontSize: 24, color }}>{count}</b>
      <span className="lx-10 lx-mut">{sub}</span>
    </div>
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

/** The trend, as bars. Deliberately not a charting library: twenty numbers between 0 and 100
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
