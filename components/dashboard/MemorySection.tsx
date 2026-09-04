"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Brain, Check, Globe, Link2, Loader2, Pencil, Plus, Search, Trash2, X,
} from "lucide-react";
import { useStore } from "@/lib/store";

/** /dashboard/memory — third pass, 2026-09-05. The owner didn't like the stat strip + four
 *  tabs + insight dumps ("sirf wo data dena hai jo zaroori ho… user friendly layout… colour
 *  theek karo"), so this is now one quiet page:
 *
 *   1. Business facts — the only thing you actually edit here, as a plain card grid.
 *   2. Where this comes from — three one-line rows: your site, what's connected, Google.
 *
 *  Everything else the old page printed (query tables, top pages, sample page lists) lives
 *  where it belongs — Connect and Site Brain — and is linked to instead of duplicated.
 *
 *  Logic and API calls unchanged: /api/dashboard/status, /api/insights, and saveMemory() from
 *  lib/store.tsx (writes to the database). Nothing is invented: not connected says so. */

type Status = {
  tenant: { websiteUrl: string | null; niche: string | null; topics: string[]; onboarded: boolean };
  integrations: { type: string; status: string; connectedAt: string }[];
  crawl: { pagesIndexed: number; samplePages: { title: string; url: string }[] };
};

const INTEGRATION_LABEL: Record<string, string> = {
  wordpress: "WordPress",
  webhook: "Webhook",
  google: "Google",
  social_x: "X (Twitter)",
  social_linkedin: "LinkedIn",
  social_facebook: "Facebook",
  social_instagram: "Instagram",
};

export default function MemorySection() {
  const { s, toast, act, saveMemory, confirmAction } = useStore();
  const [edit, setEdit] = useState<number | null>(null);
  const [val, setVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [nk, setNk] = useState("");
  const [nv, setNv] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<any>(null);

  useEffect(() => {
    fetch("/api/dashboard/status")
      .then((r) => r.json())
      .then((d) => { if (d.ok) setStatus(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch("/api/insights")
      .then((r) => (r.ok ? r.json() : null))
      .then(setInsights)
      .catch(() => {});
  }, []);

  const save = (i: number) => {
    saveMemory(s.memory.map((m: any, j: number) => (j === i ? { ...m, v: val } : m)));
    act(`"Noted. All agents realigned."`, "Mr Lxwa");
    toast("Memory updated — team adjusted.");
    setEdit(null);
  };
  const del = async (i: number) => {
    const m = s.memory[i];
    const ok = await confirmAction({
      title: `Delete "${m?.k ?? "this fact"}"?`,
      body: "Every agent stops using it immediately. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    act(`"Forgotten."`, "Mr Lxwa");
    saveMemory(s.memory.filter((_: any, j: number) => j !== i));
    toast("Removed.");
  };
  const add = () => {
    if (!nk.trim() || !nv.trim()) return toast("Both fields needed", "info");
    saveMemory([...s.memory, { k: nk.trim(), v: nv.trim() }]);
    act(`learned something new from you: <b>${nk.trim()}</b>.`, "Mr Lxwa");
    toast("Team memory updated.");
    setAdding(false);
    setNk("");
    setNv("");
  };

  const connected = (status?.integrations ?? []).filter((i) => i.status === "connected");
  const site = status?.tenant.websiteUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? null;
  const pages = status?.crawl.pagesIndexed ?? 0;
  const googleOn = !!insights?.connected;

  return (
    <div className="mm-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <section className="mm-panel flex min-w-0 flex-1 flex-col">
        <header className="mm-head">
          <div className="min-w-0 flex-1">
            <h1 className="mm-h1">AI Memory</h1>
            <p className="mm-sub">The facts your team writes from. Change one and every agent follows it.</p>
          </div>
          <button className="mm-add" onClick={() => setAdding(true)}><Plus size={15} /> <span className="mm-add-t">Add fact</span></button>
        </header>

        <div className="lx-scroll flex-1 overflow-y-auto px-5 pb-6">
          {/* ---------------- the facts ---------------- */}
          <div className="mm-sec">Business facts</div>

          {!s.memory.length ? (
            <div className="mm-empty">
              <Brain size={20} className="lx-mut" />
              <b className="lx-12 mt-2">Nothing taught yet</b>
              <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 340 }}>
                Add what you sell, who you sell to, and anything you never want mentioned.
              </p>
              <button className="mm-add mt-3" onClick={() => setAdding(true)}><Plus size={15} /> Add fact</button>
            </div>
          ) : (
            <div className="mm-grid">
              {s.memory.map((m: any, i: number) => (
                <div key={i} className={`mm-fact ${edit === i ? "editing" : ""}`}>
                  <div className="mm-k">{m.k}</div>
                  {edit === i ? (
                    <input
                      autoFocus className="mm-in" value={val}
                      onChange={(e) => setVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") save(i); if (e.key === "Escape") setEdit(null); }}
                    />
                  ) : (
                    <div className="mm-v">{m.v}</div>
                  )}
                  <div className="mm-acts">
                    {edit === i ? (
                      <>
                        <button className="mm-ico ok" onClick={() => save(i)} title="Save"><Check size={14} /></button>
                        <button className="mm-ico" onClick={() => setEdit(null)} title="Cancel"><X size={14} /></button>
                      </>
                    ) : (
                      <>
                        <button className="mm-ico" onClick={() => { setEdit(i); setVal(m.v); }} title="Edit" aria-label={`Edit ${m.k}`}><Pencil size={13} /></button>
                        <button className="mm-ico" onClick={() => del(i)} title="Delete" aria-label={`Delete ${m.k}`}><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ---------------- where it comes from ---------------- */}
          <div className="mm-sec mt-6">Where this comes from</div>

          {loading ? (
            <div className="mm-line"><Loader2 size={15} className="mm-spin lx-mut" /><span className="lx-11 lx-mut">Checking…</span></div>
          ) : (
            <div className="mm-lines">
              <div className="mm-line">
                <Globe size={15} className="mm-line-i" />
                <span className="mm-line-t">
                  {site ? <>Your site <b>{site}</b></> : "No site connected"}
                  {pages > 0 && <span className="lx-mut"> — {pages} page{pages === 1 ? "" : "s"} read</span>}
                </span>
                <Link href="/dashboard/site-brain" className="mm-line-a">Site Brain</Link>
              </div>

              <div className="mm-line">
                <Link2 size={15} className="mm-line-i" />
                <span className="mm-line-t">
                  {connected.length
                    ? <>Connected: <b>{connected.map((i) => INTEGRATION_LABEL[i.type] ?? i.type).join(", ")}</b></>
                    : "Nothing connected yet — the team has nowhere to publish"}
                </span>
                <Link href="/dashboard/connect" className="mm-line-a">Connect</Link>
              </div>

              <div className="mm-line">
                <Search size={15} className="mm-line-i" />
                <span className="mm-line-t">
                  {googleOn
                    ? <>Google search data: <b>{insights.totals?.queries ?? 0}</b> queries<span className="lx-mut"> the team writes towards</span></>
                    : "Google isn't connected — no search data to learn from"}
                </span>
                <Link href="/dashboard/connect" className="mm-line-a">{googleOn ? "Refresh" : "Connect"}</Link>
              </div>
            </div>
          )}

          <Link href="/whoami" className="mm-note">
            <Brain size={15} className="mm-line-i" />
            <span>Read Mr Lxwa&apos;s full understanding of your business</span>
          </Link>
        </div>
      </section>

      {/* add-fact dialog */}
      {adding && (
        <div className="mm-modal" role="dialog" aria-modal="true" onClick={() => setAdding(false)}>
          <div className="mm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mm-sheet-h">
              <b className="lx-13">Teach the team something</b>
              <button className="mm-ico ml-auto" onClick={() => setAdding(false)} aria-label="Close"><X size={15} /></button>
            </div>
            <div className="p-4">
              <label className="mm-label">Label</label>
              <input className="mm-in w-full" placeholder="e.g. Products, Audience, Never mention…" value={nk} onChange={(e) => setNk(e.target.value)} />
              <label className="mm-label mt-3">Fact</label>
              <textarea
                rows={4} className="mm-in w-full" style={{ height: "auto", padding: "9px 11px", lineHeight: 1.6 }}
                placeholder="What should your team know?" value={nv} onChange={(e) => setNv(e.target.value)}
              />
              <div className="mt-4 flex gap-2">
                <button className="mm-btn flex-1" onClick={() => setAdding(false)}>Cancel</button>
                <button className="mm-add flex-1" style={{ justifyContent: "center" }} onClick={add}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Quieter than the rest of the app on purpose: this page is a list of sentences about the
   business, so it is one accent (indigo) on neutral cards — no per-item colour, no tinted stat
   tiles. Injected with dangerouslySetInnerHTML — React escapes ">" inside a <style> text child,
   which turns every child selector into a hydration mismatch. */
const CSS = `
.mm-wrap{display:flex;height:100%;min-height:0;container-type:inline-size;container-name:mm}
.mm-panel{background:#0a0a11;border:1px solid var(--lx-border);border-radius:16px;min-width:0;width:100%}
.mm-head{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:18px 20px 16px;border-bottom:1px solid var(--lx-border)}
.mm-h1{font-size:20px;font-weight:700;letter-spacing:-.01em;color:#f5f5fa;line-height:1.15}
.mm-sub{margin-top:3px;font-size:12.5px;color:#8b8ba0;line-height:1.5}
.mm-add{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:9px;white-space:nowrap;
  background:#4f46e5;border:1px solid #6366f1;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;
  text-decoration:none;transition:.15s}
.mm-add:hover{background:#5b52ea}
@container mm (max-width:480px){.mm-add-t{display:none}.mm-add{padding:0 11px}}
.mm-sec{margin-top:20px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#6f6f85}
.mm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-top:10px}
@container mm (max-width:640px){.mm-grid{grid-template-columns:1fr}}
.mm-fact{position:relative;padding:13px 14px;border-radius:12px;background:#101018;border:1px solid #1e1e2b;transition:.15s}
.mm-fact:hover{border-color:#2c2c40;background:#12121c}
.mm-fact.editing{border-color:rgba(99,102,241,.55)}
.mm-k{font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#7c7c95}
.mm-v{margin-top:5px;padding-right:56px;font-size:13.5px;line-height:1.55;color:#e9e9f2;overflow-wrap:anywhere}
.mm-acts{position:absolute;top:10px;right:10px;display:flex;gap:4px;opacity:0;transition:opacity .15s}
.mm-fact:hover .mm-acts,.mm-fact.editing .mm-acts,.mm-fact:focus-within .mm-acts{opacity:1}
.mm-ico{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex-shrink:0;border-radius:7px;
  background:#191925;border:1px solid #262636;color:#9a9ab2;cursor:pointer;transition:.15s}
.mm-ico:hover{color:#fff;border-color:#3a3a52;background:#1f1f2e}
.mm-ico.ok{color:#4ade80;border-color:rgba(34,197,94,.35)}
.mm-in{width:100%;margin-top:5px;height:32px;padding:0 10px;border-radius:8px;background:#0a0a11;border:1px solid #2c2c40;
  color:#e9e9f2;font-size:13px;outline:none}
.mm-in:focus{border-color:rgba(99,102,241,.6)}
.mm-in::placeholder{color:#5a5a72}
.mm-label{display:block;margin-bottom:5px;font-size:11px;color:#8b8ba0}
.mm-btn{display:inline-flex;align-items:center;justify-content:center;height:34px;padding:0 14px;border-radius:9px;
  background:#191925;border:1px solid #262636;color:#d6d6e4;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.mm-btn:hover{color:#fff;border-color:#3a3a52}
.mm-lines{margin-top:10px;border-radius:12px;background:#101018;border:1px solid #1e1e2b;overflow:hidden}
.mm-line{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px}
.mm-lines .mm-line+.mm-line{border-top:1px solid #1a1a26}
.mm-line-i{flex-shrink:0;color:#7c7c95}
.mm-line-t{flex:1;min-width:180px;font-size:12.5px;color:#c8c8d8;line-height:1.5;overflow-wrap:anywhere}
.mm-line-t b{color:#f0f0f7;font-weight:600}
.mm-line-a{flex-shrink:0;font-size:11.5px;font-weight:600;color:#8f95ff;text-decoration:none}
.mm-line-a:hover{text-decoration:underline}
.mm-note{display:flex;align-items:center;gap:10px;margin-top:10px;padding:12px 14px;border-radius:12px;background:#0d0d15;
  border:1px dashed #232332;font-size:12.5px;color:#c8c8d8;text-decoration:none;transition:.15s}
.mm-note:hover{border-color:#3a3a52;color:#fff}
.mm-empty{display:flex;flex-direction:column;align-items:center;text-align:center;margin-top:10px;padding:30px 20px;
  border-radius:12px;background:#101018;border:1px dashed #232332}
.mm-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(4,4,10,.7);backdrop-filter:blur(3px)}
.mm-sheet{width:min(440px,100%);border-radius:16px;background:#0c0c14;border:1px solid #26263a;
  box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden}
.mm-sheet-h{display:flex;align-items:center;gap:10px;padding:13px 14px;border-bottom:1px solid #1e1e2b}
.mm-spin{animation:mmSpin 1s linear infinite}
@keyframes mmSpin{to{transform:rotate(360deg)}}
`;
