"use client";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Mr. WhatsApp · Activity — what the AI is doing on WhatsApp, in plain words.
 *
 *  Everything here comes from ONE object (GET /api/whatsapp/activity), the same one Mr Lxwa answers
 *  questions from, so the page and the assistant can never disagree. Top to bottom: is the AI working (and if
 *  not, why), the rules in force, the numbers that matter, one chart that joins the last 24 hours to what is
 *  scheduled next, then the lists: replies (answering soon / held back and why), first messages queued,
 *  follow-ups, skipped. */

export type AgendaItem = {
  kind: "reply" | "first_message" | "followup" | "resume";
  at: string; lead_id?: string; lead?: string; title: string; detail: string;
  message?: { state: "ready" | "ai"; text: string };
};

export type Overview = {
  generated_at: string;
  state: { code: string; label: string; detail: string; resumes_at?: string; sending: boolean };
  plan: { window_start: number; window_end: number; tz_offset: number; gap_min: number; gap_max: number; followups_enabled: boolean; first_messages_enabled: boolean; number_age_days: number | null };
  today: { sent: number; cap: number; remaining: number };
  counts: { replies_waiting: number; held: number; first_messages_queued: number; followups_due_24h: number; skipped_24h: number };
  next: { kind: "reply" | "first_message" | "followup"; lead: string; at: string } | null;
  replies: { lead_id: string; name: string; phone: string | null; since: string; state: "queued" | "held" | "reviewed"; due_by?: string; reason: string }[];
  first_messages: { lead_id: string; name: string; at: string }[];
  agenda: AgendaItem[];
  agenda_more: number;
  followups: { lead_id: string; name: string; which: number; due_at: string }[];
  skipped: { lead_id: string; name: string; reason: string; at: string }[];
  timeline: { hour: string; ai: number; you: number; received: number }[];
  upcoming: { hour: string; first: number; followups: number }[];
  reply_speed: { day: SpeedStats; week: SpeedStats; first_reply: SpeedStats };
  quality: Quality;
};

export type SpeedStats = {
  samples: number; p50_s: number | null; p95_s: number | null; avg_s: number | null; fast_pct: number | null; slowest_s: number | null;
  health: "good" | "slow" | "bad" | "no_data";
};
export type Quality = {
  loops: { lead_id: string; name: string; repeats: number }[];
  holding: number;
  needs_you: { lead_id: string; name: string; reason: string }[];
};

const NO_SPEED: SpeedStats = { samples: 0, p50_s: null, p95_s: null, avg_s: null, fast_pct: null, slowest_s: null, health: "no_data" };

/** 14 -> "14 s", 95 -> "2 min", 4000 -> "1.1 h". */
function dur(s: number | null): string {
  if (s == null) return "–";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

const C = { green: "#008069", ink: "#111b21", sub: "#667781", line: "#e9edef", soft: "#f5f6f6", blue: "#2f9bd6", slate: "#8696a0", amber: "#d98a0b", amberText: "#7a5b00", amberSoft: "#fff8e1", red: "#b42318", redSoft: "#fdeaea", greenSoft: "#e7f6ec", greenText: "#067647" };

const TONE: Record<string, { dot: string; bg: string; fg: string }> = {
  running: { dot: "#17c964", bg: C.greenSoft, fg: C.greenText },
  conversation_active: { dot: "#17c964", bg: C.greenSoft, fg: C.greenText },
  in_use_elsewhere: { dot: "#f5a623", bg: C.amberSoft, fg: C.amberText },
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

/** The web app and the agent server deploy separately, so for a while the page can get an overview from an
 *  OLDER agent server (no `agenda`, no `plan`, ...). Fill every field the page reads, deriving the timeline from
 *  the older lists when it is missing, so a version gap shows a plainer page instead of a crash. */
export function normalizeOverview(raw: Partial<Overview> | null): Overview | null {
  if (!raw || typeof raw !== "object") return null;
  const now = raw.generated_at ?? new Date().toISOString();
  const first = Array.isArray(raw.first_messages) ? raw.first_messages : [];
  const follow = Array.isArray(raw.followups) ? raw.followups : [];
  const agenda: AgendaItem[] = Array.isArray(raw.agenda)
    ? raw.agenda
    : [
        ...first.slice(0, 12).map((f) => ({ kind: "first_message" as const, at: f.at, lead_id: f.lead_id, lead: f.name, title: "First message", detail: "" })),
        ...follow.slice(0, 6).map((f) => ({ kind: "followup" as const, at: f.due_at, lead_id: f.lead_id, lead: f.name, title: `Follow-up ${f.which} of 3`, detail: "" })),
      ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return {
    generated_at: now,
    state: { code: "running", label: "Working", detail: "", sending: true, ...(raw.state ?? {}) },
    plan: { window_start: 9, window_end: 21, tz_offset: 0, gap_min: 4, gap_max: 14, followups_enabled: true, first_messages_enabled: true, number_age_days: null, ...(raw.plan ?? {}) },
    today: { sent: 0, cap: 20, remaining: 20, ...(raw.today ?? {}) },
    counts: { replies_waiting: 0, held: 0, first_messages_queued: first.length, followups_due_24h: 0, skipped_24h: 0, ...(raw.counts ?? {}) },
    next: raw.next ?? null,
    replies: Array.isArray(raw.replies) ? raw.replies : [],
    first_messages: first,
    agenda,
    agenda_more: typeof raw.agenda_more === "number" ? raw.agenda_more : 0,
    followups: follow,
    skipped: Array.isArray(raw.skipped) ? raw.skipped : [],
    timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
    upcoming: Array.isArray(raw.upcoming) ? raw.upcoming : [],
    // An older agent server does not send these: the page then simply has no speed card.
    reply_speed: { day: { ...NO_SPEED, ...(raw.reply_speed?.day ?? {}) }, week: { ...NO_SPEED, ...(raw.reply_speed?.week ?? {}) }, first_reply: { ...NO_SPEED, ...(raw.reply_speed?.first_reply ?? {}) } },
    quality: { loops: [], holding: 0, needs_you: [], ...(raw.quality ?? {}) },
  };
}

/** If anything in the panel throws, say so inside the panel: the rest of the WhatsApp page stays usable. */
class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error("[whatsapp activity]", e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <h3 className="text-[15px] font-semibold" style={{ color: C.ink }}>Activity could not be shown</h3>
          <p className="mt-1 text-[13px]" style={{ color: C.sub }}>Your chats are not affected. Reload the page; if it happens again, the server may be mid-update.</p>
          <button onClick={() => this.setState({ failed: false })} className="mt-3 h-9 rounded-lg px-4 text-[13px] font-medium text-white" style={{ background: C.green }}>Try again</button>
        </div>
      </div>
    );
  }
}

export default function ActivityPanel(props: { data: Overview | null; loading: boolean; showAll?: boolean; onShowAll?: (v: boolean) => void; onOpenChat: (leadId: string) => void }) {
  const data = useMemo(() => normalizeOverview(props.data), [props.data]);
  return <PanelBoundary><ActivityBody data={data} loading={props.loading} showAll={!!props.showAll} onShowAll={props.onShowAll} onOpenChat={props.onOpenChat} /></PanelBoundary>;
}

function ActivityBody({ data, loading, showAll, onShowAll, onOpenChat }: { data: Overview | null; loading: boolean; showAll: boolean; onShowAll?: (v: boolean) => void; onOpenChat: (leadId: string) => void }) {
  const now = data ? Date.parse(data.generated_at) : Date.now();
  if (!data) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6" aria-busy={loading}>
        <div className="mx-auto max-w-5xl space-y-4">
          {[88, 96, 340, 260].map((h, i) => <div key={i} className="rounded-xl" style={{ height: h, background: C.soft }} />)}
        </div>
      </div>
    );
  }
  const tone = TONE[data.state.code] ?? TONE.auto_off;
  const used = data.today.cap ? Math.min(100, Math.round((data.today.sent / data.today.cap) * 100)) : 0;
  const p = data.plan;
  const warm = p.number_age_days != null && p.number_age_days < 7 ? ` New number, day ${p.number_age_days + 1}: the limit rises each day.` : "";
  const paused = !data.state.sending;
  const needYou = data.replies.filter((r) => r.state !== "queued");

  return (
    <div className="wa-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-6" style={{ background: "#fff", color: C.ink }}>
      <div className="mx-auto max-w-5xl space-y-4 sm:space-y-6">
        {/* 1 · is it working */}
        <section className="rounded-xl p-4" style={{ background: tone.bg }} role="status">
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${data.state.code === "reconnecting" ? "animate-pulse" : ""}`} style={{ background: tone.dot }} />
            <h2 className="text-[15px] font-semibold" style={{ color: tone.fg }}>{data.state.label}</h2>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: tone.fg }}>{data.state.detail}</p>
        </section>

        {/* 2 · the numbers */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-4" style={{ background: C.line, border: `1px solid ${C.line}` }}>
          <Stat label="Sent, last 24 h" value={`${data.today.sent}`} sub={`of ${data.today.cap} allowed`}>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: C.line }}><div className="h-full rounded-full" style={{ width: `${used}%`, background: used >= 90 ? "#f5a623" : C.green }} /></div>
          </Stat>
          <Stat label="Replies to answer" value={`${data.counts.replies_waiting}`} sub="the AI is on it" />
          <Stat label="First messages waiting" value={`${data.counts.first_messages_queued}`} sub={paused ? "paused" : "in line"} />
          <Stat label="Needs you" value={`${data.counts.held}`} sub="the AI will not answer" warn={data.counts.held > 0} />
        </section>

        {/* 2b · how fast, and how well */}
        <Health data={data} onOpenChat={onOpenChat} />

        {/* 3 · what happens next */}
        <section>
          <div className="mb-3">
            <h3 className="text-[15px] font-semibold">What happens next</h3>
            <p className="mt-0.5 text-[12.5px]" style={{ color: C.sub }}>In the order it will happen. Each message goes out one at a time, with a gap, inside sending hours.</p>
          </div>
          <Agenda items={data.agenda} more={data.agenda_more} showAll={showAll} onShowAll={onShowAll} loading={loading} now={now} paused={paused} waiting={data.counts.first_messages_queued} onOpenChat={onOpenChat} />
        </section>

        {/* 4 · people the AI will not answer on its own */}
        {needYou.length > 0 && (
          <List title="Needs your attention" hint="The AI will not answer these on its own" empty="" rows={needYou.length}>
            {needYou.map((r) => {
              const chip = r.state === "held" ? { t: "Held back", bg: C.amberSoft, fg: C.amberText } : { t: "No reply sent", bg: C.soft, fg: C.sub };
              return <Row key={r.lead_id} onClick={() => onOpenChat(r.lead_id)} name={r.name} sub={r.reason} chip={chip} right={`wrote ${rel(r.since, now)}`} />;
            })}
          </List>
        )}

        {/* 5 · past and next, one chart */}
        <section>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <h3 className="text-[15px] font-semibold">Messages per hour</h3>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: C.sub }}>
              <Key color={C.green} label="Sent by the AI" /><Key color={C.slate} label="Sent by you" /><Key color={C.blue} label="Received" /><Key color={C.amber} label="Scheduled next" dashed />
            </div>
          </div>
          {data.timeline.length >= 2 ? <Chart timeline={data.timeline} upcoming={data.upcoming} paused={paused} /> : <p className="rounded-xl px-4 py-5 text-[13px]" style={{ background: C.soft, color: C.sub }}>The hourly chart appears once the server has been updated.</p>}
        </section>

        {data.skipped.length > 0 && (
          <List title="Skipped" hint="First messages not sent, last 24 hours" empty="" rows={data.skipped.length}>
            {data.skipped.map((s) => <Row key={s.lead_id + s.at} onClick={() => onOpenChat(s.lead_id)} name={s.name} sub={s.reason} right={rel(s.at, now)} />)}
          </List>
        )}

        {/* 6 · the rules in force */}
        <p className="text-[12.5px] leading-relaxed" style={{ color: C.sub }}>
          <b style={{ color: C.ink }}>The rules:</b> sends between {hh(p.window_start)} and {hh(p.window_end)} (UTC{p.tz_offset >= 0 ? "+" : ""}{p.tz_offset})
          {p.first_messages_enabled ? `, one first message every ${p.gap_min} to ${p.gap_max} min` : ", first messages off"}
          , at most {data.today.cap} messages per 24 h.{p.followups_enabled ? " Follow-ups after 48 h, 5 days and 7 days of silence." : ""}{warm} Updated {clock(data.generated_at)}; this page refreshes by itself.
        </p>
      </div>
    </div>
  );
}

const HEALTH_TONE: Record<SpeedStats["health"], { bg: string; fg: string; dot: string; title: string; sub: string }> = {
  good: { bg: C.greenSoft, fg: C.greenText, dot: "#17c964", title: "Replies are fast", sub: "Customers who write in are answered within seconds." },
  slow: { bg: C.amberSoft, fg: C.amberText, dot: "#f5a623", title: "Replies are slower than they should be", sub: "A customer may start to lose interest. Check that the server is healthy." },
  bad: { bg: C.redSoft, fg: C.red, dot: "#e11d48", title: "Replies are too slow", sub: "Customers are waiting minutes. This is the thing that makes them leave — look at it first." },
  no_data: { bg: C.soft, fg: C.sub, dot: "#98a2b3", title: "Not enough replies yet to judge", sub: "This fills in once a few customers have written in and been answered." },
};

/** How fast the AI answers people who write to it, and the things that mean it is not doing well. All of it is
 *  read back from the messages themselves — a measurement, not a promise. */
function Health({ data, onOpenChat }: { data: Overview; onOpenChat: (id: string) => void }) {
  const d = data.reply_speed.day, w = data.reply_speed.week, f = data.reply_speed.first_reply, q = data.quality;
  const h = HEALTH_TONE[d.health];
  const hasAnything = d.samples > 0 || w.samples > 0 || f.samples > 0 || q.loops.length > 0 || q.holding > 0 || q.needs_you.length > 0;
  if (!hasAnything) return null;
  return (
    <section className="space-y-3" aria-label="Reply speed">
      <div className="rounded-xl p-4" style={{ background: h.bg }} role="status">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.dot }} />
          <h3 className="text-[15px] font-semibold" style={{ color: h.fg }}>{h.title}</h3>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: h.fg }}>{h.sub}</p>
      </div>
      {d.samples > 0 && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-4" style={{ background: C.line, border: `1px solid ${C.line}` }}>
          <Stat label="Typical reply time" value={dur(d.p50_s)} sub={`last 24 h · ${d.samples} repl${d.samples === 1 ? "y" : "ies"}`} />
          <Stat label="Slowest 1 in 20" value={dur(d.p95_s)} sub="most are faster than this" warn={d.health === "slow" || d.health === "bad"} />
          <Stat label="Answered within 30 s" value={d.fast_pct == null ? "–" : `${d.fast_pct}%`} sub="of replies" />
          <Stat label="Last 7 days" value={dur(w.p50_s)} sub={w.fast_pct == null ? "typical reply" : `typical · ${w.fast_pct}% within 30 s`} />
        </div>
      )}
      {f.samples > 0 && (
        <p className="rounded-xl px-4 py-3 text-[12.5px] leading-relaxed" style={{ background: C.soft, color: C.sub }}>
          <b style={{ color: C.ink }}>First messages</b> are answered after a deliberate pause of 1 to 5 minutes (typical {dur(f.p50_s)}, last 24 h, {f.samples} chat{f.samples === 1 ? "" : "s"}) so it reads like a person at a phone. Once the chat is going, replies are immediate for the next 5 hours. The speed numbers above only count live replies.
        </p>
      )}
      {q.loops.length > 0 && (
        <List title="The AI repeated itself" hint="Same message sent twice in a row, last 24 hours" empty="" rows={q.loops.length}>
          {q.loops.map((l) => <Row key={l.lead_id} onClick={() => onOpenChat(l.lead_id)} name={l.name} sub="Open the chat and send a proper answer yourself." chip={{ t: "Repeat", bg: C.redSoft, fg: C.red }} right={`${l.repeats} repeat${l.repeats === 1 ? "" : "s"}`} />)}
        </List>
      )}
      {q.holding > 0 && (
        <p className="rounded-xl px-4 py-3 text-[13px] leading-relaxed" style={{ background: C.amberSoft, color: C.amberText }}>
          <b>{q.holding}</b> customer{q.holding === 1 ? " was" : "s were"} told a team member would reply, because the AI could not answer in time (last 24 h). Each one is flagged for you below.
        </p>
      )}
      {q.needs_you.length > 0 && (
        <List title="Flagged for you" hint="The AI handed these to a person" empty="" rows={q.needs_you.length}>
          {q.needs_you.map((l) => <Row key={l.lead_id} onClick={() => onOpenChat(l.lead_id)} name={l.name} sub={l.reason} chip={{ t: "Needs you", bg: C.amberSoft, fg: C.amberText }} right="open chat" />)}
        </List>
      )}
    </section>
  );
}

const KIND_STYLE: Record<string, { label: string; dot: string; bg: string; fg: string }> = {
  first_message: { label: "First message", dot: C.green, bg: C.greenSoft, fg: C.greenText },
  reply: { label: "Reply", dot: C.blue, bg: "#e6f3fb", fg: "#1b6fa3" },
  followup: { label: "Follow-up", dot: C.slate, bg: C.soft, fg: C.sub },
  resume: { label: "", dot: C.amber, bg: C.amberSoft, fg: C.amberText },
};

/** The timeline: a rail with a dot per event, the time on the left, and for each message what it will say. */
function Agenda({ items, more, showAll, onShowAll, loading, now, paused, waiting, onOpenChat }: { items: AgendaItem[]; more: number; showAll: boolean; onShowAll?: (v: boolean) => void; loading: boolean; now: number; paused: boolean; waiting: number; onOpenChat: (id: string) => void }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (paused) {
    return <p className="rounded-xl px-4 py-5 text-[13px]" style={{ background: C.soft, color: C.sub }}>Nothing is scheduled while the AI is paused. {waiting > 0 ? `${waiting} first message${waiting === 1 ? " is" : "s are"} waiting and will be spread out once it starts again.` : ""}</p>;
  }
  if (!items.length) return <p className="rounded-xl px-4 py-5 text-[13px]" style={{ background: C.soft, color: C.sub }}>Nothing is waiting to go out right now.</p>;
  return (
    <ol className="relative">
      <li className="relative flex gap-3 pb-4 sm:gap-4">
        <TimeCol top="Now" sub={clock(new Date(now).toISOString())} strong />
        <Rail dot={C.ink} first />
        <span className="pt-0.5 text-[13px]" style={{ color: C.sub }}>Here and now</span>
      </li>
      {items.map((it, i) => {
        const st = KIND_STYLE[it.kind];
        const isOpen = !!open[i];
        const last = i === items.length - 1 && more === 0;
        return (
          <li key={i} className="relative flex gap-3 pb-4 sm:gap-4">
            <TimeCol top={clock(it.at)} sub={rel(it.at, now)} />
            <Rail dot={st.dot} last={last} />
            {it.kind === "resume" ? (
              <div className="min-w-0 flex-1 rounded-lg px-3 py-2" style={{ background: st.bg }}>
                <div className="text-[13px] font-semibold" style={{ color: st.fg }}>{it.title}</div>
                <div className="text-[12.5px]" style={{ color: st.fg }}>{it.detail}</div>
              </div>
            ) : (
              <div className="min-w-0 flex-1 rounded-xl p-3" style={{ border: `1px solid ${C.line}` }}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: st.bg, color: st.fg }}>{it.kind === "followup" ? it.title : st.label}</span>
                  <button onClick={() => it.lead_id && onOpenChat(it.lead_id)} className="min-w-0 truncate text-left text-[13.5px] font-semibold hover:underline">{it.lead}</button>
                </div>
                {it.message && (
                  it.message.state === "ready" ? (
                    <div className="mt-2">
                      <div className="mb-1 text-[11.5px] font-medium" style={{ color: C.sub }}>This message will be sent</div>
                      <blockquote className="rounded-lg px-3 py-2 text-[13px] leading-relaxed" style={{ background: "#d9fdd3", color: C.ink }}>
                        <div className="whitespace-pre-line">{isOpen || it.message.text.length <= 170 ? it.message.text : `${it.message.text.replace(/\s+/g, " ").slice(0, 160).trimEnd()}…`}</div>
                      </blockquote>
                      {it.message.text.length > 170 && <button onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} className="mt-1 text-[12px] font-medium" style={{ color: C.green }}>{isOpen ? "Show less" : "Show the full message"}</button>}
                    </div>
                  ) : (
                    <p className="mt-2 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed" style={{ background: C.soft, color: C.sub }}>{it.message.text}</p>
                  )
                )}
              </div>
            )}
          </li>
        );
      })}
      {(more > 0 || showAll) && (
        <li className="relative flex gap-3 sm:gap-4">
          <TimeCol top="" sub="" /><Rail dot={C.line} last />
          {showAll ? (
            <button onClick={() => onShowAll?.(false)} className="pt-0.5 text-left text-[13px] font-medium" style={{ color: C.green }}>Show fewer</button>
          ) : (
            <button onClick={() => onShowAll?.(true)} disabled={loading} className="rounded-lg px-3 py-1.5 text-left text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-[#f0faf7] disabled:opacity-60" style={{ color: C.green, border: `1px solid ${C.line}` }}>
              Show all {more} more{loading ? "…" : ""}
            </button>
          )}
        </li>
      )}
    </ol>
  );
}
const TimeCol = ({ top, sub, strong }: { top: string; sub: string; strong?: boolean }) => (
  <div className="w-[72px] shrink-0 pt-0.5 text-right sm:w-[88px]">
    <div className={`text-[13px] tabular-nums ${strong ? "font-semibold" : "font-medium"}`}>{top}</div>
    <div className="text-[11.5px] tabular-nums" style={{ color: C.sub }}>{sub}</div>
  </div>
);
const Rail = ({ dot, first, last }: { dot: string; first?: boolean; last?: boolean }) => (
  <div className="relative w-3 shrink-0">
    {!last && <span className="absolute left-1/2 top-3 -bottom-4 w-px -translate-x-1/2" style={{ background: C.line }} />}
    <span className="absolute left-1/2 top-1.5 h-3 w-3 -translate-x-1/2 rounded-full" style={{ background: first ? "#fff" : dot, border: first ? `3px solid ${dot}` : "2px solid #fff", boxShadow: `0 0 0 1px ${first ? dot : C.line}` }} />
  </div>
);

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
