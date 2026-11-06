"use client";
import { useEffect, useState } from "react";
import { C, D, STAGE, SOURCE_LABEL, SORT_LABEL, REJECT_REASONS, ago, scoreColor, isToday, fmtDay, siteLabel, initials, cityOf, countryOf, phoneDisplay, StageChip, Tag, WaGlyph, RejectMenu, type Lead, type Gen } from "./shared";

/* ── advanced filter popover ─────────────────────────────────────────────────────────────── */
export type Flt = { status: string[]; source: string[]; city: string[]; ai: string; you: string; converted: string; client: string; score: string };
export default function FilterPanel({ flt, setFlt, cities, dateRange, setDateRange, onClose, onClear }: { flt: Flt; setFlt: (f: Flt) => void; cities: string[]; dateRange: string; setDateRange: (v: string) => void; onClose: () => void; onClear: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const STATUSES: [string, string][] = [["approved", "Approved"], ["contacted", "Contacted"], ["replied", "Engaged"], ["won", "Won"], ["lost", "Lost"], ["rejected", "Rejected"], ["opted_out", "Opted out"]];
  const SOURCES: [string, string][] = [["serper", "Google Maps"], ["osm", "OpenStreetMap"], ["places", "Google Places"], ["jobs", "Job board"], ["web", "Web search"], ["manual", "Manual"]];
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
      <div role="dialog" aria-label="Filters" className="fixed inset-x-0 bottom-0 z-[96] w-full rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:mt-2 sm:w-[340px] sm:rounded-2xl sm:pb-0" style={{ background: C.panel, border: `1px solid ${C.line}` }} onClick={(e) => e.stopPropagation()}>
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

