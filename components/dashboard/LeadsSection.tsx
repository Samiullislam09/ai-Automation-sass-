"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";

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
  phone: string | null; whatsapp?: string | null; website?: string | null; city?: string | null;
  source: string | null; icp_score: number | null; reason: string | null; draft?: string | null;
  stage: string; created_at: string; notes?: string | null;
  approved_at?: string | null; contacted_at?: string | null; replied_at?: string | null;
  ai_messaged: boolean; human_messaged: boolean; messaged: boolean; converted: boolean; is_client: boolean;
  last_out_at: string | null; last_out_body: string | null; last_in_at: string | null; last_in_body: string | null;
};
type Kpis = { total: number; messaged: number; converted: number; ai_messaged: number; employee_messaged: number; not_messaged: number; new: number; engaged: number; client: number };

const STAGE: Record<string, { label: string; fg: string; bg: string }> = {
  new: { label: "New", fg: C.blue, bg: C.blueSoft },
  pending_approval: { label: "Waiting", fg: C.amber, bg: C.amberSoft },
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
const SOURCE_LABEL: Record<string, string> = { osm: "OpenStreetMap", places: "Google Places", jobs: "Job board", manual: "Manual", apollo: "Apollo" };

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
function initials(l: Lead) { return (l.company || l.name || "?").slice(0, 2).toUpperCase(); }

const TAB_MATCH: Record<string, (l: Lead) => boolean> = {
  all: () => true,
  new: (l) => ["new", "pending_approval", "approved"].includes(l.stage),
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
  const [err, setErr] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateRange, setDateRange] = useState("all"); // all | today | 7d | 30d
  // Advanced filters (spec section 7), applied on top of the tab + search. Empty = no constraint.
  const [flt, setFlt] = useState<{ status: string[]; source: string[]; ai: string; you: string; converted: string; client: string; score: string }>(
    { status: [], source: [], ai: "any", you: "any", converted: "any", client: "any", score: "any" }
  );

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/leads/board").then((r) => r.json());
      if (d.ok) { setLeads(d.leads); setKpis(d.kpis); setErr(""); }
      else setErr(d.error ?? "Could not load leads.");
    } catch (e: any) { setErr(e?.message ?? "Network error."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStage = async (l: Lead, stage: string) => {
    setBusy(l.id);
    try {
      const d = await fetch(`/api/leads/${l.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) }).then((r) => r.json());
      if (!d.ok) { toast(d.error ?? "Couldn't update.", "error"); return; }
      setLeads((prev) => prev?.map((x) => (x.id === l.id ? { ...x, stage } : x)) ?? prev);
      setSelected((s) => (s && s.id === l.id ? { ...s, stage } : s));
      toast("Updated.");
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
      return [l.company, l.name, l.email, l.phone, l.whatsapp, l.city].some((v) => String(v ?? "").toLowerCase().includes(needle));
    });
  }, [leads, tab, q, flt, dateRange]);

  const activeFilterCount =
    flt.status.length + flt.source.length +
    ["ai", "you", "converted", "client", "score"].filter((k) => (flt as any)[k] !== "any").length;

  const exportCsv = () => {
    const rows = [["Company", "Name", "Phone", "Source", "Status", "Score", "AI Messaged", "You Messaged", "Client", "Created"]];
    for (const l of filtered) rows.push([
      l.company ?? "", l.name ?? "", l.whatsapp || l.phone || "", l.source ?? "", l.stage,
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

  return (
    <div className="min-h-full rounded-2xl p-3 sm:p-4" style={{ background: C.bg, color: C.ink, colorScheme: "light" }}>
      {/* header — title on its own line; a single-line toolbar below that fits without wrapping */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: C.ink }}>Leads</h1>
          <p className="hidden text-[12.5px] sm:block" style={{ color: C.sub }}>Manage, track and automate your leads</p>
        </div>
        <button className="flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold text-white" style={{ background: C.brand }} onClick={() => setAddOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>
          <span className="hidden sm:inline">Add Lead</span>
        </button>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
          <svg className="shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={C.sub} strokeWidth="2" /><path d="M21 21l-4-4" stroke={C.sub} strokeWidth="2" strokeLinecap="round" /></svg>
          <input className="w-full min-w-0 text-[13px] outline-none" style={{ color: C.ink, background: "transparent", colorScheme: "light" }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="relative shrink-0">
          <button className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold" style={{ background: filtersOpen || activeFilterCount ? C.brandSoft : C.panel, border: `1px solid ${filtersOpen || activeFilterCount ? C.brand : C.line}`, color: activeFilterCount || filtersOpen ? C.brand : C.sub }} onClick={() => setFiltersOpen((o) => !o)} title="Filters">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 5h18M6 12h12M10 19h4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
            <span className="hidden md:inline">Filters</span>
            {activeFilterCount ? <span className="rounded-full px-1.5 text-[11px] text-white" style={{ background: C.brand }}>{activeFilterCount}</span> : null}
          </button>
          {filtersOpen && <FilterPanel flt={flt} setFlt={setFlt} dateRange={dateRange} setDateRange={setDateRange} onClose={() => setFiltersOpen(false)} onClear={() => { setFlt({ status: [], source: [], ai: "any", you: "any", converted: "any", client: "any", score: "any" }); setDateRange("all"); }} />}
        </div>
        <button className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.sub }} onClick={exportCsv} title="Export CSV">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="hidden md:inline">Export</span>
        </button>
      </div>

      {err && <div className="mb-3 rounded-xl px-4 py-3 text-[13px]" style={{ background: C.redSoft, color: C.red }}>{err}</div>}

      <div className="mb-4 grid grid-cols-3 gap-2.5 lg:grid-cols-6">
        <Kpi icon="users" label="Total Leads" value={kpis?.total} tone={C.brand} bg={C.brandSoft} active={tab === "all"} onClick={() => setTab("all")} />
        <Kpi icon="chat" label="Engaged / Messaged" value={kpis?.messaged} tone={C.blue} bg={C.blueSoft} active={tab === "engaged"} onClick={() => setTab("engaged")} />
        <Kpi icon="check" label="Converted" value={kpis?.converted} tone={C.green} bg={C.greenSoft} active={tab === "converted"} onClick={() => setTab("converted")} />
        <Kpi icon="bot" label="AI Agent Messaged" value={kpis?.ai_messaged} tone={C.violet} bg={C.violetSoft} active={tab === "ai_messaged"} onClick={() => setTab("ai_messaged")} />
        <Kpi icon="person" label="You Messaged" value={kpis?.employee_messaged} tone={C.amber} bg={C.amberSoft} active={tab === "employee_messaged"} onClick={() => setTab("employee_messaged")} />
        <Kpi icon="mute" label="Not Messaged" value={kpis?.not_messaged} tone={C.sub} bg={C.graySoft} active={tab === "not_messaged"} onClick={() => setTab("not_messaged")} />
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {([
          ["all", "All Leads", kpis?.total],
          ["new", "New", kpis?.new],
          ["engaged", "Engaged", kpis?.engaged],
          ["converted", "Converted", kpis?.converted],
          ["client", "Client", kpis?.client],
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
              <table className="w-full border-collapse" style={{ minWidth: 920 }}>
                <thead>
                  <tr className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: C.sub, textAlign: "left", borderBottom: `1px solid ${C.line}` }}>
                    <Th>Lead</Th><Th>Source</Th><Th>Status</Th><Th>AI Agent</Th><Th>You</Th><Th>Client</Th><Th>Score</Th><Th>Last Msg</Th><Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} className="cursor-pointer text-[13px] hover:bg-[#fafbfc]" style={{ borderBottom: `1px solid ${C.line}` }} onClick={() => setSelected(l)}>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: C.brand }}>{initials(l)}</span>
                          <div className="min-w-0">
                            <div className="truncate font-semibold" style={{ color: C.ink, maxWidth: 170 }}>{l.company || l.name || "Untitled"}</div>
                            <div className="truncate text-[11.5px]" style={{ color: C.sub, maxWidth: 170 }}>{l.whatsapp || l.phone || l.email || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3" style={{ color: C.sub }}>{SOURCE_LABEL[l.source ?? ""] ?? l.source ?? "—"}</td>
                      <td className="px-3 py-3"><StageChip stage={l.stage} /></td>
                      <td className="px-3 py-3"><ActBadge on={l.ai_messaged} onLabel="Messaged" tone={C.violet} soft={C.violetSoft} /></td>
                      <td className="px-3 py-3"><ActBadge on={l.human_messaged} onLabel="Messaged" tone={C.amber} soft={C.amberSoft} /></td>
                      <td className="px-3 py-3"><ActBadge on={l.is_client} onLabel="Client" offLabel="Not yet" tone={C.green} soft={C.greenSoft} /></td>
                      <td className="px-3 py-3"><span className="rounded-md px-2 py-0.5 text-[12px] font-bold" style={{ color: scoreColor(l.icp_score), background: C.graySoft }}>{l.icp_score ?? "—"}</span></td>
                      <td className="px-3 py-3" style={{ color: C.sub, whiteSpace: "nowrap" }}>{ago(l.last_out_at || l.last_in_at)}</td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>{rowActions(l, setStage, busy, waLink)}</td>
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
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: C.brand }}>{initials(l)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold" style={{ color: C.ink }}>{l.company || l.name || "Untitled"}</div>
                    <div className="truncate text-[12px]" style={{ color: C.sub }}>{l.whatsapp || l.phone || "—"} · {SOURCE_LABEL[l.source ?? ""] ?? l.source ?? "—"}</div>
                  </div>
                  <span className="rounded-md px-2 py-0.5 text-[12px] font-bold" style={{ color: scoreColor(l.icp_score), background: C.graySoft }}>{l.icp_score ?? "—"}</span>
                </div>
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  <StageChip stage={l.stage} />
                  {l.ai_messaged && <Tag tone={C.violet} soft={C.violetSoft}>AI messaged</Tag>}
                  {l.human_messaged && <Tag tone={C.amber} soft={C.amberSoft}>You messaged</Tag>}
                  {l.is_client && <Tag tone={C.green} soft={C.greenSoft}>Client</Tag>}
                </div>
                <div onClick={(e) => e.stopPropagation()}>{rowActions(l, setStage, busy, waLink)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {selected && <Drawer lead={selected} onClose={() => setSelected(null)} setStage={setStage} busy={busy} waLink={waLink} />}
      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load(); }} toast={toast} />
    </div>
  );
}

function rowActions(l: Lead, setStage: (l: Lead, s: string) => void, busy: string | null, waLink: (l: Lead) => string) {
  const num = l.whatsapp || l.phone;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {l.stage === "pending_approval" && (
        <>
          <button className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: C.brand }} disabled={busy === l.id} onClick={() => setStage(l, "approved")}>Approve</button>
          <button className="rounded-lg px-2.5 py-1.5 text-[12px] font-semibold" style={{ color: C.red, background: C.redSoft }} disabled={busy === l.id} onClick={() => setStage(l, "rejected")}>Reject</button>
        </>
      )}
      {num && !["rejected", "opted_out"].includes(l.stage) && (
        <a href={waLink(l)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white" style={{ background: "#25D366", textDecoration: "none" }} title="Open WhatsApp chat">
          <WaGlyph />
          <span className="hidden lg:inline">Message</span>
        </a>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, tone, bg, active, onClick }: { icon: string; label: string; value?: number; tone: string; bg: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition" style={{ background: C.panel, border: `1px solid ${active ? tone : C.line}`, boxShadow: active ? `0 0 0 1px ${tone}` : "none" }}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: bg, color: tone }}><KpiIcon name={icon} /></span>
      <span className="min-w-0">
        <span className="block truncate text-[10.5px] font-medium leading-tight" style={{ color: C.sub }}>{label}</span>
        <span className="block text-[18px] font-bold leading-tight" style={{ color: C.ink }}>{value ?? "—"}</span>
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
  return <span className="rounded-md px-2 py-0.5 text-[11.5px] font-semibold" style={{ color: s.fg, background: s.bg }}>{s.label}</span>;
}
function Tag({ children, tone, soft }: { children: React.ReactNode; tone: string; soft: string }) {
  return <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ color: tone, background: soft }}>{children}</span>;
}
function ActBadge({ on, onLabel, offLabel = "Not yet", tone, soft }: { on: boolean; onLabel: string; offLabel?: string; tone: string; soft: string }) {
  return on
    ? <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-semibold" style={{ color: tone, background: soft }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />{onLabel}</span>
    : <span className="text-[11.5px]" style={{ color: C.sub }}>{offLabel}</span>;
}
function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-2.5">{children}</th>; }
function WaGlyph({ size = 14 }: { size?: number }) {
  // The real WhatsApp mark: a speech bubble with a handset. Filled white on the green pill.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden>
      <path d="M16 3C9.2 3 3.7 8.5 3.7 15.3c0 2.4.7 4.7 1.9 6.7L3.5 29l7.2-1.9c1.9 1 4 1.6 6.2 1.6h.1c6.8 0 12.3-5.5 12.3-12.3S22.8 3 16 3zm0 22.4c-1.9 0-3.8-.5-5.4-1.5l-.4-.2-4.3 1.1 1.1-4.2-.3-.4a10 10 0 01-1.6-5.4c0-5.6 4.6-10.1 10.2-10.1 2.7 0 5.2 1 7.1 2.9a10 10 0 013 7.2c0 5.6-4.6 10.1-10.2 10.1zm5.6-7.6c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2s-.8 1-1 1.2c-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.5.1-.2.1-.4 0-.5l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.2 3.4 5.4 4.8.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.3-.6-.4z" />
    </svg>
  );
}

function Drawer({ lead, onClose, setStage, busy, waLink }: { lead: Lead; onClose: () => void; setStage: (l: Lead, s: string) => void; busy: string | null; waLink: (l: Lead) => string }) {
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
              <div className="text-[12px]" style={{ color: C.sub }}>{lead.city || SOURCE_LABEL[lead.source ?? ""] || ""}</div>
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
          <Detail k="City" v={lead.city ?? null} />
          <Detail k="Source" v={SOURCE_LABEL[lead.source ?? ""] ?? lead.source ?? null} />
          <Detail k="Created" v={new Date(lead.created_at).toLocaleDateString()} last />
        </div>
        <div className="mb-5 grid grid-cols-2 gap-2">
          {lead.stage === "pending_approval" ? (
            <>
              <button className="rounded-xl py-2.5 text-[13px] font-semibold text-white" style={{ background: C.brand }} disabled={busy === lead.id} onClick={() => setStage(lead, "approved")}>Approve</button>
              <button className="rounded-xl py-2.5 text-[13px] font-semibold" style={{ color: C.red, background: C.redSoft }} disabled={busy === lead.id} onClick={() => setStage(lead, "rejected")}>Reject</button>
            </>
          ) : (
            <a href={waLink(lead)} className="col-span-2 flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold text-white" style={{ background: "#25D366", textDecoration: "none" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 21a9 9 0 10-8-4.9L3 21l4.9-1A9 9 0 0012 21z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /></svg>
              Open WhatsApp chat
            </a>
          )}
        </div>
        <div className="mb-5 rounded-2xl p-4" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
          <div className="mb-3 text-[13px] font-bold" style={{ color: C.ink }}>Automation status</div>
          <StatusRow label="AI Agent" on={lead.ai_messaged} at={lead.ai_messaged ? lead.last_out_at : null} tone={C.violet} soft={C.violetSoft} />
          <StatusRow label="You" on={lead.human_messaged} at={lead.human_messaged ? lead.last_out_at : null} tone={C.amber} soft={C.amberSoft} />
          <StatusRow label="Client" on={lead.is_client} tone={C.green} soft={C.greenSoft} last />
        </div>
        {lead.reason && (
          <div className="mb-5">
            <div className="mb-1.5 text-[13px] font-bold" style={{ color: C.ink }}>Why this lead</div>
            <p className="text-[12.5px]" style={{ color: C.sub }}>{lead.reason}</p>
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
type Flt = { status: string[]; source: string[]; ai: string; you: string; converted: string; client: string; score: string };
function FilterPanel({ flt, setFlt, dateRange, setDateRange, onClose, onClear }: { flt: Flt; setFlt: (f: Flt) => void; dateRange: string; setDateRange: (v: string) => void; onClose: () => void; onClear: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const STATUSES: [string, string][] = [["new", "New"], ["pending_approval", "Waiting"], ["approved", "Approved"], ["contacted", "Contacted"], ["replied", "Engaged"], ["won", "Won"], ["lost", "Lost"], ["opted_out", "Opted out"]];
  const SOURCES: [string, string][] = [["osm", "OpenStreetMap"], ["places", "Google Places"], ["jobs", "Job board"], ["manual", "Manual"]];
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
