"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, BadgeCheck, Briefcase, Calendar, CalendarClock, CalendarDays, Check, Clock, Code2, Globe,
  GraduationCap, Link2, MapPin, MoreHorizontal, PenLine, Rocket, ShoppingCart, SlidersHorizontal, Smile,
  Sparkles, Users, Zap,
} from "lucide-react";
import { SiWordpress } from "react-icons/si";
import { useStore } from "@/lib/store";
import { GoalsStep, UnderstandingStep, useOnboardingProfile, type OnboardingProfile } from "@/components/OnboardingUnderstanding";
import { BrandMark, Glow, LeftPanel, OptRow, OptTile, StepTrack, ONBOARDING_CSS } from "@/components/OnboardingUI";
import { BRAIN_PHASES, phaseIndex, liveStage, pctFor, type BrainJobs } from "@/lib/brainPhases";

/** The nine-screen "meet your business" flow (MASTER_PLAN §25.7).
 *
 *  Visual language 2026-09-08: a faithful copy of the owner's reference mockup — brand and
 *  feature list on the left, the step card on the right, a numbered badge on a dotted track,
 *  icon-badged rows/tiles with a radio dot, a green-check note box, pill Back/Next buttons.
 *  Only the chrome and layout are copied; the fields and the nine steps are ours, and so is the
 *  colour (indigo/violet — the dashboard's family).
 *
 *  Step 8 ("learning your business") polls the same job data Site Brain's own progress bar
 *  reads (lib/brainPhases.ts) and waits for the real crawl → Mr. Analyst chain to actually
 *  finish (or give up after a ceiling) before showing a done screen and continuing — a
 *  percentage that means something, not a timed animation. */

const STEPS = [
  {
    key: "type",
    q: "Tell us about your business",
    sub: "What best describes your business? This helps our AI find the right keywords and create relevant content.",
    tiles: true,
    opts: [
      { v: "Local service", icon: MapPin },
      { v: "Online store", icon: ShoppingCart },
      { v: "Agency / freelancer", icon: Briefcase },
      { v: "SaaS / startup", icon: Rocket },
      { v: "Blog / creator", icon: PenLine },
      { v: "Other", icon: MoreHorizontal },
    ],
  },
  {
    key: "aud",
    q: "Who are your customers?",
    sub: "Who should the writing be aimed at? You can always change this later.",
    tiles: false,
    opts: [
      { v: "Local customers", icon: MapPin },
      { v: "Small businesses", icon: Briefcase },
      { v: "Consumers online", icon: Globe },
      { v: "Professionals", icon: Users },
      { v: "Everyone", icon: Sparkles },
    ],
  },
  {
    key: "tone",
    q: "How should your content sound?",
    sub: "Pick the voice every article should be written in.",
    tiles: false,
    opts: [
      { v: "Friendly and simple", icon: Smile },
      { v: "Professional", icon: BadgeCheck },
      { v: "Expert and detailed", icon: GraduationCap },
      { v: "Bold and energetic", icon: Zap },
    ],
  },
  {
    key: "pace",
    q: "How often should we publish?",
    sub: "Set the pace. Every article still waits for your approval before it goes live.",
    tiles: false,
    opts: [
      { v: "1 article / week", icon: Calendar },
      { v: "2–3 / week", icon: CalendarDays },
      { v: "Daily", icon: CalendarClock },
      { v: "I'll decide per article", icon: SlidersHorizontal },
    ],
  },
];

// Steps 0-8, for the track and the dot rows. Steps 5/6 (Understanding/Goals) are often skipped
// when the crawl isn't ready yet — they still count, so the track doesn't jump around.
const TOTAL_STEPS = 9;

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
  const [showDone, setShowDone] = useState(false);
  const learningStartedAt = useRef<number | null>(null);
  const finalized = useRef(false);
  const doneShown = useRef(false);
  // finalizeLearning fires from a timer set once step 8 is entered; by the time it fires,
  // `understanding` closed over at that moment can be stale, so the finish logic always reads
  // the latest value through this ref instead of the render-time variable.
  const understandingRef = useRef<OnboardingProfile | null>(understanding);
  understandingRef.current = understanding;

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
  // definitively no-pages), or gives up after LEARNING_CEILING_MS. Either way it shows the
  // done screen first — finalizeLearning (the actual save + redirect) fires from there, either
  // on the button or a short automatic fallback, so the customer sees a real "you're set"
  // moment instead of vanishing straight to the dashboard.
  useEffect(() => {
    if (step !== 8) return;
    if (learningStartedAt.current == null) learningStartedAt.current = Date.now();

    const arrive = () => {
      if (doneShown.current) return;
      doneShown.current = true;
      setShowDone(true);
    };

    if (noSite) {
      const t = setTimeout(arrive, 900);
      return () => clearTimeout(t);
    }
    if (understanding?.status === "ready" || understanding?.status === "no-pages" || understanding?.status === "off") {
      arrive();
      return;
    }
    const elapsed = Date.now() - (learningStartedAt.current ?? Date.now());
    const t = setTimeout(arrive, Math.max(1000, LEARNING_CEILING_MS - elapsed));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, noSite, understanding?.status]);

  // Once the done screen is showing, finish on its own after a moment — the button is there
  // for someone who wants to leave right away, not the only way out.
  useEffect(() => {
    if (!showDone) return;
    const t = setTimeout(finalizeLearning, 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDone]);

  // The visual half of step 8: the same jobs_log rows Site Brain's refresh bar polls, purely
  // for the percentage and step list — the exit above is driven by `understanding`, not this.
  useEffect(() => {
    if (step !== 8 || noSite || showDone) return;
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
  }, [step, noSite, showDone]);

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

  const q = step >= 1 && step <= 4 ? STEPS[step - 1] : null;

  return (
    <div className="ob-page">
      <style dangerouslySetInnerHTML={{ __html: ONBOARDING_CSS }} />
      <Glow />
      <LeftPanel step={step} total={TOTAL_STEPS} />

      <main className="ob-right">
        <div className="ob-card">
          <div className="ob-top">
            <div className="ob-brand">
              <BrandMark size={30} />
              <div>
                <b className="ob-brand-t">MrLxwa</b>
                <small className="ob-brand-s">GrowthTeam AI</small>
              </div>
            </div>
            {step < 8 && (
              <button type="button" className="ob-topskip" onClick={() => setStep(7)}>
                Skip <ArrowRight size={14} />
              </button>
            )}
          </div>

          {step < 8 && <StepTrack step={step} total={TOTAL_STEPS} />}

          {step === 0 && (
            <>
              <h2 className="ob-h1">Connect Your Website</h2>
              <p className="ob-sub">Let us know your website so we can analyze your content, understand your business and start finding the best opportunities.</p>
              <div className="ob-browser">
                <div className="ob-browser-bar"><i /><i /><i /></div>
                <div className="ob-inputwrap">
                  <span className="ob-ic"><Link2 size={13} /></span>
                  <input className="ob-input" placeholder="https://yourwebsite.com" value={site} onChange={(e) => setSite(e.target.value)} />
                </div>
                <div className="ob-plats">
                  <div className="ob-plat"><span><SiWordpress size={16} /></span>WordPress</div>
                  <div className="ob-plat"><span><Code2 size={16} /></span>Custom</div>
                </div>
              </div>
              <div className="ob-note">
                {[
                  "Secure & read-only access",
                  "We analyze your existing content",
                  "No changes to your site",
                ].map((t) => <div key={t} className="ob-check">{t}</div>)}
              </div>
              {siteError && <p className="ob-error">{siteError}</p>}
              <div className="ob-actions">
                <span className="ob-skip" style={{ margin: 0, textAlign: "left" }}>No website yet? <a onClick={() => { setSite(""); setNoSite(true); setStep(1); }}>Describe it instead</a></span>
                <button className="ob-btn-primary" disabled={!site.trim() || siteSaving} onClick={startReading}>
                  {siteSaving ? "Starting…" : "Next"} <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}

          {q && (
            <>
              <h2 className="ob-h1">{q.q}</h2>
              <p className="ob-sub">{q.sub}</p>
              {q.tiles ? (
                <div className="ob-tiles">
                  {q.opts.map((o, i) => (
                    <OptTile key={o.v} icon={o.icon} title={o.v} active={ans[q.key] === o.v} colorIndex={i} onClick={() => setAns((a) => ({ ...a, [q.key]: o.v }))} />
                  ))}
                </div>
              ) : (
                <div className="ob-optlist2">
                  {q.opts.map((o, i) => (
                    <OptRow key={o.v} icon={o.icon} title={o.v} active={ans[q.key] === o.v} colorIndex={i} onClick={() => setAns((a) => ({ ...a, [q.key]: o.v }))} />
                  ))}
                </div>
              )}
              <div className="ob-actions">
                <button className="ob-btn" onClick={() => setStep(step - 1)}><ArrowLeft size={14} /> Back</button>
                <button className="ob-btn-primary" disabled={!ans[q.key]} onClick={() => setStep(step === 4 && !brainReady ? 7 : step + 1)}>
                  Next <ArrowRight size={15} />
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
                <div className="ob-actions">
                  <button className="ob-btn" onClick={() => setStep(4)}><ArrowLeft size={14} /> Back</button>
                  <button className="ob-btn-primary" onClick={() => setStep(7)}>Next <ArrowRight size={15} /></button>
                </div>
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
              <div className="ob-actions" style={{ justifyContent: "flex-end" }}>
                <button className="ob-btn-primary" onClick={() => { setRevealedSecret(null); setStep(8); }}>
                  Saved it — continue <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}

          {step === 7 && !revealedSecret && method === null && (
            <>
              <h2 className="ob-h1">Connect Your Platforms</h2>
              <p className="ob-sub">Link your publishing platform so we can publish your content automatically (after your approval).</p>
              <div className="ob-optlist2">
                <OptRow icon={SiWordpress as any} title="WordPress" subtitle="Publish directly to your WordPress site" active={false} colorIndex={3} onClick={() => setMethod("wordpress")} />
                <OptRow icon={Link2} title="Webhook" subtitle="Send to your custom endpoint (Next.js or any site)" active={false} colorIndex={0} onClick={() => setMethod("webhook")} />
                <OptRow icon={Clock} title="I'll do this later" subtitle="Articles wait in Approvals; publishing stays manual until you connect one" active={false} colorIndex={4} onClick={finish} />
              </div>
              <div className="ob-note" style={{ marginTop: 14, marginBottom: 0 }}>
                {["Secure connection", "You stay in control", "Human approval for all publishes"].map((t) => <div key={t} className="ob-check">{t}</div>)}
              </div>
              <div className="ob-actions">
                <button className="ob-btn" onClick={() => setStep(4)}><ArrowLeft size={14} /> Back</button>
              </div>
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
                <button className="ob-btn" onClick={() => setMethod(null)}><ArrowLeft size={14} /> Back</button>
                <button className="ob-btn-primary" onClick={finish}>{wpResult?.ok ? "Finish setup" : "Skip for now"} <ArrowRight size={15} /></button>
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
                <button className="ob-btn" onClick={() => setMethod(null)}><ArrowLeft size={14} /> Back</button>
                <button className="ob-btn-primary" onClick={finish}>{webhookResult?.ok ? "Finish setup" : "Skip for now"} <ArrowRight size={15} /></button>
              </div>
            </>
          )}

          {step === 8 && !showDone && (
            <>
              <h2 className="ob-h1">MrLxwa is learning your business</h2>
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
                      const st = stageIdx < 0 ? "next" : i < stageIdx ? "done" : i === stageIdx ? "now" : "next";
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

          {step === 8 && showDone && (
            <div className="ob-done">
              <div className="ob-done-ic">🚀</div>
              <span className="ob-done-ok"><Check size={22} strokeWidth={3} /></span>
              <h2 className="ob-h1">You&apos;re All Set!</h2>
              <p className="ob-sub">Your AI marketing team is ready to go.<br />Let&apos;s grow your business together!</p>
              <div className="ob-donelist">
                <div className="ob-donerow"><span><Check size={12} strokeWidth={3} /></span>{noSite ? "Business answers saved" : "Website connected"}</div>
                <div className="ob-donerow"><span><Check size={12} strokeWidth={3} /></span>Goals set</div>
                <div className="ob-donerow"><span><Check size={12} strokeWidth={3} /></span>{method && method !== "later" ? "Platforms linked" : "Team memory built"}</div>
                <div className="ob-donerow"><span><Check size={12} strokeWidth={3} /></span>Your account is ready</div>
              </div>
              <button className="ob-btn-primary" style={{ width: "100%" }} onClick={finalizeLearning}>
                Go to Dashboard <ArrowRight size={15} />
              </button>
            </div>
          )}

          {step < 8 && (
            <div className="ob-dots">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <i key={i} className={i === step ? "on" : i < step ? "done" : ""} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
