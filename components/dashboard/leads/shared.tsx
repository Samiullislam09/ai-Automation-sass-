"use client";
import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";

/** Shared pieces of the Leads page: the palette, types, small helpers and the few components used by
 *  more than one module. Split out of LeadsSection.tsx so the drawer, filters, add-lead form and the
 *  generate panel can each be loaded on demand. */

export const C = {
  // surfaces and text: neutral
  bg: "#f4f5f8", panel: "#ffffff", ink: "#111827", sub: "#6b7280", line: "#e5e7eb", graySoft: "#f3f4f6", hover: "#f9fafb",
  // the one accent (the brand purple, dark). Its "soft" is a neutral grey on purpose: no tinted fills.
  brand: "#5242d8", brandInk: "#5242d8", brandSoft: "#f3f4f6",
  // meaning only: amber = needs you, red = something negative, green = good news
  green: "#15803d", greenSoft: "#f3f4f6", amber: "#b45309", amberSoft: "#f3f4f6", red: "#b91c1c", redSoft: "#f3f4f6",
  // legacy names still used by a few sub-panels: they resolve to the accent / neutral
  blue: "#5242d8", blueSoft: "#f3f4f6", violet: "#5242d8", violetSoft: "#f3f4f6",
};

export type Lead = {
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
  needs_attention?: boolean | null; needs_attention_reason?: string | null; last_intent?: string | null;
  wa_status?: "yes" | "no" | null; wa_checked_at?: string | null;
  meeting?: { id: string; status: string; start_at: string | null; meet_link: string | null } | null;
};
export type Gen = { running: boolean; running_since?: string | null; running_found?: number | null; running_label?: string | null; running_done?: number | null; running_total?: number | null; last_run_at: string | null; last_status: string | null; last_found: number | null; last_saved?: number | null; last_note: string | null; last_needs?: string[]; last_question?: string | null };

// Stage chips are neutral; only the dot carries meaning (green good, amber needs attention, red negative).
export const D = { neutral: "#94a3b8", brand: C.brand, good: "#16a34a", warn: "#d97706", bad: "#dc2626" };
export const STAGE: Record<string, { label: string; dot: string }> = {
  new: { label: "New", dot: D.brand },
  pending_approval: { label: "Approved", dot: D.neutral },
  approved: { label: "Approved", dot: D.neutral },
  rejected: { label: "Rejected", dot: D.neutral },
  contacted: { label: "Contacted", dot: D.brand },
  delivered: { label: "Delivered", dot: D.brand },
  read: { label: "Read", dot: D.brand },
  replied: { label: "Engaged", dot: D.good },
  in_conversation: { label: "Engaged", dot: D.good },
  interested: { label: "Interested", dot: D.good },
  meeting_requested: { label: "Meeting asked", dot: D.warn },
  meeting_scheduled: { label: "Meeting set", dot: D.warn },
  meeting_done: { label: "Met", dot: D.good },
  ready_to_buy: { label: "Ready to buy", dot: D.warn },
  won: { label: "Won", dot: D.good },
  lost: { label: "Lost", dot: D.bad },
  opted_out: { label: "Opted out", dot: D.bad },
  invalid: { label: "Invalid", dot: D.neutral },
  failed: { label: "Failed", dot: D.bad },
};
// The real-world source a lead came from, not the tool/API name. "serper" is just the API we
// query Google Maps through, so a lead from it IS a Google Maps / Google Business listing.
export const SOURCE_LABEL: Record<string, string> = { serper: "Google Maps", osm: "OpenStreetMap", places: "Google Places", jobs: "Job board", web: "Web search", directory: "Business directory", clients: "Competitor's client", news: "In the news", linkedin: "LinkedIn", manual: "Manual", apollo: "Apollo" };
export const SORT_LABEL: Record<string, string> = { newest: "Newest first", oldest: "Oldest first", score: "Highest score", name: "Name A–Z" };

export function ago(iso: string | null): string {
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
export function scoreColor(s: number | null) { return s == null ? C.sub : s >= 70 ? C.green : s >= 40 ? "#d97706" : C.red; }
/** False while the server renders and during hydration, true from the first client effect on. The page now arrives with its rows already rendered on the server, and a label
 *  that depends on the clock or the viewer's time zone ("5m ago", "Added 19 Nov") would not match what the browser computes: such text is keyed on this, so it is replaced
 *  with the browser's own value right after hydration instead of staying as the server's guess. */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
export function isToday(iso: string) { return Date.now() - new Date(iso).getTime() < 86_400_000; }
export function fmtDay(iso: string) { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
export function siteLabel(url: string) { return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""); }
export function initials(l: Lead) { return (l.company || l.name || "?").slice(0, 2).toUpperCase(); }
export function cityOf(l: Lead): string { return (l.city ?? "").trim(); }
export function countryOf(l: Lead): string { return (l.country ?? "").trim(); }

// Common country → dialling code, so a bare local number can be shown with its country code when
// we actually KNOW the country. We never guess a code for a lead whose country we don't have.
export const COUNTRY_DIAL: Record<string, string> = {
  india: "+91", "united arab emirates": "+971", uae: "+971", "u.a.e": "+971",
  "united states": "+1", usa: "+1", "united states of america": "+1",
  "united kingdom": "+44", uk: "+44", "u.k": "+44", canada: "+1", australia: "+61",
  pakistan: "+92", "saudi arabia": "+966", qatar: "+974", kuwait: "+965", oman: "+968",
  bahrain: "+973", singapore: "+65", germany: "+49", france: "+33", spain: "+34", italy: "+39",
};
/** The phone, shown with its country code. If it already has one (+ or 00) it's left alone;
 *  otherwise, only when the lead's country is known, the code is prepended and a local trunk 0
 *  dropped. Never invents a code for an unknown country. */
export function phoneDisplay(l: Lead): string {
  const raw = (l.whatsapp || l.phone || "").trim();
  if (!raw) return "—";
  if (/^(\+|00)/.test(raw)) return raw;
  const dial = l.country ? COUNTRY_DIAL[l.country.trim().toLowerCase()] : null;
  return dial ? `${dial} ${raw.replace(/^0+/, "")}` : raw;
}

export function StageChip({ stage }: { stage: string }) {
  const s = STAGE[stage] ?? { label: stage, dot: D.neutral };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium" style={{ color: C.ink, background: C.graySoft }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />{s.label}
    </span>
  );
}

/** Filter labels shared by the filter panel and the "active filters" chips under the toolbar. */
export const DATE_LABEL: Record<string, string> = { all: "All time", today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };
export const SCORE_LABEL: Record<string, string> = { any: "Any score", "76-100": "76–100", "51-75": "51–75", "26-50": "26–50", "0-25": "0–25" };
export const MSG_LABEL: Record<string, string> = { any: "Anyone", none: "Not messaged yet", ai: "Messaged by AI", you: "Messaged by you" };
/** "Messaged by" is one choice in the UI; underneath it is the two yes/no flags the filter logic reads. */
export function msgValue(f: { ai: string; you: string }): "any" | "none" | "ai" | "you" {
  if (f.ai === "no" && f.you === "no") return "none";
  if (f.ai === "yes" && f.you === "any") return "ai";
  if (f.you === "yes" && f.ai === "any") return "you";
  return "any";
}
export function msgFlags(v: string): { ai: string; you: string } {
  return { ai: v === "ai" ? "yes" : v === "none" ? "no" : "any", you: v === "you" ? "yes" : v === "none" ? "no" : "any" };
}

export const REJECT_REASONS: { key: string; label: string }[] = [
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
export function RejectMenu({ onPick, disabled, variant, large, full }: { onPick: (reason: string) => void; disabled?: boolean; variant: "icon" | "button"; large?: boolean; full?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={full ? "relative w-full" : "relative"}>
      {variant === "icon" ? (
        <button className={`inline-flex items-center justify-center rounded-lg border transition-colors duration-150 ease-out hover:bg-[#f9fafb] hover:text-[#b91c1c] disabled:opacity-40 ${large ? "h-11 w-11" : "h-8 w-8"}`} style={{ color: open ? C.red : C.sub, background: open ? C.hover : C.panel, borderColor: C.line }} title="Reject this lead" aria-label="Reject this lead" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
          <X size={16} aria-hidden />
        </button>
      ) : (
        <button className={`rounded-lg border px-3.5 text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-[#f9fafb] disabled:opacity-40 ${full ? "h-11 w-full" : "h-9"}`} style={{ color: C.red, background: C.panel, borderColor: C.line }} disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Reject…</button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-[105]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[106] mt-1 w-48 rounded-xl p-1 shadow-md" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="px-3 pb-1 pt-1.5 text-[12px]" style={{ color: C.sub }}>Why reject?</div>
            {REJECT_REASONS.map((r) => (
              <button key={r.key} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-150 ease-out hover:bg-[#f3f4f6]" style={{ color: C.ink }} onClick={() => { setOpen(false); onPick(r.key); }}>{r.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}



export function Tag({ children, tone, soft }: { children: React.ReactNode; tone: string; soft: string }) {
  return <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ color: tone, background: soft }}>{children}</span>;
}
export function WaGlyph({ size = 16 }: { size?: number }) {
  return <MessageCircle size={size} aria-hidden />;
}

