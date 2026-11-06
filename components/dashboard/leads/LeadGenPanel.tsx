"use client";
import { useEffect, useState } from "react";
import { C, D, STAGE, SOURCE_LABEL, SORT_LABEL, REJECT_REASONS, ago, scoreColor, isToday, fmtDay, siteLabel, initials, cityOf, countryOf, phoneDisplay, StageChip, Tag, WaGlyph, RejectMenu, type Lead, type Gen } from "./shared";

/* ── live lead-generation panel (under the KPI cards) ────────────────────────────────────────
 *  Three faces of one card. manual → the "what & where" form, inline, no modal. live → the
 *  real-time progress card from the owner's reference mockup (ring, found/target, step trail).
 *  done → the result summary with a "View new leads" shortcut. The numbers are real: "found so
 *  far" counts rows that actually landed since the run started; the step trail is the one
 *  honest animation — the server records no per-step signal, so steps advance on elapsed time
 *  and snap to "Saving to database" the moment real rows appear. */
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
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px]" style={{ background: "#fff", color: C.amber }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" /><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg></span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold" style={{ color: C.amber }}>Read your website first</div>
              <div className="mt-0.5 text-[12.5px]" style={{ color: C.ink }}>
                {gen?.last_question ?? "I work out who buys from you automatically — but I need to read your website once first. Run the site analysis (Site Brain), then press Auto again."}
              </div>
              <button className="mt-3 rounded-xl px-4 py-2 text-[12.5px] font-semibold text-white" style={{ background: C.brand }} onClick={onOpenBuyerProfile}>Open Ideal Customers</button>
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
