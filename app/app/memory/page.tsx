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
      <h1 className="pg-h1">AI Memory <Help k="memory" /></h1>
      <p className="pg-sub">What your team actually knows and has connected — pulled live from your account, not just guessed.</p>

      {/* What we've connected */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h2 className="pg-h3">What we&apos;ve connected</h2>
        {loadingStatus ? (
          <p className="sm mut" style={{ margin: 0 }}>Checking…</p>
        ) : !status?.integrations.length ? (
          <p className="sm mut" style={{ margin: 0 }}>Nothing connected yet. <Link href="/app/connect">Connect WordPress, your site or social →</Link></p>
        ) : (
          <div>
            {/* .kv stacks label over pill below 520px — "Google (Search Console + Analytics)"
                next to a CONNECTED pill left about six characters per line on a phone. */}
            {status.integrations.map((i, idx) => (
              <div key={idx} className="kv">
                <span className="sm">{INTEGRATION_LABEL[i.type] ?? i.type}</span>
                <span className={"pillst " + pillClass(i.status)}>{i.status.toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* What Google measured — the evidence the agents plan from */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h2 className="pg-h3" style={{ marginBottom: 4 }}>What Google says about your site</h2>
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
                      <span className="ins-q">{p.url}</span>
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

      </div>

      {/* What we've learned from the site crawl */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h2 className="pg-h3">What we&apos;ve learned from your site</h2>
        {loadingStatus ? (
          <p className="sm mut">Checking…</p>
        ) : !status?.crawl.pagesIndexed ? (
          <p className="sm mut">Site not analyzed yet — this happens automatically during onboarding.</p>
        ) : (
          <>
            <p className="sm" style={{ marginBottom: 10 }}>{status.tenant.niche}</p>
            <p className="xs mut brk" style={{ marginBottom: 10 }}>
              <b style={{ color: "var(--ink)" }}>{status.crawl.pagesIndexed}</b> page{status.crawl.pagesIndexed === 1 ? "" : "s"} read from{" "}
              <span style={{ color: "var(--ink)" }}>{status.tenant.websiteUrl}</span>
            </p>
            {status.tenant.topics.length > 0 && (
              <div className="topicwrap">
                {status.tenant.topics.map((t, i) => (
                  <span key={i} className="topic">{t}</span>
                ))}
              </div>
            )}
            {status.crawl.samplePages.length > 0 && (
              <details>
                <summary className="xs mut" style={{ cursor: "pointer" }}>See pages read</summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {status.crawl.samplePages.map((p, i) => (
                    <li key={i} className="xs mut brk" style={{ marginBottom: 4 }}>{p.title}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      <div className="pg-head" style={{ marginBottom: 6 }}>
        <h2 className="pg-h2" style={{ margin: 0 }}>Business facts</h2>
        <div className="sp" />
        <button className="btn btn-g btn-sm" onClick={() => setAdding(true)}>+ Add fact</button>
      </div>
      <p className="sm mut" style={{ margin: "0 0 14px" }}>From your onboarding answers. Click ✎ to edit — every agent adjusts instantly.</p>

      {/* Was a single flex row: a fixed 110px label, the value, and two bare <button>s with no
          box at all. On a 360px phone that left ~120px for the fact and gave the edit/delete
          controls a ~16px hit area. Grid now, stacking the label above the value on a phone. */}
      <div className="listgrid" style={{ gap: 9 }}>
        {s.memory.map((m: any, i: number) => (
          <div key={i} className="card card-tight fact">
            <span className="fact-k">{m.k}</span>
            {edit === i
              ? <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && save(i)} />
              : <span className="fact-v brk">{m.v}</span>}
            <div className="fact-a">
              {edit === i
                ? <button className="btn btn-p btn-sm" onClick={() => save(i)}>Save</button>
                : <>
                    <button className="iconbtn" aria-label={`Edit ${m.k}`} title="Edit" onClick={() => { setEdit(i); setVal(m.v); }}>✎</button>
                    <button className="iconbtn is-danger" aria-label={`Delete ${m.k}`} title="Delete" onClick={() => del(i)}>🗑</button>
                  </>}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <div className="corb" /><div className="sm" style={{ minWidth: 0 }}><b>Who am I?</b> — <Link href="/whoami">Read Mr Lxwa&apos;s current understanding of your business →</Link></div>
      </div>
      {adding && (
        <div className="modalwrap" onClick={() => setAdding(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Add to memory</h3>
            <div className="field"><label>Label</label><input placeholder="e.g. Products, USP, Do not mention…" value={nk} onChange={e => setNk(e.target.value)} /></div>
            <div className="field"><label>Fact</label><textarea rows={3} placeholder="What should your team know?" value={nv} onChange={e => setNv(e.target.value)} /></div>
            <div className="btnrow" style={{ marginTop: 10 }}>
              <button className="btn btn-g" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-p" style={{ flex: "1 1 auto" }} onClick={add}>Save to memory</button>
            </div>
          </div>
        </div>
      )}

      {/* One styled-jsx block per component, at the component root. Two of them in the same
          component crashes the SWC styled-jsx transform outright (visitor.rs unwrap on None),
          which shows up as a build failure with no TypeScript error to point at. */}
      <style jsx>{`
        /* A search query and its "pos 8.4 · 210 impressions · 3 clicks" tail on one 328px line
           left roughly two words each. Below 560px the numbers move under the query. */
        .ins-row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
                   padding: 6px 0; border-bottom: 1px solid var(--line); }
        .ins-row:last-child { border-bottom: none; }
        .ins-q { font-size: 12.5px; color: var(--ink); min-width: 0; overflow-wrap: anywhere; }
        .ins-row > :last-child { flex: none; white-space: nowrap; }
        @media (max-width: 560px) {
          .ins-row { flex-direction: column; gap: 2px; align-items: stretch; }
          .ins-row > :last-child { white-space: normal; }
        }

        .topicwrap { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .topic { font-size: 11.5px; line-height: 1.5; padding: 4px 10px; border-radius: 999px;
                 background: var(--panel2); border: 1px solid var(--line2); color: var(--mut);
                 overflow-wrap: anywhere; }

        .fact { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 10px;
                align-items: center; }
        .fact-k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px;
                  color: var(--mut); overflow-wrap: anywhere; }
        .fact-v { font-size: 13.5px; }
        .fact-a { display: flex; gap: 4px; align-items: center; justify-self: end; }
        /* Below 560px the fixed label column is more than a third of the screen, so the label
           becomes a caption above its value and the controls sit on the label's row. */
        @media (max-width: 560px) {
          .fact { grid-template-columns: minmax(0, 1fr) auto; row-gap: 6px; align-items: start; }
          .fact-k { align-self: center; }
          .fact-v, .fact :global(input) { grid-column: 1 / -1; }
        }
      `}</style>
    </>
  );
}
