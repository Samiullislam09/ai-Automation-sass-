"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity, ArrowRight, Brain, Check, ChevronLeft, ChevronRight, Globe, History, Loader2, PlugZap, Plus,
  RotateCw, Search, X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import SiteBrainField, { SiteBrainFieldStyles } from "@/components/SiteBrainField";
import {
  FIELD_META,
  FRIENDLY_LABEL,
  previewOf,
  isFieldEmpty,
  normalizeProfile,
  PROFILE_FIELDS,
  type BuiltFrom,
  type ProfileField,
  type ProfileVersion,
  type SiteProfile,
} from "@/components/SiteBrainModel";

/** /dashboard/site-brain — page chrome rebuilt 2026-09-05 on the same quiet theme as Memory:
 *  one panel, a header with the two real actions, a plain summary line, and the field groups as
 *  neutral cards. Neutral surfaces, one indigo accent — the colour on this page should come
 *  from the content, not the chrome.
 *
 *  Logic and API calls are unchanged: /api/site-brain GET/PATCH and /api/agents/trigger. The
 *  field editor (components/SiteBrainField.tsx — offerings, proof, topic clusters,
 *  voice, goals, RepeatRows) is reused unmodified: real, complex, tested logic, and
 *  MrLxwaDashboard remaps the old theme's CSS tokens so it renders in-theme (see the "legacy
 *  /app/** theme bridge" comment there). */

type Payload = {
  ok: boolean;
  error?: string;
  schemaReady: boolean;
  pagesCrawled: number;
  profile: SiteProfile | null;
  version: number | null;
  builtAt: string | null;
  builtBy: string | null;
  builtFrom: BuiltFrom;
  history: ProfileVersion[];
};

export default function SiteBrainSection() {
  const { toast, report } = useStore();
  const [state, setState] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ProfileField | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [openField, setOpenField] = useState<ProfileField | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/site-brain")
      .then((r) => r.json())
      .then((data: Payload) => {
        if (data.ok) setState({ ...data, profile: data.profile ? normalizeProfile(data.profile) : null });
        else toast(data.error || "Couldn't load your Site Brain.", "error");
      })
      .catch(() => toast("Couldn't load your Site Brain — try refreshing.", "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const save = async (field: ProfileField, value: unknown): Promise<boolean> => {
    setBusy(field);
    try {
      const res = await fetch("/api/site-brain", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || "Couldn't save that change.", "error");
        return false;
      }
      if (data.unchanged) {
        toast("Nothing changed.");
        return true;
      }
      setState((prev) =>
        prev ? { ...prev, profile: normalizeProfile(data.profile), version: data.version, builtAt: data.builtAt, builtBy: "user" } : prev
      );
      report(`You corrected the Site Brain: ${field.replace(/_/g, " ")} (now v${data.version}).`);
      toast("Saved — the team will use your version from now on.");
      return true;
    } catch {
      toast("Couldn't save — network error.", "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (type: "crawler" | "analyst") => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/agents/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || "Couldn't start the refresh.", "error");
        return;
      }
      toast(
        type === "crawler"
          ? "Reading your site again — watch it in the Workspace."
          : "Rebuilding the profile from the pages we already have."
      );
    } catch {
      toast("Couldn't start the refresh — network error.", "error");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !state) {
    return (
      <Shell>
        <div className="sb-loading"><Loader2 size={16} className="sb-spin lx-mut" /><span className="lx-11 lx-mut">Loading…</span></div>
      </Shell>
    );
  }

  const s = state;
  if (!s) {
    return (
      <Shell>
        <Empty Icon={Brain} title="Couldn't load it" body="Something went wrong reading your Site Brain. Refresh the page to try again." />
      </Shell>
    );
  }

  if (!s.schemaReady) {
    return (
      <Shell>
        <Empty
          Icon={Brain}
          title="Not set up on this database yet"
          body="The Site Brain tables (migration 019) haven't been applied here. Nothing you can do from this screen — this one is for whoever runs the database."
        />
      </Shell>
    );
  }

  if (!s.pagesCrawled) {
    return (
      <Shell>
        <Empty
          Icon={PlugZap}
          title="We haven't read your site yet"
          body="The Site Brain is built from your own pages. Connect your website and we'll read it — then this page fills itself in."
          action={<Link href="/dashboard/connect" className="sb-primary">Connect your website</Link>}
        />
      </Shell>
    );
  }

  if (!s.profile) {
    return (
      <Shell>
        <Empty
          Icon={Search}
          title={`${s.pagesCrawled} pages read — nothing understood yet`}
          body="Mr. Analyst turns those pages into the profile every other agent reads. He may still be working; if not, start him here."
          action={
            <button className="sb-primary" disabled={refreshing} onClick={() => refresh("analyst")}>
              {refreshing ? "Starting…" : "Understand my site"}
            </button>
          }
        />
      </Shell>
    );
  }

  const profile = s.profile;
  const filled = (f: ProfileField) => !isFieldEmpty(profile, f);
  const known = PROFILE_FIELDS.filter(filled).length;
  const missing = PROFILE_FIELDS.length - known;
  const pct = Math.round((known / PROFILE_FIELDS.length) * 100);
  const firstGap = PROFILE_FIELDS.find((f) => !filled(f)) ?? null;

  return (
    <Shell
      right={
        <>
          <button className="sb-btn" disabled={refreshing} onClick={() => refresh("crawler")} title="Read my website again and rebuild this">
            {refreshing ? <Loader2 size={14} className="sb-spin" /> : <RotateCw size={14} />} Read my site again
          </button>
          <Link href="/dashboard/workspace" className="sb-btn"><Activity size={14} /> Watch it work</Link>
        </>
      }
    >
      {/* overview — the same shape the Memory page uses: a section label and one-line rows */}
      <div className="sb-sec">Overview</div>
      <div className="sb-lines">
        <div className="sb-line">
          <Brain size={15} className="sb-line-i" />
          <span className="sb-line-t">
            {missing === 0
              ? <>Your team knows <b>everything</b> on this list</>
              : <>Your team knows <b>{known} of {PROFILE_FIELDS.length}</b> things about your business</>}
            <span className="sb-bar"><i style={{ width: `${pct}%` }} /></span>
          </span>
          {firstGap ? (
            <button className="sb-line-a" onClick={() => setOpenField(firstGap)}>Fill the next gap <ArrowRight size={12} /></button>
          ) : (
            <span className="sb-line-done">All done</span>
          )}
        </div>

        <div className="sb-line">
          <Globe size={15} className="sb-line-i" />
          <span className="sb-line-t">Read from <b>{s.builtFrom?.pages ?? s.pagesCrawled} pages</b> on your website</span>
          <button className="sb-line-a" disabled={refreshing} onClick={() => refresh("crawler")}>
            {refreshing ? "Starting…" : "Read again"}
          </button>
        </div>

        <div className="sb-line">
          <History size={15} className="sb-line-i" />
          <span className="sb-line-t">
            Version <b>{s.version}</b> {s.builtBy === "user" ? "— your edit" : "— built by the team"}
            {s.builtAt ? ` · ${new Date(s.builtAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
          </span>
          {s.history.length > 1 && (
            <button className="sb-line-a" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Hide" : `${s.history.length} versions`}
            </button>
          )}
        </div>
      </div>

      {showHistory && (
        <div className="sb-hist">
          {s.history.map((h) => (
            <div key={h.id} className="sb-hist-r">
              <b className="lx-11">v{h.version}</b>
              <span className="lx-10 lx-mut">
                {h.created_by === "user" ? "your edit" : "the team"}
                {h.pages ? ` · ${h.pages} pages` : ""}
                {h.created_at ? ` · ${new Date(h.created_at).toLocaleString()}` : ""}
              </span>
              {h.active && <span className="sb-now">now</span>}
            </div>
          ))}
        </div>
      )}

      <div className="sb-sec">What your team knows</div>

      {/* the whole brain as one plain checklist — each line opens a popup to read, add or
          correct that one fact (owner, 2026-09-05: popup, not a separate page) */}
      <div className="sb-list">
        {PROFILE_FIELDS.map((f) => {
          const has = filled(f);
          return (
            <button key={f} className={`sb-item ${has ? "" : "gap"}`} onClick={() => setOpenField(f)}>
              <span className={`sb-mark ${has ? "ok" : ""}`}>{has ? <Check size={12} /> : <Plus size={12} />}</span>
              <span className="min-w-0 flex-1">
                <span className="sb-item-t">{FRIENDLY_LABEL[f] ?? FIELD_META[f].label}</span>
                <span className="sb-item-p">{has ? previewOf(profile, f) : "Not added yet — tap to add"}</span>
              </span>
              <span className="sb-go">{has ? "View" : "Add"} <ChevronRight size={14} /></span>
            </button>
          );
        })}
      </div>

      {openField && (
        <FieldPopup
          field={openField}
          profile={profile}
          busy={busy === openField}
          onSave={save}
          onClose={() => setOpenField(null)}
          onGo={setOpenField}
        />
      )}

      <SiteBrainFieldStyles />
    </Shell>
  );
}

/* ---------------------------------------------------------------------------------------- */

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="sb-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <section className="sb-panel flex min-w-0 flex-1 flex-col">
        <header className="sb-head">
          <div className="min-w-0 flex-1">
            <h1 className="sb-h1">Site Brain</h1>
            <p className="sb-sub">
              What your team understood about your business. Correct anything — once you do, the agents stop rewriting it.
            </p>
          </div>
          {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </header>
        <div className="lx-scroll flex-1 overflow-y-auto px-5 pb-6 pt-4">{children}</div>
      </section>
    </div>
  );
}

/** One fact, in a popup: its name, what it is for, the answer with its sources, and the editor.
 *  An empty field opens straight into the editor — adding it is the only reason to be here.
 *  Escape and the backdrop close it; the arrows walk the twelve without closing. */
function FieldPopup({ field, profile, busy, onSave, onClose, onGo }: {
  field: ProfileField;
  profile: SiteProfile;
  busy: boolean;
  onSave: (f: ProfileField, v: unknown) => Promise<boolean>;
  onClose: () => void;
  onGo: (f: ProfileField) => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [onClose]);

  const i = PROFILE_FIELDS.indexOf(field);
  const prev = i > 0 ? PROFILE_FIELDS[i - 1] : null;
  const next = i < PROFILE_FIELDS.length - 1 ? PROFILE_FIELDS[i + 1] : null;
  const empty = isFieldEmpty(profile, field);

  return (
    <div className="sb-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sb-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sb-sheet-h">
          <div className="min-w-0 flex-1">
            <div className="sb-sheet-t">{FRIENDLY_LABEL[field] ?? FIELD_META[field].label}</div>
            <div className="sb-sheet-s">{FIELD_META[field].hint}</div>
          </div>
          <button className="sb-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="lx-scroll sb-sheet-b">
          <SiteBrainField
            key={field}
            bare
            autoEdit={empty}
            meta={FIELD_META[field]}
            profile={profile}
            busy={busy}
            onSave={onSave}
          />
        </div>

        <footer className="sb-sheet-f">
          {prev ? (
            <button className="sb-navbtn" onClick={() => onGo(prev)}>
              <ChevronLeft size={14} /> <span className="truncate">{FRIENDLY_LABEL[prev]}</span>
            </button>
          ) : <span />}
          {next && (
            <button className="sb-navbtn ml-auto" onClick={() => onGo(next)}>
              <span className="truncate">{FRIENDLY_LABEL[next]}</span> <ChevronRight size={14} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Empty({ Icon, title, body, action }: { Icon: React.ElementType; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="sb-empty">
      <Icon size={20} className="lx-mut" />
      <b className="lx-12 mt-2">{title}</b>
      <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 440 }}>{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* Neutral surfaces, one indigo accent — same quiet language as the Memory page. Injected with
   dangerouslySetInnerHTML: React escapes ">" inside a <style> text child, which turns every
   child selector into a hydration mismatch. */
const CSS = `
.sb-wrap{display:flex;height:100%;min-height:0;container-type:inline-size;container-name:sb}
.sb-panel{background:#0a0a11;border:1px solid var(--lx-border);border-radius:16px;min-width:0;width:100%}
.sb-head{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:18px 20px 16px;border-bottom:1px solid var(--lx-border)}
.sb-h1{font-size:20px;font-weight:700;letter-spacing:-.01em;color:#f5f5fa;line-height:1.15}
.sb-sub{margin-top:3px;max-width:560px;font-size:12.5px;color:#8b8ba0;line-height:1.5}
.sb-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 13px;border-radius:9px;white-space:nowrap;
  background:#191925;border:1px solid #262636;color:#d6d6e4;font-size:12.5px;font-weight:600;cursor:pointer;
  text-decoration:none;transition:.15s}
.sb-btn:hover:not(:disabled){color:#fff;border-color:#3a3a52}
.sb-btn:disabled{opacity:.5;cursor:not-allowed}
.sb-primary{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:9px;white-space:nowrap;
  background:#4f46e5;border:1px solid #6366f1;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;
  text-decoration:none;transition:.15s}
.sb-primary:hover:not(:disabled){background:#5b52ea}
.sb-primary:disabled{opacity:.55;cursor:not-allowed}
.sb-sec{font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#6f6f85}
.sb-list+.sb-sec,.sb-lines+.sb-sec,.sb-hist+.sb-sec{margin-top:22px}
.sb-lines{margin-top:10px;border-radius:12px;background:#101018;border:1px solid #1e1e2b;overflow:hidden}
.sb-line{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:13px 14px}
.sb-line+.sb-line{border-top:1px solid #1a1a26}
.sb-line-i{flex-shrink:0;color:#7c7c95}
.sb-line-t{flex:1;min-width:200px;font-size:12.5px;color:#c8c8d8;line-height:1.5}
.sb-line-t b{color:#f0f0f7;font-weight:600}
.sb-line-a{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;background:none;border:none;padding:0;
  font-size:11.5px;font-weight:600;color:#8f95ff;cursor:pointer}
.sb-line-a:hover:not(:disabled){text-decoration:underline}
.sb-line-a:disabled{opacity:.5;cursor:not-allowed}
.sb-line-done{flex-shrink:0;font-size:11.5px;font-weight:600;color:#4ade80}
.sb-bar{display:block;height:5px;margin-top:8px;border-radius:999px;background:#1c1c29;overflow:hidden;max-width:360px}
.sb-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#4f46e5,#8b5cf6)}
.sb-list{margin-top:10px;border-radius:12px;background:#101018;border:1px solid #1e1e2b;overflow:hidden}
.sb-item{display:flex;align-items:center;gap:12px;width:100%;padding:13px 15px;text-align:left;background:none;
  border:none;color:inherit;cursor:pointer;transition:.15s}
.sb-item+.sb-item{border-top:1px solid #1a1a26}
.sb-item:hover{background:#151520}
.sb-item:hover .sb-go{color:#fff;border-color:#3a3a52}
.sb-mark{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex-shrink:0;border-radius:50%;
  color:#f59e0b;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4)}
.sb-mark.ok{color:#4ade80;background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.35)}
.sb-item-t{display:block;font-size:13.5px;font-weight:600;color:#f0f0f7}
.sb-item-p{display:block;margin-top:2px;font-size:11.5px;color:#7c7c95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-item.gap .sb-item-p{color:#c08a2e}
.sb-go{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;height:28px;padding:0 10px;border-radius:8px;
  background:#191925;border:1px solid #262636;color:#9a9ab2;font-size:11.5px;font-weight:600;transition:.15s}
.sb-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(4,4,10,.72);backdrop-filter:blur(3px);animation:sbFade .12s ease-out}
@keyframes sbFade{from{opacity:0}to{opacity:1}}
.sb-sheet{display:flex;flex-direction:column;width:min(680px,100%);max-height:min(88vh,760px);border-radius:16px;
  background:#0c0c14;border:1px solid #26263a;box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden;
  animation:sbUp .16s ease-out}
@keyframes sbUp{from{transform:translateY(8px);opacity:.6}to{transform:none;opacity:1}}
.sb-sheet-h{display:flex;align-items:flex-start;gap:12px;padding:15px 16px;border-bottom:1px solid #1e1e2b}
.sb-sheet-t{font-size:17px;font-weight:700;color:#f5f5fa;line-height:1.25}
.sb-sheet-s{margin-top:3px;font-size:11.5px;color:#8b8ba0;line-height:1.5}
.sb-x{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border-radius:8px;
  background:#191925;border:1px solid #262636;color:#b6b6c8;cursor:pointer;transition:.15s}
.sb-x:hover{color:#fff;border-color:#3a3a52}
.sb-sheet-b{flex:1;min-height:0;overflow-y:auto;padding:15px 16px}
.sb-sheet-f{display:flex;align-items:center;gap:8px;padding:11px 16px;border-top:1px solid #1e1e2b;background:#0a0a11}
.sb-navbtn{display:inline-flex;align-items:center;gap:6px;max-width:48%;height:32px;padding:0 12px;border-radius:9px;
  background:#101018;border:1px solid #1e1e2b;color:#a8a8bd;font-size:11.5px;font-weight:600;cursor:pointer;transition:.15s}
.sb-navbtn:hover{color:#fff;border-color:#3a3a52}
.sb-hist{margin-top:10px;border-radius:12px;background:#101018;border:1px solid #1e1e2b;overflow:hidden}
.sb-hist-r{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;padding:9px 13px}
.sb-hist-r+.sb-hist-r{border-top:1px solid #1a1a26}
.sb-now{padding:2px 7px;border-radius:6px;font-size:9.5px;font-weight:700;color:#a5b4fc;background:rgba(99,102,241,.14);
  border:1px solid rgba(99,102,241,.35)}
.sb-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 20px;border-radius:12px;
  background:#101018;border:1px dashed #232332}
.sb-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:26px;border-radius:12px;background:#101018;
  border:1px solid #1e1e2b}
.sb-spin{animation:sbSpin 1s linear infinite}
@keyframes sbSpin{to{transform:rotate(360deg)}}
`;
