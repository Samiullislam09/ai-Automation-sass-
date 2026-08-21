"use client";
/** Dashboard root — the 2D isometric office (components/Office.tsx) plus the real stat row,
 *  restored at the user's request. The pixel-art "AI Command Center" build that briefly lived
 *  here is still in the repo at components/dashboard/AICommandCenter.tsx (fully wired to
 *  /api/dashboard/live); it is simply not routed. To put it back, render <AICommandCenter />
 *  here and re-add the `if (isDashboard) return <>{children}</>` early return in
 *  app/app/layout.tsx, since it supplies its own sidebar/topbar/chat shell. */
import { useEffect, useState } from "react";
import Office from "@/components/Office";
import { useStore } from "@/lib/store";

type Stats = {
  totalAgents: number; liveAgents: number; working: number; waiting: number;
  errorsToday: number; tasksCompleted: number; successRate: number; pagesIndexed: number;
};

const CARDS: [keyof Stats, string, string][] = [
  ["totalAgents", "🤖", "Total Agents"],
  ["working", "📈", "Working"],
  ["waiting", "⏱", "Waiting"],
  ["errorsToday", "⚠️", "Errors today"],
  ["tasksCompleted", "✅", "Published"],
  ["successRate", "📊", "Success rate"],
  ["pagesIndexed", "🗂", "Pages indexed"],
];

export default function Dashboard() {
  const { s } = useStore();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/stats").then((r) => r.json()).then((d) => { if (d.ok) setStats(d); }).catch(() => {});
  }, []);

  const fmt = (key: keyof Stats, v: number) => (key === "successRate" ? `${v}%` : v);

  return (
    <div className="dash-office-wrap" style={{ position: "absolute", top: 0, left: 0, bottom: 0, right: 0, display: "flex", flexDirection: "column" }}>
      <div className="dash-stats-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px 10px", overflowX: "auto", flex: "none" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", background: "var(--panel)", border: "1px solid var(--line)", padding: "8px 14px", borderRadius: 999, whiteSpace: "nowrap", flex: "none" }}>
          {new Date().getHours() < 12 ? "Good morning" : "Good day"}, {s.user?.name || "there"} 👋
        </span>
        <div style={{ width: 1, alignSelf: "stretch", background: "var(--line)", flex: "none", margin: "2px 2px" }} />
        {CARDS.map(([key, ico, label]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 13, padding: "8px 14px", flex: "none" }}>
            <span style={{ fontSize: 16 }}>{ico}</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", lineHeight: 1.1 }}>{stats ? fmt(key, stats[key]) : "—"}</div>
              <div style={{ fontSize: 10, color: "var(--mut)", whiteSpace: "nowrap" }}>{label}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <Office />
      </div>
      {/* position:absolute ignores the parent's padding-right, so the office would render
          underneath the fixed chat dock — carve out its width explicitly here instead. */}
      <style jsx>{`
        @media (min-width: 900px) { .dash-office-wrap { right: 300px; } }
        .dash-stats-row::-webkit-scrollbar { height: 0; }
      `}</style>
    </div>
  );
}
