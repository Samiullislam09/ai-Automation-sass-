"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Help } from "@/components/kit";

type ContentItem = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  body: string | null;
  meta: { wordCount?: number; sections?: number; links?: number } | null;
  created_at: string;
};

const ICO: Record<string, string> = { article: "📝", story: "🎨", social: "📣", gbp: "📍" };

function qcSummary(c: ContentItem): string {
  const m = c.meta ?? {};
  if (c.type === "article") return `${m.wordCount ?? "?"} words · ${m.sections ?? "?"} sections · ${m.links ?? 0} links`;
  return "Ready for review";
}

export default function Approvals() {
  const { act, report, toast } = useStore();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/content?status=awaiting_approval")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setItems(data.items); })
      .catch(() => toast("Couldn't load approvals — try refreshing.", "error"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const approve = async (c: ContentItem) => {
    setBusy(c.id);
    try {
      const res = await fetch(`/api/content/${c.id}/approve`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        act(`"It's live. Prepare distribution."`, "Mr Lxwa", "Miss Social");
        report(`Published after your approval: "${c.title}"`);
        toast(data.url ? `Published! ${data.url}` : "Published!");
        setItems((prev) => prev.filter((x) => x.id !== c.id));
      } else {
        toast(`Publish failed: ${data.error}`, "error");
      }
    } catch {
      toast("Publish failed — network error.", "error");
    } finally {
      setBusy(null);
    }
  };

  // Reject is optimistic with a 6-second Undo: the card leaves the list at once, but the API
  // call is only made when the toast expires. Undo cancels the timer and puts the card back —
  // there is no un-reject endpoint, so delaying the call is what makes Undo real.
  const reject = (c: ContentItem) => {
    const index = items.findIndex((x) => x.id === c.id);
    setItems((prev) => prev.filter((x) => x.id !== c.id));
    let undone = false;
    const timer = setTimeout(async () => {
      setBusy(c.id);
      try {
        const res = await fetch(`/api/content/${c.id}/reject`, { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          act(`"Understood. We'll adjust and learn from this."`, "Mr Lxwa");
          report(`Rejected by you (team will adjust): "${c.title}"`);
        } else {
          restore();
          toast(`Reject failed: ${data.error}`, "error");
        }
      } catch {
        restore();
        toast("Reject failed — network error.", "error");
      } finally {
        setBusy(null);
      }
    }, 6000);
    const restore = () =>
      setItems((prev) => {
        if (prev.some((x) => x.id === c.id)) return prev;
        const next = [...prev];
        next.splice(Math.min(index < 0 ? prev.length : index, prev.length), 0, c);
        return next;
      });
    toast("Rejected", "ok", {
      ms: 6000,
      action: { label: "Undo", onClick: () => { if (undone) return; undone = true; clearTimeout(timer); restore(); } },
    });
  };

  return (
    <>
      <div className="pg-head"><h1 className="pg-h1">Approvals <Help k="approval" /></h1></div>
      <div className="listgrid">
        {loading ? (
          <div className="card emptycard"><p className="mut sm">Loading…</p></div>
        ) : items.length ? items.map((c) => (
          <div key={c.id} className="card">
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
              <div className="lead-ic">{ICO[c.type] ?? "📄"}</div>
              {/* min-width:0 or a long unbroken headline pushes the whole card past the
                  viewport on a phone — flex items default to min-width:auto. */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <b className="brk" style={{ fontSize: 14, display: "block" }}>{c.title || "Untitled"}</b>
                <div className="xs mut" style={{ marginTop: 2 }}>{c.type} · quality gate ✓ passed · {new Date(c.created_at).toLocaleString()}</div>
              </div>
            </div>
            <p className="sm mut" style={{ background: "var(--panel2)", borderRadius: 10, padding: 12, border: "1px solid var(--line)", margin: 0 }}>{qcSummary(c)}</p>
            <div className="btnrow" style={{ marginTop: 13 }}>
              {/* Approving from a two-line summary was approving on faith. This opens the
                  draft as a real page, with hand-editing and an AI editor beside it. */}
              <Link href={`/app/content/${c.id}`} className="btn btn-p btn-sm">Read &amp; edit</Link>
              <button className="btn btn-g btn-sm" disabled={busy === c.id} onClick={() => approve(c)}>{busy === c.id ? "Publishing…" : "✓ Approve & publish"}</button>
              <button className="btn btn-red btn-sm" disabled={busy === c.id} onClick={() => reject(c)}>{busy === c.id ? "Rejecting…" : "Reject"}</button>
            </div>
          </div>
        )) : (
          <div className="card emptycard">
            <div className="ic">✨</div>
            <p className="mut sm">All clear — nothing waiting. Your team will notify you when new work is ready.</p>
          </div>
        )}
      </div>
    </>
  );
}
