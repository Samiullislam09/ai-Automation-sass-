"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

/** /dashboard/approvals — same real logic and API calls as the old app/app/approvals/page.tsx
 *  (kept verbatim: /api/content?status=awaiting_approval, approve/reject/copy endpoints, the
 *  optimistic 6s-Undo reject flow, and §7.7's "copy-only never says published" rule), restyled
 *  to the new dashboard's theme per the owner's standing instruction (2026-08-29). Rendered
 *  inside <MrLxwaDashboard> as its `children` — see app/dashboard/approvals/page.tsx. */

type ContentItem = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  body: string | null;
  meta: { wordCount?: number; sections?: number; links?: number; network?: string; copyOnly?: boolean; imageBrief?: string } | null;
  created_at: string;
};

const ICO: Record<string, string> = { article: "📝", story: "🎨", social: "📣", gbp: "📍" };

const NETWORK_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", x: "X (Twitter)" };

function qcSummary(c: ContentItem): string {
  const m = c.meta ?? {};
  if (c.type === "article") return `${m.wordCount ?? "?"} words · ${m.sections ?? "?"} sections · ${m.links ?? 0} links`;
  return "Ready for review";
}

export default function ApprovalsSection() {
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
        if (data.copyOnly) {
          report(`Approved for copying — not posted anywhere: "${c.title}"`);
          toast("Marked ready — copy the text and post it yourself.");
        } else {
          act(`"It's live. Prepare distribution."`, "Mr Lxwa", "Miss Social");
          report(`Published after your approval: "${c.title}"`);
          toast(data.url ? `Published! ${data.url}` : "Published!");
        }
        setItems((prev) => prev.filter((x) => x.id !== c.id));
      } else {
        toast(`${c.type === "social" ? "Couldn't approve" : "Publish failed"}: ${data.error}`, "error");
      }
    } catch {
      toast("Network error — try again.", "error");
    } finally {
      setBusy(null);
    }
  };

  const copyPost = async (c: ContentItem) => {
    try {
      await navigator.clipboard.writeText(c.body ?? "");
      toast("Copied — paste it into the app.");
    } catch {
      toast("Couldn't copy — select and copy the text manually.", "error");
    }
  };

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
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold">Approvals</h1>
        <Link
          href="/help/approval"
          className="lx-10 lx-mut flex h-4 w-4 items-center justify-center rounded-full"
          style={{ border: "1px solid var(--lx-border)" }}
          title="What is this?"
        >
          ?
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <div className="lx-card2 p-6"><p className="lx-11 lx-mut">Loading…</p></div>
        ) : items.length ? items.map((c) => (
          <div key={c.id} className="lx-card2 flex flex-col p-4">
            <div className="mb-3 flex items-center gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base"
                style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)" }}
              >
                {ICO[c.type] ?? "📄"}
              </span>
              <div className="min-w-0 flex-1">
                <b className="lx-12 block truncate">{c.title || "Untitled"}</b>
                <div className="lx-10 lx-mut mt-0.5">
                  {c.type === "social" ? (c.meta?.network ? NETWORK_LABEL[c.meta.network] ?? c.meta.network : "social") : `${c.type} · quality gate ✓ passed`}
                  {" · "}{new Date(c.created_at).toLocaleString()}
                </div>
              </div>
            </div>

            {c.type === "social" ? (
              <>
                <p className="lx-in lx-11 p-3" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{c.body}</p>
                {c.meta?.imageBrief && <p className="lx-10 lx-mut mt-2">📷 {c.meta.imageBrief}</p>}
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <button className="lx-ghost" onClick={() => copyPost(c)}>Copy text</button>
                  <button className="lx-grad lx-11 px-3.5 py-2" disabled={busy === c.id} onClick={() => approve(c)}>
                    {busy === c.id ? "Marking…" : "✓ Mark ready"}
                  </button>
                  <button className="lx-ghost" style={{ color: "#f87171" }} disabled={busy === c.id} onClick={() => reject(c)}>
                    {busy === c.id ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="lx-in lx-11 lx-mut p-3" style={{ margin: 0 }}>{qcSummary(c)}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <Link href={`/app/content/${c.id}`} className="lx-grad lx-11 px-3.5 py-2">Read &amp; edit</Link>
                  <button className="lx-ghost" disabled={busy === c.id} onClick={() => approve(c)}>
                    {busy === c.id ? "Publishing…" : "✓ Approve & publish"}
                  </button>
                  <button className="lx-ghost" style={{ color: "#f87171" }} disabled={busy === c.id} onClick={() => reject(c)}>
                    {busy === c.id ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </>
            )}
          </div>
        )) : (
          <div className="lx-card2 col-span-full flex flex-col items-center gap-2 p-8 text-center">
            <div className="text-2xl">✨</div>
            <p className="lx-11 lx-mut">All clear — nothing waiting. Your team will notify you when new work is ready.</p>
          </div>
        )}
      </div>
    </div>
  );
}
