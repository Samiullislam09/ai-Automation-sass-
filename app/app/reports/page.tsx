"use client";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { Help } from "@/components/kit";

export default function Reports() {
  const { s } = useStore();
  return (
    <>
      <div className="pg-head"><h1 className="pg-h1">Daily Reports <Help k="reports" /></h1></div>
      <div className="listgrid">
        {s.reports.length ? s.reports.map((r: any) => {
          const d = new Date(r.dateISO);
          return (
            <Link key={r.id} href={"/app/reports/" + r.id} className="card rrow" style={{ color: "var(--ink)", borderLeft: r.unread ? "3px solid var(--ac)" : undefined }}>
              {/* Same 40px leading box as every other list row in /app — this one was 46px. */}
              <div className="lead-ic">
                <div>
                  <b style={{ fontSize: 15, display: "block", lineHeight: 1.05 }}>{d.getDate()}</b>
                  <span style={{ fontSize: 9, color: "var(--mut)" }}>{d.toLocaleDateString([], { month: "short" })}</span>
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>Daily report {r.unread && <span className="xs acc">· new</span>}</b>
                {/* Capped at two lines so a long last activity can't make one card twice the
                    height of the one under it. */}
                <div className="sm mut clamp2" style={{ marginTop: 2 }}>{r.lines[r.lines.length - 1].s.slice(0, 74)}…</div>
              </div>
              <span className="mut" aria-hidden>→</span>
            </Link>
          );
        }) : (
          <div className="card emptycard">
            <div className="ic">🗒</div>
            <p className="mut sm">No reports yet. As soon as your team does its first work today, Mr Lxwa writes the day&apos;s report here.</p>
          </div>
        )}
      </div>

      <style jsx>{`
        .rrow { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 13px; align-items: center;
                transition: border-color .18s, transform .18s; }
        .rrow:hover { border-color: var(--ac); transform: translateY(-1px); }
      `}</style>
    </>
  );
}
