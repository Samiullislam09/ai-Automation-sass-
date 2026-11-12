"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarClock, Check, ChevronRight, FileText, Loader2, Search, Users } from "lucide-react";
import { focusRun, useScheduleCurrent, type CurrentRun, type CurrentSchedule } from "@/lib/schedule-current";
import { clock } from "@/lib/live";

/** "Current task" — what the schedule is doing right now, and what it does next.
 *
 *  Sits at the bottom of the Dashboard and at the top of the Leads page. Owner, 2026-11-13: "leads
 *  schedule kiya hai, par wo kaam kar raha hai ya nahi pata nahi chalta". While a scheduled run
 *  is in flight it shows that run — what it is, which step it is on, for how long — and clicking
 *  it opens the run in the chat with its live view. When nothing is running it shows the plan:
 *  the next task and every schedule's own state.
 *
 *  `kinds` narrows the card to one job's runs (the Leads page only cares about leads). Renders
 *  nothing until the first read, and nothing at all when there is neither a run nor a schedule —
 *  an empty box with nothing behind it is noise. */

const ICON = { article: FileText, leads: Users, audit: Search } as const;
const COLOR = { article: "#a78bfa", leads: "#fb923c", audit: "#818cf8" } as const;

function whenLabel(iso: string, tz: string): string {
  try {
    const at = new Date(iso);
    const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);
    const today = day(new Date());
    const tomorrow = day(new Date(Date.now() + 86_400_000));
    const d = day(at);
    if (d === today) return `Today, ${time}`;
    if (d === tomorrow) return `Tomorrow, ${time}`;
    return `${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(at)}, ${time}`;
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export default function ScheduledRunCard({ kinds, className }: { kinds?: CurrentRun["kind"][]; className?: string }) {
  const cur = useScheduleCurrent();
  const router = useRouter();
  const pathname = usePathname();

  const runs = (cur?.runs ?? []).filter((r) => !kinds || kinds.includes(r.kind));
  const schedules = (cur?.schedules ?? []).filter((s) => !kinds || (kinds as string[]).includes(s.kind));

  // One clock for the whole card, and only while something is running.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!runs.length) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [runs.length]);

  if (!cur) return null;
  const on = schedules.filter((s) => s.enabled);
  if (!runs.length && !schedules.length) return null;

  const next = on.filter((s) => s.nextRunAt).sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())[0] ?? null;

  const open = (r: CurrentRun) => {
    focusRun({ id: r.id, kind: r.kind, agent: r.agent, title: r.title, startedAt: r.startedAt });
    // The run view and the chat live on the Dashboard; from any other page, go there.
    if (pathname !== "/dashboard") router.push("/dashboard");
  };

  return (
    <section className={`lx-card p-3.5 ${className ?? ""}`} aria-label="Current task">
      <div className="flex items-center justify-between gap-2">
        <b className="lx-12" style={{ letterSpacing: ".02em" }}>
          {runs.length ? (runs.length > 1 ? `Current tasks · ${runs.length}` : "Current task") : "Schedule"}
        </b>
        <Link href="/dashboard/schedule" className="lx-10 lx-mut" style={{ textDecoration: "none" }}>
          Open schedule <ChevronRight size={10} style={{ display: "inline", verticalAlign: "-1px" }} />
        </Link>
      </div>

      {runs.map((r) => (
        <RunRow key={r.id} run={r} now={now} onOpen={() => open(r)} />
      ))}

      {/* The plan: always visible, so "is anything even scheduled?" never needs another page. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5" style={{ borderTop: runs.length ? "1px solid var(--lx-border)" : undefined, paddingTop: runs.length ? 10 : 0 }}>
        <CalendarClock size={12} style={{ color: "var(--lx-mut)" }} />
        {next ? (
          <span className="lx-11">
            <span className="lx-mut">Next: </span>
            <b>{next.label}</b> · {whenLabel(next.nextRunAt!, next.timezone)}
          </span>
        ) : (
          <span className="lx-11 lx-mut">{schedules.length ? "Nothing is turned on." : "Nothing scheduled yet."}</span>
        )}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {schedules.map((s) => (
            <SchedChip key={s.kind} s={s} />
          ))}
        </span>
      </div>
    </section>
  );
}

function RunRow({ run, now, onOpen }: { run: CurrentRun; now: number; onOpen: () => void }) {
  const Icon = ICON[run.kind] ?? FileText;
  const color = COLOR[run.kind] ?? "#818cf8";
  const elapsed = Math.max(0, now - new Date(run.startedAt).getTime());
  return (
    <button
      type="button"
      onClick={onOpen}
      className="lx-card2 mt-2.5 w-full p-3 text-left"
      style={{ cursor: "pointer", borderColor: `${color}55` }}
      title="Open in chat and watch it live"
    >
      <div className="flex items-center gap-2.5">
        <span style={{ width: 28, height: 28, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `${color}22`, color, flexShrink: 0 }}>
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <b className="lx-12 truncate">{run.title}</b>
            <span className="lx-10 lx-mut" style={{ fontVariantNumeric: "tabular-nums" }}>{clock(elapsed)}</span>
          </div>
          <div className="lx-11 lx-mut flex items-center gap-1.5 truncate">
            <Loader2 size={11} className="animate-spin" style={{ color, flexShrink: 0 }} />
            <span className="truncate">{run.line ?? run.stage}</span>
          </div>
        </div>
        <span className="lx-10" style={{ color, fontWeight: 700, whiteSpace: "nowrap" }}>Watch live <ChevronRight size={10} style={{ display: "inline", verticalAlign: "-1px" }} /></span>
      </div>
      {run.steps && (
        <ol className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {run.steps.map((s) => (
            <li key={s.id} className="lx-10 flex items-center gap-1" style={{ color: s.state === "next" ? "var(--lx-mut)" : "var(--lx-text)", fontWeight: s.state === "now" ? 700 : 400 }}>
              {s.state === "done" ? <Check size={10} style={{ color: "#34d399" }} /> : s.state === "now" ? <Loader2 size={10} className="animate-spin" style={{ color }} /> : <span style={{ width: 10, height: 10, borderRadius: 99, border: "1px solid var(--lx-border)", display: "inline-block" }} />}
              {s.label}
            </li>
          ))}
        </ol>
      )}
    </button>
  );
}

function SchedChip({ s }: { s: CurrentSchedule }) {
  return (
    <span
      className="lx-10"
      title={s.enabled ? `${s.label} runs automatically` : `${s.label} is off`}
      style={{
        padding: "2px 8px", borderRadius: 999, border: "1px solid var(--lx-border)", whiteSpace: "nowrap",
        color: s.enabled ? "var(--lx-text)" : "var(--lx-mut)",
      }}
    >
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 99, marginRight: 5, background: s.enabled ? "#34d399" : "#64748b" }} />
      {s.label}{s.enabled && s.count ? ` · ${s.count}` : ""}{s.enabled ? "" : " · off"}
    </span>
  );
}
