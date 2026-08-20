"use client";
import React, { useEffect, useRef, useState } from "react";
import { AGENTS, useStore } from "@/lib/store";

/** Animated 2D office — SVG rooms, camera pans/zooms to whichever agent is relevant
 *  (click a room, or mention that agent in chat — store.s.focusAgent drives it via
 *  store.focusOn()). Camera transform is applied imperatively via refs (measured
 *  container pixels), matching the technique proven in the reference build. */

const ROOMS: Record<string, { cx: number; cy: number; w: number; h: number }> = {
  kw:     { cx: 230, cy: 200, w: 210, h: 160 },
  boss:   { cx: 600, cy: 190, w: 300, h: 190 },
  writer: { cx: 970, cy: 200, w: 210, h: 160 },
  story:  { cx: 230, cy: 500, w: 210, h: 160 },
  social: { cx: 600, cy: 510, w: 210, h: 160 },
  seo:    { cx: 970, cy: 500, w: 210, h: 160 },
};
const STALL = { cx: 600, cy: 660 };
const VB_W = 1200, VB_H = 720;

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
  if (/\bstory\b|\bvisual\b|\bimage\b|\bdesign\b/.test(l)) return "story";
  if (/\bsocial\b|\bpost\b|\binstagram\b|\bfacebook\b|\blinkedin\b/.test(l)) return "social";
  if (/\bseo\b|\baudit\b|\bsite\b/.test(l)) return "seo";
  if (/\blxwa\b|\bboss\b|\bmain ai\b|\borchestrat/.test(l)) return "boss";
  return null;
}

function plant() {
  return (
    <g>
      <ellipse cx="0" cy="16" rx="9" ry="3" fill="#000" opacity="0.18" />
      <rect x="-7" y="5" width="14" height="11" rx="2" fill="#6b4a30" />
      <ellipse cx="0" cy="-4" rx="14" ry="16" fill="#2fa563" />
      <ellipse cx="-5" cy="-9" rx="8" ry="10" fill="#3fbf78" />
    </g>
  );
}
function bookshelf() {
  const cols = ["#6ea8ff", "#ff8fb3", "#7ee787", "#ffb95e"];
  return (
    <g>
      <rect x="-20" y="-18" width="40" height="36" rx="3" fill="#3a2a1e" />
      {cols.map((c, i) => <rect key={i} x={-17 + i * 9.5} y="-14" width="7" height="28" fill={c} />)}
    </g>
  );
}
function Character({ color, working }: { color: string; working: boolean }) {
  return (
    <g className={"office-char" + (working ? " is-working" : "")}>
      <ellipse cx="0" cy="34" rx="17" ry="5" fill="#000" opacity="0.28" />
      <g className="office-char-bob">
        <rect x="-13" y="4" width="26" height="26" rx="9" fill={color} />
        <rect x="-13" y="4" width="26" height="9" rx="7" fill="#fff" opacity="0.18" />
        <circle cx="0" cy="-8" r="14" fill="#f0c090" />
        <path d="M -14 -9 Q -14 -24 0 -24 Q 14 -24 14 -9 Q 14 -15 0 -16 Q -14 -15 -14 -9 Z" fill="#2a2118" />
        <circle cx="-5" cy="-7" r="1.4" fill="#241c1a" /><circle cx="5" cy="-7" r="1.4" fill="#241c1a" />
        <path d="M -4 0 Q 0 2.5 4 0" stroke="#241c1a" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </g>
    </g>
  );
}
function Desk({ working }: { working: boolean }) {
  return (
    <g transform="translate(0,26)">
      <rect x="-42" y="2" width="84" height="13" rx="4" fill="#4a3628" />
      <rect x="-42" y="-2" width="84" height="8" rx="4" fill="#5c4531" />
      <rect x="-36" y="12" width="7" height="16" fill="#3a2a1e" /><rect x="29" y="12" width="7" height="16" fill="#3a2a1e" />
      <rect x="-20" y="-26" width="40" height="27" rx="4" fill="#0d1322" stroke="#3a4c74" strokeWidth="2" />
      <rect x="-16" y="-22" width="32" height="18" rx="2" fill={working ? "#0e3830" : "#131a2c"} />
      {working && (
        <g opacity="0.9">
          <rect x="-13" y="-18" width="20" height="2" fill="#4fe3c1" opacity="0.9" />
          <rect x="-13" y="-14" width="14" height="2" fill="#4fe3c1" opacity="0.6" />
          <rect x="-13" y="-10" width="17" height="2" fill="#4fe3c1" opacity="0.45" />
        </g>
      )}
      <rect x="16" y="8" width="12" height="8" rx="1.5" fill="#efe6d4" opacity="0.9" />
      <circle cx="-24" cy="9" r="3" fill="#c9573f" opacity="0.9" />
    </g>
  );
}
function RoomTag({ name, task, st }: { name: string; task: string; st: "w" | "i" | "o" }) {
  const dot = st === "w" ? "#4fe3c1" : st === "i" ? "#ffb95e" : "#5f6d8c";
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#0d1322f2", border: "1px solid #2c3c60", borderRadius: 9, padding: "5px 11px", whiteSpace: "nowrap", boxShadow: "0 6px 16px #00000055" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, boxShadow: st !== "o" ? `0 0 6px ${dot}` : "none", flex: "none" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#eef3fc" }}>{name}</span>
        <span style={{ fontSize: 9.5, color: "#8c9ab8" }}>{task}</span>
      </div>
    </div>
  );
}

export default function Office({ demo = false }: { demo?: boolean }) {
  const store = useStore();
  const FAKE = React.useMemo(() => Object.fromEntries(AGENTS.map((a, i) => [a.id, { st: (i === 5 ? "o" : i === 4 ? "i" : "w") as "w" | "i" | "o", task: ["Orchestrating", "Searching keywords…", "Writing article…", "Designing story…", "Idle — chai break", "Offline"][i] }])), []);
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
    <div ref={stageRef} className="office2d" style={{ position: "relative", width: "100%", aspectRatio: `${VB_W}/${VB_H}`, borderRadius: 16, overflow: "hidden", background: "radial-gradient(120% 100% at 50% 0%,#122036 0%,#0a0e18 60%,#070a12 100%)", cursor: shownFocus ? "zoom-out" : "default" }} onClick={clickBackground}>
      <div ref={worldRef} style={{ position: "absolute", inset: 0, transition: "transform 1.1s cubic-bezier(.5,0,.15,1)", willChange: "transform" }}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" style={{ display: "block", position: "absolute", inset: 0 }}>
          <defs>
            <radialGradient id="bossglow" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#d8fff5" /><stop offset="45%" stopColor="#4fe3c1" /><stop offset="100%" stopColor="#17a98c" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* connection tubes from Mr Lxwa to every room */}
          {AGENTS.filter(a => a.id !== "boss").map(a => {
            const b = ROOMS.boss, r = ROOMS[a.id];
            const mx = (b.cx + r.cx) / 2, my = (b.cy + r.cy) / 2 - 30;
            const d = `M ${b.cx} ${b.cy} Q ${mx} ${my} ${r.cx} ${r.cy}`;
            return (
              <g key={a.id}>
                <path d={d} fill="none" stroke="#22304f" strokeWidth="3" opacity="0.6" />
                <circle r="3" fill="#4fe3c1" opacity="0.85"><animateMotion dur={`${3 + Math.random() * 2}s`} repeatCount="indefinite" path={d} /></circle>
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
                <ellipse cx={r.cx} cy={r.cy + r.h / 2 + 10} rx={r.w / 2 + 14} ry="13" fill="#000" opacity="0.25" />
                <rect x={r.cx - r.w / 2} y={r.cy - r.h / 2} width={r.w} height={r.h} rx="22"
                  fill={isBoss ? "#101c30" : "#111a2e"} stroke={a.c} strokeOpacity={st.st === "w" ? 0.85 : 0.35} strokeWidth="2.5"
                  opacity={dim} style={{ transition: "opacity .4s, stroke-opacity .4s" }} />
                <rect x={r.cx - r.w / 2} y={r.cy - r.h / 2} width={r.w} height={r.h * 0.35} rx="22" fill="#ffffff" opacity={dim * 0.04} />

                {isBoss ? (
                  <g transform={`translate(${r.cx},${r.cy})`}>
                    <circle r="66" fill="url(#bossglow)" className="office-orb-glow" />
                    <circle r="42" fill="none" stroke="#4fe3c1" strokeWidth="1.5" opacity="0.5" className="office-ring" />
                    <circle r="30" fill="none" stroke="#4fe3c1" strokeWidth="1" opacity="0.4" strokeDasharray="4 6" className="office-ring2" />
                    <circle r="20" fill="#0f2c26" stroke="#4fe3c1" strokeWidth="1.5" className="office-core" />
                    <text y="6" textAnchor="middle" fontSize="18">🧠</text>
                    {showBub && (
                      <foreignObject x="-140" y={-r.h / 2 - 62} width="280" height="46">
                        <div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} style={{ display: "flex", justifyContent: "center" }}>
                          <div style={{ background: "#0d1322", color: "#eef3fc", fontSize: 11, fontWeight: 600, padding: "8px 12px", borderRadius: "12px 12px 12px 3px", boxShadow: "0 10px 24px #000a" }}>{bubble}</div>
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
                  <text x={r.cx + r.w / 2 - 26} y={r.cy - r.h / 2 + 24} fontSize="13" fontWeight="800" fill="#5f6d8c">Z z z</text>
                )}

                <foreignObject x={r.cx - 100} y={r.cy - r.h / 2 - 34} width="200" height="30">
                  <RoomTag name={a.name} task={st.task} st={st.st} />
                </foreignObject>
              </g>
            );
          })}

          {/* chai stall + walking character */}
          <g>
            <ellipse cx={STALL.cx} cy={STALL.cy + 50} rx="70" ry="12" fill="#000" opacity="0.22" />
            <rect x={STALL.cx - 66} y={STALL.cy - 40} width="132" height="88" rx="16" fill="#161c2c" stroke="#3a2f1e" strokeWidth="2" />
            <text x={STALL.cx} y={STALL.cy - 48} textAnchor="middle" fontSize="12" fontWeight="800" fill="#e0a55c">☕ Chacha&apos;s Chai</text>
            <text x={STALL.cx} y={STALL.cy + 14} textAnchor="middle" fontSize="24">🫖</text>
          </g>
          <g style={{ transition: "transform 1.6s cubic-bezier(.45,.05,.55,.95)", transform: `translate(${chai.cx}px,${chai.cy}px)` }}>
            <ellipse cx="0" cy="20" rx="11" ry="3.5" fill="#000" opacity="0.25" />
            <rect x="-9" y="0" width="18" height="18" rx="7" fill="#e08a3c" />
            <circle cx="0" cy="-9" r="10" fill="#f0c090" />
            {chai.say && (
              <foreignObject x="-70" y="-42" width="140" height="26">
                <div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} style={{ display: "flex", justifyContent: "center" }}>
                  <div style={{ background: "#0d1322", color: "#ffb95e", fontSize: 10, fontWeight: 700, padding: "4px 9px", borderRadius: 8 }}>Chai garam! ☕</div>
                </div>
              </foreignObject>
            )}
          </g>
        </svg>
      </div>

      <div className="xs mut" style={{ position: "absolute", left: 14, top: 12, pointerEvents: "none", zIndex: 2 }}>
        ● Your office — live{shownFocus ? " · click anywhere to zoom out" : " · click a room to zoom"}
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
        @media (prefers-reduced-motion: reduce) {
          .office2d * { animation: none !important; transition: none !important; }
        }
      `}</style>
    </div>
  );
}
