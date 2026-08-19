"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useStore } from "@/lib/store";

export default function ReportDetail() {
  const { s, patch } = useStore();
  const { id } = useParams<{ id: string }>();
  const r = s.reports.find((x: any) => String(x.id) === String(id));
  useEffect(() => {
    if (r?.unread) patch((prev: any) => ({ reports: prev.reports.map((x: any) => String(x.id) === String(id) ? { ...x, unread: false } : x) }));
  }, [id]); // eslint-disable-line
  if (!r) return <p className="mut">Report not found. <Link href="/app/reports">← Back</Link></p>;
  const d = new Date(r.dateISO);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link className="btn btn-g btn-sm" href="/app/reports">←</Link>
        <h1 style={{ fontSize: 21, margin: 0 }}>Report · {d.toLocaleDateString([], { day: "numeric", month: "long" })}</h1>
      </div>
      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <div className="corb" />
          <div><b>Boss AI — end of day summary</b><div className="xs mut">{r.lines.length} activities · ⚡{s.tokensMax - s.tokens} tokens used this cycle</div></div>
        </div>
        {r.lines.map((l: any, i: number) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid #1a2440", fontSize: 13.5, alignItems: "baseline" }}>
            <span className="acc" style={{ fontWeight: 700, minWidth: 26 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ flex: 1 }}>{l.s}</span>
            <span className="xs mut">{l.t}</span>
          </div>
        ))}
        <p className="sm mut" style={{ marginTop: 14, marginBottom: 0 }}>— Tomorrow the team continues on your publishing schedule. Anything you approve tonight goes out first. 🌙</p>
      </div>
    </>
  );
}
