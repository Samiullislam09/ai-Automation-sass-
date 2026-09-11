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
import { LxGlobalStyle } from "@/components/lx-theme";
import { useLiveEvents, isTerminalTask, isTerminalStep, isFlowing, useNow, elapsedMs, clock, type TaskState } from "@/lib/live";
import { useStore, PLANS } from "@/lib/store";
import { startPolling } from "@/lib/poll";
import {
  LayoutDashboard,
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
  Send,
  Mic,
  History,
  MoreVertical,
  CheckCircle2,
  BookOpen,
  PenLine,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  BarChart3,
  KeyRound,
  Search,
  ShieldCheck,
  Megaphone,
  Loader2,
  Image as ImageIcon,
  BrainCircuit,
  ArrowRight,
  XCircle,
  User,
  LogOut,
  Star,
  Square,
  RotateCcw,
} from "lucide-react";

/* ========================================================================== */
/*  THEME / GLOBAL CSS                                                        */
/* ========================================================================== */

/* Moved to components/lx-theme.tsx (2026-08-29) — shared with any full-page view that wants
   the same dark theme without this sidebar shell (e.g. the Article Approval page). Aliased
   locally so the single `<GlobalStyle />` render below is unchanged. */
const GlobalStyle = LxGlobalStyle;

/* ========================================================================== */
/*  DATA (verbatim from the mockup)                                           */
/* ========================================================================== */

/** `href` is a real route under /dashboard/**, one per real feature the product actually has
 *  (MASTER_PLAN §7's agent roster + the pages built for them) — audited 2026-08-29 against a
 *  sidebar that had drifted from that: "Tasks" pointed at nothing (Office/Workspace already
 *  shows every live order, so a second entry for the same thing was clutter) and "Leads" was a
 *  dead click (the leads agent has written real rows to the `leads` table since 2026-08-27, but
 *  no page ever read them — see components/dashboard/LeadsSection.tsx's own header comment).
 *  Reports and Memory existed as real converted pages but were never linked from here either.
 *  Every remaining item with no href is a deliberate local action, not a missing page: Chat
 *  opens the built-in Assistant panel. Nothing still-planned (Mr. Image/Mr. Story, Mr. Support)
 *  gets a nav entry — they show as "Planned" in the agent network instead, same honesty rule. */
type NavItem = { label: string; icon: React.ElementType; badge?: number; href?: string };
const NAV: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Office (Agents)", icon: Users, href: "/dashboard/workspace" },
  { label: "Approvals", icon: ListChecks, href: "/dashboard/approvals" },
  { label: "Connect", icon: Link2, href: "/dashboard/connect" },
  { label: "Schedule", icon: CalendarDays, href: "/dashboard/schedule" },
  { label: "Content", icon: FileText, href: "/dashboard/content" },
  { label: "Leads", icon: UserRound, href: "/dashboard/leads" },
  { label: "Site Brain", icon: Globe, href: "/dashboard/site-brain" },
  { label: "Audit", icon: TrendingUp, href: "/dashboard/audit" },
  { label: "Reports", icon: ClipboardList, href: "/dashboard/reports" },
  { label: "Memory", icon: BrainCircuit, href: "/dashboard/memory" },
  { label: "Account", icon: Settings, href: "/dashboard/account" },
];

/** A chat bubble. `live` = still streaming in (the loop below keeps appending to `text`);
 *  `failed` = the request/stream broke and `text` is whatever partial reply had arrived. */
/** `taskId` marks a bubble as the ONE live-status line for that order — see the effect below
 *  that updates it in place as the task progresses, rather than a fresh "..." spinner the user
 *  has to guess the meaning of. */
type ThreadMsg = {
  who: "user" | "ai";
  text: string;
  time: string;
  live?: boolean;
  failed?: boolean;
  /** Set once a live, still-empty bubble has sat too long with no token — swaps the static
   *  "…" for an honest "still working" line. Without this a genuinely slow answer (shared
   *  NVIDIA rate limit contention, a cold model, etc.) looked identical to a frozen tab —
   *  found 2026-08-31 when a background re-embed job on the same NVIDIA account starved
   *  live chat's rpm and the bubble sat on "…" with no way to tell slow from dead. */
  slow?: boolean;
  taskId?: string;
  /** The one highlight from what the order produced (a keyword, a title) — rendered as a chip,
   *  because that is what it is; burying it in a sentence made a keyword read like prose. */
  chip?: string;
  /** A themed button under the bubble — opens that agent's Live Visual instead of pasting its
   *  whole output into the transcript. */
  cta?: { label: string; agentId?: string };
  /** The order's real plan, checklist-style — the SAME task.steps the collapsed strip above
   *  the composer reads, just rendered where the owner's reference mockup put it: inline in
   *  the reply, ticking live as each step's status changes. Never a separate, invented list —
   *  absent entirely until a real task_steps row exists for this order. */
  planSteps?: { label: string; status: string }[];
};

type AgentStatus = "Completed" | "Working" | "Waiting" | "Planned";
type Agent = { id: string; name: string; role: string; status: AgentStatus; icon: React.ElementType; color: string };
/** Static per-agent identity (name/role/icon/color/id). `status` is NOT here — it's derived
 *  at render time from the real current task's steps (see `statusForAgent` in the main
 *  component), except `fixedStatus` agents which are always "Planned" regardless. */
type AgentMeta = Omit<Agent, "status"> & { fixedStatus?: "Planned" };

/** The full roster per MASTER_PLAN.html: all 11 real agents (`id` matches agent-server's
 *  AGENT_TYPES/task_steps.agent_id — boss IS the brain node in the middle, not a 12th orbiting
 *  icon). Mr. Image and Mr. Story (§19) shipped 2026-09-05/06 and are staffed/counted like every
 *  other card now — no more "Planned" carve-out for them. Left-to-right order tells the real
 *  pipeline story: gather (Crawler → Analyst) →
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
  { id: "image", name: "Mr. Image", role: "Image Generation", icon: ImageIcon, color: "#facc15" },
];
const AGENT_META_RIGHT: AgentMeta[] = [
  { id: "seo", name: "Mr. SEO", role: "SEO Checks", icon: Search, color: "#22c55e" },
  { id: "story", name: "Mr. Story", role: "Web Stories", icon: BookOpen, color: "#6366f1" },
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
        data-agent-id={a.id}
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
      // Only a "Planned" agent is inert — it has no implementation, so it has nothing to show.
      // Every real agent is clickable whatever its status: the whole point is being able to ask
      // an idle or finished agent "what did you do?", not just watch the one mid-run.
      disabled={planned}
      className={`lx-net-card ${working ? "lx-net-card-working" : ""}`}
      data-net={area}
      data-agent-id={a.id}
      title={planned ? `${a.name} is not built yet` : `See what ${a.name} is doing`}
      style={{
        gridArea: area,
        cursor: planned ? "default" : "pointer",
        opacity: planned ? 0.68 : 1,
        borderStyle: planned ? "dashed" : "solid",
        borderColor: working ? `${a.color}bb` : undefined,
        boxShadow: working ? `0 0 22px ${a.color}40, 0 4px 18px rgba(0,0,0,.35)` : undefined,
      }}
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
            {a.status === "Completed" ? (
              <CheckCircle2 size={12} style={{ flexShrink: 0 }} />
            ) : (
              <span className={`h-1.5 w-1.5 rounded-full ${working ? "lx-pulse" : ""}`} style={{ background: statusColor }} />
            )}
            {a.status}
          </div>
        )}
      </div>
    </button>
  );
};

/** The one short name for a produced item, whatever kind it is.
 *
 *  Agents send different payload shapes (`keyword`, `h2`, `title`, `name`, `topic`, `url`), and
 *  this file must not learn a list of them per agent — an image or a lead agent added tomorrow
 *  has to describe itself with no change here. First field that exists wins; nothing invented. */
const itemHeadline = (payload: any): string | null => {
  for (const field of ["keyword", "title", "h2", "name", "topic", "query", "url"]) {
    const v = payload?.[field];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

/** Plural without a lookup table: "keyword" → "keywords", "section" → "sections". Kinds are
 *  lowercase single words by convention (see AgentContext.data's own doc), so this is enough. */
const plural = (kind: string, n: number) => (n === 1 ? kind : kind.endsWith("s") ? kind : `${kind}s`);

/** A clean, human title for a task — NOT `task.echo`, which is a confirmation SENTENCE built
 *  for a different job (lib/chat-brain-intent.ts's `echoLine()`: "analyse my site · abhi ·
 *  Approvals me" — the phrase, the subject, when, and where it lands, joined for someone
 *  confirming an order). That sentence read as a page heading like it was debug output — the
 *  owner's own words, 2026-09-04: "professional title dena hai ki title padhke user samajh
 *  jaaye". `task.kind` is the real action id this task was created for (agent-server's
 *  orchestrator.ts: `kind: intent.action`) — a small, known, stable set (13 actions today) —
 *  so this maps each to the title a person would actually want, with the real subject (pulled
 *  from `echo`'s own quoted phrase, never re-invented) folded in where it matters. An action id
 *  not yet in the map (a new agent registers, this file hasn't been updated) never breaks: it
 *  falls back to the echo's own first segment, capitalised — still real, just not tailored. */
const TASK_TITLES: Record<string, (subject: string | null) => string> = {
  crawl_site: () => "Crawling Your Site",
  build_site_profile: () => "Site Analysis",
  plan_topics: () => "Planning Your Content",
  pick_topic: () => "Choosing Your Next Topic",
  find_keywords: (s) => (s ? `Keyword Research: ${s}` : "Keyword Research"),
  write_article: (s) => (s ? `Writing: ${s}` : "Writing Your Article"),
  research_brief: (s) => (s ? `Research: ${s}` : "Research Brief"),
  check_seo: () => "SEO Check",
  publish_article: () => "Publishing Your Article",
  audit_site: () => "Site Audit",
  draft_social: () => "Social Post Draft",
  find_leads: () => "Finding Leads",
};

function taskTitle(task: { kind?: string | null; echo?: string | null } | null | undefined): string {
  if (!task) return "Task";
  const subject = task.echo ? (task.echo.match(/"([^"]+)"/)?.[1] ?? null) : null;
  const known = task.kind ? TASK_TITLES[task.kind] : undefined;
  if (known) return known(subject);
  // Fallback only, for a kind this map doesn't know yet — echoLine (lib/chat-brain-intent.ts)
  // writes full sentences now ("Keyword research for "X". Starting now…"), so the first clause
  // is everything up to the first ". ", not the old " · "-joined format.
  const firstSegment = task.echo?.split(/\.\s/)[0]?.trim();
  return firstSegment ? firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1) : "Task";
}

/** What an order produced, in ONE line plus one highlight — derived from whatever kinds the
 *  agents actually emitted. Keyword runs, article runs, image runs and lead runs all describe
 *  themselves through this without the chat learning any of their names. */
function summariseProduced(items: { kind: string; payload: any; agent_id: string }[]) {
  if (!items.length) return null;
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const g = groups.get(it.kind) ?? [];
    g.push(it);
    groups.set(it.kind, g);
  }
  // The biggest group is what the order was really about; ties keep first-seen order.
  let best: { kind: string; list: typeof items } | null = null;
  for (const [kind, list] of Array.from(groups.entries())) {
    if (!best || list.length > best.list.length) best = { kind, list };
  }
  if (!best) return null;
  return {
    kind: best.kind,
    count: best.list.length,
    headline: itemHeadline(best.list[0]?.payload),
    agentId: best.list[0]?.agent_id ?? null,
  };
}

/** Mr. Keyword's live screen, in the two states §24.4b asks for.
 *
 *  WHILE RUNNING — a Google-style search box with the real topic in it and the keywords
 *  appearing underneath as suggestion rows, one per `ctx.data("keyword", …)` event. It looks
 *  like the thing it is doing, which is the whole point of §24 ("jaise YouTube video — agent
 *  keyword nikal raha hai to exactly visible ho"). It is NOT a fake typing animation: every row
 *  is a real event that already arrived (§24.5 — "animation sirf event pe chale").
 *
 *  WHEN FINISHED — the same rows as a real table with the columns the agent actually sends
 *  (agent-server/src/agents/keyword.ts keeps volume / competition / fit as three separate
 *  fields on purpose, and the plan forbids blending them), plus a per-row button that orders
 *  the article for that keyword. */
const KeywordScreen = ({
  items,
  topic,
  running,
  onWriteArticle,
}: {
  items: { key: string; payload: any }[];
  topic: string | null;
  running: boolean;
  onWriteArticle: (keyword: string) => void;
}) => {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  // Where each row's own number came from — real metadata agents/keyword.ts already tags
  // every item with (`source`), turned into words instead of a wire value nobody typed.
  const SOURCE_LABEL: Record<string, string> = {
    dataforseo: "DataForSEO",
    gsc: "your Search Console",
    autocomplete: "Google Autocomplete",
    ai: "AI estimate",
  };
  const dotColor = (level: unknown) =>
    level === "low" ? "#4ade80" : level === "medium" ? "#fbbf24" : level === "high" ? "#f87171" : "#5b5b72";

  if (running) {
    return (
      <div className="lx-serp">
        {/* A real Google wordmark (four brand colors, no icon standing in for it) plus the
            actual results tabs Google itself shows — static chrome, same on every run, never
            claiming a number Google didn't give us. Owner, 2026-09-12: "iska ui real google
            search engine jaisa karo". */}
        <div className="lx-serp-brand">
          <span className="lx-g">
            <span style={{ color: "#4285F4" }}>G</span>
            <span style={{ color: "#EA4335" }}>o</span>
            <span style={{ color: "#FBBC05" }}>o</span>
            <span style={{ color: "#4285F4" }}>g</span>
            <span style={{ color: "#34A853" }}>l</span>
            <span style={{ color: "#EA4335" }}>e</span>
          </span>
        </div>
        {/* the search box — real topic, never a placeholder, with a typing caret so an idle
            moment (before the first keyword lands) still reads as "searching" rather than
            frozen. */}
        <div className="lx-serp-bar">
          <Search size={14} className="lx-mut shrink-0" />
          <span className="lx-12 min-w-0 flex-1 truncate">
            {topic || "…"}
            <span className="lx-serp-caret" />
          </span>
          <Mic size={13} className="lx-dim shrink-0" />
        </div>
        <div className="lx-serp-tabs">
          {["All", "Images", "News", "Shopping"].map((t, i) => (
            <span key={t} className={i === 0 ? "on" : undefined}>{t}</span>
          ))}
        </div>
        <div className="lx-serp-meta">
          {items.length === 0 ? "Searching…" : `About ${items.length} keyword idea${items.length === 1 ? "" : "s"} found`}
        </div>
        <div>
          {items.map((it) => {
            const p = it.payload ?? {};
            const vol = num(p.searchVolume);
            const bits = [
              p.gsc ? "already ranking on your site" : null,
              vol != null ? `${vol}/mo` : "volume not measured",
              p.competitionLevel ? `${p.competitionLevel} competition` : null,
            ].filter(Boolean);
            return (
              <div key={it.key} className="lx-live-anim lx-serp-row">
                <span className="lx-serp-fav" style={{ background: dotColor(p.competitionLevel) }} />
                <div className="min-w-0 flex-1">
                  {/* Same visual slot a real SERP's URL breadcrumb sits in — but since there is no
                      real URL for a keyword idea, honest content goes there instead: where the
                      number itself came from (agents/keyword.ts's own `source` tag). */}
                  <div className="lx-serp-crumb truncate">
                    Keyword Research{p.source && SOURCE_LABEL[p.source] ? ` › ${SOURCE_LABEL[p.source]}` : ""}
                  </div>
                  <div className="lx-serp-title truncate">{p.keyword ?? "?"}</div>
                  <div className="lx-serp-desc truncate">{bits.join(" · ")}</div>
                </div>
              </div>
            );
          })}
        </div>
        {items.length > 0 && (
          <div className="lx-serp-foot">
            <div className="lx-track" style={{ flex: 1 }}>
              <div className="lx-serp-scan" />
            </div>
            Scanning search data…
          </div>
        )}
      </div>
    );
  }

  return <KeywordOpportunities items={items} onWriteArticle={onWriteArticle} />;
};

/** The finished keyword table, laid out to the owner's reference mockup (2026-09-10): a titled
 *  card of rows — keyword, then compact cells, then one "Use" action — with the best-fit row
 *  highlighted and everything past five rows behind "View more". The mockup also drew Intent,
 *  Trend and CPC columns; agents/keyword.ts sends none of those, and inventing them would break
 *  the one rule this panel lives by (real fields only), so the columns here are exactly what the
 *  agent measured: source, volume, competition, fit. Shown as a real card layout rather than a
 *  bare <table> so it reads the same on the phone (narrow columns collapse via .hide-sm). */
const KeywordOpportunities = ({
  items,
  onWriteArticle,
}: {
  items: { key: string; payload: any }[];
  onWriteArticle: (keyword: string) => void;
}) => {
  const [showAll, setShowAll] = useState(false);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const SOURCE_SHORT: Record<string, string> = {
    dataforseo: "DataForSEO",
    gsc: "Search Console",
    autocomplete: "Autocomplete",
    ai: "AI estimate",
  };
  const fmtVol = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(v));
  const compColor = (level: unknown) =>
    level === "low" ? "#4ade80" : level === "medium" ? "#fbbf24" : level === "high" ? "#f87171" : undefined;
  const compLabel = (level: unknown) =>
    level === "low" ? "Low" : level === "medium" ? "Med" : level === "high" ? "High" : "—";
  const fitColor = (pct: number) => (pct >= 50 ? "#4ade80" : pct >= 35 ? "#fbbf24" : "#8b8ba0");

  if (items.length === 0) return <div className="lx-10 lx-mut px-1 py-2">No keywords were produced.</div>;

  // Best-fit row first only for the highlight decision — the list itself keeps the agent's own
  // order, which is already ranked (agents/keyword.ts sorts by measured volume, then fit).
  let bestKey: string | null = null;
  let bestFit = -1;
  for (const it of items) {
    const f = num(it.payload?.fitScore);
    if (f != null && f > bestFit) { bestFit = f; bestKey = it.key; }
  }
  if (bestKey == null && items.length) bestKey = items[0].key;

  const LIMIT = 5;
  const visible = showAll ? items : items.slice(0, LIMIT);

  return (
    <div className="lx-kwo">
      <div className="lx-kwo-head">
        <span className="lx-kwo-title">Keyword opportunities</span>
        <span className="lx-kwo-count">{items.length} found</span>
      </div>
      {/* Two measured columns only (owner, 2026-09-11: "keyword pe sirf abhi ke liye Volume and
          Intent do"). Source and Competition were dropped — and that also FIXES a real bug they
          caused: six fixed tracks plus gaps needed ~458px before the keyword's own `minmax(0,1fr)`
          track got any width at all, so in a narrow canvas it collapsed to 0 and the phrase
          itself rendered invisibly (the `overflow:hidden` on .lx-kwo-text makes its automatic
          minimum size 0) while the marker, being flex-shrink:0, still painted. That is exactly
          the "keyword show nahi hota" the owner reported. There is no Intent column because
          agents/keyword.ts does not measure intent — it measures volume, competition and fit —
          and a column of guesses is worse than one honest column fewer. */}
      <div className="lx-kwo-grid lx-kwo-th">
        <span>Keyword</span>
        <span className="hide-sm">Volume</span>
        <span className="hide-sm">Fit</span>
        <span>Action</span>
      </div>
      {visible.map((it) => {
        const p = it.payload ?? {};
        const vol = num(p.searchVolume);
        const fit = num(p.fitScore);
        const fitPct = fit != null ? Math.round(fit * 100) : null;
        const best = it.key === bestKey;
        return (
          <div key={it.key} className={`lx-kwo-grid lx-kwo-row${best ? " best" : ""}`}>
            <div className="lx-kwo-kw">
              <span className="lx-kwo-mark">{best ? <Star size={12} /> : <span className="h-2 w-2 rounded-sm" style={{ background: "currentColor", opacity: 0.4 }} />}</span>
              <span className="lx-kwo-text">
                {p.keyword ?? "?"}
                {p.gsc ? <span className="lx-pill green ml-2" style={{ padding: "1px 7px", fontSize: 10 }}>already ranking</span> : null}
              </span>
            </div>
            {/* "—" when the free source has no number — never a 0, which would read as "nobody
                searches this". */}
            <span className={`lx-kwo-cell hide-sm${vol == null ? " mut" : ""}`}>{vol != null ? fmtVol(vol) : "—"}</span>
            <span className="lx-kwo-cell hide-sm" style={{ color: fitPct != null ? fitColor(fitPct) : undefined, fontWeight: 600 }}>
              {fitPct != null ? `${fitPct}%` : "—"}
            </span>
            <button className="lx-kwo-use" onClick={() => onWriteArticle(String(p.keyword ?? ""))} title="Write an article for this keyword">
              Use
            </button>
          </div>
        );
      })}
      {items.length > LIMIT && (
        <button className="lx-kwo-more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show less" : `View more (${items.length - LIMIT})`}
          <ChevronDown size={14} style={{ transform: showAll ? "rotate(180deg)" : undefined, transition: "transform .18s" }} />
        </button>
      )}
    </div>
  );
};

/** Mr. Writer's research step, live — gpt-researcher's own progress, forwarded verbatim from
 *  conduct_research.py's ProgressSink through agents/writer.ts's onProgress (2026-08-31). Every
 *  line here is something gpt-researcher itself reported; nothing is timed, percentaged or
 *  invented — gpt-researcher does not expose a per-page "reading %" today, so this deliberately
 *  does not draw one (see that file's own header for why the hook is defensive/best-effort in
 *  the first place: the exact event shape could not be verified against a live install before
 *  this shipped, and a broken guess must never cost the article its research). */
const ResearchScreen = ({ items, running }: { items: { key: string; payload: any }[]; running: boolean }) => {
  // Defensive extraction — gpt-researcher's real event shape varies by version and was never
  // confirmed locally; whichever text field is actually present wins, never a guess at one
  // that isn't there.
  const lineFor = (payload: unknown): string => {
    if (typeof payload === "string") return payload;
    if (payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      if (typeof p.output === "string") return p.output;
      if (typeof p.content === "string" && typeof p.output !== "string") return p.content;
      if (typeof p.note === "string") return p.note;
    }
    return "Working…";
  };
  const urlsFor = (payload: unknown): string[] => {
    const meta = payload && typeof payload === "object" ? (payload as Record<string, unknown>).metadata : null;
    if (!Array.isArray(meta)) return [];
    return meta.filter((m): m is string => typeof m === "string" && /^https?:\/\//.test(m));
  };
  // Real, derivable from the URL itself — never a guess at the page's actual title or body
  // text, which gpt-researcher does not hand back (see this component's header comment).
  const hostOf = (u: string) => {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
  };
  const crumbsOf = (u: string) => {
    try {
      return new URL(u).pathname.split("/").filter(Boolean).slice(0, 3).map((s) => decodeURIComponent(s).replace(/[-_]/g, " "));
    } catch { return []; }
  };

  const latest = items[items.length - 1];
  const latestUrls = latest ? urlsFor(latest.payload) : [];
  const readingHost = latestUrls[0] ? hostOf(latestUrls[0]) : null;

  return (
    <div>
      {readingHost ? (
        // The browser-chrome "reading" screen (owner's reference mockup, 2026-09-07). The host
        // and breadcrumb are real (parsed straight from the real source URL gpt-researcher
        // reported); the shimmering bars are a deliberately abstract stand-in for the page's
        // body — there is no real title/paragraph text to show without inventing one, so this
        // never puts words in the page's mouth, only conveys "reading, scrolling, in progress".
        <div className="lx-read">
          <div className="lx-serp-top">
            <Globe size={12} /> Reading Web Pages
          </div>
          <div className="lx-read-frame mt-2">
            <div className="lx-read-bar">
              <Menu size={12} className="lx-dim" />
              <span className="lx-read-fav" />
              <span className="lx-read-host truncate">{readingHost}</span>
              <MoreVertical size={12} className="lx-dim ml-auto" />
            </div>
            {crumbsOf(latestUrls[0]).length > 0 && (
              <div className="lx-read-crumb truncate">
                Home{crumbsOf(latestUrls[0]).map((c, i) => (
                  <span key={i}> › {c}</span>
                ))}
              </div>
            )}
            <div className="lx-read-body">
              <div className="lx-read-body-inner">
                <div className="lx-read-skel" style={{ width: "70%" }} />
                <div className="lx-read-skel" style={{ width: "100%", marginTop: 10 }} />
                <div className="lx-read-skel" style={{ width: "94%" }} />
                <div className="lx-read-skel" style={{ width: "55%" }} />
                <div className="lx-read-skel" style={{ width: "40%", marginTop: 16 }} />
                <div className="lx-read-skel" style={{ width: "100%", marginTop: 10 }} />
                <div className="lx-read-skel" style={{ width: "88%" }} />
                <div className="lx-read-skel" style={{ width: "97%" }} />
              </div>
              <div className="lx-read-scrim" />
            </div>
          </div>
          <div className="lx-serp-meta truncate">
            {lineFor(latest.payload)}
            {latestUrls.length > 1 ? ` · +${latestUrls.length - 1} more source${latestUrls.length - 1 === 1 ? "" : "s"}` : ""}
          </div>
        </div>
      ) : (
        // Before gpt-researcher's first source has landed there is nothing real yet to name — a
        // bare "Researching…" line here read as dead/stuck (owner, 2026-09-12: "pehle aisa kiyoun
        // ata hai ui kharab lagta hai"). Same Wave+shimmer language as BossScreen/SiteBrainScreen
        // while genuinely idle-before-first-event, so every screen's "still working, nothing to
        // show yet" moment looks and feels the same rather than this one alone going quiet.
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <Wave n={22} h={18} anim color="var(--lx-cyan)" />
          <span className="lx-shimmer lx-11 font-medium">Researching the open web…</span>
        </div>
      )}

      {/* Every source gpt-researcher really opened, one card each — the reference design's own
          research view (owner, 2026-09-11: "jab artical ke liye research ho tab bhi wo live
          visual pe aaye"). Domain and its initial are parsed from the REAL URL it reported;
          the line under it is that step's own words, verbatim. Nothing here names a page the
          researcher did not open, and there is no invented snippet — gpt-researcher does not
          hand back page text, so the card shows what it does hand back. */}
      {(() => {
        const seen = new Set<string>();
        const sources: { url: string; host: string; line: string; key: string }[] = [];
        for (const it of items) {
          for (const u of urlsFor(it.payload)) {
            const h = hostOf(u);
            if (seen.has(h)) continue;
            seen.add(h);
            sources.push({ url: u, host: h, line: lineFor(it.payload), key: `${it.key}-${h}` });
          }
        }
        const hue = (s: string) => {
          let n = 0;
          for (let i = 0; i < s.length; i++) n += s.charCodeAt(i);
          return `hsl(${n % 360} 62% 58%)`;
        };
        return sources.length > 0 ? (
          <div className="mt-3">
            <div className="lx-10 lx-mut mb-2">{sources.length} source{sources.length === 1 ? "" : "s"} read</div>
            <div className="space-y-2">
              {sources.map((s) => (
                <div key={s.key} className="lx-live-anim lx-src">
                  <span className="lx-src-fav" style={{ background: hue(s.host) }}>{s.host.charAt(0).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="lx-10 lx-mut block truncate">{s.host}</span>
                    <span className="lx-11 block" style={{ color: "var(--lx-text)" }}>{s.line}</span>
                  </span>
                  <CheckCircle2 size={13} style={{ color: "#22c55e", flexShrink: 0, marginTop: 2 }} />
                </div>
              ))}
            </div>
          </div>
        ) : null;
      })()}

      {/* The plain history list — every progress line gpt-researcher actually sent, oldest
          first. Kept in full when there is no "reading" screen above it to carry that job;
          shown as a compact trailing log underneath it otherwise, so the panel reads as ONE
          live viewport plus its log, not a stack of repeated cards. */}
      <ul className={readingHost ? "mt-2 space-y-1" : "mt-2 space-y-2"}>
        {(readingHost ? items.slice(0, -1).slice(-5) : items).map((it) => (
          <li key={it.key} className="lx-live-anim">
            <div className={`flex items-center gap-2 ${readingHost ? "lx-10 lx-dim" : "lx-11"}`} style={readingHost ? undefined : { color: "var(--lx-text)" }}>
              <Search size={readingHost ? 10 : 12} className="lx-dim shrink-0" />
              <span className="min-w-0 flex-1 truncate">{lineFor(it.payload)}</span>
            </div>
          </li>
        ))}
      </ul>
      {items.length === 0 && (
        <div className="lx-10 lx-mut mt-3 px-1">{running ? "Starting research…" : "No research activity was reported for this order."}</div>
      )}
    </div>
  );
};

/** LIVE_CANVAS_SPEC.md (owner, 2026-09-11) asked for a purpose-built live screen per remaining
 *  agent — SEO, Image, Audit, Leads, Publish, Social — the same "typed component, real events
 *  only" rule KeywordScreen/ResearchScreen above already follow. Until now these six fell into
 *  the generic item list (or, in Workspace.tsx's own dispatcher, `GenericCards`) — a plain
 *  key/value dump of whatever `ctx.data()` sent, with no shape of its own.
 *
 *  Every field name below is the REAL one, read straight off the agent's own `ctx.data()` calls
 *  (agent-server/src/agents/{seo,image,audit,leads,publish,social}.ts) — not the shape an
 *  earlier reference design assumed. Nothing here invents a value: an agent that hasn't sent a
 *  field yet leaves that part of the screen simply absent, never a placeholder guess. */

/** Owner, 2026-09-11: "same html jaisa... live cursor" — the reference mockup's cursor that
 *  visibly moves to whatever the agent is working on right now. §6 of LIVE_CANVAS_SPEC.md is
 *  explicit about WHY this is still allowed under the "no simulation" rule: "jab bhi ek naya
 *  data.* event aaye jo ek specific DOM element se juda ho, us element ka ref capture karo aur
 *  cursor ko wahi move karo. Agar koi naya event nahi aaya, cursor apni last position pe ruka
 *  rehta hai." The trigger is always a real item that already arrived — `useFollowLatest` only
 *  watches `items.length` growing, never a timer — so the cursor's MOVEMENT is decorative CSS
 *  transition over a real fact, the same category as `.lx-live-anim`'s fade-in, not a fabricated
 *  "agent is thinking" loop. */
function useFollowLatest<T extends { key: string }>(items: T[]) {
  const nodes = useRef<Record<string, HTMLElement | null>>({});
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const setNodeRef = (key: string) => (el: HTMLElement | null) => {
    nodes.current[key] = el;
  };
  useEffect(() => {
    const last = items[items.length - 1];
    if (last && nodes.current[last.key]) setTarget(nodes.current[last.key]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);
  return { setNodeRef, target };
}

/** The cursor itself — a colored tip + agent-name tag, positioned relative to `host` (the
 *  screen's own outer `position:relative` wrapper) and re-measured whenever `target` changes.
 *  Renders nothing (not even a hidden, opacity:0 node holding stale coordinates) once the
 *  screen has no real target yet, e.g. before the first item lands. */
const AgentCursor = ({
  target,
  host,
  color,
  label,
  follow,
}: {
  target: HTMLElement | null;
  host: HTMLElement | null;
  color: string;
  label: string;
  /** Bump to re-measure while the target NODE stays the same but moves — the typing caret is one
   *  span that travels across the line, so without this the cursor would pin to where it first
   *  appeared and never ride along with the words. */
  follow?: number;
}) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!target || !host) {
      setPos(null);
      return;
    }
    const measure = () => {
      const hr = host.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      setPos({ x: tr.left - hr.left - 4, y: tr.top - hr.top - 22 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [target, host, follow]);
  if (!pos) return null;
  return (
    <div
      className="lx-cursor show"
      style={{
        color,
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        // Riding a moving caret wants a short catch-up; jumping between rows wants the slower,
        // deliberate glide the reference design has.
        ...(follow != null ? { transition: "transform .12s linear, opacity .3s" } : null),
      }}
    >
      <span className="tip" />
      <span className="tag">{label}</span>
    </div>
  );
};

/** SEO and Audit both emit an `"issue"` kind with the identical `{id, severity, what, fix}`
 *  shape (lib/seoChecks.ts's `SeoIssue`, agent-server/src/lib/audit/checks.ts's `AuditIssue`) —
 *  one row renderer, reused by both screens below, rather than two copies that would silently
 *  drift apart. */
const IssueRow = ({ payload, refCb }: { payload: any; refCb?: (el: HTMLElement | null) => void }) => {
  const sev = payload?.severity === "block" ? "red" : payload?.severity === "warn" ? "amber" : "mut";
  return (
    <div ref={refCb} className="lx-live-anim lx-in rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`lx-pill ${sev}`} style={{ fontSize: 10, padding: "1px 8px" }}>
          {payload?.severity ?? "info"}
        </span>
        <span className="lx-11 font-medium" style={{ color: "var(--lx-text)" }}>{payload?.what ?? "Issue"}</span>
      </div>
      {payload?.fix && <div className="lx-10 lx-mut mt-1.5">{payload.fix}</div>}
    </div>
  );
};

type CanvasItem = { key: string; kind: string; payload: any };

/** Mr. SEO's live screen — `ctx.data("score", …)` once (seo.ts:72), then one `ctx.data("issue",
 *  …)` per finding (seo.ts:87), as they're found — not a fake gauge sweeping to a precomputed
 *  number. */
/** The bucket each on-page check belongs to. The ids are lib/seoChecks.ts's own stable contract
 *  ("Stable id — the UI, the trend and the tests key off this, never off the prose"), so this
 *  is the real catalogue, not a guess at one. Used to draw the reference design's per-category
 *  bars from the issue events ALONE — no extra backend round trip, so the bars appear the moment
 *  the checks do. When agents/seo.ts's own `score_category` events are present they win: the
 *  agent knows which checks actually RAN (a skipped SERP comparison, say), and this side does
 *  not, which is exactly why the fallback below never claims "N of M passed" — only how many
 *  issues were really found in that bucket. */
const SEO_BUCKETS: { label: string; ids: string[] }[] = [
  { label: "Title & meta", ids: ["title-present", "title-length", "title-keyword", "title-keyword-position", "meta-description", "slug"] },
  { label: "Headings", ids: ["h1-unique", "h2-count", "heading-order", "keyword-in-heading"] },
  { label: "Keyword usage", ids: ["keyword-density", "keyword-first-100", "secondary-keyword-coverage"] },
  { label: "Links", ids: ["internal-links", "internal-links-resolve", "internal-links-cluster", "external-links"] },
  { label: "Readability", ids: ["readability-sentences", "readability-paragraphs"] },
  { label: "Trust & media", ids: ["image-alt", "schema-suggestion", "eeat-author", "eeat-dates", "eeat-proof-cited", "eeat-trust-page"] },
  { label: "Depth vs the top 10", ids: ["serp-word-count", "content-depth", "serp-topic-coverage"] },
];

const SeoScreen = ({ items, running, color, label }: { items: CanvasItem[]; running: boolean; color: string; label: string }) => {
  const scoreItem = items.filter((it) => it.kind === "score").slice(-1)[0];
  const emitted = items.filter((it) => it.kind === "score_category");
  const issues = items.filter((it) => it.kind === "issue");
  const hostRef = useRef<HTMLDivElement>(null);
  // Prefer the agent's own bars; otherwise derive them here from the real issues, with the same
  // arithmetic the agent uses for the overall score (100 − 25·block − 5·warn).
  const derived = emitted.length
    ? []
    : SEO_BUCKETS.map((b) => {
        const mine = issues.filter((it) => b.ids.includes(String(it.payload?.id ?? "")));
        const blocks = mine.filter((it) => it.payload?.severity === "block").length;
        const warns = mine.filter((it) => it.payload?.severity === "warn").length;
        return { label: b.label, value: Math.max(0, Math.min(100, 100 - blocks * 25 - warns * 5)), issues: mine.length };
      });
  const categories = emitted.length ? emitted : [];
  const { setNodeRef, target } = useFollowLatest(categories.length ? categories : issues.length ? issues : scoreItem ? [scoreItem] : []);
  if (!scoreItem && !categories.length && issues.length === 0) {
    return <div className="lx-10 lx-mut px-1 py-2">{running ? "Running the on-page checks…" : "No SEO check has run for this order."}</div>;
  }
  const s = scoreItem?.payload ?? {};
  const score = typeof s.score === "number" ? s.score : null;
  const barColor = (v: number) => (v >= 75 ? "#3f9166" : v >= 50 ? "#c1861f" : "#c05a4a");
  return (
    <div ref={hostRef} style={{ position: "relative" }}>
      <div className="lx-12 mb-3 font-semibold">Content score — draft audit</div>
      {score != null && (
        <div className="lx-live-anim mb-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold" style={{ color: s.passed ? "#3f9166" : "#c1861f" }}>{score}</span>
          <span className="lx-11 lx-mut">/ {typeof s.max === "number" ? s.max : 100}</span>
          <span className={`lx-pill ${s.passed ? "green" : "amber"} ml-2`}>
            {s.passed ? "Passed" : `${s.blockers ?? 0} blocker${s.blockers === 1 ? "" : "s"}`}
          </span>
          {s.serpCompared === false && <span className="lx-10 lx-mut">— not compared against the live SERP</span>}
        </div>
      )}
      {/* One bar per category. The width is the real number either way; the easing is just CSS. */}
      {categories.length > 0 && (
        <div className="mb-3">
          {categories.map((it) => {
            const p = it.payload ?? {};
            const v = typeof p.value === "number" ? Math.max(0, Math.min(100, p.value)) : 0;
            return (
              <div key={it.key} ref={setNodeRef(it.key)} className="lx-srow lx-live-anim">
                <span className="lb truncate">{p.label ?? "—"}</span>
                <span className="lx-sbar"><i style={{ width: `${v}%`, background: barColor(v) }} /></span>
                <span className="lx-sval">
                  {typeof p.passed === "number" && typeof p.total === "number" ? `${p.passed}/${p.total}` : v}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {derived.length > 0 && issues.length > 0 && (
        <div className="mb-3">
          {derived.map((b) => (
            <div key={b.label} className="lx-srow lx-live-anim">
              <span className="lb truncate">{b.label}</span>
              <span className="lx-sbar"><i style={{ width: `${b.value}%`, background: barColor(b.value) }} /></span>
              {/* Deliberately the issue COUNT, not "N of M passed": this side cannot know which
                  checks actually ran, so it never implies a check that was skipped. */}
              <span className="lx-sval">{b.issues === 0 ? "clear" : `${b.issues} issue${b.issues === 1 ? "" : "s"}`}</span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {issues.map((it) => <IssueRow key={it.key} payload={it.payload} refCb={categories.length ? undefined : setNodeRef(it.key)} />)}
      </div>
      <AgentCursor target={target} host={hostRef.current} color={color} label={label} />
    </div>
  );
};

/** Mr. Image's live screen — real generated URLs, `ctx.data("image", …)` once per image
 *  (image.ts:112/340). `slot` is a free string off the media plan (`ImageSlot`), never an
 *  invented enum — bucketed by substring match so a slot naming scheme change never breaks
 *  this into an unstyled fallback. */
const ImageScreen = ({ items, running, color, label }: { items: CanvasItem[]; running: boolean; color: string; label: string }) => {
  const images = items.filter((it) => it.kind === "image" && it.payload?.url);
  const hostRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, target } = useFollowLatest(images);
  if (images.length === 0) {
    return <div className="lx-10 lx-mut px-1 py-2">{running ? "Generating images…" : "No images were produced for this order."}</div>;
  }
  const isHero = (slot: unknown) => /hero/i.test(String(slot ?? ""));
  const hero = images.find((it) => isHero(it.payload?.slot)) ?? null;
  const rest = images.filter((it) => it !== hero);
  // The reveal itself — a real image that just landed fades/scales in rather than snapping into
  // place, the same "real event, decorative transition" rule the cursor above follows. Keyed by
  // `it.key` so a genuinely new image always re-triggers the animation, never a re-render of one
  // already on screen.
  const Tile = ({ it }: { it: CanvasItem }) => (
    <div
      ref={setNodeRef(it.key)}
      key={it.key}
      className="lx-live-anim overflow-hidden rounded-lg"
      style={{ border: "1px solid var(--lx-border)", animation: "lxLiveFade .5s ease-out both, lxImageIn .5s ease-out both" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a real generated URL from an
          arbitrary provider (Cloudflare/NIM), not a static asset next/image can optimize. */}
      <img src={it.payload.url} alt={it.payload?.alt ?? ""} className="aspect-video w-full object-cover" />
      <div className="lx-10 lx-mut truncate px-2 py-1.5">{it.payload?.slot ?? "image"}</div>
    </div>
  );
  return (
    <div ref={hostRef} style={{ position: "relative" }}>
      {hero && <div className="mb-3"><Tile it={hero} /></div>}
      {rest.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{rest.map((it) => <Tile key={it.key} it={it} />)}</div>}
      <AgentCursor target={target} host={hostRef.current} color={color} label={label} />
    </div>
  );
};

/** Mr. Site Audit's live screen — crawl progress from `ctx.data("page", {url,done,total})`
 *  (audit.ts:82, and again with `phase:"perf"` at audit.ts:150), the running score
 *  (`ctx.data("score", {score,blocks,warns,pages})`, audit.ts:116/173), and every issue found
 *  along the way — same `IssueRow` as SEO, since audit.ts's own `AuditIssue` is the identical
 *  `{id,severity,what,fix}` shape. */
const AuditScreen = ({ items, running, color, label }: { items: CanvasItem[]; running: boolean; color: string; label: string }) => {
  // audit.ts fires "page" TWICE over the run — once per page crawled (audit.ts:82), and again
  // for a much smaller subset actually perf-measured (audit.ts:150, `phase:"perf"`). Mixing both
  // into one grid/count made the header flip between two different totals mid-run and the grid
  // grow by a confusing second batch after the crawl looked finished (owner, 2026-09-12: "suru
  // pe upar pe aisa pages ata hai fir pages aa jata hai"). The grid is the real crawl only, one
  // cell per page actually crawled; the perf pass stays out of it entirely rather than
  // pretending to be more pages.
  const pages = items.filter((it) => it.kind === "page" && it.payload?.phase !== "perf");
  const issues = items.filter((it) => it.kind === "issue");
  const scoreItem = items.filter((it) => it.kind === "score").slice(-1)[0];
  const latest = pages[pages.length - 1]?.payload;
  const total = typeof latest?.total === "number" ? latest.total : null;
  const done = typeof latest?.done === "number" ? latest.done : pages.length;
  const hostRef = useRef<HTMLDivElement>(null);
  const cursorItems = pages.length ? pages : issues.length ? issues : scoreItem ? [scoreItem] : [];
  const { setNodeRef, target } = useFollowLatest(cursorItems);
  // Which crawled pages a real issue actually names — AuditIssue.pages is the agent's own list
  // of affected URLs (capped at its own PAGE_SAMPLE), so a cell is only ever red because the
  // audit said that page has a problem.
  const badPages = new Set<string>(
    issues.flatMap((it) => (Array.isArray(it.payload?.pages) ? (it.payload.pages as unknown[]).map(String) : []))
  );
  if (!pages.length && !issues.length && !scoreItem) {
    return <div className="lx-10 lx-mut px-1 py-2">{running ? "Crawling the site…" : "No audit has run for this order."}</div>;
  }
  return (
    <div ref={hostRef} style={{ position: "relative" }}>
      {/* One cell per page the crawler really reported (audit.ts's own "page" event, one per
          page). A cell turns red only when a real issue NAMES that page: AuditIssue carries
          `pages: string[]` — the actual URLs it happens on (lib/audit/checks.ts) — so this is
          read from the agent's own findings, never a decorative sprinkling of red. Pages the
          issues don't name stay green. */}
      {pages.length > 0 && (
        <div className="mb-3">
          <div className="lx-10 lx-mut mb-2 flex items-center justify-between">
            <span>Site crawl{total != null ? ` — ${total} page${total === 1 ? "" : "s"}` : ""}</span>
            <span>
              {scoreItem ? `${scoreItem.payload?.score ?? "?"}/100` : `${done}${total != null ? ` / ${total}` : ""}`}
            </span>
          </div>
          <div className="lx-nodes">
            {pages.map((it) => {
              const url = String(it.payload?.url ?? "");
              const bad = url && badPages.has(url);
              return (
                <span
                  key={it.key}
                  ref={pages[pages.length - 1] === it ? setNodeRef(it.key) : undefined}
                  title={bad ? `${url} — has an issue` : url}
                  className={`lx-live-anim lx-node${bad ? " bad" : ""}`}
                />
              );
            })}
          </div>
        </div>
      )}
      {scoreItem && !pages.length && (
        <div ref={setNodeRef(scoreItem.key)} className="lx-live-anim mb-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold">{scoreItem.payload?.score ?? "?"}</span>
          <span className="lx-11 lx-mut">/ 100 site score</span>
        </div>
      )}
      <div className="space-y-2">
        {issues.map((it) => <IssueRow key={it.key} payload={it.payload} refCb={!pages.length ? setNodeRef(it.key) : undefined} />)}
      </div>
      <AgentCursor target={target} host={hostRef.current} color={color} label={label} />
    </div>
  );
};

/** Mr. Leads' live screen — one `ctx.data("lead", …)` per qualified lead (leads.ts:131), as
 *  discovery/scoring finds them. `band` is a free string off the agent's own scoring, matched
 *  by substring the same defensive way ImageScreen matches `slot`, rather than a hardcoded
 *  enum this screen would silently stop coloring the day the agent's own wording changes. */
const LeadsScreen = ({ items, running, color, label }: { items: CanvasItem[]; running: boolean; color: string; label: string }) => {
  const leads = items.filter((it) => it.kind === "lead");
  const hostRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, target } = useFollowLatest(leads);
  if (!leads.length) {
    return <div className="lx-10 lx-mut px-1 py-2">{running ? "Finding leads…" : "No leads were found for this order."}</div>;
  }
  return (
    <div ref={hostRef} style={{ position: "relative" }} className="space-y-2">
      {leads.map((it) => {
        const p = it.payload ?? {};
        const band = String(p.band ?? "").toLowerCase();
        const tier = /hi|high/.test(band) ? "green" : /lo|low/.test(band) ? "mut" : "amber";
        return (
          <div key={it.key} ref={setNodeRef(it.key)} className="lx-live-anim lx-in rounded-lg px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="lx-12 truncate font-semibold">{p.name ?? "?"}</span>
              {typeof p.score === "number" && (
                <span className={`lx-pill ${tier}`} style={{ fontSize: 10, padding: "1px 8px" }}>{p.score}</span>
              )}
            </div>
            {p.website && <div className="lx-10 lx-mut truncate">{p.website}</div>}
            {p.why && <div className="lx-11 mt-1" style={{ color: "var(--lx-text)" }}>{p.why}</div>}
          </div>
        );
      })}
      <AgentCursor target={target} host={hostRef.current} color={color} label={label} />
    </div>
  );
};

/** Mr. Publish's live screen — a browser-chrome frame around the ONE thing publish.ts actually
 *  sends: `ctx.data("published", {url, verified, title})` (publish.ts:128), fired once at the
 *  end. There is no incremental "typing the title" moment to show honestly — publish.ts's own
 *  `ctx.onProgress` calls before that are plain `{label}` strings, already carried by the
 *  shared running-step label above this screen, so this component itself only ever draws the
 *  one real, verified outcome. `verified` is a real `fetch(url).status===200` check
 *  (publish.ts), never assumed true because the call succeeded. */
const PublishScreen = ({ items, running, color, label }: { items: CanvasItem[]; running: boolean; color: string; label: string }) => {
  const pub = items.filter((it) => it.kind === "published").slice(-1)[0];
  const hostRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, target } = useFollowLatest(pub ? [pub] : []);
  if (!pub) {
    return <div className="lx-10 lx-mut px-1 py-2">{running ? "Publishing…" : "Nothing has been published for this order yet."}</div>;
  }
  const p = pub.payload ?? {};
  return (
    <div ref={hostRef} style={{ position: "relative" }}>
      <div className="lx-live-anim overflow-hidden rounded-lg" style={{ border: "1px solid var(--lx-border)" }}>
        <div className="flex items-center gap-2 px-3 py-2" style={{ background: "var(--lx-in)", borderBottom: "1px solid var(--lx-border)" }}>
          <Globe size={12} className="lx-mut shrink-0" />
          <span className="lx-10 lx-mono lx-mut truncate">{p.url ?? "publishing…"}</span>
        </div>
        <div className="p-3">
          <div className="lx-12 mb-2 font-semibold">{p.title ?? "Untitled"}</div>
          <span ref={setNodeRef(pub.key)} className={`lx-pill ${p.verified ? "green" : "amber"}`}>
            {p.verified ? <CheckCircle2 size={12} /> : null} {p.verified ? "Verified live" : "Published — not yet verified"}
          </span>
        </div>
      </div>
      <AgentCursor target={target} host={hostRef.current} color={color} label={label} />
    </div>
  );
};

/** Mr. Story's live screen — one `ctx.data("story_page", …)` per page as it's actually built
 *  (agents/story.ts, added alongside this UI — story.ts sent ZERO live events before this,
 *  only `ctx.onProgress` phase labels, exactly the gap Site Brain had). Each page carries the
 *  REAL image URL it ended up with (already drawn by Mr. Image, or reused from the article's
 *  own pictures) and its real headline — never a placeholder while a picture is still being
 *  generated, since the event only fires once `pictureFor` has resolved a real, stored URL. A
 *  filmstrip of real 9:16 cards, not a bullet list — the "image editing" feel the reference
 *  design's own agents (Image, Publish) already have. */
const StoryScreen = ({ items, running, color, label }: { items: CanvasItem[]; running: boolean; color: string; label: string }) => {
  const pages = items.filter((it) => it.kind === "story_page" && it.payload?.image);
  const hostRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, target } = useFollowLatest(pages);
  if (!pages.length) {
    return (
      <div className="flex items-center gap-2.5 px-1 py-2">
        {running ? (
          <>
            <Wave n={22} h={16} anim color={color} />
            <span className="lx-shimmer lx-10 font-medium">Building the story pages…</span>
          </>
        ) : (
          <span className="lx-10 lx-mut">No story pages were built for this order.</span>
        )}
      </div>
    );
  }
  const total = typeof pages[pages.length - 1]?.payload?.total === "number" ? pages[pages.length - 1].payload.total : pages.length;
  return (
    <div ref={hostRef} style={{ position: "relative" }}>
      <div className="lx-12 mb-3 font-semibold">Web story — {pages.length} of {total} page{total === 1 ? "" : "s"}</div>
      <div className="lx-story-strip">
        {pages.map((it) => {
          const p = it.payload ?? {};
          return (
            <div key={it.key} ref={setNodeRef(it.key)} className="lx-live-anim lx-story-page">
              {/* eslint-disable-next-line @next/next/no-img-element -- a real generated/stored
                  URL, not a static asset next/image can optimize. */}
              <img src={String(p.image)} alt={p.alt ?? ""} />
              {typeof p.index === "number" && <span className="n">{p.index + 1}</span>}
              {p.cta && <span className="cta">CTA</span>}
              {p.headline && <span className="cap">{p.headline}</span>}
            </div>
          );
        })}
      </div>
      <AgentCursor target={target} host={hostRef.current} color={color} label={label} />
    </div>
  );
};

/** Miss Social's live screen — one `ctx.data("post", …)` per network drafted (social.ts:89):
 *  the real caption, real hashtags, and `overLimit` (a real length check against that
 *  network's own limit, social.ts's `LIMIT` table) — never a fabricated schedule time, since
 *  scheduling happens later in Approvals, not inside this agent's own run. */
const SocialScreen = ({ items, running, color, label }: { items: CanvasItem[]; running: boolean; color: string; label: string }) => {
  const posts = items.filter((it) => it.kind === "post");
  const hostRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, target } = useFollowLatest(posts);
  if (!posts.length) {
    return <div className="lx-10 lx-mut px-1 py-2">{running ? "Drafting posts…" : "No posts were drafted for this order."}</div>;
  }
  return (
    <div ref={hostRef} style={{ position: "relative" }} className="space-y-4">
      {posts.map((it) => {
        const p = it.payload ?? {};
        const tags: string[] = Array.isArray(p.hashtags) ? p.hashtags.map(String) : [];
        return (
          <div key={it.key} ref={setNodeRef(it.key)} className="lx-live-anim">
            <div className="lx-12 mb-2 font-semibold">{p.label ?? p.network ?? "Post"} — draft</div>
            {/* The post as it will actually read, in the shape it will be read in. Everything
                here is the agent's own output: caption, hashtags, and its real over-limit check
                against that network's own character limit (social.ts's LIMIT table). No image
                and no "Scheduled 10:00 AM" pill — Miss Social writes an image BRIEF, not an
                image, and scheduling happens later in Approvals, so both would be props. */}
            <div className="lx-scard">
              <div className="lx-shead">
                <span className="lx-savatar" />
                <span className="min-w-0">
                  <span className="lx-12 block truncate font-semibold">Your business</span>
                  <span className="lx-10 lx-mut block">Draft · awaiting your approval</span>
                </span>
                {p.overLimit && <span className="lx-pill amber ml-auto shrink-0" style={{ fontSize: 10, padding: "1px 8px" }}>over limit</span>}
              </div>
              <div className="lx-sbody">{p.text ?? ""}</div>
              {tags.length > 0 && (
                <div className="lx-stags">
                  {tags.map((h, i) => <span key={i}>#{h.replace(/^#/, "")}</span>)}
                </div>
              )}
              <div className="lx-sfoot">
                <span className="lx-10 lx-mut">preview</span>
                {p.imageBrief && <span className="lx-10 lx-dim min-w-0 truncate" title={String(p.imageBrief)}>image brief: {String(p.imageBrief)}</span>}
              </div>
            </div>
          </div>
        );
      })}
      <AgentCursor target={target} host={hostRef.current} color={color} label={label} />
    </div>
  );
};

/** Site Brain's (Mr. Analyst) live screen — one `ctx.data("cluster", {name,size,page_urls})`
 *  per topic cluster, as each is labeled (agent-server/src/agents/analyst.ts, added alongside
 *  this UI — analyst.ts sent ZERO live events before this pass, only `ctx.onProgress` phase
 *  labels, so a Site Brain run had nothing to show here until now). Deliberately a list, not a
 *  2D scatter plot: a real embedding projection (UMAP/PCA) is its own backend job the plan
 *  defers to a later phase, and drawing invented (x,y) positions instead would be exactly the
 *  fabrication this whole feature exists to avoid. */
const SiteBrainScreen = ({ items, running, color, label }: { items: CanvasItem[]; running: boolean; color: string; label: string }) => {
  const clusters = items.filter((it) => it.kind === "cluster");
  const hostRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, target } = useFollowLatest(clusters);
  // Real animation while there is real nothing to show yet — most of Site Brain's run (reading
  // pages, working out offerings/proof/voice, gaps) happens before a single cluster exists, and
  // a bare grey line here read as frozen (owner, 2026-09-12: "analytic pe koi animation nahi ho
  // raha... complete hone ke baad achanak sab aa gaya"). Same Wave+shimmer the generic fallback
  // already uses elsewhere in this panel — not a new decoration, just this screen's own copy of
  // it so the canvas itself never sits blank while genuinely working.
  if (!clusters.length) {
    return (
      <div className="flex items-center gap-2.5 px-1 py-2">
        {running ? (
          <>
            <Wave n={22} h={16} anim color={color} />
            <span className="lx-shimmer lx-10 font-medium">Grouping the site into topics…</span>
          </>
        ) : (
          <span className="lx-10 lx-mut">No topic clusters were formed for this order.</span>
        )}
      </div>
    );
  }
  // Bubble area follows the cluster's REAL page count (√n, so a 20-page topic reads as bigger
  // than a 5-page one without dwarfing it). Position is just layout — bubbles flow left to
  // right — because a real 2D projection of the embeddings is a separate backend job; a
  // scattered "map" whose coordinates meant nothing would look like data and be decoration.
  const biggest = Math.max(...clusters.map((it) => (typeof it.payload?.size === "number" ? it.payload.size : 1)), 1);
  return (
    <div ref={hostRef} style={{ position: "relative" }}>
      <div className="lx-12 mb-3 font-semibold">Site Brain — {clusters.length} topic cluster{clusters.length === 1 ? "" : "s"}</div>
      <div className="lx-clusters">
        {clusters.map((it) => {
          const p = it.payload ?? {};
          const size = typeof p.size === "number" ? p.size : 1;
          const d = Math.round(64 + 56 * Math.sqrt(size / biggest));
          return (
            <div
              key={it.key}
              ref={setNodeRef(it.key)}
              className="lx-live-anim lx-cbubble"
              style={{ width: d, height: d }}
              title={Array.isArray(p.page_urls) ? (p.page_urls as unknown[]).map(String).join("\n") : undefined}
            >
              <span className="lx-11 font-semibold" style={{ overflowWrap: "anywhere" }}>{p.name ?? "Untitled"}</span>
              <span className="lx-10 lx-mut">{size} page{size === 1 ? "" : "s"}</span>
            </div>
          );
        })}
      </div>
      <AgentCursor target={target} host={hostRef.current} color={color} label={label} />
    </div>
  );
};

/** Mr. Lxwa's (the boss/brain) own live screen — owner, 2026-09-12: "mr lxwa yani boss ai ka koi
 *  bhi animation nahi ha". Before this it fell into the generic fallback list, which draws a
 *  Working… shimmer only when `producedItems` is truly empty — the boss's own real output,
 *  `ctx.data("topic_picked", {topic, why})`, made that check pass the instant it landed, so the
 *  "waiting" state and the "done" state looked identical (a plain sentence either way). Its own
 *  screen makes the pick a real card once it exists, matching the same visual language every
 *  other agent's finished output already has. */
const BossScreen = ({ items, running, color, label }: { items: CanvasItem[]; running: boolean; color: string; label: string }) => {
  const pick = items.filter((it) => it.kind === "topic_picked").slice(-1)[0];
  const hostRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, target } = useFollowLatest(pick ? [pick] : []);
  if (!pick) {
    return (
      <div className="flex items-center gap-2.5 px-1 py-2">
        {running ? (
          <>
            <Wave n={22} h={16} anim color={color} />
            <span className="lx-shimmer lx-10 font-medium">Choosing the best topic…</span>
          </>
        ) : (
          <span className="lx-10 lx-mut">Nothing was produced for this order.</span>
        )}
      </div>
    );
  }
  const p = pick.payload ?? {};
  return (
    <div ref={hostRef} style={{ position: "relative" }}>
      <div ref={setNodeRef(pick.key)} className="lx-live-anim lx-in rounded-lg px-4 py-3">
        <div className="flex items-center gap-1.5 lx-10 lx-mut">
          <CheckCircle2 size={12} style={{ color: "#3f9166" }} /> Topic chosen
        </div>
        <div className="lx-13 mt-1 font-bold leading-snug">{p.topic ?? "a topic"}</div>
        {p.why && <div className="lx-11 lx-mut mt-1.5">{p.why}</div>}
      </div>
      <AgentCursor target={target} host={hostRef.current} color={color} label={label} />
    </div>
  );
};

/** Mr. Writer's real document — owner, 2026-09-11: "article likhta hai real jaisa", pointing at
 *  the reference mockup's typed document. Before this, once research finished, sections fell
 *  into the generic per-item bullet list ("Section written: "X" (200 words)") — never an actual
 *  growing article. `section` events (writer.ts:123, `{h2, words, text}`) are each ALREADY the
 *  finished, real text for that section — gpt-oss doesn't stream token-by-token here — so
 *  typing it out character by character is a presentation pace over real, already-written
 *  words, never inventing ones the agent hasn't produced yet: exactly the same category as the
 *  cursor's own transition (see useFollowLatest's header comment), triggered by a real event
 *  that already arrived, not a timer pretending to write. EARLIER sections render in full at
 *  once (they already finished); only the newest one animates, and only once — reopening this
 *  screen replays nothing. */
// writer.ts's own prompt tells the model to "Start with '## <h2>' then the prose"
// (agent-server/src/lib/writerPipeline.ts:215) — so `section.text` genuinely, by design,
// repeats its own h2 as a literal leading markdown heading line before the real body starts.
// `h2` already renders that heading cleanly above; this strips the redundant duplicate off the
// TEXT ONLY — the section's real stored text is untouched, this is presentation only. A
// mismatch between the leading line and `h2` (a model that titled the line slightly
// differently) still strips: it's a markdown heading line either way, never body prose.
const stripLeadingHeading = (text: string): string => text.replace(/^\s*#{1,6}[^\n]*\n+/, "");

const WriterDocScreen = ({ items, running, color, label }: { items: CanvasItem[]; running: boolean; color: string; label: string }) => {
  const sections = items.filter((it) => it.kind === "section");
  const draftItem = items.filter((it) => it.kind === "draft").slice(-1)[0];
  const title = (draftItem?.payload?.title as string | undefined) ?? undefined;
  const latestKey = sections[sections.length - 1]?.key ?? null;
  const typedKeyRef = useRef<string | null>(null);
  const [typedLen, setTypedLen] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const { setNodeRef, target } = useFollowLatest(sections);

  useEffect(() => {
    if (!latestKey || typedKeyRef.current === latestKey) return;
    typedKeyRef.current = latestKey;
    const text = stripLeadingHeading(String(sections[sections.length - 1]?.payload?.text ?? ""));
    setTypedLen(0);
    if (!text) return;
    // Paced by TIME, not by frame count, so a section reads as being written rather than
    // flashing into place — ~4s end to end whatever its length (owner, 2026-09-12: "same html
    // jaisa live animated... jaisa jaisa kaam kare waisa"). Still every character of the real,
    // finished section the writer actually sent: the pace is presentation, the words are not.
    const DURATION = 4000;
    const started = performance.now();
    let raf = 0;
    const step = (nowMs: number) => {
      const done = Math.min(1, (nowMs - started) / DURATION);
      setTypedLen(Math.round(text.length * done));
      if (done < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestKey]);

  if (!sections.length && !title) {
    // Before the first section lands this used to be one muted line on an otherwise blank
    // paper page — read as stuck/dead (owner, 2026-09-12: "pehle aisa kiyoun ata hai ui kharab
    // lagta hai aisa outliner etc, isse accha koi dusra animation dedo"; separately, the same
    // screenshot round: "mr writer sayed stuck hai... abhi task stuck hai sayed"). Same
    // Wave+shimmer language as every other agent's "still working, nothing real to show yet"
    // moment (BossScreen/SiteBrainScreen/ResearchScreen) instead of this one alone sitting mute.
    return running ? (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <Wave n={22} h={18} anim color={color} />
        <span className="lx-shimmer lx-11 font-medium" style={{ color: "var(--lx-text)" }}>Writing the outline…</span>
      </div>
    ) : (
      <div className="lx-10 lx-mut px-1 py-2">No article has been written for this order.</div>
    );
  }
  // Real, live word count — the sum of each finished section's own `words` field (writer.ts's
  // own count for that section), not an estimate: it grows exactly as fast as real sections
  // actually land. Owner, 2026-09-11: wants this top-left, on a white "paper" page — the
  // reference mockup's own look for the one screen that reads like an actual document.
  const wordCount = sections.reduce((sum, it) => sum + (typeof it.payload?.words === "number" ? it.payload.words : 0), 0);
  const latestFull = stripLeadingHeading(String(sections[sections.length - 1]?.payload?.text ?? ""));
  const typing = !!latestKey && typedLen < latestFull.length;
  return (
    <div
      ref={hostRef}
      style={{ position: "relative" }}
    >
      {wordCount > 0 && (
        <div className="lx-10" style={{ color: "#8a8f86", fontFamily: "ui-monospace, monospace", marginBottom: 10 }}>
          {wordCount} words
        </div>
      )}
      {title && (
        <h1 className="lx-live-anim" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.3, margin: "0 0 14px", color: "#20241f" }}>
          {title}
        </h1>
      )}
      {sections.map((it, i) => {
        const p = it.payload ?? {};
        const fullText = stripLeadingHeading(String(p.text ?? ""));
        const isLatest = it.key === latestKey;
        const shown = isLatest ? fullText.slice(0, typedLen) : fullText;
        const stillTyping = isLatest && typedLen < fullText.length;
        return (
          <div key={it.key} ref={setNodeRef(it.key)} className={isLatest ? undefined : "lx-live-anim"}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "16px 0 6px", color: "var(--lx-text)" }}>
              {p.h2 || `Section ${i + 1}`}
            </h2>
            <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--lx-text)", margin: "0 0 4px" }}>
              {boldText(shown, it.key)}
              {stillTyping && <span ref={caretRef} className="lx-caret" style={{ color }} />}
            </p>
          </div>
        );
      })}
      {/* While a section is being written the cursor rides the caret itself, so it moves with
          the words the way the reference design does; the moment typing stops it falls back to
          the section block (useFollowLatest's own target) and rests there, because nothing new
          has happened. Re-pointed on every typedLen tick — that is what makes it travel. */}
      <AgentCursor target={typing ? caretRef.current : target} host={hostRef.current} color={color} label={label} follow={typedLen} />
    </div>
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

/** The live wire between the brain card and whichever agent(s) are actually working right now —
 *  drawn from measured DOM centers (`data-agent-id`/`data-net="b"`), not guessed coordinates, so
 *  it tracks the real responsive grid (.lx-net's container-query reflow at 440px) instead of a
 *  fixed layout that would only be right at one width. Re-measures on any resize of the host —
 *  covers a browser resize and the grid's own breakpoint flip in one listener. No line at all
 *  when nobody is working: a wire to an idle agent would be exactly the kind of "looks alive,
 *  isn't" this whole pass was about removing. */
const WireOverlay = ({ hostRef, workingAgents }: { hostRef: React.RefObject<HTMLDivElement>; workingAgents: Agent[] }) => {
  const [lines, setLines] = useState<{ id: string; x1: number; y1: number; x2: number; y2: number; color: string }[]>([]);
  const workingKey = workingAgents.map((a) => `${a.id}:${a.color}`).join(",");

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !workingAgents.length) {
      setLines([]);
      return;
    }

    const measure = () => {
      const hostRect = host.getBoundingClientRect();
      const brainEl = host.querySelector<HTMLElement>('[data-net="b"]');
      if (!hostRect.width || !brainEl) return;
      const brainRect = brainEl.getBoundingClientRect();
      const bx = brainRect.left + brainRect.width / 2 - hostRect.left;
      const by = brainRect.top + brainRect.height / 2 - hostRect.top;

      const next = workingAgents
        .map((a) => {
          const el = host.querySelector<HTMLElement>(`[data-agent-id="${a.id}"]`);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { id: a.id, x1: bx, y1: by, x2: r.left + r.width / 2 - hostRect.left, y2: r.top + r.height / 2 - hostRect.top, color: a.color };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
      setLines(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostRef, workingKey]);

  if (!lines.length) return null;
  return (
    <svg className="lx-wire" aria-hidden>
      {lines.map((l) => (
        <g key={l.id}>
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={`${l.color}33`} strokeWidth={2} />
          <line className="lx-wire-flow" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth={2.5} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
};

/** The resting-state "AI Agent Network": color-coded agent cards arranged around the brain
 *  "command center" card. */
const AgentNetwork = ({
  top,
  left,
  right,
  bottom,
  bossAgent,
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
  bossAgent: Agent;
  totalActive: number;
  running: number;
  completed: number;
  workingAgent: Agent | null;
  onOpen: (a: Agent) => void;
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const workingAgents = [...top, ...left, ...right, ...bottom].filter((a) => a.status === "Working");
  // The full grid gets the same "camera follows the work" treatment the compact tab strip
  // already has (owner, 2026-09-10): the moment an agent starts, the page scrolls so its card
  // sits centered in view instead of making the owner go hunting for it.
  useEffect(() => {
    if (!workingAgent) return;
    const el = hostRef.current?.querySelector<HTMLElement>(`[data-agent-id="${workingAgent.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }, [workingAgent?.id]);
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
          <span className="lx-11 font-semibold">{workingAgent.id === "boss" ? "Mr Lxwa is working" : "Planning & Orchestrating"}</span>
          <span className="lx-10 lx-mut">{workingAgent.id === "boss" ? "— choosing the best topic from your site" : `— delegated to ${workingAgent.name}`}</span>
        </div>
      )}

      <div className="lx-net-host relative mt-4" ref={hostRef}>
        <WireOverlay hostRef={hostRef} workingAgents={workingAgents} />
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
              CSS/SVG, and the request was to use exactly that artwork.
              Status is real (bossAgent.status, same statusForAgent() every other card uses) —
              was a hardcoded "Online" regardless of whether Mr Lxwa's own step (boss.pick_topic,
              2026-08-31) was genuinely running. "Online" stays the resting-state word (he is
              always reachable); "Working" only shows while he is actually mid-step. */}
          <button
            type="button"
            onClick={() => onOpen(bossAgent)}
            title="See what Mr Lxwa is doing"
            className={`lx-hex lx-net-brain ${bossAgent.status === "Working" ? "lx-net-card-working" : ""}`}
            data-net="b"
            data-agent-id="boss"
            style={{ gridArea: "b", cursor: "pointer", border: "none", boxShadow: bossAgent.status === "Working" ? `0 0 26px ${bossAgent.color}55` : undefined }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, fixed size */}
            <img src="/brand/brain-boss.png" alt="" width={156} height={124} />
            <div className="lx-13 font-bold mt-1">Mr. Lxwa</div>
            <div className="lx-10 lx-mut">Command Center</div>
            <div className="lx-10 lx-mut">Plan · Coordinate · Execute</div>
            <div className="mt-1.5 flex items-center gap-1.5 lx-10 font-semibold" style={{ color: bossAgent.status === "Working" ? "#60a5fa" : "#22c55e" }}>
              <span className="h-1.5 w-1.5 rounded-full lx-pulse" style={{ background: bossAgent.status === "Working" ? "#3b82f6" : "#22c55e" }} />
              {bossAgent.status === "Working" ? "Working" : "Online"}
            </div>
          </button>

          {right.map((a, i) => (
            <NetCard key={a.id} a={a} area={`r${i + 1}`} onClick={() => onOpen(a)} />
          ))}
          {bottom.map((a, i) => (
            <NetCard key={a.id} a={a} area={`o${i + 1}`} onClick={() => onOpen(a)} />
          ))}
        </div>
      </div>

      {/* stats strip — every agent on the roster is real and staffed now (Mr. Image and Mr.
          Story lost their "Planned" carve-out 2026-09-06). "Success Rate 98.6%" and "Time
          Saved 32.4h" were removed 2026-08-31: both were fixed strings with no source anywhere
          in the product, and the file's own comment admitted it. Add either back the day
          something actually measures it. */}
      <div className="lx-card2 mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <StatTile icon={Users} color="#3b82f6" label="Total Agents" value={String(totalActive)} sub="Active" />
        <StatTile icon={Loader2} color="#3b82f6" label="Tasks Running" value={String(running)} sub="In Progress" spin={running > 0} />
        <StatTile icon={CheckCircle2} color="#a855f7" label="Tasks Completed" value={String(completed)} sub="Today" />
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

/** The 1s-ticking elapsed-time readout, isolated in its own leaf component. It used to be a
 *  single `sec` state on the top-level dashboard — every tick re-rendered the ENTIRE page
 *  (including the 16KB embedded <style> block below), which the browser had to re-parse and
 *  recalc every second, causing a whole-page blink (diagnosed 2026-08-29). Each mount ticks
 *  independently from 272 (00:04:32) — this is mock elapsed time, not a shared clock, so two
 *  on-screen readouts drifting by a few ms is invisible. */
const ElapsedTimer = ({ paused = false }: { paused?: boolean }) => {
  const [sec, setSec] = useState(272);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);
  return <>{fmt(sec)}</>;
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

export default function MrLxwaDashboard({
  tenantId = null,
  children,
}: {
  tenantId?: string | null;
  /** When provided (a real /dashboard/** sub-page's own content — e.g. Connect), this
   *  replaces the default workflow/agent-network content in the main slot. The shell around
   *  it (sidebar, mobile topbar, Assistant chat) stays exactly the same, so navigating
   *  between sections never leaves this dashboard's own look — see NAV's real hrefs and
   *  MASTER_PLAN comment above about "every page in this theme, responsive". */
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  // Real account/plan/sign-out — the same lib/store.tsx StoreProvider AppShell reads from,
  // mounted globally in app/layout.tsx, so it's already live here without any extra fetch.
  const { s: account, signOut, patch } = useStore();

  // Real per-agent status — was reading ONLY the single newest task's steps, so an agent that
  // did real work a moment ago (in the task just before the newest one) still showed "Waiting"
  // the instant any other task was placed — the "Agent Network doesn't look connected to what's
  // actually happening" gap reported live 2026-08-29. Now every recently loaded task
  // (Realtime-subscribed, falls back to polling — see lib/live.ts) is hydrated and scanned,
  // newest first, so an agent's card reflects the last task it genuinely touched, not just
  // whichever task happens to be the account's overall latest. No task, or no tenant (not
  // signed in) → everyone's honestly Waiting, not a fabricated "in progress" — see
  // statusForAgent below.
  const live = useLiveEvents(tenantId);
  // Which chat conversation is open right now — moved up here (was declared much lower, with
  // the rest of the chat's own state) because `task` below needs it to scope itself. Not
  // persisted to localStorage — the mount effect further down re-resumes the most recently
  // active conversation from the server instead (chat_conversations.updated_at), the same way
  // reloading ChatGPT does, so there is nothing here to go stale. Null until the first message
  // of a brand new chat is sent, or until a past conversation is reopened.
  const convId = useRef<string | null>(null);
  // History sidebar (2026-09-04) — the list from GET /api/chat/conversations, and whether it's
  // showing. Populated lazily (on mount, and again whenever the panel opens) rather than kept
  // live-subscribed; a chat list changing under someone else's tab is not a case this needs to
  // handle instantly.
  const [convs, setConvs] = useState<{ id: string; title: string | null; updated_at: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // THE ONE ORDER THIS SCREEN IS ABOUT — scoped to the chat you're actually looking at
  // (2026-09-04). Used to be the tenant's single most recent task, full stop, which meant an
  // OLD chat's order kept narrating a brand new conversation's strip/panel/BottomBar forever
  // (owner: "old task bhi yahan pe dikha raha hai... naya chat pe naya task ho"). `tasks.
  // conversation_id` (agent-server's orchestrator already writes it, `intent.conversation_id`)
  // is the real link between a task and the chat that placed it — a scheduled/cron run has
  // none, and correctly never appears inside any specific chat's story here. A brand new,
  // still-unsent chat (`convId.current === null`) has no task of its own yet, so this is
  // deliberately `null`, not a guess at the tenant's last unrelated order. A task that is still
  // running always wins over a newer finished one within the SAME conversation, for the reason
  // the original comment already gave (2026-08-31: "har waqt same hi topic").
  const task: TaskState | null = convId.current
    ? (live.tasks.find((t) => t.conversation_id === convId.current && !isTerminalTask(t.status)) ??
      live.tasks.find((t) => t.conversation_id === convId.current) ??
      null)
    : null;
  // NOT just `!isTerminalTask(task.status)` — found live 2026-09-07: a task's top-level
  // `status` and its own `steps` can desync (the chat's live strip read "Done" while its own
  // per-agent list, two lines below in the SAME widget, still showed "Mr. Keyword: working" and
  // pending/not-started rows for the rest — a real order mid-flight, reported finished). Once
  // `hydrateTask`'s monotonic TASK_RANK guard (lib/live.ts) locks a status as terminal it can
  // never move back, so a single bad/early read there is stuck for the rest of the task's life;
  // `steps` keeps getting folded correctly the whole time (that is what the Live Visual was
  // showing streaming in), so it is the more trustworthy signal. A task the steps still call
  // pending/running is never presented as finished, whatever the status field says.
  const taskActive = !!task && (!isTerminalTask(task.status) || task.steps.some((s) => s.status === "pending" || s.status === "running"));
  // Ticks only while the newest task is actually open — a finished task's BottomBar timer is a
  // still image, same rule lib/live.ts's own useNow() doc comment states.
  const now = useNow(taskActive);
  useEffect(() => {
    for (const t of live.tasks) live.loadTask(t.task_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.tasks.length]);
  // Real counts for the sidebar's System Status card — was 4 hardcoded numbers ("8 / 10", "7",
  // "2", "32%") plus a fixed decorative sparkline, none backed by any row (found live
  // 2026-08-31). "Server Load" had no source at all (nothing measures it client-side) and is
  // dropped rather than faked; the rest come straight off `live`.
  const activeTasksList = live.tasks.filter((t) => !isTerminalTask(t.status));
  const queuedTasksList = activeTasksList.filter((t) => t.status === "queued" || t.status === "scheduled");
  // The run the LiveRunPanel narrates. Deliberately NOT `task` above: that one is scoped to the
  // chat conversation you happen to have open, and the dashboard has to show a run whoever
  // started it — the schedule, another tab, a button on the Site Brain page. Newest open task
  // first, and if the brain has not filed one yet the panel falls back to jobs_log.
  const runTask: TaskState | null = activeTasksList[0] ?? null;
  const statusForAgent = (m: AgentMeta): AgentStatus => {
    if (m.fixedStatus) return m.fixedStatus;
    // Scoped to THIS order's steps only (see `task` above). Scanning every loaded task instead
    // — which is what this did for a few hours on 2026-08-31 — meant that after a handful of
    // orders every agent had a finished step somewhere, so the whole network sat on
    // "Completed" permanently and said nothing about what was actually happening ("har agent pe
    // abhi completed dikhta hai"). An agent that has no step in this order is honestly Waiting:
    // the plan did not give it one.
    const mine = (task?.steps ?? []).filter((s) => s.agent_id === m.id);
    if (!mine.length) return "Waiting";
    if (mine.some((s) => s.status === "running")) return "Working";
    if (mine.some((s) => s.status === "done")) return "Completed";
    // pending / failed / skipped / cancelled all collapse to "Waiting" here — this roster
    // only has 3 real states (STATUS_COLOR), and "waiting for its turn" is the closest honest
    // read for a step that isn't actively running or finished.
    return "Waiting";
  };
  const agentsLeft: Agent[] = AGENT_META_LEFT.map((m) => ({ ...m, status: statusForAgent(m) }));
  const agentsRight: Agent[] = AGENT_META_RIGHT.map((m) => ({ ...m, status: statusForAgent(m) }));
  // Mr Lxwa himself — real now that boss.pick_topic (2026-08-31) means the brain can genuinely
  // be the one running: reads the same task_steps as every other agent (agent_id === "boss"),
  // just kept OUT of allAgents/realAgents below rather than added as a 10th NetCard — the brain
  // gets its own dedicated hex card (§25's reference mockup), it isn't a peer in the grid, and
  // the header pill's "+1" already counts it once. It still has to feed `workingAgent` below,
  // though — without that, Boss picking a topic would run for real with nothing on screen ever
  // showing it, and the Live Visual panel would never auto-open for it (found live 2026-08-31).
  const bossMeta: AgentMeta = { id: "boss", name: "Mr. Lxwa", role: "Command Center", icon: BrainCircuit, color: "#a78bfa" };
  const bossAgent: Agent = { ...bossMeta, status: statusForAgent(bossMeta) };
  // Mr. Publish — same treatment as the boss card above, and for the same reason: this file's
  // own comment already said Mr. Publish is "hidden from this diagram only, not because it
  // doesn't exist" (§176), but the diagram (AGENT_META_LEFT/RIGHT) was ALSO the only source
  // `allAgents`/tabs/`panelAgent` read from — so hiding it from the grid silently hid it from
  // everywhere else too. A real `publish_article` step ran with no tab of its own, no Live
  // Visual, and `workingAgent` never true for it (found live 2026-09-11, building PublishScreen
  // and discovering it could never actually be reached). Kept out of AGENT_META_RIGHT/the net
  // grid on purpose — it still isn't a NetCard peer — but fed into every OTHER lookup below.
  const publishMeta: AgentMeta = { id: "publish", name: "Mr. Publish", role: "Publishing", icon: Send, color: "#c98a2b" };
  const publishAgent: Agent = { ...publishMeta, status: statusForAgent(publishMeta) };
  const allAgents: Agent[] = [...agentsLeft, ...agentsRight];
  const realAgents = allAgents.filter((a) => a.status !== "Planned");
  const workingAgentsCount = realAgents.filter((a) => a.status === "Working").length;
  const connLabel =
    live.connected === "live" ? "All Systems Operational"
    : live.connected === "polling" ? "Reconnecting…"
    : live.connected === "connecting" ? "Connecting…"
    : "Offline";
  const connColor =
    live.connected === "live" ? "#22c55e"
    : live.connected === "polling" ? "#f59e0b"
    : live.connected === "connecting" ? "#8b8ba0"
    : "#ef4444";
  const netTop = agentsLeft.slice(0, 4);
  const netLeft = agentsLeft.slice(4, 5);
  const netRight = agentsRight.slice(0, 1);
  const netBottom = agentsRight.slice(1, 5);

  const [acctOpen, setAcctOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const userName = account.user?.name || account.user?.email?.split("@")[0] || "Signed out";
  const userInitial = userName.charAt(0).toUpperCase() || "?";
  const planName = PLANS[account.plan]?.name ?? account.plan;

  // The account panel's own copy of the truth — real database values (email, workspace name,
  // website, plan, today's per-agent usage, connected integrations, awaiting approvals), never
  // the cached lib/store.tsx `account` object above (which can sit on whatever plan/name it last
  // synced, including a stale localStorage copy from a previous session). Same endpoint
  // AppShell's older AccountMenu already used correctly (app/api/account/route.ts).
  //
  // Fetched ONCE on mount, not on every open — a real round trip to a hosted Supabase project
  // is a few hundred ms per query, and this route makes several; re-running it and blanking the
  // panel back to "Loading…" every single time the user reopened it (owner: "har bar 2-3 sec
  // loading leta hai") made something that only needs to be right-ish, not live-to-the-second,
  // feel slow on every click. Opening now shows whatever was last fetched instantly; a real
  // plan/name change still reaches the user the next time this component mounts (a page
  // navigation), and the full /dashboard/account page's own "Refresh" button is there for
  // anyone who wants it re-checked on demand right now.
  const [acctData, setAcctData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setAcctData(d);
        // Also correct the cached copy so the collapsed chip (and every other reader of
        // `account.plan`) stops showing a plan the database no longer agrees with.
        if (d?.ok && d.plan && PLANS[d.plan]) patch({ plan: d.plan, tokensMax: PLANS[d.plan].tokens });
      })
      .catch(() => setAcctData({ ok: false }));
    // `patch` deliberately excluded — lib/store.tsx hands out a new function identity on every
    // one of its own re-renders (it isn't wrapped in useCallback), and StoreProvider re-renders
    // often (toasts, chat, live polling all live in the same context). With `patch` in this
    // array the effect re-armed on nearly every render, reset acctData to null each time, and
    // the fetch never won the race — this panel was stuck on "Loading…" forever (owner report
    // 2026-09-09). Mount-once is exactly what this needs — nothing to react to afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real pending-approvals count for the sidebar badge — same /api/content endpoint the
  // Approvals page itself reads. Polled, not fake: 0 means the badge doesn't render at all.
  const [approvalsCount, setApprovalsCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/content?status=awaiting_approval")
        .then((r) => r.json())
        .then((d) => { if (alive && d.ok) setApprovalsCount(d.items?.length ?? 0); })
        .catch(() => {});
    load();
    const stop = startPolling(load, 60_000);
    return () => { alive = false; stop(); };
  }, []);

  const [nav, setNav] = useState("Dashboard");
  const [tab, setTab] = useState("Live Activity");
  const [aTab, setATab] = useState<"assistant" | "voice">("assistant");
  const [sideOpen, setSideOpen] = useState(false); // <lg drawer
  // Icon-only rail (desktop). Owner asked for a collapsible sidebar so a reading page gets the
  // full width. Remembered per browser; the article reviewer (/dashboard/content/<id>) starts
  // collapsed the first time, since that page is all about the article's width. Read in an
  // effect, never during render — localStorage on the server is a hydration mismatch.
  const [mini, setMini] = useState(false);
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem("lx-rail-mini"); } catch {}
    if (stored !== null) { setMini(stored === "1"); return; }
    setMini(/^\/dashboard\/content\/.+/.test(pathname));
  }, [pathname]);
  const toggleMini = () => {
    setMini((m) => {
      try { localStorage.setItem("lx-rail-mini", m ? "0" : "1"); } catch {}
      return !m;
    });
  };
  const [botOpen, setBotOpen] = useState(false); // <lg drawer
  // >=lg: the assistant panel is static, not a drawer, so it competes with the main content for
  // width on every page it's open on. Per the owner (2026-08-29): default it open only on the
  // main Dashboard/agent-network page, where it's the point; everywhere else default it closed
  // (a small icon reopens it) so converted pages like Connect get the full width. Computed once
  // per mount (each /dashboard/* route is its own page.tsx around <MrLxwaDashboard>, so this
  // remounts on navigation and re-reads the new pathname correctly) rather than synced via an
  // effect, so it never fights a click that already changed it this visit.
  const [desktopAssistantOpen, setDesktopAssistantOpen] = useState(() => pathname === "/dashboard");
  const closeAssistant = () => { setBotOpen(false); setDesktopAssistantOpen(false); };
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  // The chat's progress strip: one line by default, opens on the chevron (owner, 2026-08-31 —
  // the expanded card was permanently eating the chat's own room).
  const [stripOpen, setStripOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const msgInputRef = useRef<HTMLTextAreaElement>(null);
  const helloSent = useRef(false); // React 18 strict-mode double-invokes effects in dev — without
  // this the real /api/chat "__hello__" greeting was requested twice on one mount.

  // The order the chat just placed (X-Run-Job — the real `tasks.id`, see lib/chat-brain.ts's
  // `jobId: created.task_id`). "On it" was the whole reply this turn: the model cannot say what
  // the team found because it hadn't happened yet. This is how the finished result gets back
  // into the thread once `live` (Realtime, same feed the Workspace panel reads) says the task is
  // done, instead of the bubble sitting on "On it" forever while the real answer only ever shows
  // up in Workspace/Approvals.
  const orderedTaskId = useRef<string | null>(null);
  // The exact words that placed the current order — so the live-narration effect further down
  // can ask the model to answer in the SAME language the customer is actually using (English
  // stays English, Hinglish stays Hinglish), same rule the ack line already follows. `pendingOrder`
  // state gets cleared the moment a task/agent shows up, well before steps finish, so it cannot
  // be reused here.
  const lastOrderMessageRef = useRef<string>("");
  // The in-flight turn's own controller, so the Stop button (owner, 2026-09-10: "jaisa ChatGPT
  // Claude pe hota hai, ek esc/pause btn") can actually abort the fetch instead of just hiding
  // it — a real ChatGPT/Claude-style stop, not a cosmetic one.
  const streamAbortRef = useRef<AbortController | null>(null);
  // The same order, in state rather than a ref, purely so LiveRunPanel can say "Queued" the
  // instant the chat accepts it. Cleared as soon as a real task or a working agent shows up —
  // it is a placeholder for the first second or two, never a claim of its own.
  const [pendingOrder, setPendingOrder] = useState<string | null>(null);
  const reportedTaskIds = useRef<Set<string>>(new Set());
  const startedLiveBubble = useRef<Set<string>>(new Set());
  // Which steps have already gotten a narration bubble (below) — keyed by the step's own `key`,
  // never re-fired for the same step even across re-renders/reconnects.
  const narratedStepIds = useRef<Set<string>>(new Set());
  // Which tasks have had their "steps already done before this view even opened" baselined —
  // without this, opening/reloading the page mid-run (or on an already-finished task) would
  // burst-narrate every historical step at once instead of only what finishes from here on.
  const narrationBaseline = useRef<Set<string>>(new Set());

  // The agent panel (live activity, timeline, search results) exists to show ONE agent's
  // live work — it only makes sense while an agent is actually working. `workingAgent` is
  // that fact; `showPanel` is the user's own choice to look at it or step back to the whole
  // team (the "Back to Workflow" button), independent of whether anyone is still working.
  // Mr Lxwa checked first: when a plan starts with his own pick_topic step, he is the one
  // actually running before anyone else even has a step to run — the panel should open on him,
  // not sit closed until Mr. Keyword picks up afterward.
  const workingAgent =
    bossAgent.status === "Working" ? bossAgent : allAgents.find((a) => a.status === "Working") ?? (publishAgent.status === "Working" ? publishAgent : null);
  // The compact agent strip (below, only visible once a panel is open) auto-scrolls so whoever
  // is actually working is always the one centered — a full-automation feel where the camera
  // follows the work, not a manual "you scroll to find them" (owner 2026-09-09: "jo agent us
  // waqt work kare wo scroll hoke center pe aaya"). Keyed off the id (a string, stable across
  // re-renders) rather than the workingAgent object itself, which is a fresh reference every
  // render.
  const compactStripRef = useRef<HTMLDivElement>(null);
  // The Live Visual's own scroll box. The canvas inside it can grow far past its 460px window
  // (a long article, 40 crawled pages), and the thing worth watching is always the newest
  // thing — so when a run is live, this follows it down the way a terminal follows its own
  // output. Without it the agent cursor and the paragraph being written sat below the fold and
  // the owner never saw either (found live 2026-09-11: "cursor hand-moving animation... ispe
  // nahi ha" — it WAS there, 1,700px below the visible window).
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!workingAgent) return;
    const el = compactStripRef.current?.querySelector<HTMLElement>(`[data-agent-id="${workingAgent.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [workingAgent?.id]);
  const [showPanel, setShowPanel] = useState(!!workingAgent);
  useEffect(() => {
    // The moment there is something real to show — a task row, or an agent whose jobs_log row
    // says it is working — the placeholder gets out of the way.
    if (pendingOrder && (runTask || workingAgent)) setPendingOrder(null);
  }, [pendingOrder, runTask, workingAgent]);
  // Which agent the user asked to look at, by clicking its card. Null = "just follow the work"
  // (whoever is running, else whoever ran last). Set by openAgentPanel below; cleared when the
  // panel is closed, so the next auto-open follows the work again rather than being stuck on
  // an agent the user looked at ten minutes ago.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  // Follow the work: the moment a DIFFERENT agent starts running, drop whatever tab the user
  // had clicked so the panel opens on the one now working (owner, 2026-09-10: "jo working hai
  // wohi tab apne aap open hoke rahe"). A click still sticks for as long as that same agent is
  // the one running; only a real hand-off resets it. Keyed off the id, not the object.
  useEffect(() => {
    setSelectedAgentId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingAgent?.id]);
  // Auto-open the Live Visual the moment an agent actually starts working (owner, 2026-09-10:
  // "jo agent kaam kare uska live visual open nahi ho raha" — restores this after an earlier
  // pass removed auto-open entirely; that removal is kept for "opening on every new order" in
  // general, but the owner now wants the working agent's own screen to open itself, not require
  // a manual click). The user's own close (X) still wins until the NEXT hand-off — this only
  // fires again when `workingAgent.id` actually changes.
  useEffect(() => {
    if (workingAgent) setShowPanel(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingAgent?.id]);
  // The panel used to require `workingAgent`, so it vanished the instant the last step finished
  // — the user watched it disappear exactly when the result became worth reading. It now stays
  // on whatever task it was opened for until the user closes it (X), which is also what makes
  // the finished state readable at all.
  const panelOpen = showPanel && !!task;
  // Who the panel is about: the agent the user clicked, else whoever is working, else whoever
  // ran most recently in this task — never a hardcoded "Mr. Writer" fallback, which is what it
  // used to show for every agent.
  const lastStep = task ? [...task.steps].filter((s) => s.startedAt != null).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] : null;
  // Last resort: whoever actually PRODUCED something on this order. Without it a finished order
  // opened on "Team" with the generic item list instead of that agent's own screen — the panel
  // had auto-opened before any step existed, nothing was ever selected, and `lastStep` needs a
  // `startedAt` that a step only gets once it runs.
  const producerAgent = task?.agents.find((p) => p.items.length)?.agent_id ?? null;
  const panelAgent =
    (selectedAgentId ? [...allAgents, bossAgent, publishAgent].find((a) => a.id === selectedAgentId) ?? null : null) ??
    workingAgent ??
    (lastStep ? [...allAgents, bossAgent, publishAgent].find((a) => a.id === lastStep.agent_id) ?? null : null) ??
    (producerAgent ? [...allAgents, bossAgent, publishAgent].find((a) => a.id === producerAgent) ?? null : null);
  // NOT auto-opened on a new order any more (owner, 2026-09-10: the detailed per-agent view
  // "accurate live nahi hai" — remove it from the home dashboard's default view; the compact
  // LiveRunPanel strip + the full AI Agent Network grid are the home dashboard now). The panel
  // still opens the moment the user actually asks for it — its own "Open" button, or clicking an
  // agent's card directly (openAgentPanel below) — never on its own.

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, aTab]);

  // grows the chat textarea to fit whatever's typed (capped, then it scrolls internally)
  // instead of hiding the tail of a long message behind a fixed one-line box.
  useEffect(() => {
    const el = msgInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 88)}px`;
  }, [msg]);

  // Typing anywhere on the dashboard (outside another input/textarea/editable element)
  // drops the keystroke straight into the chat box instead of being lost on the page —
  // opens the assistant panel if it's closed so the user can see what they're typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const el = msgInputRef.current;
      if (!el) return;
      e.preventDefault();
      setBotOpen(true);
      setDesktopAssistantOpen(true);
      setATab("assistant");
      // focus synchronously — the next keydown (incl. an OS auto-repeat from a held
      // key) then targets the textarea directly, so this handler never double-fires
      // for the same keystroke. Falls back to a rAF focus only for the one-off case
      // where the panel itself was still hidden/closed at the moment of this call.
      el.focus();
      if (document.activeElement !== el) requestAnimationFrame(() => msgInputRef.current?.focus());
      setMsg((m) => m + e.key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Real chat — POSTs to the same /api/chat the production BossChat uses (components/kit.tsx),
   *  and relays the streamed token chunks into the last bubble as they arrive. No ctx (plan,
   *  tokens, memory) and no system-event cards yet — those read from the old dashboard's
   *  zustand store (useStore()), which this component doesn't have; a plain reply is still a
   *  REAL model turn, persisted server-side to chat_conversations/chat_messages. */
  const stream = async (q: string) => {
    setChatBusy(true);
    lastOrderMessageRef.current = q;
    setThread((p) => [...p, { who: "ai", text: "", time: nowTime(), live: true }]);
    const controller = new AbortController();
    streamAbortRef.current = controller;
    let full = "";
    // Flips the still-empty bubble from "…" to a "still working" line after 6s. `send()`
    // blocks a second order while `chatBusy`, so exactly one live bubble exists at a time —
    // `next.length - 1` safely means THIS bubble, same assumption the rest of this function
    // already relies on for streamed tokens and the failure message.
    const slowTimer = setTimeout(() => {
      if (full) return; // a token already arrived — no longer "…", nothing to flip
      setThread((p) => {
        const i = p.length - 1;
        if (!p[i]?.live || p[i].text) return p;
        const next = [...p];
        next[i] = { ...next[i], slow: true };
        return next;
      });
    }, 6000);
    try {
      const history = thread
        .filter((m) => m.text.trim() && !m.live && !m.failed)
        .slice(-8)
        .map((m) => ({ role: m.who === "user" ? "user" : "assistant", content: m.text.slice(0, 700) }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, ctx: {}, history, conversationId: convId.current }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const returned = res.headers.get("X-Conversation-Id");
      if (returned) convId.current = returned;
      const runJob = res.headers.get("X-Run-Job");
      if (runJob) {
        orderedTaskId.current = runJob;
        setPendingOrder(q.trim().slice(0, 120));
        // Tag THIS bubble — the one about to fill with the model's own real acknowledgment —
        // with the task id right now, before the live-status effect below ever runs. Without
        // this it had no way to find this bubble and pushed a SECOND one instead, so an order
        // showed two assistant replies: the real ack (in the customer's own language) and a
        // separate hardcoded "Got it! I've assigned the task..." card, always in English (owner
        // report 2026-09-10, live on Vercel: "chat box pe kuch data duplicate ata hai").
        setThread((p) => {
          const i = p.length - 1;
          if (p[i]?.who !== "ai") return p;
          const next = [...p];
          next[i] = { ...next[i], taskId: runJob };
          return next;
        });
        // Fetch this task's real row the instant its id is known, instead of waiting on
        // Realtime's first broadcast (or, if the channel is not yet SUBSCRIBED, the up-to-6s
        // "connecting" grace period before the poll fallback even starts — see lib/live.ts's
        // useLiveEvents). Without this the Live Visual sat on the `pendingOrder` placeholder
        // for a couple of real seconds even though the row already existed the moment
        // /api/chat answered; loadTask()'s own pull() reads it directly, no broadcast needed.
        live.loadTask(runJob);
      }
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
        // An accepted order replies with a real acknowledgment sentence now (lib/chat-brain.ts,
        // lib/chat-brain-intent.ts's ackLine/REPLY_FIELD) — this only still fires for the rare
        // case a model call genuinely returned nothing at all. Drop the placeholder instead of
        // leaving an empty bubble behind.
        if (!full.trim()) return p.slice(0, -1);
        const next = [...p];
        next[next.length - 1] = { ...next[next.length - 1], text: full, live: false };
        return next;
      });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // The user hit Stop (below) — a real abort of this fetch, not a network failure. Drop
        // both this turn's bubbles (the user's message and whatever partial reply arrived) and
        // hand their own words back to the composer so they can change it and send again, same
        // as the owner asked for ("dobara us chat pe changes karke send kare"). The task-cancel
        // half (if this turn had already become a real order) happens in stopGenerating() below
        // — this catch only ever runs after that has already been requested.
        setThread((p) => p.slice(0, -2));
        setMsg(q);
        requestAnimationFrame(() => msgInputRef.current?.focus());
        return; // `finally` below still clears the timer and chatBusy
      }
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
      clearTimeout(slowTimer);
      setChatBusy(false);
    }
  };

  /** ChatGPT-style conversation history (2026-09-04, owner: "chat history rahe... har chat pe
   *  alag task"). The backend for this already existed and was already proven — `/api/chat/
   *  conversations*` (migration 011) is exactly what components/kit.tsx's older BossChat widget
   *  already uses on the legacy /app/** route group; this just wires the SAME endpoints into
   *  today's /dashboard chat, which never had a history UI of its own. Reusing the endpoints
   *  and the open/new/delete shape verbatim rather than inventing a second contract for the
   *  same job. */
  async function refreshConvs() {
    try {
      const r = await fetch("/api/chat/conversations").then((res) => res.json());
      if (r?.ok) setConvs(r.conversations ?? []);
    } catch {
      // Migration 011 not applied, or offline — chat still works, it just won't remember.
    }
  }

  // Shared with the mount effect below, which already has its messages in hand (folded into
  // the conversations-list response) and must not re-fetch them just to reuse this mapping.
  const messagesToThread = (messages: any[]): ThreadMsg[] =>
    (messages ?? [])
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .map(
        (m: any): ThreadMsg => ({
          who: m.role === "user" ? "user" : "ai",
          text: String(m.content ?? ""),
          time: m.created_at
            ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase()
            : "",
        })
      );

  async function openConversation(id: string) {
    try {
      const r = await fetch(`/api/chat/conversations/${id}`).then((res) => res.json());
      if (!r?.ok) return;
      convId.current = id;
      orderedTaskId.current = null;
      setThread(messagesToThread(r.messages));
      setShowHistory(false);
    } catch {}
  }

  function newChat() {
    convId.current = null;
    orderedTaskId.current = null;
    setThread([]);
    setShowHistory(false);
    // No chat_conversations row is created until a real message is sent — same as ChatGPT, and
    // the same rule ensureConversation()/app/api/chat/route.ts already enforces server-side.
    void stream("__hello__");
  }

  async function deleteConversation(id: string) {
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      return;
    }
    setConvs((c) => c.filter((x) => x.id !== id));
    if (id === convId.current) newChat();
  }

  useEffect(() => {
    if (helloSent.current) return;
    helloSent.current = true;
    (async () => {
      // Resume the most recently active conversation, same rule a reload of ChatGPT follows —
      // `chat_conversations.updated_at` already moves on every real turn (app/api/chat/route.ts's
      // saveTurn), so "most recent" here is never stale. Falls through to a fresh "__hello__"
      // when there is no history yet (a brand new tenant) or the history call itself fails.
      try {
        const r = await fetch("/api/chat/conversations").then((res) => res.json());
        if (r?.ok && r.conversations?.length) {
          setConvs(r.conversations);
          const id = r.conversations[0].id;
          // The list response already carries this one's messages (app/api/chat/
          // conversations/route.ts) — use them directly instead of a second round trip
          // through openConversation, which is what used to leave "Connecting to Mr. Lxwa…"
          // on screen for two serial network hops on every single page load.
          const thread = r.latestMessages?.id === id ? messagesToThread(r.latestMessages.messages) : null;
          if (thread) {
            // A most-recent conversation row with zero messages is a real, if rare, case — a
            // `newChat()`/POST created it but nothing was ever sent into it before the tab was
            // closed. Found live 2026-09-10: the dashboard then resumed that same empty row on
            // every reload forever, set an empty thread, and sat on "Connecting to Mr. Lxwa…"
            // with nothing left to do about it — no message ever arrives for an empty thread to
            // wait for. Same rule as "no history at all": greet fresh.
            if (thread.length === 0) {
              void stream("__hello__");
              return;
            }
            convId.current = id;
            orderedTaskId.current = null;
            setThread(thread);
            setShowHistory(false);
          } else {
            await openConversation(id);
          }
          return;
        }
      } catch {}
      void stream("__hello__");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    const t = msg.trim();
    if (!t || chatBusy) return;
    setThread((p) => [...p, { who: "user", text: t, time: nowTime() }]);
    setMsg("");
    void stream(t);
  };

  /** The order's own live status line — one bubble per task (`taskId`, found/updated by that
   *  key, never duplicated), updated in place as real events arrive instead of sitting on "On
   *  it" until the whole thing is over. 2026-08-31, the owner's own words: "sirf on it nahi ho".
   *  While the task runs, its text is the running step's own label/progress (or the latest
   *  recorded line) — real sentences the brain already wrote for a human (lib/live.ts's
   *  `userMessage()`), never invented here. Once terminal, the SAME bubble is overwritten with
   *  the final summary and stops being `live`.
   *
   *  THE FINAL SUMMARY LINE COMES FROM `t.status`/`t.reason`, NOT `t.lines[last]`. Found live
   *  2026-08-29: `hydrateTask()` and a live broadcast update `state` in two separate `setState`
   *  calls (status+steps first, the event history that fills `lines` a beat later — see
   *  lib/live.ts's `pull()`), so this effect could fire the instant `isTerminalTask` turned
   *  true but before the "Done" line had arrived, and permanently report a mid-run progress
   *  label ("Learning how they write...") as if it were the final answer. `status`/`reason` are
   *  set atomically with the terminal transition in both hydrate and fold, so they can't be
   *  caught mid-update — the live (non-terminal) phase above has no such guarantee, which is
   *  fine there: showing one event slightly behind is harmless, the risk is only ever in what
   *  gets written down as final. */
  useEffect(() => {
    const id = orderedTaskId.current;
    if (!id) return;
    const t = live.byTask[id];
    if (!t) return;

    // NOT just `!isTerminalTask(t.status)` — the same class of status/steps desync as
    // `taskActive` above, only in the opposite direction: here `t.status` can stay non-terminal
    // for a while AFTER every one of its steps already finished, so this "still working" bubble
    // kept saying so well after the Live Visual panel (which reads step-level state) had already
    // shown the finished result (owner report 2026-09-09). A task whose steps are all terminal
    // is over, whatever the status field says yet.
    const allStepsDone = t.steps.length > 0 && t.steps.every((s) => isTerminalStep(s.status));
    if (!isTerminalTask(t.status) && !allStepsDone) {
      const runningNow = t.steps.find((s) => s.status === "running");
      const latestLine = t.lines[t.lines.length - 1];
      // A per-STEP completion line (a bare "Done", written when whichever step just finished)
      // is not a description of what the TASK is doing now — it is the tail end of what it just
      // did. Between one step finishing and the next one starting there is briefly no
      // `runningNow`, and falling back to that line put the word "Done" on a task that was very
      // much still running (found live 2026-09-07, reproduced: Mr. Keyword's own last line was
      // literally "Done" while Mr. Writer/SEO/Image hadn't run yet). Only a genuinely
      // descriptive latest line is used; a bare completion word gets the same honest "between
      // steps" text as having no line at all.
      const isStepDoneLine = (s?: string) => !!s && /^(done|finished)\.?$/i.test(s.trim());
      const liveText =
        runningNow?.progressLabel ||
        runningNow?.label ||
        (latestLine?.text && !isStepDoneLine(latestLine.text) ? latestLine.text : null) ||
        "Starting the next step…";
      // The plan, checklist-style — same rows the collapsed strip above the composer reads
      // (task.steps, real task_steps rows), just also rendered inline here per the owner's
      // reference mockup. Empty until the planner has actually written steps for this task.
      const planSteps = t.steps.map((st) => ({
        label: [...allAgents, bossAgent, publishAgent].find((a) => a.id === st.agent_id)?.name ?? st.agent_id,
        status: st.status,
      }));
      // No CTA button yet — "View in Live Visual" only belongs on the finished summary (the
      // terminal branch below sets its own), not on a task that has barely started (owner
      // 2026-09-10: it was showing up mid-conversation, well before there was anything finished
      // worth looking at).
      setThread((p) => {
        // Attach the evolving checklist to the bubble stream() already tagged with this taskId
        // the moment the order was accepted — that bubble's own `text` is the model's real
        // acknowledgment (in the customer's own language) and is never overwritten here; only
        // `planSteps` changes as the plan progresses. A second, separate bubble for the same
        // order is exactly the duplicate the owner reported.
        const i = p.findIndex((m) => m.taskId === id);
        if (i >= 0) {
          const prev = p[i];
          if (prev.live === true && JSON.stringify(prev.planSteps) === JSON.stringify(planSteps)) return p;
          const next = [...p];
          next[i] = { ...next[i], live: true, planSteps };
          return next;
        }
        // Fallback: this effect fired before stream() had a chance to tag its own bubble (a
        // narrow timing case, e.g. a task order placed by a path other than the chat composer).
        if (!startedLiveBubble.current.has(id)) {
          startedLiveBubble.current.add(id);
          return [...p, { who: "ai", text: liveText, time: nowTime(), live: true, taskId: id, planSteps }];
        }
        return p;
      });
      return;
    }

    if (reportedTaskIds.current.has(id)) return;
    reportedTaskIds.current.add(id);

    const summary =
      t.status === "failed" || t.status === "needs_attention"
        ? t.reason || "Something went wrong — no reason was given."
        : t.status === "published"
          ? "Live on your site."
          : t.status === "cancelled"
            ? "Cancelled."
            : t.status === "awaiting_approval"
              ? "Done — it's waiting in Approvals."
              : "Done.";
    // ONE line, not the whole list — twelve rows pasted into the transcript pushed every other
    // message off screen and duplicated what the Live Visual shows far better. Written from
    // whatever the order actually produced (summariseProduced), so an image, article or lead run
    // reads correctly without this branch knowing any of those words.
    const produced = summariseProduced(t.items);
    const text = produced ? `${produced.count} ${plural(produced.kind, produced.count)} ready` : summary;
    if (!text) return;
    // The highlight rides as its own chip, not glued into the sentence: it is a keyword / title,
    // and it should look like one.
    const chip = produced?.headline ?? undefined;
    const cta = produced ? { label: "View in Live Visual", agentId: produced.agentId ?? undefined } : undefined;
    setThread((p) => {
      const i = p.findIndex((m) => m.taskId === id);
      if (i < 0) return [...p, { who: "ai", text, time: nowTime(), taskId: id, chip, cta }];
      const next = [...p];
      next[i] = { ...next[i], text, live: false, chip, cta };
      return next;
    });

    // Upgrade "8 keywords ready" into a real sentence naming what was actually produced/picked
    // (owner, 2026-09-10: "real ai answer dega ki ye keyword select kiya gaya hai, normal chat
    // jaisa") — the template above ships immediately so the bubble is never left stale while
    // this resolves, and this quietly replaces it if the model answers in time.
    if (produced) {
      const agentName = [...allAgents, bossAgent, publishAgent].find((a) => a.id === produced.agentId)?.name ?? "The team";
      fetch("/api/chat/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName,
          stepLabel: `the whole order — found ${produced.count} ${plural(produced.kind, produced.count)}`,
          subject: produced.headline ?? undefined,
          producedCount: produced.count,
          message: lastOrderMessageRef.current,
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (!d?.ok || !d.text) return;
          setThread((p) => {
            const i = p.findIndex((m) => m.taskId === id);
            if (i < 0) return p;
            const next = [...p];
            next[i] = { ...next[i], text: d.text };
            return next;
          });
        })
        .catch(() => {});
    }
  }, [live.byTask]);

  /** Live progress narration — a genuinely model-written sentence for every step as it finishes
   *  ("Mr. Keyword ne apna kaam kar diya hai" style), as its own new chat bubble rather than
   *  folded into the one running-status line above (that line still owns "what's happening
   *  right now"; these are a stream of "X just finished" moments). The owner chose this over
   *  the free, template-based option when asked directly about the extra cost/latency it adds —
   *  one real call to app/api/chat/narrate per step (2026-09-09). */
  useEffect(() => {
    const id = orderedTaskId.current;
    if (!id) return;
    const t = live.byTask[id];
    if (!t) return;

    if (!narrationBaseline.current.has(id)) {
      narrationBaseline.current.add(id);
      for (const s of t.steps) if (s.status === "done") narratedStepIds.current.add(s.key);
      return;
    }

    for (const s of t.steps) {
      if (s.status !== "done" || narratedStepIds.current.has(s.key)) continue;
      narratedStepIds.current.add(s.key);
      const agentName = [...allAgents, bossAgent, publishAgent].find((a) => a.id === s.agent_id)?.name ?? s.agent_id;
      const stepLabel = s.label || (s.action ? s.action.replace(/_/g, " ") : "a step");
      // Whether this step actually produced anything — without this the narrator had no way to
      // know a "finished" step came back empty, and cheerfully announced a keyword list that
      // did not exist (owner report 2026-09-10, live: "Mr. Keyword ne aaj keywords ki list
      // finalize kar li hai" for a run that produced zero keywords).
      const producedCount = t.agents.find((p) => p.agent_id === s.agent_id)?.items.length ?? 0;
      fetch("/api/chat/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName, stepLabel, producedCount, message: lastOrderMessageRef.current }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (!d?.ok || !d.text) return; // provider unavailable/slow — say nothing this time
          setThread((p) => [...p, { who: "ai", text: d.text, time: nowTime() }]);
        })
        .catch(() => {});
    }
  }, [live.byTask]);

  /* ---------------------------------------------------------------------- */

  const Sidebar = (
    <aside
      className={`lx-panelL fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col transition-transform duration-300 lg:static lg:translate-x-0 ${
        mini ? "w-48 lg:w-[68px]" : "w-48"
      } ${sideOpen ? "translate-x-0" : "-translate-x-full"}`}
    >
      {/* logo */}
      <div className={`flex items-center gap-3 pt-5 pb-4 ${mini ? "px-3 lg:justify-center" : "px-4"}`}>
        <LogoMark size={30} />
        <div className={`min-w-0 ${mini ? "lg:hidden" : ""}`}>
          <div className="text-sm font-bold leading-tight">Mr. Lxwa</div>
          <div className="lx-10 lx-mut leading-tight">AI Automation System</div>
        </div>
        {/* rendered conditionally, not class-toggled: "hidden lg:inline-flex lg:hidden" is two
            lg display utilities fighting, and inline-flex wins in Tailwind's output order */}
        {!mini && (
          <button className="lx-icobtn ml-auto hidden lg:inline-flex" onClick={toggleMini} aria-label="Collapse sidebar" title="Collapse sidebar">
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>

      {/* nav — items with a real href (see NAV's own comment) are real next/link navigation
          to the still-live app/app/** pages; the rest stay a local highlight only. */}
      <nav className={`lx-scroll flex-1 space-y-1 overflow-y-auto ${mini ? "px-2" : "px-3"}`}>
        {/* expand lives inside <nav>, styled as a nav row: any other container (mx-auto on the
            68px rail) misses the scrollbar the nav reserves and the icon sits off-column. */}
        {mini && (
          <button
            className="lx-nav relative mb-1 hidden lg:flex lg:justify-center lg:px-0"
            onClick={toggleMini}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelLeftOpen size={16} strokeWidth={1.8} />
          </button>
        )}
        {NAV.map((it) => {
          // A sub-page keeps its section lit — /dashboard/content/<id> (the article reviewer)
          // is still "Content". Exact match everywhere else, so /dashboard never lights up for
          // every /dashboard/** page.
          const active = it.href
            ? pathname === it.href || (it.href !== "/dashboard" && pathname.startsWith(it.href + "/"))
            : nav === it.label;
          const badge = it.label === "Approvals" ? approvalsCount : it.badge;
          const inner = (
            <>
              <it.icon size={16} strokeWidth={1.8} />
              <span className={`truncate ${mini ? "lg:hidden" : ""}`}>{it.label}</span>
              {badge ? (
                <span
                  className={`flex items-center justify-center rounded-full font-bold text-white ${
                    mini ? "lx-10 ml-auto h-5 w-5 lg:absolute lg:right-1 lg:top-1 lg:ml-0 lg:h-4 lg:w-4" : "lx-10 ml-auto h-5 w-5"
                  }`}
                  style={{ background: "linear-gradient(135deg,#7c3aed,#8b5cf6)", boxShadow: "0 0 10px rgba(139,92,246,.6)" }}
                >
                  {badge}
                </span>
              ) : null}
            </>
          );
          const cls = `lx-nav relative ${active ? "on" : ""} ${mini ? "lg:justify-center lg:px-0" : ""}`;
          return it.href ? (
            <Link key={it.label} href={it.href} className={cls} title={mini ? it.label : undefined}>
              {inner}
            </Link>
          ) : (
            <button key={it.label} className={cls} onClick={() => setNav(it.label)} title={mini ? it.label : undefined}>
              {inner}
            </button>
          );
        })}

        {/* system status — every number below reads off `live` (lib/live.ts's useLiveEvents),
            not a mock. Was 4 hardcoded numbers + a fixed decorative sparkline until 2026-08-31
            (found live: it kept claiming "7 active tasks" with nothing running). "Server Load"
            had no client-side source at all and is dropped rather than faked. */}
        <div className={`lx-card2 mt-4 p-3 ${mini ? "lg:hidden" : ""}`}>
          <div className="flex items-center gap-2">
            <span className="lx-pulse h-2 w-2 rounded-full" style={{ background: connColor, boxShadow: `0 0 8px ${connColor}` }} />
            <span className="lx-12 font-semibold">System Status</span>
          </div>
          <div className="lx-10 lx-mut mt-1">{connLabel}</div>

          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between lx-11">
              <span className="lx-mut">Agents Working</span>
              <span className="font-medium">{workingAgentsCount} / {realAgents.length}</span>
            </div>
            <div className="flex items-center justify-between lx-11">
              <span className="lx-mut">Active Tasks</span>
              <span className="font-medium">{activeTasksList.length}</span>
            </div>
            <div className="flex items-center justify-between lx-11">
              <span className="lx-mut">Queued</span>
              <span className="font-medium">{queuedTasksList.length}</span>
            </div>
          </div>
        </div>
      </nav>

      {/* user — clicking this expands the panel below IN PLACE (owner 2026-09-09: "popup
          nahi, wahi tab extend ho smoothly") instead of a floating popover on top of the page.
          acctData (fetched fresh above, real database values) corrects the plan/company line
          the instant this opens, instead of trusting whatever lib/store.tsx had cached. Text
          uses a neutral gray (#9a9ab2, the same tone lx-ghost's own label already uses) rather
          than the theme's violet-tinted --lx-mut, which read as unprofessional here. */}
      <div className={mini ? "p-1.5" : "p-2"}>
        <button
          className={`lx-card2 flex w-full items-center gap-2 text-left ${mini ? "p-1 lg:justify-center" : "p-1.5"}`}
          onClick={() => { setConfirmSignOut(false); setAcctOpen((o) => !o); }}
          title={mini ? `${userName} \u00b7 ${planName}` : undefined}
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444 60%,#7c3aed)" }}
          >
            {userInitial}
          </span>
          <span className={`min-w-0 flex-1 ${mini ? "lg:hidden" : ""}`}>
            <span className="block truncate lx-11 font-semibold">{userName}</span>
            <span className="block truncate lx-10" style={{ color: "#9a9ab2" }}>
              {acctData?.ok ? (PLANS[acctData.plan]?.name ?? acctData.plan ?? planName) : planName}
              {acctData?.ok && acctData.website ? ` · ${String(acctData.website).replace(/^https?:\/\//, "")}` : ""}
            </span>
          </span>
          <ChevronDown
            size={13}
            className={`lx-mut transition-transform ${mini ? "lg:hidden" : ""}`}
            style={{ transform: acctOpen ? "rotate(180deg)" : undefined }}
          />
        </button>

        {/* Redesigned as a real menu (owner 2026-09-09: "view my account bilkul pasand nahi
            aaya, clean tarike se, best UI UX") — icon-led menu rows with their own hover state
            (.lx-menurow), instead of stacked plain text plus a lone link plus a full-width ghost
            button. No profile row here anymore: the trigger button right above already shows
            name, plan and website, so repeating avatar+email here was the same identity twice
            in the same breath (owner: "heysamiul wala chiz badi dikh rahi hai, ek baar dikhao").
            Collapsed (mini, desktop) rail is too narrow for "View full account" to read well, so
            it keeps only Sign out there — same reasoning the chevron/name text already follow
            (lg:hidden) in that state. */}
        <div className={`lx-expand ${acctOpen ? "open" : ""}`}>
          <div>
            <div className="lx-card2 mt-1.5 overflow-hidden" style={{ padding: 4 }}>
              {!mini && (
                <>
                  {!acctData && <div className="lx-10 px-3 py-2" style={{ color: "#9a9ab2" }}>Loading…</div>}
                  {acctData && !acctData.ok && (
                    <div className="lx-10 px-3 py-2" style={{ color: "#f87171" }}>Couldn't load your account.</div>
                  )}
                  <Link href="/dashboard/account" className="lx-menurow" onClick={() => setAcctOpen(false)}>
                    <User size={13} className="lx-mut" /> View full account
                  </Link>
                </>
              )}
              <button
                className="lx-menurow danger"
                onClick={() => {
                  if (!confirmSignOut) { setConfirmSignOut(true); return; }
                  void signOut();
                }}
              >
                <LogOut size={13} /> {confirmSignOut ? "Click again to confirm" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );

  /* ---------------------------------------------------------------------- */

  // Only a working agent is ever clickable — the panel shows real live activity for it, and
  // there is no fake content to show for one that's idle. Clicking any of the other 9 icons
  // does nothing, same as they'd be inert in the real dashboard until they actually start.
  // EVERY card opens its own agent's live view — including Mr Lxwa's brain card, and including
  // agents that are idle or already finished. It used to open only for an agent whose status
  // was exactly "Working", so nine of the ten cards were inert clicks and the user could never
  // ask "what did Mr. Keyword actually do?" after it finished (owner's ask, 2026-08-31).
  // Nothing on the roster is fixed to "Planned" any more (Mr. Image and Mr. Story both shipped
  // 2026-09-05/06) — this guard is kept for the day a genuinely unbuilt agent joins the roster.
  const openAgentPanel = (a: Agent) => {
    if (a.status === "Planned") return;
    setSelectedAgentId(a.id);
    setShowPanel(true);
  };
  const closeAgentPanel = () => {
    setShowPanel(false);
    setSelectedAgentId(null);
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
        <div className="lx-scroll overflow-x-auto" ref={compactStripRef}>
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
    </section>
  );

  // The "AI Agent Network" full grid — resting-dashboard content only. Owner, 2026-09-10:
  // showing it underneath the Live Visual panel too (an earlier pass here) was confusing, not
  // helpful — once the panel is open you're already looking at one agent's own live screen,
  // and the whole-roster grid right below it was clutter. Back to strictly !panelOpen.
  const Network = !panelOpen && (
    <section className="lx-card relative overflow-hidden">
      <AgentNetwork
        top={netTop}
        left={netLeft}
        right={netRight}
        bottom={netBottom}
        bossAgent={bossAgent}
        totalActive={realAgents.length + 1}
        running={realAgents.filter((a) => a.status === "Working").length}
        completed={realAgents.filter((a) => a.status === "Completed").length}
        workingAgent={workingAgent}
        onOpen={openAgentPanel}
      />
    </section>
  );

  /* ---------------------------------------------------------------------- */

  // Real data for the panel below — all derived from `task` (the newest live task for this
  // tenant). `workingAgent` only exists when some step is genuinely "running", so everywhere
  // below that reads `task` inside AgentPanel is only ever reached with a real task present.
  // Everything the panel shows is scoped to `panelAgent` — the card the user clicked (or, if
  // they clicked nothing, whoever is working). Before this it always showed the whole task's
  // combined output no matter which agent you were looking at, so clicking Mr. Keyword and
  // clicking Mr. Writer rendered exactly the same panel.
  const panelStep =
    (panelAgent ? task?.steps.find((s) => s.agent_id === panelAgent.id && s.status === "running") : null) ??
    (panelAgent ? [...(task?.steps ?? [])].filter((s) => s.agent_id === panelAgent.id).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] : null) ??
    null;
  const runningStep = panelStep?.status === "running" ? panelStep : null;
  // The count of steps DONE across the whole task — NOT panelStep's own array position, which
  // is what this used to be (`task.steps.findIndex(s => s.key === panelStep.key) + 1`). That
  // read as "Step 1 of 4" for as long as the card you had open happened to sit first in the
  // steps array, whether or not that step — or any other — had actually finished (found live
  // 2026-09-07: stuck on "Step 1 of 4 · 0%" while Mr. Keyword had already finished and Mr. Image
  // was mid-run). "Step N of M" now means the same thing everywhere it's shown, task-wide —
  // matching barDoneSteps below, which is the same count for the same reason.
  const stepNo = task ? task.steps.filter((s) => s.status === "done").length : null;
  const totalSteps = task?.totalSteps ?? task?.steps.length ?? null;
  // Real progress numbers off `task` — used by BOTH the chat's live strip and the bottom bar,
  // so they are declared here, before either is built (a `const` used above its declaration in
  // the same scope is a runtime TDZ crash, not a type error).
  // The exact thing this order produced, so "Review" opens THAT article instead of dumping the
  // user on the Approvals list to hunt for it. `contentItemId` is the writer's own return value
  // (agent-server/src/agents/writer.ts), carried through task_steps.output — no guessing, and
  // no link at all when there is nothing to open.
  const reviewHref = (() => {
    for (const st of task?.steps ?? []) {
      const id = st.output?.contentItemId;
      if (typeof id === "string" && id) return `/dashboard/content/${id}`;
    }
    return null;
  })();
  const barDoneSteps = task ? task.steps.filter((s) => s.status === "done").length : 0;
  const barTotalSteps = task ? task.totalSteps ?? task.steps.length : 0;
  const barPct = barTotalSteps ? Math.round((barDoneSteps / barTotalSteps) * 100) : 0;
  const producedItems = task
    ? task.agents
        .filter((p) => !panelAgent || p.agent_id === panelAgent.id)
        .flatMap((p) => p.items)
        .sort((a, b) => a.at - b.at)
    : [];
  // Follow the work down the canvas. Every screen below grows downward as real items land, and
  // the 460px scroll box shows only its top — so the newest row, the paragraph being written and
  // the agent cursor pinned to it were all below the fold, invisible, unless the owner scrolled
  // by hand every few seconds. Only while the step is genuinely RUNNING (a finished run is left
  // exactly where the reader put it), and only from the bottom of the box: `scrollHeight` is read
  // after the commit that added the item, so this never guesses where the new content is.
  useEffect(() => {
    if (!runningStep) return;
    const el = canvasScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [producedItems.length, runningStep?.key, runningStep?.progressLabel]);
  // This agent's OWN sentences only. Used to also let through the task-level, agent-less lines
  // ("On it — 5 steps", "Writing the article. Starting now…") on every agent's tab as "the frame
  // every agent's work sits inside" — but that meant Mr. Keyword's own screen opened with the
  // WRITER's order-level sentence sitting right above its real "Looking up search data…" lines,
  // reading as if the two agents' reports had been mixed together (owner, 2026-09-10: "keyword
  // wale pe article ka analytic aa raha hai"). Those framing lines now only show in the
  // no-agent-selected "What the team is doing" view; a specific agent's tab shows exactly, only,
  // that agent's own lines.
  const panelLines = (task?.lines ?? []).filter((ln) => (panelAgent ? ln.agent_id === panelAgent.id : true));
  // Clicking an agent the plan hasn't reached yet still opens its screen (nothing is disabled,
  // owner 2026-09-10) — it just has no lines yet because there is genuinely nothing to show, not
  // because something is broken. "No activity yet" read as dead; an animated "Waiting…" reads as
  // "your turn is coming".
  const panelAgentNotStarted =
    !!panelAgent && !!task &&
    task.steps.some((s) => s.agent_id === panelAgent.id) &&
    task.steps.filter((s) => s.agent_id === panelAgent.id).every((s) => s.status === "pending");

  // THE TABS: only the agents that are genuinely part of THIS order, in plan order — replacing
  // the five fixed labels ("Live Activity / Research / Writing / …") that rendered identical
  // content whichever you clicked. §24.4b asks for exactly this: tabs per agent, showing what
  // that agent did on this task.
  const taskAgents: Agent[] = Array.from(new Set((task?.steps ?? []).map((s) => s.agent_id)))
    .map((id) => [...allAgents, bossAgent, publishAgent].find((a) => a.id === id))
    .filter((a): a is Agent => !!a);

  // Mr. Keyword's own rows for this order, and the topic it was searching — used by the live
  // keyword screen below.
  const keywordItems = producedItems.filter((it) => it.kind === "keyword");
  // gpt-researcher's own live events (agents/writer.ts's onProgress, forwarded verbatim — see
  // conduct_research.py) — real, while the research step runs, before the outline exists. Once
  // "research" (the researcher's own resolve) or "section" (the outline moved past it) shows
  // up, research is over and the writer screen below takes back the live visual.
  const researchProgressItems = producedItems.filter((it) => it.kind === "research_progress");
  const researchDone = producedItems.some((it) => it.kind === "research" || it.kind === "section");
  const taskTopic =
    (task?.items.find((it) => it.kind === "topic_picked")?.payload?.topic as string | undefined) ??
    (task?.echo ? String(task.echo).match(/"([^"]+)"/)?.[1] : undefined) ??
    null;

  /** "Write article" on a keyword row — goes through the SAME chat path a typed order takes
   *  (nothing bypasses the brain), so the user sees their own request in the thread and the
   *  order is planned, confirmed and tracked exactly as usual. */
  const orderArticleFor = (keyword: string) => {
    const kw = keyword.trim();
    if (!kw || chatBusy) return;
    const text = `Write an article about "${kw}"`;
    setThread((p) => [...p, { who: "user", text, time: nowTime() }]);
    setBotOpen(true);
    setDesktopAssistantOpen(true);
    void stream(text);
  };

  /** The composer's Stop button (owner, 2026-09-10: "jaisa ChatGPT Claude pe hota hai" — a real
   *  stop, not cosmetic). Aborting the fetch only stops what WE show; if this turn had already
   *  been accepted as a real order (X-Run-Job already seen — orderedTaskId.current is set the
   *  instant that happens, well before the live feed hydrates a `task` object), the actual work
   *  is still running on the server and needs the same real cancel door cancelCurrentTask() uses
   *  — called directly by id here since `task` cannot be trusted to already point at it yet
   *  ("100% accurate hoga, turant har task cancel ho jayega"). */
  const stopGenerating = () => {
    streamAbortRef.current?.abort();
    const jobId = orderedTaskId.current;
    if (jobId) {
      orderedTaskId.current = null;
      setPendingOrder(null);
      fetch(`/api/tasks/${jobId}/cancel`, { method: "POST" })
        .then(() => live.reload())
        .catch(() => {});
    }
  };

  // Real cancel — POSTs to app/api/tasks/[id]/cancel, which is the thin server-side door onto
  // lib/brain.ts's cancelTask() (needs AGENT_SERVER_URL/the shared token, so it cannot run in
  // the browser directly). Refreshes the task list on success so the bar reflects "cancelled"
  // the same tick the brain confirms it, rather than sitting on a stale progress bar. Declared
  // here (not lower, by BottomBar) so the chat panel's own Stop button — same task, same
  // handler, 2026-09-04 ("stop karne ka chat pe hi ek option ho") — can call it too.
  const cancelCurrentTask = async () => {
    if (!task || cancellingTaskId) return;
    setCancellingTaskId(task.task_id);
    try {
      await fetch(`/api/tasks/${task.task_id}/cancel`, { method: "POST" });
      live.reload();
    } finally {
      setCancellingTaskId(null);
    }
  };

  /** "agar dekho koi task stop karu to bad main re start karne ka ek btn dedo ok" (owner,
   *  2026-09-12) — after a Stop, the same order text is still sitting in `lastOrderMessageRef`
   *  (set the instant a real order streamed in, line ~2177); resending it through the exact
   *  same `stream()` door as a normal chat send is a genuine new order, not a resume of the
   *  cancelled one — there is no cancelled-task state to resume, and the brain plans fresh. */
  const restartLastOrder = () => {
    const q = lastOrderMessageRef.current;
    if (!q || chatBusy) return;
    setThread((p) => [...p, { who: "user", text: q, time: nowTime() }]);
    setBotOpen(true);
    setDesktopAssistantOpen(true);
    void stream(q);
  };

  const itemLabel = (it: (typeof producedItems)[number]) => {
    // The writer's real event kinds (agent-server/src/agents/writer.ts) — anything else
    // (from other agents in the same task) falls back to a generic "<kind>" line rather than
    // guessing at a payload shape it doesn't recognize.
    if (it.kind === "section") return `Section written: "${it.payload?.h2 ?? "untitled"}" (${it.payload?.words ?? "?"} words)`;
    if (it.kind === "research") return it.payload?.used ? `Research used — ${it.payload?.sources ?? "?"} sources` : "No research needed for this topic";
    if (it.kind === "score") return `Quality score: ${it.payload?.quality ?? "?"}/100 ${it.payload?.passed ? "— passed" : "— needs another pass"}`;
    // Mr Lxwa's own pick (agents/boss.ts's ctx.data("topic_picked", …)) — it was rendering as
    // the bare word "topic_picked" because this fell through to `it.kind`, hiding the one thing
    // the brain's step actually produced and the reason it chose it.
    if (it.kind === "topic_picked") {
      const t = it.payload?.topic ?? "a topic";
      return it.payload?.why ? `Chose "${t}" — ${it.payload.why}` : `Chose "${t}"`;
    }
    if (it.kind === "keyword") {
      const vol = typeof it.payload?.searchVolume === "number" ? `${it.payload.searchVolume}/mo` : "volume not measured";
      return `Keyword: ${it.payload?.keyword ?? "?"} — ${vol}`;
    }
    return it.kind;
  };

  const AgentPanel = (
    <section className="lx-card mt-4 p-4">
      {/* panel toolbar — agent identity moved in here (small, inline) since the old left
          column's "Agent Status" card was dropped, and "Back to Workflow" / "Minimize Agent"
          dropped too (per request, to give Live Visual more room) — Close (X) already does
          exactly what "Back to Workflow" did (setShowPanel(false)), so nothing was lost. */}
      {/* ONE line for everything that isn't the canvas itself (owner, 2026-09-11: "live badge
          close icon agent name in sab ko 1 line pe do... taki live visual pe jayda space mile").
          The old layout stacked three rows above the canvas — a two-line agent block, a "Live
          Visual" heading row, and a "Finished"/status row with its own icon — roughly 90px of
          chrome over a 460px box. Name, role+clock, the agent's own current status line, the
          LIVE badge and Close now share a single row, and the canvas starts right under it. */}
      <div className="flex items-center gap-2.5">
        <Robo size={22} />
        <span className="truncate text-sm font-bold">{panelAgent?.name ?? "Team"}</span>
        <span className="lx-10 lx-mut hidden shrink-0 sm:inline">
          {panelAgent?.role ?? "Waiting for work"}
          {task ? ` · ${clock(elapsedMs(task, now))}` : ""}
        </span>
        {/* The running step's own words — was its own row with a pen icon under the heading. */}
        <span className="lx-10 lx-mut min-w-0 flex-1 truncate">
          {runningStep?.progressLabel || runningStep?.label || (task && isTerminalTask(task.status) ? "Finished" : "Waiting to start…")}
        </span>
        {/* Kept as a permanent LIVE pill at the owner's request (2026-08-31). */}
        <span className="lx-pill red shrink-0">
          <span className="lx-pulse h-1.5 w-1.5 rounded-full" style={{ background: "#ef4444" }} /> LIVE
        </span>
        <button className="lx-icobtn shrink-0" aria-label="Close" onClick={closeAgentPanel}>
          <X size={14} />
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-4">
        <div className="min-w-0">
          {/* Fixed height + its own scrollbar: a 20-row keyword table used to push the panel
              (and the page) far past the fold — "content box se bahar nahi jayega". */}
          <div ref={canvasScrollRef} className="lx-card2 lx-scroll p-3" style={{ minHeight: 360, maxHeight: 460, overflowY: "auto" }}>
            <div>
              {/* NOT keyed to `runningStep?.key` any more (owner, 2026-09-12: "cursor kahi bhi
                  work nahi karta... achanak full article aa jata hai"). It used to be — a fade-in
                  on every step change — but that REMOUNTS this whole subtree every time a step
                  starts, ends, or the task finishes. WriterDocScreen's typing animation lives in
                  its OWN state (typedLen); a remount at exactly the moment writing finished wiped
                  that state and restarted the reveal instantly rather than smoothly, which is
                  what read as "achanak full article aa jata hai". Each screen below now owns its
                  own entrance animation on its own rows (`lx-live-anim` per item), so nothing
                  here needs to force a fade by remounting.
                  Each agent gets the screen its own output deserves (§24.4b's "typed
                  component"), not one generic bullet list. Mr. Keyword's is the Google-style
                  search while it runs and a real table when it is done; everything else keeps
                  the honest per-item list until it earns a screen of its own.
                  ON PAPER: the reference design puts every one of these on a light page inside
                  the dark shell (owner, 2026-09-12). `.lx-paper` re-points the theme tokens the
                  screens already use, so they all flip to ink-on-paper without knowing it. */}
              <div className="lx-paper">
                {panelAgent?.id === "boss" ? (
                  <BossScreen items={producedItems} running={!!runningStep} color={panelAgent.color} label={panelAgent.name} />
                ) : panelAgent?.id === "keyword" ? (
                  <KeywordScreen
                    items={keywordItems}
                    topic={taskTopic}
                    running={!!runningStep}
                    onWriteArticle={orderArticleFor}
                  />
                ) : panelAgent?.id === "writer" && !researchDone && (researchProgressItems.length > 0 || !!runningStep) ? (
                  <ResearchScreen items={researchProgressItems} running={!!runningStep} />
                ) : panelAgent?.id === "writer" ? (
                  <WriterDocScreen items={producedItems} running={!!runningStep} color={panelAgent.color} label={panelAgent.name} />
                ) : panelAgent?.id === "seo" ? (
                  <SeoScreen items={producedItems} running={!!runningStep} color={panelAgent.color} label={panelAgent.name} />
                ) : panelAgent?.id === "image" ? (
                  <ImageScreen items={producedItems} running={!!runningStep} color={panelAgent.color} label={panelAgent.name} />
                ) : panelAgent?.id === "audit" ? (
                  <AuditScreen items={producedItems} running={!!runningStep} color={panelAgent.color} label={panelAgent.name} />
                ) : panelAgent?.id === "leads" ? (
                  <LeadsScreen items={producedItems} running={!!runningStep} color={panelAgent.color} label={panelAgent.name} />
                ) : panelAgent?.id === "publish" ? (
                  <PublishScreen items={producedItems} running={!!runningStep} color={panelAgent.color} label={panelAgent.name} />
                ) : panelAgent?.id === "story" ? (
                  <StoryScreen items={producedItems} running={!!runningStep} color={panelAgent.color} label={panelAgent.name} />
                ) : panelAgent?.id === "social" ? (
                  <SocialScreen items={producedItems} running={!!runningStep} color={panelAgent.color} label={panelAgent.name} />
                ) : panelAgent?.id === "analyst" ? (
                  <SiteBrainScreen items={producedItems} running={!!runningStep} color={panelAgent.color} label={panelAgent.name} />
                ) : producedItems.length === 0 ? (
                  <div className="flex items-center gap-2.5">
                    {isFlowing(task, now) ? (
                      <>
                        <Wave n={26} h={18} anim color="var(--lx-purple)" />
                        <span className="lx-shimmer lx-10 font-medium">Working…</span>
                      </>
                    ) : (
                      <span className="lx-10 lx-mut">Nothing was produced for this order.</span>
                    )}
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {producedItems.map((it) =>
                      // Mr Lxwa's own pick gets a proper card — a bold headline plus the reason
                      // underneath — instead of the one run-on sentence itemLabel() gives every
                      // other kind ("Chose "X" — Y" was unreadable at a glance).
                      it.kind === "topic_picked" ? (
                        <li key={it.key} className="lx-in rounded-lg px-3 py-2.5">
                          <div className="flex items-center gap-1.5 lx-10 lx-mut">
                            <CheckCircle2 size={12} style={{ color: "#22c55e" }} /> Topic chosen
                          </div>
                          <div className="lx-13 font-bold leading-snug mt-1">{it.payload?.topic ?? "a topic"}</div>
                          {it.payload?.why && <div className="lx-11 lx-mut mt-1">{it.payload.why}</div>}
                        </li>
                      ) : (
                        <li key={it.key} className="lx-in flex items-start gap-2 rounded-lg px-2.5 py-2 lx-11" style={{ color: "#cfcfdd" }}>
                          <CheckCircle2 size={14} style={{ color: "#22c55e", marginTop: 1, flexShrink: 0 }} />
                          {itemLabel(it)}
                        </li>
                      )
                    )}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* The "wire" — the single freshest real sentence for whichever agent's screen is open
              above, the same one-line ticker the reference mockup keeps under its canvas.
              Sourced from `panelLines` (already scoped to `panelAgent` — see its own comment),
              never a separate feed: this is not new data, just the latest of what's already
              real, kept visible even while the eye is on the canvas above it. */}
          {panelLines.length > 0 && (
            <div className="lx-10 lx-mono lx-mut mt-2 truncate px-1">
              <span className="lx-dim">{new Date(panelLines[panelLines.length - 1].at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              {"  "}
              {panelLines[panelLines.length - 1].text}
            </div>
          )}
        </div>

        {/* writer progress — secondary, below the live visual. Real: a clean title derived from
            the task's own kind + subject (taskTitle — never the raw "·"-joined confirmation
            echo), the running step's real label/fraction if it reported one, and real
            step-of-total position — nothing here is invented. */}
        <div className="min-w-0">
          <div className="text-lg font-bold leading-tight">{task ? taskTitle(task) : workingAgent?.role}</div>
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

          {/* Mr Lxwa's plan — task.outline, built by the real planner (agent-server's
              planner.ts) the instant the order was accepted, over the actual manifest graph for
              this order (not a canned list — a "publish karo" order gets a different plan than
              a draft, and one where a topic had to be picked shows Mr Lxwa's own pick_topic step
              first). Was computed all along and shown only on the Office page; the owner asked
              for it here too, 2026-08-31 ("boss ne jo plan bana ye ha wo b dikhna chaaya"). */}
          {/* Drawn as the live checklist it actually is, not a paragraph of planner output
              (owner, 2026-09-11: "jab plan etc banaye tab koi na koi best ui ux karo"). Each
              line gets its own row, its own marker, and — when the plan and the real task_steps
              line up one-to-one — that step's REAL status: a green check for done, a pulsing
              ring for the one running, a plain number for one that hasn't started. When they
              don't line up (a plan with parallel "3a/3b" steps against a different step count),
              the markers stay plain numbers rather than guessing which line is which. */}
          {task && task.outline.length > 0 && (
            <div className="lx-card2 mt-3 p-3">
              <div className="flex items-center gap-1.5 lx-11 font-semibold" style={{ color: "var(--lx-violet)" }}>
                <BrainCircuit size={13} /> Mr Lxwa&apos;s Plan
              </div>
              <ol className="mt-2 space-y-1.5">
                {task.outline.map((line, i) => {
                  const ordered = [...task.steps].sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
                  const step = ordered.length === task.outline.length ? ordered[i] : null;
                  const done = step?.status === "done";
                  const failed = step?.status === "failed";
                  const live = step?.status === "running";
                  return (
                    <li key={i} className="flex items-start gap-2.5">
                      <span
                        className={`flex shrink-0 items-center justify-center rounded-full ${live ? "lx-pulse" : ""}`}
                        style={{
                          width: 18,
                          height: 18,
                          marginTop: 1,
                          fontSize: 10,
                          fontWeight: 700,
                          color: done ? "#4ade80" : failed ? "#f87171" : live ? "#fff" : "var(--lx-mut)",
                          background: live ? "var(--lx-violet)" : "rgba(255,255,255,.05)",
                          border: `1px solid ${done ? "rgba(34,197,94,.5)" : failed ? "rgba(239,68,68,.5)" : live ? "transparent" : "var(--lx-border)"}`,
                        }}
                      >
                        {done ? <CheckCircle2 size={11} /> : failed ? <XCircle size={11} /> : i + 1}
                      </span>
                      {/* planner.ts already numbers its own lines ("1. Mr. Keyword…") — dropped
                          here so the number isn't printed twice next to our own marker. */}
                      <span className="lx-11" style={{ color: done ? "var(--lx-mut)" : "#cfcfdd", lineHeight: 1.5 }}>
                        {line.replace(/^\s*\d+[a-z]?[.)]\s*/i, "")}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* Tabs = the agents that actually worked on THIS order (§24.4b). They used to be five
              fixed labels that all rendered the same thing; now each one switches the screen
              above to that agent's own output and its own timeline below. */}
          {/* Simple tabs again (owner, 2026-09-10: "bahut bada hogaya hai, simple pehle jaisa") —
              just a small status dot plus the name, same size as before. Done gets a check mark
              INSTEAD of the dot (not green text, just the icon); nothing here disables — clicking
              an agent that hasn't started yet still opens its (empty, "Waiting…") screen below,
              same as clicking any other tab. The working agent's tab still auto-opens on its own
              (see the follow-the-work effect next to selectedAgentId). */}
          <div className="lx-scroll mt-3 flex gap-5 overflow-x-auto border-b" style={{ borderColor: "var(--lx-border)" }}>
            {taskAgents.map((a) => {
              const mine = (task?.steps ?? []).filter((s) => s.agent_id === a.id);
              const running = mine.some((s) => s.status === "running");
              const failed = !running && mine.some((s) => s.status === "failed");
              const done = !running && !failed && mine.length > 0 && mine.some((s) => s.status === "done") && mine.every((s) => isTerminalStep(s.status));
              return (
                <button
                  key={a.id}
                  className={`lx-tab ${panelAgent?.id === a.id ? "on" : ""}`}
                  onClick={() => setSelectedAgentId(a.id)}
                  title={`${a.name} — ${running ? "working" : done ? "done" : failed ? "failed" : "waiting"}`}
                >
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    {done ? (
                      <CheckCircle2 size={13} style={{ color: "#22c55e", flexShrink: 0 }} />
                    ) : failed ? (
                      <XCircle size={13} style={{ color: "#ef4444", flexShrink: 0 }} />
                    ) : (
                      <span
                        className={running ? "lx-pulse h-1.5 w-1.5 rounded-full" : "h-1.5 w-1.5 rounded-full"}
                        style={{ background: running ? "#3b82f6" : "#5c5c72" }}
                      />
                    )}
                    {a.name}
                  </span>
                </button>
              );
            })}
            {taskAgents.length === 0 && <span className="lx-tab lx-mut">No agents on this order yet</span>}
          </div>

          <div className="lx-13 mt-4 font-semibold">
            {panelAgent ? `What ${panelAgent.name} is doing` : "What the team is doing"}
          </div>

          {/* timeline — task.lines: real, human-readable events (lib/live.ts's userMessage()),
              never a raw prompt/error string. Scoped to the agent whose card was clicked (see
              panelLines above) — no other agent's lines mixed in. Full history, not just the
              last few: it used to hard-cut to the last 8 lines, silently dropping everything
              earlier (owner, 2026-09-10: "analytic ka part cut jaye aisa nahi... full show
              karna, agar zyada ho to scroll pe dalo") — now it all renders, and the panel itself
              scrolls once it runs long instead of the page growing without bound. */}
          <div className="lx-tl mt-1" style={{ maxHeight: 360, overflowY: "auto" }}>
            {panelLines.length === 0 && (
              <div className="lx-11 lx-mut py-2 flex items-center gap-2">
                {panelAgentNotStarted ? (
                  <>
                    <span className="lx-pulse h-1.5 w-1.5 rounded-full" style={{ background: "#5c5c72" }} />
                    <span className="lx-shimmer">Waiting…</span>
                  </>
                ) : (
                  "No activity yet."
                )}
              </div>
            )}
            {panelLines.map((ln) => {
              const color = ln.tone === "ok" ? "#22c55e" : ln.tone === "err" ? "#ef4444" : ln.tone === "warn" ? "#f59e0b" : "#3b82f6";
              return (
                <div className="lx-row" key={ln.key}>
                  <span className="lx-10 lx-mono lx-dim text-right">
                    {new Date(ln.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="lx-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                  {/* No `truncate` — a long sentence used to end in an ellipsis with no way to
                      read the rest of it. It wraps instead now; the row's own align-items:start
                      (below) keeps the timestamp/dot pinned to the first line, not centered
                      against the whole wrapped block. */}
                  <span className="lx-12" style={{ color: "#d9d9e6", alignSelf: "start", paddingTop: 1 }}>{ln.text}</span>
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

  // shown only inside the Voice tab (see aTab === "voice" below) — a stray
  // "listening" indicator made no sense while the user is text-chatting
  const VoiceDock = (
    <div className="lx-listening px-2 py-1.5" aria-label="Listening">
      <Wave n={5} h={9} anim color="rgba(139,92,246,.9)" />
      <button className="lx-mic" aria-label="Stop listening">
        <Mic size={11} style={{ color: "var(--lx-cyan)" }} />
      </button>
      <Wave n={5} h={9} anim color="rgba(34,211,238,.9)" />
      <span className="lx-ltip">Listening…</span>
    </div>
  );

  const Assistant = (
    <aside
      className={`lx-panelR fixed inset-y-0 right-0 z-50 flex shrink-0 flex-col transition-transform duration-300 lg:static ${
        botOpen ? "translate-x-0" : "translate-x-full"
      } ${desktopAssistantOpen ? "lg:flex lg:translate-x-0" : "lg:hidden"}`}
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
        <div className="ml-auto flex items-center gap-1" style={{ position: "relative" }}>
          <button
            className="lx-icobtn"
            style={{ border: "none", background: "transparent" }}
            aria-label="Chat history"
            aria-expanded={showHistory}
            onClick={() => {
              const opening = !showHistory;
              setShowHistory(opening);
              if (opening) void refreshConvs();
            }}
          >
            <History size={15} />
          </button>
          <button className="lx-icobtn" onClick={closeAssistant} aria-label="Close assistant">
            <X size={14} />
          </button>

          {/* History dropdown — same job as components/kit.tsx's older BossChat sidebar, as a
              popover instead of a persistent panel: this chat is narrower and already competes
              for room with the live progress strip below it. */}
          {showHistory && (
            <div
              className="lx-card2 lx-scroll"
              style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 260, maxHeight: 360, overflowY: "auto", zIndex: 30, padding: 6 }}
            >
              <button
                className="lx-ghost lx-11 flex w-full items-center gap-2"
                style={{ padding: "7px 9px" }}
                onClick={newChat}
              >
                <Plus size={13} /> New Chat
              </button>
              <div className="lx-10 lx-mut mt-1.5 px-1.5">History</div>
              {convs.length === 0 && <div className="lx-10 lx-mut px-1.5 py-2">No past chats yet.</div>}
              {convs.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-1 rounded-lg px-1.5 py-1.5"
                  style={{ background: c.id === convId.current ? "rgba(139,92,246,.12)" : undefined }}
                >
                  <button
                    className="lx-11 min-w-0 flex-1 truncate text-left"
                    style={{ background: "transparent", border: "none", color: c.id === convId.current ? "var(--lx-text)" : "var(--lx-mut)", cursor: "pointer" }}
                    onClick={() => openConversation(c.id)}
                    title={c.title ?? "Untitled chat"}
                  >
                    {c.title || "Untitled chat"}
                  </button>
                  <button
                    className="lx-icobtn shrink-0"
                    style={{ width: 22, height: 22, border: "none", background: "transparent" }}
                    aria-label="Delete chat"
                    onClick={() => deleteConversation(c.id)}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* agent card — kept intentionally thin (single-line status) so it doesn't
          eat vertical space the chat thread below needs */}
      <div className="lx-card2 mx-3 mt-2 flex items-center gap-2 px-3 py-2">
        <Robo size={26} />
        <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
          <span className="lx-12 font-bold leading-tight">Mr. Lxwa</span>
          <span className="lx-10 lx-mut">·</span>
          <span className="flex items-center gap-1 lx-10" style={{ color: "#4ade80" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} /> Online
          </span>
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
                <div className="lx-me lx-11 px-3 py-2.5 leading-relaxed" style={{ maxWidth: "85%" }}>{m.text}</div>
              </div>
            ) : (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <Robo size={24} />
                  <span className="lx-11 font-semibold">Mr. Lxwa</span>
                  {/* Genuinely means the order this bubble belongs to is still running — stream()
                      tags the bubble with the real taskId the instant the order is accepted, so
                      this now stays lit for exactly as long as the task itself does. */}
                  {m.live && m.taskId && (
                    <span className="flex items-center gap-1 lx-10" style={{ color: "#4ade80" }}>
                      <span className="lx-pulse h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e" }} /> working
                    </span>
                  )}
                  <span className="lx-10 lx-dim ml-auto">{m.time}</span>
                </div>
                <div
                  className="lx-ai lx-11 mt-1.5 px-3 py-2.5 leading-relaxed"
                  style={{
                    marginLeft: 30,
                    color: m.failed ? "#f87171" : undefined,
                    whiteSpace: "pre-wrap",
                    borderColor: m.live && m.taskId ? "rgba(34,211,238,.35)" : undefined,
                  }}
                >
                  {m.planSteps?.length ? (
                    <>
                      {/* The model's own real acknowledgment (lib/chat-brain-intent.ts's
                          ackLine/REPLY_FIELD, in the customer's own language) — never the
                          hardcoded English line this used to show unconditionally, which is what
                          made an order look like TWO different replies (owner report
                          2026-09-10). The hardcoded line survives only as a fallback for the rare
                          turn where a model call genuinely returned no text at all. */}
                      <div>{m.text ? boldText(m.text, `m${i}`) : "Got it — I've assigned this to the team and we've started working. Here's the plan:"}</div>
                      <ul className="mt-2 space-y-1.5">
                        {m.planSteps.map((s, si) => {
                          const done = s.status === "done";
                          const run = s.status === "running";
                          const bad = s.status === "failed";
                          return (
                            <li key={si} className="lx-live-anim flex items-center gap-2" style={{ animationDelay: `${Math.min(si, 6) * 60}ms` }}>
                              {done ? (
                                <CheckCircle2 size={13} style={{ color: "#22c55e", flexShrink: 0 }} />
                              ) : run ? (
                                <ArrowRight size={13} style={{ color: "#3b82f6", flexShrink: 0 }} />
                              ) : bad ? (
                                <XCircle size={13} style={{ color: "#ef4444", flexShrink: 0 }} />
                              ) : (
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "#5c5c72" }} />
                              )}
                              <span style={{ color: run ? "#e6e6f2" : done ? "var(--lx-text)" : "var(--lx-mut)" }}>{s.label}</span>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="lx-10 lx-mut mt-2">You can watch live progress on the dashboard.</div>
                    </>
                  ) : m.text ? (
                    boldText(m.text, `m${i}`)
                  ) : m.live ? (
                    // Neutral on purpose — this same bubble covers a plain question ("what is
                    // your name?") as much as an order, and "Still working" reads as task
                    // language for the former (owner 2026-09-09, screenshot: a plain Q&A showed
                    // task-style "working" copy).
                    m.slow ? "Just a moment, still thinking…" : (
                      <span className="lx-typing" aria-label="Mr. Lxwa is typing">
                        <span /><span /><span />
                      </span>
                    )
                  ) : (
                    ""
                  )}
                </div>
                {m.chip && (
                  <div style={{ marginLeft: 30 }} className="mt-1.5">
                    {/* Wraps instead of truncating — .lx-pill is nowrap by default, which cut a
                        real keyword down to "iso 22000 food safety man…". The whole phrase is
                        the point of showing it. */}
                    <span
                      className="lx-pill purple"
                      style={{ maxWidth: "100%", display: "inline-block", whiteSpace: "normal", lineHeight: 1.5, textAlign: "left" }}
                    >
                      {m.chip}
                    </span>
                  </div>
                )}
                {m.cta && (
                  <button
                    className="lx-grad lx-11 mt-1.5 px-3 py-1.5"
                    style={{ marginLeft: 30 }}
                    onClick={() => {
                      if (m.cta?.agentId) setSelectedAgentId(m.cta.agentId);
                      setShowPanel(true);
                      setBotOpen(false);
                    }}
                  >
                    {m.cta.label}
                  </button>
                )}
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
          {VoiceDock}
        </div>
      )}

      {/* LIVE PROGRESS, pinned above the composer.
          The chat used to say "On it." and then nothing at all until the whole order finished —
          asked for repeatedly and never actually delivered, because the earlier attempt hung off
          a ref set during the fetch and an effect that only fired when `live.byTask` happened to
          change afterwards; miss that window and no bubble was ever written. This reads straight
          off `task` — the same value the network cards, the wires and the plan all use, which we
          can see updating — so there is no timing to get wrong. It is deliberately a strip, not
          a chat bubble: progress is a live state, not something that was "said". */}
      {/* Shown once a real order genuinely exists (pendingOrder — set only when /api/chat hands
          back an actual job id, see the effect above) or a task row does — NOT on `awaitingOrder`
          alone, which flips true for every message the instant it's sent, plain questions
          included. This strip's whole vocabulary ("Working…", "Sending it to the team…", a stop
          button) is task language; showing it while waiting to find out if "what is your name?"
          turned into an order read as the product presuming work it never started (owner
          2026-09-09, screenshot: a plain Q&A showed "Working... Sending it to the team..."). The
          chat bubble's own typing-dots (see the thread render below) already cover the ordinary
          "waiting for a reply" feeling for every message, task or not. */}
      {(task || pendingOrder) && (
        <div className="lx-card2 mx-3 mb-2 px-3 py-2">
          {/* COLLAPSED BY DEFAULT — one line. The full card (order text, the ticking plan, the
              bar, the review link) was several lines tall and permanently ate the chat's own
              space; it now opens on the chevron and animates, so the detail is one click away
              instead of always in the way. */}
          {/* A `<button>` wrapper, not nested inside one — the Stop button below needs to be a
              real, separately-clickable button in this same row, and two <button>s cannot
              nest. */}
          <div
            className="flex w-full items-center gap-2"
            style={{ cursor: "pointer" }}
            onClick={() => setStripOpen((o) => !o)}
            role="button"
            tabIndex={0}
            aria-expanded={stripOpen}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setStripOpen((o) => !o);
            }}
          >
            {/* `pendingOrder` wins over `task`: right after a fresh order lands, `task` is still
                the PREVIOUS (finished) order, and showing its "Done" while the new one is being
                created is exactly the stale answer this strip exists to avoid. */}
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${pendingOrder || taskActive ? "lx-pulse" : ""}`}
              style={{
                background: pendingOrder || taskActive ? "#22c55e" : "#8b8ba0",
                boxShadow: pendingOrder || taskActive ? "0 0 8px #22c55e" : "none",
              }}
            />
            <span className={`lx-11 min-w-0 flex-1 truncate font-semibold ${pendingOrder ? "lx-shimmer" : ""}`}>
              {pendingOrder || !task
                ? "Working…"
                : taskActive
                  ? runningStep?.progressLabel || runningStep?.label || "Starting…"
                  : task.status === "needs_attention" || task.status === "failed"
                    ? task.reason || "Stopped"
                    : "Done"}
            </span>
            {!pendingOrder && task && stepNo != null && totalSteps != null && (
              <span className="lx-10 lx-mut shrink-0">{stepNo}/{totalSteps}</span>
            )}
            {/* Restart — only once the SAME task has actually stopped (cancelled), and only the
                order text, not a resume of dead work: "koi task stop karu to bad main re start
                karne ka ek btn dedo" (owner, 2026-09-12). */}
            {!pendingOrder && !taskActive && task?.status === "cancelled" && !!lastOrderMessageRef.current && (
              <button
                className="lx-pill shrink-0"
                style={{ cursor: chatBusy ? "default" : "pointer", opacity: chatBusy ? 0.5 : 1 }}
                disabled={chatBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  restartLastOrder();
                }}
              >
                <RotateCcw size={10} /> Restart
              </button>
            )}
            {/* Real cancel, right here — same handler/state as Office's "Stop Task" (BottomBar),
                so a click here disables both at once and neither goes stale. 2026-09-04, the
                owner's own words: "current task ko rokne ka, stop karne ka, chat pe hi ek
                option ho". Only while a task is genuinely running — nothing to stop otherwise. */}
            {!pendingOrder && taskActive && (
              <button
                className="lx-icobtn shrink-0"
                style={{ width: 20, height: 20, color: "#ef4444", opacity: cancellingTaskId ? 0.5 : 1 }}
                aria-label={cancellingTaskId ? "Stopping…" : "Stop task"}
                title={cancellingTaskId ? "Stopping…" : "Stop task"}
                disabled={!!cancellingTaskId}
                onClick={(e) => {
                  e.stopPropagation();
                  void cancelCurrentTask();
                }}
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border" style={{ borderColor: "#ef4444" }}>
                  <Square size={7} fill="#ef4444" stroke="#ef4444" />
                </span>
              </button>
            )}
            <ChevronDown
              size={13}
              className="lx-mut shrink-0"
              style={{ transform: stripOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }}
            />
          </div>

          <Collapse open={stripOpen}>
            <div className="pt-2">
              <div className="lx-10 lx-mut truncate">{pendingOrder || !task ? "Sending it to the team…" : taskTitle(task)}</div>

              {/* THE PLAN, TICKING. Mr Lxwa's real steps (task_steps, in plan order), each row
                  animating in as the plan lands and then flipping to done as its agent
                  finishes. Built from the real rows, so it can never show a step that is not in
                  the plan or tick one that has not finished. */}
              {!pendingOrder && task && task.steps.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {task!.steps.map((st, i) => {
                    const nm = [...allAgents, bossAgent, publishAgent].find((a) => a.id === st.agent_id)?.name ?? st.agent_id;
                    const done = st.status === "done";
                    const run = st.status === "running";
                    const bad = st.status === "failed";
                    const color = bad ? "#ef4444" : done ? "#22c55e" : run ? "#3b82f6" : "#5c5c72";
                    return (
                      <li
                        key={st.key}
                        className="lx-live-anim flex items-center gap-2 lx-10"
                        style={{ animationDelay: `${Math.min(i, 6) * 60}ms`, color: run ? "#e6e6f2" : "var(--lx-mut)" }}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${run ? "lx-pulse" : ""}`}
                          style={{ background: color, boxShadow: run ? `0 0 6px ${color}` : "none" }}
                        />
                        <span className="min-w-0 flex-1 truncate">{nm}</span>
                        {done && <CheckCircle2 size={11} style={{ color: "#22c55e", flexShrink: 0 }} />}
                        {run && <span className="lx-shimmer lx-10 shrink-0">working</span>}
                      </li>
                    );
                  })}
                </ul>
              )}

              {barTotalSteps > 0 && (
                <div className="lx-track mt-2">
                  <div className="lx-fill" style={{ width: `${barPct}%` }} />
                </div>
              )}

              {/* Only once the order is genuinely over, and only when there is a real thing to
                  open — straight at the article, not the Approvals list. */}
              {!pendingOrder && task && isTerminalTask(task.status) && reviewHref && (
                <Link href={reviewHref} className="lx-grad lx-10 mt-2 inline-flex px-2.5 py-1">
                  Review
                </Link>
              )}
            </div>
          </Collapse>
        </div>
      )}

      {/* input — a soft glass pill (see .lx-chat-in); mic and send sit as matching
          icon buttons either side so the row reads as one deliberate unit instead
          of mismatched pieces */}
      <div className="px-3 pb-3 pt-1">
        <div className="lx-chat-in flex items-center gap-1 px-2 py-1">
          <button className="lx-icobtn shrink-0" style={{ border: "none", background: "transparent" }} aria-label="Voice input">
            <Mic size={15} />
          </button>
          <textarea
            ref={msgInputRef}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={chatBusy ? "Replying…" : "Message…"}
            disabled={chatBusy}
            rows={1}
            className="lx-11 w-full resize-none bg-transparent py-1.5 disabled:opacity-60"
            style={{ border: "none", color: "var(--lx-text)", maxHeight: 88, overflowY: "auto" }}
          />
          {/* Send/Stop share one slot, ChatGPT/Claude-style: mid-reply this is a real Stop (see
              stopGenerating — aborts the fetch and, if an order was already accepted, cancels
              the real task too), not just a disabled Send. */}
          {chatBusy ? (
            <button
              onClick={stopGenerating}
              aria-label="Stop generating"
              title="Stop"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: "#3f3f4a", border: "1px solid var(--lx-border)", cursor: "pointer" }}
            >
              <Square size={11} fill="#fff" stroke="#fff" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!msg.trim()}
              aria-label="Send"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#4f46e5,#8b5cf6)", border: "none", cursor: "pointer", boxShadow: "0 0 12px rgba(124,58,237,.5)" }}
            >
              <Send size={13} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );

  /* ---------------------------------------------------------------------- */

  const BottomBar = task ? (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-1.5" style={{ borderColor: "var(--lx-border)", background: "var(--lx-panel)" }}>
      <button
        className="lx-icobtn rounded-full"
        aria-label="Open assistant to start a new task"
        onClick={() => {
          setBotOpen(true);
          setDesktopAssistantOpen(true);
          setATab("assistant");
          requestAnimationFrame(() => msgInputRef.current?.focus());
        }}
      >
        <Plus size={13} />
      </button>
      <div className="min-w-0 lx-11">
        <span className="lx-mut">Current: </span>
        <span className="font-semibold">{taskTitle(task)}</span>
        {stepNo != null && totalSteps != null && <span className="lx-mut"> · Step {stepNo} of {totalSteps}</span>}
      </div>

      <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex" style={{ maxWidth: 260 }}>
        <div className="lx-track flex-1">
          <div className="lx-fill" style={{ width: `${barPct}%` }} />
        </div>
        <span className="lx-11 font-bold">{barPct}%</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="lx-10 lx-mut hidden md:inline">
          <span className="lx-mono font-semibold" style={{ color: "#e6e6f2" }}>{clock(elapsedMs(task, now))}</span>
        </span>
        {taskActive && (
          <button
            className="lx-pill red"
            style={{ cursor: cancellingTaskId ? "default" : "pointer", padding: "5px 11px", background: "rgba(239,68,68,.08)", opacity: cancellingTaskId ? 0.6 : 1 }}
            onClick={cancelCurrentTask}
            disabled={!!cancellingTaskId}
          >
            {/* A filled square — the universal "stop" glyph. The old circle-with-a-dot read as a
                record button, not stop (owner, 2026-09-10). */}
            <span className="relative flex h-3.5 w-3.5 items-center justify-center rounded-full border" style={{ borderColor: "#f87171" }}>
              <Square size={7} fill="#f87171" stroke="#f87171" />
            </span>
            {cancellingTaskId ? "Stopping…" : "Stop Task"}
          </button>
        )}
        {!taskActive && task?.status === "cancelled" && !!lastOrderMessageRef.current && (
          <button
            className="lx-pill"
            style={{ cursor: chatBusy ? "default" : "pointer", padding: "5px 11px" }}
            onClick={restartLastOrder}
            disabled={chatBusy}
          >
            <RotateCcw size={11} /> Restart
          </button>
        )}
      </div>
    </div>
  ) : null;

  /* ---------------------------------------------------------------------- */

  return (
    <div className="lx-root flex h-screen w-full overflow-hidden">
      <GlobalStyle />

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
        {/* lg:pr-14 — the floating "Open AI assistant" button below is fixed at right-4/top-4,
            and every page whose header has buttons on the right had them sitting under it
            (owner, 2026-09-05: the Audit page's "Export as PDF" half-covered by it). The
            reserved strip is only on >=lg, which is the only size that button exists at. */}
        <main className={`lx-scroll flex-1 overflow-y-auto p-3 sm:p-4 ${desktopAssistantOpen ? "" : "lg:pr-14"}`} style={{ scrollbarGutter: "stable" }}>
          {children ?? (
            <>
              {Workflow}
              <Collapse open={panelOpen}>{AgentPanel}</Collapse>
              {Network}
              {BottomBar}
            </>
          )}
        </main>
      </div>

      {Assistant}

      {/* >=lg only: the assistant collapses to just this icon on every page except Dashboard
          (see desktopAssistantOpen above) — reopens the panel without eating main-content width
          until the owner actually wants it. Mobile already has its own always-visible open
          button in the topbar above, so this stays hidden there. */}
      {!desktopAssistantOpen && (
        <button
          className="lx-icobtn fixed right-4 top-4 z-40 hidden lg:flex"
          onClick={() => setDesktopAssistantOpen(true)}
          aria-label="Open AI assistant"
        >
          <Bot size={16} />
        </button>
      )}
    </div>
  );
}
