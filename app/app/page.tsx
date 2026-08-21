"use client";
/** Dashboard root — the 2D isometric office (components/Office.tsx) plus the real stat row,
 *  restored at the user's request. The pixel-art "AI Command Center" build that briefly lived
 *  here is still in the repo at components/dashboard/AICommandCenter.tsx (fully wired to
 *  /api/dashboard/live); it is simply not routed. To put it back, render <AICommandCenter />
 *  here and re-add the `if (isDashboard) return <>{children}</>` early return in
 *  app/app/layout.tsx, since it supplies its own sidebar/topbar/chat shell.
 *
 *  The stat row's card styling is lifted from that reference build's `.stat` rule so the two
 *  look like one product; the greeting it used to carry now lives in the shared topbar. */
import { useEffect, useState } from "react";
import Office from "@/components/Office";

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
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/stats").then((r) => r.json()).then((d) => { if (d.ok) setStats(d); }).catch(() => {});
  }, []);

  const fmt = (key: keyof Stats, v: number) => (key === "successRate" ? `${v}%` : v);

  return (
    <div className="dash-wrap">
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

      <div className="dash-office">
        <Office />
      </div>

      <style jsx>{`
        .dash-wrap { position: absolute; inset: 0; display: flex; flex-direction: column; }
        .dash-stats { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;
                      padding: 16px clamp(14px, 2.4vw, 26px) 12px; flex: none; }
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

        .dash-office { flex: 1; position: relative; min-height: 0;
                       margin: 0 clamp(14px, 2.4vw, 26px) clamp(14px, 2.4vw, 26px);
                       border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
                       background: var(--bg2); }

        @media (max-width: 1400px) { .dash-stats { grid-template-columns: repeat(4, 1fr); } }
        @media (max-width: 860px) {
          .dash-wrap { position: relative; inset: auto; height: 100%; }
          .dash-stats { grid-template-columns: repeat(2, 1fr); padding: 12px 14px 10px; }
          .dash-office { margin: 0 14px 14px; min-height: 340px; }
        }
      `}</style>
    </div>
  );
}
