"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { GoalsStep, UnderstandingStep, useOnboardingProfile, type OnboardingProfile } from "@/components/OnboardingUnderstanding";
import { BRAIN_PHASES, phaseIndex, liveStage, pctFor, type BrainJobs } from "@/lib/brainPhases";

/** The five-to-nine-screen "meet your business" flow (MASTER_PLAN §25.7), rebuilt 2026-09-07
 *  on the same dark theme as the dashboard (Site Brain / Memory / Connect) instead of the old
 *  app/** theme's green-accented cards — this is the very first screen a new customer sees, and
 *  it looked like a different, older product from the one they land in a minute later.
 *
 *  The other change this pass makes: step 8 ("learning your business") used to be a fixed
 *  ~4-second animation of canned sentences, timed to nothing real, after which the wizard moved
 *  on regardless of whether the crawl had actually finished. It now polls the same job data Site
 *  Brain's own progress bar reads (lib/brainPhases.ts) and waits for the real crawl → Mr. Analyst
 *  chain to actually finish (or give up after a ceiling) before saving memory and continuing —
 *  a percentage that means something, not a curtain. */

const STEPS = [
  { key: "type", q: "What kind of business is this?", opts: ["Local service", "Online store", "Agency / freelancer", "SaaS / startup", "Blog / creator", "Other"] },
  { key: "aud", q: "Who are your customers?", opts: ["Local customers", "Small businesses", "Consumers online", "Professionals", "Everyone"] },
  { key: "tone", q: "How should your content sound?", opts: ["Friendly and simple", "Professional", "Expert and detailed", "Bold and energetic"] },
  { key: "pace", q: "How often should we publish?", opts: ["1 article / week", "2–3 / week", "Daily", "I'll decide per article"] },
];

type ConnectMethod = "wordpress" | "webhook" | "later" | null;

// A crawl of a normal site plus six LLM calls is two to six minutes. Onboarding isn't the place
// to make someone wait that long for a sign-up — give up gracefully and finish with whatever
// the wizard's own answers say; Site Brain will keep working on it in the background regardless.
const LEARNING_CEILING_MS = 90_000;

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

  const [method, setMethod] = useState<ConnectMethod>(null);
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);

  // Steps 5 and 6 are §25.7's two new screens. They can only show something real once Mr.
  // Analyst has finished, so the read starts at step 4 — one screen early — and a "thinking"
  // or "no-pages" answer means the screens are skipped rather than shown empty. The hook keeps
  // polling on its own until the answer is final, which is also what step 8 waits on below.
  const understanding = useOnboardingProfile(step >= 4);
  const brainReady = understanding?.status === "ready" && !!understanding.profile;

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

  // step 8's real progress bar — the same jobs_log rows Site Brain's own bar reads
  const [brainJobs, setBrainJobs] = useState<BrainJobs | null>(null);
  const learningStartedAt = useRef<number | null>(null);
  const finalized = useRef(false);
  // finalizeLearning fires from a timer set once step 8 is entered; by the time it fires,
  // `understanding` closed over at that moment can be stale, so the finish logic always reads
  // the latest value through this ref instead of the render-time variable.
  const understandingRef = useRef<OnboardingProfile | null>(understanding);
  understandingRef.current = understanding;

  const pct = [6, 16, 26, 36, 46, 58, 70, 82, 92][step];

  const testWordPress = async () => {
    if (!wpUrl.trim() || !wpUser.trim() || !wpPass.trim()) {
      setWpResult({ ok: false, msg: "Site URL, username and application password are all required." });
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
      setWpResult({ ok: !!data.ok, msg: data.ok ? `Connected as ${data.name}` : data.error });
    } catch {
      setWpResult({ ok: false, msg: "The connection test failed — try again in a moment." });
    }
    setWpTesting(false);
  };

  const testWebhook = async () => {
    if (!webhookUrl.trim()) {
      setWebhookResult({ ok: false, msg: "Give us an API route on your own site — this is where we'll post each article." });
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
      setWebhookResult({ ok: !!data.ok, msg: data.ok ? "Ping received — your endpoint is live." : data.error });
    } catch {
      setWebhookResult({ ok: false, msg: "The test failed — try again in a moment." });
    }
    setWebhookTesting(false);
  };

  const nicheSummary = () => ans.type === "Local service"
    ? "Local services for nearby customers — trust, reviews and local visibility matter most"
    : `Content-led growth for ${(ans.aud || "").toLowerCase()} — clarity and consistency matter most`;

  const finalizeLearning = async () => {
    if (finalized.current) return;
    finalized.current = true;

    const u = understandingRef.current;
    // The background crawler has been running since step 0 (§25.7) and site_pages is unique on
    // (tenant_id, url), so re-running the old synchronous 15-page crawl on top of it would be
    // one rejected insert per page for no gain. It stays as the fallback for the case it was
    // written for: nothing was read in the background at all.
    const crawlResult = u?.pagesCrawled
      ? null
      : await fetch("/api/onboarding/crawl", { method: "POST" }).then((r) => r.json()).catch(() => null);

    // The real analyst profile — up to 300 pages, six LLM passes — beats both fallbacks when
    // it's there; the quick 15-page crawl's own summary is next; the wizard's own answers are
    // the last resort, for a tenant with no usable website at all.
    const niche = u?.profile?.what_they_do || crawlResult?.niche || nicheSummary();
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

  // Drives step 8's exit: waits for the real crawl → analyst chain to resolve (ready or
  // definitively no-pages), or gives up after LEARNING_CEILING_MS and finishes with whatever
  // the wizard's own answers say. A tenant with no website skips the wait entirely — there is
  // nothing running in the background to wait on.
  useEffect(() => {
    if (step !== 8) return;
    if (learningStartedAt.current == null) learningStartedAt.current = Date.now();

    if (noSite) {
      const t = setTimeout(finalizeLearning, 900);
      return () => clearTimeout(t);
    }
    if (understanding?.status === "ready" || understanding?.status === "no-pages" || understanding?.status === "off") {
      finalizeLearning();
      return;
    }
    const elapsed = Date.now() - (learningStartedAt.current ?? Date.now());
    const t = setTimeout(finalizeLearning, Math.max(1000, LEARNING_CEILING_MS - elapsed));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, noSite, understanding?.status]);

  // The visual half of step 8: the same jobs_log rows Site Brain's refresh bar polls, purely
  // for the percentage and step list — the exit above is driven by `understanding`, not this.
  useEffect(() => {
    if (step !== 8 || noSite) return;
    let alive = true;
    const tick = async () => {
      try {
        const d = await fetch("/api/site-brain/status").then((r) => r.json());
        if (alive && d?.ok) setBrainJobs(d.jobs ?? null);
      } catch {
        /* the next poll tries again */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [step, noSite]);

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
      setStep(8);
    }
  };

  /** §25.7's first line: "Site URL → crawl start (background)". Saving the address here and
   *  starting the crawl now is what gives the confirm screen something true to show four
   *  screens later; it used to start after the wizard ended, when it was too late to confirm
   *  anything. A crawl that will not start is not fatal — /api/onboarding/complete saves the
   *  address again at the end and the old end-of-wizard crawl still runs. */
  const startReading = async () => {
    setSiteSaving(true);
    setSiteError(null);
    try {
      const res = await fetch("/api/onboarding/site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: site.trim() }),
      });
      const data = await res.json();
      if (!data.ok && res.status === 400) {
        setSiteError(data.error || "That doesn't look like a website address.");
        return;
      }
    } catch {
      // Offline or a bad gateway: carry on. The address is asked for again at the end.
    } finally {
      setSiteSaving(false);
    }
    setStep(1);
  };

  const copySecret = () => {
    if (!revealedSecret) return;
    navigator.clipboard?.writeText(revealedSecret);
    setCopied(true);
  };

  // step 8's progress bar numbers, straight from lib/brainPhases — identical logic to Site
  // Brain's own bar (components/dashboard/SiteBrainSection.tsx), just re-themed here.
  const stage = liveStage(brainJobs, null, null);
  const learningPct = noSite ? 100 : brainReady ? 100 : stage ? pctFor(stage) : 2;
  const learningLabel = noSite
    ? "Setting up your workspace"
    : brainReady
      ? "Done — building your workspace"
      : stage?.job.progress?.label ?? (understanding?.status === "no-pages" ? "Couldn't read the site — continuing with your answers" : "Starting…");
  const stageIdx = stage ? phaseIndex(stage.agent, stage.job.progress.phase ?? null) : -1;

  return (
    <div className="ob-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ob-card">
        <div className="ob-bar"><i style={{ width: pct + "%" }} /></div>

        {step === 0 && (
          <>
            <h2 className="ob-h1">Let&apos;s meet your business</h2>
            <p className="ob-sub">Paste your website — Mr Lxwa will study it and learn everything on its own. This is the only typing you&apos;ll do.</p>
            <div className="ob-field">
              <label className="ob-label">Your website</label>
              <input className="ob-input" placeholder="https://yourbusiness.com" value={site} onChange={(e) => setSite(e.target.value)} />
            </div>
            <button className="ob-btn-primary" style={{ width: "100%", marginTop: 4 }} disabled={!site.trim() || siteSaving} onClick={startReading}>
              {siteSaving ? "Starting…" : "Continue"}
            </button>
            {siteError && <p className="ob-error">{siteError}</p>}
            <p className="ob-skip">No website yet? <a onClick={() => { setSite(""); setNoSite(true); setStep(1); }}>Skip — describe it instead</a></p>
          </>
        )}

        {step >= 1 && step <= 4 && (
          <>
            <h2 className="ob-h1">{STEPS[step - 1].q}</h2>
            <div className="ob-pills" style={{ margin: "14px 0" }}>
              {STEPS[step - 1].opts.map((o) => (
                <span
                  key={o}
                  className={`ob-pill${ans[STEPS[step - 1].key] === o ? " active" : ""}`}
                  onClick={() => setAns((a) => ({ ...a, [STEPS[step - 1].key]: o }))}
                >
                  {o}
                </span>
              ))}
            </div>
            <div className="ob-actions">
              <button className="ob-btn" onClick={() => setStep(step - 1)}>Back</button>
              <button className="ob-btn-primary" style={{ flex: 1 }} disabled={!ans[STEPS[step - 1].key]} onClick={() => setStep(step === 4 && !brainReady ? 7 : step + 1)}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === 5 && (
          brainReady ? (
            <UnderstandingStep
              profile={understanding!.profile!}
              pages={understanding!.builtFromPages ?? understanding!.pagesCrawled}
              onBack={() => setStep(4)}
              onContinue={() => setStep(6)}
            />
          ) : (
            // Reached only by pressing Back from the goals screen after the profile went away;
            // the forward path skips straight past both screens when there is nothing to show.
            <>
              <h2 className="ob-h1">Still reading your site…</h2>
              <p className="ob-sub">We&apos;ll show you what we understood on the Site Brain page once it&apos;s done.</p>
              <button className="ob-btn-primary" style={{ width: "100%" }} onClick={() => setStep(7)}>Continue</button>
            </>
          )
        )}

        {step === 6 && (
          <GoalsStep
            profile={understanding?.profile ?? null}
            onBack={() => setStep(5)}
            onContinue={() => setStep(7)}
          />
        )}

        {step === 7 && revealedSecret && (
          <>
            <h2 className="ob-h1">Your webhook secret</h2>
            <p className="ob-sub">
              This is shown once. Save it in your site&apos;s <code>.env</code> — it&apos;s how your endpoint verifies the signature on each article we send.
            </p>
            <div className="ob-secret">
              <span>{revealedSecret}</span>
              <button className="ob-btn" onClick={copySecret}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <p className="ob-hint" style={{ margin: "16px 0 6px" }}>Add a route on your Next.js site that verifies it:</p>
            <pre className="ob-code">
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
            <p className="ob-hint" style={{ marginTop: 10 }}>
              Full setup guide (for your developer): <a href="/connect/nextjs" target="_blank" rel="noopener" className="ob-link">/connect/nextjs</a>
            </p>
            <button className="ob-btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={() => { setRevealedSecret(null); setStep(8); }}>
              Saved it — continue
            </button>
          </>
        )}

        {step === 7 && !revealedSecret && method === null && (
          <>
            <h2 className="ob-h1">How does your site work?</h2>
            <p className="ob-sub">Where should Mr. SEO send published articles?</p>
            <div className="ob-optlist">
              {[
                { id: "wordpress", t: "WordPress", d: "Connect with an Application Password — the most common setup." },
                { id: "webhook", t: "Next.js / custom site", d: "Just give us a URL — we'll issue you a secret, no credentials needed." },
                { id: "later", t: "I'll do this later", d: "Articles will wait in Approvals; publishing stays manual until you connect one." },
              ].map((o) => (
                <div key={o.id} className="ob-option" onClick={() => (o.id === "later" ? finish() : setMethod(o.id as ConnectMethod))}>
                  <div className="ob-option-t">{o.t}</div>
                  <div className="ob-hint">{o.d}</div>
                </div>
              ))}
            </div>
            <button className="ob-btn" style={{ marginTop: 16 }} onClick={() => setStep(4)}>Back</button>
          </>
        )}

        {step === 7 && !revealedSecret && method === "wordpress" && (
          <>
            <h2 className="ob-h1">Connect WordPress</h2>
            <p className="ob-sub">WP Admin → Users → your user → Application Passwords → generate one.</p>
            <div className="ob-note">
              {[
                "This is NOT your login password — it's a separate, WordPress-generated key",
                "Revoke it any time from WP Admin, without changing your real password",
              ].map((t) => <div key={t} className="ob-check">{t}</div>)}
            </div>
            <div className="ob-field"><label className="ob-label">Site URL</label><input className="ob-input" placeholder="https://yoursite.com" value={wpUrl} onChange={(e) => setWpUrl(e.target.value)} /></div>
            <div className="ob-field"><label className="ob-label">Username</label><input className="ob-input" placeholder="admin" value={wpUser} onChange={(e) => setWpUser(e.target.value)} /></div>
            <div className="ob-field"><label className="ob-label">Application password</label><input className="ob-input" type="password" placeholder="xxxx xxxx xxxx xxxx" value={wpPass} onChange={(e) => setWpPass(e.target.value)} /></div>
            <button className="ob-btn" style={{ width: "100%" }} disabled={wpTesting} onClick={testWordPress}>
              {wpTesting ? "Testing…" : "Test connection"}
            </button>
            {wpResult && <p className={`ob-result ${wpResult.ok ? "ok" : "err"}`}>{wpResult.msg}</p>}
            <div className="ob-actions">
              <button className="ob-btn" onClick={() => setMethod(null)}>Change method</button>
              <button className="ob-btn-primary" style={{ flex: 1 }} onClick={finish}>{wpResult?.ok ? "Finish setup" : "Skip for now"}</button>
            </div>
          </>
        )}

        {step === 7 && !revealedSecret && method === "webhook" && (
          <>
            <h2 className="ob-h1">Connect via webhook</h2>
            <p className="ob-sub">
              Give us an API route on your Next.js (or any) site — we&apos;ll post each approved article there. No username or password, just a secret we generate for you.
            </p>
            <div className="ob-note">
              {[
                "An article never sits permanently in our database — it goes straight to your endpoint",
                "No credentials required — just a public URL",
              ].map((t) => <div key={t} className="ob-check">{t}</div>)}
            </div>
            <p className="ob-hint" style={{ margin: "0 0 12px" }}>
              Not sure how to build the route? <a href="/connect/nextjs" target="_blank" rel="noopener" className="ob-link">See the full setup guide</a> — you can forward it to your developer.
            </p>
            <div className="ob-field"><label className="ob-label">Your API route URL</label><input className="ob-input" placeholder="https://yoursite.com/api/mrlxwa-content" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} /></div>
            <button className="ob-btn" style={{ width: "100%" }} disabled={webhookTesting} onClick={testWebhook}>
              {webhookTesting ? "Testing…" : "Send test ping"}
            </button>
            {webhookResult && <p className={`ob-result ${webhookResult.ok ? "ok" : "err"}`}>{webhookResult.msg}</p>}
            <p className="ob-hint">Haven&apos;t built the route yet? No problem — skip it and connect later.</p>
            <div className="ob-actions">
              <button className="ob-btn" onClick={() => setMethod(null)}>Change method</button>
              <button className="ob-btn-primary" style={{ flex: 1 }} onClick={finish}>{webhookResult?.ok ? "Finish setup" : "Skip for now"}</button>
            </div>
          </>
        )}

        {step === 8 && (
          <>
            <h2 className="ob-h1">Mr Lxwa is learning your business</h2>
            <p className="ob-sub">
              {noSite ? "Building the team's memory from what you told us." : "This finishes on its own — you don't need to keep this tab open."}
            </p>
            <div className="ob-prog">
              <div className="ob-prog-h">
                <span className="ob-dot" />
                <b className="ob-prog-l">{learningLabel}</b>
                <b className="ob-prog-p">{learningPct}%</b>
              </div>
              <div className="ob-prog-bar"><i style={{ width: `${learningPct}%` }} /></div>
              {!noSite && (
                <ol className="ob-steps">
                  {BRAIN_PHASES.map((x, i) => {
                    const st = brainReady ? "done" : stageIdx < 0 ? "next" : i < stageIdx ? "done" : i === stageIdx ? "now" : "next";
                    return (
                      <li key={`${x.agent}-${x.id}`} className={`ob-step ob-step-${st}`}>
                        <span className="ob-step-n">{st === "done" ? "✓" : i + 1}</span>
                        {x.label}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Same visual language as the dashboard's Site Brain / Memory / Connect pages: neutral dark
   surfaces, one indigo accent. Injected with dangerouslySetInnerHTML — React escapes ">" inside
   a <style> text child, which turns every child selector into a hydration mismatch. */
const CSS = `
.ob-wrap{min-height:100vh;display:grid;place-items:center;padding:22px;background:#05050a}
.ob-card{width:100%;max-width:520px;padding:28px 30px;border-radius:16px;background:#0a0a11;border:1px solid #1e1e2b;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.ob-bar{height:5px;border-radius:3px;background:#1c1c29;margin-bottom:24px;overflow:hidden}
.ob-bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#4f46e5,#8b5cf6);transition:width .5s cubic-bezier(.4,0,.2,1)}
.ob-h1{font-size:20px;font-weight:700;letter-spacing:-.01em;color:#f5f5fa;line-height:1.3;margin:0}
.ob-sub{margin:8px 0 18px;font-size:12.5px;color:#8b8ba0;line-height:1.6}
.ob-field{margin-bottom:14px}
.ob-label{display:block;margin-bottom:6px;font-size:11.5px;font-weight:600;color:#9a9ab2}
.ob-input{width:100%;height:38px;padding:0 12px;border-radius:9px;background:#101018;border:1px solid #232332;color:#e9e9f2;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit}
.ob-input:focus{border-color:rgba(99,102,241,.6)}
.ob-input::placeholder{color:#565672}
.ob-textarea{height:auto;padding:9px 12px;line-height:1.6;resize:vertical}
.ob-error{margin-top:8px;font-size:12px;color:#f87171}
.ob-hint{margin:0;font-size:11.5px;color:#7c7c95;line-height:1.6}
.ob-skip{text-align:center;margin-top:14px;font-size:11.5px;color:#7c7c95}
.ob-skip a{color:#8f95ff;cursor:pointer;font-weight:600}
.ob-skip a:hover{text-decoration:underline}
.ob-pills{display:flex;flex-wrap:wrap;gap:8px}
.ob-pill{padding:9px 15px;border-radius:999px;cursor:pointer;user-select:none;font-size:12.5px;font-weight:500;
  border:1px solid #262636;background:#101018;color:#c8c8d8;transition:.15s}
.ob-pill:hover{border-color:#3a3a52}
.ob-pill.active{border-color:#6366f1;background:rgba(99,102,241,.16);color:#c7c7f0;font-weight:600}
.ob-actions{display:flex;gap:10px;margin-top:18px}
.ob-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 15px;border-radius:9px;white-space:nowrap;
  background:#151520;border:1px solid #262636;color:#d6d6e4;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.ob-btn:hover:not(:disabled){color:#fff;border-color:#3a3a52}
.ob-btn:disabled{opacity:.5;cursor:not-allowed}
.ob-btn-primary{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:9px;white-space:nowrap;
  background:#4f46e5;border:1px solid #6366f1;color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:.15s}
.ob-btn-primary:hover:not(:disabled){background:#5b52ea}
.ob-btn-primary:disabled{opacity:.55;cursor:not-allowed}
.ob-rowlist{display:flex;flex-direction:column;gap:7px}
.ob-row{display:flex;gap:7px}
.ob-row .ob-input{flex:1;min-width:0}
.ob-row .ob-btn{flex-shrink:0;height:38px;padding:0 12px}
.ob-list{margin:0;padding-left:18px;font-size:12.5px;color:#c3c3d4;line-height:1.7}
.ob-goallist{display:flex;flex-direction:column;gap:8px}
.ob-goal{text-align:left;padding:12px 14px;border-radius:12px;cursor:pointer;border:1px solid #262636;background:#101018;color:#e9e9f2;transition:.15s}
.ob-goal:hover{border-color:#3a3a52}
.ob-goal.active{border-color:#6366f1;background:rgba(99,102,241,.14)}
.ob-goal b{font-size:14px}
.ob-goal-sub{margin-top:2px;font-size:11.5px;color:#8b8ba0}
.ob-note{display:flex;flex-direction:column;gap:7px;padding:12px 14px;border-radius:11px;background:#101018;border:1px solid #1e1e2b;margin-bottom:16px}
.ob-check{display:flex;gap:8px;font-size:12px;color:#a8a8bd;line-height:1.5}
.ob-check::before{content:"✓";color:#818cf8;flex-shrink:0;font-weight:700}
.ob-result{margin-top:10px;font-size:12px;line-height:1.5}
.ob-result.ok{color:#4ade80}
.ob-result.err{color:#f87171}
.ob-optlist{display:flex;flex-direction:column;gap:10px}
.ob-option{padding:14px 16px;border-radius:12px;border:1px solid #262636;background:#101018;cursor:pointer;transition:.15s}
.ob-option:hover{border-color:#3a3a52;background:#12121c}
.ob-option-t{font-weight:600;font-size:14px;color:#f0f0f7}
.ob-link{color:#8f95ff;text-decoration:none;font-weight:600}
.ob-link:hover{text-decoration:underline}
.ob-secret{display:flex;gap:8px;align-items:center;padding:11px 13px;border-radius:10px;background:#101018;border:1px solid #232332;
  font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#e9e9f2;word-break:break-all}
.ob-secret span{flex:1}
.ob-code{margin-top:8px;padding:12px 14px;border-radius:10px;background:#101018;border:1px solid #1e1e2b;font-size:10.5px;line-height:1.6;
  overflow-x:auto;color:#9a9ab2}
.ob-prog{margin-top:18px;padding:14px;border-radius:12px;background:#101018;border:1px solid rgba(99,102,241,.4)}
.ob-prog-h{display:flex;flex-wrap:wrap;align-items:center;gap:9px}
.ob-prog-l{flex:1;min-width:140px;font-size:12.5px;color:#e6e6f0;font-weight:650}
.ob-prog-p{font-size:12.5px;color:#a5b4fc;font-variant-numeric:tabular-nums}
.ob-dot{width:8px;height:8px;border-radius:999px;background:#818cf8;flex-shrink:0;animation:obPulse 1.4s ease-in-out infinite}
@keyframes obPulse{0%,100%{opacity:1}50%{opacity:.25}}
.ob-prog-bar{margin-top:10px;height:7px;border-radius:999px;background:#1e1e2b;overflow:hidden}
.ob-prog-bar>i{display:block;height:100%;border-radius:999px;transition:width .6s ease;background:linear-gradient(90deg,#4f46e5,#7c3aed,#8b5cf6)}
.ob-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin-top:12px;list-style:none;padding:0}
.ob-step{display:flex;align-items:center;gap:6px;font-size:10.5px;color:#e6e6f0}
.ob-step-next{color:#5f5f78}
.ob-step-now{font-weight:700}
.ob-step-n{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex-shrink:0;border-radius:999px;
  font-size:8.5px;border:1px solid #818cf8;color:#a5b4fc}
.ob-step-next .ob-step-n{border-color:#2a2a3d;color:#5f5f78}
.ob-step-done .ob-step-n{background:#6366f1;border-color:#6366f1;color:#fff}
`;
