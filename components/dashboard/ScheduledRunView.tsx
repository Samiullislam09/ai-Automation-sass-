"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ExternalLink, FileText, Loader2, Search, Users, X } from "lucide-react";
import { useScheduleCurrent, type FocusRun } from "@/lib/schedule-current";
import { startPolling } from "@/lib/poll";
import { clock } from "@/lib/live";

/** Live view of one scheduled run — the "Live Visual" for work that was not ordered in the chat.
 *
 *  Opened from the Current task card. It shows what the run has actually produced so far, read
 *  from the same tables the rest of the product uses (`leads`, `content_items`) through
 *  /api/schedule/current/live, newest last, as it lands. Nothing is simulated: no leads yet means
 *  the view says "Finding leads…", not a made-up list.
 *
 *  Whether the run is still going comes from the shared schedule poll (the run is in `runs` while
 *  its job is running). When it leaves that list, one last read decides finished vs failed, and a
 *  line is written into the chat so the conversation holds the result too. */

type Live = {
  status: "running" | "finished" | "failed" | "unknown";
  progress: string | null;
  message: string | null;
  saved: number | null;
  found: number | null;
  items: any[];
};

const ICON = { article: FileText, leads: Users, audit: Search } as const;

export default function ScheduledRunView({ run, onClose, onFinished }: { run: FocusRun; onClose: () => void; onFinished?: (summary: string, tone: "done" | "error") => void }) {
  const cur = useScheduleCurrent();
  const [live, setLive] = useState<Live | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reported = useRef(false);

  const current = cur?.runs.find((r) => r.id === run.id) ?? null;
  // Until the first read lands, assume it is still running rather than flashing "finished".
  const running = cur ? !!current : true;

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const q = new URLSearchParams({ kind: run.kind, id: run.id, since: run.startedAt });
        const r = await fetch(`/api/schedule/current/live?${q}`, { cache: "no-store" }).then((x) => x.json());
        if (alive && r?.ok) setLive(r);
      } catch {}
    };
    void pull();
    // Fast while it runs; a finished run is read once more below and then left alone.
    const stop = running ? startPolling(pull, 3000) : () => {};
    return () => { alive = false; stop(); };
  }, [run.id, run.kind, run.startedAt, running]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // The run just left the running list: read once more so the final numbers are on screen, then
  // tell the chat. Only once per open view.
  useEffect(() => {
    if (running || reported.current || !cur) return;
    const t = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ kind: run.kind, id: run.id, since: run.startedAt });
        const r: Live = await fetch(`/api/schedule/current/live?${q}`, { cache: "no-store" }).then((x) => x.json());
        if (!r || (r as any).ok === false) return;
        setLive(r);
        if (reported.current) return;
        reported.current = true;
        if (r.status === "failed") onFinished?.(`${run.title} failed: ${r.message ?? "the run did not finish."}`, "error");
        else if (run.kind === "leads") onFinished?.(`${run.title} finished — ${r.saved ?? r.items.length} lead${(r.saved ?? r.items.length) === 1 ? "" : "s"} added.`, "done");
        else if (run.kind === "article") onFinished?.(`${run.title} finished — ${r.items.length} article${r.items.length === 1 ? "" : "s"} ready for review.`, "done");
        else onFinished?.(`${run.title} finished.`, "done");
      } catch {}
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, !!cur]);

  const Icon = ICON[run.kind] ?? FileText;
  const failed = !running && live?.status === "failed";
  const elapsed = Math.max(0, now - new Date(run.startedAt).getTime());
  const line = current?.line ?? live?.progress ?? current?.stage ?? null;
  const items = live?.items ?? [];

  return (
    <section className="lx-card mb-3 p-3.5" aria-label="Scheduled run, live">
      <div className="flex items-center gap-2.5">
        <span style={{ width: 30, height: 30, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(124,58,237,.18)", color: "#a78bfa" }}>
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <b className="lx-13 block truncate">{run.title}</b>
          <span className="lx-10 lx-mut">Scheduled run · started {new Date(run.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        </div>
        <span className="lx-10 lx-mut" style={{ fontVariantNumeric: "tabular-nums" }}>{running ? clock(elapsed) : null}</span>
        <span className="lx-pill" style={{ fontSize: 10, color: failed ? "#f87171" : running ? "#818cf8" : "#34d399" }}>
          {running ? <Loader2 size={10} className="animate-spin" style={{ display: "inline", marginRight: 4 }} /> : failed ? <X size={10} style={{ display: "inline", marginRight: 4 }} /> : <Check size={10} style={{ display: "inline", marginRight: 4 }} />}
          {running ? "Running" : failed ? "Failed" : "Finished"}
        </span>
        <button className="lx-icobtn" onClick={onClose} aria-label="Close live view"><X size={14} /></button>
      </div>

      {running && line && (
        <div className="lx-11 mt-2.5 flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" style={{ color: "#818cf8" }} />
          <span className="truncate">{line}</span>
        </div>
      )}

      {current?.steps && (
        <ol className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {current.steps.map((s) => (
            <li key={s.id} className="lx-10 flex items-center gap-1" style={{ color: s.state === "next" ? "var(--lx-mut)" : "var(--lx-text)", fontWeight: s.state === "now" ? 700 : 400 }}>
              {s.state === "done" ? <Check size={10} style={{ color: "#34d399" }} /> : s.state === "now" ? <Loader2 size={10} className="animate-spin" style={{ color: "#818cf8" }} /> : <span style={{ width: 10, height: 10, borderRadius: 99, border: "1px solid var(--lx-border)", display: "inline-block" }} />}
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {failed && (
        <div className="lx-11 mt-2.5 flex items-start gap-2 rounded-lg p-2.5" style={{ color: "#fca5a5", background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.35)" }}>
          <AlertTriangle size={12} className="mt-px shrink-0" />
          <span>{live?.message ?? "The run failed."}</span>
        </div>
      )}

      <div className="mt-3 space-y-2" style={{ maxHeight: 420, overflowY: "auto" }}>
        {run.kind === "leads" && items.map((l: any) => (
          <div key={l.id} className="lx-card2 rounded-lg px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="lx-12 truncate font-semibold">{l.company || l.name || "Lead"}</span>
              {typeof l.icp_score === "number" && <span className="lx-pill" style={{ fontSize: 10, padding: "1px 8px" }}>{l.icp_score}</span>}
            </div>
            <div className="lx-10 lx-mut truncate">{[l.website, [l.city, l.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</div>
          </div>
        ))}
        {run.kind === "article" && items.map((a: any) => (
          <Link key={a.id} href={`/dashboard/content/${a.id}`} className="lx-card2 flex items-center justify-between gap-2 rounded-lg px-3 py-2.5" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="lx-12 truncate font-semibold">{a.title || "(untitled)"}</span>
            <span className="lx-10 lx-mut flex items-center gap-1" style={{ whiteSpace: "nowrap" }}>{a.words ? `${a.words} words · ` : ""}{String(a.status).replace(/_/g, " ")} <ExternalLink size={10} /></span>
          </Link>
        ))}
        {!items.length && run.kind !== "audit" && (
          <div className="lx-10 lx-mut px-1 py-2">
            {running ? (run.kind === "leads" ? "Finding leads… they appear here as they are saved." : "Working… the first article appears here once it is saved.") : "This run did not produce anything."}
          </div>
        )}
        {run.kind === "audit" && !running && !failed && (
          <Link href="/dashboard/audit" className="lx-11" style={{ color: "#a78bfa" }}>Open the audit report →</Link>
        )}
      </div>

      {run.kind === "leads" && !running && items.length > 0 && (
        <Link href="/dashboard/leads" className="lx-11 mt-2.5 inline-block" style={{ color: "#a78bfa" }}>Open Leads →</Link>
      )}
    </section>
  );
}
