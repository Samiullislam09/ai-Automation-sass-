"use client";
import React, { useEffect, useRef, useState } from "react";
import { AGENTS, useStore } from "@/lib/store";

/** Animated isometric office — the dashboard hero. States driven by store.agents.
 *  TODO(backend): states arrive via Socket.io from the agent server. */
const ROOMS: Record<string, { x: number; y: number; w: number; h: number; c: string }> = {
  boss:   { x: 292, y: 30,  w: 176, h: 112, c: "#17a98c" },
  kw:     { x: 54,  y: 56,  w: 148, h: 104, c: "#6ea8ff" },
  writer: { x: 548, y: 56,  w: 148, h: 104, c: "#b48bff" },
  social: { x: 116, y: 238, w: 148, h: 104, c: "#ff8fb3" },
  seo:    { x: 318, y: 254, w: 148, h: 104, c: "#7ee787" },
  story:  { x: 520, y: 254, w: 148, h: 104, c: "#ff8fb3" },
};
const BOSS_LINES = [
  "Mr. Writer, blueprint aa raha hai…",
  "Team status: sab on track ✓",
  "Miss Social, distribution ready rakho",
  "Mr. SEO, aaj ka audit?",
];

export default function Office({ demo = false }: { demo?: boolean }) {
  const store = useStore();
  const agents = demo || !store ? Object.fromEntries(AGENTS.map((a, i) => [a.id, { st: i === 5 ? "o" : i === 4 ? "i" : "w", task: ["Orchestrating", "Searching keywords…", "Writing article…", "Designing story…", "Idle — chai break", "Offline"][i] }])) : store.s.agents;
  const [zoom, setZoom] = useState<string | null>(null);
  const [bubble, setBubble] = useState(BOSS_LINES[0]);
  const [showBub, setShowBub] = useState(false);
  const [chai, setChai] = useState({ x: 40, y: 380, walk: false, say: false });
  const [scale, setScale] = useState(1);
  const wrap = useRef<HTMLDivElement>(null);

  // responsive scale-to-fit
  useEffect(() => {
    const f = () => { if (wrap.current) setScale(Math.min(wrap.current.clientWidth / 820, 1)); };
    f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f);
  }, []);
  // boss speech
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => { setBubble(BOSS_LINES[i++ % BOSS_LINES.length]); setShowBub(true); setTimeout(() => setShowBub(false), 3200); }, 6500);
    return () => clearInterval(t);
  }, []);
  // chai-wala rounds
  useEffect(() => {
    const round = () => {
      const online = Object.keys(ROOMS).filter(id => id !== "boss" && agents[id]?.st !== "o");
      if (!online.length) return;
      const r = ROOMS[online[Math.floor(Math.random() * online.length)]];
      setChai({ x: r.x + r.w / 2 - 15, y: r.y + r.h - 8, walk: true, say: false });
      setTimeout(() => setChai(c => ({ ...c, walk: false, say: true })), 2500);
      setTimeout(() => setChai(c => ({ ...c, say: false, walk: true, x: 40, y: 380 })), 4300);
      setTimeout(() => setChai(c => ({ ...c, walk: false })), 6800);
    };
    const t = setInterval(round, 11000); const t2 = setTimeout(round, 2000);
    return () => { clearInterval(t); clearTimeout(t2); };
  }, [agents]);

  const camStyle = () => {
    if (!zoom) return {};
    const r = ROOMS[zoom];
    const cx = r.x + r.w / 2 - 380, cy = r.y + r.h / 2 - 235;
    const sx = (cx - cy) * Math.SQRT1_2, sy = (cx + cy) * Math.SQRT1_2 * Math.cos((55 * Math.PI) / 180);
    return { transform: `scale(1.6) translate(${-sx}px, ${-sy}px)` };
  };

  return (
    <div className="office" ref={wrap} style={{ height: 400 }} onClick={() => zoom && setZoom(null)}>
      <div className="fit" style={{ transform: `translate(-50%,-50%) scale(${scale})` }}>
        <div className="cam" style={camStyle()}>
          <div className="world">
            <div className="ground" />
            {AGENTS.map(a => {
              const r = ROOMS[a.id]; const st = agents[a.id] || { st: "i", task: "Idle" };
              return (
                <div key={a.id} className={"oroom" + (a.id === "boss" ? " boss" : "")} data-st={st.st}
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                  onClick={e => { e.stopPropagation(); setZoom(zoom === a.id ? null : a.id); }}>
                  <div className="wallB">{a.id !== "boss" && <div className="win" />}</div>
                  <div className="wallL" />
                  <div className="rfloor" />
                  {a.id === "boss" ? (
                    <>
                      <div className="oorb bill"><div className="core" /></div>
                      <div className="obub" style={{ opacity: showBub ? 1 : 0 }}>{bubble}</div>
                    </>
                  ) : (
                    <>
                      <div className="desk" />
                      <div className="omon bill"><div className="scr" /></div>
                      <div className="ochar bill" style={{ ["--c" as any]: r.c }}>
                        <div className="shd" /><div className="body" /><div className="head" /><div className="hair" />
                      </div>
                    </>
                  )}
                  <div className="otag"><span className="st" />{a.name}<span className="tk">{st.task}</span></div>
                  <div className="ozzz bill">Z z z</div>
                </div>
              );
            })}
            <div className="stall2"><div className="base" /><div className="sign">☕ Chacha&apos;s Chai</div></div>
            <div className={"chai" + (chai.walk ? " walk" : "")} style={{ left: chai.x, top: chai.y }}>
              <div className="sp2"><div className="body" /><div className="head" /><div className="topi" /><div className="tray" /><div className="cup" /></div>
              <div className="say" style={{ opacity: chai.say ? 1 : 0 }}>Chai garam! ☕</div>
            </div>
          </div>
        </div>
      </div>
      <div className="xs mut" style={{ position: "absolute", left: 14, top: 12 }}>● Your office — live{zoom ? " · click anywhere to zoom out" : " · click a room to zoom"}</div>
    </div>
  );
}
