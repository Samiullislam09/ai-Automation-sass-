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
      <h1 style={{ fontSize: 21, margin: "0 0 20px" }}>Billing & Plans <Help k="billing" /></h1>
      <div className="card" style={{ marginBottom: 18, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <b>Current plan: {PLANS[s.plan].name}</b>
          <div className="sm mut">{PLANS[s.plan].tagline}</div>
          <div style={{ height: 6, borderRadius: 3, background: "#1a2440", margin: "9px 0", overflow: "hidden", maxWidth: 260 }}>
            <i style={{ display: "block", height: "100%", borderRadius: 3, background: "linear-gradient(90deg,var(--ac),var(--blu))", width: (s.tokens / s.tokensMax * 100) + "%" }} />
          </div>
          <div className="xs mut">{s.tokens} of {s.tokensMax} tokens left · refills on the 1st</div>
        </div>
        {s.plan !== "free" && <button className="btn btn-g btn-sm" onClick={() => setCancel(true)}>Cancel plan</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16 }}>
        {Object.entries(PLANS).map(([k, p]) => (
          <div key={k} className="card" style={{ padding: 26, position: "relative", ...(k === "starter" ? { borderColor: "var(--ac)" } : {}) }}>
            {k === "starter" && <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: "var(--ac)", color: "#04120d", fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 999 }}>BEST VALUE</div>}
            <h3 style={{ fontSize: 15, margin: 0 }}>{p.name}</h3>
            <div style={{ fontSize: 38, fontWeight: 800, margin: "10px 0 2px" }}>${p.price}<small style={{ fontSize: 14, color: "var(--mut)", fontWeight: 500 }}>/mo</small></div>
            <div className="sm mut">{p.tagline}</div>
            <ul style={{ listStyle: "none", margin: "16px 0 20px", padding: 0 }}>
              {["⚡ " + p.tokens + " tokens / month", k === "free" ? "1 full article" : k === "starter" ? "~10 articles or mix & match" : "Premium model + leads", "All 6 agents & daily reports"].map((l, j) => (
                <li key={j} className="sm mut" style={{ padding: "5px 0", display: "flex", gap: 9 }}><span className="acc" style={{ fontWeight: 700 }}>✓</span>{l}</li>
              ))}
            </ul>
            {s.plan === k
              ? <button className="btn btn-g" style={{ width: "100%" }} disabled>Current plan ✓</button>
              : <button className={"btn " + (k === "free" ? "btn-g" : "btn-p")} style={{ width: "100%" }} onClick={() => k === "free" ? applyPlan(k) : setCheckout(k)}>
                  {PLANS[k].price > PLANS[s.plan].price ? "Upgrade" : "Switch"} to {p.name}
                </button>}
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
                  <div className="field" style={{ flex: 1 }}><label>Expiry</label><input placeholder="MM/YY" /></div>
                  <div className="field" style={{ flex: 1 }}><label>CVC</label><input placeholder="•••" /></div>
                </div>
                <button className="btn btn-p" style={{ width: "100%", marginTop: 8 }} onClick={() => pay(checkout)}>Pay ${PLANS[checkout].price} & activate</button>
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
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-g" onClick={() => setCancel(false)}>Keep my plan</button>
              <button className="btn btn-red" style={{ flex: 1 }} onClick={() => { setCancel(false); applyPlan("free"); }}>Yes, cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
