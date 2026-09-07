"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Briefcase, Check, Clock, Code2, Link2, MapPin, MoreHorizontal, PenLine, Rocket,
  ShoppingBag, ShoppingCart, TrendingUp, UserPlus,
} from "lucide-react";
import { SiWordpress } from "react-icons/si";
import { useStore } from "@/lib/store";
import { useOnboardingProfile, type OnboardingProfile } from "@/components/OnboardingUnderstanding";
import { BrandMark, LeftPanel, OptRow, OptTile, StepTrack, ONBOARDING_CSS } from "@/components/OnboardingUI";
import { BRAIN_PHASES, phaseIndex, liveStage, pctFor, type BrainJobs } from "@/lib/brainPhases";

/** The "meet your business" flow, cut down 2026-09-08 to the five screens that actually matter
 *  (owner: "simple karo, sirf jo zaroori ho, modern"):
 *
 *    0  Website            — the one thing we truly need; the crawl starts here, in the background
 *    1  Business type      — one tap, six tiles (Mr. Analyst reads the rest off the site itself)
 *    2  Main goal          — one tap: enquiries / traffic / sales (what the planner optimises for)
 *    3  Publishing platform — WordPress or a webhook, ONE "Connect" button that tests and saves in
 *                            one go, or skip
 *    4  Learning → done    — real crawl/analyst progress, then "You're all set"
 *
 *  Gone: the audience / tone / pace questions (guessing out loud — the analyst derives them and
 *  they're editable on Site Brain), the review-what-we-read screen (it lives on Site Brain), the
 *  "which offerings first" picker, and the /whoami stop after finishing. Tone defaults to
 *  "Professional"; every reader of tone_profile already copes with a missing pace/audience.
 *
 *  Visual language: the owner's reference mockup — brand + feature list on the left, the step
 *  card on the right, numbered badge on a dotted track, icon tiles/rows with a radio dot. */

const TYPES = [
  { v: "Local service", icon: MapPin },
  { v: "Online store", icon: ShoppingCart },
  { v: "Agency / freelancer", icon: Briefcase },
  { v: "SaaS / startup", icon: Rocket },
  { v: "Blog / creator", icon: PenLine },
  { v: "Other", icon: MoreHorizontal },
];

const GOALS: { key: "leads" | "traffic" | "sales"; label: string; sub: string; icon: typeof UserPlus; memory: string }[] = [
  { key: "leads", label: "More enquiries", sub: "People contacting you", icon: UserPlus, memory: "More enquiries and inbound leads" },
  { key: "traffic", label: "More search traffic", sub: "Being found on Google", icon: TrendingUp, memory: "More organic search traffic" },
  { key: "sales", label: "More sales", sub: "Orders and revenue", icon: ShoppingBag, memory: "More sales and revenue" },
];

const TOTAL_STEPS = 5;

type ConnectMethod = "wordpress" | "webhook" | null;

// A crawl of a normal site plus six LLM calls is two to six minutes. Onboarding isn't the place
// to make someone wait that long — give up gracefully after this and finish with what we have;
// Site Brain keeps working in the background regardless.
const LEARNING_CEILING_MS = 90_000;

export default function OnboardingWizard() {
  const { patch, act, saveMemory } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [site, setSite] = useState("");
  // "I don't have a website" is a real answer and has to be stored as one — never as a
  // placeholder sentence typed into the website field (that once took the crawler down).
  const [noSite, setNoSite] = useState(false);
  const [type, setType] = useState("");
  const [goal, setGoal] = useState<"leads" | "traffic" | "sales" | null>(null);

  const [method, setMethod] = useState<ConnectMethod>(null);
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);

  // Polls /api/onboarding/profile from step 2 on; step 4 waits on it. Stops on its own once the
  // answer is final.
  const understanding = useOnboardingProfile(step >= 2);
  const brainReady = understanding?.status === "ready" && !!understanding.profile;

  const [wpUrl, setWpUrl] = useState("");
  const [wpUser, setWpUser] = useState("");
  const [wpPass, setWpPass] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [brainJobs, setBrainJobs] = useState<BrainJobs | null>(null);
  const [showDone, setShowDone] = useState(false);
  const learningStartedAt = useRef<number | null>(null);
  const finalized = useRef(false);
  const doneShown = useRef(false);
  const understandingRef = useRef<OnboardingProfile | null>(understanding);
  understandingRef.current = understanding;

  const nicheSummary = () => type === "Local service"
    ? "Local services for nearby customers — trust, reviews and local visibility matter most"
    : `Content-led growth for a ${(type || "business").toLowerCase()} — clarity and consistency matter most`;

  /** Saves the tenant profile (+ the connection, if one was verified) and moves to learning.
   *  Same route as before: /api/onboarding/complete. */
  const finish = async (connection?: { wordpress?: { siteUrl: string; username: string; appPassword: string }; webhook?: { url: string } }) => {
    let secret: string | null = null;
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteUrl: site.trim() || null,
          niche: nicheSummary(),
          toneProfile: { tone: "Professional", goals: goal ? { primary: goal, kpis: [], focus: [] } : null },
          icpProfile: { businessType: type || null },
          wordpress: connection?.wordpress,
          webhook: connection?.webhook,
        }),
      });
      const data = await res.json();
      secret = data.webhookSecret ?? null;
    } catch {
      // non-fatal — the user still gets through; DB write failures show up in Supabase logs
    }
    if (goal) {
      // The planner reads goals off the Site Brain profile; same PATCH the Site Brain page uses.
      fetch("/api/site-brain", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "goals", value: { primary: goal, kpis: [], focus: [] } }),
      }).catch(() => {});
    }
    if (secret) setRevealedSecret(secret); // shown once — wait for the user to copy it
    else setStep(4);
  };

  /** ONE button: verify the connection and, if it works, save everything and move on. */
  const connect = async () => {
    setConnectError(null);
    setConnecting(true);
    try {
      if (method === "wordpress") {
        if (!wpUrl.trim() || !wpUser.trim() || !wpPass.trim()) { setConnectError("Site URL, username and application password are all required."); return; }
        const res = await fetch("/api/wordpress/test-connection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteUrl: wpUrl.trim(), username: wpUser.trim(), appPassword: wpPass.trim() }),
        });
        const data = await res.json();
        if (!data.ok) { setConnectError(data.error || "WordPress refused the connection."); return; }
        await finish({ wordpress: { siteUrl: wpUrl.trim(), username: wpUser.trim(), appPassword: wpPass.trim() } });
      } else if (method === "webhook") {
        if (!webhookUrl.trim()) { setConnectError("Enter the API route on your site where we should post each article."); return; }
        const res = await fetch("/api/webhook/test-connection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: webhookUrl.trim() }),
        });
        const data = await res.json();
        if (!data.ok) { setConnectError(data.error || "Your endpoint didn't answer the test ping."); return; }
        await finish({ webhook: { url: webhookUrl.trim() } });
      }
    } catch {
      setConnectError("Couldn't reach the server — try again in a moment.");
    } finally {
      setConnecting(false);
    }
  };

  const finalizeLearning = async () => {
    if (finalized.current) return;
    finalized.current = true;

    const u = understandingRef.current;
    // Fallback for the case nothing was read in the background at all (see /api/onboarding/crawl).
    const crawlResult = u?.pagesCrawled
      ? null
      : await fetch("/api/onboarding/crawl", { method: "POST" }).then((r) => r.json()).catch(() => null);

    const niche = u?.profile?.what_they_do || crawlResult?.niche || nicheSummary();
    const topics: string | undefined = crawlResult?.topics?.length ? crawlResult.topics.join(", ") : undefined;

    patch({ onboarded: true });
    saveMemory([
      ...(site.trim() ? [{ k: "Website", v: site.trim() }] : []),
      ...(type ? [{ k: "Business type", v: type }] : []),
      { k: "Niche summary", v: niche },
      ...(topics ? [{ k: "Content topics", v: topics }] : []),
      { k: "Goals", v: GOALS.find((g) => g.key === goal)?.memory ?? "More organic traffic, consistent publishing, and inbound leads" },
    ]);
    act(noSite ? "built the team memory from your answers." : `finished studying <b>${site}</b> and built the team memory.`, "Mr Lxwa");
    router.push("/dashboard");
  };

  // Step 4's exit: wait for the real crawl → analyst chain (ready / no-pages / off), or give up
  // after the ceiling — either way show the done screen first.
  useEffect(() => {
    if (step !== 4) return;
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

  useEffect(() => {
    if (!showDone) return;
    const t = setTimeout(finalizeLearning, 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDone]);

  // The progress bar's data: the same jobs_log rows Site Brain's own bar polls.
  useEffect(() => {
    if (step !== 4 || noSite || showDone) return;
    let alive = true;
    const tick = async () => {
      try {
        const d = await fetch("/api/site-brain/status").then((r) => r.json());
        if (alive && d?.ok) setBrainJobs(d.jobs ?? null);
      } catch { /* next poll */ }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [step, noSite, showDone]);

  /** Saves the address and starts the crawl in the background, right now. */
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
      // Offline or a bad gateway: carry on. The address is saved again at the end.
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

  const stage = liveStage(brainJobs, null, null);
  const learningPct = noSite ? 100 : brainReady ? 100 : stage ? pctFor(stage) : 2;
  const learningLabel = noSite
    ? "Setting up your workspace"
    : brainReady
      ? "Done — building your workspace"
      : stage?.job.progress?.label ?? (understanding?.status === "no-pages" ? "Couldn't read the site — continuing with your answers" : "Starting…");
  const stageIdx = stage ? phaseIndex(stage.agent, stage.job.progress.phase ?? null) : -1;

  return (
    <div className="ob-page ob-ground">
      <style dangerouslySetInnerHTML={{ __html: ONBOARDING_CSS }} />
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
            {step < 3 && (
              <button type="button" className="ob-topskip" onClick={() => setStep(3)}>
                Skip <ArrowRight size={14} />
              </button>
            )}
          </div>

          {step < 4 && <StepTrack step={step} total={TOTAL_STEPS} />}

          {step === 0 && (
            <>
              <h2 className="ob-h1">Connect Your Website</h2>
              <p className="ob-sub">We&apos;ll read your site to understand your business and find the best opportunities.</p>
              <div className="ob-browser">
                <div className="ob-browser-bar"><i /><i /><i /></div>
                <div className="ob-inputwrap">
                  <span className="ob-ic"><Link2 size={13} /></span>
                  <input className="ob-input" placeholder="https://yourwebsite.com" value={site} onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && site.trim() && startReading()} />
                </div>
                <div className="ob-plats">
                  <div className="ob-plat"><span><SiWordpress size={16} /></span>WordPress</div>
                  <div className="ob-plat"><span><Code2 size={16} /></span>Custom</div>
                </div>
              </div>
              <div className="ob-note">
                {["Secure & read-only access", "No changes to your site"].map((t) => <div key={t} className="ob-check">{t}</div>)}
              </div>
              {siteError && <p className="ob-error">{siteError}</p>}
              <div className="ob-actions">
                <span className="ob-skip" style={{ margin: 0, textAlign: "left" }}>No website yet? <a onClick={() => { setSite(""); setNoSite(true); setStep(1); }}>Continue without one</a></span>
                <button className="ob-btn-primary" disabled={!site.trim() || siteSaving} onClick={startReading}>
                  {siteSaving ? "Starting…" : "Next"} <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="ob-h1">What kind of business is this?</h2>
              <p className="ob-sub">One tap — this helps the team pick the right topics and tone.</p>
              <div className="ob-tiles">
                {TYPES.map((o, i) => (
                  <OptTile key={o.v} icon={o.icon} title={o.v} active={type === o.v} colorIndex={i} onClick={() => setType(o.v)} />
                ))}
              </div>
              <div className="ob-actions">
                <button className="ob-btn" onClick={() => setStep(0)}><ArrowLeft size={14} /> Back</button>
                <button className="ob-btn-primary" disabled={!type} onClick={() => setStep(2)}>Next <ArrowRight size={15} /></button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="ob-h1">What matters most?</h2>
              <p className="ob-sub">Everything the team plans is pointed at this. You can change it later.</p>
              <div className="ob-optlist2">
                {GOALS.map((g, i) => (
                  <OptRow key={g.key} icon={g.icon} title={g.label} subtitle={g.sub} active={goal === g.key} colorIndex={i} onClick={() => setGoal(g.key)} />
                ))}
              </div>
              <div className="ob-actions">
                <button className="ob-btn" onClick={() => setStep(1)}><ArrowLeft size={14} /> Back</button>
                <button className="ob-btn-primary" disabled={!goal} onClick={() => setStep(3)}>Next <ArrowRight size={15} /></button>
              </div>
            </>
          )}

          {step === 3 && revealedSecret && (
            <>
              <h2 className="ob-h1">Your webhook secret</h2>
              <p className="ob-sub">Shown once. Put it in your site&apos;s <code>.env</code> as <code>MRLXWA_WEBHOOK_SECRET</code> — it verifies our signature on each article. Setup guide: <a href="/connect/nextjs" target="_blank" rel="noopener" className="ob-link">/connect/nextjs</a></p>
              <div className="ob-secret">
                <span>{revealedSecret}</span>
                <button className="ob-btn" onClick={copySecret}>{copied ? "Copied" : "Copy"}</button>
              </div>
              <div className="ob-actions" style={{ justifyContent: "flex-end" }}>
                <button className="ob-btn-primary" onClick={() => { setRevealedSecret(null); setStep(4); }}>
                  Saved it — continue <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}

          {step === 3 && !revealedSecret && method === null && (
            <>
              <h2 className="ob-h1">Where should we publish?</h2>
              <p className="ob-sub">Every article waits for your approval first — this is just where it goes after.</p>
              <div className="ob-optlist2">
                <OptRow icon={SiWordpress as any} title="WordPress" subtitle="Publish directly to your WordPress site" active={false} colorIndex={3} onClick={() => setMethod("wordpress")} />
                <OptRow icon={Link2} title="Webhook" subtitle="Send to your own endpoint (Next.js or any site)" active={false} colorIndex={0} onClick={() => setMethod("webhook")} />
                <OptRow icon={Clock} title="I'll do this later" subtitle="Articles wait in Approvals until you connect one" active={false} colorIndex={4} onClick={() => finish()} />
              </div>
              <div className="ob-actions">
                <button className="ob-btn" onClick={() => setStep(2)}><ArrowLeft size={14} /> Back</button>
              </div>
            </>
          )}

          {step === 3 && !revealedSecret && method === "wordpress" && (
            <>
              <h2 className="ob-h1">Connect WordPress</h2>
              <p className="ob-sub">Use an <b>Application Password</b> (WP Admin → Users → Profile), not your login password.</p>
              <div className="ob-field"><label className="ob-label">Site URL</label><input className="ob-input" placeholder="https://yoursite.com" value={wpUrl} onChange={(e) => setWpUrl(e.target.value)} /></div>
              <div className="ob-field"><label className="ob-label">Username</label><input className="ob-input" placeholder="admin" value={wpUser} onChange={(e) => setWpUser(e.target.value)} autoComplete="off" /></div>
              <div className="ob-field"><label className="ob-label">Application password</label><input className="ob-input" type="password" placeholder="xxxx xxxx xxxx xxxx" value={wpPass} onChange={(e) => setWpPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connect()} autoComplete="new-password" /></div>
              {connectError && <p className="ob-error">{connectError}</p>}
              <div className="ob-actions">
                <button className="ob-btn" onClick={() => { setMethod(null); setConnectError(null); }}><ArrowLeft size={14} /> Back</button>
                <button className="ob-btn-primary" disabled={connecting} onClick={connect}>{connecting ? "Connecting…" : "Connect"} <ArrowRight size={15} /></button>
              </div>
              <p className="ob-skip"><a onClick={() => finish()}>Skip for now</a></p>
            </>
          )}

          {step === 3 && !revealedSecret && method === "webhook" && (
            <>
              <h2 className="ob-h1">Connect your webhook</h2>
              <p className="ob-sub">An API route on your site — we post each approved article there and give you a secret to verify it. <a href="/connect/nextjs" target="_blank" rel="noopener" className="ob-link">Setup guide</a></p>
              <div className="ob-field"><label className="ob-label">Your API route URL</label><input className="ob-input" placeholder="https://yoursite.com/api/mrlxwa-content" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connect()} /></div>
              {connectError && <p className="ob-error">{connectError}</p>}
              <div className="ob-actions">
                <button className="ob-btn" onClick={() => { setMethod(null); setConnectError(null); }}><ArrowLeft size={14} /> Back</button>
                <button className="ob-btn-primary" disabled={connecting} onClick={connect}>{connecting ? "Connecting…" : "Connect"} <ArrowRight size={15} /></button>
              </div>
              <p className="ob-skip"><a onClick={() => finish()}>Skip for now</a></p>
            </>
          )}

          {step === 4 && !showDone && (
            <>
              <h2 className="ob-h1">MrLxwa is learning your business</h2>
              <p className="ob-sub">{noSite ? "Building the team's memory from your answers." : "This finishes on its own — you don't need to keep this tab open."}</p>
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

          {step === 4 && showDone && (
            <div className="ob-done">
              <div className="ob-done-ic">🚀</div>
              <span className="ob-done-ok"><Check size={22} strokeWidth={3} /></span>
              <h2 className="ob-h1">You&apos;re All Set!</h2>
              <p className="ob-sub">Your AI marketing team is ready to go.<br />Let&apos;s grow your business together!</p>
              <div className="ob-donelist">
                <div className="ob-donerow"><span><Check size={12} strokeWidth={3} /></span>{noSite ? "Business saved" : "Website connected"}</div>
                <div className="ob-donerow"><span><Check size={12} strokeWidth={3} /></span>Goal set</div>
                <div className="ob-donerow"><span><Check size={12} strokeWidth={3} /></span>{method ? "Publishing platform linked" : "Team memory built"}</div>
                <div className="ob-donerow"><span><Check size={12} strokeWidth={3} /></span>Your account is ready</div>
              </div>
              <button className="ob-btn-primary" style={{ width: "100%" }} onClick={finalizeLearning}>
                Go to Dashboard <ArrowRight size={15} />
              </button>
            </div>
          )}

          {step < 4 && (
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
