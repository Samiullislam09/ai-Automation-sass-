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

/** /dashboard/site-brain — same real logic and API calls as the old app/app/site-brain/page.tsx
 *  (kept verbatim: /api/site-brain GET/PATCH, /api/agents/trigger for refresh). The field
 *  editor itself (components/SiteBrainField.tsx — offerings, proof, topic clusters, voice,
 *  goals, RepeatRows) is reused unmodified: it's real, complex, tested logic, and MrLxwaDashboard
 *  now remaps the old theme's CSS tokens to the new palette so it renders in-theme without a
 *  risky rewrite (see the "legacy /app/** theme bridge" comment in MrLxwaDashboard.tsx). Only
 *  the page chrome (header, summary, empty states) is rebuilt in the new theme, per the owner's
 *  standing instruction (2026-08-29). Rendered inside <MrLxwaDashboard> as its `children` — see
 *  app/dashboard/site-brain/page.tsx. */

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
        <div className="lx-card2 p-6"><p className="lx-11 lx-mut">Loading…</p></div>
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
          action={<Link href="/dashboard/connect" className="lx-grad lx-11 px-3.5 py-2">Connect your website</Link>}
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
            <button className="lx-grad lx-11 px-3.5 py-2" disabled={refreshing} onClick={() => refresh("analyst")}>
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
        <div className="flex flex-wrap gap-2">
          <button className="lx-ghost" disabled={refreshing} onClick={() => refresh("crawler")} title="Read the site again and rebuild the profile">
            {refreshing ? "Starting…" : "↻ Refresh"}
          </button>
          <Link href="/dashboard/workspace" className="lx-ghost">Watch it work →</Link>
        </div>
      }
    >
      <div className="lx-card2 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <b className="text-xl font-extrabold leading-tight">{known}<span className="lx-mut">/{PROFILE_FIELDS.length}</span></b>
            <div className="lx-10 lx-mut">things we know</div>
          </div>
          <div>
            <b className="text-xl font-extrabold leading-tight">{s.builtFrom?.pages ?? s.pagesCrawled}</b>
            <div className="lx-10 lx-mut">pages read</div>
          </div>
          <div>
            <b className="text-xl font-extrabold leading-tight">v{s.version}</b>
            <div className="lx-10 lx-mut">{s.builtBy === "user" ? "you last changed it" : "built by the team"}</div>
          </div>
          <div>
            <b className="text-xl font-extrabold leading-tight">{edited}</b>
            <div className="lx-10 lx-mut">fields you corrected</div>
          </div>
        </div>
        <p className="lx-10 lx-mut mt-3.5">
          {s.builtAt ? `Last built ${new Date(s.builtAt).toLocaleString()}` : "Never built"}
          {s.builtFrom?.gsc_period ? ` · Search Console: ${s.builtFrom.gsc_period}` : " · Search Console not connected"}
          {" · "}
          {s.history.length > 1 ? (
            <button className="underline" style={{ color: "var(--lx-cyan)" }} onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "hide" : "show"} {s.history.length} versions
            </button>
          ) : (
            "this is the first version"
          )}
        </p>
        {showHistory && (
          <ul className="mt-3 space-y-1.5 border-t pt-3" style={{ borderColor: "var(--lx-border)" }}>
            {s.history.map((h) => (
              <li key={h.id} className="lx-11 flex flex-wrap items-baseline gap-2">
                <b>v{h.version}</b>
                <span className="lx-10 lx-mut">
                  {h.created_by === "user" ? "your edit" : "the team"} · {h.pages ? `${h.pages} pages · ` : ""}
                  {h.created_at ? new Date(h.created_at).toLocaleString() : ""}
                </span>
                {h.active && <span className="lx-pill blue">now</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {FIELD_GROUPS.map((group) => (
        <section key={group.title} className="lx-card2 mt-4 p-4">
          <div className="mb-2.5">
            <h2 className="lx-13 font-bold">{group.title}</h2>
            <p className="lx-10 lx-mut">{group.sub}</p>
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold">Site Brain</h1>
          <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 560 }}>
            What your team understood about your business — and where each part came from. Correct anything: once you do, the agents stop rewriting it.
          </p>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Empty({ ico, title, body, action }: { ico: string; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
      <div className="text-2xl">{ico}</div>
      <b className="lx-12">{title}</b>
      <p className="lx-11 lx-mut" style={{ maxWidth: 460 }}>{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
