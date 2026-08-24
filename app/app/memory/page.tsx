"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Help } from "@/components/kit";

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

function pillClass(status: string) {
  if (status === "connected") return "st-pub";
  if (status === "error") return "st-fail";
  return "st-draft";
}

export default function Memory() {
  const { s, toast, act, saveMemory } = useStore();
  const [edit, setEdit] = useState<number | null>(null);
  const [val, setVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [nk, setNk] = useState(""); const [nv, setNv] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  // Google's own measurements of this site. Null while loading; `connected:false` when
  // there is genuinely nothing to show, which the panel says out loud rather than faking.
  const [insights, setInsights] = useState<any>(null);

  useEffect(() => {
    fetch("/api/dashboard/status")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setStatus(data); })
      .catch(() => {})
      .finally(() => setLoadingStatus(false));

    fetch("/api/insights")
      .then((r) => r.json())
      .then(setInsights)
      .catch(() => setInsights({ ok: false, connected: false }));
  }, []);

  // Every edit goes through saveMemory, which writes to the DB — the list used to live only
  // in localStorage, so signing out erased it.
  const save = (i: number) => {
    saveMemory(s.memory.map((m: any, j: number) => j === i ? { ...m, v: val } : m));
    act(`"Noted. All agents realigned."`, "Mr Lxwa");
    toast("Memory updated — team adjusted."); setEdit(null);
  };
  const del = (i: number) => {
    act(`"Forgotten."`, "Mr Lxwa");
    saveMemory(s.memory.filter((_: any, j: number) => j !== i));
    toast("Removed.");
  };
  const add = () => {
    if (!nk.trim() || !nv.trim()) return toast("Both fields needed");
    saveMemory([...s.memory, { k: nk.trim(), v: nv.trim() }]);
    act(`learned something new from you: <b>${nk.trim()}</b>.`, "Mr Lxwa");
    toast("Team memory updated."); setAdding(false); setNk(""); setNv("");
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ fontSize: 21, margin: 0 }}>AI Memory <Help k="memory" /></h1>
      </div>
      <p className="sm mut" style={{ marginBottom: 20 }}>What your team actually knows and has connected — pulled live from your account, not just guessed.</p>

      {/* What we've connected */}
      <div className="card" style={{ padding: "15px 17px", marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>What we&apos;ve connected</h2>
        {loadingStatus ? (
          <p className="sm mut">Checking…</p>
        ) : !status?.integrations.length ? (
          <p className="sm mut">Nothing connected yet. <Link href="/app/connect">Connect WordPress, your site or social →</Link></p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {status.integrations.map((i, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="sm">{INTEGRATION_LABEL[i.type] ?? i.type}</span>
                <span className={"pillst " + pillClass(i.status)}>{i.status.toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* What Google measured — the evidence the agents plan from */}
      <div className="card" style={{ padding: "15px 17px", marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 4px" }}>What Google says about your site</h2>
        <p className="xs mut" style={{ margin: "0 0 12px" }}>
          Real Search Console + Analytics numbers. Mr Lxwa picks topics from this, Mr. Keyword falls back to it,
          and Mr. Writer uses it to link to the pages that already work.
        </p>

        {!insights ? (
          <p className="sm mut">Checking…</p>
        ) : !insights.connected ? (
          <p className="sm mut">
            {insights.needsMigration
              ? "Database migration baaki hai — supabase/migrations/007_site_insights.sql chalao."
              : <>Google connected nahi hai, to team abhi sirf apni site ke crawl se guess kar rahi hai. <Link href="/app/connect">Search Console + Analytics jodo →</Link></>}
          </p>
        ) : (
          <>
            <p className="xs mut" style={{ marginBottom: 12 }}>
              {insights.period?.start} → {insights.period?.end} · {insights.totals?.queries} searches ·{" "}
              {insights.totals?.pages} pages
              {insights.traffic ? ` · ${insights.traffic.sessions} sessions, ${insights.traffic.users} users (GA4)` : ""}
            </p>

            {insights.strikingDistance?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="xs" style={{ fontWeight: 700, marginBottom: 6 }}>
                  Page 1 ke bilkul kareeb — agla article inhi pe hona chahiye
                </div>
                {insights.strikingDistance.map((q: any) => (
                  <div key={q.query} className="ins-row">
                    <span className="ins-q">{q.query}</span>
                    <span className="xs mut">pos {q.position.toFixed(1)} · {q.impressions} impressions · {q.clicks} clicks</span>
                  </div>
                ))}
              </div>
            )}

            {insights.missed?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="xs" style={{ fontWeight: 700, marginBottom: 6 }}>
                  Log dekh rahe hain, click nahi kar rahe — page jawab nahi de raha
                </div>
                {insights.missed.map((q: any) => (
                  <div key={q.query} className="ins-row">
                    <span className="ins-q">{q.query}</span>
                    <span className="xs mut">{q.impressions} impressions · {q.clicks} clicks</span>
                  </div>
                ))}
              </div>
            )}

            {insights.winning?.length > 0 && (
              <details style={{ marginBottom: 10 }}>
                <summary className="xs mut" style={{ cursor: "pointer" }}>Jo pehle se chal raha hai ({insights.winning.length})</summary>
                <div style={{ marginTop: 8 }}>
                  {insights.winning.map((q: any) => (
                    <div key={q.query} className="ins-row">
                      <span className="ins-q">{q.query}</span>
                      <span className="xs mut">{q.clicks} clicks · pos {q.position.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {insights.topPages?.length > 0 && (
              <details>
                <summary className="xs mut" style={{ cursor: "pointer" }}>Sabse zyada traffic wale pages ({insights.topPages.length})</summary>
                <div style={{ marginTop: 8 }}>
                  {insights.topPages.map((p: any) => (
                    <div key={p.url} className="ins-row">
                      <span className="ins-q" style={{ wordBreak: "break-all" }}>{p.url}</span>
                      <span className="xs mut">{p.clicks} clicks</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {insights.location && (
              <p className="xs mut" style={{ marginTop: 10 }}>
                Business Profile: <b style={{ color: "var(--ink)" }}>{insights.location.title}</b>
                {insights.location.address ? ` — ${insights.location.address}` : ""}
              </p>
            )}

            <p className="xs mut" style={{ marginTop: 10 }}>
              Last refresh: {insights.capturedAt ? new Date(insights.capturedAt).toLocaleString() : "—"} ·{" "}
              <Link href="/app/connect" className="acc">refresh karo</Link>
            </p>
          </>
        )}

        <style jsx>{`
          .ins-row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
                     padding: 4px 0; border-bottom: 1px solid var(--line); }
          .ins-row:last-child { border-bottom: none; }
          .ins-q { font-size: 12.5px; color: var(--ink); min-width: 0; }
        `}</style>
      </div>

      {/* What we've learned from the site crawl */}
      <div className="card" style={{ padding: "15px 17px", marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>What we&apos;ve learned from your site</h2>
        {loadingStatus ? (
          <p className="sm mut">Checking…</p>
        ) : !status?.crawl.pagesIndexed ? (
          <p className="sm mut">Site not analyzed yet — this happens automatically during onboarding.</p>
        ) : (
          <>
            <p className="sm" style={{ marginBottom: 10 }}>{status.tenant.niche}</p>
            <p className="xs mut" style={{ marginBottom: 10 }}>
              <b style={{ color: "var(--ink)" }}>{status.crawl.pagesIndexed}</b> page{status.crawl.pagesIndexed === 1 ? "" : "s"} read from{" "}
              <span style={{ color: "var(--ink)" }}>{status.tenant.websiteUrl}</span>
            </p>
            {status.tenant.topics.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {status.tenant.topics.map((t, i) => (
                  <span key={i} style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 999, background: "var(--panel2)", border: "1px solid var(--line2)", color: "var(--mut)" }}>{t}</span>
                ))}
              </div>
            )}
            {status.crawl.samplePages.length > 0 && (
              <details>
                <summary className="xs mut" style={{ cursor: "pointer" }}>See pages read</summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {status.crawl.samplePages.map((p, i) => (
                    <li key={i} className="xs mut" style={{ marginBottom: 4 }}>{p.title}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Business facts</h2>
        <div style={{ flex: 1 }} />
        <button className="btn btn-g btn-sm" onClick={() => setAdding(true)}>+ Add fact</button>
      </div>
      <p className="sm mut" style={{ marginBottom: 16 }}>From your onboarding answers. Click ✎ to edit — every agent adjusts instantly.</p>
      {s.memory.map((m: any, i: number) => (
        <div key={i} className="card" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "13px 15px", marginBottom: 9 }}>
          <span className="xs mut" style={{ textTransform: "uppercase", letterSpacing: 0.6, width: 110, flex: "none", paddingTop: 3, fontWeight: 700 }}>{m.k}</span>
          {edit === i
            ? <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && save(i)} style={{ flex: 1 }} />
            : <span style={{ flex: 1, fontSize: 13.5 }}>{m.v}</span>}
          {edit === i
            ? <button className="btn btn-p btn-sm" onClick={() => save(i)}>Save</button>
            : <><button style={{ background: "none", border: "none", color: "var(--mut)", cursor: "pointer" }} onClick={() => { setEdit(i); setVal(m.v); }}>✎</button>
              <button style={{ background: "none", border: "none", color: "var(--mut)", cursor: "pointer" }} onClick={() => del(i)}>🗑</button></>}
        </div>
      ))}
      <div className="card" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <div className="corb" /><div className="sm"><b>Who am I?</b> — <Link href="/whoami">Read Mr Lxwa&apos;s current understanding of your business →</Link></div>
      </div>
      {adding && (
        <div className="modalwrap" onClick={() => setAdding(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Add to memory</h3>
            <div className="field"><label>Label</label><input placeholder="e.g. Products, USP, Do not mention…" value={nk} onChange={e => setNk(e.target.value)} /></div>
            <div className="field"><label>Fact</label><textarea rows={3} placeholder="What should your team know?" value={nv} onChange={e => setNv(e.target.value)} /></div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button className="btn btn-g" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={add}>Save to memory</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
