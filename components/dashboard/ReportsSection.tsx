"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, Clock, FileText, Globe, Loader2,
  Megaphone, MapPin, RotateCw, ScrollText, TrendingUp, XCircle,
} from "lucide-react";
import { useStore } from "@/lib/store";

/** /dashboard/reports — rebuilt 2026-09-05 on the same look as Approvals / Content / Schedule
 *  (owner: "report page ka ui bhi theme se match").
 *
 *  IT NOW READS REAL DATA. The old page listed only `s.reports` from lib/store.tsx — lines
 *  appended in memory by whatever you happened to do in the current tab, gone on reload, and
 *  linking into the retired /app/reports/[id]. A report you can't reload isn't a report.
 *
 *  Every number and row below comes from the database:
 *   - GET /api/content (status=all) — what the team actually produced, grouped by the day it
 *     was created: titles, type, status, word count, and the live URL once published.
 *   - GET /api/schedule/history — whether the automatic run for that day fired, and anything
 *     that failed inside it (agent-server writes these rows).
 *  The current session's own in-memory log (`s.reports`) is still shown, clearly labelled as
 *  this session's activity, because it is the only place a manual approve/publish narrates
 *  itself — it is never mixed into the day's real counts.
 */

type Item = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  meta: { wordCount?: number; publishedUrl?: string | null; publishError?: string } | null;
  created_at: string;
  updated_at?: string;
};

type Run = {
  id: string;
  firedAt: string;
  status: "running" | "finished" | "partial" | "failed";
  planned: number | null;
  reason: string | null;
  bossError: string | null;
  failures: { agent: string; task: string; message: string; at: string }[];
};

const TYPE_ICON: Record<string, React.ElementType> = { article: FileText, social: Megaphone, gbp: MapPin };
const TYPE_LABEL: Record<string, string> = { article: "Article", social: "Social post", gbp: "GBP post" };

const STATUS: Record<string, { label: string; pill: string }> = {
  published: { label: "Published", pill: "green" },
  approved: { label: "Approved", pill: "blue" },
  awaiting_approval: { label: "Waiting for you", pill: "amber" },
  rejected: { label: "Rejected", pill: "red" },
  failed: { label: "Publish failed", pill: "red" },
  draft: { label: "Draft", pill: "mut" },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s, pill: "mut" };

const dayKey = (iso: string) => new Date(iso).toDateString();
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
};
const fmtFullDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

type Day = {
  key: string;
  iso: string;
  items: Item[];
  runs: Run[];
  published: number;
  waiting: number;
  problems: number;
  words: number;
};

export default function ReportsSection() {
  const { s } = useStore();
  const [items, setItems] = useState<Item[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [c, h] = await Promise.all([
        fetch("/api/content?status=all", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/schedule/history", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      if (!c.ok) { setError(c.error ?? "Could not load your content."); setItems([]); return; }
      setError("");
      setItems(c.items ?? []);
      setRuns(h?.ok ? (h.runs ?? []) : []);
    } catch (e: any) {
      setError(e?.message ?? "Network error.");
      setItems([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const days: Day[] = useMemo(() => {
    const map = new Map<string, Day>();
    for (const it of items ?? []) {
      const key = dayKey(it.created_at);
      const day = map.get(key) ?? { key, iso: it.created_at, items: [], runs: [], published: 0, waiting: 0, problems: 0, words: 0 };
      day.items.push(it);
      if (it.status === "published") day.published++;
      if (it.status === "awaiting_approval") day.waiting++;
      if (it.status === "failed" || it.status === "rejected") day.problems++;
      day.words += typeof it.meta?.wordCount === "number" ? it.meta.wordCount : 0;
      map.set(key, day);
    }
    for (const run of runs) {
      const key = dayKey(run.firedAt);
      const day = map.get(key) ?? { key, iso: run.firedAt, items: [], runs: [], published: 0, waiting: 0, problems: 0, words: 0 };
      day.runs.push(run);
      map.set(key, day);
    }
    return Array.from(map.values()).sort((a, b) => +new Date(b.iso) - +new Date(a.iso));
  }, [items, runs]);

  // Open the newest day by default, once the data is in.
  useEffect(() => { if (open === null && days.length) setOpen(days[0].key); }, [days, open]);

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

  const sessionLog = (s.reports ?? [])[0] as { key: string; lines: { t: string; s: string }[] } | undefined;

  return (
    <div className="rp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <section className="rp-panel flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3" style={{ borderBottom: "1px solid var(--lx-border)" }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="rp-h1">Reports</h1>
              <ScrollText size={18} style={{ color: "#3b82f6" }} />
            </div>
            <p className="lx-mut mt-0.5" style={{ fontSize: 12 }}>What your team did, day by day — straight from your workspace.</p>
          </div>
          <button className="rp-icobtn" onClick={() => void load()} title="Refresh" disabled={busy}>
            {busy ? <Loader2 size={15} className="rp-spin" /> : <RotateCw size={15} />}
          </button>
        </header>

        <div className="lx-scroll flex-1 overflow-y-auto px-4 pb-4">
          {error && <p className="lx-11 mt-3" style={{ color: "#f87171" }}>{error}</p>}

          {/* last 7 days — every number counted off the rows below it */}
          <div className="rp-stats mt-3">
            <Stat color="#8b5cf6" Icon={FileText} value={String(week.made)} label="Made this week" sub="last 7 days" />
            <Stat color="#22c55e" Icon={Globe} value={String(week.published)} label="Published" sub="live on your site" />
            <Stat color="#f59e0b" Icon={Clock} value={String(week.waiting)} label="Waiting for you" sub="sitting in Approvals" />
            <Stat color="#ef4444" Icon={AlertTriangle} value={String(week.problems)} label="Problems" sub="failed or rejected" />
            <Stat color="#3b82f6" Icon={TrendingUp} value={week.words.toLocaleString()} label="Words written" sub="last 7 days" />
          </div>

          {items === null ? (
            <div className="rp-card mt-3 flex items-center justify-center py-8">
              <Loader2 size={18} className="rp-spin lx-mut" /><span className="lx-11 lx-mut ml-2">Loading…</span>
            </div>
          ) : days.length === 0 ? (
            <div className="rp-empty mt-3">
              <CalendarDays size={20} className="lx-mut" />
              <b className="lx-12 mt-2">No report yet</b>
              <p className="lx-11 lx-mut mt-1">
                Nothing has been written yet. Start the team from the <Link href="/dashboard" className="rp-link">dashboard</Link> or
                set it running on its own in <Link href="/dashboard/schedule" className="rp-link">Schedule</Link> — every day&apos;s work
                shows up here on its own.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {days.map((d) => (
                <DayCard
                  key={d.key}
                  day={d}
                  open={open === d.key}
                  onToggle={() => setOpen(open === d.key ? null : d.key)}
                  sessionLines={sessionLog?.key === d.key ? sessionLog.lines : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- */

function Stat({ color, Icon, value, label, sub }: { color: string; Icon: React.ElementType; value: string; label: string; sub: string }) {
  return (
    <div className="rp-stat" style={{ ["--c" as any]: color }}>
      <span className="rp-stat-ico"><Icon size={16} /></span>
      <div className="min-w-0">
        <div className="rp-stat-n">{value}</div>
        <div className="lx-10 lx-mut">{label}</div>
        <div className="rp-stat-sub">{sub}</div>
      </div>
    </div>
  );
}

function DayCard({ day, open, onToggle, sessionLines }: {
  day: Day; open: boolean; onToggle: () => void; sessionLines?: { t: string; s: string }[];
}) {
  const runFailures = day.runs.flatMap((r) => r.failures);
  const bossErrors = day.runs.map((r) => r.bossError).filter(Boolean) as string[];

  return (
    <div className="rp-day">
      <button className="rp-day-h" onClick={onToggle}>
        <span className="rp-date">
          <b>{new Date(day.iso).getDate()}</b>
          <i>{new Date(day.iso).toLocaleDateString("en-GB", { month: "short" })}</i>
        </span>
        <span className="min-w-0">
          <span className="rp-day-t">{fmtDay(day.iso)}</span>
          <span className="rp-day-s">{fmtFullDay(day.iso)} · {day.items.length} item{day.items.length === 1 ? "" : "s"}{day.words ? ` · ${day.words.toLocaleString()} words` : ""}</span>
        </span>
        <span className="rp-chips">
          {day.published > 0 && <span className="rp-chip green"><CheckCircle2 size={11} />{day.published} published</span>}
          {day.waiting > 0 && <span className="rp-chip amber"><Clock size={11} />{day.waiting} waiting</span>}
          {day.problems > 0 && <span className="rp-chip red"><XCircle size={11} />{day.problems} problem{day.problems === 1 ? "" : "s"}</span>}
          {day.runs.length > 0 && <span className="rp-chip blue"><RotateCw size={11} />{day.runs.length} auto run{day.runs.length === 1 ? "" : "s"}</span>}
        </span>
        <ChevronDown size={15} className={`lx-mut rp-chev ${open ? "on" : ""}`} />
      </button>

      {open && (
        <div className="mt-2.5 space-y-2">
          {day.runs.map((r) => (
            <div key={r.id} className="rp-run">
              <span className="lx-10 lx-mut">Automatic run · {fmtTime(r.firedAt)}</span>
              <span className={"lx-pill " + (r.status === "finished" ? "green" : r.status === "running" ? "blue" : r.status === "partial" ? "amber" : "red")}>
                {r.status === "finished" ? "Finished" : r.status === "running" ? "Running" : r.status === "partial" ? "Partial" : "Failed"}
              </span>
              {r.planned != null && <span className="lx-10 lx-mut">{r.planned} topics planned</span>}
              {r.reason && <span className="lx-10 lx-mut">· {r.reason}</span>}
            </div>
          ))}

          {day.items.map((it) => {
            const st = statusOf(it.status);
            const Icon = TYPE_ICON[it.type] ?? FileText;
            return (
              <Link key={it.id} href={`/dashboard/content/${it.id}`} className="rp-item">
                <span className="rp-item-ico"><Icon size={14} /></span>
                <span className="min-w-0 flex-1">
                  <span className="rp-item-t">{it.title || "Untitled"}</span>
                  <span className="rp-item-s">
                    {TYPE_LABEL[it.type] ?? it.type}
                    {typeof it.meta?.wordCount === "number" ? ` · ${it.meta.wordCount.toLocaleString()} words` : ""}
                    {` · ${fmtTime(it.created_at)}`}
                  </span>
                  {it.meta?.publishError && <span className="rp-item-err">Publish failed: {it.meta.publishError}</span>}
                </span>
                {it.meta?.publishedUrl && (
                  <span className="rp-live" onClick={(e) => { e.preventDefault(); window.open(it.meta!.publishedUrl!, "_blank", "noreferrer"); }}>
                    open live
                  </span>
                )}
                <span className={"lx-pill " + st.pill}>{st.label}</span>
              </Link>
            );
          })}

          {bossErrors.map((e, i) => <p key={i} className="lx-11" style={{ color: "#f87171" }}>{e}</p>)}
          {runFailures.map((f, i) => (
            <p key={i} className="lx-11" style={{ color: "#f87171" }}>{f.task} — {f.message}</p>
          ))}

          {sessionLines?.length ? (
            <div className="rp-log">
              <div className="lx-10 lx-mut font-semibold uppercase" style={{ letterSpacing: ".06em" }}>This session&apos;s activity</div>
              {sessionLines.map((l, i) => (
                <div key={i} className="rp-log-l"><span className="lx-10 lx-mut">{l.t}</span><span className="lx-11">{l.s}</span></div>
              ))}
            </div>
          ) : null}

          {day.items.length === 0 && day.runs.length > 0 && (
            <p className="lx-11 lx-mut">The run fired but produced nothing that day.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* Same visual language as Approvals / Content / Schedule. Injected with
   dangerouslySetInnerHTML — React escapes ">" inside a <style> text child, which turns every
   child selector into a hydration mismatch. */
const CSS = `
.rp-wrap{display:flex;height:100%;min-height:0;container-type:inline-size;container-name:rp}
.rp-panel{background:#0a0a11;border:1px solid var(--lx-border);border-radius:16px;min-width:0;width:100%}
.rp-h1{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.1;color:#fff}
.rp-icobtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;
  border:1px solid var(--lx-border);background:#0d0d16;color:#9a9ab2;cursor:pointer;transition:.15s;flex-shrink:0}
.rp-icobtn:hover:not(:disabled){color:#fff;border-color:rgba(139,92,246,.55)}
.rp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(136px,1fr));gap:8px}
.rp-stat{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:11px;min-width:0;
  background:color-mix(in srgb,var(--c) 9%,#0b0b12);border:1px solid color-mix(in srgb,var(--c) 40%,transparent)}
.rp-stat-ico{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;flex-shrink:0;
  color:var(--c);background:color-mix(in srgb,var(--c) 14%,#0b0b12);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}
.rp-stat-n{font-size:19px;font-weight:800;line-height:1;color:#fff;font-variant-numeric:tabular-nums}
.rp-stat-sub{margin-top:2px;font-size:10px;color:var(--lx-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-card{background:#0d0d16;border:1px solid var(--lx-border);border-radius:12px}
.rp-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:30px 20px;border-radius:12px;
  background:#0d0d16;border:1px dashed var(--lx-border)}
.rp-day{padding:12px;border-radius:12px;background:#0d0d16;border:1px solid var(--lx-border)}
.rp-day-h{display:flex;align-items:center;gap:10px;width:100%;padding:0;background:none;border:none;color:inherit;
  cursor:pointer;text-align:left}
.rp-date{display:flex;flex-direction:column;align-items:center;justify-content:center;width:40px;height:40px;flex-shrink:0;
  border-radius:10px;background:#0a0a11;border:1px solid var(--lx-border)}
.rp-date b{font-size:15px;font-weight:800;color:#fff;line-height:1.1}
.rp-date i{font-size:9px;font-style:normal;color:var(--lx-mut);text-transform:uppercase}
.rp-day-t{display:block;font-size:13px;font-weight:700;color:#fff}
.rp-day-s{display:block;margin-top:2px;font-size:10.5px;color:var(--lx-mut)}
.rp-chips{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px;margin-left:auto}
.rp-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:7px;font-size:10.5px;font-weight:600;white-space:nowrap}
.rp-chip.green{color:#4ade80;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3)}
.rp-chip.amber{color:#fbbf24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3)}
.rp-chip.red{color:#f87171;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3)}
.rp-chip.blue{color:#60a5fa;background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3)}
@container rp (max-width:620px){.rp-chips{display:none}}
.rp-chev{flex-shrink:0;transition:transform .15s}
.rp-chev.on{transform:rotate(180deg)}
.rp-run{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;background:#0a0a11;
  border:1px solid var(--lx-border)}
.rp-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;background:#0a0a11;
  border:1px solid var(--lx-border);text-decoration:none;transition:.15s}
.rp-item:hover{border-color:rgba(139,92,246,.45);background:#101019}
.rp-item-ico{display:flex;align-items:center;justify-content:center;width:28px;height:28px;flex-shrink:0;border-radius:8px;
  color:#a5b4fc;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3)}
.rp-item-t{display:block;font-size:12.5px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-item-s{display:block;margin-top:2px;font-size:10.5px;color:var(--lx-mut)}
.rp-item-err{display:block;margin-top:2px;font-size:10.5px;color:#f87171}
.rp-live{flex-shrink:0;font-size:10.5px;font-weight:600;color:#4ade80;white-space:nowrap}
.rp-live:hover{text-decoration:underline}
.rp-log{padding:10px;border-radius:9px;background:#0a0a11;border:1px dashed var(--lx-border)}
.rp-log-l{display:flex;gap:8px;align-items:baseline;padding:4px 0}
.rp-log-l+.rp-log-l{border-top:1px solid var(--lx-border)}
.rp-link{color:#818cf8;text-decoration:none}
.rp-link:hover{text-decoration:underline}
.rp-spin{animation:rpSpin 1s linear infinite}
@keyframes rpSpin{to{transform:rotate(360deg)}}
`;
