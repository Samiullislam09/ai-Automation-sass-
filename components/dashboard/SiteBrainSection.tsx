"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity, ArrowRight, Brain, Check, ChevronDown, Loader2, PlugZap, Plus, RotateCw, Search,
} from "lucide-react";
import { useStore } from "@/lib/store";
import SiteBrainField, { SiteBrainFieldStyles } from "@/components/SiteBrainField";
import {
  FIELD_GROUPS,
  FIELD_META,
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
 *  field editor itself (components/SiteBrainField.tsx — offerings, proof, topic clusters,
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
      {/* one sentence, one bar, one next step */}
      <div className="sb-top">
        <div className="min-w-0 flex-1">
          <div className="sb-top-t">
            {missing === 0
              ? <>Your team knows <b>everything</b> on this list.</>
              : <>Your team knows <b>{known} of {PROFILE_FIELDS.length}</b> things about your business.</>}
          </div>
          <div className="sb-bar"><i style={{ width: `${pct}%` }} /></div>
          <div className="sb-top-s">
            Read from {s.builtFrom?.pages ?? s.pagesCrawled} pages on your website
            {s.builtAt ? ` · last updated ${new Date(s.builtAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
            {s.history.length > 1 && (
              <> · <button className="sb-link" onClick={() => setShowHistory((v) => !v)}>{showHistory ? "hide history" : `${s.history.length} versions`}</button></>
            )}
          </div>
        </div>
        {firstGap && (
          <button className="sb-next" onClick={() => setOpenField(firstGap)}>
            Fill the next gap <ArrowRight size={14} />
          </button>
        )}
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

      {/* the whole brain as one plain checklist: click a line to read or change it */}
      <div className="sb-list">
        {PROFILE_FIELDS.map((f) => {
          const meta = FIELD_META[f];
          const isOpen = openField === f;
          const has = filled(f);
          return (
            <div key={f} className={`sb-item ${isOpen ? "open" : ""} ${has ? "" : "gap"}`}>
              <button className="sb-item-h" onClick={() => setOpenField(isOpen ? null : f)} aria-expanded={isOpen}>
                <span className={`sb-mark ${has ? "ok" : ""}`}>{has ? <Check size={12} /> : <Plus size={12} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="sb-item-t">{FRIENDLY[f] ?? meta.label}</span>
                  <span className="sb-item-p">{has ? preview(profile, f) : "Not added yet"}</span>
                </span>
                <ChevronDown size={15} className={`sb-caret2 ${isOpen ? "on" : ""}`} />
              </button>
              {isOpen && (
                <div className="sb-item-b">
                  <SiteBrainField bare meta={meta} profile={profile} busy={busy === f} onSave={save} />
                </div>
              )}
            </div>
          );
        })}
      </div>

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

/** Plain-English names for the twelve fields. FIELD_META's labels are written for the editor;
 *  this list is what a business owner would call the same thing. */
const FRIENDLY: Partial<Record<ProfileField, string>> = {
  what_they_do: "What your business does",
  offerings: "What you sell",
  audience: "Who you sell to",
  buyer_intent: "What buyers ask before they buy",
  proof: "Facts we are allowed to claim",
  topic_clusters: "Subjects your site covers",
  content_gaps: "Questions your site doesn't answer",
  voice: "How your writing should sound",
  geo: "Where you work",
  language: "Language you publish in",
  competitors: "Your competitors",
  goals: "What you want from this",
};

/** One line of the answer for the closed row — never the whole thing. */
function preview(profile: SiteProfile, field: ProfileField): string {
  const v: any = (profile as any)[field];
  const cut = (t: string) => (t.length > 110 ? t.slice(0, 110).trimEnd() + "…" : t);
  if (typeof v === "string") return cut(v);
  if (Array.isArray(v)) {
    const names = v
      .map((x: any) => (typeof x === "string" ? x : x?.name ?? x?.claim ?? x?.query ?? ""))
      .filter(Boolean);
    const head = names.slice(0, 3).join(" · ");
    return cut(`${v.length} — ${head}${names.length > 3 ? " …" : ""}`);
  }
  if (field === "voice" && v) {
    const parts = [v.tone, v.do?.length ? `${v.do.length} do` : "", v.dont?.length ? `${v.dont.length} never` : ""].filter(Boolean);
    return cut(parts.join(" · ") || "Set");
  }
  if (field === "goals" && v) {
    const parts = [v.primary, v.focus?.length ? `${v.focus.length} focus areas` : ""].filter(Boolean);
    return cut(parts.join(" · ") || "Set");
  }
  return "Added";
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
.sb-top{display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:15px 16px;border-radius:12px;background:#101018;
  border:1px solid #1e1e2b}
.sb-top-t{font-size:14.5px;color:#d8d8e6;line-height:1.5}
.sb-top-t b{color:#fff;font-weight:700}
.sb-bar{height:6px;margin-top:10px;border-radius:999px;background:#1c1c29;overflow:hidden;max-width:420px}
.sb-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#4f46e5,#8b5cf6)}
.sb-top-s{margin-top:9px;font-size:11.5px;color:#7c7c95;line-height:1.6}
.sb-next{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 15px;border-radius:9px;flex-shrink:0;
  background:#4f46e5;border:1px solid #6366f1;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.sb-next:hover{background:#5b52ea}
.sb-list{margin-top:14px;border-radius:12px;background:#101018;border:1px solid #1e1e2b;overflow:hidden}
.sb-item+.sb-item{border-top:1px solid #1a1a26}
.sb-item.open{background:#12121c}
.sb-item-h{display:flex;align-items:center;gap:12px;width:100%;padding:13px 15px;background:none;border:none;
  color:inherit;text-align:left;cursor:pointer;transition:.15s}
.sb-item-h:hover{background:#151520}
.sb-mark{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex-shrink:0;border-radius:50%;
  color:#f59e0b;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4)}
.sb-mark.ok{color:#4ade80;background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.35)}
.sb-item-t{display:block;font-size:13.5px;font-weight:600;color:#f0f0f7}
.sb-item-p{display:block;margin-top:2px;font-size:11.5px;color:#7c7c95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-item.gap .sb-item-p{color:#c08a2e}
.sb-caret2{flex-shrink:0;color:#6f6f85;transition:transform .15s}
.sb-caret2.on{transform:rotate(180deg)}
.sb-item-b{padding:0 15px 15px 49px}
@container sb (max-width:520px){.sb-item-b{padding-left:15px}}
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
