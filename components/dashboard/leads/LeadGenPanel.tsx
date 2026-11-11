"use client";
import { useEffect, useState } from "react";
import { Check, Sparkles, TriangleAlert, X } from "lucide-react";
import { C, type Gen } from "./shared";

/* ── lead-generation panel (under the summary strip) ─────────────────────────────────────────
 *  Three faces of one surface. manual → the "what & where" form, inline, no modal. live → real-time
 *  progress (ring, found / target, step trail). done → the result with a "View new leads" shortcut.
 *  The numbers are real: "found so far" counts rows that actually landed since the run started; the
 *  step trail advances on elapsed time (the server records no per-step signal) and jumps to "Saving
 *  to database" the moment real rows appear. Nothing here loops or pulses. */
const LEADS_PER_RUN_MAX = 25; // client-side convenience cap; per-plan/day enforcement is a TODO (server-side)
const GEN_STEPS = ["Searching sources", "Filtering leads", "Verifying info", "Saving to database"];

export default function LeadGenPanel({ mode, gen, busy, target, foundSoFar, onStart, onClose, onViewNew, onOpenBuyerProfile }: {
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
  const ringColor = failed ? C.red : C.brand;
  const ring = (
    <div className="relative h-14 w-14 shrink-0">
      <svg width="56" height="56" viewBox="0 0 64 64" style={{ transform: "rotate(-90deg)" }} aria-hidden>
        <circle cx="32" cy="32" r={R} fill="none" stroke={C.line} strokeWidth="4" />
        <circle cx="32" cy="32" r={R} fill="none" stroke={ringColor} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${((pct ?? 25) / 100) * CIRC} ${CIRC}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold tabular-nums" style={{ color: ringColor }}>
        {mode === "done" ? (failed ? <TriangleAlert size={18} /> : <Check size={18} />) : pct != null ? `${pct}%` : foundSoFar}
      </span>
    </div>
  );

  const input = "h-9 w-full rounded-md border px-3 text-[13px] outline-none transition-colors duration-150 ease-out focus:border-[#5242d8]";
  const inputStyle = { background: C.panel, borderColor: C.line, color: C.ink, colorScheme: "light" } as const;

  return (
    <div className="mb-6 overflow-hidden rounded-2xl" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex min-w-0 items-center gap-3">
          <Sparkles size={18} className="shrink-0" style={{ color: C.sub }} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">{mode === "manual" ? "Generate leads" : "Lead generation"}</div>
            <div className="mt-0.5 truncate text-[12px]" style={{ color: C.sub }}>
              {mode === "manual" ? "Tell Mr. Lead what to look for." : mode === "live" ? "New leads are saved as they are found." : needsBuyerProfile ? "One step first: confirm who buys from you." : failed ? "The last run hit a problem." : "Run finished."}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mode === "live" && <span className="text-[13px]" style={{ color: C.sub }}>Running</span>}
          {mode === "done" && !failed && !needsBuyerProfile && (
            <button className="h-8 rounded-lg px-3 text-[13px] font-medium text-white transition-opacity duration-150 ease-out hover:opacity-90" style={{ background: C.brand }} onClick={onViewNew}>View new leads</button>
          )}
          {mode !== "live" && (
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg transition-colors duration-150 ease-out hover:bg-[#f3f4f6]" style={{ color: C.sub }} aria-label="Close"><X size={16} /></button>
          )}
        </div>
      </div>

      {needsBuyerProfile ? (
        <div className="flex items-start gap-3 p-4">
          <TriangleAlert size={18} className="mt-0.5 shrink-0" style={{ color: C.amber }} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">Read your website first</div>
            <div className="mt-1 text-[13px]" style={{ color: C.sub }}>
              {gen?.last_question ?? "I work out who buys from you automatically, but I need to read your website once first. Run the site analysis (Site Brain), then press Auto again."}
            </div>
            <button className="mt-3 h-9 rounded-lg px-4 text-[13px] font-medium text-white transition-opacity duration-150 ease-out hover:opacity-90" style={{ background: C.brand }} onClick={onOpenBuyerProfile}>Open Ideal Customers</button>
          </div>
        </div>
      ) : mode === "manual" ? (
        <div className="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[12px]" style={{ color: C.sub }}>What businesses?</label>
              <input className={input} style={inputStyle} placeholder="e.g. ISO certification consultants" value={what} onChange={(e) => setWhat(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-[12px]" style={{ color: C.sub }}>Which city or area?</label>
              <input className={input} style={inputStyle} placeholder="e.g. Dubai" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {examples.map(([w, c]) => (
              <button key={w} className="h-8 rounded-md border px-2.5 text-[12px] transition-colors duration-150 ease-out hover:bg-[#f9fafb]" style={{ borderColor: C.line, color: C.sub, background: C.panel }} onClick={() => { setWhat(w); setCity(c); }}>{w} · {c}</button>
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1 sm:max-w-xs">
              <label className="mb-1 block text-[12px]" style={{ color: C.sub }}>How many? <span className="font-medium tabular-nums" style={{ color: C.ink }}>{count}</span> (max {LEADS_PER_RUN_MAX})</label>
              <input type="range" min={1} max={LEADS_PER_RUN_MAX} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full" style={{ accentColor: C.brand }} />
            </div>
            <button className="h-9 rounded-lg px-5 text-[13px] font-medium text-white transition-opacity duration-150 ease-out hover:opacity-90 disabled:opacity-40" style={{ background: C.brand }} onClick={go} disabled={busy || !what.trim()}>{busy ? "Starting…" : "Start generating"}</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              {ring}
              <div className="min-w-0">
                <div className="text-[14px] font-medium">
                  {mode === "live" ? "Collecting leads…" : failed ? "It hit a problem" : doneFound != null ? `Done: ${doneFound} new lead${doneFound === 1 ? "" : "s"}` : "Done"}
                </div>
                <div className="mt-0.5 text-[13px]" style={{ color: C.sub }}>
                  {mode === "live" ? "Looking across several sources. You can leave this page; leads save by themselves." : failed ? (gen?.last_note ?? "Try again in a minute; the reason is logged in Reports.") : "Fresh leads are in the table below, marked “Added today”."}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-6 pl-[72px] sm:pl-0">
              <div>
                <div className="text-[12px]" style={{ color: C.sub }}>Found</div>
                <div className="mt-0.5 text-[20px] font-semibold leading-tight tabular-nums">{mode === "done" ? (doneFound ?? foundSoFar) : foundSoFar}</div>
              </div>
              {target != null && (
                <div className="border-l pl-6" style={{ borderColor: C.line }}>
                  <div className="text-[12px]" style={{ color: C.sub }}>Target</div>
                  <div className="mt-0.5 text-[20px] font-semibold leading-tight tabular-nums">{target}</div>
                </div>
              )}
            </div>
          </div>

          <ol className="flex items-center gap-x-6 gap-y-2 overflow-x-auto px-4 py-3" style={{ borderTop: `1px solid ${C.line}` }}>
            {GEN_STEPS.map((label, i) => {
              const doneStep = i < step || mode === "done";
              const current = mode === "live" && i === step;
              return (
                <li key={label} className="flex shrink-0 items-center gap-2 text-[13px]" style={{ color: doneStep ? C.ink : current ? C.ink : C.sub }}>
                  {doneStep
                    ? <Check size={14} style={{ color: C.brand }} aria-label="done" />
                    : <span aria-hidden className="h-3.5 w-3.5 rounded-full border" style={{ borderColor: current ? C.brand : C.line, borderWidth: current ? 2 : 1 }} />}
                  <span className="whitespace-nowrap" style={{ fontWeight: current ? 500 : 400 }}>{label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
