"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Mr. WhatsApp · Activity — what the AI is doing on WhatsApp, in plain words.
 *
 *  Everything here comes from ONE object (GET /api/whatsapp/activity), the same one Mr Lxwa answers
 *  questions from, so the page and the assistant can never disagree. Top to bottom: is the AI working (and if
 *  not, why), the rules in force, the numbers that matter, one chart that joins the last 24 hours to what is
 *  scheduled next, then the lists: replies (answering soon / held back and why), first messages queued,
 *  follow-ups, skipped. */

export type Overview = {
  generated_at: string;
  state: { code: string; label: string; detail: string; resumes_at?: string; sending: boolean };
  plan: { window_start: number; window_end: number; tz_offset: number; gap_min: number; gap_max: number; followups_enabled: boolean; first_messages_enabled: boolean; number_age_days: number | null };
  today: { sent: number; cap: number; remaining: number };
  counts: { replies_waiting: number; held: number; first_messages_queued: number; followups_due_24h: number; skipped_24h: number };
  next: { kind: "reply" | "first_message" | "followup"; lead: string; at: string } | null;
  replies: { lead_id: string; name: string; phone: string | null; since: string; state: "queued" | "held" | "reviewed"; due_by?: string; reason: string }[];
  first_messages: { lead_id: string; name: string; at: string }[];
  followups: { lead_id: string; name: string; which: number; due_at: string }[];
  skipped: { lead_id: string; name: string; reason: string; at: string }[];
  timeline: { hour: string; ai: number; you: number; received: number }[];
  upcoming: { hour: string; first: number; followups: number }[];
};

const C = { green: "#008069", ink: "#111b21", sub: "#667781", line: "#e9edef", soft: "#f5f6f6", blue: "#2f9bd6", slate: "#8696a0", amber: "#d98a0b", amberText: "#7a5b00", amberSoft: "#fff8e1", red: "#b42318", redSoft: "#fdeaea", greenSoft: "#e7f6ec", greenText: "#067647" };

const TONE: Record<string, { dot: string; bg: string; fg: string }> = {
  running: { dot: "#17c964", bg: C.greenSoft, fg: C.greenText },
  conversation_active: { dot: "#17c964", bg: C.greenSoft, fg: C.greenText },
  quiet_hours: { dot: "#f5a623", bg: C.amberSoft, fg: C.amberText },
  reconnecting: { dot: "#f5a623", bg: C.amberSoft, fg: C.amberText },
  cap_reached: { dot: "#f5a623", bg: C.amberSoft, fg: C.amberText },
  auto_off: { dot: "#98a2b3", bg: C.soft, fg: C.sub },
  not_connected: { dot: "#e11d48", bg: C.redSoft, fg: C.red },
};

/** "in 3 min", "2 h ago". Past and future, short. */
function rel(iso: string, now: number): string {
  const d = Date.parse(iso) - now;
  const a = Math.abs(d);
  if (a < 60_000) return d >= 0 ? "any moment" : "just now";
  const t = a < 3_600_000 ? `${Math.round(a / 60_000)} min` : a < 86_400_000 ? `${Math.round(a / 3_600_000)} h` : `${Math.round(a / 86_400_000)} d`;
  return d >= 0 ? `in ${t}` : `${t} ago`;
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const KIND: Record<string, string> = { reply: "answering a reply", first_message: "sending a first message", followup: "sending a follow-up" };
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function ActivityPanel({ data, loading, onOpenChat }: { data: Overview | null; loading: boolean; onOpenChat: (leadId: string) => void }) {
  const now = data ? Date.parse(data.generated_at) : Date.now();
  if (!data) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6" aria-busy={loading}>
        <div className="mx-auto max-w-5xl space-y-4">
          {[88, 40, 96, 260, 220].map((h, i) => <div key={i} className="rounded-xl" style={{ height: h, background: C.soft }} />)}
        </div>
      </div>
    );
  }
  const tone = TONE[data.state.code] ?? TONE.auto_off;
  const used = data.today.cap ? Math.min(100, Math.round((data.today.sent / data.today.cap) * 100)) : 0;
  const p = data.plan;
  const warm = p.number_age_days != null && p.number_age_days < 7 ? ` New number, day ${p.number_age_days + 1}: the limit rises each day.` : "";
  const paused = !data.state.sending;

  return (
    <div className="wa-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-6" style={{ background: "#fff", color: C.ink }}>
      <div className="mx-auto max-w-5xl space-y-4 sm:space-y-5">
        {/* 1 · is it working */}
        <section className="rounded-xl p-4" style={{ background: tone.bg }} role="status">
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${data.state.code === "reconnecting" ? "animate-pulse" : ""}`} style={{ background: tone.dot }} />
            <h2 className="text-[15px] font-semibold" style={{ color: tone.fg }}>{data.state.label}</h2>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: tone.fg }}>{data.state.detail}</p>
          {data.next && !paused && (
            <p className="mt-2 border-t pt-2 text-[13px]" style={{ color: tone.fg, borderColor: "rgba(0,0,0,.08)" }}>
              <span className="opacity-80">Next:</span> {KIND[data.next.kind]} to <b>{data.next.lead}</b>{" "}
              <span className="tabular-nums">{clock(data.next.at)} · {rel(data.next.at, now)}</span>
            </p>
          )}
        </section>

        {/* 2 · the rules in force */}
        <p className="text-[12.5px] leading-relaxed" style={{ color: C.sub }}>
          Sends between <b style={{ color: C.ink }}>{hh(p.window_start)}</b> and <b style={{ color: C.ink }}>{hh(p.window_end)}</b> (UTC{p.tz_offset >= 0 ? "+" : ""}{p.tz_offset})
          {p.first_messages_enabled ? <>, one first message every <b style={{ color: C.ink }}>{p.gap_min} to {p.gap_max} min</b></> : ", first messages off"}
          , at most <b style={{ color: C.ink }}>{data.today.cap}</b> messages per 24 h.{p.followups_enabled ? " Follow-ups at 24 h, 90 h and 160 h." : ""}{warm}
        </p>

        {/* 3 · the numbers */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-5" style={{ background: C.line, border: `1px solid ${C.line}` }}>
          <Stat label="Sent, last 24 h" value={`${data.today.sent}`} sub={`of ${data.today.cap} allowed`}>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: C.line }}><div className="h-full rounded-full" style={{ width: `${used}%`, background: used >= 90 ? "#f5a623" : C.green }} /></div>
          </Stat>
          <Stat label="Replies waiting" value={`${data.counts.replies_waiting}`} sub="AI will answer" />
          <Stat label="Held back" value={`${data.counts.held}`} sub="AI will not answer" warn={data.counts.held > 0} />
          <Stat label="First messages queued" value={`${data.counts.first_messages_queued}`} sub={paused ? "paused" : "waiting their turn"} />
          <Stat className="col-span-2 sm:col-span-1" label="Follow-ups, next 24 h" value={`${data.counts.followups_due_24h}`} sub="gentle nudges" />
        </section>

        {/* 4 · past and next, one chart */}
        <section>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <h3 className="text-[14px] font-semibold">Messages per hour</h3>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: C.sub }}>
              <Key color={C.green} label="Sent by the AI" /><Key color={C.slate} label="Sent by you" /><Key color={C.blue} label="Received" /><Key color={C.amber} label="Scheduled next" dashed />
            </div>
          </div>
          <Chart timeline={data.timeline} upcoming={data.upcoming} paused={paused} />
        </section>

        {/* 5 · replies */}
        <List title="Replies" hint="People who wrote to you" empty="Nobody is waiting for an answer." rows={data.replies.length}>
          {data.replies.map((r) => {
            const chip = r.state === "queued" ? { t: "AI answering", bg: C.greenSoft, fg: C.greenText } : r.state === "held" ? { t: "Held back", bg: C.amberSoft, fg: C.amberText } : { t: "No reply sent", bg: C.soft, fg: C.sub };
            return (
              <Row key={r.lead_id} onClick={() => onOpenChat(r.lead_id)} name={r.name} sub={r.reason} chip={chip}
                right={r.state === "queued" && r.due_by ? `answers ${rel(r.due_by, now)}` : `wrote ${rel(r.since, now)}`} />
            );
          })}
        </List>

        <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
          <List title="First messages queue" hint="One at a time, spread out, inside sending hours" empty="No first messages are waiting." rows={data.first_messages.length} more={Math.max(0, data.counts.first_messages_queued - data.first_messages.length)}>
            {data.first_messages.map((f, i) => (
              <Row key={f.lead_id} onClick={() => onOpenChat(f.lead_id)} name={f.name} sub={`#${i + 1} in line`} right={paused ? "paused" : `${clock(f.at)} · ${rel(f.at, now)}`} />
            ))}
          </List>
          <List title="Follow-ups coming" hint="A gentle nudge to someone who went quiet" empty="No follow-ups are due." rows={data.followups.length}>
            {data.followups.map((f) => <Row key={f.lead_id} onClick={() => onOpenChat(f.lead_id)} name={f.name} sub={`Nudge ${f.which} of 3`} right={paused ? "paused" : rel(f.due_at, now)} />)}
          </List>
        </div>

        {data.skipped.length > 0 && (
          <List title="Skipped" hint="First messages not sent, last 24 hours" empty="" rows={data.skipped.length}>
            {data.skipped.map((s) => <Row key={s.lead_id + s.at} onClick={() => onOpenChat(s.lead_id)} name={s.name} sub={s.reason} right={rel(s.at, now)} />)}
          </List>
        )}
        <p className="pb-2 text-[12px]" style={{ color: C.sub }}>Updated {clock(data.generated_at)}. This page refreshes by itself.</p>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, children, warn, className = "" }: { label: string; value: string; sub: string; children?: ReactNode; warn?: boolean; className?: string }) {
  return (
    <div className={`p-3.5 sm:p-4 ${className}`} style={{ background: "#fff" }}>
      <div className="text-[12px]" style={{ color: C.sub }}>{label}</div>
      <div className="mt-1 text-[24px] font-semibold leading-none tabular-nums" style={{ color: warn ? C.amber : C.ink }}>{value}</div>
      <div className="mt-1 text-[12px]" style={{ color: C.sub }}>{sub}</div>
      {children}
    </div>
  );
}
const Key = ({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) => (
  <span className="inline-flex items-center gap-1.5">
    <svg width="16" height="8" aria-hidden><line x1="0" y1="4" x2="16" y2="4" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} /></svg>{label}
  </span>
);

function List({ title, hint, empty, rows, more = 0, children }: { title: string; hint: string; empty: string; rows: number; more?: number; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl" style={{ border: `1px solid ${C.line}` }}>
      <header className="flex items-baseline justify-between gap-3 px-4 py-3" style={{ borderBottom: rows ? `1px solid ${C.line}` : undefined }}>
        <h3 className="text-[14px] font-semibold">{title}{rows + more > 0 && <span className="ml-2 font-normal tabular-nums" style={{ color: C.sub }}>{rows + more}</span>}</h3>
        <span className="hidden truncate text-[12px] md:block" style={{ color: C.sub }}>{hint}</span>
      </header>
      {rows === 0 ? <p className="px-4 py-5 text-[13px]" style={{ color: C.sub }}>{empty}</p> : <ul>{children}</ul>}
      {more > 0 && <p className="px-4 py-2.5 text-[12px]" style={{ color: C.sub, borderTop: `1px solid ${C.line}` }}>and {more} more in line</p>}
    </section>
  );
}

function Row({ name, sub, right, chip, onClick }: { name: string; sub: string; right: string; chip?: { t: string; bg: string; fg: string }; onClick: () => void }) {
  return (
    <li style={{ borderTop: `1px solid ${C.line}` }} className="first:border-t-0">
      <button onClick={onClick} className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors duration-150 ease-out hover:bg-[#f9fafb] sm:flex-row sm:items-start sm:gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[13.5px] font-medium">{name}</span>
            {chip && <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: chip.bg, color: chip.fg }}>{chip.t}</span>}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-snug" style={{ color: C.sub }}>{sub}</span>
        </span>
        <span className="shrink-0 text-[12px] tabular-nums sm:pt-0.5" style={{ color: C.sub }}>{right}</span>
      </button>
    </li>
  );
}

/** A smooth line through the points (Catmull-Rom turned into cubic Béziers), clamped so it never dips below the axis. */
function smooth(pts: [number, number][], floor: number): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1y = Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6), c2y = Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${c1y}, ${p2[0] - (p3[0] - p1[0]) / 6} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** One chart, left to right: the last 24 hours as three connected lines, a "now" marker, then the next hours as
 *  a dashed line for what is scheduled to go out. Plain SVG (no chart library for one chart); hover or touch
 *  shows the exact numbers for that hour. */
function Chart({ timeline, upcoming, paused }: { timeline: Overview["timeline"]; upcoming: Overview["upcoming"]; paused: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = W < 520;
  const H = narrow ? 210 : 230, padL = 30, padR = 12, padT = 14, padB = 28;
  const every = narrow ? 6 : 4;
  const nPast = timeline.length;                         // 24 hourly points, the last one is the current hour
  const N = nPast + Math.max(0, upcoming.length - 1);    // upcoming[0] IS the current hour, so it shares the last point
  const hours = useMemo(() => [...timeline.map((t) => t.hour), ...upcoming.slice(1).map((u) => u.hour)], [timeline, upcoming]);
  const max = useMemo(() => {
    const m = Math.max(1, ...timeline.map((b) => Math.max(b.ai, b.you, b.received)), ...upcoming.map((u) => u.first + u.followups));
    return m <= 4 ? 4 : Math.ceil(m / 4) * 4;
  }, [timeline, upcoming]);
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, N - 1);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const floor = y(0);
  const series = (get: (b: Overview["timeline"][number]) => number) => timeline.map((b, i) => [x(i), y(get(b))] as [number, number]);
  const ai = series((b) => b.ai), you = series((b) => b.you), rec = series((b) => b.received);
  const sched = upcoming.map((u, k) => [x(nPast - 1 + k), y(u.first + u.followups)] as [number, number]);
  const anyPast = timeline.some((b) => b.ai || b.you || b.received);
  const anyNext = upcoming.some((u) => u.first || u.followups);
  const ticks = [0, 1, 2, 3, 4].map((k) => Math.round((max / 4) * k));
  const nowX = x(nPast - 1);

  const onMove = (clientX: number) => {
    const r = box.current?.querySelector("svg")?.getBoundingClientRect();
    if (!r) return;
    const vx = ((clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(N - 1, Math.round(((vx - padL) / (W - padL - padR)) * (N - 1)))));
  };
  const h = hover != null ? hover : null;
  const past = h != null && h < nPast ? timeline[h] : null;
  const nxt = h != null && h >= nPast - 1 ? upcoming[h - (nPast - 1)] : null;
  const tipLeft = h != null ? Math.min(78, Math.max(2, (x(h) / W) * 100 - 12)) : 0;

  return (
    <div ref={box} className="relative rounded-xl p-2 sm:p-3" style={{ border: `1px solid ${C.line}`, touchAction: "pan-y" }}
      onPointerMove={(e) => onMove(e.clientX)} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Messages per hour: the last 24 hours and what is scheduled next">
        {/* the future is a lighter zone */}
        <rect x={nowX} y={padT} width={W - padR - nowX} height={H - padT - padB} fill="#fafafa" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={C.line} strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={C.sub}>{t}</text>
          </g>
        ))}
        {hours.map((hr, i) => i % every === 0 && (
          <text key={hr} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : "middle"} fontSize="11" fill={C.sub}>{String(new Date(hr).getHours()).padStart(2, "0")}:00</text>
        ))}

        {/* now */}
        <line x1={nowX} x2={nowX} y1={padT} y2={H - padB} stroke={C.slate} strokeWidth="1" strokeDasharray="3 3" />
        <text x={nowX + 6} y={padT + 10} fontSize="11" fill={C.sub}>Now</text>

        {/* the last 24 hours */}
        <path d={`${smooth(ai, floor)} L ${ai[ai.length - 1][0]} ${floor} L ${ai[0][0]} ${floor} Z`} fill={C.green} opacity="0.08" />
        <path d={smooth(rec, floor)} fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" />
        <path d={smooth(you, floor)} fill="none" stroke={C.slate} strokeWidth="2" strokeLinecap="round" />
        <path d={smooth(ai, floor)} fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" />

        {/* what is scheduled next */}
        {!paused && anyNext && <path d={smooth(sched, floor)} fill="none" stroke={C.amber} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 5" />}

        {/* hover */}
        {h != null && (
          <g>
            <line x1={x(h)} x2={x(h)} y1={padT} y2={H - padB} stroke={C.ink} strokeOpacity="0.25" strokeWidth="1" />
            {h < nPast && [[ai[h], C.green], [you[h], C.slate], [rec[h], C.blue]].map(([pt, c], k) => <circle key={k} cx={(pt as [number, number])[0]} cy={(pt as [number, number])[1]} r="4" fill="#fff" stroke={c as string} strokeWidth="2" />)}
            {!paused && h >= nPast - 1 && anyNext && <circle cx={sched[h - (nPast - 1)][0]} cy={sched[h - (nPast - 1)][1]} r="4" fill="#fff" stroke={C.amber} strokeWidth="2" />}
          </g>
        )}
      </svg>

      {h != null && (
        <div className="pointer-events-none absolute top-3 z-10 rounded-lg px-3 py-2 text-[12px] shadow-md" style={{ left: `${tipLeft}%`, background: "#fff", border: `1px solid ${C.line}`, minWidth: 150 }}>
          <div className="mb-1 font-semibold">{new Date(hours[h]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{h >= nPast ? " · scheduled" : ""}</div>
          {past && (<>
            <TipRow color={C.green} label="Sent by the AI" v={past.ai} /><TipRow color={C.slate} label="Sent by you" v={past.you} /><TipRow color={C.blue} label="Received" v={past.received} />
          </>)}
          {nxt && !paused && (<>
            <TipRow color={C.amber} label="First messages" v={nxt.first} /><TipRow color={C.amber} label="Follow-ups" v={nxt.followups} />
          </>)}
          {h >= nPast && paused && <div style={{ color: C.sub }}>Paused, nothing scheduled.</div>}
        </div>
      )}
      {!anyPast && !anyNext && <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px]" style={{ color: C.sub }}>No messages yet in the last 24 hours.</p>}
    </div>
  );
}
const TipRow = ({ color, label, v }: { color: string; label: string; v: number }) => (
  <div className="flex items-center justify-between gap-4" style={{ color: C.sub }}>
    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>
    <b className="tabular-nums" style={{ color: C.ink }}>{v}</b>
  </div>
);
