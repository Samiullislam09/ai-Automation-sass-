"use client";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { C, DATE_LABEL, SCORE_LABEL, MSG_LABEL, SOURCE_LABEL, msgValue, msgFlags, countryOf, type Lead } from "./shared";

/** Filters. Plain controls: a segmented control for "when", dropdowns for score and who messaged, and
 *  checkbox lists (with how many leads each choice would show) for source and country. The button at
 *  the bottom says how many leads you will see, so there is nothing to guess and nothing to "apply". */
export type Flt = { status: string[]; source: string[]; city: string[]; ai: string; you: string; converted: string; client: string; score: string };

export default function FilterPanel({ flt, setFlt, leads, dateRange, setDateRange, resultCount, activeCount, onClose, onClear }: {
  flt: Flt; setFlt: (f: Flt) => void; leads: Lead[]; dateRange: string; setDateRange: (v: string) => void;
  resultCount: number; activeCount: number; onClose: () => void; onClear: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // how many leads each source / country has (so every checkbox says what it will show)
  const { sources, countries } = useMemo(() => {
    const s = new Map<string, number>(), c = new Map<string, number>();
    for (const l of leads) {
      if (l.source) s.set(l.source, (s.get(l.source) ?? 0) + 1);
      const k = countryOf(l);
      if (k) c.set(k, (c.get(k) ?? 0) + 1);
    }
    const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
    return { sources: Array.from(s).sort(byCount), countries: Array.from(c).sort(byCount) };
  }, [leads]);
  const [countryQ, setCountryQ] = useState("");
  const shownCountries = countries.filter(([k]) => k.toLowerCase().includes(countryQ.trim().toLowerCase()));

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="border-b px-4 py-4 last:border-b-0" style={{ borderColor: C.line }}>
      <h3 className="mb-2 text-[13px] font-medium">{title}</h3>
      {children}
    </section>
  );
  const Check = ({ on, label, count, onChange }: { on: boolean; label: string; count: number; onChange: () => void }) => (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 text-[13px] transition-colors duration-150 ease-out hover:bg-[#f9fafb]">
      <input type="checkbox" checked={on} onChange={onChange} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="tabular-nums" style={{ color: C.sub }}>{count}</span>
    </label>
  );
  const selectStyle = { width: "100%" } as const;

  return (
    <>
      <div className="fixed inset-0 z-[95]" onClick={onClose} />
      <div role="dialog" aria-label="Filters" className="fixed inset-x-0 bottom-0 z-[96] flex max-h-[85vh] w-full flex-col rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-md sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:mt-2 sm:max-h-[min(560px,calc(100vh-360px))] sm:min-h-[320px] sm:w-[360px] sm:rounded-2xl sm:pb-0" style={{ background: C.panel, border: `1px solid ${C.line}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: C.line }}>
          <h2 className="text-[14px] font-semibold">Filters{activeCount > 0 && <span className="ml-1.5 font-normal tabular-nums" style={{ color: C.sub }}>{activeCount} on</span>}</h2>
          <div className="flex items-center gap-1">
            <button className="h-8 rounded-lg px-2 text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-[#f3f4f6] disabled:opacity-40" style={{ color: C.brand }} onClick={onClear} disabled={activeCount === 0}>Clear all</button>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg transition-colors duration-150 ease-out hover:bg-[#f3f4f6] sm:hidden" style={{ color: C.sub }} aria-label="Close filters"><X size={18} /></button>
          </div>
        </div>

        <div className="lx-lscroll min-h-0 flex-1 overflow-y-auto">
          <Section title="Added">
            <div className="grid grid-cols-4 overflow-hidden rounded-lg border" style={{ borderColor: C.line }} role="group" aria-label="Date added">
              {(["all", "today", "7d", "30d"] as const).map((v, i) => (
                <button key={v} onClick={() => setDateRange(v)} aria-pressed={dateRange === v} className="h-9 text-[12px] font-medium transition-colors duration-150 ease-out"
                  style={{ background: dateRange === v ? C.brand : C.panel, color: dateRange === v ? "#fff" : C.ink, borderLeft: i ? `1px solid ${dateRange === v ? C.brand : C.line}` : "none" }}>
                  {v === "all" ? "All" : v === "today" ? "Today" : v === "7d" ? "7 days" : "30 days"}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Lead score">
            <select aria-label="Lead score" style={selectStyle} value={flt.score} onChange={(e) => setFlt({ ...flt, score: e.target.value })}>
              {Object.entries(SCORE_LABEL).map(([v, l]) => <option key={v} value={v}>{v === "any" ? l : `${l} out of 100`}</option>)}
            </select>
          </Section>

          <Section title="Messaged by">
            <select aria-label="Messaged by" style={selectStyle} value={msgValue(flt)} onChange={(e) => setFlt({ ...flt, ...msgFlags(e.target.value) })}>
              {Object.entries(MSG_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Section>

          {sources.length > 0 && (
            <Section title="Source">
              {sources.map(([k, n]) => <Check key={k} on={flt.source.includes(k)} label={SOURCE_LABEL[k] ?? k} count={n} onChange={() => setFlt({ ...flt, source: toggle(flt.source, k) })} />)}
            </Section>
          )}

          {countries.length > 0 && (
            <Section title="Country">
              {countries.length > 8 && (
                <input type="search" aria-label="Search countries" placeholder="Search countries" value={countryQ} onChange={(e) => setCountryQ(e.target.value)} className="mb-2 h-9 w-full rounded-lg border px-3 text-[13px] outline-none focus:border-[#5242d8]" style={{ background: C.panel, borderColor: C.line, color: C.ink, colorScheme: "light" }} />
              )}
              <div className="max-h-48 overflow-y-auto">
                {shownCountries.length === 0 ? <p className="py-2 text-[13px]" style={{ color: C.sub }}>No match.</p> : shownCountries.map(([k, n]) => (
                  <Check key={k} on={flt.city.includes(k)} label={k} count={n} onChange={() => setFlt({ ...flt, city: toggle(flt.city, k) })} />
                ))}
              </div>
            </Section>
          )}
        </div>

        <div className="shrink-0 border-t p-3" style={{ borderColor: C.line }}>
          <button className="h-10 w-full rounded-lg text-[13px] font-medium text-white transition-opacity duration-150 ease-out hover:opacity-90" style={{ background: C.brand }} onClick={onClose}>
            {resultCount === 0 ? "No leads match" : `Show ${resultCount} lead${resultCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </>
  );
}
