"use client";
import { useState } from "react";
import { PLANS, useStore } from "@/lib/store";
import { Help } from "@/components/kit";

export default function Billing() {
  const { s, applyPlan } = useStore();
  const [checkout, setCheckout] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [cancel, setCancel] = useState(false);

  const pay = (plan: string) => {
    // TODO(backend): Paddle / Lemon Squeezy checkout replaces this demo flow
    setPaying(true);
    setTimeout(() => { setPaying(false); setCheckout(null); applyPlan(plan); }, 1400);
  };

  return (
    <>
      <div className="pg-head"><h1 className="pg-h1">Billing &amp; Plans <Help k="billing" /></h1></div>
      <div className="card" style={{ marginBottom: 18, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <b style={{ fontSize: 14 }}>Current plan: {PLANS[s.plan].name}</b>
          <div className="sm mut">{PLANS[s.plan].tagline}</div>
          {/* Track was a hardcoded #1a2440, i.e. a near-black bar on the light theme. */}
          <div style={{ height: 6, borderRadius: 3, background: "var(--line2)", margin: "9px 0", overflow: "hidden", maxWidth: 260 }}>
            <i style={{ display: "block", height: "100%", borderRadius: 3, background: "linear-gradient(90deg,var(--ac),var(--blu))", width: (s.tokens / s.tokensMax * 100) + "%" }} />
          </div>
          <div className="xs mut">{s.tokens} of {s.tokensMax} tokens left · refills on the 1st</div>
        </div>
        {s.plan !== "free" && <button className="btn btn-g btn-sm" onClick={() => setCancel(true)}>Cancel plan</button>}
      </div>
      <div className="plangrid">
        {Object.entries(PLANS).map(([k, p]) => (
          <div key={k} className={"card plancard" + (k === "starter" ? " is-best" : "")}>
            {/* Was #04120d — a near-black picked for some other palette. On the accent chip the
                only readable answer is the accent's own foreground. */}
            {k === "starter" && <div className="planbadge">BEST VALUE</div>}
            <h3 className="pg-h2" style={{ margin: 0 }}>{p.name}</h3>
            <div className="planprice">${p.price}<small>/mo</small></div>
            <div className="sm mut">{p.tagline}</div>
            <ul className="planfeat">
              {["⚡ " + p.tokens + " tokens / month", k === "free" ? "1 full article" : k === "starter" ? "~10 articles or mix & match" : "Premium model + leads", "All 6 agents & daily reports"].map((l, j) => (
                <li key={j} className="sm mut"><span className="acc" style={{ fontWeight: 700 }}>✓</span><span>{l}</span></li>
              ))}
            </ul>
            {/* margin-top:auto on the wrapper: the three taglines wrap to different heights, so
                without it the three CTAs sat at three different y positions. */}
            <div className="plancta">
              {s.plan === k
                ? <button className="btn btn-g" style={{ width: "100%" }} disabled>Current plan ✓</button>
                : <button className={"btn " + (k === "free" ? "btn-g" : "btn-p")} style={{ width: "100%" }} onClick={() => k === "free" ? applyPlan(k) : setCheckout(k)}>
                    {PLANS[k].price > PLANS[s.plan].price ? "Upgrade" : "Switch"} to {p.name}
                  </button>}
            </div>
          </div>
        ))}
      </div>
      <p className="xs mut" style={{ marginTop: 16 }}>💡 Token costs: Article ⚡10 · Web Story ⚡4 · Social post ⚡1. Payments processed securely; cancel anytime and keep your data.</p>

      {checkout && (
        <div className="modalwrap" onClick={() => !paying && setCheckout(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            {paying ? (
              <div style={{ textAlign: "center", padding: 10 }}><div className="spin" style={{ margin: "0 auto 14px", width: 26, height: 26 }} /><p className="sm mut">Processing payment…</p></div>
            ) : (
              <>
                <h3 style={{ marginTop: 0 }}>Checkout — {PLANS[checkout].name}</h3>
                <p className="sm mut" style={{ margin: "6px 0 14px" }}>${PLANS[checkout].price}/month · ⚡{PLANS[checkout].tokens} tokens · cancel anytime</p>
                <div className="field"><label>Card number</label><input placeholder="4242 4242 4242 4242" inputMode="numeric" /></div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div className="field" style={{ flex: 1, minWidth: 0 }}><label>Expiry</label><input placeholder="MM/YY" inputMode="numeric" /></div>
                  <div className="field" style={{ flex: 1, minWidth: 0 }}><label>CVC</label><input placeholder="•••" inputMode="numeric" /></div>
                </div>
                <button className="btn btn-p" style={{ width: "100%", marginTop: 8 }} onClick={() => pay(checkout)}>Pay ${PLANS[checkout].price} &amp; activate</button>
                <p className="xs mut" style={{ textAlign: "center", marginTop: 10 }}>🔒 Demo checkout — Paddle/Lemon Squeezy connects in the backend step</p>
              </>
            )}
          </div>
        </div>
      )}
      {cancel && (
        <div className="modalwrap" onClick={() => setCancel(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Cancel {PLANS[s.plan].name}?</h3>
            <p className="sm mut" style={{ margin: "8px 0 16px" }}>You&apos;ll move to Free (10 tokens/mo) at the end of this cycle. Your content, memory and reports stay safe.</p>
            <div className="btnrow">
              <button className="btn btn-g" onClick={() => setCancel(false)}>Keep my plan</button>
              <button className="btn btn-red" onClick={() => { setCancel(false); applyPlan("free"); }}>Yes, cancel</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        /* min() so the 250px track can never be wider than the column itself — a bare
           minmax(250px,1fr) is what pushed this page sideways on a 360px phone. */
        .plangrid { display: grid; gap: 16px;
                    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
        .card.plancard { padding: clamp(18px, 4vw, 26px); position: relative;
                         display: flex; flex-direction: column; }
        .plancard.is-best { border-color: var(--ac); }
        .planbadge { position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
                     background: var(--ac); color: #fff; font-size: 11px; font-weight: 700;
                     padding: 3px 12px; border-radius: 999px; white-space: nowrap; }
        .planprice { font-size: clamp(30px, 8vw, 38px); font-weight: 800; margin: 10px 0 2px;
                     line-height: 1.05; }
        .planprice small { font-size: 14px; color: var(--mut); font-weight: 500; }
        .planfeat { list-style: none; margin: 16px 0 20px; padding: 0; }
        .planfeat li { padding: 5px 0; display: flex; gap: 9px; align-items: flex-start; }
        .plancta { margin-top: auto; }
      `}</style>
    </>
  );
}
