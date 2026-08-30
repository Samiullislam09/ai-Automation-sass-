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
import { useLiveEvents, isTerminalTask, isFlowing, useNow, elapsedMs, clock, type TaskState } from "@/lib/live";
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
  BrainCircuit,
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
  { label: "Chat", icon: MessageSquare },
  { label: "Office (Agents)", icon: Users, href: "/dashboard/workspace" },
  { label: "Approvals", icon: ListChecks, href: "/dashboard/approvals" },
  { label: "Connect", icon: Link2, href: "/dashboard/connect" },
  { label: "Schedule", icon: CalendarDays, href: "/dashboard/schedule" },
  { label: "Content", icon: FileText, href: "/dashboard/content" },
  { label: "Leads", icon: UserRound, href: "/dashboard/leads" },
  { label: "Site Brain", icon: Globe, href: "/dashboard/site-brain" },
  { label: "SEO & Insights", icon: TrendingUp, href: "/dashboard/audit" },
  { label: "Reports", icon: ClipboardList, href: "/dashboard/reports" },
  { label: "Memory", icon: BrainCircuit, href: "/dashboard/memory" },
  { label: "Settings", icon: Settings, href: "/dashboard/settings" },
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
  taskId?: string;
  /** The one highlight from what the order produced (a keyword, a title) — rendered as a chip,
   *  because that is what it is; burying it in a sentence made a keyword read like prose. */
  chip?: string;
  /** A themed button under the bubble — opens that agent's Live Visual instead of pasting its
   *  whole output into the transcript. */
  cta?: { label: string; agentId?: string };
};

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
            <span className={`h-1.5 w-1.5 rounded-full ${working ? "lx-pulse" : ""}`} style={{ background: statusColor }} />
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

  if (running) {
    return (
      <div>
        {/* the search box — real topic, never a placeholder */}
        <div className="lx-in flex items-center gap-2 px-3 py-2" style={{ borderRadius: 999 }}>
          <Search size={14} className="lx-mut shrink-0" />
          <span className="lx-12 min-w-0 flex-1 truncate">{topic || "…"}</span>
          <span className="lx-pulse h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#22c55e" }} />
        </div>
        <ul className="mt-2">
          {items.map((it) => (
            <li key={it.key} className="lx-live-anim flex items-center gap-2.5 rounded-lg px-3 py-2 lx-11" style={{ color: "#cfcfdd" }}>
              <Search size={12} className="lx-dim shrink-0" />
              <span className="min-w-0 flex-1 truncate">{it.payload?.keyword ?? "?"}</span>
              {num(it.payload?.searchVolume) != null && (
                <span className="lx-10 lx-mut shrink-0">{num(it.payload?.searchVolume)}/mo</span>
              )}
            </li>
          ))}
        </ul>
        {items.length === 0 && <div className="lx-10 lx-mut mt-3 px-1">Searching…</div>}
      </div>
    );
  }

  return (
    <div className="lx-scroll" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
        <thead>
          <tr className="lx-10 lx-mut" style={{ textAlign: "left" }}>
            <th style={{ padding: "6px 8px", fontWeight: 600 }}>Keyword</th>
            <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Volume</th>
            <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Competition</th>
            <th style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Fit</th>
            <th style={{ padding: "6px 8px" }} />
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const p = it.payload ?? {};
            const vol = num(p.searchVolume);
            const fit = num(p.fitScore);
            return (
              <tr key={it.key} style={{ borderTop: "1px solid var(--lx-border)" }}>
                <td className="lx-11" style={{ padding: "8px", color: "#e6e6f2" }}>
                  {p.keyword ?? "?"}
                  {p.gsc ? <span className="lx-pill green ml-2">already ranking</span> : null}
                </td>
                {/* "not measured" is the honest word when the free source has no number —
                    never a 0, which would read as "nobody searches this". */}
                <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{vol != null ? `${vol}/mo` : "not measured"}</td>
                <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{p.competitionLevel ?? "—"}</td>
                <td className="lx-11 lx-mut" style={{ padding: "8px", whiteSpace: "nowrap" }}>{fit != null ? `${Math.round(fit * 100)}%` : "—"}</td>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                  <button className="lx-ghost lx-10" style={{ padding: "4px 9px" }} onClick={() => onWriteArticle(String(p.keyword ?? ""))}>
                    Write article
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {items.length === 0 && <div className="lx-10 lx-mut px-1 py-2">No keywords were produced.</div>}
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

      {/* stats strip — real, built agents only (the 2 Planned ones above are shown on the
          network because the plan names them, but never counted here as staffed/active).
          "Success Rate 98.6%" and "Time Saved 32.4h" were removed 2026-08-31: both were fixed
          strings with no source anywhere in the product, and the file's own comment admitted
          it. Add either back the day something actually measures it. */}
      <div className="lx-card2 mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <StatTile icon={Users} color="#3b82f6" label="Total Agents" value={String(totalActive)} sub="Active" />
        <StatTile icon={Loader2} color="#3b82f6" label="Tasks Running" value={String(running)} sub="In Progress" spin />
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
  const { s: account, signOut } = useStore();

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
  // THE ONE ORDER THIS SCREEN IS ABOUT. A task that is still running always wins over a newer
  // finished one — `live.tasks[0]` alone meant the strip could sit on a cancelled or long-
  // finished order while real work ran underneath it, which is why the same topic appeared to
  // be stuck on screen forever (owner, 2026-08-31: "har waqt same hi topic"). Everything below
  // — agent statuses, the wires, the glow, the plan, the bottom strip — reads from THIS task
  // and nothing else, so the whole screen tells one consistent story.
  const task: TaskState | null = live.tasks.find((t) => !isTerminalTask(t.status)) ?? live.tasks[0] ?? null;
  const taskActive = !!task && !isTerminalTask(task.status);
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
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const [nav, setNav] = useState("Dashboard");
  const [tab, setTab] = useState("Live Activity");
  const [aTab, setATab] = useState<"assistant" | "voice">("assistant");
  const [sideOpen, setSideOpen] = useState(false); // <lg drawer
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
  const convId = useRef<string | null>(null);
  const helloSent = useRef(false); // React 18 strict-mode double-invokes effects in dev — without
  // this the real /api/chat "__hello__" greeting was requested twice on one mount.

  // The order the chat just placed (X-Run-Job — the real `tasks.id`, see lib/chat-brain.ts's
  // `jobId: created.task_id`). "On it" was the whole reply this turn: the model cannot say what
  // the team found because it hadn't happened yet. This is how the finished result gets back
  // into the thread once `live` (Realtime, same feed the Workspace panel reads) says the task is
  // done, instead of the bubble sitting on "On it" forever while the real answer only ever shows
  // up in Workspace/Approvals.
  const orderedTaskId = useRef<string | null>(null);
  const reportedTaskIds = useRef<Set<string>>(new Set());
  const startedLiveBubble = useRef<Set<string>>(new Set());

  // The agent panel (live activity, timeline, search results) exists to show ONE agent's
  // live work — it only makes sense while an agent is actually working. `workingAgent` is
  // that fact; `showPanel` is the user's own choice to look at it or step back to the whole
  // team (the "Back to Workflow" button), independent of whether anyone is still working.
  // Mr Lxwa checked first: when a plan starts with his own pick_topic step, he is the one
  // actually running before anyone else even has a step to run — the panel should open on him,
  // not sit closed until Mr. Keyword picks up afterward.
  const workingAgent = bossAgent.status === "Working" ? bossAgent : allAgents.find((a) => a.status === "Working") ?? null;
  const [showPanel, setShowPanel] = useState(!!workingAgent);
  // Which agent the user asked to look at, by clicking its card. Null = "just follow the work"
  // (whoever is running, else whoever ran last). Set by openAgentPanel below; cleared when the
  // panel is closed, so the next auto-open follows the work again rather than being stuck on
  // an agent the user looked at ten minutes ago.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  // The panel used to require `workingAgent`, so it vanished the instant the last step finished
  // — the user watched it disappear exactly when the result became worth reading. It now stays
  // on whatever task it was opened for until the user closes it (X), which is also what makes
  // the finished state readable at all.
  const panelOpen = showPanel && !!task;
  // Who the panel is about: the agent the user clicked, else whoever is working, else whoever
  // ran most recently in this task — never a hardcoded "Mr. Writer" fallback, which is what it
  // used to show for every agent.
  const lastStep = task ? [...task.steps].filter((s) => s.startedAt != null).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] : null;
  const panelAgent =
    (selectedAgentId ? [...allAgents, bossAgent].find((a) => a.id === selectedAgentId) ?? null : null) ??
    workingAgent ??
    (lastStep ? [...allAgents, bossAgent].find((a) => a.id === lastStep.agent_id) ?? null : null);
  // Auto-open on the rising edge of AN ACTIVE ORDER — not of "somebody is Working".
  //
  // Keyed off `workingAgent` before, this missed the case the owner actually hits: for the first
  // seconds after an order is placed the task exists but every step is still `pending`, so no
  // agent is "Working", so nothing opened — and by the time a step did start, the effect's
  // dependency was a fresh object on every render rather than a value that changed, which is not
  // something to rely on. `taskActive` is a boolean, so this fires exactly once per new order,
  // immediately, and the panel is already open to show the plan landing and then each agent
  // taking its turn. Closing it still sticks: the flag only re-arms when the next order starts.
  const hadActiveTask = useRef(false);
  useEffect(() => {
    if (taskActive && !hadActiveTask.current) setShowPanel(true);
    hadActiveTask.current = taskActive;
  }, [taskActive]);

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
      const runJob = res.headers.get("X-Run-Job");
      if (runJob) orderedTaskId.current = runJob;
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
        // An accepted order now replies with NO text (see lib/chat-brain.ts) — the live strip
        // is the status. Drop the placeholder instead of leaving an empty bubble behind.
        if (!full.trim()) return p.slice(0, -1);
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

    if (!isTerminalTask(t.status)) {
      const runningNow = t.steps.find((s) => s.status === "running");
      const latestLine = t.lines[t.lines.length - 1];
      const liveText = runningNow?.progressLabel || runningNow?.label || latestLine?.text || "On it…";
      setThread((p) => {
        if (!startedLiveBubble.current.has(id)) {
          startedLiveBubble.current.add(id);
          return [...p, { who: "ai", text: liveText, time: nowTime(), live: true, taskId: id }];
        }
        const i = p.findIndex((m) => m.taskId === id);
        if (i < 0 || p[i].text === liveText) return p;
        const next = [...p];
        next[i] = { ...next[i], text: liveText };
        return next;
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
  }, [live.byTask]);

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
          const badge = it.label === "Approvals" ? approvalsCount : it.badge;
          const inner = (
            <>
              <it.icon size={16} strokeWidth={1.8} />
              <span className="truncate">{it.label}</span>
              {badge ? (
                <span
                  className="ml-auto flex h-5 w-5 items-center justify-center rounded-full lx-10 font-bold text-white"
                  style={{ background: "linear-gradient(135deg,#7c3aed,#8b5cf6)", boxShadow: "0 0 10px rgba(139,92,246,.6)" }}
                >
                  {badge}
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

        {/* system status — every number below reads off `live` (lib/live.ts's useLiveEvents),
            not a mock. Was 4 hardcoded numbers + a fixed decorative sparkline until 2026-08-31
            (found live: it kept claiming "7 active tasks" with nothing running). "Server Load"
            had no client-side source at all and is dropped rather than faked. */}
        <div className="lx-card2 mt-4 p-3">
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
  // EVERY card opens its own agent's live view — including Mr Lxwa's brain card, and including
  // agents that are idle or already finished. It used to open only for an agent whose status
  // was exactly "Working", so nine of the ten cards were inert clicks and the user could never
  // ask "what did Mr. Keyword actually do?" after it finished (owner's ask, 2026-08-31).
  // A "Planned" agent (Mr. Image / Mr. Story) still does nothing: it has no code behind it, so
  // there is genuinely nothing to show.
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
          bossAgent={bossAgent}
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
  // Everything the panel shows is scoped to `panelAgent` — the card the user clicked (or, if
  // they clicked nothing, whoever is working). Before this it always showed the whole task's
  // combined output no matter which agent you were looking at, so clicking Mr. Keyword and
  // clicking Mr. Writer rendered exactly the same panel.
  const panelStep =
    (panelAgent ? task?.steps.find((s) => s.agent_id === panelAgent.id && s.status === "running") : null) ??
    (panelAgent ? [...(task?.steps ?? [])].filter((s) => s.agent_id === panelAgent.id).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] : null) ??
    null;
  const runningStep = panelStep?.status === "running" ? panelStep : null;
  const stepNo = task && panelStep ? task.steps.findIndex((s) => s.key === panelStep.key) + 1 : null;
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
  // This agent's own sentences, plus the task-level ones (agent_id null) that frame them.
  const panelLines = (task?.lines ?? []).filter((ln) => !panelAgent || ln.agent_id == null || ln.agent_id === panelAgent.id);

  // THE TABS: only the agents that are genuinely part of THIS order, in plan order — replacing
  // the five fixed labels ("Live Activity / Research / Writing / …") that rendered identical
  // content whichever you clicked. §24.4b asks for exactly this: tabs per agent, showing what
  // that agent did on this task.
  const taskAgents: Agent[] = Array.from(new Set((task?.steps ?? []).map((s) => s.agent_id)))
    .map((id) => [...allAgents, bossAgent].find((a) => a.id === id))
    .filter((a): a is Agent => !!a);

  // Mr. Keyword's own rows for this order, and the topic it was searching — used by the live
  // keyword screen below.
  const keywordItems = producedItems.filter((it) => it.kind === "keyword");
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
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Robo size={26} />
          <div className="min-w-0 leading-tight">
            {/* Real agent, real clock. Was `workingAgent?.name ?? "Mr. Writer"` plus a mock
                timer that counted up from 272 seconds regardless of anything — so a finished
                Mr. Keyword run displayed as "Mr. Writer · 00:04:47". elapsedMs()/clock() come
                from lib/live.ts and freeze at the task's real finishedAt. */}
            <div className="truncate text-sm font-bold">{panelAgent?.name ?? "Team"}</div>
            <div className="lx-10 lx-mut truncate">
              {panelAgent?.role ?? "Waiting for work"}
              {task ? ` · ${clock(elapsedMs(task, now))}` : ""}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="lx-icobtn" aria-label="Close" onClick={closeAgentPanel}>
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
            {/* LIVE only when evidence is genuinely still arriving — isFlowing() is lib/live.ts's
                own stall gate (§24.5: "agent ruka hai to screen bhi ruki dikhe"). It used to be
                a permanently-pulsing red LIVE pill, which said "live" over a task that had
                finished minutes ago. */}
            {/* Kept as a permanent LIVE pill at the owner's request (2026-08-31). */}
            <span className="lx-pill red">
              <span className="lx-pulse h-1.5 w-1.5 rounded-full" style={{ background: "#ef4444" }} /> LIVE
            </span>
          </div>

          {/* Fixed height + its own scrollbar: a 20-row keyword table used to push the panel
              (and the page) far past the fold — "content box se bahar nahi jayega". */}
          <div className="lx-card2 lx-scroll mt-3 p-3" style={{ minHeight: 360, maxHeight: 460, overflowY: "auto" }}>
            <div key={runningStep?.key ?? "idle"} className="lx-live-anim">
              <div className="flex items-center gap-2 lx-11 font-semibold">
                <PenLine size={13} className="lx-mut" />
                {runningStep?.progressLabel || runningStep?.label || (task && isTerminalTask(task.status) ? "Finished" : "Waiting to start…")}
              </div>

              {/* Each agent gets the screen its own output deserves (§24.4b's "typed
                  component"), not one generic bullet list. Mr. Keyword's is the Google-style
                  search while it runs and a real table when it is done; everything else keeps
                  the honest per-item list until it earns a screen of its own. */}
              <div className="mt-3">
                {panelAgent?.id === "keyword" ? (
                  <KeywordScreen
                    items={keywordItems}
                    topic={taskTopic}
                    running={!!runningStep}
                    onWriteArticle={orderArticleFor}
                  />
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

          {/* Mr Lxwa's plan — task.outline, built by the real planner (agent-server's
              planner.ts) the instant the order was accepted, over the actual manifest graph for
              this order (not a canned list — a "publish karo" order gets a different plan than
              a draft, and one where a topic had to be picked shows Mr Lxwa's own pick_topic step
              first). Was computed all along and shown only on the Office page; the owner asked
              for it here too, 2026-08-31 ("boss ne jo plan bana ye ha wo b dikhna chaaya"). */}
          {task && task.outline.length > 0 && (
            <div className="lx-card2 mt-3 p-3">
              <div className="flex items-center gap-1.5 lx-11 font-semibold" style={{ color: "var(--lx-violet)" }}>
                <BrainCircuit size={13} /> Mr Lxwa&apos;s Plan
              </div>
              <ol className="mt-1.5 space-y-1">
                {task.outline.map((line, i) => (
                  <li key={i} className="lx-11" style={{ color: "#cfcfdd" }}>{line}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Tabs = the agents that actually worked on THIS order (§24.4b). They used to be five
              fixed labels that all rendered the same thing; now each one switches the screen
              above to that agent's own output and its own timeline below. */}
          <div className="lx-scroll mt-3 flex gap-5 overflow-x-auto border-b" style={{ borderColor: "var(--lx-border)" }}>
            {taskAgents.map((a) => (
              <button
                key={a.id}
                className={`lx-tab ${panelAgent?.id === a.id ? "on" : ""}`}
                onClick={() => setSelectedAgentId(a.id)}
                title={`${a.name} — ${a.status}`}
              >
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${a.status === "Working" ? "lx-pulse" : ""}`}
                    style={{ background: STATUS_COLOR[a.status] }}
                  />
                  {a.name}
                </span>
              </button>
            ))}
            {taskAgents.length === 0 && <span className="lx-tab lx-mut">No agents on this order yet</span>}
          </div>

          <div className="lx-13 mt-4 font-semibold">
            {panelAgent ? `What ${panelAgent.name} is doing` : "What the team is doing"}
          </div>

          {/* timeline — task.lines: real, human-readable events (lib/live.ts's userMessage()),
              never a raw prompt/error string. Scoped to the agent whose card was clicked; task-
              level lines (agent_id null — "On it — 4 steps", "Done") always stay, since they are
              the frame every agent's work sits inside. */}
          <div className="lx-tl mt-1">
            {panelLines.length === 0 && <div className="lx-11 lx-mut py-2">No activity yet.</div>}
            {panelLines.slice(-8).map((ln) => {
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
        <div className="ml-auto flex items-center gap-1">
          <button className="lx-icobtn" onClick={closeAssistant} aria-label="Close assistant">
            <X size={14} />
          </button>
          <button className="lx-icobtn" style={{ border: "none", background: "transparent" }} aria-label="More">
            <MoreVertical size={15} />
          </button>
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
                  {/* live task-status bubble only (see the effect that writes `taskId`) — the
                      model's own streaming reply is `live` too but never carries a taskId, so
                      this dot never shows for an ordinary in-progress reply. */}
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
                  {m.text ? boldText(m.text, `m${i}`) : m.live ? "…" : ""}
                </div>
                {m.chip && (
                  <div style={{ marginLeft: 30 }} className="mt-1.5">
                    <span className="lx-pill purple" style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", display: "inline-block" }}>
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
      {task && (
        <div className="lx-card2 mx-3 mb-2 px-3 py-2">
          {/* COLLAPSED BY DEFAULT — one line. The full card (order text, the ticking plan, the
              bar, the review link) was several lines tall and permanently ate the chat's own
              space; it now opens on the chevron and animates, so the detail is one click away
              instead of always in the way. */}
          <button
            className="flex w-full items-center gap-2 bg-transparent text-left"
            style={{ border: "none", padding: 0, cursor: "pointer" }}
            onClick={() => setStripOpen((o) => !o)}
            aria-expanded={stripOpen}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${taskActive ? "lx-pulse" : ""}`}
              style={{ background: taskActive ? "#22c55e" : "#8b8ba0", boxShadow: taskActive ? "0 0 8px #22c55e" : "none" }}
            />
            <span className="lx-11 min-w-0 flex-1 truncate font-semibold">
              {taskActive
                ? runningStep?.progressLabel || runningStep?.label || "Starting…"
                : task.status === "needs_attention" || task.status === "failed"
                  ? task.reason || "Stopped"
                  : "Done"}
            </span>
            {stepNo != null && totalSteps != null && (
              <span className="lx-10 lx-mut shrink-0">{stepNo}/{totalSteps}</span>
            )}
            <ChevronDown
              size={13}
              className="lx-mut shrink-0"
              style={{ transform: stripOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }}
            />
          </button>

          <Collapse open={stripOpen}>
            <div className="pt-2">
              <div className="lx-10 lx-mut truncate">{task.echo}</div>

              {/* THE PLAN, TICKING. Mr Lxwa's real steps (task_steps, in plan order), each row
                  animating in as the plan lands and then flipping to done as its agent
                  finishes. Built from the real rows, so it can never show a step that is not in
                  the plan or tick one that has not finished. */}
              {task.steps.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {task.steps.map((st, i) => {
                    const nm = [...allAgents, bossAgent].find((a) => a.id === st.agent_id)?.name ?? st.agent_id;
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
              {isTerminalTask(task.status) && reviewHref && (
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
          <button
            onClick={send}
            disabled={chatBusy || !msg.trim()}
            aria-label="Send"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#4f46e5,#8b5cf6)", border: "none", cursor: chatBusy ? "default" : "pointer", boxShadow: "0 0 12px rgba(124,58,237,.5)" }}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </aside>
  );

  /* ---------------------------------------------------------------------- */

  // Real cancel — POSTs to app/api/tasks/[id]/cancel, which is the thin server-side door onto
  // lib/brain.ts's cancelTask() (needs AGENT_SERVER_URL/the shared token, so it cannot run in
  // the browser directly). Refreshes the task list on success so the bar reflects "cancelled"
  // the same tick the brain confirms it, rather than sitting on a stale progress bar.
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
        <span className="font-semibold">{task.echo || task.kind || "Untitled order"}</span>
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
            <span className="relative flex h-3 w-3 items-center justify-center rounded-full border" style={{ borderColor: "#f87171" }}>
              <span className="h-1 w-1 rounded-sm" style={{ background: "#f87171" }} />
            </span>
            {cancellingTaskId ? "Stopping…" : "Stop Task"}
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
        <main className="lx-scroll flex-1 overflow-y-auto p-3 sm:p-4" style={{ scrollbarGutter: "stable" }}>
          {children ?? (
            <>
              {Workflow}
              <Collapse open={panelOpen}>{AgentPanel}</Collapse>
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
