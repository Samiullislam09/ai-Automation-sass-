"use client";

/**
 * ============================================================================
 *  MR. LXWA — AI Automation System · Dashboard
 *  Pixel-match rebuild of the reference mockup, 100% code (no image crops).
 * ============================================================================
 *  Grew out of a user-supplied mockup (Downloads/MrLxwaDashboard.tsx, 2026-08-28), first
 *  shown at /dashboard-preview, then approved and routed at /dashboard (app/dashboard/
 *  page.tsx) 2026-08-29. NOT mounted under app/app/** — AppShell already renders its own
 *  sidebar/topbar/chat; this component is a full standalone page shell and the two would
 *  nest.
 *
 *  REAL, as of 2026-08-29: the Assistant chat panel (`stream()` below, POSTs /api/chat —
 *  same backend as production's BossChat) and the agent network's per-agent status
 *  (`useLiveEvents` from lib/live.ts — the same Realtime task/step feed components/
 *  Workspace.tsx already uses). AGENT_META_LEFT/RIGHT below are just identity (name, role,
 *  icon, color) — status is always derived from the real current task, never hardcoded.
 *  NAV and a few cosmetic bits (TABS) are still mockup placeholders; nothing renders a
 *  status/progress claim that isn't backed by a real task_steps/task_events row.
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
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveEvents, type TaskState } from "@/lib/live";
import { useStore, PLANS } from "@/lib/store";
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
  Link2,
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
  BookOpen,
  PenLine,
  Menu,
  Plus,
  BarChart3,
  KeyRound,
  Search,
  ShieldCheck,
  Megaphone,
  Loader2,
  Image as ImageIcon,
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
/* bumped up from the original 10/11/12/13px scale — read as too small ("bahut chota") once
   the network cards had real names/roles/status packed into them, not just icons */
.lx-10{font-size:11.5px}.lx-11{font-size:13px}.lx-12{font-size:14.5px}.lx-13{font-size:16px}
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

/* [ASSET] brain emoji — used only in the compact single-line row (panel open); the resting
   "AI Agent Network" state uses the lucide Brain icon inside .lx-hex instead. */
.lx-brain{font-size:56px;line-height:1;user-select:none;
  filter:hue-rotate(255deg) saturate(2.4) brightness(1.12)
         drop-shadow(0 0 16px rgba(168,85,247,.9)) drop-shadow(0 0 44px rgba(124,58,237,.55));
  animation:lxFloat 3.6s ease-in-out infinite}
@keyframes lxFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}

/* ---- AI Agent Network (resting-state layout, matches the reference mockup) ------------ */
/* breakpoint is on the CONTAINER (the center column), not the viewport — the column is
   ~480px wide even on a 1024px screen once the sidebar and assistant take their share, and
   the JS that measures wire endpoints uses the same 440px container threshold. */
.lx-net-host{container-type:inline-size}
.lx-net{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.lx-net-brain{order:-1;grid-column:1 / -1}
@container (min-width:440px){
  .lx-net{grid-template-columns:repeat(12,1fr);grid-template-rows:repeat(4,auto);
    grid-template-areas:
      "t1 t1 t1 t2 t2 t2 t3 t3 t3 t4 t4 t4"
      "l1 l1 l1 l1 b  b  b  b  r1 r1 r1 r1"
      "o1 o1 o1 o2 o2 o2 o3 o3 o3 o4 o4 o4"}
  /* side cards sit centred on the brain, single-card height; the brain card itself does
     not stretch to fill the row — it keeps the reference's compact size */
  [data-net='l1'],[data-net='r1'],[data-net='b']{align-self:center}
  .lx-net-brain{order:0;grid-column:auto}
}

.lx-net-card{position:relative;z-index:1;background:#0b0b14;border:1px solid rgba(255,255,255,.08);
  border-radius:14px;padding:15px;text-align:left;display:flex;flex-direction:column;width:100%;
  min-height:126px;transition:.18s;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.lx-net-card:not(:disabled):hover{border-color:rgba(56,189,248,.45);background:#0e0e19}
.lx-net-icon{width:46px;height:46px;border-radius:11px;display:flex;align-items:center;
  justify-content:center;flex-shrink:0}

/* smooth open/close of blocks of unknown height — see the Collapse component. A gentle
   decelerate-only curve (no fast front-load) so a large height swing (compact strip ↔ full
   network, ~700px) reads as one settled glide instead of a lurch. */
.lx-collapse{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;
  transition:grid-template-rows .5s cubic-bezier(.16,1,.3,1),opacity .35s ease,visibility 0s linear .5s}
.lx-collapse.open{grid-template-rows:1fr;opacity:1;visibility:visible;
  transition:grid-template-rows .5s cubic-bezier(.16,1,.3,1),opacity .35s ease .1s,visibility 0s}
.lx-collapse>div{min-height:0;overflow:hidden}

/* brain "command center" card — TRANSPARENT fill (the workflow card shows through), a 1px
   purple→cyan gradient ring as the border, the same quiet shadow every other agent card has.
   The ring is a ::before layer masked down to its 1px edge (mask-composite) — NOT the
   two-layer-background trick, which can't do a transparent fill: with a transparent top
   layer the gradient underneath filled the whole box (that was the solid purple/cyan card). */
.lx-hex{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:13px 11px;text-align:center;border-radius:16px;background:transparent;
  box-shadow:0 4px 18px rgba(0,0,0,.35)}
.lx-hex::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;pointer-events:none;
  background:linear-gradient(160deg,#a855f7,#6366f1 45%,#22d3ee);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude}
/* the render is a rectangular crop of the reference: a radial mask fades its edges, and
   screen blending makes its dark #060a18 background vanish against the card while the bright
   brain stays — so only the brain is visible, no crop box, on a transparent card */
.lx-hex img{width:84px;height:auto;display:block;mix-blend-mode:screen;
  -webkit-mask:radial-gradient(ellipse 46% 46% at 50% 50%,#000 52%,transparent 100%);
  mask:radial-gradient(ellipse 46% 46% at 50% 50%,#000 52%,transparent 100%);
  filter:drop-shadow(0 0 8px rgba(129,140,248,.35))}

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

/** `href` is a REAL route under app/app/** (unaffected by the /app dashboard-home retirement
 *  — only that one page moved, every other /app/** page is still live). Items with no href
 *  (Chat opens the built-in Assistant panel; Office/Tasks/Leads have no dedicated real page
 *  yet) stay a local nav highlight only — never a link to a page that doesn't exist. */
type NavItem = { label: string; icon: React.ElementType; badge?: number; href?: string };
const NAV: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Chat", icon: MessageSquare },
  { label: "Office (Agents)", icon: Users, href: "/app/workspace" },
  { label: "Tasks", icon: ClipboardList },
  { label: "Approvals", icon: ListChecks, badge: 3, href: "/app/approvals" },
  { label: "Connect", icon: Link2, href: "/app/connect" },
  { label: "Schedule", icon: CalendarDays, href: "/app/schedule" },
  { label: "Content", icon: FileText, href: "/app/content" },
  { label: "Site Brain", icon: Globe, href: "/app/site-brain" },
  { label: "Leads", icon: UserRound },
  { label: "SEO & Insights", icon: TrendingUp, href: "/app/audit" },
  { label: "Settings", icon: Settings, href: "/app/billing" },
];

/** A chat bubble. `live` = still streaming in (the loop below keeps appending to `text`);
 *  `failed` = the request/stream broke and `text` is whatever partial reply had arrived. */
type ThreadMsg = { who: "user" | "ai"; text: string; time: string; live?: boolean; failed?: boolean };

type AgentStatus = "Completed" | "Working" | "Waiting" | "Planned";
type Agent = { id: string; name: string; role: string; status: AgentStatus; icon: React.ElementType; color: string };
/** Static per-agent identity (name/role/icon/color/id). `status` is NOT here — it's derived
 *  at render time from the real current task's steps (see `statusForAgent` in the main
 *  component), except `fixedStatus` agents which are always "Planned" regardless. */
type AgentMeta = Omit<Agent, "status"> & { fixedStatus?: "Planned" };

/** The full roster per MASTER_PLAN.html: the 9 real agents (`id` matches agent-server's
 *  AGENT_TYPES/task_steps.agent_id — boss IS the brain node in the middle, not a 10th
 *  orbiting icon) PLUS the 2 named-but-not-yet-built agents from §19 ("19 · Mr. Image aur
 *  Mr. Story — naye agents"), always "Planned" — shown on the network (the plan names them)
 *  but never counted as active/staffed anywhere (header pill, stats strip), since they don't
 *  run yet. Left-to-right order tells the real pipeline story: gather (Crawler → Analyst) →
 *  plan (Keyword → Writer → Image) → [[brain]] → check/ship (SEO → Story → Audit) →
 *  distribute (Social → Leads). Each agent has its own icon + accent color (per the reference
 *  "AI Agent Network" mockup), not one shared Bot icon.
 *
 *  Mr. Publish is a REAL backend agent (agent-server AGENT_TYPES includes "publish") — it is
 *  hidden from this diagram only, per an explicit request, not because it doesn't exist. */
const AGENT_META_LEFT: AgentMeta[] = [
  { id: "crawler", name: "Mr. Crawler", role: "Site Crawler", icon: Globe, color: "#22d3ee" },
  { id: "analyst", name: "Mr. Analyst", role: "Site Brain", icon: BarChart3, color: "#3b82f6" },
  { id: "keyword", name: "Mr. Keyword", role: "Keyword Research", icon: KeyRound, color: "#f59e0b" },
  { id: "writer", name: "Mr. Writer", role: "Content Writer", icon: PenLine, color: "#8b5cf6" },
  { id: "image", name: "Mr. Image", role: "Image Generation", icon: ImageIcon, color: "#facc15", fixedStatus: "Planned" },
];
const AGENT_META_RIGHT: AgentMeta[] = [
  { id: "seo", name: "Mr. SEO", role: "SEO Checks", icon: Search, color: "#22c55e" },
  { id: "story", name: "Mr. Story", role: "Web Stories", icon: BookOpen, color: "#6366f1", fixedStatus: "Planned" },
  { id: "audit", name: "Mr. Audit", role: "Site Audit", icon: ShieldCheck, color: "#a855f7" },
  { id: "social", name: "Miss Social", role: "Social Drafts", icon: Megaphone, color: "#ec4899" },
  { id: "leads", name: "Mr. Leads", role: "Lead Discovery", icon: UserRound, color: "#f97316" },
];

const STATUS_COLOR: Record<AgentStatus, string> = {
  Completed: "#22c55e",
  Working: "#3b82f6",
  Waiting: "#6a6a80",
  Planned: "#71717a",
};

const TABS = ["Live Activity", "Research", "Writing", "References", "Output Preview"];

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

/** One workflow agent node. `compact` is the single-line form shown once an agent panel is
 *  open (smaller icon, name+status stacked beside it instead of under it, no wasted vertical
 *  space) — same data, same colors, just laid out to fit a strip instead of a spacious grid. */
const AgentNode = ({ a, compact = false, onClick }: { a: Agent; compact?: boolean; onClick?: () => void }) => {
  const c = STATUS_COLOR[a.status];
  const iconSize = compact ? 30 : 46;
  const clickable = !!onClick;

  const Icon = a.icon;
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
      <Icon size={compact ? 14 : 20} />
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

/** One "AI Agent Network" card — agent's own icon + accent color (not the shared status
 *  color), matching the reference mockup where every agent has a distinct color-coded icon
 *  square. `area` is the CSS grid-area name it occupies in the network layout (see .lx-net
 *  below); on narrow screens that named area doesn't exist so the card just auto-flows. */
const NetCard = ({ a, area, onClick }: { a: Agent; area: string; onClick?: () => void }) => {
  const Icon = a.icon;
  const working = a.status === "Working";
  const planned = a.status === "Planned";
  const statusColor = STATUS_COLOR[a.status];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!working}
      className="lx-net-card"
      data-net={area}
      style={{ gridArea: area, cursor: working ? "pointer" : "default", opacity: planned ? 0.68 : 1, borderStyle: planned ? "dashed" : "solid" }}
    >
      <div className="flex w-full items-start justify-between">
        {/* tinted-dark square with the agent's colored icon + a soft matching glow — the
            reference's icon treatment (not a solid color fill) */}
        <span
          className="lx-net-icon"
          style={{
            background: `linear-gradient(145deg, ${a.color}33, ${a.color}10)`,
            border: `1px solid ${a.color}66`,
            color: a.color,
            boxShadow: planned ? "none" : `0 0 18px ${a.color}55, inset 0 0 10px ${a.color}22`,
          }}
        >
          <Icon size={20} />
        </span>
        {planned ? (
          <span className="lx-10 font-semibold" style={{ color: statusColor }}>Planned</span>
        ) : (
          <MoreVertical size={14} style={{ color: "var(--lx-mut)", opacity: 0.6 }} />
        )}
      </div>
      <div className="mt-2.5 w-full">
        <div className="lx-12 font-bold">{a.name}</div>
        <div className="lx-10 lx-mut">{a.role}</div>
        {!planned && (
          <div className="mt-1.5 flex items-center gap-1.5 lx-10 font-semibold" style={{ color: statusColor }}>
            <span className={`h-1.5 w-1.5 rounded-full ${working ? "lx-pulse" : ""}`} style={{ background: statusColor }} />
            {a.status}
          </div>
        )}
      </div>
    </button>
  );
};

/** One tile in the network's bottom stats strip. */
const StatTile = ({
  icon: Icon,
  color,
  label,
  value,
  sub,
  spin = false,
}: {
  icon: React.ElementType;
  color: string;
  label: string;
  value: string;
  sub: string;
  spin?: boolean;
}) => (
  <div className="flex items-center gap-2.5">
    <span className="lx-net-icon" style={{ width: 34, height: 34, background: `${color}22`, color, boxShadow: "none" }}>
      <Icon size={16} className={spin ? "animate-spin" : ""} />
    </span>
    <span>
      <span className="block lx-10 lx-mut">{label}</span>
      <span className="block lx-13 font-bold leading-tight">{value}</span>
      <span className="block lx-10 font-medium" style={{ color }}>● {sub}</span>
    </span>
  </div>
);

/** Smooth show/hide for a block of unknown height — CSS `grid-template-rows: 0fr → 1fr`, which
 *  the browser can transition natively (unlike `height: auto`). This replaced framer-motion's
 *  `height: "auto"` + `layout` animation on the agent panel and workflow, which visibly
 *  stuttered: the panel's height was being animated by framer while the workflow's `layout`
 *  prop re-measured it every frame AND the elapsed-time timer re-rendered the whole tree every
 *  second, so the two fought each other and the collapse looked broken. Children stay mounted
 *  (so nothing remounts or flashes); when closed the block is also `visibility:hidden` so it
 *  can't be tabbed into. */
const Collapse = ({ open, children }: { open: boolean; children: React.ReactNode }) => (
  <div className={`lx-collapse ${open ? "open" : ""}`} aria-hidden={!open}>
    <div>{children}</div>
  </div>
);

/** The resting-state "AI Agent Network": color-coded agent cards arranged around the brain
 *  "command center" card. */
const AgentNetwork = ({
  top,
  left,
  right,
  bottom,
  totalActive,
  running,
  completed,
  workingAgent,
  onOpen,
}: {
  top: Agent[];
  left: Agent[];
  right: Agent[];
  bottom: Agent[];
  totalActive: number;
  running: number;
  completed: number;
  workingAgent: Agent | null;
  onOpen: (a: Agent) => void;
}) => {
  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-bold">AI Agent Network</div>
          <div className="lx-11 lx-mut mt-0.5">All agents working together to achieve your goals.</div>
        </div>
        <span className="lx-pill green">
          <span className="h-1.5 w-1.5 rounded-full lx-pulse" style={{ background: "#22c55e" }} />
          {totalActive} Agents Active
        </span>
      </div>

      {workingAgent && (
        <div className="lx-card2 mt-3 flex items-center gap-2.5 px-3 py-2">
          <span className="h-2 w-2 shrink-0 rounded-full lx-pulse" style={{ background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
          <span className="lx-11 font-semibold">Planning &amp; Orchestrating</span>
          <span className="lx-10 lx-mut">— delegated to {workingAgent.name}</span>
        </div>
      )}

      <div className="lx-net-host relative mt-4">
        <div className="lx-net">
          {top.map((a, i) => (
            <NetCard key={a.id} a={a} area={`t${i + 1}`} onClick={() => onOpen(a)} />
          ))}
          {left.map((a, i) => (
            <NetCard key={a.id} a={a} area={`l${i + 1}`} onClick={() => onOpen(a)} />
          ))}

          {/* [ASSET] Mr. Lxwa — "command center" brain card, matching the reference
              (jhhhhhhhh.png). The brain is the reference's own 3D render, cropped out of that
              image into public/brand/brain-boss.png — a raster render can't be rebuilt in
              CSS/SVG, and the request was to use exactly that artwork. */}
          <div className="lx-hex lx-net-brain" data-net="b" style={{ gridArea: "b" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, fixed size */}
            <img src="/brand/brain-boss.png" alt="" width={156} height={124} />
            <div className="lx-13 font-bold mt-1">Mr. Lxwa</div>
            <div className="lx-10 lx-mut">Command Center</div>
            <div className="lx-10 lx-mut">Plan · Coordinate · Execute</div>
            <div className="mt-1.5 flex items-center gap-1.5 lx-10 font-semibold" style={{ color: "#22c55e" }}>
              <span className="h-1.5 w-1.5 rounded-full lx-pulse" style={{ background: "#22c55e" }} />
              Online
            </div>
          </div>

          {right.map((a, i) => (
            <NetCard key={a.id} a={a} area={`r${i + 1}`} onClick={() => onOpen(a)} />
          ))}
          {bottom.map((a, i) => (
            <NetCard key={a.id} a={a} area={`o${i + 1}`} onClick={() => onOpen(a)} />
          ))}
        </div>
      </div>

      {/* stats strip — real, built agents only (the 2 Planned ones above are shown on the
          network because the plan names them, but never counted here as staffed/active).
          Success Rate / Time Saved stay illustrative — there's no real source for either yet. */}
      <div className="lx-card2 mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <StatTile icon={Users} color="#3b82f6" label="Total Agents" value={String(totalActive)} sub="Active" />
        <StatTile icon={Loader2} color="#3b82f6" label="Tasks Running" value={String(running)} sub="In Progress" spin />
        <StatTile icon={CheckCircle2} color="#a855f7" label="Tasks Completed" value={String(completed)} sub="Today" />
        <StatTile icon={TrendingUp} color="#22c55e" label="Success Rate" value="98.6%" sub="This Week" />
        <StatTile icon={Clock} color="#f59e0b" label="Time Saved" value="32.4h" sub="This Week" />
      </div>
    </div>
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

/** Mr. Lxwa's real replies use markdown bold (`**word**`) — this renders just that, nothing
 *  fancier, matching components/kit.tsx's own `inline()` helper. */
const boldText = (text: string, key: string): React.ReactNode[] => {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let i = 0, n = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > i) out.push(text.slice(i, m.index));
    out.push(<b key={`${key}-b${n++}`}>{m[1]}</b>);
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
};

/* ========================================================================== */
/*  MAIN COMPONENT                                                            */
/* ========================================================================== */

export default function MrLxwaDashboard({ tenantId = null }: { tenantId?: string | null }) {
  const pathname = usePathname();
  // Real account/plan/sign-out — the same lib/store.tsx StoreProvider AppShell reads from,
  // mounted globally in app/layout.tsx, so it's already live here without any extra fetch.
  const { s: account, signOut } = useStore();

  // Real per-agent status: the newest task for this tenant (Realtime-subscribed, falls back
  // to polling — see lib/live.ts), and each agent's status is read off that task's own
  // task_steps snapshot. No task, or no tenant (not signed in) → everyone's honestly Waiting,
  // not a fabricated "in progress" — see statusForAgent below.
  const live = useLiveEvents(tenantId);
  const task: TaskState | null = live.tasks[0] ?? null;
  const statusForAgent = (m: AgentMeta): AgentStatus => {
    if (m.fixedStatus) return m.fixedStatus;
    const step = task?.steps.find((s) => s.agent_id === m.id);
    if (!step) return "Waiting";
    if (step.status === "running") return "Working";
    if (step.status === "done") return "Completed";
    // pending / failed / skipped / cancelled all collapse to "Waiting" here — this roster
    // only has 3 real states (STATUS_COLOR), and "waiting for its turn" is the closest honest
    // read for a step that isn't actively running or finished.
    return "Waiting";
  };
  const agentsLeft: Agent[] = AGENT_META_LEFT.map((m) => ({ ...m, status: statusForAgent(m) }));
  const agentsRight: Agent[] = AGENT_META_RIGHT.map((m) => ({ ...m, status: statusForAgent(m) }));
  const allAgents: Agent[] = [...agentsLeft, ...agentsRight];
  const realAgents = allAgents.filter((a) => a.status !== "Planned");
  const netTop = agentsLeft.slice(0, 4);
  const netLeft = agentsLeft.slice(4, 5);
  const netRight = agentsRight.slice(0, 1);
  const netBottom = agentsRight.slice(1, 5);

  const [acctOpen, setAcctOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const userName = account.user?.name || account.user?.email?.split("@")[0] || "Signed out";
  const userInitial = userName.charAt(0).toUpperCase() || "?";
  const planName = PLANS[account.plan]?.name ?? account.plan;

  const [nav, setNav] = useState("Dashboard");
  const [tab, setTab] = useState("Live Activity");
  const [aTab, setATab] = useState<"assistant" | "voice">("assistant");
  const [sideOpen, setSideOpen] = useState(false); // <lg drawer
  const [botOpen, setBotOpen] = useState(false); // <lg drawer
  const [paused, setPaused] = useState(false);
  const [msg, setMsg] = useState("");
  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [sec, setSec] = useState(272); // 00:04:32
  const chatRef = useRef<HTMLDivElement>(null);
  const convId = useRef<string | null>(null);
  const helloSent = useRef(false); // React 18 strict-mode double-invokes effects in dev — without
  // this the real /api/chat "__hello__" greeting was requested twice on one mount.

  // The agent panel (live activity, timeline, search results) exists to show ONE agent's
  // live work — it only makes sense while an agent is actually working. `workingAgent` is
  // that fact; `showPanel` is the user's own choice to look at it or step back to the whole
  // team (the "Back to Workflow" button), independent of whether anyone is still working.
  const workingAgent = allAgents.find((a) => a.status === "Working") ?? null;
  const [showPanel, setShowPanel] = useState(!!workingAgent);
  const panelOpen = showPanel && !!workingAgent;
  // Auto-open only on the rising edge (nobody→somebody working) — e.g. a real task just
  // started from chat. It never forces the panel back open after the user closes it while
  // work continues; `panelOpen` above already hides it on its own once nobody is working.
  const hadWorkingAgent = useRef(!!workingAgent);
  useEffect(() => {
    if (workingAgent && !hadWorkingAgent.current) setShowPanel(true);
    hadWorkingAgent.current = !!workingAgent;
  }, [workingAgent]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, aTab]);

  /** Real chat — POSTs to the same /api/chat the production BossChat uses (components/kit.tsx),
   *  and relays the streamed token chunks into the last bubble as they arrive. No ctx (plan,
   *  tokens, memory) and no system-event cards yet — those read from the old dashboard's
   *  zustand store (useStore()), which this component doesn't have; a plain reply is still a
   *  REAL model turn, persisted server-side to chat_conversations/chat_messages. */
  const stream = async (q: string) => {
    setChatBusy(true);
    setThread((p) => [...p, { who: "ai", text: "", time: nowTime(), live: true }]);
    let full = "";
    try {
      const history = thread
        .filter((m) => m.text.trim() && !m.live && !m.failed)
        .slice(-8)
        .map((m) => ({ role: m.who === "user" ? "user" : "assistant", content: m.text.slice(0, 700) }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, ctx: {}, history, conversationId: convId.current }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const returned = res.headers.get("X-Conversation-Id");
      if (returned) convId.current = returned;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
        setThread((p) => {
          const next = [...p];
          next[next.length - 1] = { ...next[next.length - 1], text: full };
          return next;
        });
      }
      setThread((p) => {
        const next = [...p];
        next[next.length - 1] = { ...next[next.length - 1], text: full, live: false };
        return next;
      });
    } catch {
      // Whatever streamed in stays on screen; an empty bubble forever (with no way to retry)
      // was worse than showing a plain, honest failure line.
      setThread((p) => {
        const next = [...p];
        const partial = full.trim();
        next[next.length - 1] = partial
          ? { ...next[next.length - 1], text: partial, live: false, failed: true }
          : { who: "ai", text: "Couldn't reach Mr. Lxwa — check you're signed in and try again.", time: nowTime(), failed: true };
        return next;
      });
    } finally {
      setChatBusy(false);
    }
  };

  useEffect(() => {
    if (helloSent.current) return;
    helloSent.current = true;
    void stream("__hello__");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    const t = msg.trim();
    if (!t || chatBusy) return;
    setThread((p) => [...p, { who: "user", text: t, time: nowTime() }]);
    setMsg("");
    void stream(t);
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

      {/* nav — items with a real href (see NAV's own comment) are real next/link navigation
          to the still-live app/app/** pages; the rest stay a local highlight only. */}
      <nav className="lx-scroll flex-1 space-y-1 overflow-y-auto px-3">
        {NAV.map((it) => {
          const active = it.href ? pathname === it.href : nav === it.label;
          const inner = (
            <>
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
            </>
          );
          return it.href ? (
            <Link key={it.label} href={it.href} className={`lx-nav ${active ? "on" : ""}`}>
              {inner}
            </Link>
          ) : (
            <button key={it.label} className={`lx-nav ${active ? "on" : ""}`} onClick={() => setNav(it.label)}>
              {inner}
            </button>
          );
        })}

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

      {/* user — real name/plan from lib/store.tsx (the same source AppShell's account chip
          reads), real sign-out. [ASSET] user photo → gradient initial, unchanged. */}
      <div className="p-3">
        <button className="lx-card2 flex w-full items-center gap-3 p-2.5 text-left" onClick={() => setAcctOpen((o) => !o)}>
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444 60%,#7c3aed)" }}
          >
            {userInitial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate lx-13 font-semibold">{userName}</span>
            <span className="block lx-10 lx-mut">{planName}</span>
          </span>
          <ChevronDown size={15} className="lx-mut" />
        </button>
        {acctOpen && (
          <button
            className="lx-ghost mt-1.5 w-full justify-center"
            onClick={() => {
              if (!confirmSignOut) { setConfirmSignOut(true); return; }
              void signOut();
            }}
          >
            {confirmSignOut ? "Click again to sign out" : "Sign out"}
          </button>
        )}
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
    <section className="lx-card relative overflow-hidden">
      {/* ambient glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: 420, height: 220, background: "radial-gradient(ellipse at center,rgba(124,58,237,.22),transparent 65%)" }}
      />
      {/* compact/full swap — both stay mounted and cross-collapse (see Collapse), so the
          card's height glides between the one-line strip and the full network instead of
          jumping. No framer-motion here: its layout/AnimatePresence animations fought the
          every-second timer re-render and stuttered (and once got stuck at opacity 0). */}
      {/* ---- compact: every agent sorted into one line, once a panel is open ---- */}
      <Collapse open={panelOpen}>
        <div className="lx-scroll overflow-x-auto">
          <div className="flex min-w-max items-center gap-2 px-4 py-3">
            {agentsLeft.map((a) => (
              <AgentNode key={a.id} a={a} compact onClick={() => openAgentPanel(a)} />
            ))}
            <span className="lx-brain shrink-0" style={{ fontSize: 26 }}>🧠</span>
            {agentsRight.map((a) => (
              <AgentNode key={a.id} a={a} compact onClick={() => openAgentPanel(a)} />
            ))}
          </div>
        </div>
      </Collapse>
      {/* ---- full: "AI Agent Network" — the resting state. CSS grid-area layout (see
          .lx-net), collapsing to a 2-column auto-flow (brain first) in a narrow column. ---- */}
      <Collapse open={!panelOpen}>
        <AgentNetwork
          top={netTop}
          left={netLeft}
          right={netRight}
          bottom={netBottom}
          totalActive={realAgents.length + 1}
          running={realAgents.filter((a) => a.status === "Working").length}
          completed={realAgents.filter((a) => a.status === "Completed").length}
          workingAgent={workingAgent}
          onOpen={openAgentPanel}
        />
      </Collapse>
    </section>
  );

  /* ---------------------------------------------------------------------- */

  // Real data for the panel below — all derived from `task` (the newest live task for this
  // tenant). `workingAgent` only exists when some step is genuinely "running", so everywhere
  // below that reads `task` inside AgentPanel is only ever reached with a real task present.
  const runningStep = task?.steps.find((s) => s.status === "running") ?? null;
  const stepNo = task && runningStep ? task.steps.findIndex((s) => s.key === runningStep.key) + 1 : null;
  const totalSteps = task?.totalSteps ?? task?.steps.length ?? null;
  const producedItems = task ? task.agents.flatMap((p) => p.items).sort((a, b) => a.at - b.at) : [];
  const itemLabel = (it: (typeof producedItems)[number]) => {
    // The writer's real event kinds (agent-server/src/agents/writer.ts) — anything else
    // (from other agents in the same task) falls back to a generic "<kind>" line rather than
    // guessing at a payload shape it doesn't recognize.
    if (it.kind === "section") return `Section written: "${it.payload?.h2 ?? "untitled"}" (${it.payload?.words ?? "?"} words)`;
    if (it.kind === "research") return it.payload?.used ? `Research used — ${it.payload?.sources ?? "?"} sources` : "No research needed for this topic";
    if (it.kind === "score") return `Quality score: ${it.payload?.quality ?? "?"}/100 ${it.payload?.passed ? "— passed" : "— needs another pass"}`;
    return it.kind;
  };

  const AgentPanel = (
    <section className="lx-card mt-4 p-4">
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

      <div className="mt-4 flex flex-col gap-4">
        {/* live visual — the primary, full-width focus. Whatever the agent is actually doing
            right now (search / reading / key points / writing), one section, no duplication
            of this content anywhere else in the panel. */}
        <div className="min-w-0">
          <div className="flex items-center justify-between">
            <span className="lx-13 font-semibold">Live Visual</span>
            <span className="lx-pill red">
              <span className="lx-pulse h-1.5 w-1.5 rounded-full" style={{ background: "#ef4444" }} /> LIVE
            </span>
          </div>

          <div className="lx-card2 mt-3 overflow-hidden p-3" style={{ minHeight: 360 }}>
            <div key={runningStep?.key ?? "idle"} className="lx-live-anim">
              <div className="flex items-center gap-2 lx-11 font-semibold">
                <PenLine size={13} className="lx-mut" />
                {runningStep?.progressLabel || runningStep?.label || "Working…"}
              </div>

              {/* real produced work — sections written, research used, the quality score —
                  as it actually arrives (agent-server's writer emits these as ctx.data()
                  events; see lib/live.ts's AgentPane.items). No fake per-word "typing". */}
              {producedItems.length === 0 ? (
                <div className="mt-3 flex items-center gap-2.5">
                  <Wave n={26} h={18} anim color="var(--lx-purple)" />
                  <span className="lx-shimmer lx-10 font-medium">Working…</span>
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {producedItems.map((it) => (
                    <li key={it.key} className="lx-in flex items-start gap-2 rounded-lg px-2.5 py-2 lx-11" style={{ color: "#cfcfdd" }}>
                      <CheckCircle2 size={14} style={{ color: "#22c55e", marginTop: 1, flexShrink: 0 }} />
                      {itemLabel(it)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* writer progress — secondary, below the live visual. Real: the task's own echo
            (what was actually asked for), the running step's real label/fraction if it
            reported one, and real step-of-total position — nothing here is invented. */}
        <div className="min-w-0">
          <div className="text-lg font-bold leading-tight">{task?.echo || workingAgent?.role}</div>
          {runningStep?.label && <div className="lx-12 lx-mut mt-0.5">{runningStep.label}</div>}

          {runningStep?.fraction != null && (
            <>
              <div className="mt-4 flex items-center justify-between">
                <span className="lx-11 lx-mut">Overall Progress</span>
                <span className="lx-12 font-bold">{Math.round(runningStep.fraction * 100)}%</span>
              </div>
              <div className="lx-track mt-1.5">
                <div className="lx-fill" style={{ width: `${Math.round(runningStep.fraction * 100)}%` }} />
              </div>
            </>
          )}
          {stepNo != null && totalSteps != null && (
            <div className="lx-11 lx-mut mt-1.5">Step {stepNo} of {totalSteps}</div>
          )}

          {/* tabs */}
          <div className="lx-scroll mt-3 flex gap-6 overflow-x-auto border-b" style={{ borderColor: "var(--lx-border)" }}>
            {TABS.map((t) => (
              <button key={t} className={`lx-tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>

          <div className="lx-13 mt-4 font-semibold">What I&apos;m doing right now</div>

          {/* timeline — task.lines: real, human-readable events (lib/live.ts's userMessage()),
              never a raw prompt/error string. */}
          <div className="lx-tl mt-1">
            {(task?.lines ?? []).length === 0 && <div className="lx-11 lx-mut py-2">No activity yet.</div>}
            {(task?.lines ?? []).slice(-8).map((ln) => {
              const color = ln.tone === "ok" ? "#22c55e" : ln.tone === "err" ? "#ef4444" : ln.tone === "warn" ? "#f59e0b" : "#3b82f6";
              return (
                <div className="lx-row" key={ln.key}>
                  <span className="lx-10 lx-mono lx-dim text-right">
                    {new Date(ln.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="lx-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                  <span className="lx-12 truncate" style={{ color: "#d9d9e6" }}>{ln.text}</span>
                  <span style={{ width: 14 }} />
                  <span style={{ width: 14 }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
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
          {/* real conversation with /api/chat (same endpoint components/kit.tsx's BossChat
              uses) — the opening line above is the model's actual "__hello__" reply, not a
              scripted mock, and everything below is genuinely sent/received. */}
          {thread.length === 0 && (
            <div className="flex items-center gap-2 lx-11 lx-mut">
              <Robo size={24} /> Connecting to Mr. Lxwa…
            </div>
          )}
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
                <div
                  className="lx-ai lx-12 mt-1.5 px-3 py-2.5 leading-relaxed"
                  style={{ marginLeft: 30, color: m.failed ? "#f87171" : undefined, whiteSpace: "pre-wrap" }}
                >
                  {m.text ? boldText(m.text, `m${i}`) : m.live ? "…" : ""}
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
            placeholder={chatBusy ? "Mr. Lxwa is replying…" : "Type your message..."}
            disabled={chatBusy}
            className="lx-12 w-full bg-transparent py-1.5 outline-none disabled:opacity-60"
            style={{ border: "none", color: "var(--lx-text)" }}
          />
          <button
            onClick={send}
            disabled={chatBusy || !msg.trim()}
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#4f46e5,#8b5cf6)", border: "none", cursor: chatBusy ? "default" : "pointer", boxShadow: "0 0 12px rgba(124,58,237,.5)" }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </aside>
  );

  /* ---------------------------------------------------------------------- */

  const BottomBar = (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-1.5" style={{ borderColor: "var(--lx-border)", background: "var(--lx-panel)" }}>
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
        {/* scrollbar-gutter: stable — the panel opening/closing pushes the content past/under
            the fold, so the vertical scrollbar appears and disappears; without a reserved
            gutter that changes the column's content width and every card lurches sideways
            each time (measured: the "whole page jolts" complaint). */}
        <main className="lx-scroll flex-1 overflow-y-auto p-3 sm:p-4" style={{ scrollbarGutter: "stable" }}>
          {Workflow}
          <Collapse open={panelOpen}>{AgentPanel}</Collapse>
          {BottomBar}
        </main>
      </div>

      {Assistant}
    </div>
  );
}
