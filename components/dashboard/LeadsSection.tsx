"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Ellipsis, Mail, Plus, Search, SlidersHorizontal, Sparkles, PenLine, TriangleAlert, UserRound, Users, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useStore } from "@/lib/store";
import { C, D, STAGE, SOURCE_LABEL, SORT_LABEL, REJECT_REASONS, ago, scoreColor, isToday, fmtDay, siteLabel, initials, cityOf, countryOf, phoneDisplay, StageChip, Tag, WaGlyph, RejectMenu, DATE_LABEL, SCORE_LABEL, MSG_LABEL, msgValue, msgFlags, type Lead, type Gen } from "./leads/shared";
import type { Flt } from "./leads/FilterPanel";
import Select from "./leads/Select";
import ScheduledRunCard from "./ScheduledRunCard";

// Opened on demand, so they are not part of the page's first download.
const LeadDrawer = dynamic(() => import("./leads/LeadDrawer"), { ssr: false });
const FilterPanel = dynamic(() => import("./leads/FilterPanel"), { ssr: false });
const AddLeadModal = dynamic(() => import("./leads/AddLeadModal"), { ssr: false });
const LeadGenPanel = dynamic(() => import("./leads/LeadGenPanel"), { ssr: false });
const BuyerProfilePanel = dynamic(() => import("./BuyerProfilePanel"), { ssr: false });


/** /dashboard/leads — a light, CRM-style lead board.
 *
 *  Layout (top to bottom): header (title, count, one primary action) → one summary strip →
 *  ONE card holding the pipeline tabs, the search/filter/sort toolbar, a bulk-action bar and the
 *  lead table (a compact list on phones) → a slide-over detail drawer.
 *
 *  Colour system: the brand purple + slate neutrals, and only three meanings of colour:
 *  green = good news (a reply, a win), amber = needs you, red = negative. Stage chips are neutral
 *  with a coloured dot so a column of them reads calmly. No emoji; icons are lucide / SVG.
 *
 *  WHAT IS REAL. Every number comes from /api/leads/board (the tenant's own rows), counted on the
 *  client in one pass. "AI" = a message Mr. Brain drafted, "You" = a message a person sent. Nothing
 *  here is a placeholder. */

const REPLIED_STAGES = ["replied", "in_conversation", "interested"];
const OUT = ["rejected", "opted_out", "invalid", "failed"];
const TAB_MATCH: Record<string, (l: Lead) => boolean> = {
  all: () => true,
  // Needs you: Mr Lxwa flagged it for a human, and it isn't already dead.
  needs: (l) => !!l.needs_attention && !OUT.includes(l.stage),
  new: (l) => isToday(l.created_at), // added in the last 24h
  // Engaged = they answered. Contacted = we wrote, they have not answered yet. No overlap.
  engaged: (l) => REPLIED_STAGES.includes(l.stage) || !!l.last_in_at,
  contacted: (l) => l.messaged && !(REPLIED_STAGES.includes(l.stage) || !!l.last_in_at) && !OUT.includes(l.stage),
  // Hot = a meeting is in play, or they are ready to buy.
  hot: (l) => ["meeting_requested", "meeting_scheduled", "meeting_done", "ready_to_buy"].includes(l.stage),
  won: (l) => l.converted,
  rejected: (l) => l.stage === "rejected",
  // kept so older links / saved states still resolve
  meetings: (l) => ["meeting_requested", "meeting_scheduled", "meeting_done"].includes(l.stage),
  ready_to_buy: (l) => l.stage === "ready_to_buy",
  converted: (l) => l.converted,
  client: (l) => l.is_client,
  ai_messaged: (l) => l.ai_messaged,
  employee_messaged: (l) => l.human_messaged,
  not_messaged: (l) => !l.messaged,
};
// The last board we loaded. Kept at module level (survives client-side navigation) and in
// sessionStorage (survives a reload), so the page paints from it immediately and refreshes behind it.
type Board = { leads: Lead[]; gen: Gen | null };
const CACHE_KEY = "lx-leads-board-v2";
let boardCache: Board | null = null;
function readCache(): Board | null {
  if (boardCache) return boardCache;
  try { const raw = sessionStorage.getItem(CACHE_KEY); if (raw) { const b = JSON.parse(raw) as Board; if (Array.isArray(b.leads)) { boardCache = b; return b; } } } catch {}
  return null;
}
// WhatsApp "is this lead on WhatsApp" answers received this session, by lead id (the server also stores them on the lead).
const WA_KEY = "lx-wa-status-v2";
function readWa(): Record<string, "yes" | "no"> {
  try { const raw = sessionStorage.getItem(WA_KEY); if (raw) return JSON.parse(raw); } catch {}
  return {};
}
function writeWa(m: Record<string, "yes" | "no">) { try { sessionStorage.setItem(WA_KEY, JSON.stringify(m)); } catch {} }
const PIPE: [string, string][] = [
  ["needs", "Needs you"], ["all", "All"], ["new", "New"], ["contacted", "Contacted"],
  ["engaged", "Engaged"], ["hot", "Hot"], ["won", "Won"], ["rejected", "Rejected"],
];

/* ------------------------------------------------------------------ small pieces */

/** One surface, four numbers, 1px dividers: not four cards. */
function Summary({ items }: { items: { label: string; value?: number; note: string; warn?: boolean }[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden lg:grid-cols-4" style={{ background: C.line, border: `1px solid ${C.line}` }}>
      {items.map((it) => (
        <div key={it.label} className="px-5 py-4" style={{ background: C.panel }}>
          <div className="text-[12px]" style={{ color: C.sub }}>{it.label}</div>
          <div className="mt-0.5 text-[24px] font-semibold leading-tight tabular-nums" style={{ color: it.warn && (it.value ?? 0) > 0 ? C.amber : C.ink }}>{it.value ?? "—"}</div>
          <div className="mt-0.5 text-[12px]" style={{ color: C.sub }}>{it.note}</div>
        </div>
      ))}
    </div>
  );
}

/** The score as a number and a thin bar (green 70+, amber 40-69, red below). */
function Score({ s, compact }: { s: number | null; compact?: boolean }) {
  if (s == null) return <span className="text-[13px]" style={{ color: C.sub }} title="Not scored yet">—</span>;
  return (
    <div className="flex items-center gap-2" title={`Lead score ${s} out of 100`}>
      <span className="w-6 text-[13px] tabular-nums" style={{ color: C.ink }}>{s}</span>
      <span className="overflow-hidden rounded-full" style={{ width: compact ? 40 : 56, height: 6, background: C.graySoft }}>
        <i className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(4, s))}%`, background: scoreColor(s) }} />
      </span>
    </div>
  );
}

/** What happened last, in words. No badges. */
function ActivityCell({ l }: { l: Lead }) {
  const inAt = l.last_in_at ? new Date(l.last_in_at).getTime() : 0;
  const outAt = l.last_out_at ? new Date(l.last_out_at).getTime() : 0;
  if (!inAt && !outAt) {
    return <span className="text-[13px]" style={{ color: C.sub }}>{isToday(l.created_at) ? "Added today" : `Added ${fmtDay(l.created_at)}`}</span>;
  }
  const replied = inAt >= outAt;
  const snippet = (replied ? l.last_in_body : l.last_out_body) ?? "";
  return (
    <div className="min-w-0">
      <div className="text-[13px]" style={{ color: C.ink }}>{replied ? "Replied" : "Message sent"} <span style={{ color: C.sub }}>· {ago(replied ? l.last_in_at : l.last_out_at)}</span></div>
      {snippet && <div className="mt-0.5 truncate text-[12px]" style={{ color: C.sub, maxWidth: 260 }}>{snippet}</div>}
    </div>
  );
}

/** Row actions: three quiet line icons. `lg` is the phone version: labelled, 44px tall. */
function LeadActions({ l, setStage, busy, waLink, size, showWa }: { l: Lead; setStage: (l: Lead, s: string, reason?: string) => void; busy: string | null; waLink: (l: Lead) => string; size: "sm" | "lg"; showWa: boolean }) {
  const lg = size === "lg";
  if (l.stage === "rejected") {
    return <button className={`rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-[#f9fafb] disabled:opacity-40 ${lg ? "h-11 w-full" : "h-8"}`} style={{ color: C.ink, background: C.panel, borderColor: C.line }} disabled={busy === l.id} onClick={() => setStage(l, "approved")}>Restore lead</button>;
  }
  if (l.stage === "opted_out") return <span className="text-[12px]" style={{ color: C.sub }}>Opted out</span>;
  const base = `inline-flex items-center justify-center gap-2 rounded-lg border text-[13px] font-medium transition-colors duration-150 ease-out ${lg ? "h-11 flex-1" : "h-8 w-8"}`;
  const live = `${base} hover:bg-[#f9fafb] hover:text-[#111827]`;
  const dead = `${base} cursor-not-allowed opacity-40`;
  const st = { color: C.sub, background: C.panel, borderColor: C.line, textDecoration: "none" } as const;
  return (
    <div className={`flex items-center gap-2 ${lg ? "w-full" : ""}`}>
      {showWa && <a href={waLink(l)} aria-label={`Open WhatsApp chat with ${l.company || l.name || "lead"}`} title="WhatsApp chat" className={live} style={st}><WaGlyph size={16} />{lg && <span>WhatsApp</span>}</a>}
      {l.email
        ? <a href={`mailto:${l.email}`} aria-label={`Email ${l.email}`} title={`Email ${l.email}`} onClick={(e) => e.stopPropagation()} className={live} style={st}><Mail size={16} />{lg && <span>Email</span>}</a>
        : <span aria-label="No email" title="No email" className={dead} style={st}><Mail size={16} />{lg && <span>Email</span>}</span>}
      <RejectMenu variant="icon" large={lg} disabled={busy === l.id} onPick={(reason) => setStage(l, "rejected", reason)} />
    </div>
  );
}

/** Loading placeholder. Static on purpose: nothing loops. */
function SkeletonRows() {
  const bar = (w: string, h = 10) => <span className="block rounded" style={{ width: w, height: h, background: C.graySoft }} />;
  return (
    <div aria-busy="true" aria-label="Loading leads">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-6 px-5 py-4" style={{ borderTop: `1px solid ${C.line}` }}>
          <div className="flex-1 space-y-2">{bar("34%", 12)}{bar("22%")}</div>
          <span className="max-md:hidden">{bar("28px")}</span><span className="max-md:hidden">{bar("22%")}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ the page */

export default function LeadsSection() {
  const { toast } = useStore();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [err, setErr] = useState("");
  const [gen, setGen] = useState<Gen | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  // The lead-generation panel under the summary cards: closed → nothing; manual → the inline
  // "what & where" form; live → the real-time progress card; done → the "found N" summary.
  const [genPanel, setGenPanel] = useState<"closed" | "manual" | "live" | "done">("closed");
  const [genTarget, setGenTarget] = useState<number | null>(null);
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const wasRunning = useRef(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateRange, setDateRange] = useState("all"); // all | today | 7d | 30d
  const [sort, setSort] = useState("newest"); // newest | oldest | score | name
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Advanced filters, applied on top of the tab + search. Empty = no constraint.
  const [flt, setFlt] = useState<{ status: string[]; source: string[]; city: string[]; ai: string; you: string; converted: string; client: string; score: string }>(
    { status: [], source: [], city: [], ai: "any", you: "any", converted: "any", client: "any", score: "any" }
  );

  const lastBody = useRef("");
  const load = useCallback(async () => {
    try {
      // The server sends an ETag, so an unchanged board comes back as a tiny 304 the browser answers from cache.
      const text = await fetch("/api/leads/board").then((r) => r.text());
      if (text === lastBody.current) { setErr(""); return; } // identical to what is on screen: no work
      const d = JSON.parse(text);
      if (d.ok) { lastBody.current = text; setLeads(d.leads); setGen(d.gen ?? null); setErr(""); }
      else setErr(d.error ?? "Could not load leads.");
    } catch (e: any) { setErr(e?.message ?? "Network error."); }
  }, []);

  // First paint from the last board we saw (if any), then refresh in the background.
  useEffect(() => {
    const c = readCache();
    if (c) { setLeads(c.leads); setGen(c.gen); }
    load();
  }, [load]);

  // Keep the cache current (including optimistic changes), written when the browser is idle.
  useEffect(() => {
    if (!leads) return;
    boardCache = { leads, gen };
    const t = setTimeout(() => { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(boardCache)); } catch {} }, 600);
    return () => clearTimeout(t);
  }, [leads, gen]);

  // Warm the on-demand chunks while the browser is idle, so the first click on a lead or on Filters is instant.
  useEffect(() => {
    const warm = () => { import("./leads/LeadDrawer"); import("./leads/FilterPanel"); };
    const w = window as any;
    const id = w.requestIdleCallback ? w.requestIdleCallback(warm, { timeout: 4000 }) : setTimeout(warm, 1500);
    return () => { if (w.cancelIdleCallback && w.requestIdleCallback) w.cancelIdleCallback(id); else clearTimeout(id); };
  }, []);

  // The drawer's heavy fields (draft, evidence, score breakdown...) are not in the list; fetch them for the one lead
  // that was opened, once.
  const [details, setDetails] = useState<Record<string, Partial<Lead>>>({});
  useEffect(() => {
    const id = selected?.id;
    if (!id || details[id]) return;
    let alive = true;
    fetch(`/api/leads/${id}`).then((r) => r.json()).then((d) => { if (alive) setDetails((m) => ({ ...m, [id]: d?.ok ? (d.detail ?? {}) : {} })); }).catch(() => { if (alive) setDetails((m) => ({ ...m, [id]: {} })); });
    return () => { alive = false; };
  }, [selected?.id, details]);

  // typing in the search box filters after a short pause, not on every keystroke
  useEffect(() => { const t = setTimeout(() => setQ(qInput), 200); return () => clearTimeout(t); }, [qInput]);

  // While a discovery job is running, poll so the live panel's "found so far" grows by itself.
  useEffect(() => {
    if (!gen?.running) return;
    const id = setInterval(async () => {
      if (document.hidden) return;
      try {
        const d = await fetch("/api/leads/board?mode=gen").then((r) => r.json());
        if (d?.ok) { setGen(d.gen); if (!d.gen?.running) load(); } // the run ended: pull the new leads once
      } catch {}
    }, 4000);
    return () => clearInterval(id);
  }, [gen?.running, load]);

  // Drive the panel from the server's truth: a run in flight (started here, from chat, or by the
  // schedule) shows the live card; the moment it stops, flip to the "done" summary once.
  useEffect(() => {
    if (gen?.running) {
      wasRunning.current = true;
      setGenPanel((p) => (p === "manual" ? p : "live"));
    } else if (gen && wasRunning.current) {
      wasRunning.current = false;
      setGenPanel("done");
    }
  }, [gen, gen?.running]);

  // The run's target count survives a reload via sessionStorage (jobs_log doesn't record it).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("lx-leadgen-target");
      if (raw) setGenTarget(Number(raw) || null);
    } catch {}
  }, []);

  const findLeads = async (query: string, count: number, city: string) => {
    setGenBusy(true);
    try {
      const d = await fetch("/api/agents/trigger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "leads", ...(query ? { query } : {}), ...(city ? { city } : {}), count }) }).then((r) => r.json());
      if (!d.ok) { toast(d.error ?? "Could not start lead search.", "error"); return; }
      try { sessionStorage.setItem("lx-leadgen-target", String(count)); } catch {}
      setGenTarget(count);
      setGen((g) => ({ ...(g ?? { last_run_at: null, last_status: null, last_found: null, last_note: null }), running: true, running_since: new Date().toISOString() }));
      setGenPanel("live");
      toast("Mr. Lead is searching — watch the new leads arrive below.");
      setTimeout(load, 2000);
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
    finally { setGenBusy(false); }
  };

  const setStage = async (l: Lead, stage: string, rejectReason?: string) => {
    setBusy(l.id);
    try {
      const d = await fetch(`/api/leads/${l.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, ...(rejectReason ? { reject_reason: rejectReason } : {}) }) }).then((r) => r.json());
      if (!d.ok) { toast(d.error ?? "Couldn't update.", "error"); return; }
      setLeads((prev) => prev?.map((x) => (x.id === l.id ? { ...x, stage, ...(rejectReason ? { reject_reason: rejectReason } : {}) } : x)) ?? prev);
      setSelected((s) => (s && s.id === l.id ? { ...s, stage, ...(rejectReason ? { reject_reason: rejectReason } : {}) } : s));
      toast(rejectReason ? "Rejected — I'll use that to find better leads." : "Updated.");
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
    finally { setBusy(null); }
  };

  /** Reject every selected lead with one reason (a few requests at a time, not all at once). */
  const bulkReject = async (reason: string) => {
    const ids = Array.from(sel);
    if (!ids.length) return;
    setBulkBusy(true);
    const okIds: string[] = [];
    try {
      for (let i = 0; i < ids.length; i += 6) {
        const chunk = ids.slice(i, i + 6);
        const res = await Promise.all(chunk.map((id) =>
          fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: "rejected", reject_reason: reason }) }).then((r) => r.json()).catch(() => ({ ok: false }))
        ));
        chunk.forEach((id, k) => { if (res[k]?.ok) okIds.push(id); });
      }
      setLeads((prev) => prev?.map((x) => (okIds.includes(x.id) ? { ...x, stage: "rejected", reject_reason: reason } : x)) ?? prev);
      toast(okIds.length === ids.length ? `Rejected ${okIds.length} lead${okIds.length === 1 ? "" : "s"}.` : `Rejected ${okIds.length} of ${ids.length}. The rest could not be updated.`, okIds.length ? undefined : "error");
      setSel(new Set());
    } finally { setBulkBusy(false); }
  };

  const filtered = useMemo(() => {
    if (!leads) return [];
    const match = TAB_MATCH[tab] ?? TAB_MATCH.all;
    const needle = q.trim().toLowerCase();
    const inScore = (sc: number | null, band: string) => {
      if (band === "any") return true;
      if (sc == null) return false;
      if (band === "0-25") return sc <= 25;
      if (band === "26-50") return sc > 25 && sc <= 50;
      if (band === "51-75") return sc > 50 && sc <= 75;
      return sc > 75;
    };
    const rows = leads.filter((l) => {
      if (!match(l)) return false;
      if (flt.status.length && !flt.status.includes(l.stage)) return false;
      if (flt.source.length && !flt.source.includes(l.source ?? "")) return false;
      if (flt.city.length && !flt.city.includes(countryOf(l))) return false; // `city` key holds Country values (filter relabelled)
      if (flt.ai === "yes" && !l.ai_messaged) return false;
      if (flt.ai === "no" && l.ai_messaged) return false;
      if (flt.you === "yes" && !l.human_messaged) return false;
      if (flt.you === "no" && l.human_messaged) return false;
      if (flt.converted === "yes" && !l.converted) return false;
      if (flt.converted === "no" && l.converted) return false;
      if (flt.client === "yes" && !l.is_client) return false;
      if (flt.client === "no" && l.is_client) return false;
      if (!inScore(l.icp_score, flt.score)) return false;
      if (dateRange !== "all") {
        const days = dateRange === "today" ? 1 : dateRange === "7d" ? 7 : 30;
        if (Date.now() - new Date(l.created_at).getTime() > days * 86400000) return false;
      }
      if (!needle) return true;
      return [l.company, l.name, l.email, l.phone, l.whatsapp, l.country].some((v) => String(v ?? "").toLowerCase().includes(needle));
    });
    const t = (l: Lead) => new Date(l.created_at).getTime();
    const cmp: Record<string, (a: Lead, b: Lead) => number> = {
      newest: (a, b) => t(b) - t(a),
      oldest: (a, b) => t(a) - t(b),
      score: (a, b) => (b.icp_score ?? -1) - (a.icp_score ?? -1),
      name: (a, b) => String(a.company || a.name || "").localeCompare(String(b.company || b.name || "")),
    };
    return [...rows].sort(cmp[sort] ?? cmp.newest);
  }, [leads, tab, q, flt, dateRange, sort]);

  // Every tab count and summary number in ONE pass over the leads (was several passes per render).
  const counts = useMemo(() => {
    const c = { all: 0, needs: 0, new: 0, contacted: 0, engaged: 0, hot: 0, won: 0, rejected: 0, ai: 0, human: 0 } as Record<string, number>;
    for (const l of leads ?? []) {
      c.all++;
      if (TAB_MATCH.needs(l)) c.needs++;
      if (TAB_MATCH.new(l)) c.new++;
      if (TAB_MATCH.contacted(l)) c.contacted++;
      if (TAB_MATCH.engaged(l)) c.engaged++;
      if (TAB_MATCH.hot(l)) c.hot++;
      if (l.converted) c.won++;
      if (l.stage === "rejected") c.rejected++;
      if (l.ai_messaged) c.ai++;
      if (l.human_messaged) c.human++;
    }
    return c;
  }, [leads]);

  // What is filtered right now, as chips you can remove one by one (shown under the search bar).
  const activeChips: [string, () => void][] = [
    ...(dateRange !== "all" ? [[`Added: ${DATE_LABEL[dateRange]}`, () => setDateRange("all")] as [string, () => void]] : []),
    ...flt.source.map((v) => [SOURCE_LABEL[v] ?? v, () => setFlt({ ...flt, source: flt.source.filter((x) => x !== v) })] as [string, () => void]),
    ...flt.city.map((v) => [v, () => setFlt({ ...flt, city: flt.city.filter((x) => x !== v) })] as [string, () => void]),
    ...(flt.score !== "any" ? [[`Score ${SCORE_LABEL[flt.score]}`, () => setFlt({ ...flt, score: "any" })] as [string, () => void]] : []),
    ...(msgValue(flt) !== "any" ? [[MSG_LABEL[msgValue(flt)], () => setFlt({ ...flt, ...msgFlags("any") })] as [string, () => void]] : []),
  ];
  const activeFilterCount =
    flt.status.length + flt.source.length + flt.city.length +
    ["ai", "you", "converted", "client", "score"].filter((k) => (flt as any)[k] !== "any").length;
  const clearAll = () => { setFlt({ status: [], source: [], city: [], ai: "any", you: "any", converted: "any", client: "any", score: "any" }); setDateRange("all"); setQInput(""); setQ(""); setTab("all"); };

  const exportCsv = (only?: Lead[]) => {
    const list = only ?? filtered;
    const rows = [["Company", "Name", "Phone", "Email", "Website", "Country", "Source", "Status", "Score", "AI Messaged", "You Messaged", "Client", "Created"]];
    for (const l of list) rows.push([
      l.company ?? "", l.name ?? "", phoneDisplay(l), l.email ?? "", l.website ?? "", countryOf(l), l.source ?? "", l.stage,
      String(l.icp_score ?? ""), l.ai_messaged ? "yes" : "no", l.human_messaged ? "yes" : "no", l.is_client ? "yes" : "no",
      new Date(l.created_at).toISOString(),
    ]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const waLink = (l: Lead) => `/dashboard/whatsapp?lead=${l.id}`;
  // Filter list is countries (the City column was replaced by Country). The `flt.city` key is kept
  // internally to avoid churn; it holds country values.
  const cities = useMemo(() => Array.from(new Set((leads ?? []).map(countryOf).filter(Boolean))).sort(), [leads]);

  // Pagination (client-side over the filtered+sorted rows). Reset to page 1 and clear the selection
  // whenever the view changes, so a filter never leaves you stranded or acting on rows you can't see.
  useEffect(() => { setPage(1); setSel(new Set()); }, [tab, q, flt, dateRange, sort, perPage]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage);
  const allOnPage = paged.length > 0 && paged.every((l) => sel.has(l.id));
  const toggleOne = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (allOnPage) paged.forEach((l) => n.delete(l.id)); else paged.forEach((l) => n.add(l.id)); return n; });
  const selectedLeads = useMemo(() => (leads ?? []).filter((l) => sel.has(l.id)), [leads, sel]);
  const hasView = !!q || activeFilterCount > 0 || dateRange !== "all" || tab !== "all";

  // ── WhatsApp: only leads that are actually on WhatsApp get the WhatsApp button ───────────────
  // The server (POST /api/leads/wa-check) decides and REMEMBERS the answer on the lead, so this works on
  // later visits even when WhatsApp is disconnected:
  //   · a lead whose own site published a wa.me number is on WhatsApp
  //   · a toll-free / premium-rate line never is (decided without asking anyone)
  //   · every other number is made international from the lead's country and asked of WhatsApp itself
  // "Cannot tell" (WhatsApp not connected, or no country to read the number with) keeps the button.
  const [waLocal, setWaLocal] = useState<Record<string, "yes" | "no">>({});
  useEffect(() => { setWaLocal(readWa()); }, []);
  const waTried = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const now = Date.now();
    const need = paged.filter((l) => {
      if (l.whatsapp || !l.phone) return false;
      if (l.wa_status || waLocal[l.id]) {
        const staleNo = l.wa_status === "no" && !!l.wa_checked_at && now - new Date(l.wa_checked_at).getTime() > 30 * 86_400_000; // a "no" is looked at again after 30 days
        if (!staleNo) return false;
      }
      return now - (waTried.current.get(l.id) ?? 0) > 120_000; // not asked a moment ago
    }).map((l) => l.id);
    if (!need.length) return;
    need.forEach((id) => waTried.current.set(id, now));
    let alive = true;
    fetch("/api/leads/wa-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: need }) })
      .then((r) => r.json())
      .then((r) => {
        if (!alive || !r?.ok) return;
        const got: Record<string, "yes" | "no"> = {};
        for (const [id, st] of Object.entries(r.statuses ?? {})) if (st === "yes" || st === "no") got[id] = st;
        if (Object.keys(got).length) setWaLocal((m) => { const n = { ...m, ...got }; writeWa(n); return n; });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [paged, waLocal]);
  const waShow = (l: Lead) => {
    if (!(l.whatsapp || l.phone)) return false; // no number at all
    if (l.whatsapp) return true;                 // its own site says it is on WhatsApp
    return (l.wa_status ?? waLocal[l.id]) !== "no"; // hidden only when we KNOW it is not on WhatsApp
  };

  const card = { background: C.panel, border: `1px solid ${C.line}` };
  const btn = "flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium transition-colors duration-150 ease-out";
  const outline = { background: C.panel, border: `1px solid ${C.line}`, color: C.ink };
  const menu = "absolute right-0 z-[96] mt-2 rounded-xl p-1 shadow-md";
  const menuItem = "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 ease-out hover:bg-[#f3f4f6]";

  return (
    <div className="lx-leads -m-3 min-h-[calc(100%+1.5rem)] p-3 sm:-m-4 sm:min-h-[calc(100%+2rem)] sm:p-4" style={{ background: C.bg, color: C.ink, colorScheme: "light" }}>
      {/* Kill Chrome's dark autofill on this light surface, and give every control a visible keyboard focus ring. */}
      <style dangerouslySetInnerHTML={{ __html: `
        .lx-input{background:#fff !important;color:#111827 !important;color-scheme:light}
        .lx-input::placeholder{color:#9ca3af}
        .lx-input:-webkit-autofill,.lx-input:-webkit-autofill:hover,.lx-input:-webkit-autofill:focus,.lx-input:-webkit-autofill:active{
          -webkit-box-shadow:0 0 0 1000px #fff inset !important;box-shadow:0 0 0 1000px #fff inset !important;
          -webkit-text-fill-color:#111827 !important;caret-color:#111827;transition:background-color 9999s ease-in-out 0s}
        .lx-input:focus{outline:none !important;box-shadow:none !important}
        /* the search wrapper owns the border; the bare input inside it must not draw its own */
        .lx-leads input.lx-input{border:0 !important;padding:0 !important;border-radius:0 !important;background:transparent !important;height:100%}
        .lx-leads :is(button,a,select,[role=tab]):focus-visible{outline:2px solid #5242d8;outline-offset:2px}
        .lx-leads input[type=checkbox]{accent-color:#5242d8;width:16px;height:16px;padding:0;border-radius:4px;cursor:pointer}
        /* one icon set: Lucide, 1.75px line */
        .lx-leads .lucide{stroke-width:1.75}
        /* the dashboard global input/select rule (full width, dark fill, padding) must not reach this page's controls */
        .lx-leads select{width:auto;min-width:0;max-width:100%;height:36px;padding:0 10px;background:#fff !important;color:#111827 !important;border:1px solid #e5e7eb;border-radius:8px;color-scheme:light;font-size:13px}
      ` }} />

      {/* What the leads schedule is doing right now (and next). Click a running task to follow it live in the chat. */}
      <ScheduledRunCard kinds={["leads"]} className="mb-4" light />

      {/* header: title + count, one primary action. Sections below are 24px apart. */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold leading-tight">Leads</h1>
          <p className="mt-1 text-[13px]" style={{ color: C.sub }}>
            {leads === null ? "Loading your leads…" : (
              <>{counts.all} lead{counts.all === 1 ? "" : "s"}
                {counts.needs > 0 && <> · <button onClick={() => setTab("needs")} className="font-medium hover:underline" style={{ color: C.amber }}>{counts.needs} need{counts.needs === 1 ? "s" : ""} you</button></>}
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className={`${btn} hover:bg-[#f9fafb] max-sm:w-9 max-sm:justify-center max-sm:px-0`} style={outline} onClick={() => setAddOpen(true)} aria-label="Add lead">
            <Plus size={16} /><span className="max-sm:hidden">Add lead</span>
          </button>
          <div className="relative">
            <button className={`${btn} text-white hover:opacity-90 disabled:opacity-60`} style={{ background: C.brand }} onClick={() => setGenMenuOpen((o) => !o)} disabled={gen?.running || genBusy} aria-haspopup="menu" aria-expanded={genMenuOpen}>
              <Sparkles size={16} />
              <span>{gen?.running ? "Searching…" : <><span className="max-sm:hidden">Generate leads</span><span className="sm:hidden">Generate</span></>}</span>
              {!gen?.running && <ChevronDown size={14} />}
            </button>
            {genMenuOpen && !gen?.running && (
              <>
                <div className="fixed inset-0 z-[95]" onClick={() => setGenMenuOpen(false)} />
                <div role="menu" className={`${menu} w-72 max-w-[calc(100vw-2rem)]`} style={card}>
                  <button role="menuitem" className={menuItem} onClick={() => { setGenMenuOpen(false); findLeads("", 10, ""); }}>
                    <Sparkles size={16} className="mt-0.5 shrink-0" style={{ color: C.sub }} />
                    <span><span className="block text-[13px] font-medium">Auto</span><span className="mt-0.5 block text-[12px]" style={{ color: C.sub }}>Finds real buyers for your business from your Ideal Customers</span></span>
                  </button>
                  <button role="menuitem" className={menuItem} onClick={() => { setGenMenuOpen(false); setGenPanel("manual"); }}>
                    <PenLine size={16} className="mt-0.5 shrink-0" style={{ color: C.sub }} />
                    <span><span className="block text-[13px] font-medium">Manual</span><span className="mt-0.5 block text-[12px]" style={{ color: C.sub }}>You choose which businesses, which city and how many</span></span>
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button className="grid h-9 w-9 place-items-center rounded-lg transition-colors duration-150 ease-out hover:bg-[#f9fafb]" style={outline} onClick={() => setMoreOpen((o) => !o)} aria-label="More actions" aria-haspopup="menu" aria-expanded={moreOpen}><Ellipsis size={18} /></button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-[95]" onClick={() => setMoreOpen(false)} />
                <div role="menu" className={`${menu} w-56`} style={card}>
                  <button role="menuitem" className={`${menuItem} items-center`} onClick={() => { setMoreOpen(false); exportCsv(); }}><Download size={16} style={{ color: C.sub }} /><span className="text-[13px]">Export CSV{hasView ? " (current view)" : ""}</span></button>
                  <button role="menuitem" className={`${menuItem} items-center`} onClick={() => { setMoreOpen(false); setBuyerOpen(true); }}><UserRound size={16} style={{ color: C.sub }} /><span className="text-[13px]">Ideal customers</span></button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {err && <div role="alert" className="mb-6 rounded-lg px-4 py-3 text-[13px]" style={{ background: C.panel, border: `1px solid ${C.red}`, color: C.red }}>{err}</div>}

      <div className="mb-6">
        <Summary items={[
          { label: "Total leads", value: leads ? counts.all : undefined, note: leads ? `${counts.new} added today` : "" },
          { label: "Needs you", value: leads ? counts.needs : undefined, note: "Waiting on you", warn: true },
          { label: "Engaged", value: leads ? counts.engaged : undefined, note: "They replied" },
          { label: "Won", value: leads ? counts.won : undefined, note: "Now clients" },
        ]} />
      </div>

      {/* live lead-generation panel: the manual form, the real-time progress, or the "done" summary */}
      {genPanel !== "closed" && (
        <LeadGenPanel
          mode={genPanel}
          gen={gen}
          busy={genBusy}
          target={genTarget}
          foundSoFar={
            // Live count: the agent's own running tally (leads batch-save at the end, so counting
            // DB rows would stay 0 mid-run); fall back to rows created since the run began.
            typeof gen?.running_found === "number"
              ? gen.running_found
              : gen?.running_since
                ? (leads ?? []).filter((l) => new Date(l.created_at).getTime() >= new Date(gen.running_since!).getTime()).length
                : 0
          }
          onStart={findLeads}
          onClose={() => setGenPanel("closed")}
          onViewNew={() => { setGenPanel("closed"); setTab("new"); }}
          onOpenBuyerProfile={() => { setGenPanel("closed"); setBuyerOpen(true); }}
        />
      )}

      {/* ONE surface: tabs, toolbar, bulk bar, then the leads, separated by 1px lines */}
      <div className="rounded-2xl" style={card}>
        <div role="tablist" aria-label="Lead pipeline" className="lx-lscroll flex overflow-x-auto px-2 max-sm:[mask-image:linear-gradient(to_right,transparent,#000_14px,#000_calc(100%-14px),transparent)]">
          {PIPE.map(([k, label]) => {
            const on = tab === k; const n = counts[k] ?? 0;
            return (
              <button key={k} role="tab" aria-selected={on} onClick={() => setTab(k)} className="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-3 text-[13px] font-medium transition-colors duration-150 ease-out hover:text-[#111827] max-sm:py-3.5"
                style={{ color: on ? C.ink : C.sub }}>
                {k === "needs" && n > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.amber }} aria-hidden />}
                {label}
                <span className="tabular-nums" style={{ color: C.sub }}>{leads ? n : "–"}</span>
                {on && <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full" style={{ background: C.brand }} />}
              </button>
            );
          })}
        </div>

        {/* toolbar: 8px padding, so the 8px controls sit inside the 16px surface with matching corners */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 p-2 sm:flex-nowrap" style={{ borderTop: `1px solid ${C.line}` }}>
          <div className="flex h-9 min-w-0 basis-full items-center gap-2 rounded-lg border bg-white px-3 focus-within:border-[#5242d8] sm:basis-0 sm:flex-1" style={{ borderColor: C.line }}>
            <Search size={16} className="shrink-0" style={{ color: C.sub }} />
            <input type="search" name="lead-search" aria-label="Search leads" autoComplete="off" spellCheck={false} className="lx-input w-full min-w-0 border-0 text-[13px]" placeholder="Search name, email, phone or company" value={qInput} onChange={(e) => setQInput(e.target.value)} />
            {qInput && <button aria-label="Clear search" onClick={() => { setQInput(""); setQ(""); }} className="grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors duration-150 ease-out hover:bg-[#f3f4f6]" style={{ color: C.sub }}><X size={14} /></button>}
          </div>
          <div className="relative shrink-0 max-sm:flex-1">
            <button className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-[#f9fafb] max-sm:w-full max-sm:justify-center"
              style={{ background: C.panel, border: `1px solid ${filtersOpen || activeFilterCount ? C.brand : C.line}`, color: C.ink }}
              onClick={() => setFiltersOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={filtersOpen}>
              <SlidersHorizontal size={16} /><span>Filters</span>
              {activeFilterCount ? <span className="tabular-nums" style={{ color: C.brand }}>{activeFilterCount}</span> : null}
            </button>
            {filtersOpen && <FilterPanel flt={flt} setFlt={setFlt} leads={leads ?? []} dateRange={dateRange} setDateRange={setDateRange} resultCount={filtered.length} activeCount={activeChips.length} onClose={() => setFiltersOpen(false)} onClear={() => { setFlt({ status: [], source: [], city: [], ai: "any", you: "any", converted: "any", client: "any", score: "any" }); setDateRange("all"); }} />}
          </div>
          <Select label="Sort leads" prefix="Sort:" align="right" className="max-sm:flex-1" value={sort} onChange={setSort} options={Object.entries(SORT_LABEL).map(([value, label]) => ({ value, label }))} />
        </div>

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
            {activeChips.map(([label, remove]) => (
              <button key={label} onClick={remove} aria-label={`Remove filter: ${label}`} className="inline-flex h-7 items-center gap-1.5 rounded-md border pl-2.5 pr-1.5 text-[12px] transition-colors duration-150 ease-out hover:bg-[#f9fafb]" style={{ borderColor: C.line, color: C.ink, background: C.panel }}>
                {label}<X size={12} style={{ color: C.sub }} />
              </button>
            ))}
            <button onClick={() => { setFlt({ status: [], source: [], city: [], ai: "any", you: "any", converted: "any", client: "any", score: "any" }); setDateRange("all"); }} className="h-7 rounded-md px-2 text-[12px] font-medium transition-colors duration-150 ease-out hover:bg-[#f3f4f6]" style={{ color: C.brand }}>Clear all</button>
          </div>
        )}

        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2" style={{ background: C.hover, borderTop: `1px solid ${C.line}` }}>
            <span className="text-[13px] font-medium">{sel.size} selected</span>
            <span className="flex-1" />
            <RejectMenu variant="button" disabled={bulkBusy} onPick={bulkReject} />
            <button className="h-9 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-white disabled:opacity-40" style={{ borderColor: C.line, background: C.panel, color: C.ink }} disabled={bulkBusy} onClick={() => exportCsv(selectedLeads)}>Export</button>
            <button className="h-9 rounded-lg px-3 text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-white" style={{ color: C.sub }} onClick={() => setSel(new Set())}>Clear</button>
          </div>
        )}

        <div className="overflow-hidden rounded-b-2xl">
        {leads === null ? (
          <SkeletonRows />
        ) : filtered.length === 0 ? (
          <div className="px-6 py-14 text-center" style={{ borderTop: `1px solid ${C.line}` }}>
            <Users size={20} className="mx-auto" style={{ color: C.sub }} />
            <p className="mt-3 text-[15px] font-medium">{counts.all === 0 ? "No leads yet" : "No leads match this view"}</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px]" style={{ color: C.sub }}>
              {counts.all === 0 ? "Let Mr. Lead find buyers for you, add one yourself, or ask in chat: “find me leads for restaurants in Dubai”." : "Try a different tab, or clear your search and filters."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {counts.all === 0 ? (
                <>
                  <button className={`${btn} text-white hover:opacity-90`} style={{ background: C.brand }} onClick={() => setGenMenuOpen(true)}><Sparkles size={16} />Generate leads</button>
                  <button className={`${btn} hover:bg-[#f9fafb]`} style={outline} onClick={() => setAddOpen(true)}><Plus size={16} />Add lead</button>
                </>
              ) : <button className={`${btn} hover:bg-[#f9fafb]`} style={outline} onClick={clearAll}>Clear search and filters</button>}
            </div>
          </div>
        ) : (
          <>
            {/* desktop / tablet: a plain table. Six columns, no stage column, no badges. */}
            <div className="hidden md:block">
              <div className="lx-lscroll overflow-x-auto">
                <table className="w-full border-collapse" style={{ minWidth: 820 }}>
                  <thead>
                    <tr className="text-[12px] font-medium" style={{ color: C.sub, textAlign: "left", borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
                      <th className="w-10 py-2.5 pl-4"><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all leads on this page" /></th>
                      <th className="px-3 py-2.5 font-medium">Lead</th><th className="px-3 py-2.5 font-medium">Score</th><th className="px-3 py-2.5 font-medium">Last activity</th><th className="px-3 py-2.5 font-medium">Source</th><th className="px-3 py-2.5 pr-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((l) => {
                      const isSel = sel.has(l.id);
                      return (
                        <tr key={l.id} className="cursor-pointer text-[13px] transition-colors duration-150 ease-out hover:bg-[#f9fafb]" style={{ borderBottom: `1px solid ${C.line}`, background: isSel ? C.graySoft : undefined }} onClick={() => setSelected(l)}>
                          <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={isSel} onChange={() => toggleOne(l.id)} aria-label={`Select ${l.company || l.name || "lead"}`} /></td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium" style={{ maxWidth: 220 }}>{l.company || l.name || "Untitled"}</span>
                              {l.needs_attention && <span title={l.needs_attention_reason ?? "Mr Lxwa replied but flagged this for you"} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium" style={{ color: C.amber }}><TriangleAlert size={12} />Needs you</span>}
                            </div>
                            <div className="mt-0.5 truncate text-[12px]" style={{ color: C.sub, maxWidth: 260 }}>{phoneDisplay(l)}{countryOf(l) ? ` · ${countryOf(l)}` : ""}</div>
                          </td>
                          <td className="px-3 py-3"><Score s={l.icp_score} /></td>
                          <td className="px-3 py-3"><ActivityCell l={l} /></td>
                          <td className="whitespace-nowrap px-3 py-3 text-[13px]" style={{ color: C.sub }}>{SOURCE_LABEL[l.source ?? ""] ?? l.source ?? "—"}</td>
                          <td className="px-3 py-3 pr-4" onClick={(e) => e.stopPropagation()}><LeadActions l={l} setStage={setStage} busy={busy} waLink={waLink} size="sm" showWa={waShow(l)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* phones: one list, a lead per block, 1px lines between, big tap targets */}
            <div className="md:hidden" style={{ borderTop: `1px solid ${C.line}` }}>
              {paged.map((l) => (
                <div key={l.id} className="px-4 py-4" style={{ borderBottom: `1px solid ${C.line}` }}>
                  <button className="block w-full text-left" onClick={() => setSelected(l)} aria-label={`Open ${l.company || l.name || "lead"}`}>
                    <span className="flex items-start justify-between gap-3">
                      <span className="truncate text-[15px] font-medium">{l.company || l.name || "Untitled"}</span>
                      <Score s={l.icp_score} compact />
                    </span>
                    <span className="mt-0.5 block truncate text-[13px]" style={{ color: C.sub }}>{phoneDisplay(l)}{countryOf(l) ? ` · ${countryOf(l)}` : ""}</span>
                    {l.needs_attention && <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: C.amber }}><TriangleAlert size={12} />Needs you</span>}
                    <span className="mt-2 block"><ActivityCell l={l} /></span>
                  </button>
                  <div className="mt-3"><LeadActions l={l} setStage={setStage} busy={busy} waLink={waLink} size="lg" showWa={waShow(l)} /></div>
                </div>
              ))}
            </div>

            <Pagination page={pageSafe} totalPages={totalPages} perPage={perPage} total={filtered.length} setPage={setPage} setPerPage={setPerPage} />
          </>
        )}
        </div>
      </div>

      {selected && <LeadDrawer lead={{ ...selected, ...(details[selected.id] ?? {}) }} loadingDetail={!details[selected.id]} onClose={() => setSelected(null)} setStage={setStage} busy={busy} waLink={waLink} showWa={waShow(selected)} />}
      {addOpen && <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load(); }} toast={toast} />}
      {buyerOpen && <BuyerProfilePanel open={buyerOpen} onClose={() => setBuyerOpen(false)} toast={toast} />}
    </div>
  );
}

function PageBtn({ disabled, onClick, dir }: { disabled: boolean; onClick: () => void; dir: "prev" | "next" }) {
  return (
    <button disabled={disabled} onClick={onClick} aria-label={dir === "prev" ? "Previous page" : "Next page"} className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors duration-150 ease-out hover:bg-[#f9fafb] disabled:opacity-40 max-sm:h-10 max-sm:w-10"
      style={{ background: C.panel, color: C.ink, borderColor: C.line }}>{dir === "prev" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button>
  );
}

/** The table's footer: "Showing X–Y of Z", compact page controls and a per-page menu that opens upward. */
function Pagination({ page, totalPages, perPage, total, setPage, setPerPage }: {
  page: number; totalPages: number; perPage: number; total: number;
  setPage: (n: number) => void; setPerPage: (n: number) => void;
}) {
  const [ppOpen, setPpOpen] = useState(false);
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <div className="flex flex-col items-center justify-between gap-3 px-4 py-3 sm:flex-row" style={{ borderTop: `1px solid ${C.line}` }}>
      <div className="text-[13px]" style={{ color: C.sub }}>
        {total === 0 ? "No leads" : <>Showing <span style={{ color: C.ink }}>{from}–{to}</span> of <span style={{ color: C.ink }}>{total}</span></>}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <PageBtn disabled={page <= 1} onClick={() => setPage(page - 1)} dir="prev" />
          {pageNumbers(page, totalPages).map((p, i) =>
            p === "…"
              ? <span key={`e${i}`} className="px-1 text-[13px]" style={{ color: C.sub }}>…</span>
              : <button key={p} onClick={() => setPage(p as number)} aria-current={p === page ? "page" : undefined} className="h-8 min-w-8 rounded-lg border px-2 text-[13px] font-medium tabular-nums transition-colors duration-150 ease-out max-sm:h-10 max-sm:min-w-10"
                  style={p === page ? { background: C.brand, color: "#fff", borderColor: C.brand } : { background: C.panel, color: C.ink, borderColor: C.line }}>{p}</button>
          )}
          <PageBtn disabled={page >= totalPages} onClick={() => setPage(page + 1)} dir="next" />
        </div>
        <div className="relative">
          <button onClick={() => setPpOpen((o) => !o)} aria-haspopup="menu" aria-expanded={ppOpen} className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-[#f9fafb] max-sm:h-10" style={{ background: C.panel, borderColor: C.line, color: C.ink }}>
            {perPage} / page <ChevronDown size={14} style={{ color: C.sub }} />
          </button>
          {ppOpen && (
            <>
              <div className="fixed inset-0 z-[95]" onClick={() => setPpOpen(false)} />
              <div role="menu" className="absolute bottom-full right-0 z-[96] mb-1.5 w-32 rounded-xl p-1 shadow-md" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                {[10, 25, 50, 100].map((n) => (
                  <button key={n} role="menuitem" onClick={() => { setPerPage(n); setPpOpen(false); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-150 ease-out hover:bg-[#f3f4f6]"
                    style={{ color: C.ink, fontWeight: n === perPage ? 600 : 400 }}>
                    {n} / page
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Page numbers with ellipsis: 1 … around-current … last. Keeps the control compact for many pages. */
function pageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}



