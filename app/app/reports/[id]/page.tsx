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
      <div className="pg-head">
        <Link className="btn btn-g btn-sm" href="/app/reports" aria-label="Back to reports">←</Link>
        <h1 className="pg-h1">Report · {d.toLocaleDateString([], { day: "numeric", month: "long" })}</h1>
      </div>
      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <div className="corb" />
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 14 }}>Mr Lxwa — end of day summary</b>
            <div className="xs mut">{r.lines.length} activities · ⚡{s.tokensMax - s.tokens} tokens used this cycle</div>
          </div>
        </div>
        {r.lines.map((l: any, i: number) => (
          <div key={i} className="rline">
            <span className="acc" style={{ fontWeight: 700, minWidth: 24, flex: "none" }}>{String(i + 1).padStart(2, "0")}</span>
            <span className="brk" style={{ flex: 1 }}>{l.s}</span>
            <span className="xs mut" style={{ flex: "none" }}>{l.t}</span>
          </div>
        ))}
        <p className="sm mut" style={{ marginTop: 14, marginBottom: 0 }}>— Tomorrow the team continues on your publishing schedule. Anything you approve tonight goes out first. 🌙</p>
      </div>

      <style jsx>{`
        /* The divider was a hardcoded #1a2440 — invisible in the light theme, and it was drawn
           under the last row too, so it collided with the closing paragraph. */
        .rline { display: flex; gap: 10px; padding: 9px 0; align-items: baseline; font-size: 13.5px;
                 border-bottom: 1px solid var(--line); }
        .rline:last-of-type { border-bottom: none; }
      `}</style>
    </>
  );
}
