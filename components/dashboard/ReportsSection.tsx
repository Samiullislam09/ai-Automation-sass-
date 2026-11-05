"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ChevronRight, Loader2, RotateCw, ScrollText } from "lucide-react";
import {
  buildDays, fetchReportItems, fetchReportRuns, fmtDate, dayName, summarise, REPORT_CSS,
  type Day, type Item, type Run,
} from "@/components/dashboard/report-day";

const DAYS_STEP = 30;

/** /dashboard/reports — a clean list of days. One row per day with a plain-English line, and
 *  the day itself opens as its OWN PAGE at /dashboard/reports/[YYYY-MM-DD] (owner, 2026-09-05:
 *  "popup pe nahi, normal page pe aa jaye"). Everything shared with that page — grouping,
 *  wording, styles — lives in components/dashboard/report-day.tsx.
 *
 *  Real workspace data only: GET /api/content (status=all) and GET /api/schedule/history. */

export default function ReportsSection({ initialItems, truncated: initialTruncated }: { initialItems?: Item[]; truncated?: boolean }) {
  // The server hands the rows over on first paint, so there is no empty "Loading…" screen. The
  // run receipts are slower (they read the job log) and arrive a moment later.
  const [items, setItems] = useState<Item[] | null>(initialItems ?? null);
  const [truncated, setTruncated] = useState(!!initialTruncated);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(DAYS_STEP);

  const load = useCallback(async () => {
    setBusy(true);
    const [d, r] = await Promise.all([fetchReportItems(), fetchReportRuns()]);
    setError(d.error);
    if (!d.error) { setItems(d.items); setTruncated(d.truncated); }
    else setItems((cur) => cur ?? []);
    setRuns(r);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (initialItems) void fetchReportRuns().then(setRuns);
    else void load();
  }, [load, initialItems]);

  const days: Day[] = useMemo(() => buildDays(items ?? [], runs), [items, runs]);

  const week = useMemo(() => {
    const since = Date.now() - 7 * 86_400_000;
    const recent = (items ?? []).filter((i) => +new Date(i.created_at) >= since);
    return {
      made: recent.length,
      published: recent.filter((i) => i.status === "published").length,
      waiting: recent.filter((i) => i.status === "awaiting_approval").length,
      problems: recent.filter((i) => i.status === "failed" || i.status === "rejected").length,
      words: recent.reduce((n, i) => n + (typeof i.meta?.wordCount === "number" ? i.meta.wordCount : 0), 0),
    };
  }, [items]);

  return (
    <div className="rp-wrap">
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />

      <section className="rp-panel flex min-w-0 flex-1 flex-col">
        <header className="rp-head flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="rp-h1">Reports</h1>
              <ScrollText size={18} style={{ color: "var(--lx-violet)" }} />
            </div>
            <p className="rp-sub">Pick a day to read the full report.</p>
          </div>
          <button className="rp-icobtn" onClick={() => void load()} title="Refresh" disabled={busy}>
            {busy ? <Loader2 size={15} className="rp-spin" /> : <RotateCw size={15} />}
          </button>
        </header>

        <div className="lx-scroll rp-body flex-1 overflow-y-auto">
          {error && <p className="lx-11 mt-3" style={{ color: "#f87171" }}>{error}</p>}

          {/* this week, in five plain numbers */}
          <div className="rp-week mt-3">
            <Week n={week.made} label="written" sub="last 7 days" color="#8b5cf6" />
            <Week n={week.published} label="went live" sub="on your site" color="#22c55e" />
            <Week n={week.waiting} label="waiting for you" sub="in Approvals" color="#f59e0b" href="/dashboard/approvals" />
            <Week n={week.problems} label="need a fix" sub="failed or rejected" color="#ef4444" />
            <Week n={week.words} label="words" sub="last 7 days" color="#3b82f6" big />
          </div>

          {items === null ? (
            <div className="mt-3 space-y-2" aria-busy="true"><div className="rp-skel" style={{ height: 58 }} /><div className="rp-skel" style={{ height: 58 }} /><div className="rp-skel" style={{ height: 58 }} /></div>
          ) : days.length === 0 ? (
            <div className="rp-empty mt-3">
              <CalendarDays size={20} className="lx-mut" />
              <b className="lx-12 mt-2">No report yet</b>
              <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 380 }}>
                Nothing has been written yet. Start the team from the <Link href="/dashboard" className="rp-link">dashboard</Link>, or let
                it run on its own from <Link href="/dashboard/schedule" className="rp-link">Schedule</Link> — each day&apos;s report appears here by itself.
              </p>
            </div>
          ) : (
            <>
              <div className="rp-listhead mt-4">Daily reports</div>
              <div className="mt-2 space-y-1.5">
                {days.slice(0, shown).map((d) => (
                  <Link key={d.key} href={`/dashboard/reports/${d.key}`} className="rp-row">
                    <span className="rp-date">
                      <b>{new Date(d.iso).getDate()}</b>
                      <i>{new Date(d.iso).toLocaleDateString("en-GB", { month: "short" })}</i>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="rp-row-t">
                        {dayName(d.iso)}
                        <em>{fmtDate(d.iso)}</em>
                      </span>
                      <span className="rp-row-s">{summarise(d)}</span>
                    </span>
                    <span className="rp-dots">
                      {d.published > 0 && <i className="green" title={`${d.published} live`} />}
                      {d.waiting > 0 && <i className="amber" title={`${d.waiting} waiting`} />}
                      {d.problems > 0 && <i className="red" title={`${d.problems} need a fix`} />}
                    </span>
                    <ChevronRight size={16} className="lx-mut rp-go" />
                  </Link>
                ))}
              </div>
              {days.length > shown && (
                <div className="rp-more"><button className="rp-btn" onClick={() => setShown((n) => n + DAYS_STEP)}>Show older days ({days.length - shown} more)</button></div>
              )}
              {truncated && <p className="rp-note">Showing your most recent work. Older items are not included here.</p>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Week({ n, label, sub, color, href, big }: {
  n: number; label: string; sub: string; color: string; href?: string; big?: boolean;
}) {
  const inner = (
    <>
      <span className="rp-week-n" style={{ color }}>{big ? n.toLocaleString() : n}</span>
      <span className="rp-week-l">{label}</span>
      <span className="rp-week-s">{sub}</span>
    </>
  );
  return href && n > 0
    ? <Link href={href} className="rp-week-c link">{inner}<ArrowRight size={12} className="rp-week-go" /></Link>
    : <div className="rp-week-c">{inner}</div>;
}
