"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { LxInput } from "./ui";

/** /dashboard/memory — same real logic and API calls as the old app/app/memory/page.tsx (kept
 *  verbatim: /api/dashboard/status, /api/insights, and saveMemory() which writes to the DB, not
 *  localStorage). Restyled to the new dashboard theme per the owner's standing instruction
 *  (2026-08-29). Rendered inside <MrLxwaDashboard> as its `children` — see
 *  app/dashboard/memory/page.tsx. */

type Status = {
  tenant: { websiteUrl: string | null; niche: string | null; topics: string[]; onboarded: boolean };
  integrations: { type: string; status: string; connectedAt: string }[];
  crawl: { pagesIndexed: number; samplePages: { title: string; url: string }[] };
};

const INTEGRATION_LABEL: Record<string, string> = {
  wordpress: "WordPress",
  webhook: "Webhook (Next.js / custom)",
  google: "Google (Search Console + Analytics)",
  social_x: "X (Twitter) relay",
  social_linkedin: "LinkedIn relay",
  social_facebook: "Facebook relay",
  social_instagram: "Instagram relay",
};

function pillTone(status: string) {
  if (status === "connected") return "green";
  if (status === "error") return "red";
  return "blue";
}

export default function MemorySection() {
  const { s, toast, act, saveMemory, confirmAction } = useStore();
  const [edit, setEdit] = useState<number | null>(null);
  const [val, setVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [nk, setNk] = useState(""); const [nv, setNv] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [insights, setInsights] = useState<any>(null);
  const [statusError, setStatusError] = useState(false);
  const [insightsError, setInsightsError] = useState(false);

  const loadStatus = () => {
    setLoadingStatus(true);
    setStatusError(false);
    fetch("/api/dashboard/status")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setStatus(data); else setStatusError(true); })
      .catch(() => setStatusError(true))
      .finally(() => setLoadingStatus(false));
  };
  const loadInsights = () => {
    setInsights(null);
    setInsightsError(false);
    fetch("/api/insights")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(setInsights)
      .catch(() => setInsightsError(true));
  };
  useEffect(() => { loadStatus(); loadInsights(); }, []);

  const retry = (fn: () => void) => (
    <p className="lx-11" style={{ color: "#f87171" }}>
      Couldn&apos;t load —{" "}
      <button type="button" className="underline font-semibold" style={{ color: "var(--lx-cyan)" }} onClick={fn}>Retry</button>
    </p>
  );

  const save = (i: number) => {
    saveMemory(s.memory.map((m: any, j: number) => j === i ? { ...m, v: val } : m));
    act(`"Noted. All agents realigned."`, "Mr Lxwa");
    toast("Memory updated — team adjusted."); setEdit(null);
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
    toast("Team memory updated."); setAdding(false); setNk(""); setNv("");
  };

  const cyan = { color: "var(--lx-cyan)" } as const;

  return (
    <div className="space-y-4" style={{ maxWidth: 820 }}>
      <div>
        <h1 className="text-lg font-bold">AI Memory</h1>
        <p className="lx-11 lx-mut mt-1">What your team actually knows and has connected — pulled live from your account, not just guessed.</p>
      </div>

      {/* What we've connected */}
      <div className="lx-card2 p-4">
        <h2 className="lx-13 mb-2 font-bold">What we&apos;ve connected</h2>
        {loadingStatus ? (
          <p className="lx-11 lx-mut">Checking…</p>
        ) : statusError ? retry(loadStatus) : !status?.integrations.length ? (
          <p className="lx-11 lx-mut">Nothing connected yet. <Link href="/dashboard/connect" className="underline" style={cyan}>Connect WordPress, your site or social →</Link></p>
        ) : (
          <div className="space-y-2">
            {status.integrations.map((i, idx) => (
              <div key={idx} className="flex flex-wrap items-center justify-between gap-2">
                <span className="lx-11">{INTEGRATION_LABEL[i.type] ?? i.type}</span>
                <span className={"lx-pill " + pillTone(i.status)}>{i.status.toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* What Google measured */}
      <div className="lx-card2 p-4">
        <h2 className="lx-13 font-bold">What Google says about your site</h2>
        <p className="lx-10 lx-mut mb-3 mt-1">
          Real Search Console + Analytics numbers. Mr Lxwa picks topics from this, Mr. Keyword falls back to it,
          and Mr. Writer uses it to link to the pages that already work.
        </p>

        {insightsError ? retry(loadInsights) : !insights ? (
          <p className="lx-11 lx-mut">Checking…</p>
        ) : !insights.connected ? (
          <p className="lx-11 lx-mut">
            {insights.needsMigration
              ? "Database migration baaki hai — supabase/migrations/007_site_insights.sql chalao."
              : <>Google connected nahi hai, to team abhi sirf apni site ke crawl se guess kar rahi hai. <Link href="/dashboard/connect" className="underline" style={cyan}>Search Console + Analytics jodo →</Link></>}
          </p>
        ) : (
          <>
            <p className="lx-10 lx-mut mb-3">
              {insights.period?.start} → {insights.period?.end} · {insights.totals?.queries} searches ·{" "}
              {insights.totals?.pages} pages
              {insights.traffic ? ` · ${insights.traffic.sessions} sessions, ${insights.traffic.users} users (GA4)` : ""}
            </p>

            {insights.strikingDistance?.length > 0 && (
              <div className="mb-3.5">
                <div className="lx-10 mb-1.5 font-bold">Page 1 ke bilkul kareeb — agla article inhi pe hona chahiye</div>
                {insights.strikingDistance.map((q: any) => <InsightRow key={q.query} label={q.query} meta={`pos ${q.position.toFixed(1)} · ${q.impressions} impressions · ${q.clicks} clicks`} />)}
              </div>
            )}

            {insights.missed?.length > 0 && (
              <div className="mb-3.5">
                <div className="lx-10 mb-1.5 font-bold">Log dekh rahe hain, click nahi kar rahe — page jawab nahi de raha</div>
                {insights.missed.map((q: any) => <InsightRow key={q.query} label={q.query} meta={`${q.impressions} impressions · ${q.clicks} clicks`} />)}
              </div>
            )}

            {insights.winning?.length > 0 && (
              <details className="mb-2.5">
                <summary className="lx-10 lx-mut cursor-pointer">Jo pehle se chal raha hai ({insights.winning.length})</summary>
                <div className="mt-2">
                  {insights.winning.map((q: any) => <InsightRow key={q.query} label={q.query} meta={`${q.clicks} clicks · pos ${q.position.toFixed(1)}`} />)}
                </div>
              </details>
            )}

            {insights.topPages?.length > 0 && (
              <details>
                <summary className="lx-10 lx-mut cursor-pointer">Sabse zyada traffic wale pages ({insights.topPages.length})</summary>
                <div className="mt-2">
                  {insights.topPages.map((p: any) => <InsightRow key={p.url} label={p.url} meta={`${p.clicks} clicks`} />)}
                </div>
              </details>
            )}

            {insights.location && (
              <p className="lx-10 lx-mut mt-2.5">
                Business Profile: <b className="lx-text">{insights.location.title}</b>
                {insights.location.address ? ` — ${insights.location.address}` : ""}
              </p>
            )}

            <p className="lx-10 lx-mut mt-2.5">
              Last refresh: {insights.capturedAt ? new Date(insights.capturedAt).toLocaleString() : "—"} ·{" "}
              <Link href="/dashboard/connect" className="underline" style={cyan}>refresh karo</Link>
            </p>
          </>
        )}
      </div>

      {/* What we've learned from the site crawl */}
      <div className="lx-card2 p-4">
        <h2 className="lx-13 font-bold">What we&apos;ve learned from your site</h2>
        {loadingStatus ? (
          <p className="lx-11 lx-mut mt-2">Checking…</p>
        ) : statusError ? retry(loadStatus) : !status?.crawl.pagesIndexed ? (
          <p className="lx-11 lx-mut mt-2">Site not analyzed yet — this happens automatically during onboarding.</p>
        ) : (
          <>
            <p className="lx-11 mt-2">{status.tenant.niche}</p>
            <p className="lx-10 lx-mut mt-2" style={{ overflowWrap: "anywhere" }}>
              <b className="lx-text">{status.crawl.pagesIndexed}</b> page{status.crawl.pagesIndexed === 1 ? "" : "s"} read from{" "}
              <span className="lx-text">{status.tenant.websiteUrl}</span>
            </p>
            {status.tenant.topics.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {status.tenant.topics.map((t, i) => (
                  <span key={i} className="lx-in lx-10 lx-mut rounded-full px-2.5 py-1" style={{ overflowWrap: "anywhere" }}>{t}</span>
                ))}
              </div>
            )}
            {status.crawl.samplePages.length > 0 && (
              <details className="mt-2.5">
                <summary className="lx-10 lx-mut cursor-pointer">See pages read</summary>
                <ul className="mt-2 space-y-1 pl-4" style={{ listStyle: "disc" }}>
                  {status.crawl.samplePages.map((p, i) => (
                    <li key={i} className="lx-10 lx-mut" style={{ overflowWrap: "anywhere" }}>{p.title}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <h2 className="lx-13 font-bold">Business facts</h2>
        <button className="lx-ghost" onClick={() => setAdding(true)}>+ Add fact</button>
      </div>
      <p className="lx-11 lx-mut" style={{ marginTop: -8 }}>From your onboarding answers. Click ✎ to edit — every agent adjusts instantly.</p>

      <div className="grid grid-cols-1 gap-2">
        {!s.memory.length && (
          <div className="lx-card2 flex flex-wrap items-center gap-3 p-3.5">
            <p className="lx-11 lx-mut min-w-60 flex-1">No facts yet — add one so the team writes about the right things.</p>
            <button className="lx-ghost" onClick={() => setAdding(true)}>+ Add fact</button>
          </div>
        )}
        {s.memory.map((m: any, i: number) => (
          <div key={i} className="lx-card2 flex flex-wrap items-center gap-2.5 p-3.5">
            <span className="lx-10 lx-mut font-bold uppercase tracking-wide" style={{ minWidth: 90, overflowWrap: "anywhere" }}>{m.k}</span>
            {edit === i
              ? <LxInput autoFocus className="flex-1" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save(i)} />
              : <span className="lx-11 flex-1" style={{ overflowWrap: "anywhere" }}>{m.v}</span>}
            <div className="ml-auto flex items-center gap-1.5">
              {edit === i
                ? <button className="lx-grad lx-11 px-3 py-1.5" onClick={() => save(i)}>Save</button>
                : <>
                    <button className="lx-icobtn" aria-label={`Edit ${m.k}`} title="Edit" onClick={() => { setEdit(i); setVal(m.v); }}>✎</button>
                    <button className="lx-icobtn" style={{ color: "#f87171" }} aria-label={`Delete ${m.k}`} title="Delete" onClick={() => del(i)}>🗑</button>
                  </>}
            </div>
          </div>
        ))}
      </div>

      <div className="lx-card2 flex items-center gap-3 p-4">
        <span className="text-lg">🧠</span>
        <div className="lx-11 min-w-0">
          <b>Who am I?</b> — <Link href="/whoami" className="underline" style={cyan}>Read Mr Lxwa&apos;s current understanding of your business →</Link>
        </div>
      </div>

      {adding && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.6)" }} onClick={() => setAdding(false)}>
          <div className="lx-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="lx-13 mt-0 font-bold">Add to memory</h3>
            <div className="mt-3">
              <label className="lx-10 lx-mut mb-1 block">Label</label>
              <LxInput placeholder="e.g. Products, USP, Do not mention…" value={nk} onChange={(e) => setNk(e.target.value)} />
            </div>
            <div className="mt-2.5">
              <label className="lx-10 lx-mut mb-1 block">Fact</label>
              <textarea
                rows={3}
                placeholder="What should your team know?"
                value={nv}
                onChange={(e) => setNv(e.target.value)}
                className="lx-12 w-full rounded-lg px-3 py-2"
                style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)" }}
              />
            </div>
            <div className="mt-3.5 flex gap-2.5">
              <button className="lx-ghost flex-1 justify-center" onClick={() => setAdding(false)}>Cancel</button>
              <button className="lx-grad lx-11 flex-1 px-3.5 py-2" onClick={add}>Save to memory</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightRow({ label, meta }: { label: string; meta: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1.5 first:border-t-0" style={{ borderColor: "var(--lx-border)" }}>
      <span className="lx-11" style={{ overflowWrap: "anywhere" }}>{label}</span>
      <span className="lx-10 lx-mut whitespace-nowrap">{meta}</span>
    </div>
  );
}
