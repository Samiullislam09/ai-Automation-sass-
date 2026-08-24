"use client";
/** Dashboard root — the 2D isometric office (components/Office.tsx) plus the real stat row.
 *
 *  LIVE WIRING: the polling itself lives in components/LiveAgents.tsx (mounted once in
 *  app/app/layout.tsx) so the office, this stat row and the chat all read the same server
 *  truth. This page just renders what the store holds: a working agent's room is lit, everyone
 *  else is asleep with the lights off, and a finished job pops a receipt over the room that
 *  did it. Nothing here invents activity.
 *
 *  Clicking a room hands the whole screen to that one agent (components/AgentStage.tsx).
 *
 *  "Run the team" enqueues a real boss job (agent-server/src/agents/boss.ts) which plans
 *  topics from the tenant's own niche/crawled pages and starts boss → keyword → writer.
 *
 *  The pixel-art "AI Command Center" build that briefly lived here is still in the repo at
 *  components/dashboard/AICommandCenter.tsx; it is simply not routed. */
import { useState } from "react";
import Office from "@/components/Office";
import AgentStage from "@/components/AgentStage";
import { useStore } from "@/lib/store";

type Stats = {
  totalAgents: number; liveAgents: number; working: number; waiting: number;
  errorsToday: number; tasksCompleted: number; successRate: number; pagesIndexed: number;
};

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

export default function Dashboard() {
  const store = useStore();
  const stats: Stats | null = (store?.s?.stats as Stats) ?? null;
  const liveErr: string | null = store?.s?.liveError ?? null;
  const flash = store?.s?.flash ?? null;

  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  // Which room the user clicked: the office fades everyone else out and that agent's real
  // work takes over the screen. null = the whole office.
  const [selected, setSelected] = useState<string | null>(null);

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
    } catch (e: any) {
      setRunMsg(e?.message ?? "Could not start the team.");
    } finally {
      setRunning(false);
    }
  };

  const fmt = (key: keyof Stats, v: number) => (key === "successRate" ? `${v}%` : v);

  return (
    <div className="dash-wrap">
      {/* Office first: it is the point of this screen. The counters are a summary, so they
          read better underneath it. */}
      <div className="dash-bar">
        <button className="runbtn" onClick={runTeam} disabled={running}>
          {running ? "Starting…" : "▶ Run the team"}
        </button>
        <span className="barnote">
          {liveErr
            ? <span className="err">{liveErr}</span>
            : runMsg ?? "Live — click any agent to watch what it is doing."}
        </span>
      </div>

      <div className="dash-office">
        <Office solo={selected} onSelect={setSelected} flash={flash} />
        {selected && <AgentStage id={selected} onClose={() => setSelected(null)} />}
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

        /* The office must never be cropped: the SVG inside uses preserveAspectRatio="meet",
           and this frame keeps enough height for the whole scene to fit. */
        .dash-office { flex: 1; position: relative; min-height: 300px;
                       margin: 0 clamp(14px, 2.4vw, 26px) clamp(12px, 1.6vw, 16px);
                       border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
                       background: var(--bg2); }

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
