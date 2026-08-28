"use client";

/**
 * ============================================================================
 *  MR. LXWA — AI Automation System · Dashboard
 *  Pixel-match rebuild of the reference mockup, 100% code (no image crops).
 * ============================================================================
 *  Dropped in verbatim from the user-supplied mockup (Downloads/MrLxwaDashboard.tsx,
 *  2026-08-28) for a rendered preview at /dashboard-preview — see that route for why it
 *  is NOT mounted under /app/** (AppShell already renders its own sidebar/topbar; this
 *  component is a full standalone page shell and the two would nest).
 *
 *  Self-contained: no backend wiring yet. NAV/AGENTS_LEFT/AGENTS_RIGHT/TIMELINE/RESULTS/
 *  KEY_POINTS/PLAN below are the mockup's own placeholder data, unchanged — this is a UI
 *  preview to react to before any of it gets wired to real tasks/agents/chat.
 *
 *  DEPS: lucide-react (already a project dependency). Tailwind CSS (core layout classes
 *  only — every color/glow/animation lives in the embedded <style> below, scoped to
 *  .lx-root so it can't leak into the rest of the app).
 *
 *  [ASSET] NOTE — the mockup's raster art (3D brain render, robot photos, user photo) is
 *  rebuilt here in pure CSS/SVG/emoji, marked [ASSET] at each spot, for a later swap to
 *  real renders if wanted.
 *
 *  RESPONSIVE:
 *    ≥1280px (xl)  → 3 columns: sidebar · main · AI assistant
 *    1024–1279     → sidebar + main; assistant = right slide-in drawer
 *    <1024         → single column; sidebar + assistant both drawers,
 *                    mobile topbar with menu / assistant toggles,
 *                    workflow strip scrolls horizontally.
 * ============================================================================
 */

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  ClipboardList,
  ListChecks,
  CalendarDays,
  FileText,
  Globe,
  UserRound,
  TrendingUp,
  Settings,
  ChevronDown,
  Bot,
  Maximize2,
  X,
  Clock,
  Pause,
  Play,
  Send,
  Mic,
  MoreVertical,
  CheckCircle2,
  Circle,
  ArrowRight,
  Eye,
  BookOpen,
  PenLine,
  Menu,
  Plus,
  FileSearch,
} from "lucide-react";

/* ========================================================================== */
/*  THEME / GLOBAL CSS                                                        */
/* ========================================================================== */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

.lx-root{
  --lx-bg:#06060b;
  --lx-panel:#08080f;
  --lx-card:#0c0c15;
  --lx-card2:#0a0a11;
  --lx-in:#101019;
  --lx-border:rgba(255,255,255,.07);
  --lx-text:#f2f2f7;
  --lx-mut:#8b8ba0;
  --lx-dim:#5c5c72;
  --lx-purple:#8b5cf6;
  --lx-violet:#a78bfa;
  --lx-blue:#3b82f6;
  --lx-cyan:#22d3ee;
  --lx-green:#22c55e;
  --lx-red:#ef4444;
  background:var(--lx-bg);
  color:var(--lx-text);
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.lx-root *{box-sizing:border-box}
.lx-root ::selection{background:rgba(139,92,246,.35)}

/* ---- surfaces -------------------------------------------------------- */
.lx-card {background:var(--lx-card);border:1px solid var(--lx-border);border-radius:16px}
.lx-card2{background:var(--lx-card2);border:1px solid var(--lx-border);border-radius:12px}
.lx-in   {background:var(--lx-in);border:1px solid rgba(255,255,255,.06);border-radius:10px}
.lx-panelL{background:var(--lx-panel);border-right:1px solid var(--lx-border)}
.lx-panelR{background:var(--lx-panel);border-left:1px solid var(--lx-border)}

/* ---- type helpers ---------------------------------------------------- */
.lx-10{font-size:10px}.lx-11{font-size:11px}.lx-12{font-size:12px}.lx-13{font-size:13px}
.lx-mut{color:var(--lx-mut)}.lx-dim{color:var(--lx-dim)}
.lx-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

/* ---- nav -------------------------------------------------------------- */
.lx-nav{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border-radius:12px;
  color:var(--lx-mut);font-size:13px;font-weight:500;cursor:pointer;background:transparent;
  border:1px solid transparent;transition:all .18s;text-align:left}
.lx-nav:hover{color:#e8e8f2;background:rgba(255,255,255,.04)}
.lx-nav.on{color:#fff;background:linear-gradient(90deg,rgba(37,99,235,.35),rgba(139,92,246,.12));
  border-color:rgba(99,102,241,.35);
  box-shadow:0 0 18px rgba(59,130,246,.16),inset 0 0 14px rgba(59,130,246,.08)}

/* ---- pills / chips ---------------------------------------------------- */
.lx-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;
  font-size:11px;font-weight:600;padding:4px 10px;border:1px solid;white-space:nowrap}
.lx-pill.purple{color:#b9a5ff;border-color:rgba(139,92,246,.45);background:rgba(139,92,246,.12)}
.lx-pill.red   {color:#f87171;border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.12)}
.lx-pill.green {color:#4ade80;border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.1)}

/* ---- buttons ---------------------------------------------------------- */
.lx-ghost{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:10px;
  border:1px solid var(--lx-border);background:rgba(255,255,255,.03);color:#cfcfdd;
  font-size:12px;font-weight:500;cursor:pointer;transition:.18s;white-space:nowrap}
.lx-ghost:hover{border-color:rgba(139,92,246,.55);color:#fff}
.lx-icobtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
  border-radius:9px;border:1px solid var(--lx-border);background:rgba(255,255,255,.03);
  color:#9a9ab2;cursor:pointer;transition:.18s;flex-shrink:0}
.lx-icobtn:hover{color:#fff;border-color:rgba(139,92,246,.55)}
.lx-grad{display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;
  background:linear-gradient(135deg,#4f46e5,#7c3aed 55%,#8b5cf6);color:#fff;font-weight:600;
  border:1px solid rgba(139,92,246,.6);border-radius:12px;
  box-shadow:0 6px 22px rgba(124,58,237,.35);transition:.18s}
.lx-grad:hover{filter:brightness(1.1)}

/* ---- tabs -------------------------------------------------------------- */
.lx-tab{position:relative;padding:10px 2px;font-size:12.5px;font-weight:500;color:var(--lx-mut);
  background:none;border:none;cursor:pointer;white-space:nowrap}
.lx-tab:hover{color:#d6d6e4}
.lx-tab.on{color:#fff}
.lx-tab.on::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;
  background:linear-gradient(90deg,#3b82f6,#22d3ee);box-shadow:0 0 8px rgba(59,130,246,.85)}

/* ---- progress ---------------------------------------------------------- */
.lx-track{height:6px;border-radius:999px;background:#191926;overflow:hidden}
.lx-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#2563eb,#3b82f6 45%,#22d3ee);
  box-shadow:0 0 10px rgba(59,130,246,.8),0 0 18px rgba(34,211,238,.4);
  transition:width .6s ease}

/* ---- workflow ---------------------------------------------------------- */
.lx-agent{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 30% 25%,#171726,#0b0b13);border:1.5px solid var(--ac);color:var(--ac);
  flex-shrink:0}
.lx-agent.glow{box-shadow:0 0 16px color-mix(in srgb,var(--ac) 60%,transparent),
  inset 0 0 10px color-mix(in srgb,var(--ac) 25%,transparent)}
.lx-conn{position:relative;height:2px;flex:1;min-width:16px;opacity:.8;
  background-image:repeating-linear-gradient(90deg,var(--cc) 0 4px,transparent 4px 9px)}
.lx-conn i{position:absolute;top:-2px;left:0;width:5px;height:5px;border-radius:50%;
  background:var(--cc);box-shadow:0 0 6px var(--cc);animation:lxTravel 2.4s linear infinite}
@keyframes lxTravel{0%{left:0;opacity:0}12%{opacity:1}88%{opacity:1}100%{left:calc(100% - 5px);opacity:0}}

/* [ASSET] brain — emoji + hue-rotate stands in for the 3D render */
.lx-brain{font-size:56px;line-height:1;user-select:none;
  filter:hue-rotate(255deg) saturate(2.4) brightness(1.12)
         drop-shadow(0 0 16px rgba(168,85,247,.9)) drop-shadow(0 0 44px rgba(124,58,237,.55));
  animation:lxFloat 3.6s ease-in-out infinite}
@keyframes lxFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
.lx-platform{position:relative;width:128px;height:26px;margin-top:-4px}
.lx-platform::before{content:"";position:absolute;inset:0;border-radius:50%;
  border:1.5px solid rgba(34,211,238,.55);box-shadow:0 0 14px rgba(34,211,238,.45)}
.lx-platform::after{content:"";position:absolute;left:14%;right:14%;top:22%;bottom:22%;border-radius:50%;
  background:radial-gradient(ellipse at center,rgba(139,92,246,.55),rgba(139,92,246,.06) 70%);
  filter:blur(2px)}

/* ---- robot avatar (pure CSS — [ASSET] swap point) ---------------------- */
.lx-robo{position:relative;border-radius:26%;flex-shrink:0;
  background:linear-gradient(180deg,#1c2233,#0c0f17);border:1px solid rgba(255,255,255,.12);
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 16px rgba(34,211,238,.28),inset 0 0 12px rgba(34,211,238,.12)}
.lx-robo b{display:block;width:60%;height:36%;border-radius:22%;background:#04101a;
  border:1px solid rgba(34,211,238,.55);position:relative;
  box-shadow:inset 0 0 8px rgba(34,211,238,.35)}
.lx-robo b::before,.lx-robo b::after{content:"";position:absolute;top:50%;transform:translateY(-50%);
  width:18%;height:38%;border-radius:50%;background:var(--lx-cyan);
  box-shadow:0 0 7px var(--lx-cyan)}
.lx-robo b::before{left:20%}
.lx-robo b::after{right:20%}
.lx-robo i{position:absolute;top:-8%;left:50%;transform:translateX(-50%);width:2px;height:10%;
  background:rgba(34,211,238,.8)}
.lx-robo i::after{content:"";position:absolute;top:-4px;left:50%;transform:translateX(-50%);
  width:4px;height:4px;border-radius:50%;background:var(--lx-cyan);box-shadow:0 0 6px var(--lx-cyan)}

/* ---- timeline ---------------------------------------------------------- */
.lx-tl{position:relative}
.lx-tl::before{content:"";position:absolute;left:59px;top:10px;bottom:10px;width:1px;
  background:linear-gradient(180deg,rgba(34,197,94,.55),rgba(59,130,246,.45),rgba(255,255,255,.08))}
.lx-row{display:grid;grid-template-columns:44px 14px 1fr auto auto;gap:9px;align-items:center;padding:7px 0}
.lx-dot{width:9px;height:9px;border-radius:50%;position:relative;z-index:1;justify-self:center}

/* ---- misc bits --------------------------------------------------------- */
.lx-num{width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;color:#fff;flex-shrink:0;
  background:linear-gradient(135deg,#2563eb,#7c3aed)}
.lx-bar{height:4px;border-radius:2px}
.lx-pulse{animation:lxPulse 1.4s ease-in-out infinite}
@keyframes lxPulse{0%,100%{opacity:1}50%{opacity:.3}}
.lx-shimmer{background:linear-gradient(90deg,#8b8ba0 0%,#eeeefc 50%,#8b8ba0 100%);
  background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:lxShimmer 1.6s linear infinite}
@keyframes lxShimmer{from{background-position:200% 0}to{background-position:-200% 0}}

/* Live Visual's mode crossfade — plain CSS keyed to React's own key-remount (see
   components/MrLxwaDashboard.tsx), not framer-motion: a nested AnimatePresence here got
   stuck with opacity permanently at 0 in dev (confirmed via computed style), most likely a
   React-18-strict-mode double-invoke interaction. A CSS animation restarts reliably on every
   real DOM mount, which a key change always causes, so there is no state to get stuck in. */
.lx-live-anim{animation:lxLiveFade .4s ease-out both}
@keyframes lxLiveFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

/* waveform */
.lx-wv{display:flex;align-items:center;height:18px}
.lx-wv i{display:inline-block;width:2px;margin-right:2px;border-radius:2px;background:var(--wc)}
.lx-wv.anim i{animation:lxWav 1.05s ease-in-out infinite}
@keyframes lxWav{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}

/* mic ping */
.lx-mic{position:relative;width:58px;height:58px;border-radius:50%;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  background:radial-gradient(circle at 35% 30%,#12202c,#070d13);
  border:2px solid rgba(34,211,238,.8);box-shadow:0 0 18px rgba(34,211,238,.5)}
.lx-mic::before,.lx-mic::after{content:"";position:absolute;inset:-2px;border-radius:50%;
  border:2px solid rgba(34,211,238,.45);animation:lxPing 1.9s ease-out infinite}
.lx-mic::after{animation-delay:.95s}
@keyframes lxPing{from{transform:scale(1);opacity:.75}to{transform:scale(1.65);opacity:0}}

/* scrollbars */
.lx-scroll{scrollbar-width:thin;scrollbar-color:#20202e transparent}
.lx-scroll::-webkit-scrollbar{width:6px;height:6px}
.lx-scroll::-webkit-scrollbar-thumb{background:#20202e;border-radius:99px}
.lx-scroll::-webkit-scrollbar-track{background:transparent}

/* chat bubbles */
.lx-me{background:linear-gradient(135deg,#5b4bd6,#7c3aed 60%,#8b5cf6);color:#fff;
  border:1px solid rgba(167,139,250,.5);border-radius:14px 14px 4px 14px;
  box-shadow:0 4px 18px rgba(124,58,237,.3)}
.lx-ai{background:rgba(255,255,255,.03);border:1px solid var(--lx-border);
  border-radius:4px 14px 14px 14px}

@media (prefers-reduced-motion:reduce){
  .lx-root *,.lx-root *::before,.lx-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
`;

/* ========================================================================== */
/*  DATA (verbatim from the mockup)                                           */
/* ========================================================================== */

type NavItem = { label: string; icon: React.ElementType; badge?: number };
const NAV: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Chat", icon: MessageSquare },
  { label: "Office (Agents)", icon: Users },
  { label: "Tasks", icon: ClipboardList },
  { label: "Approvals", icon: ListChecks, badge: 3 },
  { label: "Schedule", icon: CalendarDays },
  { label: "Content", icon: FileText },
  { label: "Site Brain", icon: Globe },
  { label: "Leads", icon: UserRound },
  { label: "SEO & Insights", icon: TrendingUp },
  { label: "Settings", icon: Settings },
];

type AgentStatus = "Completed" | "Working" | "Waiting";
type Agent = { name: string; role: string; status: AgentStatus };

/** The real 9 agents (agent-server/src/queues.ts's AGENT_TYPES minus "boss" — boss IS the
 *  brain node in the middle of the workflow, not a 10th orbiting icon). The original mockup
 *  had 8 placeholders including "Mr. Image" and "Mr. Story", neither of which exist —
 *  MASTER_PLAN §19 names them as deliberately-not-built. Left-to-right order tells the real
 *  pipeline story: gather (Crawler → Analyst) → plan (Keyword → Writer) → [[brain]] →
 *  check/ship (SEO → Audit → Publish) → distribute (Social → Leads). */
const AGENTS_LEFT: Agent[] = [
  { name: "Mr. Crawler", role: "Site Crawler", status: "Completed" },
  { name: "Mr. Analyst", role: "Site Brain", status: "Completed" },
  { name: "Mr. Keyword", role: "Keyword Research", status: "Completed" },
  { name: "Mr. Writer", role: "Content Writer", status: "Working" },
];
const AGENTS_RIGHT: Agent[] = [
  { name: "Mr. SEO", role: "SEO Checks", status: "Waiting" },
  { name: "Mr. Audit", role: "Site Audit", status: "Waiting" },
  { name: "Mr. Publish", role: "Publisher", status: "Waiting" },
  { name: "Miss Social", role: "Social Drafts", status: "Waiting" },
  { name: "Mr. Leads", role: "Lead Discovery", status: "Waiting" },
];
const ALL_AGENTS: Agent[] = [...AGENTS_LEFT, ...AGENTS_RIGHT];

const STATUS_COLOR: Record<AgentStatus, string> = {
  Completed: "#22c55e",
  Working: "#3b82f6",
  Waiting: "#6a6a80",
};

const TIMELINE: { t: string; txt: string; s: "Completed" | "In Progress" | null }[] = [
  { t: "00:00", txt: "Analyzing user requirement", s: "Completed" },
  { t: "00:15", txt: "Understanding topic: Solar Panel Benefits", s: "Completed" },
  { t: "00:28", txt: "Generating content outline", s: "Completed" },
  { t: "00:45", txt: "Researching: Environmental benefits of solar panels", s: "In Progress" },
  { t: "00:45", txt: "Searching Google for relevant information...", s: null },
];

const RESULTS = [
  { n: 1, title: "EPA – Solar Energy Environmental Benefits", url: "www.epa.gov/solar-energy-benefits" },
  { n: 2, title: "Energy.gov – Solar Benefits", url: "www.energy.gov/eere/solar/solar-benefits" },
  { n: 3, title: "NRDC – Clean Energy, Solar Power", url: "www.nrdc.org/stories/solar-power-benefits" },
];

const KEY_POINTS = [
  "Reduces greenhouse gas emissions",
  "Lowers air pollution",
  "Sustainable & renewable energy source",
  "Long-term environmental impact",
];

const PLAN: { label: string; s: "done" | "current" | "pending" }[] = [
  { label: "Keyword research", s: "done" },
  { label: "Outline & writing", s: "done" },
  { label: "Writing article", s: "current" },
  { label: "Creating images", s: "pending" },
  { label: "SEO optimization", s: "pending" },
  { label: "Publishing", s: "pending" },
];

const TABS = ["Live Activity", "Research", "Writing", "References", "Output Preview"];

/** Live Visual is ONE section, not four stacked cards — whatever the agent is actually doing
 *  right now (search, reading a page, pulling out key points, writing) is what shows, and it
 *  crossfades to the next thing smoothly instead of everything being visible at once. This
 *  preview cycles through them on a timer since there's no real backend driving it yet; once
 *  wired to real agent events, `liveMode` is simply whatever the latest event says. */
type LiveMode = "search" | "reading" | "keypoints" | "writing";
const LIVE_MODE_ORDER: LiveMode[] = ["search", "reading", "keypoints", "writing"];
const LIVE_MODE_META: Record<LiveMode, { label: string; icon: React.ElementType }> = {
  search: { label: "Google Search", icon: Eye },
  reading: { label: "Reading Web Pages", icon: BookOpen },
  keypoints: { label: "Extracting Key Points", icon: FileSearch },
  writing: { label: "Writing Section", icon: PenLine },
};

/** The "reading" mode's page content — scrolled continuously (not swapped frame to frame) so
 *  it reads as one real page being read, not a slideshow. Short and generic on purpose: this
 *  is UI-mock filler text, not copied from any real source. */
const READING_LINES = [
  "Solar panels convert sunlight directly into electricity, producing no exhaust or combustion byproducts at the point of use.",
  "A typical home system offsets several tons of carbon dioxide every year compared to grid electricity from fossil fuels.",
  "Because panels have no moving parts, they need very little maintenance beyond occasional cleaning and periodic inspection.",
  "Local air quality improves as fewer fossil-fuel power plants are needed to run at full output during peak demand.",
  "Most residential systems pay back their installation cost within seven to ten years through reduced utility bills.",
  "Panel materials are largely recyclable at end of life, and recycling programs are expanding across most regions.",
];

/* ========================================================================== */
/*  SMALL PIECES                                                              */
/* ========================================================================== */

/** Lime starburst logo mark ([ASSET] swap point). */
const LogoMark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
    <defs>
      <linearGradient id="lxLime" x1="0" y1="0" x2="32" y2="32">
        <stop offset="0" stopColor="#d9f99d" />
        <stop offset="1" stopColor="#4ade80" />
      </linearGradient>
    </defs>
    {[0, 30, 60, 90, 120, 150].map((r) => (
      <rect key={r} x={14.4} y={2} width={3.2} height={28} rx={1.6} fill="url(#lxLime)" transform={`rotate(${r} 16 16)`} />
    ))}
    <circle cx={16} cy={16} r={3.4} fill="#06060b" />
    <circle cx={16} cy={16} r={2} fill="url(#lxLime)" />
  </svg>
);

/** Google "G". */
const GoogleG = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z" />
  </svg>
);

/** Minimal 6-petal AI-model mark (stands in for the model-provider logo). */
const AiMark = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    {[0, 60, 120, 180, 240, 300].map((r) => (
      <rect key={r} x={10.6} y={2.5} width={2.8} height={9} rx={1.4} fill="#e8e8f2" transform={`rotate(${r} 12 12)`} />
    ))}
  </svg>
);

/** CSS robot avatar ([ASSET] swap point for the robot photos). */
const Robo = ({ size = 40 }: { size?: number }) => (
  <span className="lx-robo" style={{ width: size, height: size }} aria-hidden>
    <i />
    <b />
  </span>
);

/** Waveform bars. */
const Wave = ({
  n = 20,
  color = "var(--lx-cyan)",
  h = 16,
  anim = false,
}: {
  n?: number;
  color?: string;
  h?: number;
  anim?: boolean;
}) => {
  const bars = Array.from({ length: n }, (_, i) => 0.3 + Math.abs(Math.sin(i * 1.7)) * 0.7);
  return (
    <span className={`lx-wv ${anim ? "anim" : ""}`} style={{ ["--wc" as string]: color, height: h }}>
      {bars.map((v, i) => (
        <i key={i} style={{ height: Math.round(v * h), animationDelay: `${(i % 6) * 0.12}s` }} />
      ))}
    </span>
  );
};

/** Dashed animated connector between agents. */
const Conn = ({ color = "rgba(148,148,170,.55)" }: { color?: string }) => (
  <span className="lx-conn" style={{ ["--cc" as string]: color }}>
    <i />
  </span>
);

/** One workflow agent node. `compact` is the single-line form shown once an agent panel is
 *  open (smaller icon, name+status stacked beside it instead of under it, no wasted vertical
 *  space) — same data, same colors, just laid out to fit a strip instead of a spacious grid. */
const AgentNode = ({ a, compact = false, onClick }: { a: Agent; compact?: boolean; onClick?: () => void }) => {
  const c = STATUS_COLOR[a.status];
  const iconSize = compact ? 30 : 46;
  const clickable = !!onClick;

  const icon = (
    <span
      className={`lx-agent ${a.status !== "Waiting" ? "glow" : ""}`}
      style={{
        width: iconSize,
        height: iconSize,
        ["--ac" as string]: a.status === "Waiting" ? "rgba(255,255,255,.16)" : c,
        color: a.status === "Waiting" ? "#8b8ba0" : c,
      }}
    >
      <Bot size={compact ? 14 : 20} />
    </span>
  );

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!clickable}
        className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1"
        style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--lx-border)", cursor: clickable ? "pointer" : "default" }}
      >
        {icon}
        <span className="flex flex-col items-start leading-tight">
          <span className="lx-11 font-medium" style={{ color: "#d7d7e4" }}>{a.name}</span>
          <span className="lx-10" style={{ color: c }}>{a.status}</span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className="flex flex-col items-center gap-1 bg-transparent"
      style={{ width: 74, border: "none", cursor: clickable ? "pointer" : "default" }}
    >
      {icon}
      <span className="lx-11 font-medium text-center" style={{ color: "#d7d7e4" }}>{a.name}</span>
      <span className="lx-10" style={{ color: c }}>{a.status}</span>
    </button>
  );
};

const fmt = (s: number) => {
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor(s / 60) % 60).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
};
const nowTime = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();

/* ========================================================================== */
/*  MAIN COMPONENT                                                            */
/* ========================================================================== */

export default function MrLxwaDashboard() {
  const [nav, setNav] = useState("Dashboard");
  const [tab, setTab] = useState("Live Activity");
  const [aTab, setATab] = useState<"assistant" | "voice">("assistant");
  const [sideOpen, setSideOpen] = useState(false); // <lg drawer
  const [botOpen, setBotOpen] = useState(false); // <lg drawer
  const [paused, setPaused] = useState(false);
  const [msg, setMsg] = useState("");
  const [thread, setThread] = useState<{ who: "user" | "ai"; text: string; time: string }[]>([]);
  const [sec, setSec] = useState(272); // 00:04:32
  const chatRef = useRef<HTMLDivElement>(null);

  // The agent panel (live activity, timeline, search results) exists to show ONE agent's
  // live work — it only makes sense while an agent is actually working. `workingAgent` is
  // that fact; `showPanel` is the user's own choice to look at it or step back to the whole
  // team (the "Back to Workflow" button), independent of whether anyone is still working.
  const workingAgent = ALL_AGENTS.find((a) => a.status === "Working") ?? null;
  const [showPanel, setShowPanel] = useState(!!workingAgent);
  const panelOpen = showPanel && !!workingAgent;

  // Live Visual's one current mode — cycles on a timer here only because this preview has no
  // real agent events to drive it yet (see the type's own comment above).
  const [liveMode, setLiveMode] = useState<LiveMode>("search");
  useEffect(() => {
    if (paused || !panelOpen) return;
    const id = setInterval(() => {
      setLiveMode((m) => LIVE_MODE_ORDER[(LIVE_MODE_ORDER.indexOf(m) + 1) % LIVE_MODE_ORDER.length]);
    }, 4000);
    return () => clearInterval(id);
  }, [paused, panelOpen]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, aTab]);

  const send = () => {
    const t = msg.trim();
    if (!t) return;
    setThread((p) => [...p, { who: "user", text: t, time: nowTime() }]);
    setMsg("");
    setTimeout(
      () =>
        setThread((p) => [
          ...p,
          { who: "ai", text: "Got it! I have shared this with the team and queued it up. 👍", time: nowTime() },
        ]),
      900
    );
  };

  /* ---------------------------------------------------------------------- */

  const Sidebar = (
    <aside
      className={`lx-panelL fixed inset-y-0 left-0 z-50 flex w-48 shrink-0 flex-col transition-transform duration-300 lg:static lg:translate-x-0 ${
        sideOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* logo */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <LogoMark size={30} />
        <div className="min-w-0">
          <div className="text-sm font-bold leading-tight">Mr. Lxwa</div>
          <div className="lx-10 lx-mut leading-tight">AI Automation System</div>
        </div>
        <button className="lx-icobtn ml-auto lg:hidden" onClick={() => setSideOpen(false)} aria-label="Close menu">
          <X size={15} />
        </button>
      </div>

      {/* nav */}
      <nav className="lx-scroll flex-1 space-y-1 overflow-y-auto px-3">
        {NAV.map((it) => (
          <button key={it.label} className={`lx-nav ${nav === it.label ? "on" : ""}`} onClick={() => setNav(it.label)}>
            <it.icon size={16} strokeWidth={1.8} />
            <span className="truncate">{it.label}</span>
            {it.badge ? (
              <span
                className="ml-auto flex h-5 w-5 items-center justify-center rounded-full lx-10 font-bold text-white"
                style={{ background: "linear-gradient(135deg,#7c3aed,#8b5cf6)", boxShadow: "0 0 10px rgba(139,92,246,.6)" }}
              >
                {it.badge}
              </span>
            ) : null}
          </button>
        ))}

        {/* system status */}
        <div className="lx-card2 mt-4 p-3">
          <div className="flex items-center gap-2">
            <span className="lx-pulse h-2 w-2 rounded-full" style={{ background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
            <span className="lx-12 font-semibold">System Status</span>
          </div>
          <div className="lx-10 lx-mut mt-1">All Systems Operational</div>

          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between lx-11">
              <span className="lx-mut">AI Brain</span>
              <span className="flex items-center gap-1 font-medium" style={{ color: "#4ade80" }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e" }} /> Online
              </span>
            </div>
            <div className="flex items-center justify-between lx-11">
              <span className="lx-mut">Agents Online</span>
              <span className="font-medium">8 / 10</span>
            </div>
            <div className="flex items-center justify-between lx-11">
              <span className="lx-mut">Active Tasks</span>
              <span className="font-medium">7</span>
            </div>
            <div className="flex items-center justify-between lx-11">
              <span className="lx-mut">Queue</span>
              <span className="font-medium">2</span>
            </div>
            <div className="flex items-center justify-between lx-11">
              <span className="lx-mut">Server Load</span>
              <span className="font-medium">32%</span>
            </div>
          </div>

          <svg viewBox="0 0 120 26" className="mt-2 w-full" style={{ height: 26 }} aria-hidden>
            <polyline
              points="0,20 10,15 20,18 30,11 40,15 50,8 60,13 70,7 80,12 90,5 100,10 110,7 120,10"
              fill="none"
              stroke="#22c55e"
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ filter: "drop-shadow(0 0 4px rgba(34,197,94,.8))" }}
            />
          </svg>
        </div>
      </nav>

      {/* user ([ASSET] user photo → gradient initial) */}
      <div className="p-3">
        <button className="lx-card2 flex w-full items-center gap-3 p-2.5 text-left">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444 60%,#7c3aed)" }}
          >
            U
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate lx-13 font-semibold">Umar</span>
            <span className="block lx-10 lx-mut">Pro Plan</span>
          </span>
          <ChevronDown size={15} className="lx-mut" />
        </button>
      </div>
    </aside>
  );

  /* ---------------------------------------------------------------------- */

  // Only a working agent is ever clickable — the panel shows real live activity for it, and
  // there is no fake content to show for one that's idle. Clicking any of the other 9 icons
  // does nothing, same as they'd be inert in the real dashboard until they actually start.
  const openAgentPanel = (a: Agent) => {
    if (a.status === "Working") setShowPanel(true);
  };

  const Workflow = (
    <motion.section layout transition={{ layout: { duration: 0.45, ease: "easeInOut" } }} className="lx-card relative overflow-hidden">
      {/* ambient glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: 420, height: 220, background: "radial-gradient(ellipse at center,rgba(124,58,237,.22),transparent 65%)" }}
      />
      {/* chip — only in the spread-out resting layout; the compact single-line row has no
          room for it and it would float on top of the agent pills */}
      {workingAgent && !panelOpen && (
        <div className="lx-card2 absolute left-4 top-4 z-10 hidden items-center gap-2.5 px-3 py-2 md:flex">
          <span className="h-2 w-2 rounded-full lx-pulse" style={{ background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
          <span>
            <span className="block lx-11 font-semibold">Planning &amp; Orchestrating</span>
            <span className="block lx-10 lx-mut">Delegated to {workingAgent.name}</span>
          </span>
        </div>
      )}

      <AnimatePresence initial={false} mode="wait">
        {panelOpen ? (
          // ---- compact: every agent sorted into one line, once a panel is open ----
          <motion.div
            key="compact"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="lx-scroll overflow-x-auto"
          >
            <div className="flex min-w-max items-center gap-2 px-4 py-3">
              {AGENTS_LEFT.map((a) => (
                <AgentNode key={a.name} a={a} compact onClick={() => openAgentPanel(a)} />
              ))}
              <span className="lx-brain shrink-0" style={{ fontSize: 26 }}>🧠</span>
              {AGENTS_RIGHT.map((a) => (
                <AgentNode key={a.name} a={a} compact onClick={() => openAgentPanel(a)} />
              ))}
            </div>
          </motion.div>
        ) : (
          // ---- full: the whole team spaced out, spotlighting the brain — the resting state ----
          <motion.div
            key="full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="lx-scroll overflow-x-auto"
          >
            <div className="mx-auto flex min-w-max items-center gap-1 px-6 py-6">
              {AGENTS_LEFT.map((a, i) => (
                <React.Fragment key={a.name}>
                  <AgentNode a={a} onClick={() => openAgentPanel(a)} />
                  <Conn color={i === 0 ? "rgba(34,197,94,.8)" : i === 1 ? "rgba(59,130,246,.8)" : "rgba(148,148,170,.45)"} />
                </React.Fragment>
              ))}

              {/* [ASSET] Mr. Lxwa brain */}
              <div className="flex flex-col items-center px-3" style={{ minWidth: 150 }}>
                <div className="lx-12 font-bold">Mr. Lxwa</div>
                <div className="lx-10 lx-mut mb-1">AI Brain (Boss)</div>
                <div className="lx-brain">🧠</div>
                <div className="lx-platform" />
              </div>

              {AGENTS_RIGHT.map((a) => (
                <React.Fragment key={a.name}>
                  <Conn color="rgba(148,148,170,.45)" />
                  <AgentNode a={a} onClick={() => openAgentPanel(a)} />
                </React.Fragment>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );

  /* ---------------------------------------------------------------------- */

  const AgentPanel = (
    <motion.section
      layout
      initial={{ opacity: 0, height: 0, y: -12 }}
      animate={{ opacity: 1, height: "auto", y: 0 }}
      exit={{ opacity: 0, height: 0, y: -12 }}
      transition={{ duration: 0.35, ease: "easeInOut" }}
      style={{ overflow: "hidden" }}
      className="lx-card p-4"
    >
      {/* panel toolbar — agent identity moved in here (small, inline) since the old left
          column's "Agent Status" card was dropped, and "Back to Workflow" / "Minimize Agent"
          dropped too (per request, to give Live Visual more room) — Close (X) already does
          exactly what "Back to Workflow" did (setShowPanel(false)), so nothing was lost. */}
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Robo size={26} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-bold">{workingAgent?.name ?? "Mr. Writer"}</div>
            <div className="lx-10 lx-mut truncate">{workingAgent?.role ?? "Content Writer"} Agent · {fmt(sec)}</div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="lx-icobtn" aria-label="Expand">
            <Maximize2 size={14} />
          </button>
          <button className="lx-icobtn" aria-label="Back to workflow" onClick={() => setShowPanel(false)}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* center — progress + live activity */}
        <div className="min-w-0 lg:col-span-6 xl:col-span-5">
          <div className="text-lg font-bold leading-tight">Writing Section 2 of 5</div>
          <div className="lx-12 lx-mut mt-0.5">Title: Environmental Benefits of Solar Panels</div>

          <div className="mt-4 flex items-center justify-between">
            <span className="lx-11 lx-mut">Overall Progress</span>
            <span className="lx-12 font-bold">42%</span>
          </div>
          <div className="lx-track mt-1.5">
            <div className="lx-fill" style={{ width: "42%" }} />
          </div>
          <div className="lx-11 lx-mut mt-1.5">Step 3 of 6: Writing Article</div>

          {/* tabs */}
          <div className="lx-scroll mt-3 flex gap-6 overflow-x-auto border-b" style={{ borderColor: "var(--lx-border)" }}>
            {TABS.map((t) => (
              <button key={t} className={`lx-tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>

          <div className="lx-13 mt-4 font-semibold">What I&apos;m doing right now</div>

          {/* timeline */}
          <div className="lx-tl mt-1">
            {TIMELINE.map((r, i) => {
              const done = r.s === "Completed";
              const prog = r.s === "In Progress";
              return (
                <div className="lx-row" key={i}>
                  <span className="lx-10 lx-mono lx-dim text-right">{r.t}</span>
                  <span
                    className={`lx-dot ${prog ? "lx-pulse" : ""}`}
                    style={{
                      background: done ? "#22c55e" : prog ? "#3b82f6" : "#3d3d52",
                      boxShadow: done ? "0 0 8px rgba(34,197,94,.9)" : prog ? "0 0 8px rgba(59,130,246,.9)" : "none",
                    }}
                  />
                  <span className="lx-12 truncate" style={{ color: prog ? "#93c5fd" : done ? "#d9d9e6" : "var(--lx-mut)" }}>
                    {r.txt}
                  </span>
                  <span className="lx-10 font-semibold" style={{ color: done ? "#4ade80" : prog ? "#60a5fa" : "transparent" }}>
                    {r.s ?? "·"}
                  </span>
                  {r.s ? (
                    <CheckCircle2 size={14} style={{ color: done ? "#22c55e" : "rgba(96,165,250,.7)" }} />
                  ) : (
                    <span style={{ width: 14 }} />
                  )}
                </div>
              );
            })}
          </div>

        </div>

        {/* right — live visual: ONE section, whatever the agent is doing right now — the
            actual Google search / page-reading content used to be duplicated here in the
            center column too; it now lives only in Live Visual (below), where the mode it's
            showing matches what the timeline says is "In Progress". */}
        <div className="lg:col-span-6 xl:col-span-7">
          <div className="flex items-center justify-between">
            <span className="lx-13 font-semibold">Live Visual</span>
            <span className="lx-pill red">
              <span className="lx-pulse h-1.5 w-1.5 rounded-full" style={{ background: "#ef4444" }} /> LIVE
            </span>
          </div>

          <div className="lx-card2 mt-3 overflow-hidden p-3" style={{ minHeight: 260 }}>
            <div key={liveMode} className="lx-live-anim">
                <div className="flex items-center gap-2 lx-11 font-semibold">
                  {(() => {
                    const Icon = LIVE_MODE_META[liveMode].icon;
                    return <Icon size={13} className="lx-mut" />;
                  })()}
                  {LIVE_MODE_META[liveMode].label}
                </div>

                {/* search: the real query the agent is actually running, and the real results —
                    this used to be duplicated in the center column; it lives only here now. */}
                {liveMode === "search" && (
                  <div className="lx-in mt-2 p-2.5">
                    <div className="flex items-center gap-2">
                      <GoogleG size={12} />
                      <span className="lx-11 flex-1 truncate" style={{ color: "#cfcfdd" }}>
                        environmental benefits of solar panels
                      </span>
                    </div>
                    <div className="mt-2.5 space-y-2">
                      {RESULTS.map((r, i) => (
                        <motion.div
                          key={r.n}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.12, duration: 0.3 }}
                          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5"
                          style={{ background: "rgba(255,255,255,.03)" }}
                        >
                          <span className="lx-num" style={{ width: 17, height: 17, fontSize: 9 }}>{r.n}</span>
                          <span className="min-w-0">
                            <span className="block truncate lx-11 font-medium" style={{ color: "#7db4fd" }}>{r.title}</span>
                            <span className="block truncate lx-10" style={{ color: "#34d399" }}>{r.url}</span>
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* reading: a real page, continuously auto-scrolling in place — one section,
                    one animation, not a slideshow of static snapshots. */}
                {liveMode === "reading" && (
                  <div className="lx-in mt-2 p-2.5">
                    <div className="lx-10 lx-mut mb-2 truncate">www.epa.gov/solar-energy-benefits</div>
                    <div style={{ height: 130, overflow: "hidden", position: "relative", borderRadius: 8 }}>
                      <motion.div
                        animate={{ y: [0, -170] }}
                        transition={{ duration: 10, repeat: Infinity, repeatType: "loop", ease: "linear" }}
                      >
                        {READING_LINES.map((line, i) => (
                          <p key={i} className="lx-10 mb-2.5" style={{ color: "rgba(226,226,238,.65)", lineHeight: 1.6 }}>
                            {line}
                          </p>
                        ))}
                      </motion.div>
                      {/* top/bottom fade so the loop reads as a clipped viewport, not text cut off mid-line */}
                      <div
                        className="pointer-events-none absolute inset-0"
                        style={{ background: "linear-gradient(180deg, var(--lx-in) 0%, transparent 18%, transparent 82%, var(--lx-in) 100%)" }}
                      />
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="lx-shimmer lx-10 font-medium">Reading…</span>
                    </div>
                  </div>
                )}

                {liveMode === "keypoints" && (
                  <ul className="mt-2 space-y-1.5">
                    {KEY_POINTS.map((k, i) => (
                      <motion.li
                        key={k}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.15, duration: 0.3 }}
                        className="flex items-start gap-2 lx-10"
                        style={{ color: "#b9b9cc" }}
                      >
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ background: "#22d3ee", boxShadow: "0 0 4px #22d3ee" }} />
                        {k}
                      </motion.li>
                    ))}
                  </ul>
                )}

                {liveMode === "writing" && (
                  <>
                    <div className="lx-shimmer lx-10 mt-2 font-medium">Generating content...</div>
                    <div className="mt-2">
                      <Wave n={26} h={18} anim color="var(--lx-purple)" />
                    </div>
                  </>
                )}
            </div>
          </div>

          {/* which of the 4 the panel is currently showing, and a way to jump straight to one */}
          <div className="mt-2 flex items-center justify-center gap-1.5">
            {LIVE_MODE_ORDER.map((m) => (
              <button
                key={m}
                aria-label={LIVE_MODE_META[m].label}
                onClick={() => setLiveMode(m)}
                className="rounded-full"
                style={{
                  width: 6,
                  height: 6,
                  border: "none",
                  cursor: "pointer",
                  background: m === liveMode ? "var(--lx-cyan)" : "rgba(255,255,255,.15)",
                  boxShadow: m === liveMode ? "0 0 6px var(--lx-cyan)" : "none",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );

  /* ---------------------------------------------------------------------- */

  const VoiceDock = (
    <div className="flex items-center justify-center gap-3 px-4 py-3">
      <Wave n={12} h={22} anim color="rgba(139,92,246,.9)" />
      <div className="flex flex-col items-center gap-1">
        <button className="lx-mic" aria-label="Stop listening">
          <Mic size={20} style={{ color: "var(--lx-cyan)" }} />
        </button>
        <span className="lx-11 font-medium">Listening...</span>
        <span className="lx-10 lx-dim">Tap to stop</span>
      </div>
      <Wave n={12} h={22} anim color="rgba(34,211,238,.9)" />
    </div>
  );

  const Assistant = (
    <aside
      className={`lx-panelR fixed inset-y-0 right-0 z-50 flex w-64 shrink-0 flex-col transition-transform duration-300 lg:static lg:translate-x-0 ${
        botOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* tabs */}
      <div className="flex items-center gap-5 border-b px-4" style={{ borderColor: "var(--lx-border)" }}>
        <button
          className="lx-tab on"
          style={aTab === "assistant" ? { color: "var(--lx-violet)" } : { color: "var(--lx-mut)" }}
          onClick={() => setATab("assistant")}
        >
          AI Assistant
        </button>
        <button
          className={`lx-tab ${aTab === "voice" ? "on" : ""}`}
          style={aTab === "voice" ? { color: "var(--lx-violet)" } : undefined}
          onClick={() => setATab("voice")}
        >
          Voice
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button className="lx-icobtn lg:hidden" onClick={() => setBotOpen(false)} aria-label="Close assistant">
            <X size={14} />
          </button>
          <button className="lx-icobtn" style={{ border: "none", background: "transparent" }} aria-label="More">
            <MoreVertical size={15} />
          </button>
        </div>
      </div>

      {/* agent card */}
      <div className="lx-card2 mx-3 mt-3 flex items-center gap-3 p-3">
        <Robo size={38} />
        <div className="min-w-0 flex-1">
          <div className="lx-13 font-bold leading-tight">Mr. Lxwa</div>
          <div className="lx-10 lx-mut">AI Brain</div>
          <div className="flex items-center gap-1 lx-10" style={{ color: "#4ade80" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} /> Online
          </div>
        </div>
        <button className="lx-icobtn" aria-label="Expand agent">
          <Maximize2 size={13} />
        </button>
      </div>

      {aTab === "assistant" ? (
        <div ref={chatRef} className="lx-scroll flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <div className="lx-10 lx-dim text-right">09:30 AM</div>

          {/* user msg */}
          <div className="flex justify-end">
            <div className="lx-me lx-12 max-w-xs px-3 py-2.5 leading-relaxed">
              Write a detailed article on solar panel benefits for homes and publish it on my website.
            </div>
          </div>

          {/* ai voice reply */}
          <div>
            <div className="flex items-center gap-2">
              <Robo size={24} />
              <span className="lx-11 font-semibold">Mr. Lxwa</span>
              <span className="lx-10 lx-dim ml-auto">09:30 AM</span>
            </div>
            <div className="lx-ai mt-1.5 flex items-center gap-2.5 px-3 py-2.5" style={{ marginLeft: 30 }}>
              <Wave n={26} h={16} color="var(--lx-cyan)" />
              <span className="ml-auto flex items-center gap-1 lx-10 lx-mut">
                <Clock size={11} /> 00:08
              </span>
            </div>

            {/* ai text + plan */}
            <div className="lx-ai lx-12 mt-2 px-3 py-2.5 leading-relaxed" style={{ marginLeft: 30 }}>
              <p>Got it! I&apos;ll organize my team and get this done for you.</p>
              <p className="mt-2">Here&apos;s the plan:</p>
              <ul className="mt-2 space-y-1.5">
                {PLAN.map((p) => (
                  <li key={p.label} className="flex items-center gap-2">
                    {p.s === "done" ? (
                      <CheckCircle2 size={14} style={{ color: "#22c55e" }} />
                    ) : p.s === "current" ? (
                      <ArrowRight size={14} style={{ color: "#60a5fa" }} />
                    ) : (
                      <Circle size={13} style={{ color: "#4a4a60" }} />
                    )}
                    <span style={{ color: p.s === "current" ? "#93c5fd" : p.s === "done" ? "#e2e2ee" : "var(--lx-mut)" }}>
                      {p.label}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2">You can watch the live progress on the dashboard.</p>
              <p className="mt-1">Let&apos;s get started! 🚀</p>
            </div>
          </div>

          <div className="lx-10 lx-dim text-right">09:31 AM</div>
          <div className="flex justify-end">
            <div className="lx-me lx-12 px-3.5 py-2">Show me live</div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <Robo size={24} />
              <span className="lx-11 font-semibold">Mr. Lxwa</span>
              <span className="lx-10 lx-dim ml-auto">09:31 AM</span>
            </div>
            <div className="lx-ai lx-12 mt-1.5 px-3 py-2.5 leading-relaxed" style={{ marginLeft: 30 }}>
              Sure! You can watch Mr. Writer working on your article.
            </div>
          </div>

          <button className="lx-grad lx-12 w-full py-2.5">
            <LayoutDashboard size={14} /> View Live Workflow
          </button>

          {/* dynamic messages */}
          {thread.map((m, i) =>
            m.who === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="lx-me lx-12 max-w-xs px-3 py-2.5 leading-relaxed">{m.text}</div>
              </div>
            ) : (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <Robo size={24} />
                  <span className="lx-11 font-semibold">Mr. Lxwa</span>
                  <span className="lx-10 lx-dim ml-auto">{m.time}</span>
                </div>
                <div className="lx-ai lx-12 mt-1.5 px-3 py-2.5 leading-relaxed" style={{ marginLeft: 30 }}>
                  {m.text}
                </div>
              </div>
            )
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
          <Robo size={72} />
          <div className="text-center">
            <div className="text-base font-bold">Mr. Lxwa</div>
            <div className="lx-11 lx-mut">Voice mode — talk to your AI Brain</div>
          </div>
        </div>
      )}

      {/* voice dock */}
      {VoiceDock}

      {/* input */}
      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 rounded-full border px-3 py-1.5" style={{ borderColor: "var(--lx-border)", background: "var(--lx-in)" }}>
          <Mic size={16} className="lx-mut shrink-0" style={{ cursor: "pointer" }} />
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Type your message..."
            className="lx-12 w-full bg-transparent py-1.5 outline-none"
            style={{ border: "none", color: "var(--lx-text)" }}
          />
          <button
            onClick={send}
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
            style={{ background: "linear-gradient(135deg,#4f46e5,#8b5cf6)", border: "none", cursor: "pointer", boxShadow: "0 0 12px rgba(124,58,237,.5)" }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </aside>
  );

  /* ---------------------------------------------------------------------- */

  const BottomBar = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-1.5" style={{ borderColor: "var(--lx-border)", background: "var(--lx-panel)" }}>
      <button className="lx-icobtn rounded-full" aria-label="New task">
        <Plus size={13} />
      </button>
      <div className="min-w-0 lx-11">
        <span className="lx-mut">Current: </span>
        <span className="font-semibold">Solar Panel Benefits for Homes</span>
        <span className="lx-mut"> · Step 3 of 6</span>
      </div>

      <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex" style={{ maxWidth: 260 }}>
        <div className="lx-track flex-1">
          <div className="lx-fill" style={{ width: "42%" }} />
        </div>
        <span className="lx-11 font-bold">42%</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="lx-10 lx-mut hidden md:inline">
          <span className="lx-mono font-semibold" style={{ color: "#e6e6f2" }}>{fmt(sec)}</span> / 00:12:30
        </span>
        <button className="lx-icobtn rounded-full" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume" : "Pause"}>
          {paused ? <Play size={12} /> : <Pause size={12} />}
        </button>
        <button
          className="lx-pill red"
          style={{ cursor: "pointer", padding: "5px 11px", background: "rgba(239,68,68,.08)" }}
        >
          <span className="relative flex h-3 w-3 items-center justify-center rounded-full border" style={{ borderColor: "#f87171" }}>
            <span className="h-1 w-1 rounded-sm" style={{ background: "#f87171" }} />
          </span>
          Stop Task
        </button>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------------- */

  return (
    <div className="lx-root flex h-screen w-full overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* drawer overlays */}
      {(sideOpen || botOpen) && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(2px)" }}
          onClick={() => {
            setSideOpen(false);
            setBotOpen(false);
          }}
        />
      )}

      {Sidebar}

      {/* center column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile topbar */}
        <div className="flex items-center gap-2 border-b px-3 py-2 lg:hidden" style={{ borderColor: "var(--lx-border)", background: "var(--lx-panel)" }}>
          <button className="lx-icobtn lg:hidden" onClick={() => setSideOpen(true)} aria-label="Open menu">
            <Menu size={16} />
          </button>
          <LogoMark size={22} />
          <span className="lx-13 font-bold">Mr. Lxwa</span>
          <button className="lx-icobtn ml-auto" onClick={() => setBotOpen(true)} aria-label="Open AI assistant">
            <Bot size={16} />
          </button>
        </div>

        {/* scrollable content */}
        <main className="lx-scroll flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
          {Workflow}
          <AnimatePresence initial={false}>{panelOpen && AgentPanel}</AnimatePresence>
          {BottomBar}
        </main>
      </div>

      {Assistant}
    </div>
  );
}
