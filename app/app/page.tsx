"use client";
import Link from "next/link";
import { useState } from "react";
import Office from "@/components/Office";
import { Help } from "@/components/kit";
import { PLANS, TOKEN_COST, useStore } from "@/lib/store";

const STAGES = ["🔎 Mr. Keyword — validating topic & related queries", "📊 Analyzing top 10 ranking articles", "🧩 Building the content blueprint", "✍️ Mr. Writer — writing in your brand tone", "🛡️ Mr Lxwa — quality gate check"];

export default function Dashboard() {
  const store = useStore();
  const { s, generate, applyPlan } = store;
  const [confirm, setConfirm] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<number | null>(null);
  const [pipe, setPipe] = useState<{ title: string; stage: number } | null>(null);

  const start = (type: string) => {
    const cost = TOKEN_COST[type];
    if (s.busy) return store.toast("Team is already working — one job at a time");
    if (s.tokens < cost) { setPaywall(cost); return; }
    setConfirm(type);
  };
  const run = (type: string) => {
    setConfirm(null);
    if (type === "article") {
      const title = generate(type, (i: number) => setPipe(p => p && { ...p, stage: i }), () => setTimeout(() => setPipe(null), 900));
      setPipe({ title, stage: -1 });
    } else generate(type);
  };
  const pub = s.content.filter((c: any) => c.status === "published").length;
  const wait = s.content.filter((c: any) => c.status === "awaiting").length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <h1 style={{ fontSize: 21, letterSpacing: -0.3, margin: 0 }}>Good {new Date().getHours() < 12 ? "morning" : "day"}, {s.user?.name} 👋</h1>
        <div style={{ flex: 1 }} />
        <div title={s.user?.email} style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,var(--vio),var(--blu))", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>{s.user?.name?.[0]}</div>
      </div>

      <Office />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14, margin: "18px 0 22px" }}>
        {[
          [<>Tokens left <Help k="tokens" /></>, <>{s.tokens}<small className="mut" style={{ fontSize: 14 }}>/{s.tokensMax}</small></>, `${PLANS[s.plan].name} plan · refills monthly`],
          ["Content published", pub, <span key="u" className="acc">↑ growing your presence</span>],
          [<>Awaiting approval <Help k="approval" /></>, wait, <Link key="a" className="sm" href="/app/approvals">Review now →</Link>],
          [<>Daily reports <Help k="reports" /></>, s.reports.length, <Link key="r" className="sm" href="/app/reports">{s.reports.filter((r: any) => r.unread).length} unread →</Link>],
        ].map((c: any, i) => (
          <div className="card" key={i}>
            <div style={{ fontSize: 12, color: "var(--mut)", display: "flex", alignItems: "center" }}>{c[0]}</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 5 }}>{c[1]}</div>
            <div style={{ fontSize: 11.5, marginTop: 3 }}>{c[2]}</div>
          </div>
        ))}
      </div>

      <div className="dashcols" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>Create content <Help k="pipeline" /></h3>
          <div className="card" style={{ display: "grid", gap: 9 }}>
            {[["article", "📝", "Full Article", "SERP-researched, written to rank"], ["story", "🎨", "Web Story", "Visual story from your latest article"], ["social", "📣", "Social Post", "Platform-ready post + hashtags"]].map(g => (
              <button key={g[0]} className="btn btn-g" style={{ justifyContent: "flex-start", padding: "13px 15px" }} onClick={() => start(g[0])}>
                <span style={{ fontSize: 17 }}>{g[1]}</span>
                <span style={{ textAlign: "left", flex: 1 }}><b style={{ display: "block", fontSize: 13.5 }}>{g[2]}</b><span className="xs mut">{g[3]}</span></span>
                <span className="xs" style={{ background: "var(--panel)", border: "1px solid var(--line2)", padding: "3px 9px", borderRadius: 8 }}>⚡ {TOKEN_COST[g[0]]}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>Live activity <Help k="agents" /></h3>
          <div className="card" style={{ maxHeight: 300, overflowY: "auto" }}>
            {s.activity.length ? s.activity.map((a: any, i: number) => (
              <div key={i} style={{ display: "flex", gap: 11, padding: "9px 6px", borderRadius: 10, fontSize: 12.5 }}>
                <span style={{ color: "var(--mut2)", fontSize: 10.5, flex: "none", width: 44, paddingTop: 2 }}>{a.t}</span>
                <span><span className="acc" style={{ fontWeight: 600 }}>{a.from}</span>{a.to && <> → <span style={{ color: "var(--blu)", fontWeight: 600 }}>{a.to}</span></>}{a.from ? ": " : ""}<span dangerouslySetInnerHTML={{ __html: a.msg }} /></span>
              </div>
            )) : <div className="mut sm" style={{ padding: 14 }}>No activity yet — create your first content.</div>}
          </div>
        </div>
      </div>

      {confirm && (
        <div className="modalwrap" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Create a {confirm === "article" ? "full article" : confirm}?</h3>
            <p className="sm mut">This will use <b className="acc">⚡ {TOKEN_COST[confirm]} tokens</b> (you have {s.tokens}). The result waits for your approval — nothing publishes automatically.</p>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn btn-g" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={() => run(confirm)}>Confirm — start my team</button>
            </div>
          </div>
        </div>
      )}
      {paywall !== null && (
        <div className="modalwrap" onClick={() => setPaywall(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>⚡</div>
            <h3 style={{ margin: 0 }}>Not enough tokens</h3>
            <p className="sm mut" style={{ margin: "8px 0 4px" }}>This needs <b className="acc">{paywall} tokens</b> — you have <b>{s.tokens}</b>.</p>
            <p className="sm mut">Your free tokens refill next month, or upgrade now:</p>
            <div className="card" style={{ textAlign: "left", margin: "16px 0", borderColor: "var(--ac)" }}><b>Starter — $5/mo</b><div className="sm mut">120 tokens · ~10 articles + stories & posts every month</div></div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-g" onClick={() => setPaywall(null)}>Later</button>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={() => { setPaywall(null); applyPlan("starter"); }}>Upgrade to Starter →</button>
            </div>
          </div>
        </div>
      )}
      {pipe && (
        <div className="modalwrap">
          <div className="modal">
            <h3 style={{ margin: "0 0 4px" }}>Creating: <span className="acc">{pipe.title}</span></h3>
            <p className="xs mut" style={{ marginBottom: 16 }}>Content pipeline · live</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {STAGES.map((st, i) => (
                <div key={i} className={"pstep" + (i < pipe.stage ? " done" : i === pipe.stage ? " on" : "")}>
                  <span className="ic">{i < pipe.stage ? "✓" : i + 1}</span>
                  <span style={{ flex: 1 }}>{st}</span>
                  {i === pipe.stage && <span className="spin" style={{ marginLeft: "auto" }} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <style jsx>{`@media (max-width: 860px) { .dashcols { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
