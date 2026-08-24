"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PIPELINE, WRITING_RULES, QUALITY_GATE } from "@/lib/pipeline";

/** The "watch one agent work" panel. Opens when a room in the office is clicked (the office
 *  fades everyone else out — see Office.tsx `solo`), and shows what THAT agent has really
 *  done: its live state, its last jobs with the outcome of each, and the content those jobs
 *  produced. Every line comes from /api/dashboard/agent/[id], which reads jobs_log and
 *  content_items — if an agent has done nothing, this panel says exactly that. */

type Job = { id: string; task: string; status: string; at: string; summary: string; items: string[] };
type Content = { id: string; title: string; status: string; words: number | null; at: string };
type Detail = {
  ok: boolean;
  agent: { id: string; name: string; role: string; ico: string; color: string; live: boolean };
  jobAgent: string | null;
  state: { state: string; task: string };
  jobs: Job[];
  content: Content[];
  counts: { total: number; success: number; error: number; running: number };
  error?: string;
};

const STATE_LABEL: Record<string, string> = {
  working: "Working now", waiting: "Waiting on you", error: "Last job failed", off: "Idle",
};
const STATE_COLOR: Record<string, string> = {
  working: "var(--grn)", waiting: "var(--amb)", error: "var(--red)", off: "var(--mut2)",
};

const time = (iso: string) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
};

export default function AgentPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/dashboard/agent/${id}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Failed (status ${res.status})`);
      setD(body);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? "Could not load this agent.");
    } finally {
      inFlight.current = false;
    }
  }, [id]);

  // Re-poll while the panel is open so a running job's outcome appears without a refresh.
  useEffect(() => {
    setD(null);
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const stage = PIPELINE.find((p) => p.id === id);
  const state = d?.state?.state ?? "off";

  return (
    <aside className="apanel" onClick={(e) => e.stopPropagation()}>
      <header className="ap-head">
        <span className="ap-ico" style={{ background: `color-mix(in srgb, ${d?.agent.color ?? "var(--ac)"} 18%, transparent)` }}>
          {d?.agent.ico ?? "🤖"}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="ap-name">{d?.agent.name ?? "Loading…"}</div>
          <div className="ap-role">{d?.agent.role ?? ""}</div>
        </div>
        <button className="ap-x" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="ap-body">
        <div className="ap-state" style={{ borderColor: STATE_COLOR[state] }}>
          <span className="dot" style={{ background: STATE_COLOR[state] }} />
          <div style={{ minWidth: 0 }}>
            <b>{STATE_LABEL[state] ?? "Idle"}</b>
            <div className="ap-task">{d?.state?.task && d.state.task !== "—" ? d.state.task : "Nothing running right now."}</div>
          </div>
        </div>

        {stage && (
          <section className="ap-sec">
            <h4>Its job in the pipeline</h4>
            <p className="ap-p">{stage.what}</p>
            <p className="ap-from"><b>Works from:</b> {stage.from}</p>
          </section>
        )}

        {err && <div className="ap-err">{err}</div>}

        <section className="ap-sec">
          <h4>
            What it actually did
            {d?.counts?.total ? <span className="ap-count">{d.counts.success} ok · {d.counts.error} failed</span> : null}
          </h4>

          {!d && !err && <p className="ap-p">Loading…</p>}

          {d && !d.jobAgent && (
            <p className="ap-p">
              This one has no queue of its own yet — it is a stage inside the writing job, so its work shows up
              in the content list below rather than as separate jobs.
            </p>
          )}

          {d && d.jobAgent && !d.jobs.length && (
            <p className="ap-p">Nothing yet. It has never been given a job — press “Run the team” and it will show up here.</p>
          )}

          <ul className="ap-jobs">
            {(d?.jobs ?? []).map((j) => (
              <li key={j.id} className={"ap-job is-" + j.status}>
                <div className="ap-job-top">
                  <span className="ap-badge">{j.status}</span>
                  <span className="ap-job-task">{j.task}</span>
                  <span className="ap-time">{time(j.at)}</span>
                </div>
                <div className="ap-sum">{j.summary}</div>
                {j.items.length > 0 && (
                  <ul className="ap-items">
                    {j.items.slice(0, 6).map((it, i) => <li key={i}>{it}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>

        {!!d?.content?.length && (
          <section className="ap-sec">
            <h4>What came out of it</h4>
            <ul className="ap-content">
              {d.content.map((c) => (
                <li key={c.id}>
                  <span className={"ap-cstatus is-" + c.status}>{c.status.replace(/_/g, " ")}</span>
                  <span className="ap-ctitle">{c.title}</span>
                  {c.words ? <span className="ap-time">{c.words} words</span> : null}
                </li>
              ))}
            </ul>
          </section>
        )}

        {id === "writer" && (
          <section className="ap-sec">
            <h4>The rules it writes to</h4>
            <ul className="ap-rules">{WRITING_RULES.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </section>
        )}
        {id === "qa" && (
          <section className="ap-sec">
            <h4>What the gate measures</h4>
            <ul className="ap-rules">{QUALITY_GATE.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </section>
        )}
      </div>

      <style jsx>{`
        .apanel { position: absolute; top: 0; right: 0; bottom: 0; z-index: 5;
                  width: min(430px, 62%); display: flex; flex-direction: column;
                  background: color-mix(in srgb, var(--panel) 92%, transparent);
                  backdrop-filter: blur(14px); border-left: 1px solid var(--line2);
                  animation: ap-in .38s cubic-bezier(.2,.7,.3,1); }
        @keyframes ap-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }

        .ap-head { display: flex; align-items: center; gap: 11px; padding: 14px 15px;
                   border-bottom: 1px solid var(--line); flex: none; }
        .ap-ico { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center;
                  font-size: 18px; flex: none; }
        .ap-name { font-size: 14.5px; font-weight: 800; color: var(--ink); }
        .ap-role { font-size: 11px; color: var(--mut); margin-top: 1px; }
        .ap-x { background: none; border: 1px solid var(--line2); color: var(--mut); width: 28px; height: 28px;
                border-radius: 8px; cursor: pointer; flex: none; }
        .ap-x:hover { color: var(--ink); }

        .ap-body { flex: 1; overflow-y: auto; padding: 14px 15px 20px; }

        .ap-state { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--line2);
                    border-left-width: 3px; border-radius: 11px; padding: 10px 12px; background: var(--panel2);
                    font-size: 12.5px; color: var(--ink); }
        .ap-state .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex: none; }
        .ap-task { font-size: 11.5px; color: var(--mut); margin-top: 3px; }

        .ap-sec { margin-top: 18px; }
        .ap-sec h4 { font-size: 10.5px; letter-spacing: .7px; text-transform: uppercase; color: var(--mut2);
                     font-weight: 800; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
        .ap-count { font-weight: 600; letter-spacing: 0; text-transform: none; font-size: 10.5px; color: var(--mut); }
        .ap-p { font-size: 12px; color: var(--mut); line-height: 1.55; }
        .ap-from { font-size: 11.5px; color: var(--mut2); line-height: 1.5; margin-top: 6px; }
        .ap-from b { color: var(--mut); }
        .ap-err { margin-top: 14px; font-size: 12px; color: var(--amb); }

        .ap-jobs { list-style: none; display: flex; flex-direction: column; gap: 9px; }
        .ap-job { border: 1px solid var(--line); border-left: 3px solid var(--mut2); border-radius: 10px;
                  padding: 9px 11px; background: var(--panel2); }
        .ap-job.is-success { border-left-color: var(--grn); }
        .ap-job.is-error { border-left-color: var(--red); }
        .ap-job.is-running, .ap-job.is-queued { border-left-color: var(--blu); }
        .ap-job-top { display: flex; align-items: center; gap: 8px; }
        .ap-badge { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px;
                    color: var(--mut); }
        .ap-job-task { font-size: 12px; font-weight: 700; color: var(--ink); flex: 1; min-width: 0;
                       overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ap-time { font-size: 10px; color: var(--mut2); flex: none; }
        .ap-sum { font-size: 11.5px; color: var(--mut); line-height: 1.5; margin-top: 5px; }
        .ap-items { list-style: none; margin-top: 7px; display: flex; flex-direction: column; gap: 4px; }
        .ap-items li { font-size: 11px; color: var(--mut2); line-height: 1.45; padding-left: 10px;
                       border-left: 1px solid var(--line2); }

        .ap-content { list-style: none; display: flex; flex-direction: column; gap: 7px; }
        .ap-content li { display: flex; align-items: center; gap: 8px; font-size: 11.5px; }
        .ap-ctitle { color: var(--ink); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
                     white-space: nowrap; }
        .ap-cstatus { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .3px;
                      border-radius: 6px; padding: 3px 6px; flex: none; background: var(--line);
                      color: var(--mut); }
        .ap-cstatus.is-awaiting_approval { background: color-mix(in srgb, var(--amb) 18%, transparent); color: var(--amb); }
        .ap-cstatus.is-published { background: color-mix(in srgb, var(--grn) 18%, transparent); color: var(--grn); }
        .ap-cstatus.is-failed { background: color-mix(in srgb, var(--red) 18%, transparent); color: var(--red); }

        .ap-rules { list-style: none; display: flex; flex-direction: column; gap: 6px; }
        .ap-rules li { font-size: 11.5px; color: var(--mut); line-height: 1.5; padding-left: 14px; position: relative; }
        .ap-rules li::before { content: "✓"; position: absolute; left: 0; color: var(--ac); font-weight: 800; }

        @media (max-width: 860px) { .apanel { width: 100%; } }
      `}</style>
    </aside>
  );
}
