"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ArrowRight, Check, Link2, Pencil, MessageCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { LogoMark } from "@/components/brand/MenCraLogo";
import { useOnboardingProfile } from "@/components/onboarding-profile";
import { liveStage, pctFor, type BrainJobs } from "@/lib/brainPhases";

/** The signup flow, cut to what a founder will actually do (owner, 2026-11-20): TWO things from the customer — their website and one WhatsApp scan — and the rest is read off the site.
 *
 *    1  Website      the only thing we truly need; the crawl and the analyst start in the background the moment it is typed
 *    2  "Is this you?"  what we understood (what you do, who for, where, what you sell). One tap to confirm, or fix a line. No questionnaire.
 *    3  WhatsApp     scan the QR (optional: "Skip for now"; it can be linked any time from the WhatsApp page)
 *    ✓  Done
 *
 *  Gone: business type, goal, "where should we publish" (WordPress / webhook live on the Connect page), the dual-column marketing panel.
 *  Look: the home page's — white, near-black text, lavender wash, #6a5af0 accent, black pill buttons. */

const GOAL = { primary: "leads" as const, kpis: [], focus: [] };
const SLOW_AFTER_MS = 45_000;

type Wa = { status: string; qr: string | null; phone: string | null };

export default function OnboardingWizard() {
  const { patch, act, saveMemory } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [site, setSite] = useState("");
  // A website typed on the home page ("Connect your site") before signing up: fill the first step with it, once.
  useEffect(() => {
    try {
      const v = localStorage.getItem("mencra.pendingSite");
      if (v) { setSite((cur) => cur || v); localStorage.removeItem("mencra.pendingSite"); }
    } catch { /* storage blocked: the field just starts empty */ }
  }, []);
  const [noSite, setNoSite] = useState(false);
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);

  // 2 · understanding
  const understanding = useOnboardingProfile(step >= 1 && !noSite);
  const profile = understanding?.status === "ready" ? understanding.profile : null;
  const [editing, setEditing] = useState(false);
  const [manual, setManual] = useState(false); // "Describe it myself" while the site is still being read: the website stays saved
  const [described, setDescribed] = useState(""); // what_they_do, as confirmed or edited — or typed from scratch when there is no site to read
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [brainJobs, setBrainJobs] = useState<BrainJobs | null>(null);
  const [slow, setSlow] = useState(false);
  const enteredAt = useRef<number | null>(null);

  // 3 · WhatsApp
  const [wa, setWa] = useState<Wa | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [waError, setWaError] = useState<string | null>(null);
  const [waStarted, setWaStarted] = useState(false);
  const [waLinked, setWaLinked] = useState(false);

  const cantRead = noSite || manual || understanding?.status === "no-pages" || understanding?.status === "off";
  const reading = !cantRead && !profile;

  useEffect(() => { if (profile && !described) setDescribed(profile.what_they_do ?? ""); }, [profile, described]);

  // Live progress while the site is still being read — the same jobs Site Brain's bar polls.
  useEffect(() => {
    if (step !== 1 || !reading) return;
    if (enteredAt.current == null) enteredAt.current = Date.now();
    let alive = true;
    const tick = async () => {
      try {
        const d = await fetch("/api/site-brain/status").then((r) => r.json());
        if (alive && d?.ok) setBrainJobs(d.jobs ?? null);
      } catch { /* next poll */ }
      if (alive && Date.now() - (enteredAt.current ?? Date.now()) > SLOW_AFTER_MS) setSlow(true);
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [step, reading]);

  const stage = liveStage(brainJobs, null, null);
  const pct = stage ? pctFor(stage) : 4;
  const stageLabel = stage?.job.progress?.label ?? "Opening your website…";

  /** Saves the address and starts the crawl in the background, right now. */
  const startReading = async () => {
    setSiteSaving(true);
    setSiteError(null);
    try {
      const res = await fetch("/api/onboarding/site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ websiteUrl: site.trim() }) });
      const data = await res.json();
      if (!data.ok && res.status === 400) { setSiteError(data.error || "That doesn't look like a website address."); return; }
    } catch {
      // offline or a bad gateway: carry on, the address is saved again when the profile is confirmed
    } finally {
      setSiteSaving(false);
    }
    setStep(1);
  };

  /** "Yes, that's right": store the profile, mark the account onboarded, move on to WhatsApp. */
  const confirm = async () => {
    const text = described.trim();
    if (!text) { setSaveError("Write a line about what your business does."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      // A corrected line goes through the same writer Site Brain uses, so it is versioned and the analyst never overwrites it.
      if (profile && text !== (profile.what_they_do ?? "")) {
        await fetch("/api/site-brain", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: "what_they_do", value: text }) }).catch(() => {});
      }
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteUrl: noSite ? null : site.trim() || null,
          niche: text,
          toneProfile: { tone: "Professional", goals: { ...GOAL } },
          icpProfile: { audience: profile?.audience ?? null, geo: profile?.geo ?? null },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) { setSaveError(data?.error || "Couldn't save that. Try again."); return; }
      fetch("/api/site-brain", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: "goals", value: { ...GOAL } }) }).catch(() => {});
      patch({ onboarded: true });
      saveMemory([
        ...(!noSite && site.trim() ? [{ k: "Website", v: site.trim() }] : []),
        { k: "Niche summary", v: text },
        ...(profile?.audience ? [{ k: "Audience", v: profile.audience }] : []),
        { k: "Goals", v: "More enquiries and inbound leads" },
      ]);
      act(noSite ? "saved your business." : `finished studying <b>${site}</b> and built the team memory.`, "MenCra");
      setStep(2);
    } catch {
      setSaveError("Couldn't reach the server — try again in a moment.");
    } finally {
      setSaving(false);
    }
  };

  // ── WhatsApp: start pairing as soon as the step opens, poll until linked ──────────────────────────────────────────────────────────────
  const pollWa = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/status").then((x) => x.json());
      if (r.ok) setWa({ status: r.status, qr: r.qr ?? null, phone: r.phone ?? null });
    } catch { /* transient */ }
  }, []);

  useEffect(() => {
    if (step !== 2 || waStarted) return;
    setWaStarted(true);
    fetch("/api/whatsapp/connect", { method: "POST" })
      .then((x) => x.json())
      .then((r) => { if (!r.ok) setWaError(r.error ?? "Couldn't start the WhatsApp link."); else setWa({ status: r.status, qr: r.qr ?? null, phone: r.phone ?? null }); })
      .catch(() => setWaError("Couldn't reach the server."));
  }, [step, waStarted]);

  useEffect(() => {
    if (step !== 2) return;
    const id = setInterval(pollWa, wa?.status === "pairing" ? 2500 : 5000);
    return () => clearInterval(id);
  }, [step, pollWa, wa?.status]);

  useEffect(() => {
    if (wa?.qr) QRCode.toDataURL(wa.qr, { width: 232, margin: 1, color: { dark: "#0a0a0a", light: "#ffffff" } }).then(setQrUrl).catch(() => setQrUrl(""));
    else setQrUrl("");
  }, [wa?.qr]);

  useEffect(() => {
    if (step !== 2 || wa?.status !== "connected") return;
    setWaLinked(true);
    const t = setTimeout(() => setStep(3), 1400);
    return () => clearTimeout(t);
  }, [step, wa?.status]);

  const skipWhatsapp = () => {
    // A pairing session was started for the QR; stop it if nobody scanned, so nothing is left half-open.
    if (wa?.status !== "connected") fetch("/api/whatsapp/disconnect", { method: "POST" }).catch(() => {});
    setStep(3);
  };

  const shown = Math.min(step, 2);
  const waState = wa?.status ?? "starting";

  return (
    <div className="ob">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="ob-head">
        <div className="ob-brand"><LogoMark size={30} /><b>MenCra</b></div>
        {step < 3 && <span className="ob-count">Step {shown + 1} of 3</span>}
      </header>

      <main className="ob-main">
        <div className="ob-card">
          {step < 3 && (
            <div className="ob-bar" aria-hidden><i style={{ width: `${((shown + 1) / 3) * 100}%` }} /></div>
          )}

          {step === 0 && (
            <>
              <h1 className="ob-h1">What&apos;s your website?</h1>
              <p className="ob-sub">MenCra reads it to understand your business. That&apos;s all we need from you to start.</p>
              <div className="ob-inputwrap">
                <span className="ob-ic"><Link2 size={15} /></span>
                <input className="ob-input" placeholder="yourbusiness.com" value={site} autoFocus onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && site.trim() && !siteSaving && startReading()} />
              </div>
              {siteError && <p className="ob-error">{siteError}</p>}
              <button className="ob-primary" disabled={!site.trim() || siteSaving} onClick={startReading}>{siteSaving ? "Opening…" : "Continue"} <ArrowRight size={16} /></button>
              <p className="ob-fine">Read-only. We never change your site.</p>
              <button className="ob-link" onClick={() => { setSite(""); setNoSite(true); setStep(1); }}>I don&apos;t have a website yet</button>
            </>
          )}

          {step === 1 && reading && (
            <>
              <h1 className="ob-h1">Reading your website…</h1>
              <p className="ob-sub">This takes a minute or two. You don&apos;t have to wait on this page: it keeps going on its own.</p>
              <div className="ob-prog">
                <div className="ob-prog-top"><span className="ob-pulse" /><b>{stageLabel}</b><span>{pct}%</span></div>
                <div className="ob-prog-bar"><i style={{ width: `${pct}%` }} /></div>
              </div>
              {slow && (
                <>
                  <p className="ob-sub" style={{ marginTop: 14 }}>Taking longer than usual. You can describe your business yourself and we&apos;ll keep reading in the background.</p>
                  <button className="ob-secondary" onClick={() => setManual(true)}>Describe it myself</button>
                </>
              )}
            </>
          )}

          {step === 1 && !reading && (
            <>
              {profile ? (
                <>
                  <h1 className="ob-h1">Is this your business?</h1>
                  <p className="ob-sub">This is what MenCra understood from your site. Fix anything that&apos;s off.</p>
                  <div className="ob-sum">
                    <div className="ob-row">
                      <small>What you do</small>
                      {editing ? (
                        <textarea className="ob-input ob-ta" rows={3} value={described} onChange={(e) => setDescribed(e.target.value)} autoFocus />
                      ) : (
                        <p>{described || "—"}</p>
                      )}
                    </div>
                    {profile.audience && <div className="ob-row"><small>Who it&apos;s for</small><p>{profile.audience}</p></div>}
                    {profile.geo && <div className="ob-row"><small>Where</small><p>{profile.geo}</p></div>}
                    {profile.offerings.length > 0 && (
                      <div className="ob-row">
                        <small>What you offer</small>
                        <div className="ob-chips">{profile.offerings.slice(0, 5).map((o) => <span key={o.name}>{o.name}</span>)}</div>
                      </div>
                    )}
                  </div>
                  {saveError && <p className="ob-error">{saveError}</p>}
                  <div className="ob-actions">
                    <button className="ob-primary" disabled={saving} onClick={() => { setEditing(false); void confirm(); }}>{saving ? "Saving…" : "Yes, that's right"} <ArrowRight size={16} /></button>
                    {!editing && <button className="ob-secondary" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
                  </div>
                </>
              ) : (
                <>
                  <h1 className="ob-h1">Tell us about your business</h1>
                  <p className="ob-sub">{noSite ? "No website, no problem. One or two lines is enough." : "We couldn't read your site, so tell us in a line or two."}</p>
                  <textarea className="ob-input ob-ta" rows={4} placeholder="We help small manufacturers get ISO certified in 3 months…" value={described} autoFocus onChange={(e) => setDescribed(e.target.value)} />
                  {saveError && <p className="ob-error">{saveError}</p>}
                  <div className="ob-actions">
                    <button className="ob-primary" disabled={saving || described.trim().length < 10} onClick={confirm}>{saving ? "Saving…" : "Continue"} <ArrowRight size={16} /></button>
                  </div>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="ob-h1">Link your WhatsApp</h1>
              <p className="ob-sub">MenCra uses it to message your leads and answer their replies. Scan once, like WhatsApp Web. <b>Optional:</b> you can skip it and do it later.</p>
              {waLinked ? (
                <div className="ob-ok"><span><Check size={26} strokeWidth={3} /></span><b>Connected{wa?.phone ? ` · ${wa.phone}` : ""}</b></div>
              ) : (
                <>
                  <div className="ob-qr">
                    {qrUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrUrl} alt="WhatsApp link code" width={232} height={232} />
                    ) : waState === "banned" ? (
                      <span className="ob-qrmsg err">WhatsApp has blocked this number. Try a different one, or skip.</span>
                    ) : waError ? (
                      <span className="ob-qrmsg err">{waError}</span>
                    ) : (
                      <span className="ob-qrmsg">Getting your code…</span>
                    )}
                  </div>
                  <ol className="ob-how">
                    <li>Open <b>WhatsApp</b> on your phone</li>
                    <li><b>Settings → Linked devices → Link a device</b></li>
                    <li>Point it at this code</li>
                  </ol>
                  {(waError || waState === "banned" || waState === "logged_out") && (
                    <button className="ob-secondary" onClick={() => { setWaError(null); setWaStarted(false); }}><MessageCircle size={14} /> Try again</button>
                  )}
                </>
              )}
              <div className="ob-actions" style={{ justifyContent: "space-between" }}>
                <button className="ob-link" style={{ margin: 0 }} onClick={skipWhatsapp}>Skip for now</button>
                {waLinked && <button className="ob-primary" onClick={() => setStep(3)}>Continue <ArrowRight size={16} /></button>}
              </div>
            </>
          )}

          {step === 3 && (
            <div className="ob-done">
              <span className="ob-donecheck"><Check size={28} strokeWidth={3} /></span>
              <h1 className="ob-h1">You&apos;re all set</h1>
              <p className="ob-sub">MenCra is already working. Your first leads will show up on the dashboard.</p>
              <ul className="ob-list">
                <li><span><Check size={12} strokeWidth={3} /></span>{noSite ? "Business saved" : "Website read"}</li>
                <li><span><Check size={12} strokeWidth={3} /></span>Your business understood</li>
                <li className={waLinked ? "" : "off"}><span>{waLinked ? <Check size={12} strokeWidth={3} /> : "–"}</span>{waLinked ? "WhatsApp connected" : "WhatsApp: skipped, link it any time from the WhatsApp page"}</li>
              </ul>
              <button className="ob-primary" style={{ width: "100%" }} onClick={() => router.push("/dashboard")}>Go to dashboard <ArrowRight size={16} /></button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* The home page's look: white, #0a0a0a text, #737373 secondary, lavender wash (#efecff), #6a5af0 accent, black pill buttons, big radii.
   Injected as a string: React escapes ">" inside a <style> text child and breaks child selectors. */
const CSS = `
.ob{min-height:100vh;display:flex;flex-direction:column;color:#0a0a0a;font-family:var(--font-jakarta),"Plus Jakarta Sans",system-ui,sans-serif;
  background:linear-gradient(180deg,#efecff -20%,#fff 46%);-webkit-font-smoothing:antialiased}
.ob *{box-sizing:border-box}
.ob-head{display:flex;align-items:center;justify-content:space-between;padding:22px 32px}
.ob-brand{display:flex;align-items:center;gap:10px;font-size:19px;letter-spacing:-.01em}
.ob-count{font-size:13px;color:#737373;font-weight:500}
.ob-main{flex:1;display:flex;align-items:flex-start;justify-content:center;padding:28px 16px 56px}
.ob-card{width:100%;max-width:520px;background:#fff;border-radius:32px;padding:34px 34px 30px;border:1px solid #ece9fb;
  box-shadow:0 30px 60px -28px rgba(106,90,240,.28),0 8px 24px -12px rgba(10,10,10,.08)}
.ob-bar{height:4px;border-radius:999px;background:#efecff;overflow:hidden;margin-bottom:26px}
.ob-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#a78bfa,#6a5af0 55%,#3b82f6);transition:width .5s ease}
.ob-h1{margin:0;font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-.02em}
.ob-sub{margin:10px 0 22px;font-size:15px;line-height:1.55;color:#737373}
.ob-sub b{color:#0a0a0a;font-weight:600}
.ob-inputwrap{position:relative}
.ob-ic{position:absolute;left:14px;top:50%;transform:translateY(-50%);width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:#efecff;color:#6a5af0;pointer-events:none}
.ob-input{width:100%;height:52px;padding:0 16px 0 52px;border-radius:16px;border:1.5px solid #e5e5e5;background:#fff;color:#0a0a0a;font:inherit;font-size:16px;outline:none;transition:.15s}
.ob-input:focus{border-color:#6a5af0;box-shadow:0 0 0 4px rgba(106,90,240,.12)}
.ob-input::placeholder{color:#a3a3a3}
.ob-ta{height:auto;padding:13px 16px;line-height:1.55;resize:vertical;font-size:15px}
.ob-error{margin:10px 0 0;font-size:13.5px;color:#dc2626}
.ob-primary{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:52px;padding:0 26px;border-radius:999px;border:none;background:#262626;color:#fff;
  font:inherit;font-size:15.5px;font-weight:600;cursor:pointer;transition:.15s;margin-top:16px}
.ob-inputwrap+.ob-error+.ob-primary,.ob-inputwrap+.ob-primary{width:100%}
.ob-primary:hover:not(:disabled){background:#0a0a0a;transform:translateY(-1px)}
.ob-primary:disabled{opacity:.45;cursor:not-allowed}
.ob-secondary{display:inline-flex;align-items:center;gap:7px;height:44px;padding:0 20px;border-radius:999px;border:1.5px solid #e5e5e5;background:#fff;color:#262626;
  font:inherit;font-size:14.5px;font-weight:600;cursor:pointer;margin-top:12px;transition:.15s}
.ob-secondary:hover{border-color:#a3a3a3}
.ob-link{display:block;margin:14px auto 0;background:none;border:none;color:#6a5af0;font:inherit;font-size:14px;font-weight:600;cursor:pointer;padding:6px}
.ob-link:hover{text-decoration:underline}
.ob-fine{margin:12px 0 0;text-align:center;font-size:13px;color:#a3a3a3}
.ob-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:6px}
.ob-actions .ob-secondary{margin-top:16px}
.ob-prog{padding:16px 18px;border-radius:20px;background:#f7f5ff;border:1px solid #ece9fb}
.ob-prog-top{display:flex;align-items:center;gap:10px;font-size:14px}
.ob-prog-top b{flex:1;font-weight:600}
.ob-prog-top span:last-child{color:#6a5af0;font-weight:700;font-variant-numeric:tabular-nums}
.ob-pulse{width:9px;height:9px;border-radius:999px;background:#6a5af0;animation:obp 1.4s ease-in-out infinite}
@keyframes obp{0%,100%{opacity:1}50%{opacity:.25}}
.ob-prog-bar{margin-top:12px;height:7px;border-radius:999px;background:#e4e0fb;overflow:hidden}
.ob-prog-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#a78bfa,#6a5af0 55%,#3b82f6);transition:width .6s ease}
.ob-sum{border:1.5px solid #ece9fb;border-radius:22px;overflow:hidden;background:#fcfbff}
.ob-row{padding:15px 18px}
.ob-row+.ob-row{border-top:1px solid #f0eefc}
.ob-row small{display:block;font-size:12px;font-weight:600;color:#6a5af0;margin-bottom:5px;letter-spacing:.01em}
.ob-row p{margin:0;font-size:15px;line-height:1.5}
.ob-row .ob-ta{padding-left:16px}
.ob-chips{display:flex;flex-wrap:wrap;gap:7px}
.ob-chips span{padding:5px 12px;border-radius:999px;background:#efecff;color:#4c3fd0;font-size:13px;font-weight:600}
.ob-qr{width:264px;height:264px;margin:4px auto 0;border-radius:24px;background:#fff;border:1.5px solid #ece9fb;display:grid;place-items:center;box-shadow:0 12px 30px -16px rgba(106,90,240,.35)}
.ob-qrmsg{padding:0 22px;text-align:center;font-size:14px;color:#737373}
.ob-qrmsg.err{color:#b91c1c}
.ob-how{margin:18px 0 0;padding-left:20px;font-size:14px;line-height:1.8;color:#737373}
.ob-how b{color:#0a0a0a;font-weight:600}
.ob-ok{display:flex;flex-direction:column;align-items:center;gap:12px;padding:18px 0}
.ob-ok span,.ob-donecheck{display:grid;place-items:center;width:58px;height:58px;border-radius:999px;background:#22c55e;color:#fff;box-shadow:0 10px 24px -8px rgba(34,197,94,.55)}
.ob-ok b{font-size:16px}
.ob-done{display:flex;flex-direction:column;align-items:center;text-align:center}
.ob-donecheck{margin-bottom:18px}
.ob-done .ob-sub{margin-bottom:20px}
.ob-list{list-style:none;margin:0 0 22px;padding:16px 18px;width:100%;display:flex;flex-direction:column;gap:11px;text-align:left;border-radius:20px;background:#f7f5ff;border:1px solid #ece9fb}
.ob-list li{display:flex;align-items:center;gap:11px;font-size:14.5px;font-weight:600}
.ob-list li span{display:grid;place-items:center;width:20px;height:20px;border-radius:999px;background:#22c55e;color:#fff;flex-shrink:0;font-size:12px}
.ob-list li.off{color:#737373;font-weight:500}
.ob-list li.off span{background:#e5e5e5;color:#737373}
@media (max-width:520px){
  .ob-head{padding:16px 18px}
  .ob-card{padding:26px 20px 22px;border-radius:26px}
  .ob-h1{font-size:24px}
}
`;
