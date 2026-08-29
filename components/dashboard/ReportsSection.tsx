"use client";
import Link from "next/link";
import { useStore } from "@/lib/store";

/** /dashboard/reports — same real logic as the old app/app/reports/page.tsx: reads the
 *  session's `s.reports` (lines appended by real actions elsewhere — approvals, publishes —
 *  via the store's `report()` call). Restyled to the new dashboard theme per the owner's
 *  standing instruction (2026-08-29). Rendered inside <MrLxwaDashboard> as its `children` —
 *  see app/dashboard/reports/page.tsx. */

export default function ReportsSection() {
  const { s } = useStore();
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Daily Reports</h1>

      <div className="grid grid-cols-1 gap-2.5">
        {s.reports.length ? s.reports.map((r: any) => {
          const d = new Date(r.dateISO);
          return (
            <Link
              key={r.id}
              href={"/app/reports/" + r.id}
              className="lx-card2 flex items-center gap-3 p-3.5 transition hover:brightness-110"
              style={r.unread ? { borderLeft: "3px solid var(--lx-cyan)" } : undefined}
            >
              <div
                className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg"
                style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)" }}
              >
                <b className="leading-tight" style={{ fontSize: 15 }}>{d.getDate()}</b>
                <span className="lx-mut leading-tight" style={{ fontSize: 9 }}>{d.toLocaleDateString([], { month: "short" })}</span>
              </div>
              <div className="min-w-0 flex-1">
                <b className="lx-12">Daily report {r.unread && <span className="lx-10" style={{ color: "var(--lx-cyan)" }}>· new</span>}</b>
                <div className="lx-11 lx-mut mt-0.5 line-clamp-2">{r.lines[r.lines.length - 1].s.slice(0, 74)}…</div>
              </div>
              <span className="lx-mut" aria-hidden>→</span>
            </Link>
          );
        }) : (
          <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
            <div className="text-2xl">🗒</div>
            <p className="lx-11 lx-mut">No reports yet. As soon as your team does its first work today, Mr Lxwa writes the day&apos;s report here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
