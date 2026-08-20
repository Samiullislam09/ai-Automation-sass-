"use client";
import Office from "@/components/Office";
import { useStore } from "@/lib/store";

export default function Dashboard() {
  const { s } = useStore();
  return (
    <div className="dash-office-wrap" style={{ position: "absolute", top: 0, left: 0, bottom: 0, right: 0 }}>
      <div style={{ position: "absolute", left: 18, top: 14, zIndex: 3, pointerEvents: "none" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1c2540", background: "#ffffffd8", padding: "6px 12px", borderRadius: 999, boxShadow: "0 4px 14px #1c254022" }}>
          Good {new Date().getHours() < 12 ? "morning" : "day"}, {s.user?.name} 👋
        </span>
      </div>
      <Office />
      {/* position:absolute ignores the parent's padding-right, so the office would render
          underneath the fixed chat dock — carve out its width explicitly here instead. */}
      <style jsx>{`
        @media (min-width: 900px) { .dash-office-wrap { right: 300px; } }
      `}</style>
    </div>
  );
}
