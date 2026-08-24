"use client";
/** Dashboard root — the 2D isometric office (components/Office.tsx) plus the real stat row.
 *
 *  LIVE WIRING (this is what makes the office animate for real):
 *  it polls /api/dashboard/live, which returns `agentStates` straight out of jobs_log
 *  (lib/dashboard-data.ts → getAgentRoomStates), and pushes every room into the store with
 *  setAgent(). components/Office.tsx renders store.s.agents, so a running pg-boss job lights
 *  that agent's room up and its room tag shows the REAL task label the enqueuer wrote
 *  (e.g. Researching "how to ..." → Writing "how to ..."). Nothing here invents activity:
 *  when no job is running every live agent reads "Idle" and the unbuilt ones stay "off".
 *
 *  "Run the team" enqueues a real boss job (agent-server/src/agents/boss.ts) which plans
 *  topics from the tenant's own niche/crawled pages and starts boss → keyword → writer.
 *
 *  The pixel-art "AI Command Center" build that briefly lived here is still in the repo at
 *  components/dashboard/AICommandCenter.tsx; it is simply not routed. To put it back, render
 *  <AICommandCenter /> here and re-add the `if (isDashboard) return <>{children}</>` early
 *  return in app/app/layout.tsx, since it supplies its own sidebar/topbar/chat shell. */
import { useCallback, useEffect, useRef, useState } from "react";
import Office from "@/components/Office";
import AgentPanel from "@/components/AgentPanel";
import { AGENTS, useStore, type AgentState } from "@/lib/store";

type Stats = {
  totalAgents: number; liveAgents: number; working: number; waiting: number;
  errorsToday: number; tasksCompleted: number; successRate: number; pagesIndexed: number;
};
type RoomState = { state: "working" | "off" | "error" | "waiting"; task: string };

// [key, icon, label, accent-token] — accent tints the icon chip, same convention as the
// reference build's per-stat colouring.
const CARDS: [keyof Stats, string, string, string][] = [
  ["totalAgents", "🤖", "Total Agents", "var(--ac)"],
  ["working", "📈", "Working", "var(--grn)"],
  ["waiting", "⏱", "Waiting", "var(--amb)"],
  ["errorsToday", "⚠️", "Errors today", "var(--red)"],
  ["tasksCompleted", "✅", "Published", "var(--blu)"],
  ["successRate", "📊", "Success rate", "var(--vio)"],
  ["pagesIndexed", "🗂", "Pages indexed", "var(--teal)"],
];

// The API speaks in office ROOM ids (lib/dashboard-data.ts); the store and Office speak in
// AGENTS[].id (lib/agents-data.ts). Two of them differ — everything else is the same word.
const ROOM_TO_AGENT: Record<string, string> = { keyword: "kw", webstory: "story" };
const LIVE = new Set(AGENTS.filter((a) => a.live).map((a) => a.id));

/** One room's server state -> the 4-state the office renders.
 *  "off" is deliberately NOT "o" for a live agent: a built agent with no job right now is
 *  idle, not unbuilt. Only agents with no backend at all show the shuttered "Coming soon". */
function toAgentState(agentId: string, r: RoomState): AgentState {
  if (r.state === "working") return { st: "w", task: r.task };
  if (r.state === "error") return { st: "e", task: r.task };
  if (r.state === "waiting") return { st: "i", task: r.task };
  return LIVE.has(agentId) ? { st: "i", task: "Idle" } : { st: "o", task: "Coming soon" };
}

export default function Dashboard() {
  const store = useStore();
  // The store's api object (and therefore setAgent) is rebuilt on every provider render, so
  // it must NOT be a dependency of poll/the interval effect — that would tear down and
  // recreate the timer on every single state update. A ref keeps poll stable.
  const setAgentRef = useRef(store?.setAgent);
  setAgentRef.current = store?.setAgent;
  const [stats, setStats] = useState<Stats | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  // Which room the user clicked: the office fades everyone else out and this agent's real
  // job history opens beside it. null = the whole office.
  const [selected, setSelected] = useState<string | null>(null);

  // Poll the one real endpoint. A single in-flight request at a time (a slow reply must not
  // stack up behind the interval), and we stop entirely on 401 — an unauthenticated tab
  // hammering the API every few seconds is pure noise.
  const stopped = useRef(false);
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (stopped.current || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/dashboard/live", { cache: "no-store" });
      if (res.status === 401) { stopped.current = true; setLiveErr("Sign in to see live agent activity."); return; }
      const body = await res.text();
      let data: any;
      try { data = JSON.parse(body); }
      catch { throw new Error(`Live feed returned non-JSON (status ${res.status})`); }
      if (!data?.ok) throw new Error(data?.error ?? `Live feed failed (status ${res.status})`);

      setLiveErr(null);
      if (data.stats) setStats(data.stats);
      const rooms: Record<string, RoomState> = data.agentStates ?? {};
      for (const [room, r] of Object.entries(rooms)) {
        const id = ROOM_TO_AGENT[room] ?? room;
        const next = toAgentState(id, r);
        setAgentRef.current?.(id, next.st, next.task);
      }
    } catch (e: any) {
      setLiveErr(e?.message ?? "Could not reach the live feed.");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    stopped.current = false;
    poll();
    const t = setInterval(poll, 5000);
    return () => { stopped.current = true; clearInterval(t); };
  }, [poll]);

  /** Real trigger — POST /api/agents/trigger resolves the tenant server-side and forwards to
   *  agent-server's POST /jobs/boss. The office lights up on the next poll, not here: we
   *  don't fake a "working" state before pg-boss has actually picked the job up. */
  const runTeam = async () => {
    if (running) return;
    setRunning(true);
    setRunMsg(null);
    try {
      const res = await fetch("/api/agents/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "boss", count: 3 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Trigger failed (status ${res.status})`);
      setRunMsg("Mr Lxwa is planning topics — watch the office.");
      store?.toast?.("Team started — Mr Lxwa is planning topics.");
      poll();
    } catch (e: any) {
      setRunMsg(e?.message ?? "Could not start the team.");
    } finally {
      setRunning(false);
    }
  };

  const fmt = (key: keyof Stats, v: number) => (key === "successRate" ? `${v}%` : v);

  return (
    <div className="dash-wrap">
      {/* Office first: it is the point of this screen. The counters used to sit on top and
          push it down — they're a summary, so they read better underneath it. */}
      <div className="dash-bar">
        <button className="runbtn" onClick={runTeam} disabled={running}>
          {running ? "Starting…" : "▶ Run the team"}
        </button>
        <span className="barnote">
          {liveErr
            ? <span className="err">{liveErr}</span>
            : runMsg ?? "Live — the office shows what each agent is doing right now."}
        </span>
      </div>

      <div className="dash-office">
        <Office solo={selected} onSelect={setSelected} />
        {selected && <AgentPanel id={selected} onClose={() => setSelected(null)} />}
      </div>

      <div className="dash-stats">
        {CARDS.map(([key, ico, label, accent], i) => (
          <div key={key} className="dstat" style={{ animationDelay: `${0.02 + i * 0.04}s` }}>
            <span className="dstat-ic" style={{ color: accent, background: `color-mix(in srgb, ${accent} 14%, transparent)` }}>{ico}</span>
            <div style={{ minWidth: 0 }}>
              <div className="v">{stats ? fmt(key, stats[key]) : "—"}</div>
              <div className="l">{label}</div>
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .dash-wrap { position: absolute; inset: 0; display: flex; flex-direction: column; }
        .dash-stats { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;
                      padding: 0 clamp(14px, 2.4vw, 26px) clamp(14px, 2.4vw, 22px); flex: none; }
        .dstat { background: var(--panel); border: 1px solid var(--line); border-radius: 11px;
                 padding: 11px 12px; display: flex; align-items: center; gap: 10px; min-width: 0;
                 transition: transform .2s, border-color .2s;
                 opacity: 0; animation: dstat-rise .55s cubic-bezier(.2,.7,.3,1) forwards; }
        .dstat:hover { transform: translateY(-3px); border-color: var(--line2); }
        .dstat-ic { width: 33px; height: 33px; border-radius: 9px; flex: none;
                    display: grid; place-items: center; font-size: 15px; }
        .v { font-size: 18px; font-weight: 800; line-height: 1.05; color: var(--ink); }
        .l { font-size: 10.5px; color: var(--mut); margin-top: 3px; font-weight: 500;
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        @keyframes dstat-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

        .dash-bar { display: flex; align-items: center; gap: 12px; flex: none;
                    padding: 14px clamp(14px, 2.4vw, 26px) 10px; min-width: 0; }
        .runbtn { flex: none; border: 1px solid var(--ac); background: var(--ac); color: #fff;
                  font-size: 12px; font-weight: 700; padding: 8px 14px; border-radius: 9px;
                  cursor: pointer; transition: background .18s, transform .18s, opacity .18s; }
        .runbtn:hover:not(:disabled) { background: var(--ac-d); transform: translateY(-1px); }
        .runbtn:disabled { opacity: .6; cursor: default; }
        .barnote { font-size: 11px; color: var(--mut); min-width: 0; overflow: hidden;
                   text-overflow: ellipsis; white-space: nowrap; }
        .err { color: var(--amb); }

        .dash-office { flex: 1; position: relative; min-height: 0;
                       margin: 0 clamp(14px, 2.4vw, 26px) clamp(12px, 1.6vw, 16px);
                       border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
                       background: var(--bg2); }

        @media (max-width: 1400px) { .dash-stats { grid-template-columns: repeat(4, 1fr); } }
        @media (max-width: 860px) {
          .dash-wrap { position: relative; inset: auto; height: 100%; }
          .dash-stats { grid-template-columns: repeat(2, 1fr); padding: 0 14px 14px; }
          .dash-bar { padding: 12px 14px 10px; }
          .dash-office { margin: 0 14px 12px; min-height: 340px; }
        }
      `}</style>
    </div>
  );
}
