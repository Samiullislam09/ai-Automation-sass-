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
      <div className="pg-head">
        <h1 className="pg-h1">Content</h1>
        <div className="sp" />
        <Link className="btn btn-p btn-sm" href="/app">+ Create new</Link>
      </div>

      <div className="cfilters">
        {FILTERS.map(([k, label]) => (
          <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {err && <p className="sm" style={{ color: "var(--red)" }}>{err}</p>}

      <div className="listgrid">
        {items === null ? (
          <div className="card emptycard"><p className="mut sm">Loading…</p></div>
        ) : items.length ? items.map((c) => {
          const st = STATUS[c.status] ?? { label: c.status.toUpperCase(), cls: "st-draft" };
          const m = c.meta ?? {};
          return (
            <Link key={c.id} href={`/app/content/${c.id}`} className="card crow">
              <div className="lead-ic">{ICO[c.type] ?? "📄"}</div>
              <div className="crow-t">
                <b className="brk" style={{ fontSize: 14, display: "block" }}>{c.title || "Untitled"}</b>
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
          <div className="card emptycard">
            <div className="ic">📭</div>
            <p className="mut sm">
              {filter === "all" ? "Nothing written yet — start the team from the dashboard." : "Nothing in this state."}
            </p>
          </div>
        )}
      </div>

      <style jsx>{`
        .cfilters { display: flex; gap: 7px; margin-bottom: 14px; flex-wrap: wrap; }
        .cfilters button { background: var(--panel); border: 1px solid var(--line); color: var(--mut);
                           font-size: 12px; font-weight: 600; padding: 8px 14px; min-height: 36px;
                           border-radius: 999px; cursor: pointer; transition: color .18s, background .18s,
                           border-color .18s; }
        .cfilters button:hover { color: var(--ink); border-color: var(--line2); }
        .cfilters button.on { color: #fff; background: var(--ac); border-color: var(--ac); }

        /* Grid, not flex: the pill is a fixed third track, so every row's title starts and
           ends at the same x whatever the pill says. */
        .crow { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 13px;
                align-items: center; transition: border-color .18s, transform .18s; }
        .crow:hover { border-color: var(--ac); transform: translateY(-1px); }
        .crow-t { min-width: 0; }
        /* "NEEDS APPROVAL" next to a title in ~130px of remaining width shredded both. Below
           480px the pill drops to its own line under the meta, aligned with the title. */
        @media (max-width: 480px) {
          .crow { grid-template-columns: auto minmax(0, 1fr); row-gap: 9px; }
          .crow :global(.pillst) { grid-column: 2; justify-self: start; }
        }
      `}</style>
    </>
  );
}
