"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertCircle, Brain, CheckCircle2, FileText, GitBranch, Loader2, PlugZap, RotateCw, Search,
} from "lucide-react";
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
  const [tab, setTab] = useState(0);

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
  const stat = (g: (typeof FIELD_GROUPS)[number]) => ({
    known: g.fields.filter((f) => !isFieldEmpty(profile, f.field)).length,
    total: g.fields.length,
  });

  const group = FIELD_GROUPS[Math.min(tab, FIELD_GROUPS.length - 1)];
  const shown = onlyGaps ? group.fields.filter((f) => isFieldEmpty(profile, f.field)) : group.fields;

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
      {/* ---- stat strip, same shape as Approvals / Reports ---- */}
      <div className="sb-stats">
        <Stat color="#8b5cf6" Icon={Brain} value={`${known}/${PROFILE_FIELDS.length}`} label="Things we know" sub={`${pct}% complete`} />
        <Stat color={missing ? "#f59e0b" : "#22c55e"} Icon={AlertCircle} value={String(missing)} label="Still missing" sub={missing ? "click a tab to fill them" : "nothing missing"} />
        <Stat color="#3b82f6" Icon={FileText} value={String(s.builtFrom?.pages ?? s.pagesCrawled)} label="Pages read" sub="from your website" />
        <Stat color="#22d3ee" Icon={GitBranch} value={`v${s.version}`} label={s.builtBy === "user" ? "Your edit" : "Built by the team"} sub={edited ? `${edited} field${edited === 1 ? "" : "s"} you corrected` : "no manual corrections"} />
      </div>

      <div className="sb-bar"><i style={{ width: `${pct}%` }} /></div>

      <p className="sb-meta">
        {s.builtAt ? `Last built ${new Date(s.builtAt).toLocaleString()}` : "Never built"}
        {s.builtFrom?.gsc_period ? " · Search Console connected" : " · Search Console not connected"}
        {s.history.length > 1 && (
          <> · <button className="sb-link" onClick={() => setShowHistory((v) => !v)}>{showHistory ? "hide" : "show"} {s.history.length} versions</button></>
        )}
      </p>

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

      {/* ---- one tab per section, so nothing is a long scroll ---- */}
      <div className="sb-tabs">
        {FIELD_GROUPS.map((g, i) => {
          const st = stat(g);
          return (
            <button key={g.title} className={`sb-tab ${i === tab ? "on" : ""}`} onClick={() => setTab(i)}>
              {g.title}
              <span className={`sb-tab-n ${st.known === st.total ? "ok" : st.known === 0 ? "none" : ""}`}>{st.known}/{st.total}</span>
            </button>
          );
        })}
        <button className={`sb-toggle ${onlyGaps ? "on" : ""}`} onClick={() => setOnlyGaps((v) => !v)} title="Show only the fields that are still empty">
          {onlyGaps ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />} Gaps only
        </button>
      </div>

      <section className="sb-group">
        <div className="sb-group-h">
          <h2>{group.title}</h2>
          <p>{group.sub}</p>
        </div>
        {shown.length ? (
          <div className="listgrid">
            {shown.map((meta) => (
              <SiteBrainField key={meta.field} meta={meta} profile={profile} busy={busy === meta.field} onSave={save} />
            ))}
          </div>
        ) : (
          <div className="sb-empty">
            <CheckCircle2 size={20} style={{ color: "#4ade80" }} />
            <b className="lx-12 mt-2">Nothing missing here</b>
            <p className="lx-11 lx-mut mt-1">Every field in this section has an answer. Turn &ldquo;Gaps only&rdquo; off to read them.</p>
          </div>
        )}
      </section>

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

function Stat({ color, Icon, value, label, sub }: {
  color: string; Icon: React.ElementType; value: string; label: string; sub: string;
}) {
  return (
    <div className="sb-stat" style={{ ["--c" as any]: color }}>
      <span className="sb-stat-ico"><Icon size={16} /></span>
      <div className="min-w-0">
        <div className="sb-stat-n">{value}</div>
        <div className="lx-10 lx-mut">{label}</div>
        <div className="sb-stat-sub" title={sub}>{sub}</div>
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
.sb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.sb-stat{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:11px;min-width:0;
  background:color-mix(in srgb,var(--c) 9%,#0b0b12);border:1px solid color-mix(in srgb,var(--c) 40%,transparent)}
.sb-stat-ico{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;flex-shrink:0;
  color:var(--c);background:color-mix(in srgb,var(--c) 14%,#0b0b12);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}
.sb-stat-n{font-size:19px;font-weight:800;line-height:1;color:#fff;font-variant-numeric:tabular-nums}
.sb-stat-sub{margin-top:2px;font-size:10px;color:var(--lx-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-bar{height:5px;margin-top:10px;border-radius:999px;background:#16161f;overflow:hidden}
.sb-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#4f46e5,#8b5cf6)}
.sb-meta{margin-top:8px;font-size:11px;color:var(--lx-mut);line-height:1.6}
.sb-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.sb-tab{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:9px;font-size:12px;
  font-weight:600;background:#0d0d16;border:1px solid var(--lx-border);color:#9a9ab2;cursor:pointer;transition:.15s}
.sb-tab:hover{color:#fff}
.sb-tab.on{color:#fff;background:linear-gradient(135deg,rgba(79,70,229,.55),rgba(124,58,237,.35));border-color:rgba(139,92,246,.6)}
.sb-tab-n{font-size:10px;font-weight:700;color:#6f6f85;font-variant-numeric:tabular-nums}
.sb-tab.on .sb-tab-n{color:#c4b5fd}
.sb-tab-n.ok{color:#4ade80}
.sb-tab-n.none{color:#f59e0b}
.sb-toggle{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:9px;margin-left:auto;
  background:#0d0d16;border:1px solid var(--lx-border);color:#9a9ab2;font-size:11.5px;font-weight:600;cursor:pointer;transition:.15s}
.sb-toggle:hover{color:#fff;border-color:rgba(139,92,246,.5)}
.sb-toggle.on{color:#fff;background:rgba(245,158,11,.16);border-color:rgba(245,158,11,.5)}
.sb-group{margin-top:14px}
.sb-group-h{margin-bottom:10px;padding:0 2px}
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
