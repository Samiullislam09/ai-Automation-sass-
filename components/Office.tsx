"use client";
import React, { useEffect, useRef, useState } from "react";
import { AGENTS, useStore, type AgentState } from "@/lib/store";

/** Animated 2D office — SVG rooms on a light sky, camera pans/zooms to whichever
 *  agent is relevant (click a room, or mention that agent in chat — store.s.focusAgent
 *  drives it via store.focusOn()). Camera transform is applied imperatively via refs
 *  (measured container pixels), matching the technique proven in the reference build. */

// 3-row layout matching the "AI Command Center" reference: 3 rooms flanking the (bigger)
// Orchestrator on top, then two 5-room rows below. Purely data-driven — the render loop,
// connection tubes, and chai-wala's idle-room picker all iterate AGENTS/ROOMS already, so
// adding entries here is the only change needed to grow the office.
const ROOMS: Record<string, { cx: number; cy: number; w: number; h: number }> = {
  kw:        { cx: 230, cy: 170, w: 210, h: 160 },
  boss:      { cx: 600, cy: 170, w: 320, h: 200 },
  writer:    { cx: 970, cy: 170, w: 210, h: 160 },
  image:     { cx: 150, cy: 430, w: 190, h: 150 },
  seo:       { cx: 375, cy: 430, w: 190, h: 150 },
  social:    { cx: 600, cy: 430, w: 190, h: 150 },
  reply:     { cx: 825, cy: 430, w: 190, h: 150 },
  email:     { cx: 1050, cy: 430, w: 190, h: 150 },
  analytics: { cx: 150, cy: 680, w: 190, h: 150 },
  story:     { cx: 375, cy: 680, w: 190, h: 150 },
  qa:        { cx: 600, cy: 680, w: 190, h: 150 },
  publish:   { cx: 825, cy: 680, w: 190, h: 150 },
  backup:    { cx: 1050, cy: 680, w: 190, h: 150 },
};
const STALL = { cx: 600, cy: 870 };
const VB_W = 1200, VB_H = 960;
const CLOUDS = [[120, 70, 1.1], [520, 45, 0.8], [900, 100, 1.3], [300, 140, 0.7], [1050, 170, 0.9]];

const BOSS_LINES = [
  "Mr. Writer, blueprint aa raha hai…",
  "Team status: sab on track ✓",
  "Miss Social, distribution ready rakho",
  "Mr. SEO, aaj ka audit?",
];

/** Free-text → agent id, so the chat widget knows which room to focus the camera on. */
export function agentIdFromText(text: string): string | null {
  const l = text.toLowerCase();
  if (/\bwriter\b|\barticle\b|\blikho\b|\bwrite\b/.test(l)) return "writer";
  if (/\bkeyword\b|\bresearch\b|\branking\b/.test(l)) return "kw";
  if (/\bimage\b|\bphoto\b|\bgraphic\b/.test(l)) return "image";
  if (/\bstory\b|\bvisual\b|\bdesign\b/.test(l)) return "story";
  if (/\bsocial\b|\bpost\b|\binstagram\b|\bfacebook\b|\blinkedin\b/.test(l)) return "social";
  if (/\breply\b|\bcomment\b/.test(l)) return "reply";
  if (/\bemail\b|\boutreach\b/.test(l)) return "email";
  if (/\banalytics\b|\bstats\b|\btraffic\b/.test(l)) return "analytics";
  if (/\bqa\b|\bquality\b|\breview\b/.test(l)) return "qa";
  if (/\bpublish\b|\bwordpress\b/.test(l)) return "publish";
  if (/\bbackup\b/.test(l)) return "backup";
  if (/\bseo\b|\baudit\b|\bsite\b/.test(l)) return "seo";
  if (/\blxwa\b|\bboss\b|\bmain ai\b|\borchestrat/.test(l)) return "boss";
  return null;
}

function Cloud({ x, y, s, i }: { x: number; y: number; s: number; i: number }) {
  return (
    <g className="office-cloud" style={{ animationDelay: `${i * -9}s`, ["--y" as any]: `${y}px`, transformOrigin: `${x}px ${y}px` }} transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx="0" cy="0" rx="46" ry="18" fill="#fff" opacity="0.9" />
      <ellipse cx="-26" cy="6" rx="28" ry="14" fill="#fff" opacity="0.85" />
      <ellipse cx="28" cy="7" rx="30" ry="15" fill="#fff" opacity="0.85" />
      <ellipse cx="4" cy="-10" rx="24" ry="16" fill="#fff" opacity="0.95" />
    </g>
  );
}
function plant() {
  return (
    <g>
      <ellipse cx="0" cy="16" rx="9" ry="3" fill="#1c2540" opacity="0.14" />
      <rect x="-7" y="5" width="14" height="11" rx="2" fill="#8a5a3c" />
      <ellipse cx="0" cy="-4" rx="14" ry="16" fill="#3fa06b" />
      <ellipse cx="-5" cy="-9" rx="8" ry="10" fill="#4db67d" />
    </g>
  );
}
function bookshelf() {
  const cols = ["#3672e0", "#e0538e", "#2fa563", "#e08a3c"];
  return (
    <g>
      <rect x="-20" y="-18" width="40" height="36" rx="3" fill="#8a5a3c" />
      {cols.map((c, i) => <rect key={i} x={-17 + i * 9.5} y="-14" width="7" height="28" fill={c} />)}
    </g>
  );
}
function Character({ color, working }: { color: string; working: boolean }) {
  return (
    <g className={"office-char" + (working ? " is-working" : "")}>
      <ellipse cx="0" cy="34" rx="17" ry="5" fill="#1c2540" opacity="0.18" />
      <g className="office-char-bob">
        <rect x="-13" y="4" width="26" height="26" rx="9" fill={color} />
        <rect x="-13" y="4" width="26" height="9" rx="7" fill="#fff" opacity="0.22" />
        <circle cx="0" cy="-8" r="14" fill="#f5cba0" />
        <path d="M -14 -9 Q -14 -24 0 -24 Q 14 -24 14 -9 Q 14 -15 0 -16 Q -14 -15 -14 -9 Z" fill="#332822" />
        <circle cx="-5" cy="-7" r="1.4" fill="#241c1a" /><circle cx="5" cy="-7" r="1.4" fill="#241c1a" />
        <path d="M -4 0 Q 0 2.5 4 0" stroke="#241c1a" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </g>
    </g>
  );
}
function Desk({ working }: { working: boolean }) {
  return (
    <g transform="translate(0,26)">
      <rect x="-42" y="2" width="84" height="13" rx="4" fill="#5c4531" />
      <rect x="-42" y="-2" width="84" height="8" rx="4" fill="#6f5540" />
      <rect x="-36" y="12" width="7" height="16" fill="#4a3628" /><rect x="29" y="12" width="7" height="16" fill="#4a3628" />
      <rect x="-20" y="-26" width="40" height="27" rx="4" fill="#212a40" stroke="#4a5c82" strokeWidth="2" />
      <rect x="-16" y="-22" width="32" height="18" rx="2" fill={working ? "#123832" : "#161c2c"} />
      {working && (
        <g opacity="0.9">
          <rect x="-13" y="-18" width="20" height="2" fill="var(--blu)" opacity="0.9" />
          <rect x="-13" y="-14" width="14" height="2" fill="var(--blu)" opacity="0.6" />
          <rect x="-13" y="-10" width="17" height="2" fill="var(--blu)" opacity="0.45" />
        </g>
      )}
      <rect x="16" y="8" width="12" height="8" rx="1.5" fill="#efe6d4" opacity="0.9" />
      <circle cx="-24" cy="9" r="3" fill="#c9573f" opacity="0.9" />
    </g>
  );
}
function RoomTag({ name, task, st }: { name: string; task: string; st: AgentState["st"] }) {
  // "e" = a real failed job (jobs_log status 'error'), surfaced so a broken agent does not
  // look identical to an idle one.
  const dot = st === "w" ? "var(--grn)" : st === "e" ? "var(--red)" : st === "i" ? "var(--amb)" : "var(--mut2)";
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 9, padding: "5px 11px", whiteSpace: "nowrap", boxShadow: "0 6px 16px #00000033" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, boxShadow: st !== "o" ? `0 0 6px ${dot}` : "none", flex: "none" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>{name}</span>
        <span style={{ fontSize: 9.5, color: "var(--mut)" }}>{task}</span>
      </div>
    </div>
  );
}

export default function Office({ demo = false }: { demo?: boolean }) {
  const store = useStore();
  // Demo/landing-page state — live agents get a "working" flavor task, roadmap (non-live)
  // agents show "Coming soon" so the demo doesn't pretend an unbuilt agent is running.
  const FAKE_TASKS: Record<string, string> = {
    boss: "Orchestrating", kw: "Searching keywords…", writer: "Writing article…", seo: "Analyzing SEO…",
    social: "Scheduling posts…", qa: "Reviewing content…", publish: "Publishing to WordPress…",
  };
  const FAKE = React.useMemo(() => Object.fromEntries(AGENTS.map((a) => [
    a.id,
    a.live
      ? { st: (FAKE_TASKS[a.id] ? "w" : "i") as AgentState["st"], task: FAKE_TASKS[a.id] ?? "Idle" }
      : { st: "o" as const, task: "Coming soon" },
  ])), []);
  const agents = demo || !store ? FAKE : store.s.agents;
  const active = demo ? null : store?.s.focusAgent ?? null;

  const [localFocus, setLocalFocus] = useState<string | null>(null);
  const shownFocus = demo ? localFocus : active;

  const [bubble, setBubble] = useState(BOSS_LINES[0]);
  const [showBub, setShowBub] = useState(false);
  const [chai, setChai] = useState({ cx: STALL.cx, cy: STALL.cy, say: false });

  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);

  // Camera — imperative transform on the world div, computed from the container's
  // actual measured pixel size (same technique proven in the reference build).
  useEffect(() => {
    const stage = stageRef.current, world = worldRef.current;
    if (!stage || !world) return;
    const id = shownFocus;
    if (!id || !ROOMS[id]) {
      world.style.transformOrigin = "50% 50%";
      world.style.transform = "translate(0,0) scale(1)";
      return;
    }
    const a = ROOMS[id];
    const scale = id === "boss" ? 1.7 : 1.95;
    const w = stage.clientWidth, h = stage.clientHeight;
    const s = Math.min(w / VB_W, h / VB_H);
    const offX = (w - VB_W * s) / 2, offY = (h - VB_H * s) / 2;
    const Px = offX + a.cx * s, Py = offY + a.cy * s;
    world.style.transformOrigin = `${Px}px ${Py}px`;
    world.style.transform = `translate(${w / 2 - Px}px, ${h / 2 - Py}px) scale(${scale})`;
  }, [shownFocus]);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => { setBubble(BOSS_LINES[i++ % BOSS_LINES.length]); setShowBub(true); setTimeout(() => setShowBub(false), 3200); }, 6500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const round = () => {
      const idle = Object.keys(ROOMS).filter(id => id !== "boss" && agents[id]?.st === "i");
      if (!idle.length) return;
      const r = ROOMS[idle[Math.floor(Math.random() * idle.length)]];
      setChai({ cx: r.cx, cy: r.cy + r.h / 2 - 6, say: false });
      setTimeout(() => setChai(c => ({ ...c, say: true })), 2000);
      setTimeout(() => setChai(c => ({ ...c, say: false })), 3800);
      setTimeout(() => setChai({ cx: STALL.cx, cy: STALL.cy, say: false }), 4300);
    };
    const t = setInterval(round, 12000); const t0 = setTimeout(round, 2500);
    return () => { clearInterval(t); clearTimeout(t0); };
  }, [agents]);

  const clickRoom = (id: string) => {
    if (demo) { setLocalFocus(f => (f === id ? null : id)); return; }
    if (!store) return;
    store.focusOn(store.s.focusAgent === id ? null : id, 0); // 0 = pinned until clicked again
  };
  const clickBackground = () => {
    if (demo) { setLocalFocus(null); return; }
    store?.focusOn(null);
  };

  return (
    <div ref={stageRef} className="office2d" style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "linear-gradient(180deg, var(--bg2) 0%, var(--bg) 55%, var(--panel) 100%)", cursor: shownFocus ? "zoom-out" : "default" }} onClick={clickBackground}>
      <div ref={worldRef} style={{ position: "absolute", inset: 0, transition: "transform 1.1s cubic-bezier(.5,0,.15,1)", willChange: "transform" }}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" style={{ display: "block", position: "absolute", inset: 0 }} preserveAspectRatio="xMidYMid slice">
          <defs>
            <radialGradient id="bossglow" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#c7e6ff" /><stop offset="45%" stopColor="var(--blu)" /><stop offset="100%" stopColor="var(--blu)" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sunglow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff8e0" stopOpacity="0.95" /><stop offset="100%" stopColor="#fff8e0" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx="1080" cy="70" r="60" fill="url(#sunglow)" />
          {CLOUDS.map((c, i) => <Cloud key={i} x={c[0]} y={c[1]} s={c[2]} i={i} />)}

          {/* connection tubes from Mr Lxwa to every room */}
          {AGENTS.filter(a => a.id !== "boss").map(a => {
            const b = ROOMS.boss, r = ROOMS[a.id];
            const mx = (b.cx + r.cx) / 2, my = (b.cy + r.cy) / 2 - 30;
            const d = `M ${b.cx} ${b.cy} Q ${mx} ${my} ${r.cx} ${r.cy}`;
            return (
              <g key={a.id}>
                <path d={d} fill="none" stroke="#5fb3e0" strokeWidth="3" opacity="0.35" />
                <circle r="3" fill="var(--blu)" opacity="0.85"><animateMotion dur={`${3 + Math.random() * 2}s`} repeatCount="indefinite" path={d} /></circle>
              </g>
            );
          })}

          {/* rooms */}
          {AGENTS.map(a => {
            const r = ROOMS[a.id]; const st = agents[a.id] || { st: "i", task: "Idle" };
            const isBoss = a.id === "boss";
            const dim = st.st === "o" ? 0.55 : 1;
            return (
              <g key={a.id} onClick={e => { e.stopPropagation(); clickRoom(a.id); }} style={{ cursor: "pointer" }}>
                <ellipse cx={r.cx} cy={r.cy + r.h / 2 + 10} rx={r.w / 2 + 14} ry="13" fill="#1c2540" opacity="0.14" />
                <rect x={r.cx - r.w / 2} y={r.cy - r.h / 2} width={r.w} height={r.h} rx="22"
                  fill={isBoss ? "var(--panel2)" : "var(--panel)"} stroke={a.c} strokeOpacity={st.st === "w" || st.st === "e" ? 0.85 : 0.4} strokeWidth="2.5"
                  opacity={dim} style={{ transition: "opacity .4s, stroke-opacity .4s" }} />
                <rect x={r.cx - r.w / 2} y={r.cy - r.h / 2} width={r.w} height={r.h * 0.35} rx="22" fill="var(--line)" opacity={dim * 0.35} />

                {isBoss ? (
                  <g transform={`translate(${r.cx},${r.cy})`}>
                    <circle r="66" fill="url(#bossglow)" className="office-orb-glow" />
                    <circle r="42" fill="none" stroke="var(--blu)" strokeWidth="1.5" opacity="0.55" className="office-ring" />
                    <circle r="30" fill="none" stroke="var(--blu)" strokeWidth="1" opacity="0.4" strokeDasharray="4 6" className="office-ring2" />
                    <circle r="20" fill="var(--panel2)" stroke="var(--blu)" strokeWidth="1.5" className="office-core" />
                    <text y="6" textAnchor="middle" fontSize="18">🧠</text>
                    {showBub && (
                      <foreignObject x="-140" y={-r.h / 2 - 62} width="280" height="46">
                        <div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} style={{ display: "flex", justifyContent: "center" }}>
                          <div style={{ background: "var(--panel2)", color: "var(--ink)", fontSize: 11, fontWeight: 600, padding: "8px 12px", borderRadius: "12px 12px 12px 3px", boxShadow: "0 10px 24px #00000066" }}>{bubble}</div>
                        </div>
                      </foreignObject>
                    )}
                  </g>
                ) : (
                  <>
                    <g transform={`translate(${r.cx - r.w / 2 + 30},${r.cy - r.h / 2 + 34}) scale(0.85)`} opacity={dim * 0.9}>{plant()}</g>
                    <g transform={`translate(${r.cx + r.w / 2 - 30},${r.cy - r.h / 2 + 30}) scale(0.75)`} opacity={dim * 0.9}>{bookshelf()}</g>
                    <g transform={`translate(${r.cx},${r.cy + r.h / 2 - 46})`} opacity={dim} style={{ transition: "opacity .4s" }}>
                      <Desk working={st.st === "w"} />
                      <g transform="translate(0,-58)"><Character color={a.c} working={st.st === "w"} /></g>
                    </g>
                  </>
                )}

                {st.st === "o" && (
                  <text x={r.cx + r.w / 2 - 26} y={r.cy - r.h / 2 + 24} fontSize="13" fontWeight="800" fill="#93a0bd">Z z z</text>
                )}

                <foreignObject x={r.cx - 100} y={r.cy - r.h / 2 - 34} width="200" height="30">
                  <RoomTag name={a.name} task={st.task} st={st.st} />
                </foreignObject>
              </g>
            );
          })}

          {/* chai stall + walking character */}
          <g>
            <ellipse cx={STALL.cx} cy={STALL.cy + 50} rx="70" ry="12" fill="#1c2540" opacity="0.12" />
            <rect x={STALL.cx - 66} y={STALL.cy - 40} width="132" height="88" rx="16" fill="#fff7ec" stroke="#e08a3c" strokeOpacity="0.5" strokeWidth="2" />
            <text x={STALL.cx} y={STALL.cy - 48} textAnchor="middle" fontSize="12" fontWeight="800" fill="#a4611c">☕ Chacha&apos;s Chai</text>
            <text x={STALL.cx} y={STALL.cy + 14} textAnchor="middle" fontSize="24">🫖</text>
          </g>
          <g style={{ transition: "transform 1.6s cubic-bezier(.45,.05,.55,.95)", transform: `translate(${chai.cx}px,${chai.cy}px)` }}>
            <ellipse cx="0" cy="20" rx="11" ry="3.5" fill="#1c2540" opacity="0.18" />
            <rect x="-9" y="0" width="18" height="18" rx="7" fill="#e08a3c" />
            <circle cx="0" cy="-9" r="10" fill="#f0c090" />
            {chai.say && (
              <foreignObject x="-70" y="-42" width="140" height="26">
                <div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} style={{ display: "flex", justifyContent: "center" }}>
                  <div style={{ background: "var(--panel2)", color: "var(--amb)", fontSize: 10, fontWeight: 700, padding: "4px 9px", borderRadius: 8 }}>Chai garam! ☕</div>
                </div>
              </foreignObject>
            )}
          </g>
        </svg>
      </div>

      <div style={{ position: "absolute", left: 18, top: 16, pointerEvents: "none", zIndex: 2 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--grn)", boxShadow: "0 0 8px var(--grn)" }} className="office-pulse-dot" />
          Your office — live
        </div>
        <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 2 }}>{shownFocus ? "Click anywhere to zoom out" : "Click a room to zoom · ask Mr Lxwa about anyone"}</div>
      </div>

      <style jsx global>{`
        .office2d .office-char.is-working .office-char-bob { animation: office-bob .76s ease-in-out infinite; transform-origin: center bottom; }
        @keyframes office-bob { 0%,100%{ transform: translateY(0); } 50%{ transform: translateY(-2px); } }
        .office-orb-glow { animation: office-glow 3s ease-in-out infinite; transform-origin: center; }
        @keyframes office-glow { 50%{ transform: scale(1.08); opacity: .85; } }
        .office-ring { animation: office-rot 10s linear infinite; transform-origin: center; }
        .office-ring2 { animation: office-rot 14s linear infinite reverse; transform-origin: center; }
        @keyframes office-rot { to{ transform: rotate(360deg); } }
        .office-core { animation: office-core-pulse 2.6s ease-in-out infinite; transform-origin: center; }
        @keyframes office-core-pulse { 50%{ transform: scale(1.1); } }
        .office-cloud { animation: office-drift 90s linear infinite; }
        @keyframes office-drift { from{ transform: translate(-60px, var(--y, 0px)); } to{ transform: translate(1320px, var(--y, 0px)); } }
        .office-pulse-dot { animation: office-pulse 2s infinite; }
        @keyframes office-pulse { 50%{ opacity: .4; } }
        @media (prefers-reduced-motion: reduce) {
          .office2d * { animation: none !important; transition: none !important; }
        }
      `}</style>
    </div>
  );
}
