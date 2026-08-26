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
import { useEffect, useState } from "react";
import Office from "@/components/Office";
import AgentStage from "@/components/AgentStage";
import Celebration from "@/components/Celebration";
import KeywordChoice from "@/components/KeywordChoice";
import { setSoundEnabled, soundEnabled } from "@/lib/chime";
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
  const celebrating = !!store?.s?.celebration;
  // The keyword table belongs where the team is, not floating over it. Same treatment as a
  // finished job: the office fades back and the thing that needs you fills the space.
  const choosing = !!store?.s?.keywordChoice && !celebrating;

  // localStorage is browser-only, so it is read after mount — reading it during render would
  // make the server and the client disagree about the button's state.
  const [sound, setSound] = useState(false);
  useEffect(() => { setSound(soundEnabled()); }, []);
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    // Play it once on the way ON, both as confirmation and because the first tone is what
    // unlocks the AudioContext — browsers only allow that inside a real click.
    if (next) import("@/lib/chime").then((m) => m.playSuccess());
  };

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
      // The job really was accepted — it came back with an id. Telling the store now is what
      // lights Mr Lxwa's room and writes the first line of the run log immediately, instead
      // of the office standing still until the next poll finds a jobs_log row. It is dropped
      // again the moment that row arrives (components/LiveAgents.tsx).
      store?.startRun?.("boss", "Planning this week's topics", data.jobId ?? null);
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
      {/* The office owns the first screen: nothing above it, nothing cropping it. Scroll for
          the counters and the controls. */}
      <div className="dash-office">
        {/* The office fades back rather than unmounting: it keeps the room states and the
            camera exactly where they were, so dismissing the card returns you to the same
            scene instead of a re-entry animation. */}
        <div className={"dash-scene" + (celebrating || choosing ? " is-hidden" : "")}>
          <Office solo={selected} onSelect={setSelected} flash={flash} />
          {selected && <AgentStage id={selected} onClose={() => setSelected(null)} />}
        </div>
        <Celebration />
        {choosing && <KeywordChoice />}
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

      <div className="dash-bar">
        <button className="runbtn" onClick={runTeam} disabled={running}>
          {running ? "Starting…" : "▶ Run the team"}
        </button>
        <button className={"soundbtn" + (sound ? " is-on" : "")} onClick={toggleSound}
          title={sound ? "Sound on — an agent finishing plays a chime" : "Sound off"}>
          {sound ? "🔊 Sound on" : "🔇 Sound off"}
        </button>
        <span className="barnote">
          {liveErr
            ? <span className="err">{liveErr}</span>
            : runMsg ?? "Click any agent in the office to watch what it is doing."}
        </span>
      </div>

      <style jsx>{`
        /* The office fills the first viewport; everything else is below the fold. --topbar is
           the /app header's height (app/app/layout.tsx), so the frame lands exactly on the
           fold instead of guessing. dvh, not vh, so mobile browser chrome can't crop it. */
        .dash-wrap { display: flex; flex-direction: column; min-height: 100%; }

        .dash-office { position: relative; flex: none;
                       height: calc(100dvh - var(--topbar, 60px) - 28px);
                       min-height: 360px;
                       margin: 14px clamp(12px, 2.2vw, 24px) 0;
                       border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
                       background: var(--bg2); }

        /* Seven cards in a five-column grid left two of them stretched across a second row at
           double width — the "random, misaligned" thing you could not stop looking at. auto-fill
           keeps every card on the same track width at every viewport, so a partial last row
           still lines up with the one above it. */
        .dash-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
                      gap: 10px; padding: 14px clamp(12px, 2.2vw, 24px) 0; flex: none;
                      align-items: stretch; }
        .dstat { background: var(--panel); border: 1px solid var(--line); border-radius: 11px;
                 padding: 11px 12px; display: flex; align-items: center; gap: 10px; min-width: 0;
                 transition: transform .2s, border-color .2s;
                 opacity: 0; animation: dstat-rise .55s cubic-bezier(.2,.7,.3,1) forwards; }
        @media (prefers-reduced-motion: reduce) { .dstat { opacity: 1; animation: none; } }
        .dstat:hover { transform: translateY(-3px); border-color: var(--line2); }
        .dstat-ic { width: 33px; height: 33px; border-radius: 9px; flex: none;
                    display: grid; place-items: center; font-size: 15px; }
        .v { font-size: 18px; font-weight: 800; line-height: 1.05; color: var(--ink); }
        .l { font-size: 10.5px; color: var(--mut); margin-top: 3px; font-weight: 500;
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        @keyframes dstat-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

        .dash-bar { display: flex; align-items: center; gap: 12px; flex: none; flex-wrap: wrap;
                    padding: 14px clamp(12px, 2.2vw, 24px) clamp(16px, 2.2vw, 24px); min-width: 0; }
        .runbtn { flex: none; border: 1px solid var(--ac); background: var(--ac); color: #fff;
                  font-size: 12px; font-weight: 700; padding: 9px 15px; border-radius: 9px;
                  cursor: pointer; transition: background .18s, transform .18s, opacity .18s; }
        .runbtn:hover:not(:disabled) { background: var(--ac-d); transform: translateY(-1px); }
        .runbtn:disabled { opacity: .6; cursor: default; }
        .dash-scene { position: absolute; inset: 0; transition: opacity .35s ease, transform .35s ease; }
        .dash-scene.is-hidden { opacity: 0; transform: scale(.985); pointer-events: none; }

        .soundbtn { flex: none; border: 1px solid var(--line2); background: var(--panel);
                    color: var(--mut); font-size: 11.5px; font-weight: 600; padding: 8px 12px;
                    border-radius: 9px; cursor: pointer; transition: color .18s, border-color .18s; }
        .soundbtn:hover { color: var(--ink); border-color: var(--mut2); }
        .soundbtn.is-on { color: var(--ac); border-color: var(--ac); }

        .barnote { font-size: 11px; color: var(--mut); min-width: 0; flex: 1;
                   overflow: hidden; text-overflow: ellipsis; }
        .err { color: var(--amb); }

        @media (max-width: 720px) {
          .dash-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 12px 12px 0; gap: 8px; }
          .dstat { padding: 10px; gap: 8px; }
          .dstat-ic { width: 29px; height: 29px; font-size: 13px; }
          .v { font-size: 16px; }
          .dash-office { height: calc(100dvh - var(--topbar, 56px) - 24px); min-height: 320px;
                         margin: 12px 12px 0; }
          .dash-bar { padding: 12px; }
          .barnote { flex: 1 0 100%; white-space: normal; }
        }
      `}</style>
    </div>
  );
}
