"use client";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { Help } from "@/components/kit";

const ICO: Record<string, string> = { article: "📝", story: "🎨", social: "📣" };

export default function Content() {
  const { s } = useStore();
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 21, margin: 0 }}>Content</h1><div style={{ flex: 1 }} />
        <Link className="btn btn-p btn-sm" href="/app">+ Create new</Link>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {s.content.length ? s.content.map((c: any) => (
          <div key={c.id} className="card" style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--panel2)", fontSize: 16, flex: "none" }}>{ICO[c.type]}</div>
            <div style={{ flex: 1 }}><b style={{ fontSize: 14 }}>{c.title}</b><div className="xs mut" style={{ marginTop: 2 }}>{c.type} · {c.time} · ⚡{c.tokens} tokens</div></div>
            <span className={"pillst " + (c.status === "published" ? "st-pub" : c.status === "awaiting" ? "st-wait" : c.status === "rejected" ? "st-fail" : "st-draft")}>{c.status === "awaiting" ? "NEEDS APPROVAL" : c.status.toUpperCase()}</span>
          </div>
        )) : (
          <div className="card" style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 30 }}>📭</div><p className="mut sm" style={{ marginTop: 8 }}>No content yet — create your first article from the dashboard.</p></div>
        )}
      </div>
    </>
  );
}
