"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { renderMarkdown } from "@/lib/md";
import { useStore } from "@/lib/store";

/** Read the article like a reader would, then change it — by hand or by asking.
 *
 *  Before this, reviewing meant reading the first line on an Approvals card and approving on
 *  faith. Here the draft is rendered as a real page, Edit gives you the markdown directly,
 *  and the panel on the right takes plain instructions ("make the intro shorter", "add a
 *  section on pricing") and rewrites the draft.
 *
 *  Nothing an instruction produces is saved until you press Save. A revision that lands badly
 *  costs one Undo, not the draft — which is also why the undo stack is local and not a
 *  server round trip.
 */

type Item = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  body: string | null;
  meta: { wordCount?: number; sections?: number; links?: number; qualityGate?: any } | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting_approval: "Waiting for you",
  approved: "Approved",
  published: "Published",
  failed: "Failed the quality gate",
  rejected: "Rejected",
};

/** The editing half of the reviewer. The article itself arrives as a prop, already read from
 *  the database by the server component in app/app/content/[id]/page.tsx.
 *
 *  That split is the point. This page rendered as a black rectangle for days — no markup, no
 *  console error, no error boundary — because everything, including the very first pixel,
 *  waited on a client-side fetch inside a client-only page. Now the server renders the
 *  article into the HTML, and this component only adds the things that genuinely need a
 *  browser: the tabs, the editor, the AI instructions and the buttons. If the client half
 *  ever fails again, the article is still on screen. */
export default function ArticleReview({ item, editable, id }: { item: Item; editable: boolean; id: string }) {
  const { toast, act, report, confirmAction } = useStore();
  const router = useRouter();

  const [tab, setTab] = useState<"read" | "edit">("read");
  const [body, setBody] = useState(item.body ?? "");
  const [title, setTitle] = useState(item.title ?? "");
  const [savedBody, setSavedBody] = useState(item.body ?? "");
  const [savedTitle, setSavedTitle] = useState(item.title ?? "");

  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([]);
  const undoStack = useRef<string[]>([]);
  const [busy, setBusy] = useState("");

  const dirty = body !== savedBody || title !== savedTitle;

  // Leaving with unsaved edits is almost always a mistake — the browser's own prompt is the
  // only one that can't be missed.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Rendered synchronously: no promise, no effect, no third-party bundle to fail to load.
  const html = useMemo(() => renderMarkdown(body), [body]);
  const stats = useMemo(() => liveStats(body), [body]);

  const revise = async () => {
    const text = instruction.trim();
    if (!text || revising) return;
    setRevising(true);
    try {
      const res = await fetch(`/api/content/${id}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text, body }),
      });
      const data = await res.json();
      if (!data.ok) { setLog((l) => [...l, { text: data.error ?? "Revision failed.", ok: false }]); return; }
      undoStack.current.push(body);
      setBody(data.body);
      setLog((l) => [...l, { text, ok: true }]);
      setInstruction("");
      setTab("read"); // you asked for a change — look at it, don't hunt for it in markdown
    } catch (e: any) {
      setLog((l) => [...l, { text: e?.message ?? "Network error.", ok: false }]);
    } finally {
      setRevising(false);
    }
  };

  const undo = () => {
    const prev = undoStack.current.pop();
    if (prev === undefined) return;
    setBody(prev);
    setLog((l) => l.slice(0, -1));
  };

  const save = async () => {
    setBusy("save");
    try {
      const res = await fetch(`/api/content/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, title }),
      });
      const data = await res.json();
      if (!data.ok) { toast(data.error ?? "Save failed.", "error"); return; }
      setSavedBody(body);
      setSavedTitle(title);
      undoStack.current = [];
      toast("Saved.");
    } catch (e: any) {
      toast(`Save failed: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy("");
    }
  };

  const approve = async () => {
    if (dirty) { toast("Pehle changes save karo, phir publish.", "info"); return; }
    setBusy("approve");
    try {
      const res = await fetch(`/api/content/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) { toast(data.error ?? "Publish failed.", "error"); return; }
      act(`"It's live."`, "Mr Lxwa");
      report(`Published after your approval: "${title}"`);
      toast(data.url ? `Published! ${data.url}` : "Published!");
      router.push("/app/approvals");
    } catch (e: any) {
      toast(`Publish failed: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy("");
    }
  };

  const reject = async () => {
    const ok = await confirmAction({
      title: "Reject this article?",
      body: "It leaves the approval queue and the team treats it as feedback. This can't be undone here.",
      confirmLabel: "Reject",
      danger: true,
    });
    if (!ok) return;
    setBusy("reject");
    try {
      const res = await fetch(`/api/content/${id}/reject`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast("Rejected — the team will adjust.");
      router.push("/app/approvals");
    } catch (e: any) {
      toast(`Reject failed: ${e?.message ?? "network error"}`, "error");
    } finally {
      setBusy("");
    }
  };

  // The chrome renders unconditionally. Returning a bare <p> for the loading and error
  // states meant that if anything at all went wrong the whole page was an empty black
  // rectangle with no way back — which is indistinguishable from a broken app.
  return (
    <div className="rv">
      <div className="rv-top">
        <Link href="/app/approvals" className="rv-back">← Approvals</Link>
        <span className="rv-status">{STATUS_LABEL[item.status] ?? item.status}</span>
        <span className="rv-stats">{stats.words} words · {stats.sections} sections · {stats.links} links</span>
        {dirty && <span className="rv-dirty">Unsaved changes</span>}
      </div>

      <div className="rv-cols">
        <div className="rv-main">
          <div className="rv-tabs">
            <button className={tab === "read" ? "on" : ""} onClick={() => setTab("read")}>Read</button>
            <button className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")} disabled={!editable}>
              Edit by hand
            </button>
          </div>

          {tab === "read" ? (
            // The article as a reader gets it. See useMarkdown() for why raw HTML is neutered.
            body.trim()
              ? <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
              // An empty body is a real state (a job that failed mid-write leaves one), and a
              // blank panel is indistinguishable from a broken page — say which it is.
              : <p className="rv-empty">This item has no article text stored. Nothing was written, or the draft was cleared.</p>
          ) : (
            <div className="rv-edit">
              <label className="rv-lbl">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
              <label className="rv-lbl">Article (markdown)</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} spellCheck />
              <p className="rv-hint"># is the title, ## starts a section, **bold**, [text](https://link).</p>
            </div>
          )}
        </div>

        <aside className="rv-side">
          <h3>Ask for a change</h3>
          {!editable ? (
            <p className="rv-note">
              This one is <b>{STATUS_LABEL[item.status] ?? item.status}</b>. Re-publishing an edit isn&apos;t wired yet,
              so it&apos;s read-only here — editing would leave this copy and your live site disagreeing.
            </p>
          ) : (
            <>
              <p className="rv-note">
                Plain English ya Hinglish. Har change sirf yahan dikhega — <b>Save</b> dabane tak kuch likha nahi jaata.
              </p>

              <div className="rv-chat">
                {log.map((l, i) => (
                  <div key={i} className={"rv-msg" + (l.ok ? "" : " is-err")}>{l.ok ? `✎ ${l.text}` : l.text}</div>
                ))}
                {revising && <div className="rv-msg is-live">Rewriting the draft… (~1 min for a full article)</div>}
              </div>

              <textarea
                className="rv-ask"
                placeholder={"e.g. intro chhota karo\nadd a section about pricing\nremove the last paragraph"}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) revise(); }}
                disabled={revising}
              />
              <div className="rv-askrow">
                <button className="btn btn-p" onClick={revise} disabled={revising || !instruction.trim()}>
                  {revising ? "Working…" : "Apply change"}
                </button>
                <button className="rv-undo" onClick={undo} disabled={!undoStack.current.length}>Undo</button>
              </div>
            </>
          )}

          <div className="rv-actions">
            {editable && (
              <button className="btn btn-p" onClick={save} disabled={!dirty || !!busy}>
                {busy === "save" ? "Saving…" : "Save changes"}
              </button>
            )}
            {item.status === "awaiting_approval" && (
              <>
                <button className="btn btn-p rv-pub" onClick={approve} disabled={!!busy}>
                  {busy === "approve" ? "Publishing…" : "✓ Approve & publish"}
                </button>
                <button className="rv-rej" onClick={reject} disabled={!!busy}>Reject</button>
              </>
            )}
          </div>
        </aside>
      </div>

      <style jsx>{`
        .rv { max-width: 1180px; }
        .rv-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
        .rv-back { font-size: 12px; color: var(--ac); font-weight: 600; }
        .rv-status { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 7px;
                     background: var(--panel2); color: var(--mut); }
        .rv-stats { font-size: 11px; color: var(--mut2); }
        .rv-dirty { font-size: 10.5px; font-weight: 700; color: var(--amb); }

        .rv-cols { display: grid; grid-template-columns: minmax(0, 1fr) 310px; gap: 18px; align-items: start; }
        @media (max-width: 900px) { .rv-cols { grid-template-columns: 1fr; } }

        .rv-main { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
        .rv-tabs { display: flex; gap: 2px; padding: 8px 8px 0; border-bottom: 1px solid var(--line); }
        .rv-tabs button { background: none; border: none; cursor: pointer; font-size: 12px; font-weight: 600;
                          color: var(--mut); padding: 8px 13px; border-radius: 9px 9px 0 0; }
        .rv-tabs button.on { color: var(--ink); background: var(--panel2); }
        .rv-tabs button:disabled { opacity: .4; cursor: default; }

        .rv-edit { padding: 16px 18px; }
        .rv-lbl { display: block; font-size: 10.5px; font-weight: 700; letter-spacing: .5px;
                  color: var(--mut2); margin: 10px 0 5px; }
        .rv-edit input, .rv-edit textarea { width: 100%; background: var(--bg2); border: 1px solid var(--line2);
                                            border-radius: 9px; padding: 10px 12px; color: var(--ink);
                                            font-size: 13px; font-family: inherit; }
        .rv-edit textarea { min-height: 62vh; line-height: 1.7; resize: vertical;
                            font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
        .rv-hint { font-size: 10.5px; color: var(--mut2); margin: 7px 0 0; }
        .rv-empty { padding: 40px 24px; text-align: center; color: var(--mut); font-size: 13px; margin: 0; }

        .rv-side { background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
                   padding: 15px 16px; position: sticky; top: 12px; }
        .rv-side h3 { font-size: 13.5px; margin: 0 0 7px; }
        .rv-note { font-size: 11px; color: var(--mut); line-height: 1.55; margin: 0 0 11px; }
        .rv-chat { display: flex; flex-direction: column; gap: 6px; max-height: 230px; overflow-y: auto;
                   margin-bottom: 10px; }
        .rv-msg { font-size: 11.5px; background: var(--panel2); border-radius: 9px; padding: 7px 10px;
                  color: var(--ink); line-height: 1.5; }
        .rv-msg.is-err { color: #ff6b6b; }
        .rv-msg.is-live { color: var(--mut); }
        .rv-ask { width: 100%; min-height: 74px; background: var(--bg2); border: 1px solid var(--line2);
                  border-radius: 9px; padding: 9px 11px; color: var(--ink); font-size: 12.5px;
                  font-family: inherit; resize: vertical; }
        .rv-askrow { display: flex; gap: 8px; margin-top: 8px; }
        .rv-undo { background: none; border: 1px solid var(--line2); color: var(--mut); font-size: 11.5px;
                   font-weight: 600; padding: 8px 13px; border-radius: 9px; cursor: pointer; }
        .rv-undo:disabled { opacity: .4; cursor: default; }

        .rv-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 15px;
                      padding-top: 13px; border-top: 1px solid var(--line); }
        .rv-pub { background: var(--grn); border-color: var(--grn); }
        .rv-rej { background: none; border: 1px solid var(--line2); color: var(--mut); font-size: 12px;
                  font-weight: 600; padding: 9px; border-radius: 9px; cursor: pointer; }
        .rv-rej:hover { color: #ff6b6b; border-color: #ff6b6b; }
      `}</style>

    </div>
  );
}

/** Recomputed as you type, so the header never quotes the length of a draft you just changed. */
function liveStats(md: string) {
  return {
    words: md.replace(/[#*_`>[\]()-]/g, " ").split(/\s+/).filter(Boolean).length,
    sections: (md.match(/^##\s+/gm) ?? []).length,
    links: (md.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g) ?? []).length,
  };
}
