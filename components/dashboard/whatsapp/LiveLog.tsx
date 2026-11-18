"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Mr. WhatsApp · Live log — a manager reads this top to bottom and knows who the AI talked to, what was said,
 *  what it decided and why. Messages and decisions share one list (GET /api/whatsapp/log), newest first,
 *  refreshed by itself every few seconds while the tab is visible. */

type Kind = "customer" | "assistant" | "person" | "sent" | "skipped" | "flagged" | "meeting" | "system" | "error" | "alert";
type Item = { id: string; at: string; lead_id: string | null; name: string; kind: Kind; text: string; detail?: Record<string, any> };

const C = { green: "#008069", ink: "#111b21", sub: "#667781", line: "#e9edef", soft: "#f5f6f6", blue: "#2f9bd6", amber: "#d98a0b", amberSoft: "#fff8e1", amberText: "#7a5b00", red: "#b42318", redSoft: "#fdeaea", greenSoft: "#e7f6ec", greenText: "#067647" };

const LOOK: Record<Kind, { label: string; dot: string; bg: string; fg: string }> = {
  customer: { label: "Customer", dot: C.blue, bg: "#eaf5fc", fg: "#1c6a99" },
  assistant: { label: "AI replied", dot: C.green, bg: C.greenSoft, fg: C.greenText },
  person: { label: "You replied", dot: "#8696a0", bg: C.soft, fg: C.sub },
  sent: { label: "AI sent", dot: C.green, bg: C.greenSoft, fg: C.greenText },
  skipped: { label: "Not answered", dot: "#98a2b3", bg: C.soft, fg: C.sub },
  flagged: { label: "Needs you", dot: C.amber, bg: C.amberSoft, fg: C.amberText },
  meeting: { label: "Call request", dot: "#7a4bd6", bg: "#f2ecfc", fg: "#5b34ad" },
  system: { label: "System", dot: "#98a2b3", bg: C.soft, fg: C.sub },
  error: { label: "Problem", dot: "#e11d48", bg: C.redSoft, fg: C.red },
  alert: { label: "Team alert", dot: "#7a4bd6", bg: "#f2ecfc", fg: "#5b34ad" },
};

type Filter = "all" | "talk" | "attention";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "talk", label: "Conversations" },
  { id: "attention", label: "Needs attention" },
];
const isTalk = (k: Kind) => k === "customer" || k === "assistant" || k === "person";
const isAttention = (k: Kind) => k === "flagged" || k === "meeting" || k === "error" || k === "skipped";

const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const day = (iso: string) => {
  const d = new Date(iso), t = new Date();
  if (d.toDateString() === t.toDateString()) return "Today";
  const y = new Date(t.getTime() - 86_400_000);
  return d.toDateString() === y.toDateString() ? "Yesterday" : d.toLocaleDateString([], { day: "numeric", month: "short" });
};

/** Plain-words extras for a decision: how long it took, what the AI changed, what it understood. */
function facts(it: Item): string[] {
  const d = it.detail ?? {};
  const out: string[] = [];
  if (typeof d.latency_s === "number") out.push(`answered in ${d.latency_s < 60 ? `${Math.round(d.latency_s)} s` : `${Math.round(d.latency_s / 60)} min`}`);
  if (typeof d.intent === "string" && d.intent) out.push(`understood as “${d.intent}”`);
  if (typeof d.parts === "number" && d.parts > 1) out.push(`sent as ${d.parts} short messages`);
  if (Array.isArray(d.notes)) for (const n of d.notes.slice(0, 4)) if (typeof n === "string") out.push(n);
  return out;
}

export default function LiveLog({ onOpenChat }: { onOpenChat: (leadId: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [limit, setLimit] = useState(60);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/whatsapp/log?limit=${limit}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!alive.current) return;
      if (!j?.ok) { setError(j?.error || "The log could not be loaded."); return; }
      setItems(Array.isArray(j.items) ? j.items : []);
      setError(null);
    } catch {
      if (alive.current) setError("The log could not be loaded.");
    }
  }, [limit]);

  useEffect(() => {
    alive.current = true;
    load();
    if (paused) return () => { alive.current = false; };
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 6000);
    return () => { alive.current = false; clearInterval(t); };
  }, [load, paused]);

  const shown = (items ?? []).filter((i) => (filter === "all" ? true : filter === "talk" ? isTalk(i.kind) : isAttention(i.kind)));
  let lastDay = "";

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold">
            Live log
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: paused ? C.soft : C.greenSoft, color: paused ? C.sub : C.greenText }}>
              <span className={`h-1.5 w-1.5 rounded-full ${paused ? "" : "animate-pulse"}`} style={{ background: paused ? "#98a2b3" : "#17c964" }} />{paused ? "Paused" : "Live"}
            </span>
          </h3>
          <p className="mt-0.5 text-[12.5px]" style={{ color: C.sub }}>Who the AI is talking to, what was said, and what it decided. Tap a line for the details.</p>
        </div>
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className="h-8 rounded-full px-3 text-[12.5px] font-medium"
              style={{ background: filter === f.id ? C.green : C.soft, color: filter === f.id ? "#fff" : C.sub }}>{f.label}</button>
          ))}
          <button onClick={() => setPaused((p) => !p)} className="h-8 rounded-full px-3 text-[12.5px] font-medium" style={{ background: C.soft, color: C.sub }}>{paused ? "Resume" : "Pause"}</button>
        </div>
      </div>

      <div className="max-h-[480px] overflow-y-auto rounded-xl" style={{ border: `1px solid ${C.line}` }} aria-live="polite">
        {items === null && !error && <p className="px-4 py-6 text-[13px]" style={{ color: C.sub }}>Loading the log…</p>}
        {error && <p className="px-4 py-4 text-[13px]" style={{ background: C.redSoft, color: C.red }}>{error} The server may be mid-update; this page keeps trying.</p>}
        {items && shown.length === 0 && !error && (
          <p className="px-4 py-6 text-[13px]" style={{ color: C.sub }}>
            {filter === "attention" ? "Nothing needs your attention right now." : "Nothing yet. Every message and every decision shows up here as it happens."}
          </p>
        )}
        {shown.map((it) => {
          const look = LOOK[it.kind] ?? LOOK.system;
          const d = day(it.at);
          const header = d !== lastDay ? d : null;
          lastDay = d;
          const extra = facts(it);
          const expanded = open === it.id;
          return (
            <div key={it.id}>
              {header && <div className="sticky top-0 z-[1] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ background: C.soft, color: C.sub }}>{header}</div>}
              <div className="flex gap-3 px-3 py-2.5" style={{ borderTop: `1px solid ${C.line}` }}>
                <div className="w-[62px] shrink-0 pt-0.5 text-[11.5px] tabular-nums" style={{ color: C.sub }}>{hm(it.at)}</div>
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: look.dot }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="rounded px-1.5 py-px text-[11px] font-semibold" style={{ background: look.bg, color: look.fg }}>{look.label}</span>
                    {it.lead_id ? (
                      <button onClick={() => onOpenChat(it.lead_id!)} className="truncate text-[13px] font-semibold underline-offset-2 hover:underline" style={{ color: C.ink }}>{it.name}</button>
                    ) : <span className="truncate text-[13px] font-semibold">{it.name}</span>}
                  </div>
                  <button onClick={() => setOpen(expanded ? null : it.id)} className="mt-0.5 block w-full text-left text-[13px] leading-relaxed" style={{ color: C.ink, wordBreak: "break-word" }}
                    aria-expanded={expanded}>
                    {isTalk(it.kind) ? <>“{it.text}”</> : it.text}
                  </button>
                  {expanded && extra.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[12px]" style={{ color: C.sub }}>
                      {extra.map((x, i) => <li key={i}>• {x}</li>)}
                    </ul>
                  )}
                  {!expanded && extra.length > 0 && <div className="mt-0.5 truncate text-[11.5px]" style={{ color: C.sub }}>{extra.slice(0, 2).join(" · ")}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {items && items.length >= limit && limit < 200 && (
        <button onClick={() => setLimit((l) => Math.min(200, l + 60))} className="mt-2 h-8 rounded-lg px-3 text-[12.5px] font-medium" style={{ background: C.soft, color: C.sub }}>Show earlier</button>
      )}
    </section>
  );
}
