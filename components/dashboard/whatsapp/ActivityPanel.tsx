"use client";
import { useMemo, useState, type ReactNode } from "react";

/** Mr. WhatsApp · Activity — what the AI is doing on WhatsApp, in plain words.
 *
 *  Everything here comes from ONE object (GET /api/whatsapp/activity), the same one Mr Lxwa answers
 *  questions from, so the page and the assistant can never disagree. Top to bottom: is the AI working (and if
 *  not, why), the numbers that matter, who is next, the last 24 hours as a chart, then the lists: replies
 *  (answering soon / held back and why), first messages queued, follow-ups, skipped. */

export type Overview = {
  generated_at: string;
  state: { code: string; label: string; detail: string; resumes_at?: string };
  today: { sent: number; cap: number; remaining: number };
  counts: { replies_waiting: number; held: number; first_messages_queued: number; followups_due_24h: number; skipped_24h: number };
  next: { kind: "reply" | "first_message" | "followup"; lead: string; at: string } | null;
  replies: { lead_id: string; name: string; phone: string | null; since: string; state: "queued" | "held" | "reviewed"; due_by?: string; reason: string }[];
  first_messages: { lead_id: string; name: string; at: string }[];
  followups: { lead_id: string; name: string; which: number; due_at: string }[];
  skipped: { lead_id: string; name: string; reason: string; at: string }[];
  timeline: { hour: string; ai: number; you: number; received: number }[];
};

const C = { green: "#008069", ink: "#111b21", sub: "#667781", line: "#e9edef", soft: "#f5f6f6", blue: "#53bdeb", slate: "#8696a0", amber: "#b7791f", amberSoft: "#fff8e1", red: "#b42318", redSoft: "#fdeaea", greenSoft: "#e7f6ec" };

const TONE: Record<string, { dot: string; bg: string; fg: string }> = {
  running: { dot: "#17c964", bg: C.greenSoft, fg: "#067647" },
  conversation_active: { dot: "#17c964", bg: C.greenSoft, fg: "#067647" },
  quiet_hours: { dot: "#f5a623", bg: C.amberSoft, fg: "#7a5b00" },
  reconnecting: { dot: "#f5a623", bg: C.amberSoft, fg: "#7a5b00" },
  cap_reached: { dot: "#f5a623", bg: C.amberSoft, fg: "#7a5b00" },
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

export default function ActivityPanel({ data, loading, onOpenChat }: { data: Overview | null; loading: boolean; onOpenChat: (leadId: string) => void }) {
  const now = data ? Date.parse(data.generated_at) : Date.now();
  if (!data) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6" aria-busy={loading}>
        <div className="mx-auto max-w-5xl space-y-4">
          {[88, 96, 200, 220].map((h, i) => <div key={i} className="rounded-xl" style={{ height: h, background: C.soft }} />)}
        </div>
      </div>
    );
  }
  const tone = TONE[data.state.code] ?? TONE.auto_off;
  const used = data.today.cap ? Math.min(100, Math.round((data.today.sent / data.today.cap) * 100)) : 0;

  return (
    <div className="wa-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" style={{ background: "#fff", color: C.ink }}>
      <div className="mx-auto max-w-5xl space-y-5">
        {/* 1 · is it working */}
        <section className="flex flex-wrap items-start gap-3 rounded-xl p-4" style={{ background: tone.bg }} role="status">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${data.state.code === "reconnecting" ? "animate-pulse" : ""}`} style={{ background: tone.dot }} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold" style={{ color: tone.fg }}>{data.state.label}</h2>
            <p className="mt-0.5 text-[13px]" style={{ color: tone.fg }}>{data.state.detail}</p>
          </div>
          {data.next && (
            <p className="text-[13px]" style={{ color: tone.fg }}>
              Next: {KIND[data.next.kind]} to <b>{data.next.lead}</b> <span className="tabular-nums">{rel(data.next.at, now)}</span>
            </p>
          )}
        </section>

        {/* 2 · the numbers */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-5" style={{ background: C.line, border: `1px solid ${C.line}` }}>
          <Stat label="Sent, last 24 h" value={`${data.today.sent}`} sub={`of ${data.today.cap} allowed`}>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: C.line }}><div className="h-full rounded-full" style={{ width: `${used}%`, background: used >= 90 ? "#f5a623" : C.green }} /></div>
          </Stat>
          <Stat label="Replies waiting" value={`${data.counts.replies_waiting}`} sub="AI will answer" />
          <Stat label="Held back" value={`${data.counts.held}`} sub="AI will not answer" warn={data.counts.held > 0} />
          <Stat label="First messages queued" value={`${data.counts.first_messages_queued}`} sub="waiting their turn" />
          <Stat label="Follow-ups, next 24 h" value={`${data.counts.followups_due_24h}`} sub="gentle nudges" />
        </section>

        {/* 3 · last 24 hours */}
        <section>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <h3 className="text-[14px] font-semibold">Last 24 hours</h3>
            <div className="flex items-center gap-4 text-[12px]" style={{ color: C.sub }}>
              <Key color={C.green} label="Sent by the AI" /><Key color={C.slate} label="Sent by you" /><Key color={C.blue} label="Received" />
            </div>
          </div>
          <Chart timeline={data.timeline} />
        </section>

        {/* 4 · replies */}
        <List title="Replies" hint="People who wrote to you" empty="Nobody is waiting for an answer." rows={data.replies.length}>
          {data.replies.map((r) => {
            const chip = r.state === "queued" ? { t: "AI answering", bg: C.greenSoft, fg: "#067647" } : r.state === "held" ? { t: "Held back", bg: C.amberSoft, fg: "#7a5b00" } : { t: "No reply sent", bg: C.soft, fg: C.sub };
            return (
              <Row key={r.lead_id} onClick={() => onOpenChat(r.lead_id)} name={r.name} sub={r.reason} chip={chip}
                right={r.state === "queued" && r.due_by ? `answers ${rel(r.due_by, now)}` : `wrote ${rel(r.since, now)}`} />
            );
          })}
        </List>

        <div className="grid gap-5 lg:grid-cols-2">
          <List title="First messages queue" hint="One at a time, spread out, inside sending hours" empty="No first messages are waiting." rows={data.first_messages.length}>
            {data.first_messages.map((f, i) => <Row key={f.lead_id} onClick={() => onOpenChat(f.lead_id)} name={f.name} sub={`#${i + 1} in line`} right={`${clock(f.at)} · ${rel(f.at, now)}`} />)}
          </List>
          <List title="Follow-ups coming" hint="A gentle nudge to someone who went quiet" empty="No follow-ups are due." rows={data.followups.length}>
            {data.followups.map((f) => <Row key={f.lead_id} onClick={() => onOpenChat(f.lead_id)} name={f.name} sub={`Nudge ${f.which} of 3`} right={rel(f.due_at, now)} />)}
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

function Stat({ label, value, sub, children, warn }: { label: string; value: string; sub: string; children?: ReactNode; warn?: boolean }) {
  return (
    <div className="p-4" style={{ background: "#fff" }}>
      <div className="text-[12px]" style={{ color: C.sub }}>{label}</div>
      <div className="mt-1 text-[24px] font-semibold leading-none tabular-nums" style={{ color: warn ? C.amber : C.ink }}>{value}</div>
      <div className="mt-1 text-[12px]" style={{ color: C.sub }}>{sub}</div>
      {children}
    </div>
  );
}
const Key = ({ color, label }: { color: string; label: string }) => <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}</span>;

function List({ title, hint, empty, rows, children }: { title: string; hint: string; empty: string; rows: number; children: ReactNode }) {
  return (
    <section className="rounded-xl" style={{ border: `1px solid ${C.line}` }}>
      <header className="flex items-baseline justify-between gap-3 px-4 py-3" style={{ borderBottom: rows ? `1px solid ${C.line}` : undefined }}>
        <h3 className="text-[14px] font-semibold">{title}{rows > 0 && <span className="ml-2 font-normal tabular-nums" style={{ color: C.sub }}>{rows}</span>}</h3>
        <span className="hidden truncate text-[12px] sm:block" style={{ color: C.sub }}>{hint}</span>
      </header>
      {rows === 0 ? <p className="px-4 py-5 text-[13px]" style={{ color: C.sub }}>{empty}</p> : <ul>{children}</ul>}
    </section>
  );
}

function Row({ name, sub, right, chip, onClick }: { name: string; sub: string; right: string; chip?: { t: string; bg: string; fg: string }; onClick: () => void }) {
  return (
    <li style={{ borderTop: `1px solid ${C.line}` }} className="first:border-t-0">
      <button onClick={onClick} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors duration-150 ease-out hover:bg-[#f9fafb]">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium">{name}</span>
            {chip && <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: chip.bg, color: chip.fg }}>{chip.t}</span>}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-snug" style={{ color: C.sub }}>{sub}</span>
        </span>
        <span className="shrink-0 pt-0.5 text-[12px] tabular-nums" style={{ color: C.sub }}>{right}</span>
      </button>
    </li>
  );
}

/** 24 stacked bars, one per hour, newest on the right. Plain SVG: no chart library for one chart. */
function Chart({ timeline }: { timeline: Overview["timeline"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 170, padL = 28, padB = 22, padT = 8, gap = 4;
  const max = useMemo(() => Math.max(4, ...timeline.map((b) => b.ai + b.you + b.received)), [timeline]);
  const bw = (W - padL) / Math.max(1, timeline.length) - gap;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const total = timeline.reduce((n, b) => n + b.ai + b.you + b.received, 0);
  const ticks = [0, Math.ceil(max / 2), max];
  const h = hover != null ? timeline[hover] : null;

  return (
    <div className="relative rounded-xl p-3" style={{ border: `1px solid ${C.line}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Messages per hour over the last 24 hours" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke={C.line} strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill={C.sub}>{t}</text>
          </g>
        ))}
        {timeline.map((b, i) => {
          const x = padL + i * (bw + gap) + gap / 2;
          let top = H - padB;
          const seg = (v: number, color: string) => {
            if (!v) return null;
            const hgt = (H - padT - padB) * (v / max);
            top -= hgt;
            return <rect x={x} y={top} width={bw} height={Math.max(1, hgt)} rx="2" fill={color} />;
          };
          const hr = new Date(b.hour).getHours();
          return (
            <g key={b.hour} onMouseEnter={() => setHover(i)} opacity={hover == null || hover === i ? 1 : 0.55}>
              <rect x={x - gap / 2} y={padT} width={bw + gap} height={H - padT - padB} fill="transparent" />
              {seg(b.ai, C.green)}{seg(b.you, C.slate)}{seg(b.received, C.blue)}
              {i % 3 === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill={C.sub}>{String(hr).padStart(2, "0")}:00</text>}
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute right-3 top-3 rounded-lg px-3 py-2 text-[12px] shadow-md" style={{ background: "#fff", border: `1px solid ${C.line}` }}>
          <b>{new Date(h.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b>
          <div style={{ color: C.sub }}>AI sent {h.ai} · You sent {h.you} · Received {h.received}</div>
        </div>
      )}
      {total === 0 && <p className="absolute inset-x-0 top-1/2 text-center text-[13px]" style={{ color: C.sub }}>No messages in the last 24 hours.</p>}
    </div>
  );
}
