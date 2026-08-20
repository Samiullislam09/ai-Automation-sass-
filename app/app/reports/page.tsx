"use client";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { Help } from "@/components/kit";

export default function Reports() {
  const { s } = useStore();
  return (
    <>
      <h1 style={{ fontSize: 21, margin: "0 0 20px" }}>Daily Reports <Help k="reports" /></h1>
      <div style={{ display: "grid", gap: 10 }}>
        {s.reports.length ? s.reports.map((r: any) => {
          const d = new Date(r.dateISO);
          return (
            <Link key={r.id} href={"/app/reports/" + r.id} className="card" style={{ display: "flex", gap: 13, color: "var(--ink)", borderLeft: r.unread ? "3px solid var(--ac)" : undefined }}>
              <div style={{ width: 46, height: 46, borderRadius: 12, background: "var(--panel2)", display: "grid", placeItems: "center", flex: "none", textAlign: "center" }}>
                <div><b style={{ fontSize: 16, display: "block", lineHeight: 1.1 }}>{d.getDate()}</b><span style={{ fontSize: 9.5, color: "var(--mut)" }}>{d.toLocaleDateString([], { month: "short" })}</span></div>
              </div>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 14 }}>Daily report {r.unread && <span className="xs acc">· new</span>}</b>
                <div className="sm mut" style={{ marginTop: 2 }}>{r.lines[r.lines.length - 1].s.slice(0, 74)}…</div>
              </div>
              <span className="mut" style={{ alignSelf: "center" }}>→</span>
            </Link>
          );
        }) : (
          <div className="card" style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 30 }}>🗒</div><p className="mut sm" style={{ marginTop: 8 }}>No reports yet. As soon as your team does its first work today, Mr Lxwa writes the day&apos;s report here.</p></div>
        )}
      </div>
    </>
  );
}
