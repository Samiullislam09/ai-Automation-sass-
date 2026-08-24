"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Everything the team has written, from the database.
 *
 *  This page used to read the store's local demo array, which nothing ever fills — so it said
 *  "No content yet" to people whose articles were sitting in content_items the whole time.
 *  Each row now opens the real reviewer at /app/content/[id]. */

type Item = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  meta: { wordCount?: number; sections?: number; links?: number } | null;
  created_at: string;
};

const ICO: Record<string, string> = { article: "📝", story: "🎨", social: "📣", gbp: "📍" };

const STATUS: Record<string, { label: string; cls: string }> = {
  published: { label: "PUBLISHED", cls: "st-pub" },
  awaiting_approval: { label: "NEEDS APPROVAL", cls: "st-wait" },
  approved: { label: "APPROVED", cls: "st-pub" },
  rejected: { label: "REJECTED", cls: "st-fail" },
  failed: { label: "FAILED GATE", cls: "st-fail" },
  draft: { label: "DRAFT", cls: "st-draft" },
};

const FILTERS: [string, string][] = [
  ["all", "All"],
  ["awaiting_approval", "Waiting for you"],
  ["published", "Published"],
  ["failed", "Failed"],
];

export default function Content() {
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
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 21, margin: 0 }}>Content</h1>
        <div style={{ flex: 1 }} />
        <Link className="btn btn-p btn-sm" href="/app">+ Create new</Link>
      </div>

      <div className="cfilters">
        {FILTERS.map(([k, label]) => (
          <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {err && <p className="sm" style={{ color: "#ff6b6b" }}>{err}</p>}

      <div style={{ display: "grid", gap: 10 }}>
        {items === null ? (
          <div className="card" style={{ textAlign: "center", padding: 40 }}><p className="mut sm">Loading…</p></div>
        ) : items.length ? items.map((c) => {
          const st = STATUS[c.status] ?? { label: c.status.toUpperCase(), cls: "st-draft" };
          const m = c.meta ?? {};
          return (
            <Link key={c.id} href={`/app/content/${c.id}`} className="card crow">
              <div className="crow-ic">{ICO[c.type] ?? "📄"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{c.title || "Untitled"}</b>
                <div className="xs mut" style={{ marginTop: 2 }}>
                  {c.type}
                  {m.wordCount ? ` · ${m.wordCount} words` : ""}
                  {m.sections != null ? ` · ${m.sections} sections` : ""}
                  {" · "}{new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>
              <span className={"pillst " + st.cls}>{st.label}</span>
            </Link>
          );
        }) : (
          <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 30 }}>📭</div>
            <p className="mut sm" style={{ marginTop: 8 }}>
              {filter === "all" ? "Nothing written yet — start the team from the dashboard." : "Nothing in this state."}
            </p>
          </div>
        )}
      </div>

      <style jsx>{`
        .cfilters { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
        .cfilters button { background: var(--panel); border: 1px solid var(--line); color: var(--mut);
                           font-size: 11.5px; font-weight: 600; padding: 6px 12px; border-radius: 999px;
                           cursor: pointer; }
        .cfilters button.on { color: #fff; background: var(--ac); border-color: var(--ac); }
        .crow { display: flex; gap: 14px; align-items: center; transition: border-color .18s, transform .18s; }
        .crow:hover { border-color: var(--ac); transform: translateY(-1px); }
        .crow-ic { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center;
                   background: var(--panel2); font-size: 16px; flex: none; }
      `}</style>
    </>
  );
}
