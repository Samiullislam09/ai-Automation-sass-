"use client";
import Link from "next/link";
import { AuthLink, useSignedIn } from "./AuthLink";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Search, PenLine, ShieldCheck, Send, MessageSquare, Brain, Check } from "lucide-react";

const TABS = [
  { icon: Search, short: "Keywords", label: "Keyword research", body: "Find what to write, from real search data. Measured numbers are always kept apart from AI suggestions.", cta: "Try keyword research free", title: "Keywords from real search data", lines: ["how to price consulting services — measured", "freelance invoice template — measured", "best accounting app for small teams — AI-suggested"], tag: "Mr. Keyword" },
  { icon: PenLine, short: "Writer", label: "Article writer", body: "Drafts in your brand's tone with links to your own pages, then checked by a quality gate.", cta: "Try the writer free", title: "Drafts in your brand's tone", lines: ["Outline ready · 6 sections", "Internal links to 4 of your pages", "1,840 words drafted"], tag: "Mr. Writer" },
  { icon: ShieldCheck, short: "Approvals", label: "Approvals", body: "Every article waits for your yes. Approve, edit or reject in one place.", cta: "Try approvals free", title: "Nothing goes out without a yes", lines: ["Article: How to price your services", "Quality gate: passed", "Waiting for your approval"], tag: "Mr. QA" },
  { icon: Send, short: "Publish", label: "Publish", body: "Send approved articles to WordPress or a webhook, now or on a schedule.", cta: "Try publishing free", title: "One click to WordPress", lines: ["Connected: your WordPress site", "Scheduled: tomorrow 9:00", "Published and tracked"], tag: "Mr. Publish" },
  { icon: MessageSquare, short: "Chat", label: "Chat manager", body: "Ask in plain language and the right agent starts working. English, Hinglish or Roman Urdu.", cta: "Try the chat free", title: "Just tell it what you need", lines: ["“Write an article about pricing your services”", "On it — keyword picked, drafting now", "Draft ready for your review"], tag: "Chat" },
  { icon: Brain, short: "Site Brain", label: "Site Brain", body: "Crawls your site once and remembers your services, tone and audience.", cta: "Try Site Brain free", title: "It learns your business", lines: ["Crawled 48 pages", "Services, tone and audience understood", "Used in every article it writes"], tag: "Site Brain" },
];

function Panel({ i }: { i: number }) {
  const t = TABS[i];
  const Icon = t.icon;
  return (
    <div className="absolute bottom-12 left-12 right-12 top-[124px] grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-center gap-12 overflow-hidden rounded-[32px] bg-white p-14 shadow-[0_30px_60px_-20px_rgba(26,46,77,0.35)]">
      <div className="flex flex-col items-start gap-6">
        <span className="inline-flex items-center gap-2 text-[16px] font-medium text-[#404040]">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[#efecff] text-[#6a5af0]"><Icon size={16} /></span>{t.label}
        </span>
        <h3 className="text-[40px] font-medium leading-[1.1] tracking-[-0.02em] text-[#0a0a0a]">{t.title}</h3>
        <p className="max-w-[360px] text-[17px] leading-[1.5] text-[#737373]">{t.body}</p>
        <AuthLink guestHref="/signup" guestLabel={t.cta} authedLabel="Go to dashboard" className="inline-flex h-12 items-center gap-2 rounded-full bg-[#262626] px-6 text-[15px] font-semibold text-[#fafafa] transition-colors hover:bg-[#3d3d3d]"><ArrowRight size={17} /></AuthLink>
      </div>
      <div className="h-full overflow-hidden rounded-[24px] bg-[#161a1d] p-6 shadow-[0_20px_40px_-16px_rgba(0,0,0,0.45)]">
        <div className="mb-5 flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /><span className="ml-3 rounded-md bg-[#232a2f] px-3 py-1 text-[12px] text-[#8b959c]">{t.tag}</span></div>
        <div className="grid gap-3">
          {t.lines.map((l, k) => (
            <div key={l} className="flex items-center gap-3 rounded-xl border border-[#2a3238] bg-[#1d2327] px-5 py-4 text-[16px] text-[#e5e7e8]">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#2a2552] text-[#a78bfa]"><Check size={14} /></span>
              <span className="min-w-0 flex-1 truncate">{l}</span>
              <span className="text-[12px] text-[#9aa4ab]">Step {k + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Fixed 1216x683 design canvas scaled to the available width, like the reference. */
function Stage({ children }: { children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / 1216));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={wrap} className="w-full max-w-[1216px]" style={{ height: 683 * scale }}>
      <div style={{ width: 1216, height: 683, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
    </div>
  );
}

/** "Connect your site" first, account second. The visitor types their website here; it is kept in this browser (it survives the Google sign-in redirect) and the onboarding's first
 *  step opens with it already filled in (components/OnboardingWizard.tsx reads PENDING_SITE_KEY). Signed-in visitors just get the dashboard button. */
export const PENDING_SITE_KEY = "mencra.pendingSite";
function ConnectSiteForm() {
  const signedIn = useSignedIn();
  const [url, setUrl] = useState("");
  if (signedIn) {
    return (
      <AuthLink guestHref="/signup" guestLabel="Connect your site" authedLabel="Go to dashboard" className="inline-flex h-12 items-center gap-2 rounded-full bg-[#262626] pl-6 pr-[22px] text-[16px] font-semibold text-[#fafafa] transition-colors hover:bg-[#3d3d3d]"><ArrowRight size={18} /></AuthLink>
    );
  }
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try { if (url.trim()) localStorage.setItem(PENDING_SITE_KEY, url.trim()); } catch { /* private mode: the onboarding just asks again */ }
    // No login or register screen, ever: a guest workspace is created and signed in right here, then the visitor lands on the onboarding's website step.
    try {
      const res = await fetch("/api/guest", { method: "POST" });
      const g = await res.json();
      if (!g?.ok) throw new Error(g?.error || "could not open a workspace");
      const { createClient } = await import("@/lib/supabase/client");
      const { error } = await createClient().auth.signInWithPassword({ email: g.email, password: g.password });
      if (error) throw error;
      window.location.href = "/onboarding";
    } catch (err) {
      setBusy(false);
      setProblem(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };
  return (
    <div className="flex w-full max-w-[560px] flex-col items-center gap-3">
      <form onSubmit={go} className="flex w-full items-center gap-2 rounded-full border border-[#e5e5e5] bg-white p-1.5 pl-5 shadow-[0_6px_24px_-12px_rgba(26,46,77,0.25)] max-sm:flex-col max-sm:rounded-3xl max-sm:p-3">
        <input
          type="text" inputMode="url" autoComplete="url" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="yourbusiness.com" aria-label="Your website address" style={{ background: "transparent", color: "#0a0a0a", border: "none" }}
          className="h-11 min-w-0 flex-1 !bg-transparent !shadow-none text-[16px] text-[#0a0a0a] outline-none placeholder:text-[#a3a3a3] max-sm:w-full"
        />
        <button type="submit" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[#262626] pl-6 pr-5 text-[15px] font-semibold text-[#fafafa] transition-colors hover:bg-[#3d3d3d] max-sm:w-full max-sm:justify-center">
          {busy ? "Opening…" : "Connect your site"}{!busy && <ArrowRight size={17} />}
        </button>
      </form>
      {problem && <span className="text-[13px] font-medium text-[#dc2626]">{problem}</span>}
      <span className="flex items-center gap-2 text-[13px] text-[#737373]"><span className="h-2 w-2 rounded-full bg-[#6a5af0]" />Free to start. No sign-up form: we read your site first.</span>
    </div>
  );
}

export function Hero() {
  const [i, setI] = useState(0);
  return (
    <section className="flex w-full flex-col items-center gap-6 px-4 md:gap-[64px] lg:gap-[80px] lg:px-10">
      <div className="w-full max-w-[1360px] overflow-hidden rounded-[40px] bg-[linear-gradient(180deg,rgba(229,246,234,0.6)_-25.8%,rgba(255,255,255,0.6)_63.6%)] px-6 pb-8 pt-5 max-md:pb-6 md:px-10 lg:px-[72px]">
        <div className="flex flex-col items-center gap-[32px] md:gap-[80px] md:pt-[84px]">
          <div className="flex flex-col items-center gap-[36px] pt-[48px] md:pt-0">
            <div className="flex h-[26px] items-center gap-1.5 rounded-full border border-[#ffe3d5] bg-white py-1 pl-1.5 pr-3">
              <span className="block h-4 w-4 rounded-full bg-[linear-gradient(135deg,#a78bfa,#3b82f6)]" />
              <span className="whitespace-nowrap text-[11px] font-medium leading-[1.2] text-[#737373]">Human-approved at every step</span>
            </div>
            <div className="flex flex-col items-center gap-[28px]">
              <h1 className="text-center text-[length:var(--mk-h1)] leading-[var(--mk-h1-leading)] text-[#0a0a0a]">
                <span className="block lg:whitespace-nowrap">Your Entire Marketing Team.</span>
                <span className="block lg:whitespace-nowrap">One Subscription.</span>
              </h1>
              <p className="lv-sub max-w-[760px] text-center">
                AI agents research keywords, write ranking articles in your voice and publish to your website, while you approve every step.
              </p>
              <ConnectSiteForm />
            </div>
          </div>

          <div className="hidden w-full justify-center md:flex">
            <Stage>
              <div className="relative h-[683px] w-[1216px] shrink-0 overflow-hidden rounded-[44px]"
                style={{ backgroundColor: "#a99cf6", backgroundImage: "radial-gradient(ellipse 608px 341.5px at 547.2px -68.3px, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 100%), radial-gradient(ellipse 486.4px 273.2px at 36.48px 648.85px, rgba(139,108,255,0.8) 0%, rgba(139,108,255,0) 100%), radial-gradient(ellipse 547.2px 307.35px at 48.64px 54.64px, rgba(196,181,253,0.95) 0%, rgba(196,181,253,0) 100%), radial-gradient(ellipse 729.6px 409.8px at 1070.1px 170.75px, rgba(99,140,250,0.9) 0%, rgba(99,140,250,0) 100%)" }}>
                <div role="tablist" aria-label="Product tools" className="absolute left-12 top-12 h-14 w-[1120px]">
                  {TABS.map((t, k) => (
                    <button key={t.label} role="tab" aria-selected={i === k} aria-label={t.label} onClick={() => setI(k)}
                      className={`absolute top-0 flex h-14 w-14 items-center justify-center rounded-[20px] border-4 border-white transition-all duration-[250ms] hover:-translate-y-0.5 ${i === k ? "bg-[#efecff] text-[#0a0a0a]" : "bg-[#e2e5ea] text-[#8a929c]"}`}
                      style={{ left: 342 + k * 76, filter: "drop-shadow(0 10px 10px rgba(26,46,77,0.16))" }}>
                      <t.icon size={26} />
                    </button>
                  ))}
                  {TABS.map((t, k) => (
                    <span key={t.label} aria-hidden className={`pointer-events-none absolute top-[62px] w-[76px] text-center text-[12px] font-semibold leading-[14px] ${i === k ? "text-[#0a0a0a]" : "text-[#3a3560]"}`} style={{ left: 342 + k * 76 - 10 }}>{t.short}</span>
                  ))}
                </div>
                <Panel i={i} />
              </div>
            </Stage>
          </div>
        </div>
      </div>
    </section>
  );
}
