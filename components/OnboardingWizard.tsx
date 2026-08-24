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

type ConnectMethod = "wordpress" | "webhook" | "later" | null;

export default function OnboardingWizard() {
  const { patch, act, saveMemory } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [site, setSite] = useState("");
  // "I don't have a website" is a real answer and has to be stored as one. It used to be
  // stored by typing the sentence "(no website yet)" INTO the website field, which the API
  // then prefixed with https:// — and that value later took the whole crawler down.
  const [noSite, setNoSite] = useState(false);
  const [ans, setAns] = useState<Record<string, string>>({});
  const [thinking, setThinking] = useState<string[]>([]);

  const [method, setMethod] = useState<ConnectMethod>(null);

  // WordPress connect
  const [wpUrl, setWpUrl] = useState("");
  const [wpUser, setWpUser] = useState("");
  const [wpPass, setWpPass] = useState("");
  const [wpTesting, setWpTesting] = useState(false);
  const [wpResult, setWpResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Webhook connect (Next.js / custom site — no credentials, just a URL)
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookResult, setWebhookResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pct = [10, 25, 40, 55, 70, 85, 100][step];

  const testWordPress = async () => {
    if (!wpUrl.trim() || !wpUser.trim() || !wpPass.trim()) {
      setWpResult({ ok: false, msg: "Site URL, username aur application password teeno bharo." });
      return;
    }
    setWpTesting(true);
    setWpResult(null);
    try {
      const res = await fetch("/api/wordpress/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl: wpUrl.trim(), username: wpUser.trim(), appPassword: wpPass.trim() }),
      });
      const data = await res.json();
      setWpResult({ ok: !!data.ok, msg: data.ok ? `Connected as ${data.name} ✓` : data.error });
    } catch {
      setWpResult({ ok: false, msg: "Connection test fail ho gaya — thodi der baad try karo." });
    }
    setWpTesting(false);
  };

  const testWebhook = async () => {
    if (!webhookUrl.trim()) {
      setWebhookResult({ ok: false, msg: "Apni site ka ek API route URL do (jahan hum article POST karenge)." });
      return;
    }
    setWebhookTesting(true);
    setWebhookResult(null);
    try {
      const res = await fetch("/api/webhook/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl.trim() }),
      });
      const data = await res.json();
      setWebhookResult({ ok: !!data.ok, msg: data.ok ? "Ping mil gaya ✓ tumhara endpoint zinda hai" : data.error });
    } catch {
      setWebhookResult({ ok: false, msg: "Test fail ho gaya — thodi der baad try karo." });
    }
    setWebhookTesting(false);
  };

  const nicheSummary = () => ans.type === "Local service"
    ? "Local services for nearby customers — trust, reviews and local visibility matter most"
    : `Content-led growth for ${(ans.aud || "").toLowerCase()} — clarity and consistency matter most`;

  const goToLearning = async () => {
    setStep(6);
    const lines = [noSite ? "Working from your answers…" : `Reading ${site} …`, "Detecting your niche and topics …", "Learning your brand tone …", "Mapping content opportunities …", "Building your team's memory …"];
    lines.forEach((l, i) => setTimeout(() => setThinking(t => [...t, l]), 500 + i * 700));

    // Build Guide Step 5 — real crawl + embeddings, running while the animation plays above.
    // Falls back to the wizard's own answers if the crawl fails (no site, no API key yet, etc).
    const minDelay = new Promise(r => setTimeout(r, 500 + lines.length * 700 + 500));
    const crawl = fetch("/api/onboarding/crawl", { method: "POST" }).then(r => r.json()).catch(() => null);
    const [, crawlResult] = await Promise.all([minDelay, crawl]);

    const niche = crawlResult?.niche || nicheSummary();
    const topics: string | undefined = crawlResult?.topics?.length ? crawlResult.topics.join(", ") : undefined;

    patch({ onboarded: true });
    // Straight to the DB (migration 010). These used to be patched into local state only,
    // so the very first thing the team "learned" was erased by the first sign-out.
    saveMemory([
      ...(site.trim() ? [{ k: "Website", v: site.trim() }] : []), { k: "Business type", v: ans.type }, { k: "Audience", v: ans.aud },
      { k: "Brand tone", v: ans.tone }, { k: "Publishing pace", v: ans.pace },
      { k: "Niche summary", v: niche },
      ...(topics ? [{ k: "Content topics", v: topics }] : []),
      { k: "Goals", v: "More organic traffic, consistent publishing, and inbound leads" },
    ]);
    act(noSite ? "built the team memory from your answers." : `finished studying <b>${site}</b> and built the team memory.`, "Mr Lxwa");
    router.push("/whoami");
  };

  const finish = async () => {
    // Build Guide Step 4 — persist to Supabase (tenants + integrations)
    let secret: string | null = null;
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // null, not a placeholder sentence — see the note on `noSite` above.
          websiteUrl: site.trim() || null,
          niche: nicheSummary(),
          toneProfile: { tone: ans.tone, audience: ans.aud, pace: ans.pace },
          icpProfile: { businessType: ans.type, audience: ans.aud },
          wordpress: method === "wordpress" && wpResult?.ok ? { siteUrl: wpUrl.trim(), username: wpUser.trim(), appPassword: wpPass.trim() } : undefined,
          webhook: method === "webhook" && webhookResult?.ok ? { url: webhookUrl.trim() } : undefined,
        }),
      });
      const data = await res.json();
      secret = data.webhookSecret ?? null;
    } catch {
      // non-fatal — demo state below still lets the user through; DB write failures show up in Supabase logs
    }

    if (secret) {
      setRevealedSecret(secret); // show once — don't auto-advance, wait for the user to copy it
    } else {
      goToLearning();
    }
  };

  const copySecret = () => {
    if (!revealedSecret) return;
    navigator.clipboard?.writeText(revealedSecret);
    setCopied(true);
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
            <p className="sm mut" style={{ margin: "8px 0 18px" }}>Paste your website — Mr Lxwa will study it and learn everything by itself. This is the only typing you&apos;ll do.</p>
            <div className="field"><label>Your website</label><input placeholder="https://yourbusiness.com" value={site} onChange={e => setSite(e.target.value)} /></div>
            <button className="btn btn-p" style={{ width: "100%", marginTop: 10 }} disabled={!site.trim()} onClick={() => setStep(1)}>Continue →</button>
            <p className="xs mut" style={{ textAlign: "center", marginTop: 12 }}>No website yet? <a style={{ cursor: "pointer" }} onClick={() => { setSite(""); setNoSite(true); setStep(1); }}>Skip — describe instead</a></p>
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
              <button className="btn btn-p" style={{ flex: 1 }} disabled={!ans[STEPS[step - 1].key]} onClick={() => setStep(step + 1)}>Continue →</button>
            </div>
          </>
        )}

        {step === 5 && revealedSecret && (
          <>
            <h2 style={{ fontSize: 20 }}>Your webhook secret 🔑</h2>
            <p className="sm mut" style={{ margin: "8px 0 14px" }}>
              Ye sirf abhi ek baar dikhega. Apni site ke `.env` mein save karo — isse hum bheje hue article ka signature verify karne ke kaam aayega.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px", borderRadius: 10, background: "#0c1120", border: "1px solid var(--line2)", fontFamily: "monospace", fontSize: 12.5, wordBreak: "break-all" }}>
              <span style={{ flex: 1 }}>{revealedSecret}</span>
              <button className="btn btn-g" style={{ padding: "6px 10px", fontSize: 11.5, flexShrink: 0 }} onClick={copySecret}>{copied ? "Copied ✓" : "Copy"}</button>
            </div>
            <p className="xs mut" style={{ margin: "16px 0 6px" }}>Tumhari Next.js site pe ek route banao jo isse verify kare:</p>
            <pre style={{ background: "#0c1120", border: "1px solid var(--line2)", borderRadius: 10, padding: "12px 14px", fontSize: 11, lineHeight: 1.6, overflowX: "auto", color: "var(--mut)" }}>
{`// app/api/mrlxwa-content/route.ts
import crypto from "crypto";

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("x-mrlxwa-signature");
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.MRLXWA_WEBHOOK_SECRET!)
    .update(body).digest("hex");
  if (sig !== expected) return new Response("bad signature", { status: 401 });

  const article = JSON.parse(body); // { title, body, meta }
  // save it however you like — your DB, MDX file, git commit, etc.
  return new Response("ok");
}`}
            </pre>
            <p className="xs mut" style={{ marginTop: 10 }}>
              Poora setup guide (apne developer ke liye): <a href="/connect/nextjs" target="_blank" rel="noopener" className="acc">/connect/nextjs →</a>
            </p>
            <button className="btn btn-p" style={{ width: "100%", marginTop: 16 }} onClick={() => { setRevealedSecret(null); goToLearning(); }}>
              Saved it — continue →
            </button>
          </>
        )}

        {step === 5 && !revealedSecret && method === null && (
          <>
            <h2 style={{ fontSize: 20 }}>How does your site work?</h2>
            <p className="sm mut" style={{ margin: "8px 0 18px" }}>Mr. SEO ke published articles kahan bhejne hain?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { id: "wordpress", t: "WordPress", d: "Application Password se connect karo — sabse common." },
                { id: "webhook", t: "Next.js / custom site", d: "Bas ek URL do — hum tumhe ek secret denge, credentials kuch nahi." },
                { id: "later", t: "I'll do this later", d: "Articles Approvals mein aate rahenge, publish manual rahega." },
              ].map(o => (
                <div key={o.id} onClick={() => o.id === "later" ? finish() : setMethod(o.id as ConnectMethod)}
                  style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid var(--line2)", background: "var(--panel2)", cursor: "pointer", transition: "all .15s" }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{o.t}</div>
                  <div className="xs mut" style={{ marginTop: 2 }}>{o.d}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-g" style={{ marginTop: 16 }} onClick={() => setStep(4)}>← Back</button>
          </>
        )}

        {step === 5 && !revealedSecret && method === "wordpress" && (
          <>
            <h2 style={{ fontSize: 20 }}>Connect WordPress</h2>
            <p className="sm mut" style={{ margin: "8px 0 18px" }}>
              WP Admin → Users → your user → Application Passwords → generate one.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", borderRadius: 11, background: "var(--panel2)", border: "1px solid var(--line2)", marginBottom: 16 }}>
              {[
                "This is NOT your login password — it's a separate WordPress-generated key",
                "Revoke it anytime from WP Admin, without changing your real password",
              ].map(t => (
                <div key={t} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--mut)" }}>
                  <span className="acc">✓</span>{t}
                </div>
              ))}
            </div>
            <div className="field"><label>Site URL</label><input placeholder="https://yoursite.com" value={wpUrl} onChange={e => setWpUrl(e.target.value)} /></div>
            <div className="field"><label>Username</label><input placeholder="admin" value={wpUser} onChange={e => setWpUser(e.target.value)} /></div>
            <div className="field"><label>Application Password</label><input type="password" placeholder="xxxx xxxx xxxx xxxx" value={wpPass} onChange={e => setWpPass(e.target.value)} /></div>
            <button className="btn btn-g" style={{ width: "100%", marginTop: 4 }} disabled={wpTesting} onClick={testWordPress}>
              {wpTesting ? "Testing…" : "Test connection"}
            </button>
            {wpResult && (
              <p className="sm" style={{ marginTop: 10, color: wpResult.ok ? "var(--ac)" : "#ff6b6b" }}>
                {wpResult.ok ? "✓ " : "✗ "}{wpResult.msg}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn btn-g" onClick={() => setMethod(null)}>← Change method</button>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={finish}>{wpResult?.ok ? "Finish setup ✓" : "Skip for now →"}</button>
            </div>
          </>
        )}

        {step === 5 && !revealedSecret && method === "webhook" && (
          <>
            <h2 style={{ fontSize: 20 }}>Connect via webhook</h2>
            <p className="sm mut" style={{ margin: "8px 0 18px" }}>
              Ek API route URL do apni Next.js (ya kisi bhi) site pe — hum wahan approved article POST karenge. Koi password nahi chahiye, sirf ek secret jo hum generate karenge.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", borderRadius: 11, background: "var(--panel2)", border: "1px solid var(--line2)", marginBottom: 16 }}>
              {[
                "Article kabhi hamare database mein permanently store nahi hota — direct tumhare endpoint pe jaata hai",
                "Koi username/password nahi maangte — sirf ek public URL",
              ].map(t => (
                <div key={t} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--mut)" }}>
                  <span className="acc">✓</span>{t}
                </div>
              ))}
            </div>
            <p className="xs" style={{ margin: "0 0 12px" }}>
              Route banana nahi aata? <a href="/connect/nextjs" target="_blank" rel="noopener" className="acc">Poora setup guide dekho →</a> (apne developer ko bhi bhej sakte ho)
            </p>
            <div className="field"><label>Your API route URL</label><input placeholder="https://yoursite.com/api/mrlxwa-content" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} /></div>
            <button className="btn btn-g" style={{ width: "100%", marginTop: 4 }} disabled={webhookTesting} onClick={testWebhook}>
              {webhookTesting ? "Testing…" : "Send test ping"}
            </button>
            {webhookResult && (
              <p className="sm" style={{ marginTop: 10, color: webhookResult.ok ? "var(--ac)" : "#ff6b6b" }}>
                {webhookResult.ok ? "✓ " : "✗ "}{webhookResult.msg}
              </p>
            )}
            <p className="xs mut" style={{ marginTop: 8 }}>Route abhi nahi bana? Koi baat nahi — skip karke baad mein bhi laga sakte ho.</p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn btn-g" onClick={() => setMethod(null)}>← Change method</button>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={finish}>{webhookResult?.ok ? "Finish setup ✓" : "Skip for now →"}</button>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <h2 style={{ fontSize: 20 }}>Mr Lxwa is learning your business…</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, margin: "22px 0" }}>
              {thinking.map((t, i) => <div key={i} style={{ display: "flex", gap: 11, fontSize: 13.5, color: "var(--mut)", animation: "tin .4s ease" }}><span className="acc">✓</span>{t}</div>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
