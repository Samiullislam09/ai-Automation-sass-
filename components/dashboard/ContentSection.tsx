"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

/** /dashboard/content — same real logic as the old app/app/content/page.tsx: reads
 *  content_items from the database via /api/content?status=..., every row opens the real
 *  reviewer at /app/content/[id]. Restyled to the new dashboard theme per the owner's standing
 *  instruction (2026-08-29). Rendered inside <MrLxwaDashboard> as its `children` — see
 *  app/dashboard/content/page.tsx. */

type Item = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  meta: { wordCount?: number; sections?: number; links?: number } | null;
  created_at: string;
};

const ICO: Record<string, string> = { article: "📝", story: "🎨", social: "📣", gbp: "📍" };

const STATUS: Record<string, { label: string; tone: string }> = {
  published: { label: "PUBLISHED", tone: "green" },
  awaiting_approval: { label: "NEEDS APPROVAL", tone: "amber" },
  approved: { label: "APPROVED", tone: "green" },
  rejected: { label: "REJECTED", tone: "red" },
  failed: { label: "FAILED GATE", tone: "red" },
  draft: { label: "DRAFT", tone: "mut" },
};

const FILTERS: [string, string][] = [
  ["all", "All"],
  ["awaiting_approval", "Waiting for you"],
  ["published", "Published"],
  ["failed", "Failed"],
];

export default function ContentSection() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [err, setErr] = useState("");

  useEffect(() => {
    setItems(null);
    fetch(`/api/content?status=${filter}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setItems(d.items); else setErr(d.error ?? "Could not load your content."); })
      .catch((e) => setErr(e?.message ?? "Network error."));
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">Content</h1>
        <Link href="/dashboard" className="lx-grad lx-11 ml-auto px-3.5 py-2">+ Create new</Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            className="lx-11 rounded-full px-3.5 py-2 font-semibold transition"
            style={
              filter === k
                ? { background: "var(--lx-cyan)", color: "#04101a" }
                : { background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-mut)" }
            }
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {err && <p className="lx-11" style={{ color: "#f87171" }}>{err}</p>}

      <div className="grid grid-cols-1 gap-2.5">
        {items === null ? (
          <div className="lx-card2 p-6"><p className="lx-11 lx-mut">Loading…</p></div>
        ) : items.length ? items.map((c) => {
          const st = STATUS[c.status] ?? { label: c.status.toUpperCase(), tone: "mut" };
          const m = c.meta ?? {};
          return (
            <Link
              key={c.id}
              href={`/app/content/${c.id}`}
              className="lx-card2 flex flex-wrap items-center gap-3 p-3.5 transition hover:brightness-110"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base"
                style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)" }}
              >
                {ICO[c.type] ?? "📄"}
              </span>
              <div className="min-w-0 flex-1">
                <b className="lx-12 block truncate">{c.title || "Untitled"}</b>
                <div className="lx-10 lx-mut mt-0.5">
                  {c.type}
                  {m.wordCount ? ` · ${m.wordCount} words` : ""}
                  {m.sections != null ? ` · ${m.sections} sections` : ""}
                  {" · "}{new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>
              <span className={"lx-pill " + st.tone}>{st.label}</span>
            </Link>
          );
        }) : (
          <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
            <div className="text-2xl">📭</div>
            <p className="lx-11 lx-mut">
              {filter === "all" ? "Nothing written yet — start the team from the dashboard." : "Nothing in this state."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
