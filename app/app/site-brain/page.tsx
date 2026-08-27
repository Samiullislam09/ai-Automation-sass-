"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

/** Settings → Site Brain: what we think we know about your site, and where each part came from.
 *
 *  MASTER_PLAN §25.7 asks for this page in Phase 1, and §25.2 says what makes it worth having:
 *  every field carries its evidence and its confidence, and the owner can correct any of it.
 *  The correction is the point — an agent that has misunderstood the business writes plausible
 *  articles about the wrong company, and today the only way to discover that is to read one.
 *
 *  Four states, because each needs a different sentence and a different button:
 *
 *    · the schema isn't applied yet   → say so plainly; this is the database owner's problem,
 *                                       not something the user can fix by clicking harder
 *    · no pages crawled               → "connect your site" is the only useful action
 *    · pages crawled, no profile yet  → Mr. Analyst hasn't run (or is running); offer to run him
 *    · a profile                      → the real screen
 *
 *  Refresh re-reads the site rather than only re-thinking about it: the crawler enqueues the
 *  analyst itself when it finishes (agent-server/src/agents/crawler.ts), so one job rebuilds
 *  the whole brain, and §24's live workspace is where the progress actually shows.
 */

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

export default function SiteBrainPage() {
  const { toast, report } = useStore();
  const [state, setState] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ProfileField | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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

  /** One field, saved. Returns whether it stuck, because the editor keeps itself open on a
   *  failure — losing what someone just typed to a network blip is unforgivable on a screen
   *  whose whole job is corrections. */
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
        <div className="card emptycard"><p className="mut sm">Loading…</p></div>
      </Shell>
    );
  }

  const s = state;
  if (!s) return <Shell><Empty ico="😕" title="Couldn't load it" body="Something went wrong reading your Site Brain. Refresh the page to try again." /></Shell>;

  if (!s.schemaReady) {
    return (
      <Shell>
        <Empty
          ico="🧩"
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
          ico="🔌"
          title="We haven't read your site yet"
          body="The Site Brain is built from your own pages. Connect your website and we'll read it — then this page fills itself in."
          action={<Link href="/app/connect" className="btn btn-p btn-sm">Connect your website</Link>}
        />
      </Shell>
    );
  }

  if (!s.profile) {
    return (
      <Shell>
        <Empty
          ico="🔎"
          title={`${s.pagesCrawled} pages read — nothing understood yet`}
          body="Mr. Analyst turns those pages into the profile every other agent reads. He may still be working; if not, start him here."
          action={
            <button className="btn btn-p btn-sm" disabled={refreshing} onClick={() => refresh("analyst")}>
              {refreshing ? "Starting…" : "Understand my site"}
            </button>
          }
        />
      </Shell>
    );
  }

  const profile = s.profile;
  const known = PROFILE_FIELDS.filter((f) => !isFieldEmpty(profile, f)).length;
  const edited = (profile.user_edited ?? []).length;

  return (
    <Shell
      right={
        <div className="btnrow">
          <button className="btn btn-g btn-sm" disabled={refreshing} onClick={() => refresh("crawler")} title="Read the site again and rebuild the profile">
            {refreshing ? "Starting…" : "↻ Refresh"}
          </button>
          <Link href="/app/workspace" className="btn btn-sm">Watch it work →</Link>
        </div>
      }
    >
      <div className="card sb-summary">
        <div className="sb-sum-row">
          <div>
            <b className="sb-sum-n">{known}<span className="mut">/{PROFILE_FIELDS.length}</span></b>
            <div className="xs mut">things we know</div>
          </div>
          <div>
            <b className="sb-sum-n">{s.builtFrom?.pages ?? s.pagesCrawled}</b>
            <div className="xs mut">pages read</div>
          </div>
          <div>
            <b className="sb-sum-n">v{s.version}</b>
            <div className="xs mut">{s.builtBy === "user" ? "you last changed it" : "built by the team"}</div>
          </div>
          <div>
            <b className="sb-sum-n">{edited}</b>
            <div className="xs mut">fields you corrected</div>
          </div>
        </div>
        <p className="xs mut sb-sum-note">
          {s.builtAt ? `Last built ${new Date(s.builtAt).toLocaleString()}` : "Never built"}
          {s.builtFrom?.gsc_period ? ` · Search Console: ${s.builtFrom.gsc_period}` : " · Search Console not connected"}
          {" · "}
          {s.history.length > 1 ? (
            <button className="sb-link" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "hide" : "show"} {s.history.length} versions
            </button>
          ) : (
            "this is the first version"
          )}
        </p>
        {showHistory && (
          <ul className="sb-history">
            {s.history.map((h) => (
              <li key={h.id} className={h.active ? "on" : ""}>
                <b>v{h.version}</b>
                <span className="mut xs">
                  {h.created_by === "user" ? "your edit" : "the team"} · {h.pages ? `${h.pages} pages · ` : ""}
                  {h.created_at ? new Date(h.created_at).toLocaleString() : ""}
                </span>
                {h.active && <span className="sb-now">now</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {FIELD_GROUPS.map((group) => (
        <section key={group.title} className="sb-group">
          <div className="sb-group-head">
            <h2 className="sb-group-h">{group.title}</h2>
            <p className="xs mut">{group.sub}</p>
          </div>
          <div className="listgrid">
            {group.fields.map((meta) => (
              <SiteBrainField key={meta.field} meta={meta} profile={profile} busy={busy === meta.field} onSave={save} />
            ))}
          </div>
        </section>
      ))}

      <SiteBrainFieldStyles />
    </Shell>
  );
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <>
      <div className="pg-head sb-head">
        <div>
          <h1 className="pg-h1">Site Brain</h1>
          <p className="xs mut" style={{ margin: "4px 0 0", maxWidth: 560 }}>
            What your team understood about your business — and where each part came from. Correct anything: once you do, the agents stop rewriting it.
          </p>
        </div>
        {right}
      </div>
      {children}
      <style jsx global>{`
        .sb-head { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
        .sb-summary { margin-bottom: 20px; }
        .sb-sum-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        .sb-sum-n { font-size: 22px; display: block; line-height: 1.1; }
        .sb-sum-note { margin: 14px 0 0; }
        .sb-link { background: none; border: 0; padding: 0; color: var(--acc); cursor: pointer; font: inherit; text-decoration: underline; }
        .sb-history { list-style: none; margin: 12px 0 0; padding: 10px 0 0; border-top: 1px solid var(--line); display: grid; gap: 6px; }
        .sb-history li { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 13px; }
        .sb-now { font-size: 11px; border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; }
        .sb-group { margin: 26px 0; }
        .sb-group-head { margin-bottom: 10px; }
        .sb-group-h { font-size: 15px; margin: 0; }
        @media (max-width: 620px) { .sb-sum-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      `}</style>
    </>
  );
}

function Empty({ ico, title, body, action }: { ico: string; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="card emptycard">
      <div className="ic">{ico}</div>
      <b style={{ display: "block", marginBottom: 6 }}>{title}</b>
      <p className="mut sm" style={{ maxWidth: 460, margin: "0 auto" }}>{body}</p>
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
