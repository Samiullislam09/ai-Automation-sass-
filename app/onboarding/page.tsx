"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";

const STEPS = [
  { key: "type", q: "What kind of business?", opts: ["Local service", "Online store", "Agency / freelancer", "SaaS / startup", "Blog / creator", "Other"] },
  { key: "aud", q: "Who are your customers?", opts: ["Local customers", "Small businesses", "Consumers online", "Professionals", "Everyone"] },
  { key: "tone", q: "How should your content sound?", opts: ["Friendly & simple", "Professional", "Expert & detailed", "Fun & bold"] },
  { key: "pace", q: "Publishing pace?", opts: ["1 article / week", "2–3 / week", "Daily", "I'll decide per article"] },
];

export default function Onboarding() {
  const { patch, act } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [site, setSite] = useState("");
  const [ans, setAns] = useState<Record<string, string>>({});
  const [thinking, setThinking] = useState<string[]>([]);
  const pct = [10, 30, 50, 70, 88, 100][step];

  const finish = () => {
    setStep(5);
    // TODO(backend): real crawl + embeddings (Build Guide Step 5) replaces this simulation
    const lines = [`Reading ${site} …`, "Detecting your niche and topics …", "Learning your brand tone …", "Mapping content opportunities …", "Building your team's memory …"];
    lines.forEach((l, i) => setTimeout(() => setThinking(t => [...t, l]), 500 + i * 700));
    setTimeout(() => {
      patch({
        onboarded: true,
        memory: [
          { k: "Website", v: site }, { k: "Business type", v: ans.type }, { k: "Audience", v: ans.aud },
          { k: "Brand tone", v: ans.tone }, { k: "Publishing pace", v: ans.pace },
          { k: "Niche summary", v: ans.type === "Local service" ? "Local services for nearby customers — trust, reviews and local visibility matter most" : `Content-led growth for ${(ans.aud || "").toLowerCase()} — clarity and consistency matter most` },
          { k: "Goals", v: "More organic traffic, consistent publishing, and inbound leads" },
        ],
      });
      act(`finished studying <b>${site}</b> and built the team memory.`, "Boss AI");
      router.push("/whoami");
    }, 500 + lines.length * 700 + 500);
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 22, position: "relative", zIndex: 1 }}>
      <div className="card" style={{ width: "100%", maxWidth: 520, padding: 32 }}>
        <div style={{ height: 5, borderRadius: 3, background: "#1a2440", marginBottom: 26, overflow: "hidden" }}>
          <i style={{ display: "block", height: "100%", background: "linear-gradient(90deg,var(--ac),var(--blu))", borderRadius: 3, width: pct + "%", transition: "width .5s cubic-bezier(.4,0,.2,1)" }} />
        </div>
        {step === 0 && (
          <>
            <h2 style={{ fontSize: 22 }}>Let&apos;s meet your business 👋</h2>
            <p className="sm mut" style={{ margin: "8px 0 18px" }}>Paste your website — Boss AI will study it and learn everything by itself. This is the only typing you&apos;ll do.</p>
            <div className="field"><label>Your website</label><input placeholder="https://yourbusiness.com" value={site} onChange={e => setSite(e.target.value)} /></div>
            <button className="btn btn-p" style={{ width: "100%", marginTop: 10 }} disabled={!site.trim()} onClick={() => setStep(1)}>Continue →</button>
            <p className="xs mut" style={{ textAlign: "center", marginTop: 12 }}>No website yet? <a style={{ cursor: "pointer" }} onClick={() => { setSite("(no website yet)"); setStep(1); }}>Skip — describe instead</a></p>
          </>
        )}
        {step >= 1 && step <= 4 && (
          <>
            <h2 style={{ fontSize: 20 }}>{STEPS[step - 1].q}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 9, margin: "14px 0" }}>
              {STEPS[step - 1].opts.map(o => (
                <span key={o} onClick={() => setAns(a => ({ ...a, [STEPS[step - 1].key]: o }))}
                  style={{ padding: "9px 16px", borderRadius: 999, cursor: "pointer", userSelect: "none", fontSize: 13, transition: "all .2s", border: "1px solid " + (ans[STEPS[step - 1].key] === o ? "var(--ac)" : "var(--line2)"), background: ans[STEPS[step - 1].key] === o ? "linear-gradient(135deg,#173c33,#12352c)" : "var(--panel2)", color: ans[STEPS[step - 1].key] === o ? "var(--ac)" : "var(--ink)", fontWeight: ans[STEPS[step - 1].key] === o ? 600 : 400 }}>{o}</span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn btn-g" onClick={() => setStep(step - 1)}>← Back</button>
              <button className="btn btn-p" style={{ flex: 1 }} disabled={!ans[STEPS[step - 1].key]} onClick={() => step === 4 ? finish() : setStep(step + 1)}>{step === 4 ? "Finish setup ✓" : "Continue →"}</button>
            </div>
          </>
        )}
        {step === 5 && (
          <>
            <h2 style={{ fontSize: 20 }}>Boss AI is learning your business…</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, margin: "22px 0" }}>
              {thinking.map((t, i) => <div key={i} style={{ display: "flex", gap: 11, fontSize: 13.5, color: "var(--mut)", animation: "tin .4s ease" }}><span className="acc">✓</span>{t}</div>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
