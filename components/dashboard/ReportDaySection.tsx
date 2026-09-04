"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, RotateCw } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  buildDays, fetchReportData, fmtDate, dayName, REPORT_CSS, type Day, type Item, type Run,
  DayReportBody,
} from "@/components/dashboard/report-day";

/** /dashboard/reports/[day] — one day's full report as its own page (owner, 2026-09-05:
 *  "popup pe nahi, normal page pe aa jaye"). Same data and wording as the list it came from;
 *  everything shared lives in components/dashboard/report-day.tsx.
 *
 *  `day` is the local calendar date as YYYY-MM-DD — the same key the list links with. A date
 *  with nothing recorded says so rather than 404-ing, because "nothing happened that day" is a
 *  real answer. */
export default function ReportDaySection({ day: key }: { day: string }) {
  const { s } = useStore();
  const [items, setItems] = useState<Item[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const d = await fetchReportData();
    setError(d.error);
    setItems(d.items);
    setRuns(d.runs);
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const days: Day[] = useMemo(() => buildDays(items ?? [], runs), [items, runs]);
  const index = days.findIndex((d) => d.key === key);
  const day = index >= 0 ? days[index] : null;
  // days[] is newest first, so "newer" is the previous index.
  const newer = index > 0 ? days[index - 1] : null;
  const older = index >= 0 && index < days.length - 1 ? days[index + 1] : null;

  // The session log is keyed by Date.toDateString(); match it to this page's day.
  const sessionLog = (s.reports ?? [])[0] as { key: string; lines: { t: string; s: string }[] } | undefined;
  const sessionLines = sessionLog && day && new Date(sessionLog.key).toDateString() === new Date(day.iso).toDateString()
    ? sessionLog.lines
    : undefined;

  const label = day ? dayName(day.iso) : key;
  const sub = day ? fmtDate(day.iso) : "No report for this date";

  return (
    <div className="rp-wrap">
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />

      <section className="rp-panel flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3" style={{ borderBottom: "1px solid var(--lx-border)" }}>
          <Link href="/dashboard/reports" className="rp-icobtn" title="Back to all reports"><ArrowLeft size={16} /></Link>
          <div className="min-w-0 flex-1">
            <h1 className="rp-h1">{label}</h1>
            <p className="rp-sub">{sub}</p>
          </div>
          <div className="rp-nav">
            {older
              ? <Link href={`/dashboard/reports/${older.key}`} className="rp-icobtn" title={`Older — ${fmtDate(older.iso)}`}><ChevronLeft size={16} /></Link>
              : <span className="rp-icobtn" style={{ opacity: .35 }}><ChevronLeft size={16} /></span>}
            {newer
              ? <Link href={`/dashboard/reports/${newer.key}`} className="rp-icobtn" title={`Newer — ${fmtDate(newer.iso)}`}><ChevronRight size={16} /></Link>
              : <span className="rp-icobtn" style={{ opacity: .35 }}><ChevronRight size={16} /></span>}
            <button className="rp-icobtn" onClick={() => void load()} title="Refresh" disabled={busy}>
              {busy ? <Loader2 size={15} className="rp-spin" /> : <RotateCw size={15} />}
            </button>
          </div>
        </header>

        <div className="lx-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
          {error && <p className="lx-11" style={{ color: "#f87171" }}>{error}</p>}

          {items === null ? (
            <div className="rp-loading"><Loader2 size={18} className="rp-spin lx-mut" /><span className="lx-11 lx-mut ml-2">Loading…</span></div>
          ) : day ? (
            <DayReportBody day={day} sessionLines={sessionLines} />
          ) : (
            <div className="rp-empty">
              <b className="lx-12">Nothing recorded on {key}</b>
              <p className="lx-11 lx-mut mt-1">
                No content was written and no automatic run fired that day.{" "}
                <Link href="/dashboard/reports" className="rp-link">Back to all reports</Link>
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
