"use client";
import { useState } from "react";
import { PLANS, useStore } from "@/lib/store";
import { LxInput } from "./ui";

/** /dashboard/settings — same real logic as the old app/app/billing/page.tsx. The checkout
 *  itself is still the demo flow noted there (TODO backend: Paddle / Lemon Squeezy replaces
 *  this) — `applyPlan` just updates local plan state, same as before; nothing here pretends a
 *  real charge happens. Restyled to the new dashboard theme per the owner's standing
 *  instruction (2026-08-29). Rendered inside <MrLxwaDashboard> as its `children` — see
 *  app/dashboard/settings/page.tsx. */

export default function BillingSection() {
  const { s, applyPlan } = useStore();
  const [checkout, setCheckout] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [cancel, setCancel] = useState(false);

  const pay = (plan: string) => {
    setPaying(true);
    setTimeout(() => { setPaying(false); setCheckout(null); applyPlan(plan); }, 1400);
  };

  return (
    <div className="space-y-4" style={{ maxWidth: 980 }}>
      <h1 className="text-lg font-bold">Billing &amp; Plans</h1>

      <div className="lx-card2 flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1 basis-52">
          <b className="lx-12">Current plan: {PLANS[s.plan].name}</b>
          <div className="lx-11 lx-mut">{PLANS[s.plan].tagline}</div>
          <div className="my-2.5 h-1.5 max-w-64 overflow-hidden rounded-full" style={{ background: "var(--lx-border)" }}>
            <i
              className="block h-full rounded-full"
              style={{ background: "linear-gradient(90deg,#2563eb,#22d3ee)", width: (s.tokens / s.tokensMax * 100) + "%" }}
            />
          </div>
          <div className="lx-10 lx-mut">{s.tokens} of {s.tokensMax} tokens left · refills on the 1st</div>
        </div>
        {s.plan !== "free" && (
          <button className="lx-ghost" onClick={() => setCancel(true)}>Cancel plan</button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(PLANS).map(([k, p]) => (
          <div
            key={k}
            className="lx-card2 relative flex flex-col p-5"
            style={k === "starter" ? { borderColor: "var(--lx-cyan)" } : undefined}
          >
            {k === "starter" && (
              <div
                className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-3 py-0.5 text-white"
                style={{ background: "var(--lx-cyan)", color: "#04101a", fontSize: 11, fontWeight: 700 }}
              >
                BEST VALUE
              </div>
            )}
            <h3 className="lx-13 font-bold">{p.name}</h3>
            <div className="mt-2 font-extrabold" style={{ fontSize: "clamp(28px,7vw,36px)", lineHeight: 1.05 }}>
              ${p.price}<small className="lx-11 lx-mut font-medium">/mo</small>
            </div>
            <div className="lx-11 lx-mut">{p.tagline}</div>
            <ul className="my-4 space-y-1.5">
              {["⚡ " + p.tokens + " tokens / month", k === "free" ? "1 full article" : k === "starter" ? "~10 articles or mix & match" : "Premium model + leads", "All 6 agents & daily reports"].map((l, j) => (
                <li key={j} className="lx-11 lx-mut flex items-start gap-2">
                  <span style={{ color: "var(--lx-cyan)", fontWeight: 700 }}>✓</span><span>{l}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto">
              {s.plan === k ? (
                <button className="lx-ghost w-full justify-center" disabled>Current plan ✓</button>
              ) : (
                <button
                  className={k === "free" ? "lx-ghost w-full justify-center" : "lx-grad lx-11 w-full px-3.5 py-2"}
                  onClick={() => (k === "free" ? applyPlan(k) : setCheckout(k))}
                >
                  {PLANS[k].price > PLANS[s.plan].price ? "Upgrade" : "Switch"} to {p.name}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="lx-10 lx-mut">
        💡 Token costs: Article ⚡10 · Web Story ⚡4 · Social post ⚡1. Payments processed securely; cancel anytime and keep your data.
      </p>

      {checkout && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,.6)" }}
          onClick={() => !paying && setCheckout(null)}
        >
          <div className="lx-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            {paying ? (
              <div className="p-2.5 text-center">
                <div
                  className="mx-auto mb-3.5 h-6 w-6 animate-spin rounded-full"
                  style={{ border: "3px solid var(--lx-border)", borderTopColor: "var(--lx-cyan)" }}
                />
                <p className="lx-11 lx-mut">Processing payment…</p>
              </div>
            ) : (
              <>
                <h3 className="lx-13 mt-0 font-bold">Checkout — {PLANS[checkout].name}</h3>
                <p className="lx-11 lx-mut my-1.5">${PLANS[checkout].price}/month · ⚡{PLANS[checkout].tokens} tokens · cancel anytime</p>
                <div className="mt-2">
                  <label className="lx-10 lx-mut mb-1 block">Card number</label>
                  <LxInput placeholder="4242 4242 4242 4242" inputMode="numeric" />
                </div>
                <div className="mt-2 flex gap-2.5">
                  <div className="min-w-0 flex-1">
                    <label className="lx-10 lx-mut mb-1 block">Expiry</label>
                    <LxInput placeholder="MM/YY" inputMode="numeric" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="lx-10 lx-mut mb-1 block">CVC</label>
                    <LxInput placeholder="•••" inputMode="numeric" />
                  </div>
                </div>
                <button className="lx-grad lx-11 mt-3.5 w-full px-3.5 py-2.5" onClick={() => pay(checkout)}>
                  Pay ${PLANS[checkout].price} &amp; activate
                </button>
                <p className="lx-10 lx-mut mt-2.5 text-center">🔒 Demo checkout — Paddle/Lemon Squeezy connects in the backend step</p>
              </>
            )}
          </div>
        </div>
      )}

      {cancel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.6)" }} onClick={() => setCancel(false)}>
          <div className="lx-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="lx-13 mt-0 font-bold">Cancel {PLANS[s.plan].name}?</h3>
            <p className="lx-11 lx-mut my-2">You&apos;ll move to Free (10 tokens/mo) at the end of this cycle. Your content, memory and reports stay safe.</p>
            <div className="flex gap-2.5">
              <button className="lx-ghost flex-1 justify-center" onClick={() => setCancel(false)}>Keep my plan</button>
              <button className="lx-ghost flex-1 justify-center" style={{ color: "#f87171" }} onClick={() => { setCancel(false); applyPlan("free"); }}>
                Yes, cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
