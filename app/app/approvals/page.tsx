"use client";
import { useStore } from "@/lib/store";
import { Help } from "@/components/kit";

const ICO: Record<string, string> = { article: "📝", story: "🎨", social: "📣" };
const QC: Record<string, string> = {
  article: "1,920 words · 9 sections · 3 internal links · keyword in title, H1 and intro · originality 98%",
  story: "8 frames · branded colors · optimized images with alt-text",
  social: "Post copy + 6 hashtags · sized for all platforms",
};

export default function Approvals() {
  const { s, approve, reject, toast } = useStore();
  const wait = s.content.filter((c: any) => c.status === "awaiting");
  return (
    <>
      <h1 style={{ fontSize: 21, margin: "0 0 20px" }}>Approvals <Help k="approval" /></h1>
      <div style={{ display: "grid", gap: 12 }}>
        {wait.length ? wait.map((c: any) => (
          <div key={c.id} className="card">
            <div style={{ display: "flex", gap: 13, alignItems: "center", marginBottom: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--panel2)", fontSize: 16 }}>{ICO[c.type]}</div>
              <div style={{ flex: 1 }}><b>{c.title}</b><div className="xs mut">{c.type} · quality gate ✓ passed · {c.time}</div></div>
            </div>
            <p className="sm mut" style={{ background: "var(--panel2)", borderRadius: 10, padding: 12, border: "1px solid var(--line)", margin: 0 }}>{QC[c.type]}</p>
            <div style={{ display: "flex", gap: 9, marginTop: 13, flexWrap: "wrap" }}>
              <button className="btn btn-p btn-sm" onClick={() => approve(c.id)}>✓ Approve & publish</button>
              <button className="btn btn-g btn-sm" onClick={() => toast("Editor opens here — wired in backend Step 12")}>Edit</button>
              <button className="btn btn-red btn-sm" onClick={() => reject(c.id)}>Reject</button>
            </div>
          </div>
        )) : (
          <div className="card" style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 30 }}>✨</div><p className="mut sm" style={{ marginTop: 8 }}>All clear — nothing waiting. Your team will notify you when new work is ready.</p></div>
        )}
      </div>
    </>
  );
}
