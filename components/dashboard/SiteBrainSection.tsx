"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertCircle, Brain, CheckCircle2, Loader2, PlugZap, RotateCw, Search } from "lucide-react";
import { useStore } from "@/lib/store";
import SiteBrainField, { SiteBrainFieldStyles } from "@/components/SiteBrainField";
import {
  FIELD_GROUPS,
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
  const [onlyGaps, setOnlyGaps] = useState(false);

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
  const known = PROFILE_FIELDS.filter((f) => !isFieldEmpty(profile, f)).length;
  const missing = PROFILE_FIELDS.length - known;
  const edited = (profile.user_edited ?? []).length;
  const pct = Math.round((known / PROFILE_FIELDS.length) * 100);
  const groupStat = (g: (typeof FIELD_GROUPS)[number]) => ({
    known: g.fields.filter((f) => !isFieldEmpty(profile, f.field)).length,
    total: g.fields.length,
  });
  const jump = (title: string) => {
    document.getElementById(anchor(title))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const groups = FIELD_GROUPS.map((g) => ({
    group: g,
    fields: onlyGaps ? g.fields.filter((f) => isFieldEmpty(profile, f.field)) : g.fields,
  })).filter((g) => g.fields.length);

  return (
    <Shell
      right={
        <>
          <button className="sb-btn" disabled={refreshing} onClick={() => refresh("crawler")} title="Read the site again and rebuild the profile">
            {refreshing ? <Loader2 size={14} className="sb-spin" /> : <RotateCw size={14} />} Refresh
          </button>
          <Link href="/dashboard/workspace" className="sb-btn"><Activity size={14} /> Watch it work</Link>
        </>
      }
    >
      {/* how complete it is, said once, in a sentence and a bar */}
      <div className="sb-top">
        <div className="sb-top-l">
          <div className="sb-top-t">
            Your team knows <b>{known} of {PROFILE_FIELDS.length}</b> things about your business
            {missing > 0 ? <> — <button className="sb-link" onClick={() => setOnlyGaps(true)}>{missing} still missing</button></> : " — nothing missing"}
          </div>
          <div className="sb-bar"><i style={{ width: `${pct}%` }} /></div>
          <div className="sb-top-s">
            {s.builtFrom?.pages ?? s.pagesCrawled} pages read · version {s.version} {s.builtBy === "user" ? "(your edit)" : "(built by the team)"}
            {edited > 0 ? ` · ${edited} field${edited === 1 ? "" : "s"} you corrected` : ""}
            {s.builtAt ? ` · last built ${new Date(s.builtAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
            {s.history.length > 1 && (
              <> · <button className="sb-link" onClick={() => setShowHistory((v) => !v)}>{showHistory ? "hide" : "show"} {s.history.length} versions</button></>
            )}
          </div>
        </div>
        <button className={`sb-toggle ${onlyGaps ? "on" : ""}`} onClick={() => setOnlyGaps((v) => !v)}>
          {onlyGaps ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          {onlyGaps ? "Showing gaps only" : "Show gaps only"}
        </button>
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

      <div className="sb-body">
        {/* contents — jump straight to the part you came to fix */}
        <nav className="sb-nav">
          <div className="sb-nav-h">On this page</div>
          {FIELD_GROUPS.map((g) => {
            const st = groupStat(g);
            return (
              <button key={g.title} className="sb-nav-i" onClick={() => jump(g.title)}>
                <span className="truncate">{g.title}</span>
                <span className={`sb-nav-n ${st.known === st.total ? "ok" : st.known === 0 ? "none" : ""}`}>{st.known}/{st.total}</span>
              </button>
            );
          })}
        </nav>

        <div className="sb-main">
          {!groups.length ? (
            <div className="sb-empty"><CheckCircle2 size={20} style={{ color: "#4ade80" }} /><b className="lx-12 mt-2">Nothing missing</b>
              <p className="lx-11 lx-mut mt-1">Every field has an answer. Turn the filter off to read them.</p>
            </div>
          ) : groups.map(({ group, fields }) => (
            <section key={group.title} id={anchor(group.title)} className="sb-group">
              <div className="sb-group-h">
                <h2>{group.title}</h2>
                <p>{group.sub}</p>
              </div>
              <div className="listgrid">
                {fields.map((meta) => (
                  <SiteBrainField key={meta.field} meta={meta} profile={profile} busy={busy === meta.field} onSave={save} />
                ))}
              </div>
            </section>
          ))}
        </div>
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

/** Stable id per group title, so the contents nav can scroll to it. */
const anchor = (title: string) => "sb-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

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
.sb-top{display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:14px 15px;border-radius:12px;background:#101018;
  border:1px solid #1e1e2b}
.sb-top-l{flex:1;min-width:240px}
.sb-top-t{font-size:13.5px;color:#d8d8e6;line-height:1.5}
.sb-top-t b{color:#fff;font-weight:700}
.sb-bar{height:5px;margin-top:9px;border-radius:999px;background:#1c1c29;overflow:hidden}
.sb-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#4f46e5,#8b5cf6)}
.sb-top-s{margin-top:8px;font-size:11px;color:#7c7c95;line-height:1.6}
.sb-toggle{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:9px;flex-shrink:0;
  background:#191925;border:1px solid #262636;color:#b6b6c8;font-size:11.5px;font-weight:600;cursor:pointer;transition:.15s}
.sb-toggle:hover{color:#fff;border-color:#3a3a52}
.sb-toggle.on{color:#fff;background:rgba(79,70,229,.22);border-color:rgba(99,102,241,.55)}
.sb-body{display:grid;grid-template-columns:176px minmax(0,1fr);gap:14px;margin-top:16px;align-items:start}
@container sb (max-width:680px){.sb-body{grid-template-columns:minmax(0,1fr)}.sb-body .sb-nav{display:none}}
.sb-nav{position:sticky;top:0;display:flex;flex-direction:column;gap:2px;padding:10px;border-radius:12px;background:#0d0d15;
  border:1px solid #1a1a26}
.sb-nav-h{padding:2px 8px 8px;font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#6f6f85}
.sb-nav-i{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;background:none;border:none;
  color:#a8a8bd;font-size:11.5px;text-align:left;cursor:pointer;transition:.15s}
.sb-nav-i:hover{background:#151520;color:#fff}
.sb-nav-n{margin-left:auto;flex-shrink:0;font-size:10px;font-weight:700;color:#6f6f85;font-variant-numeric:tabular-nums}
.sb-nav-n.ok{color:#4ade80}
.sb-nav-n.none{color:#f59e0b}
.sb-main{min-width:0}
.sb-link{color:#8f95ff;background:none;border:none;padding:0;font:inherit;font-weight:600;cursor:pointer}
.sb-link:hover{text-decoration:underline}
.sb-hist{margin-top:8px;border-radius:12px;background:#101018;border:1px solid #1e1e2b;overflow:hidden}
.sb-hist-r{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;padding:9px 13px}
.sb-hist-r+.sb-hist-r{border-top:1px solid #1a1a26}
.sb-now{padding:2px 7px;border-radius:6px;font-size:9.5px;font-weight:700;color:#a5b4fc;background:rgba(99,102,241,.14);
  border:1px solid rgba(99,102,241,.35)}
.sb-group{padding:0;background:none;border:none;scroll-margin-top:8px}
.sb-group+.sb-group{margin-top:22px}
.sb-group-h{margin-bottom:10px}
.sb-group-h h2{font-size:14px;font-weight:700;color:#f0f0f7;letter-spacing:-.01em}
.sb-group-h p{margin-top:3px;font-size:11px;color:#7c7c95;line-height:1.5}
/* the reused field editor keeps its own markup (components/SiteBrainField.tsx); these two
   rules only calm its "where we read this" links down to the rest of the page */
.sb-group .sb-src a{color:#7c7c95;text-decoration:none}
.sb-group .sb-src a:hover{color:#a5b4fc;text-decoration:underline}
.sb-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 20px;border-radius:12px;
  background:#101018;border:1px dashed #232332}
.sb-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:26px;border-radius:12px;background:#101018;
  border:1px solid #1e1e2b}
.sb-spin{animation:sbSpin 1s linear infinite}
@keyframes sbSpin{to{transform:rotate(360deg)}}
`;
