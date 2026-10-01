"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import BuyerProfilePanel from "./BuyerProfilePanel";

/** /dashboard/leads — a premium, light, CRM-style lead board (owner supplied a reference mockup,
 *  2026-09-30). Self-contained LIGHT surface, like the WhatsApp page, because the dashboard theme
 *  is dark and this screen is meant to read as a serious B2B automation CRM.
 *
 *  WHAT IS REAL. Every KPI and count comes from /api/leads/board, computed from the tenant's own
 *  rows — never a placeholder number. Where the mockup assumes something the product does not yet
 *  have, it is derived honestly, not invented: "AI Agent" = messages Mr. Brain drafted
 *  (answered_by 'brain'), "You" = messages the human sent, "Client/Converted" = stage 'won'.
 *  There is one human today, so "employee" means you, and no roster is faked.
 *
 *  Layout: KPI cards (click to filter) → filter tabs with counts → a dense table on desktop /
 *  cards on mobile → a slide-over detail drawer. Every lead row has a WhatsApp button that deep-
 *  links straight into that conversation on the WhatsApp page. 100% responsive. */

const C = {
  bg: "#f6f7f9", panel: "#ffffff", ink: "#0f172a", sub: "#64748b", line: "#e9edf2",
  brand: "#4f46e5", brandSoft: "#eef2ff", green: "#16a34a", greenSoft: "#e7f6ec",
  amber: "#d97706", amberSoft: "#fdf2e3", red: "#dc2626", redSoft: "#fdeaea",
  blue: "#2563eb", blueSoft: "#e8f0fe", violet: "#7c3aed", violetSoft: "#f1ebfd", graySoft: "#f1f5f9",
};

type Lead = {
  id: string; company: string | null; name: string | null; email?: string | null;
  phone: string | null; whatsapp?: string | null; website?: string | null; city?: string | null; country?: string | null;
  source: string | null; icp_score: number | null; reason: string | null; draft?: string | null;
  stage: string; created_at: string; notes?: string | null;
  source_segment?: string | null; source_query?: string | null; classification?: string | null;
  score_breakdown?: { score?: number; band?: string; components?: { id: string; group: string; points: number; max: number; why: string }[] } | null;
  reject_reason?: string | null; observation?: string | null; evidence?: any;
  approved_at?: string | null; contacted_at?: string | null; replied_at?: string | null;
  ai_messaged: boolean; human_messaged: boolean; messaged: boolean; converted: boolean; is_client: boolean;
  last_out_at: string | null; last_out_body: string | null; last_in_at: string | null; last_in_body: string | null;
};
type Kpis = { total: number; messaged: number; converted: number; ai_messaged: number; employee_messaged: number; not_messaged: number; new: number; engaged: number; client: number };
type Gen = { running: boolean; running_since?: string | null; running_found?: number | null; running_label?: string | null; running_done?: number | null; running_total?: number | null; last_run_at: string | null; last_status: string | null; last_found: number | null; last_saved?: number | null; last_note: string | null; last_needs?: string[]; last_question?: string | null };

const STAGE: Record<string, { label: string; fg: string; bg: string }> = {
  new: { label: "New", fg: C.blue, bg: C.blueSoft },
  // Approval gate inverted (2026-10-01): everything arrives approved; a straggler row written
  // under the old policy reads as Approved too until the board API's sweep renames it.
  pending_approval: { label: "Approved", fg: C.green, bg: C.greenSoft },
  approved: { label: "Approved", fg: C.green, bg: C.greenSoft },
  rejected: { label: "Rejected", fg: C.sub, bg: C.graySoft },
  contacted: { label: "Contacted", fg: C.blue, bg: C.blueSoft },
  delivered: { label: "Delivered", fg: C.blue, bg: C.blueSoft },
  read: { label: "Read", fg: C.violet, bg: C.violetSoft },
  replied: { label: "Engaged", fg: C.green, bg: C.greenSoft },
  in_conversation: { label: "Engaged", fg: C.green, bg: C.greenSoft },
  interested: { label: "Interested", fg: C.violet, bg: C.violetSoft },
  won: { label: "Won", fg: C.green, bg: C.greenSoft },
  lost: { label: "Lost", fg: C.red, bg: C.redSoft },
  opted_out: { label: "Opted out", fg: C.red, bg: C.redSoft },
  invalid: { label: "Invalid", fg: C.sub, bg: C.graySoft },
  failed: { label: "Failed", fg: C.red, bg: C.redSoft },
};
// The real-world source a lead came from, not the tool/API name. "serper" is just the API we
// query Google Maps through, so a lead from it IS a Google Maps / Google Business listing.
const SOURCE_LABEL: Record<string, string> = { serper: "Google Maps", osm: "OpenStreetMap", places: "Google Places", jobs: "Job board", manual: "Manual", apollo: "Apollo" };

function ago(iso: string | null): string {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
function scoreColor(s: number | null) { return s == null ? C.sub : s >= 70 ? C.green : s >= 40 ? C.amber : C.red; }
function isToday(iso: string) { return Date.now() - new Date(iso).getTime() < 86_400_000; }
function fmtDay(iso: string) { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }); }
function siteLabel(url: string) { return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""); }
function initials(l: Lead) { return (l.company || l.name || "?").slice(0, 2).toUpperCase(); }
function cityOf(l: Lead): string { return (l.city ?? "").trim(); }
function countryOf(l: Lead): string { return (l.country ?? "").trim(); }

// Common country → dialling code, so a bare local number can be shown with its country code when
// we actually KNOW the country. We never guess a code for a lead whose country we don't have.
const COUNTRY_DIAL: Record<string, string> = {
  india: "+91", "united arab emirates": "+971", uae: "+971", "u.a.e": "+971",
  "united states": "+1", usa: "+1", "united states of america": "+1",
  "united kingdom": "+44", uk: "+44", "u.k": "+44", canada: "+1", australia: "+61",
  pakistan: "+92", "saudi arabia": "+966", qatar: "+974", kuwait: "+965", oman: "+968",
  bahrain: "+973", singapore: "+65", germany: "+49", france: "+33", spain: "+34", italy: "+39",
};
/** The phone, shown with its country code. If it already has one (+ or 00) it's left alone;
 *  otherwise, only when the lead's country is known, the code is prepended and a local trunk 0
 *  dropped. Never invents a code for an unknown country. */
function phoneDisplay(l: Lead): string {
  const raw = (l.whatsapp || l.phone || "").trim();
  if (!raw) return "—";
  if (/^(\+|00)/.test(raw)) return raw;
  const dial = l.country ? COUNTRY_DIAL[l.country.trim().toLowerCase()] : null;
  return dial ? `${dial} ${raw.replace(/^0+/, "")}` : raw;
}

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

const TAB_MATCH: Record<string, (l: Lead) => boolean> = {
  all: () => true,
  new: (l) => Date.now() - new Date(l.created_at).getTime() < 86_400_000, // added in the last 24h
  engaged: (l) => ["replied", "in_conversation", "interested"].includes(l.stage),
  converted: (l) => l.converted,
  client: (l) => l.is_client,
  ai_messaged: (l) => l.ai_messaged,
  employee_messaged: (l) => l.human_messaged,
  not_messaged: (l) => !l.messaged,
};

export default function LeadsSection() {
  const { toast } = useStore();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [err, setErr] = useState("");
  const [gen, setGen] = useState<Gen | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  // The lead-generation panel under the KPI cards: closed → nothing; manual → the inline
  // "what & where" form; live → the real-time progress card; done → the "found N" summary.
  const [genPanel, setGenPanel] = useState<"closed" | "manual" | "live" | "done">("closed");
  const [genTarget, setGenTarget] = useState<number | null>(null);
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const wasRunning = useRef(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateRange, setDateRange] = useState("all"); // all | today | 7d | 30d
  // Advanced filters (spec section 7), applied on top of the tab + search. Empty = no constraint.
  const [flt, setFlt] = useState<{ status: string[]; source: string[]; city: string[]; ai: string; you: string; converted: string; client: string; score: string }>(
    { status: [], source: [], city: [], ai: "any", you: "any", converted: "any", client: "any", score: "any" }
  );

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/leads/board").then((r) => r.json());
      if (d.ok) { setLeads(d.leads); setKpis(d.kpis); setGen(d.gen ?? null); setErr(""); }
      else setErr(d.error ?? "Could not load leads.");
    } catch (e: any) { setErr(e?.message ?? "Network error."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // While a discovery job is running, poll so the live panel's "found so far" grows by itself.
  useEffect(() => {
    if (!gen?.running) return;
    const id = setInterval(load, 5000);
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
      load();
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
    finally { setBusy(null); }
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
    return leads.filter((l) => {
      if (!match(l)) return false;
      if (flt.status.length && !flt.status.includes(l.stage)) return false;
      if (flt.source.length && !flt.source.includes(l.source ?? "")) return false;
      if (flt.city.length && !flt.city.includes(countryOf(l))) return false; // `city` key now holds Country values (filter relabelled)
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
  }, [leads, tab, q, flt, dateRange]);

  const activeFilterCount =
    flt.status.length + flt.source.length + flt.city.length +
    ["ai", "you", "converted", "client", "score"].filter((k) => (flt as any)[k] !== "any").length;

  const exportCsv = () => {
    const rows = [["Company", "Name", "Phone", "Email", "Website", "Country", "Source", "Status", "Score", "AI Messaged", "You Messaged", "Client", "Created"]];
    for (const l of filtered) rows.push([
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
  // Filter list is now countries (the City column was replaced by Country). The `flt.city` key is
  // kept internally to avoid churn; it holds country values.
  const cities = useMemo(() => Array.from(new Set((leads ?? []).map(countryOf).filter(Boolean))).sort(), [leads]);

  return (
    <div className="-m-3 min-h-[calc(100%+1.5rem)] p-3 sm:-m-4 sm:min-h-[calc(100%+2rem)] sm:p-4" style={{ background: C.bg, color: C.ink, colorScheme: "light" }}>
      {/* header — title left; Filters / Export / Add Lead together on the right */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold" style={{ color: C.ink }}>Leads</h1>
          <p className="hidden text-[12.5px] sm:block" style={{ color: C.sub }}>Manage, track and automate your leads</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <button className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold" style={{ background: filtersOpen || activeFilterCount ? C.brandSoft : C.panel, border: `1px solid ${filtersOpen || activeFilterCount ? C.brand : C.line}`, color: activeFilterCount || filtersOpen ? C.brand : C.sub }} onClick={() => setFiltersOpen((o) => !o)} title="Filters">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 5h18M6 12h12M10 19h4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
              <span className="hidden md:inline">Filters</span>
              {activeFilterCount ? <span className="rounded-full px-1.5 text-[11px] text-white" style={{ background: C.brand }}>{activeFilterCount}</span> : null}
            </button>
            {filtersOpen && <FilterPanel flt={flt} setFlt={setFlt} cities={cities} dateRange={dateRange} setDateRange={setDateRange} onClose={() => setFiltersOpen(false)} onClear={() => { setFlt({ status: [], source: [], city: [], ai: "any", you: "any", converted: "any", client: "any", score: "any" }); setDateRange("all"); }} />}
          </div>
          <button className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.sub }} onClick={() => setBuyerOpen(true)} title="Buyer profile — who buys from you">
            <span className="hidden md:inline">Buyer profile</span>
            <span className="md:hidden">Buyers</span>
          </button>
          <button className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.sub }} onClick={exportCsv} title="Export CSV">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="hidden md:inline">Export</span>
          </button>
          <button className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold text-white" style={{ background: C.brand }} onClick={() => setAddOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>
            <span className="hidden sm:inline">Add Lead</span>
          </button>
        </div>
      </div>

      {/* one line: a compact search on the left, Generate leads on the right */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex h-9 w-full max-w-xs items-center gap-2 rounded-lg px-2.5" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
          <svg className="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={C.sub} strokeWidth="2" /><path d="M21 21l-4-4" stroke={C.sub} strokeWidth="2" strokeLinecap="round" /></svg>
          <input className="w-full min-w-0 text-[13px] outline-none" style={{ color: C.ink, background: "transparent", colorScheme: "light" }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="relative shrink-0">
          <button className="flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: C.brand }} onClick={() => setGenMenuOpen((o) => !o)} disabled={gen?.running || genBusy}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1m0-12.8l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/></svg>
            <span>{gen?.running ? "Searching…" : "Generate leads"}</span>
            {!gen?.running && <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
          {genMenuOpen && !gen?.running && (
            <>
              <div className="fixed inset-0 z-[95]" onClick={() => setGenMenuOpen(false)} />
              <div className="absolute right-0 z-[96] mt-2 w-64 overflow-hidden rounded-2xl shadow-xl" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                <button className="block w-full px-4 py-3 text-left hover:bg-[#fafbfc]" onClick={() => { setGenMenuOpen(false); findLeads("", 10, ""); }}>
                  <div className="text-[13px] font-bold" style={{ color: C.ink }}>✨ Auto</div>
                  <div className="text-[11.5px]" style={{ color: C.sub }}>Finds real buyers for your business from your confirmed buyer profile</div>
                </button>
                <button className="block w-full px-4 py-3 text-left hover:bg-[#fafbfc]" style={{ borderTop: `1px solid ${C.line}` }} onClick={() => { setGenMenuOpen(false); setGenPanel("manual"); }}>
                  <div className="text-[13px] font-bold" style={{ color: C.ink }}>✍️ Manual</div>
                  <div className="text-[11.5px]" style={{ color: C.sub }}>You choose what businesses, which city, how many</div>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {err && <div className="mb-3 rounded-xl px-4 py-3 text-[13px]" style={{ background: C.redSoft, color: C.red }}>{err}</div>}

      {/* KPI cards — five, colourful, responsive (Converted removed) */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi icon="users" label="Total Leads" value={kpis?.total} tone={C.brand} bg={C.brandSoft} active={tab === "all"} onClick={() => setTab("all")} />
        <Kpi icon="chat" label="Engaged" value={kpis?.messaged} tone={C.blue} bg={C.blueSoft} active={tab === "engaged"} onClick={() => setTab("engaged")} />
        <Kpi icon="bot" label="AI Messaged" value={kpis?.ai_messaged} tone={C.violet} bg={C.violetSoft} active={tab === "ai_messaged"} onClick={() => setTab("ai_messaged")} />
        <Kpi icon="person" label="You Messaged" value={kpis?.employee_messaged} tone={C.amber} bg={C.amberSoft} active={tab === "employee_messaged"} onClick={() => setTab("employee_messaged")} />
        <Kpi icon="mute" label="Not Messaged" value={kpis?.not_messaged} tone={C.sub} bg={C.graySoft} active={tab === "not_messaged"} onClick={() => setTab("not_messaged")} />
      </div>

      {/* live lead-generation panel — the manual form, the real-time progress card, or the
          "done" summary, right under the KPIs where the owner's reference mockup puts it */}
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

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {([
          ["all", "All Leads", kpis?.total],
          ["new", "New", kpis?.new],
          ["engaged", "Engaged", kpis?.engaged],
          ["converted", "Converted", kpis?.converted],
          ["not_messaged", "Not Messaged", kpis?.not_messaged],
        ] as [string, string, number | undefined][]).map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)} className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={tab === k ? { background: C.brandSoft, color: C.brand } : { background: C.panel, color: C.sub, border: `1px solid ${C.line}` }}>
            {label}{n != null && <span className="rounded-full px-1.5 text-[11px]" style={{ background: tab === k ? "#fff" : C.graySoft, color: tab === k ? C.brand : C.sub }}>{n}</span>}
          </button>
        ))}
      </div>

      {leads === null ? (
        <div className="rounded-2xl p-10 text-center text-[13px]" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.sub }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
          <div className="text-2xl">🧭</div>
          <p className="mt-2 text-[13px]" style={{ color: C.sub }}>No leads here. Add one, or ask in chat &quot;find me leads for restaurants in Dubai&quot;.</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl md:block" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="lx-lscroll overflow-x-auto">
              {/* compact on purpose: small type, tight padding, no Status column (everything
                  arrives approved) — so far more rows fit on one screen */}
              <table className="w-full border-collapse" style={{ minWidth: 980 }}>
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.sub, textAlign: "left", borderBottom: `1px solid ${C.line}` }}>
                    <Th>Lead</Th><Th>Score</Th><Th>Messaged</Th><Th>Contact</Th><Th>Source</Th><Th>Added</Th><Th>Country</Th><Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} className="cursor-pointer text-[12.5px] hover:bg-[#fafbfc]" style={{ borderBottom: `1px solid ${C.line}` }} onClick={() => setSelected(l)}>
                      <td className="px-2.5 py-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white" style={{ background: C.brand }}>{initials(l)}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-semibold" style={{ color: C.ink, maxWidth: 150 }}>{l.company || l.name || "Untitled"}</span>
                              {l.stage === "rejected" && <span className="shrink-0 rounded px-1 text-[10px] font-semibold" style={{ color: C.red, background: C.redSoft }}>Rejected</span>}
                              {l.stage === "opted_out" && <span className="shrink-0 rounded px-1 text-[10px] font-semibold" style={{ color: C.red, background: C.redSoft }}>Opted out</span>}
                            </div>
                            <div className="truncate text-[11px]" style={{ color: C.sub, maxWidth: 150 }}>{phoneDisplay(l)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2.5 py-2"><span className="rounded-md px-1.5 py-0.5 text-[11.5px] font-bold" style={{ color: scoreColor(l.icp_score), background: C.graySoft }}>{l.icp_score ?? "—"}</span></td>
                      <td className="px-2.5 py-2" style={{ whiteSpace: "nowrap" }}><MessagedCell l={l} /></td>
                      {/* Contact: email on top, website below — one column, like the Lead cell stacks name + phone */}
                      <td className="px-2.5 py-2">
                        {l.email
                          ? <a href={`mailto:${l.email}`} className="block truncate" style={{ color: C.blue, maxWidth: 180 }} onClick={(e) => e.stopPropagation()}>{l.email}</a>
                          : <span style={{ color: C.sub }}>—</span>}
                        {l.website
                          ? <a href={l.website.startsWith("http") ? l.website : `https://${l.website}`} target="_blank" rel="noreferrer" className="block truncate text-[11px]" style={{ color: C.sub, maxWidth: 180 }} onClick={(e) => e.stopPropagation()}>{siteLabel(l.website)}</a>
                          : <span className="block text-[11px]" style={{ color: C.line }}>—</span>}
                      </td>
                      <td className="px-2.5 py-2" style={{ color: C.sub, whiteSpace: "nowrap" }}>{SOURCE_LABEL[l.source ?? ""] ?? l.source ?? "—"}</td>
                      <td className="px-2.5 py-2" style={{ whiteSpace: "nowrap" }}><AddedCell iso={l.created_at} /></td>
                      <td className="px-2.5 py-2" style={{ color: C.sub, whiteSpace: "nowrap" }}>{countryOf(l) || "—"}</td>
                      <td className="px-2.5 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button className="rounded-lg p-1.5" style={{ color: C.sub }} title="Why this lead — overview" onClick={() => setSelected(l)}
                            onMouseEnter={(e) => { e.currentTarget.style.color = C.brand; e.currentTarget.style.background = C.brandSoft; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = C.sub; e.currentTarget.style.background = "transparent"; }}>
                            <EyeIcon />
                          </button>
                          {rowActions(l, setStage, busy, waLink)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2.5 md:hidden">
            {filtered.map((l) => (
              <div key={l.id} className="rounded-2xl p-3.5" style={{ background: C.panel, border: `1px solid ${C.line}` }} onClick={() => setSelected(l)}>
                <div className="mb-2 flex items-start gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: C.brand }}>{initials(l)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold" style={{ color: C.ink }}>{l.company || l.name || "Untitled"}</div>
                    <div className="truncate text-[12px]" style={{ color: C.sub }}>{phoneDisplay(l)}{countryOf(l) ? ` · ${countryOf(l)}` : ""} · {SOURCE_LABEL[l.source ?? ""] ?? l.source ?? "—"}</div>
                    {(l.email || l.website) && (
                      <div className="truncate text-[11.5px]" style={{ color: C.blue }}>{l.email ?? ""}{l.email && l.website ? " · " : ""}{l.website ? siteLabel(l.website) : ""}</div>
                    )}
                  </div>
                  <span className="rounded-md px-2 py-0.5 text-[12px] font-bold" style={{ color: scoreColor(l.icp_score), background: C.graySoft }}>{l.icp_score ?? "—"}</span>
                </div>
                <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                  <AddedCell iso={l.created_at} />
                  <MessagedCell l={l} />
                  {l.stage === "rejected" && <Tag tone={C.red} soft={C.redSoft}>Rejected</Tag>}
                  {l.stage === "opted_out" && <Tag tone={C.red} soft={C.redSoft}>Opted out</Tag>}
                </div>
                <div onClick={(e) => e.stopPropagation()}>{rowActions(l, setStage, busy, waLink)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {selected && <Drawer lead={selected} onClose={() => setSelected(null)} setStage={setStage} busy={busy} waLink={waLink} />}
      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load(); }} toast={toast} />
      <BuyerProfilePanel open={buyerOpen} onClose={() => setBuyerOpen(false)} toast={toast} />
    </div>
  );
}

const REJECT_REASONS: { key: string; label: string }[] = [
  { key: "competitor", label: "Competitor" },
  { key: "wrong_industry", label: "Wrong industry" },
  { key: "wrong_city", label: "Wrong city" },
  { key: "too_small", label: "Too small" },
  { key: "too_large", label: "Too large" },
  { key: "already_served", label: "Already served" },
  { key: "duplicate", label: "Duplicate" },
  { key: "other", label: "Other" },
];

/** The reject control: a ✕ (or a labelled button) that opens a little menu of reasons. The reason
 *  is the whole point of Phase 6 — "Competitor" and "Wrong industry" teach the finder to stop
 *  surfacing that domain, the rest feed the metrics — so rejecting always asks why. */
function RejectMenu({ onPick, disabled, variant }: { onPick: (reason: string) => void; disabled?: boolean; variant: "icon" | "button" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      {variant === "icon" ? (
        <button className="rounded-lg p-1.5 disabled:opacity-60" style={{ color: open ? C.red : C.sub, background: open ? C.redSoft : "transparent" }} title="Reject this lead" disabled={disabled} onClick={() => setOpen((o) => !o)}
          onMouseEnter={(e) => { e.currentTarget.style.color = C.red; e.currentTarget.style.background = C.redSoft; }}
          onMouseLeave={(e) => { if (!open) { e.currentTarget.style.color = C.sub; e.currentTarget.style.background = "transparent"; } }}>
          <svg width="13" height="13" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      ) : (
        <button className="rounded-xl px-3.5 py-2 text-[13px] font-semibold disabled:opacity-60" style={{ color: C.red, background: C.redSoft }} disabled={disabled} onClick={() => setOpen((o) => !o)}>Reject…</button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-[105]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[106] mt-1 w-44 overflow-hidden rounded-xl py-1 shadow-lg" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.sub }}>Why reject?</div>
            {REJECT_REASONS.map((r) => (
              <button key={r.key} className="block w-full px-3 py-1.5 text-left text-[12.5px]" style={{ color: C.ink }} onClick={() => { setOpen(false); onPick(r.key); }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.graySoft)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>{r.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function rowActions(l: Lead, setStage: (l: Lead, s: string, reason?: string) => void, busy: string | null, waLink: (l: Lead) => string) {
  const num = l.whatsapp || l.phone;
  // Every lead arrives approved now, so the default action is Message, with a quiet ✕ to
  // reject the ones the user doesn't want. A rejected lead gets one Restore button back.
  if (l.stage === "rejected") {
    return <button className="rounded-lg px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-60" style={{ color: C.brand, background: C.brandSoft }} disabled={busy === l.id} onClick={() => setStage(l, "approved")}>Restore</button>;
  }
  if (l.stage === "opted_out") return <span className="text-[12px]" style={{ color: C.sub }}>—</span>;
  return (
    <div className="flex items-center gap-1">
      {num ? (
        <a href={waLink(l)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "#25D366", color: "#ffffff", textDecoration: "none" }} title="Open WhatsApp chat">
          <WaGlyph size={13} /><span style={{ color: "#ffffff" }}>Message</span>
        </a>
      ) : <span className="text-[12px]" style={{ color: C.sub }}>—</span>}
      <RejectMenu variant="icon" disabled={busy === l.id} onPick={(reason) => setStage(l, "rejected", reason)} />
    </div>
  );
}

/** "Added" — a little green Today badge for fresh rows, a short date for the rest. */
function AddedCell({ iso }: { iso: string }) {
  return isToday(iso)
    ? <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: C.green, background: C.greenSoft }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: C.green }} />Today</span>
    : <span className="text-[12px]" style={{ color: C.sub }}>{fmtDay(iso)}</span>;
}

/** Who has messaged this lead — one green, human answer: the AI agent, you, both, or no one. */
function MessagedCell({ l }: { l: Lead }) {
  if (l.ai_messaged || l.human_messaged) {
    const who = l.ai_messaged && l.human_messaged ? "AI + You" : l.ai_messaged ? "AI Agent" : "You";
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: C.green, background: C.greenSoft }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke={C.green} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {who}
        </span>
        {l.last_out_at && <span className="text-[10.5px]" style={{ color: C.sub }}>{ago(l.last_out_at)}</span>}
      </span>
    );
  }
  return <span className="text-[11.5px]" style={{ color: C.sub }}>Not yet</span>;
}

function Kpi({ icon, label, value, tone, bg, active, onClick }: { icon: string; label: string; value?: number; tone: string; bg: string; active: boolean; onClick: () => void }) {
  // active = a hairline 1px outline at ~25% opacity — present but quiet, per the owner
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 rounded-2xl px-3 py-3 text-left transition" style={{ background: bg, border: `1px solid ${active ? `${tone}40` : "transparent"}` }}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: tone }}><KpiIcon name={icon} /></span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold leading-tight" style={{ color: tone }}>{label}</span>
        <span className="block text-[20px] font-bold leading-tight" style={{ color: C.ink }}>{value ?? "—"}</span>
      </span>
    </button>
  );
}
function KpiIcon({ name }: { name: string }) {
  const p: Record<string, React.ReactNode> = {
    users: <path d="M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6zm13 9v-1a4 4 0 00-3-3.9M16 4.1a4 4 0 010 7.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" />,
    chat: <path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round" />,
    check: <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    bot: <path d="M12 7V4m-4 6h8a2 2 0 012 2v5a2 2 0 01-2 2H8a2 2 0 01-2-2v-5a2 2 0 012-2zm1 4h.01M15 11h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" />,
    person: <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />,
    mute: <path d="M3 3l18 18M9 5a3 3 0 016 0v4m-6 2v1a3 3 0 003 3" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />,
  };
  return <svg width="17" height="17" viewBox="0 0 24 24">{p[name] ?? null}</svg>;
}
function StageChip({ stage }: { stage: string }) {
  const s = STAGE[stage] ?? { label: stage, fg: C.sub, bg: C.graySoft };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ color: s.fg, background: s.bg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.fg }} />{s.label}
    </span>
  );
}
function Tag({ children, tone, soft }: { children: React.ReactNode; tone: string; soft: string }) {
  return <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ color: tone, background: soft }}>{children}</span>;
}
function Th({ children }: { children: React.ReactNode }) { return <th className="px-2.5 py-2">{children}</th>; }
function WaGlyph({ size = 14 }: { size?: number }) {
  // The real WhatsApp mark: a speech bubble with a handset. Filled white on the green pill.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden>
      <path d="M16 3C9.2 3 3.7 8.5 3.7 15.3c0 2.4.7 4.7 1.9 6.7L3.5 29l7.2-1.9c1.9 1 4 1.6 6.2 1.6h.1c6.8 0 12.3-5.5 12.3-12.3S22.8 3 16 3zm0 22.4c-1.9 0-3.8-.5-5.4-1.5l-.4-.2-4.3 1.1 1.1-4.2-.3-.4a10 10 0 01-1.6-5.4c0-5.6 4.6-10.1 10.2-10.1 2.7 0 5.2 1 7.1 2.9a10 10 0 013 7.2c0 5.6-4.6 10.1-10.2 10.1zm5.6-7.6c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2s-.8 1-1 1.2c-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.5.1-.2.1-.4 0-.5l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.2 3.4 5.4 4.8.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.3-.6-.4z" />
    </svg>
  );
}

function Drawer({ lead, onClose, setStage, busy, waLink }: { lead: Lead; onClose: () => void; setStage: (l: Lead, s: string, reason?: string) => void; busy: string | null; waLink: (l: Lead) => string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const timeline = [
    lead.created_at && { dot: C.blue, label: "Lead created", at: lead.created_at },
    lead.approved_at && { dot: C.green, label: "Approved", at: lead.approved_at },
    lead.contacted_at && { dot: C.violet, label: "First message sent", at: lead.contacted_at },
    lead.last_in_at && { dot: C.amber, label: "They replied", at: lead.last_in_at },
  ].filter(Boolean) as { dot: string; label: string; at: string }[];
  return (
    <div className="fixed inset-0 z-[90] flex justify-end" style={{ background: "rgba(15,23,42,.35)" }} onClick={onClose}>
      <div className="lx-lscroll h-full w-full max-w-sm overflow-y-auto p-5" style={{ background: C.panel }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: C.brand }}>{initials(lead)}</span>
            <div>
              <div className="text-[15px] font-bold" style={{ color: C.ink }}>{lead.company || lead.name || "Lead"}</div>
              <div className="text-[12px]" style={{ color: C.sub }}>{lead.country || lead.city || SOURCE_LABEL[lead.source ?? ""] || ""}</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5" style={{ background: C.graySoft, color: C.sub }} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-lg px-2.5 py-1 text-[13px] font-bold" style={{ color: scoreColor(lead.icp_score), background: C.graySoft }}>{lead.icp_score ?? "—"}/100</span>
          <StageChip stage={lead.stage} />
        </div>
        <div className="mb-4 space-y-2 text-[13px]" style={{ color: C.ink }}>
          {(lead.whatsapp || lead.phone) && <Row icon="phone" v={lead.whatsapp || lead.phone!} />}
          {lead.email && <Row icon="mail" v={lead.email} />}
          {lead.website && <Row icon="web" v={lead.website} href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} />}
        </div>

        {/* Lead details — always shown, "—" when absent, so the panel never looks empty. */}
        <div className="mb-5 rounded-2xl p-4" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
          <div className="mb-3 text-[13px] font-bold" style={{ color: C.ink }}>Lead details</div>
          <Detail k="Company" v={lead.company} />
          <Detail k="Contact" v={lead.name} />
          <Detail k="Email" v={lead.email ?? null} />
          <Detail k="Website" v={lead.website ?? null} />
          <Detail k="Country" v={lead.country ?? null} />
          <Detail k="City" v={lead.city ?? null} />
          <Detail k="Source" v={SOURCE_LABEL[lead.source ?? ""] ?? lead.source ?? null} />
          <Detail k="Created" v={new Date(lead.created_at).toLocaleDateString()} last />
        </div>
        <div className="mb-5 grid grid-cols-2 gap-2">
          {lead.stage === "rejected" ? (
            <button className="col-span-2 rounded-xl py-2.5 text-[13px] font-semibold" style={{ color: C.brand, background: C.brandSoft }} disabled={busy === lead.id} onClick={() => setStage(lead, "approved")}>Restore this lead</button>
          ) : (
            <>
              <a href={waLink(lead)} className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold text-white" style={{ background: "#25D366", textDecoration: "none" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 21a9 9 0 10-8-4.9L3 21l4.9-1A9 9 0 0012 21z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                WhatsApp chat
              </a>
              <div className="flex justify-center"><RejectMenu variant="button" disabled={busy === lead.id} onPick={(reason) => setStage(lead, "rejected", reason)} /></div>
            </>
          )}
        </div>
        <div className="mb-5 rounded-2xl p-4" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
          <div className="mb-3 text-[13px] font-bold" style={{ color: C.ink }}>Automation status</div>
          <StatusRow label="AI Agent" on={lead.ai_messaged} at={lead.ai_messaged ? lead.last_out_at : null} tone={C.green} soft={C.greenSoft} />
          <StatusRow label="You" on={lead.human_messaged} at={lead.human_messaged ? lead.last_out_at : null} tone={C.green} soft={C.greenSoft} />
          <StatusRow label="Client" on={lead.is_client} tone={C.green} soft={C.greenSoft} last />
        </div>
        {(lead.reason || lead.observation || lead.source_segment || lead.score_breakdown) && (
          <div className="mb-5 rounded-2xl p-4" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
            <div className="mb-2 text-[13px] font-bold" style={{ color: C.ink }}>Why this lead</div>
            {(lead.observation || lead.reason) && <p className="mb-2 text-[12.5px]" style={{ color: C.sub }}>{lead.observation || lead.reason}</p>}
            {lead.evidence?.quote && <p className="mb-2 border-l-2 pl-2 text-[12px] italic" style={{ borderColor: C.line, color: C.sub }}>“{lead.evidence.quote}”</p>}
            <div className="flex flex-wrap gap-1.5">
              {lead.classification && <Tag tone={lead.classification === "buyer" ? C.green : C.amber} soft={lead.classification === "buyer" ? C.greenSoft : C.amberSoft}>{lead.classification === "buyer" ? "Buyer ✓" : lead.classification}</Tag>}
              {lead.source_segment && <Tag tone={C.brand} soft={C.brandSoft}>Segment: {lead.source_segment}</Tag>}
              {lead.source_query && <Tag tone={C.sub} soft={C.graySoft}>Found via “{lead.source_query}”</Tag>}
            </div>
            {/* verified buying signals, from the stored score breakdown */}
            {(() => {
              const sig = lead.score_breakdown?.components?.find((c) => c.id === "buying-signals");
              return sig && sig.points > 0 ? <p className="mt-2 text-[12px]" style={{ color: C.green }}>✓ {sig.why}</p> : null;
            })()}
            {/* the score, explained group by group */}
            {lead.score_breakdown?.components && (
              <div className="mt-3 space-y-1">
                {Object.entries(
                  lead.score_breakdown.components.reduce((acc: Record<string, { p: number; m: number }>, c) => {
                    const g = acc[c.group] ?? { p: 0, m: 0 };
                    acc[c.group] = { p: g.p + c.points, m: g.m + c.max };
                    return acc;
                  }, {}),
                ).map(([group, v]) => (
                  <div key={group} className="flex items-center justify-between text-[11.5px]" style={{ color: C.sub }}>
                    <span className="capitalize">{group === "fit" ? "Buyer fit" : group === "timing" ? "Health & size" : group}</span>
                    <span className="font-semibold" style={{ color: C.ink }}>{v.p}/{v.m}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {lead.stage === "rejected" && lead.reject_reason && (
          <div className="mb-5 rounded-xl p-3 text-[12px]" style={{ background: C.redSoft, color: C.red }}>
            Rejected as: {REJECT_REASONS.find((r) => r.key === lead.reject_reason)?.label ?? lead.reject_reason}
            {(lead.reject_reason === "competitor" || lead.reject_reason === "wrong_industry") && <span style={{ color: C.sub }}> — this domain won’t be surfaced again.</span>}
          </div>
        )}
        <div>
          <div className="mb-2 text-[13px] font-bold" style={{ color: C.ink }}>Timeline</div>
          <div className="space-y-3">
            {timeline.map((t, i) => (
              <div key={i} className="flex gap-2.5">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.dot }} />
                <div>
                  <div className="text-[12.5px] font-medium" style={{ color: C.ink }}>{t.label}</div>
                  <div className="text-[11.5px]" style={{ color: C.sub }}>{new Date(t.at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
function Row({ icon, v, href }: { icon: string; v: string; href?: string }) {
  const paths: Record<string, React.ReactNode> = {
    phone: <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012 4.2 2 2 0 014 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.6a2 2 0 01-.5 2.1L8 9.6a16 16 0 006 6l1.2-1.1a2 2 0 012.1-.5c.8.3 1.7.5 2.6.6A2 2 0 0122 16.9z" stroke="currentColor" strokeWidth="1.6" fill="none" />,
    mail: <path d="M4 6h16v12H4zM4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" />,
    web: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18" stroke="currentColor" strokeWidth="1.5" fill="none" />,
  };
  const body = <span className="inline-flex items-center gap-2"><span style={{ color: C.sub }}><svg width="15" height="15" viewBox="0 0 24 24">{paths[icon]}</svg></span>{v}</span>;
  return href ? <a href={href} target="_blank" rel="noreferrer" className="block" style={{ color: C.brand }}>{body}</a> : <div>{body}</div>;
}
function Detail({ k, v, last }: { k: string; v: string | null | undefined; last?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3" style={{ paddingBottom: last ? 0 : 8, marginBottom: last ? 0 : 8, borderBottom: last ? "none" : `1px solid ${C.line}` }}>
      <span className="text-[12px]" style={{ color: C.sub }}>{k}</span>
      <span className="max-w-[60%] truncate text-right text-[12.5px] font-medium" style={{ color: v ? C.ink : C.sub }}>{v || "—"}</span>
    </div>
  );
}
function StatusRow({ label, on, at, tone, soft, last }: { label: string; on: boolean; at?: string | null; tone: string; soft: string; last?: boolean }) {
  return (
    <div className="flex items-center justify-between" style={{ paddingBottom: last ? 0 : 10, marginBottom: last ? 0 : 10, borderBottom: last ? "none" : `1px solid ${C.line}` }}>
      <span className="text-[12.5px]" style={{ color: C.ink }}>{label}</span>
      <div className="text-right">
        <span className="rounded-md px-2 py-0.5 text-[11.5px] font-semibold" style={{ color: on ? tone : C.sub, background: on ? soft : C.graySoft }}>{on ? "Messaged" : "Not messaged"}</span>
        {at && <div className="text-[10.5px]" style={{ color: C.sub }}>{ago(at)}</div>}
      </div>
    </div>
  );
}

function AddLeadModal({ open, onClose, onAdded, toast }: { open: boolean; onClose: () => void; onAdded: () => void; toast: (m: string, t?: "error") => void }) {
  const [f, setF] = useState({ company: "", name: "", phone: "", email: "", city: "", website: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) setF({ company: "", name: "", phone: "", email: "", city: "", website: "" });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const save = async () => {
    if (!f.company.trim()) { toast("Enter a company or contact name.", "error"); return; }
    if (f.phone.replace(/[^0-9]/g, "").length < 8) { toast("Enter a full phone number with country code.", "error"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: f.company.trim(), name: f.name.trim(), phone: f.phone.replace(/[^0-9+]/g, ""), email: f.email.trim(), city: f.city.trim(), website: f.website.trim() }) }).then((x) => x.json());
      if (!r.ok) { toast(r.error ?? "Could not add.", "error"); return; }
      toast("Lead added — approved and ready to message.");
      onAdded();
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
    finally { setBusy(false); }
  };
  const field = (key: keyof typeof f, label: string, ph: string) => (
    <div className="mb-3">
      <label className="mb-1 block text-[12px] font-medium" style={{ color: C.sub }}>{label}</label>
      <input className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.ink }} placeholder={ph} value={f[key]} onChange={(e) => setF((s) => ({ ...s, [key]: e.target.value }))} />
    </div>
  );
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,.45)" }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: C.panel }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-bold" style={{ color: C.ink }}>Add a lead</h2>
        <p className="mb-4 mt-1 text-[12.5px]" style={{ color: C.sub }}>It goes straight to Approved, so you can message it right away.</p>
        {field("company", "Company", "Gulf Steel LLC")}
        {field("name", "Contact name", "Ahmed Khan")}
        {field("phone", "Phone (with country code)", "+971 50 123 4567")}
        {field("email", "Email", "ahmed@gulfsteel.ae")}
        {field("city", "City", "Dubai")}
        {field("website", "Website", "gulfsteel.ae")}
        <div className="flex justify-end gap-2">
          <button className="rounded-xl px-4 py-2 text-[13px] font-semibold" style={{ background: C.graySoft, color: C.sub }} onClick={onClose}>Cancel</button>
          <button className="rounded-xl px-5 py-2 text-[13px] font-semibold text-white" style={{ background: C.brand }} onClick={save} disabled={busy}>{busy ? "Adding…" : "Add lead"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── advanced filter popover ─────────────────────────────────────────────────────────────── */
type Flt = { status: string[]; source: string[]; city: string[]; ai: string; you: string; converted: string; client: string; score: string };
function FilterPanel({ flt, setFlt, cities, dateRange, setDateRange, onClose, onClear }: { flt: Flt; setFlt: (f: Flt) => void; cities: string[]; dateRange: string; setDateRange: (v: string) => void; onClose: () => void; onClear: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const STATUSES: [string, string][] = [["approved", "Approved"], ["contacted", "Contacted"], ["replied", "Engaged"], ["won", "Won"], ["lost", "Lost"], ["rejected", "Rejected"], ["opted_out", "Opted out"]];
  const SOURCES: [string, string][] = [["serper", "Google Maps"], ["osm", "OpenStreetMap"], ["places", "Google Places"], ["jobs", "Job board"], ["manual", "Manual"]];
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const Chip = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
    <button onClick={onClick} className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition" style={on ? { background: C.brand, color: "#fff" } : { background: C.bg, color: C.sub, border: `1px solid ${C.line}` }}>{label}</button>
  );
  const Seg = ({ value, set }: { value: string; set: (v: string) => void }) => (
    <div className="flex overflow-hidden rounded-lg" style={{ border: `1px solid ${C.line}` }}>
      {[["any", "Any"], ["yes", "Yes"], ["no", "No"]].map(([v, l], i) => (
        <button key={v} onClick={() => set(v)} className="px-3 py-1 text-[12px] font-semibold" style={{ background: value === v ? C.brand : C.panel, color: value === v ? "#fff" : C.sub, borderLeft: i ? `1px solid ${C.line}` : "none" }}>{l}</button>
      ))}
    </div>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-3.5">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.sub }}>{title}</div>
      {children}
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-[95]" onClick={onClose} />
      <div className="absolute right-0 z-[96] mt-2 w-[340px] max-w-[92vw] rounded-2xl shadow-xl" style={{ background: C.panel, border: `1px solid ${C.line}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
          <b className="text-[14px]" style={{ color: C.ink }}>Filters</b>
          <button className="text-[12px] font-semibold" style={{ color: C.brand }} onClick={onClear}>Clear all</button>
        </div>

        <div className="lx-lscroll max-h-[60vh] overflow-y-auto px-4 py-3.5">
          <Section title="Date added">
            <div className="flex flex-wrap gap-1.5">
              {[["all", "All time"], ["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]].map(([v, l]) => (
                <Chip key={v} on={dateRange === v} label={l} onClick={() => setDateRange(v)} />
              ))}
            </div>
          </Section>

          <Section title="Lead status">
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map(([v, l]) => <Chip key={v} on={flt.status.includes(v)} label={l} onClick={() => setFlt({ ...flt, status: toggle(flt.status, v) })} />)}
            </div>
          </Section>

          <Section title="Source">
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map(([v, l]) => <Chip key={v} on={flt.source.includes(v)} label={l} onClick={() => setFlt({ ...flt, source: toggle(flt.source, v) })} />)}
            </div>
          </Section>

          {cities.length > 0 && (
            <Section title="Country">
              <div className="flex flex-wrap gap-1.5">
                {cities.map((c) => <Chip key={c} on={flt.city.includes(c)} label={c} onClick={() => setFlt({ ...flt, city: toggle(flt.city, c) })} />)}
              </div>
            </Section>
          )}

          <div className="mb-2.5 flex items-center justify-between"><span className="text-[12.5px]" style={{ color: C.ink }}>AI Agent messaged</span><Seg value={flt.ai} set={(v) => setFlt({ ...flt, ai: v })} /></div>
          <div className="mb-2.5 flex items-center justify-between"><span className="text-[12.5px]" style={{ color: C.ink }}>You messaged</span><Seg value={flt.you} set={(v) => setFlt({ ...flt, you: v })} /></div>
          <div className="mb-2.5 flex items-center justify-between"><span className="text-[12.5px]" style={{ color: C.ink }}>Converted</span><Seg value={flt.converted} set={(v) => setFlt({ ...flt, converted: v })} /></div>
          <div className="mb-3.5 flex items-center justify-between"><span className="text-[12.5px]" style={{ color: C.ink }}>Client</span><Seg value={flt.client} set={(v) => setFlt({ ...flt, client: v })} /></div>

          <Section title="Lead score">
            <div className="flex flex-wrap gap-1.5">
              {[["any", "Any"], ["0-25", "0–25"], ["26-50", "26–50"], ["51-75", "51–75"], ["76-100", "76–100"]].map(([v, l]) => (
                <Chip key={v} on={flt.score === v} label={l} onClick={() => setFlt({ ...flt, score: v })} />
              ))}
            </div>
          </Section>
        </div>

        <div className="px-4 py-3" style={{ borderTop: `1px solid ${C.line}` }}>
          <button className="w-full rounded-xl py-2.5 text-[13px] font-semibold text-white" style={{ background: C.brand }} onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  );
}

/* ── live lead-generation panel (under the KPI cards) ────────────────────────────────────────
 *  Three faces of one card. manual → the "what & where" form, inline, no modal. live → the
 *  real-time progress card from the owner's reference mockup (ring, found/target, step trail).
 *  done → the result summary with a "View new leads" shortcut. The numbers are real: "found so
 *  far" counts rows that actually landed since the run started; the step trail is the one
 *  honest animation — the server records no per-step signal, so steps advance on elapsed time
 *  and snap to "Saving to database" the moment real rows appear. */
const LEADS_PER_RUN_MAX = 25; // client-side convenience cap; per-plan/day enforcement is a TODO (server-side)
const GEN_STEPS = ["Searching sources", "Filtering leads", "Verifying info", "Saving to database"];

function LeadGenPanel({ mode, gen, busy, target, foundSoFar, onStart, onClose, onViewNew, onOpenBuyerProfile }: {
  mode: "manual" | "live" | "done";
  gen: Gen | null;
  busy: boolean;
  target: number | null;
  foundSoFar: number;
  onStart: (query: string, count: number, city: string) => void;
  onClose: () => void;
  onViewNew: () => void;
  onOpenBuyerProfile: () => void;
}) {
  // An Auto run that stopped because it needs the Site Brain first (it auto-drafts the buyer
  // profile itself, so that is no longer a blocker) is NOT a failed/empty search — show a clear
  // call to action rather than a misleading "found 0".
  const needsBuyerProfile = mode === "done" && Array.isArray(gen?.last_needs) && (gen!.last_needs!.includes("site_brain") || gen!.last_needs!.includes("buyer_profile"));
  const [what, setWhat] = useState("");
  const [city, setCity] = useState("");
  const [count, setCount] = useState(10);
  const [, tick] = useState(0);
  useEffect(() => {
    if (mode !== "live") return;
    const id = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(id);
  }, [mode]);

  const startedAt = gen?.running_since ? new Date(gen.running_since).getTime() : Date.now();
  const elapsedS = Math.max(0, (Date.now() - startedAt) / 1000);
  const step = mode === "done" ? GEN_STEPS.length : foundSoFar > 0 ? 3 : Math.min(2, Math.floor(elapsedS / 20));
  // Progress blends two real signals: how many leads are found vs the target, and how far through
  // the candidate list the run is — so the bar still moves while sites are being read, before the
  // first lead lands. Whichever is higher wins; capped at 95% until the run actually finishes.
  const byFound = target ? (foundSoFar / Math.max(1, target)) * 100 : 0;
  const byConsidered = gen?.running_total ? ((gen.running_done ?? 0) / gen.running_total) * 70 : 0;
  const pct = mode === "done" ? 100 : (target || gen?.running_total) ? Math.min(95, Math.max(3, Math.round(Math.max(byFound, byConsidered)))) : null;
  const failed = mode === "done" && gen?.last_status === "error";
  // The real count the run saved. last_saved is the truest (rows written); last_found is the
  // pipeline's count; fall back to what we tallied live so the panel never wrongly says 0.
  const doneFound = gen?.last_saved ?? gen?.last_found ?? foundSoFar;

  const examples = [["Restaurants", "Dubai"], ["ISO consultants", "Mumbai"], ["Dental clinics", "Abu Dhabi"], ["Manufacturers", "Pune"]];
  const go = () => {
    const n = Math.max(1, Math.min(LEADS_PER_RUN_MAX, count));
    const w = what.trim();
    if (!w) return;
    const c = city.trim();
    onStart(c ? `${w} in ${c}` : w, n, c);
  };

  const R = 24, CIRC = 2 * Math.PI * R;
  const ring = (
    <div className="relative h-16 w-16 shrink-0">
      <svg width="64" height="64" viewBox="0 0 64 64" className={mode === "live" && pct == null ? "animate-spin" : undefined} style={{ transform: pct != null ? "rotate(-90deg)" : undefined }}>
        <circle cx="32" cy="32" r={R} fill="none" stroke={C.line} strokeWidth="5" />
        <circle cx="32" cy="32" r={R} fill="none" stroke={failed ? C.red : C.green} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${((pct ?? 25) / 100) * CIRC} ${CIRC}`} style={{ transition: "stroke-dasharray .6s" }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold" style={{ color: failed ? C.red : C.green }}>
        {mode === "done" ? (failed ? "!" : "✓") : pct != null ? `${pct}%` : foundSoFar}
      </span>
    </div>
  );

  return (
    <div className="mb-4 overflow-hidden rounded-2xl" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px]" style={{ background: C.blueSoft }}>🚀</span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-bold" style={{ color: C.ink }}>{mode === "manual" ? "Generate leads" : "Live Lead Generation"}</div>
            <div className="truncate text-[11.5px]" style={{ color: C.sub }}>
              {mode === "manual" ? "Tell Mr. Lead what to look for — he does the rest." : mode === "live" ? "Watch your leads being generated in real-time." : needsBuyerProfile ? "One step first — confirm who buys from you." : failed ? "The last run hit a problem." : "Run finished."}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mode === "live" && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ color: C.green, background: C.greenSoft }}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: C.green }} />Running
            </span>
          )}
          {mode === "done" && !failed && !needsBuyerProfile && (
            <button className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: C.brand }} onClick={onViewNew}>View new leads</button>
          )}
          {mode !== "live" && (
            <button onClick={onClose} className="rounded-full p-1.5" style={{ background: C.graySoft, color: C.sub }} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          )}
        </div>
      </div>

      {needsBuyerProfile ? (
        <div className="p-4">
          <div className="flex items-start gap-3 rounded-xl p-3.5" style={{ background: C.amberSoft }}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px]" style={{ background: "#fff" }}>🧭</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold" style={{ color: C.amber }}>Read your website first</div>
              <div className="mt-0.5 text-[12.5px]" style={{ color: C.ink }}>
                {gen?.last_question ?? "I work out who buys from you automatically — but I need to read your website once first. Run the site analysis (Site Brain), then press Auto again."}
              </div>
              <button className="mt-3 rounded-xl px-4 py-2 text-[12.5px] font-semibold text-white" style={{ background: C.brand }} onClick={onOpenBuyerProfile}>Open Buyer profile</button>
            </div>
          </div>
        </div>
      ) : mode === "manual" ? (
        <div className="p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[12px] font-medium" style={{ color: C.sub }}>What businesses?</label>
              <input className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.ink, colorScheme: "light" }} placeholder="e.g. ISO certification consultants" value={what} onChange={(e) => setWhat(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium" style={{ color: C.sub }}>Which city or area?</label>
              <input className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.ink, colorScheme: "light" }} placeholder="e.g. Dubai" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {examples.map(([w, c]) => (
              <button key={w} className="rounded-lg px-2.5 py-1 text-[11.5px] font-medium" style={{ background: C.brandSoft, color: C.brand }} onClick={() => { setWhat(w); setCity(c); }}>{w} · {c}</button>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 sm:max-w-xs">
              <label className="mb-1 block text-[12px] font-medium" style={{ color: C.sub }}>How many? <b style={{ color: C.ink }}>{count}</b> <span className="text-[11px]">(max {LEADS_PER_RUN_MAX})</span></label>
              <input type="range" min={1} max={LEADS_PER_RUN_MAX} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full" style={{ accentColor: C.brand }} />
            </div>
            <button className="rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: C.brand }} onClick={go} disabled={busy || !what.trim()}>{busy ? "Starting…" : "Start generating"}</button>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <div className="flex flex-col gap-4 rounded-xl p-3.5 sm:flex-row sm:items-center" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
            <div className="flex min-w-0 flex-1 items-center gap-3.5">
              {ring}
              <div className="min-w-0">
                <div className="text-[13.5px] font-bold" style={{ color: C.ink }}>
                  {mode === "live" ? "Collecting leads…" : failed ? "It hit a problem" : doneFound != null ? `Done — ${doneFound} new lead${doneFound === 1 ? "" : "s"}` : "Done"}
                </div>
                <div className="text-[12px]" style={{ color: C.sub }}>
                  {mode === "live" ? "Finding potential customers from multiple sources. You can leave this page — they save by themselves." : failed ? (gen?.last_note ?? "Try again in a minute; the reason is logged in Reports.") : "Fresh leads are in the table below with a green Today badge."}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-5 pl-[66px] sm:pl-0">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.sub }}>Found</div>
                <div className="text-[20px] font-bold leading-tight" style={{ color: C.ink }}>{mode === "done" ? (doneFound ?? foundSoFar) : foundSoFar}</div>
                <div className="text-[10.5px]" style={{ color: C.sub }}>so far</div>
              </div>
              {target != null && (
                <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 20 }}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.sub }}>Target</div>
                  <div className="text-[20px] font-bold leading-tight" style={{ color: C.ink }}>{target}</div>
                  <div className="text-[10.5px]" style={{ color: C.sub }}>this run</div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3.5 flex items-center gap-2 overflow-x-auto pb-1">
            {GEN_STEPS.map((label, i) => {
              const doneStep = i < step || mode === "done";
              const current = mode === "live" && i === step;
              return (
                <div key={label} className="flex min-w-0 shrink-0 items-center gap-2">
                  {i > 0 && <span className="hidden h-px w-6 sm:block lg:w-10" style={{ background: C.line }} />}
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                    style={{ background: doneStep ? C.green : current ? C.blueSoft : C.graySoft, border: current ? `2px solid ${C.blue}` : "none" }}>
                    {doneStep
                      ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      : current
                        ? <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: C.blue }} />
                        : <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.sub, opacity: 0.4 }} />}
                  </span>
                  <span className="whitespace-nowrap text-[11.5px] font-medium" style={{ color: doneStep ? C.ink : current ? C.blue : C.sub }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
