"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AGENTS, useStore, type AgentState } from "@/lib/store";
import { AGENT_PROFILES, HANDOFF_FROM, type AgentLook } from "@/lib/agents-data";

/** The office — five rooms, and nothing in them that isn't true.
 *
 *  WHAT WAS WRONG WITH IT. Everything moved on a timer. A boss bubble cycled through four
 *  hard-coded lines ("Mr. Writer, blueprint aa raha hai…") whether or not a blueprint existed;
 *  a chai-walla wandered to a random idle room every twelve seconds; the desk monitors drew
 *  three decorative bars. Give the team an order and the office looked exactly as busy as it
 *  did when the team was asleep — which is the opposite of what an office view is for.
 *
 *  WHAT IT DOES NOW. Every moving thing is tied to a row:
 *
 *    · A lit room     = jobs_log says that agent's job is running right now.
 *    · The wall screen= that agent's real task label, its real progress counter, or the real
 *                       one-line outcome of the last thing it finished.
 *    · A handoff arc  = a job for the next agent in the chain actually started, and the agent
 *                       before it actually ran (lib/office-timeline.ts).
 *    · The run log    = one line per jobs_log row, oldest first, with its real timestamp.
 *    · The wall clock = the tenant's own schedule row, counted down in their own timezone.
 *
 *  The only thing on screen that is not yet a row is the first line of the log after you place
 *  an order, and that is a fact too: the enqueue returned a job id. It is dropped the instant
 *  the database can speak for itself, and expires on its own if the worker never runs.
 */

// Five rooms, laid out big enough to actually read on a laptop: Mr Lxwa in the middle of the
// top row with the two researchers either side, and the two post-writing stages below.
const ROOMS: Record<string, { cx: number; cy: number; w: number; h: number }> = {
  kw:      { cx: 195, cy: 250, w: 300, h: 215 },
  boss:    { cx: 600, cy: 215, w: 420, h: 250 },
  writer:  { cx: 1005, cy: 250, w: 300, h: 215 },
  qa:      { cx: 355, cy: 595, w: 330, h: 230 },
  publish: { cx: 845, cy: 595, w: 330, h: 230 },
};
const VB_W = 1200, VB_H = 800;
const CLOUDS = [[120, 70, 1.1], [520, 45, 0.8], [900, 100, 1.3], [300, 140, 0.7], [1050, 170, 0.9]];

/** How long a handoff arc stays lit after the receiving job started. Long enough to notice at
 *  a 1.2s poll, short enough that it is clearly about the thing that just happened. */
const HANDOFF_MS = 12_000;

const NAME: Record<string, string> = Object.fromEntries(AGENTS.map((a) => [a.id, a.name]));

/** Free-text → agent id, so the chat widget knows which room to focus the camera on. */
export function agentIdFromText(text: string): string | null {
  const l = text.toLowerCase();
  if (/\bwriter\b|\bartic\w*\b|\blikho\b|\bwrite\b|\bdraft\b/.test(l)) return "writer";
  if (/\bkeyword\b|\bresearch\b|\branking\b|\bsearch volume\b/.test(l)) return "kw";
  if (/\bqa\b|\bquality\b|\breview\b|\bgate\b/.test(l)) return "qa";
  if (/\bpublish\b|\bwordpress\b/.test(l)) return "publish";
  if (/\blxwa\b|\bboss\b|\bmain ai\b|\borchestrat|\bplan\b/.test(l)) return "boss";
  return null;
}

function Cloud({ x, y, s, i }: { x: number; y: number; s: number; i: number }) {
  return (
    <g className="office-cloud" style={{ animationDelay: `${i * -9}s`, ["--y" as any]: `${y}px`, transformOrigin: `${x}px ${y}px` }} transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx="0" cy="0" rx="46" ry="18" fill="#fff" opacity="0.9" />
      <ellipse cx="-26" cy="6" rx="28" ry="14" fill="#fff" opacity="0.85" />
      <ellipse cx="28" cy="7" rx="30" ry="15" fill="#fff" opacity="0.85" />
      <ellipse cx="4" cy="-10" rx="24" ry="16" fill="#fff" opacity="0.95" />
    </g>
  );
}
function plant() {
  return (
    <g>
      <ellipse cx="0" cy="16" rx="9" ry="3" fill="#1c2540" opacity="0.14" />
      <rect x="-7" y="5" width="14" height="11" rx="2" fill="#8a5a3c" />
      <ellipse cx="0" cy="-4" rx="14" ry="16" fill="#3fa06b" />
      <ellipse cx="-5" cy="-9" rx="8" ry="10" fill="#4db67d" />
    </g>
  );
}

/* ─────────────────────────── the people ───────────────────────────
 * Five identical figures in five shirt colours told you nothing: zoomed into a room you could
 * not say whose desk you were looking at. Each agent now has its own face, hair, accessory and
 * desk prop, defined once in lib/agents-data.ts so the name tag, the room and any future
 * profile card can't drift apart. */

function Hair({ look }: { look: AgentLook }) {
  const c = look.hair;
  switch (look.hairStyle) {
    case "quiff":
      return <path d="M -14 -9 Q -15 -26 0 -25 Q 13 -25 14 -11 Q 10 -20 -2 -18 Q -11 -17 -14 -9 Z" fill={c} />;
    case "bun":
      return (
        <g fill={c}>
          <circle cx="0" cy="-25" r="6.5" />
          <path d="M -14 -8 Q -14 -23 0 -23 Q 14 -23 14 -8 Q 12 -17 0 -17 Q -12 -17 -14 -8 Z" />
        </g>
      );
    case "cap":
      return (
        <g>
          <path d="M -14 -13 Q -14 -25 0 -25 Q 14 -25 14 -13 Z" fill={c} />
          <rect x="-17" y="-14" width="26" height="3.5" rx="1.7" fill={c} />
        </g>
      );
    case "buzz":
      return <path d="M -13 -10 Q -13 -22 0 -22 Q 13 -22 13 -10 Q 8 -16 0 -16 Q -8 -16 -13 -10 Z" fill={c} opacity="0.92" />;
    default:
      return <path d="M -14 -9 Q -14 -24 0 -24 Q 14 -24 14 -9 Q 14 -15 0 -16 Q -14 -15 -14 -9 Z" fill={c} />;
  }
}

function Wears({ look }: { look: AgentLook }) {
  switch (look.wears) {
    case "glasses":
      return (
        <g stroke="#2b3550" strokeWidth="1.1" fill="none" opacity="0.85">
          <circle cx="-5" cy="-7" r="4" fill="#cfe6ff" fillOpacity="0.35" />
          <circle cx="5" cy="-7" r="4" fill="#cfe6ff" fillOpacity="0.35" />
          <path d="M -1 -7 h 2" />
        </g>
      );
    case "headset":
      return (
        <g fill="none" stroke="#2b3550" strokeWidth="1.6" strokeLinecap="round">
          <path d="M -13 -10 Q 0 -22 13 -10" />
          <rect x="-16" y="-11" width="4.5" height="7" rx="2" fill="#2b3550" stroke="none" />
          <rect x="11.5" y="-11" width="4.5" height="7" rx="2" fill="#2b3550" stroke="none" />
          <path d="M 12 -4 q -2 5 -7 5" />
        </g>
      );
    case "tie":
      return <path d="M 0 6 l 3 3 l -3 12 l -3 -12 Z" fill="#e0538e" />;
    case "visor":
      return (
        <g>
          <rect x="-13" y="-13" width="26" height="4" rx="2" fill="#1f2a44" />
          <path d="M -13 -9 q 13 6 26 0 v -2 h -26 Z" fill="#4a5c82" opacity="0.55" />
        </g>
      );
    default:
      return null;
  }
}

function Prop({ look }: { look: AgentLook }) {
  switch (look.prop) {
    case "magnifier":
      return (
        <g transform="translate(-27,4)" stroke="#2b3550" strokeWidth="1.6" fill="none">
          <circle cx="0" cy="0" r="4.5" fill="#cfe6ff" fillOpacity="0.5" />
          <path d="M 3.4 3.4 L 7 7" strokeLinecap="round" />
        </g>
      );
    case "notebook":
      return (
        <g transform="translate(-27,6)">
          <rect x="-5" y="-4" width="11" height="8" rx="1.4" fill="#efe6d4" />
          <rect x="-5" y="-4" width="3" height="8" rx="1.4" fill="#c9573f" />
        </g>
      );
    case "clipboard":
      return (
        <g transform="translate(-27,5)">
          <rect x="-5" y="-6" width="10" height="12" rx="1.6" fill="#efe6d4" />
          <rect x="-2.5" y="-7.5" width="5" height="3" rx="1.2" fill="#8a97b8" />
          <path d="M -2.5 -1 h 5 M -2.5 2 h 5" stroke="#8a97b8" strokeWidth="1" />
        </g>
      );
    case "outbox":
      return (
        <g transform="translate(-27,6)">
          <rect x="-6" y="0" width="12" height="5" rx="1.4" fill="#8a97b8" />
          <path d="M -4 -1 l 4 -5 l 4 5 Z" fill="#4db67d" />
        </g>
      );
    default:
      return null;
  }
}

function Character({ look, working }: { look: AgentLook; working: boolean }) {
  return (
    <g className={"office-char" + (working ? " is-working" : "")}>
      <ellipse cx="0" cy="34" rx="17" ry="5" fill="#1c2540" opacity="0.18" />
      <g className="office-char-bob">
        <rect x="-13" y="4" width="26" height="26" rx="9" fill={look.shirt} />
        <rect x="-13" y="4" width="26" height="9" rx="7" fill="#fff" opacity="0.22" />
        <circle cx="0" cy="-8" r="14" fill={look.skin} />
        <Hair look={look} />
        <circle cx="-5" cy="-7" r="1.4" fill="#241c1a" /><circle cx="5" cy="-7" r="1.4" fill="#241c1a" />
        <path d="M -4 0 Q 0 2.5 4 0" stroke="#241c1a" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <Wears look={look} />
      </g>
    </g>
  );
}

function Desk({ look, working }: { look: AgentLook; working: boolean }) {
  return (
    <g transform="translate(0,26)">
      <rect x="-42" y="2" width="84" height="13" rx="4" fill="#5c4531" />
      <rect x="-42" y="-2" width="84" height="8" rx="4" fill="#6f5540" />
      <rect x="-36" y="12" width="7" height="16" fill="#4a3628" /><rect x="29" y="12" width="7" height="16" fill="#4a3628" />
      <rect x="-20" y="-26" width="40" height="27" rx="4" fill="#212a40" stroke="#4a5c82" strokeWidth="2" />
      <rect x="-16" y="-22" width="32" height="18" rx="2" fill={working ? "#123832" : "#161c2c"} />
      {working && (
        <g opacity="0.9">
          <rect x="-13" y="-18" width="20" height="2" fill="var(--blu)" opacity="0.9" />
          <rect x="-13" y="-14" width="14" height="2" fill="var(--blu)" opacity="0.6" />
          <rect x="-13" y="-10" width="17" height="2" fill="var(--blu)" opacity="0.45" />
        </g>
      )}
      <Prop look={look} />
    </g>
  );
}

/** The screen on the wall behind each desk — this agent's real work, in words.
 *
 *  This is the "mini monitor per agent" the office was missing. It is never decorative: while
 *  a job runs it shows the task label the enqueuer wrote (with the real done/total counter the
 *  agent reports), and when nothing is running it shows the one-line outcome of the last thing
 *  that agent actually finished. With no history at all it says so. */
function WallScreen({
  x, y, w, h, colour, state, last,
}: {
  x: number; y: number; w: number; h: number; colour: string;
  state: AgentState;
  last: { status: string; summary: string; at: string } | null;
}) {
  const working = state.st === "w";
  const failed = state.st === "e";
  // getAgentRoomStates appends " · 12/40" when the agent reports progress. Splitting it back
  // out is what turns a sentence into a bar you can watch move.
  const m = /^(.*?)\s·\s(\d+)\/(\d+)$/.exec(state.task ?? "");
  const label = m ? m[1] : state.task;
  const done = m ? Number(m[2]) : null;
  const total = m ? Number(m[3]) : null;

  const line = working ? label : failed ? state.task : last ? last.summary : "No work recorded yet.";
  const tone = failed || last?.status === "error" ? "var(--red)" : working ? colour : "var(--mut2)";

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="7" fill="#0e1424" stroke={tone} strokeOpacity={working ? 0.8 : 0.35} strokeWidth="1.6" />
      <rect x={x} y={y} width={w} height="13" rx="7" fill={tone} opacity={working ? 0.22 : 0.1} />
      <circle cx={x + 9} cy={y + 6.5} r="2.4" fill={tone} opacity={working ? 1 : 0.5} className={working ? "office-screen-dot" : undefined} />
      <text x={x + 17} y={y + 9.5} fontSize="7.5" fontWeight="800" fill={tone} letterSpacing="0.4">
        {working ? "WORKING" : failed ? "FAILED" : last ? "LAST JOB" : "IDLE"}
      </text>
      <foreignObject x={x + 6} y={y + 16} width={w - 12} height={h - 22}>
        <div
          {...{ xmlns: "http://www.w3.org/1999/xhtml" }}
          style={{
            font: "600 8.5px/1.35 system-ui, sans-serif", color: working ? "#dfe8ff" : "#93a1c4",
            display: "-webkit-box", WebkitLineClamp: total ? 2 : 3, WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {line}
        </div>
      </foreignObject>
      {total ? (
        <>
          <rect x={x + 6} y={y + h - 9} width={w - 12} height="4" rx="2" fill="#1c2540" />
          <rect x={x + 6} y={y + h - 9} width={Math.max(2, ((w - 12) * (done ?? 0)) / Math.max(1, total))} height="4" rx="2" fill={colour} />
          <text x={x + w - 6} y={y + h - 12} textAnchor="end" fontSize="7" fontWeight="700" fill="#93a1c4">{done}/{total}</text>
        </>
      ) : null}
    </g>
  );
}

function RoomTag({ name, title, task, st }: { name: string; title: string; task: string; st: AgentState["st"] }) {
  // "e" = a real failed job (jobs_log status 'error'), surfaced so a broken agent does not
  // look identical to an idle one.
  const dot = st === "w" ? "var(--grn)" : st === "e" ? "var(--red)" : st === "i" ? "var(--amb)" : "var(--mut2)";
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 9, padding: "5px 11px", whiteSpace: "nowrap", boxShadow: "0 6px 16px #00000033", maxWidth: 276 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, boxShadow: st !== "o" ? `0 0 7px ${dot}` : "none", flex: "none" }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)", flex: "none" }}>{name}</span>
        <span style={{ fontSize: 10, color: "var(--mut2)", flex: "none", borderLeft: "1px solid var(--line)", paddingLeft: 7 }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--mut)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task}</span>
      </div>
    </div>
  );
}

/** "in 3h 12m" / "in 47s" — the schedule board and the run log both need it, and both need it
 *  to keep ticking without a re-render of the whole scene. */
function gap(ms: number): string {
  if (ms <= 0) return "any moment";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const clock = (iso: string) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return ""; }
};

/** `solo` = "show only this agent": every other room fades out and the camera flies to the
 *  one that's left, so clicking Mr. Writer really does hand the whole office over to him.
 *  `onSelect` lets the dashboard own that selection (it also opens the live work panel);
 *  without it Office keeps its old standalone behaviour (camera zoom only). */
export default function Office({ demo = false, solo = null, onSelect, flash = null }: {
  demo?: boolean;
  solo?: string | null;
  onSelect?: (id: string | null) => void;
  /** "this agent just finished X" — shown as a receipt above that room for a few seconds. */
  flash?: { id: string; text: string; tone?: "done" | "error" } | null;
}) {
  const store = useStore();
  // Demo/landing-page state — the marketing page has no tenant and no jobs_log to read, so it
  // shows the rooms lit with a fixed caption. Inside /app nothing takes this path.
  const FAKE = React.useMemo(() => {
    const tasks: Record<string, string> = {
      boss: "Planning this week's topics", kw: "Measuring search volume", writer: "Writing section 4 of 9",
      qa: "Running the quality gate", publish: "Publishing to WordPress",
    };
    return Object.fromEntries(AGENTS.map((a) => [a.id, { st: "w" as const, task: tasks[a.id] ?? "Working" }]));
  }, []);
  const agents = demo || !store ? FAKE : store.s.agents;
  const active = demo ? null : store?.s.focusAgent ?? null;

  const [localFocus, setLocalFocus] = useState<string | null>(null);
  const shownFocus = demo ? localFocus : (solo ?? active);

  const timeline: any[] = demo ? [] : store?.s?.timeline ?? [];
  const handoffs: any[] = demo ? [] : store?.s?.handoffs ?? [];
  const nextRun = demo ? null : store?.s?.nextRun ?? null;
  const run = demo ? null : store?.s?.run ?? null;

  // One ticking clock for the whole scene, rather than one per countdown. Started after mount
  // so the server and the browser can never disagree about what time it is — the hydration
  // error class this file has already had to hunt down once.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /** The last thing each agent actually finished, for its wall screen. */
  const lastByAgent = useMemo(() => {
    const out: Record<string, { status: string; summary: string; at: string }> = {};
    for (const e of timeline) {
      if (e.status === "running" || e.status === "queued") continue;
      out[e.agentId] = { status: e.status, summary: e.summary, at: e.at };
    }
    return out;
  }, [timeline]);

  /** The handoff to animate: the newest one that is still recent. */
  const liveHandoff = useMemo(() => {
    if (now == null) return null;
    const fresh = handoffs.filter((h) => now - new Date(h.at).getTime() < HANDOFF_MS);
    return fresh.length ? fresh[fresh.length - 1] : null;
  }, [handoffs, now]);

  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Camera — imperative transform on the world div, computed from the container's
  // actual measured pixel size (same technique proven in the reference build).
  useEffect(() => {
    const stage = stageRef.current, world = worldRef.current;
    if (!stage || !world) return;
    const id = shownFocus;
    if (!id || !ROOMS[id]) {
      world.style.transformOrigin = "50% 50%";
      world.style.transform = "translate(0,0) scale(1)";
      return;
    }
    const a = ROOMS[id];
    const scale = id === "boss" ? 1.7 : 1.95;
    const w = stage.clientWidth, h = stage.clientHeight;
    const s = Math.min(w / VB_W, h / VB_H);
    const offX = (w - VB_W * s) / 2, offY = (h - VB_H * s) / 2;
    const Px = offX + a.cx * s, Py = offY + a.cy * s;
    world.style.transformOrigin = `${Px}px ${Py}px`;
    world.style.transform = `translate(${w / 2 - Px}px, ${h / 2 - Py}px) scale(${scale})`;
  }, [shownFocus]);

  // The newest line is the one worth reading, so the log stays pinned to the bottom.
  useEffect(() => { logRef.current?.scrollTo({ top: 99999, behavior: "smooth" }); }, [timeline.length, run?.at]);

  const clickRoom = (id: string) => {
    if (demo) { setLocalFocus(f => (f === id ? null : id)); return; }
    if (onSelect) { onSelect(solo === id ? null : id); return; }
    if (!store) return;
    store.focusOn(store.s.focusAgent === id ? null : id, 0); // 0 = pinned until clicked again
  };
  const clickBackground = () => {
    if (demo) { setLocalFocus(null); return; }
    if (onSelect) { onSelect(null); return; }
    store?.focusOn(null);
  };

  const nextAt = nextRun?.at ? new Date(nextRun.at).getTime() : null;

  return (
    <div ref={stageRef} className="office2d" style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "linear-gradient(180deg, var(--bg2) 0%, var(--bg) 55%, var(--panel) 100%)", cursor: shownFocus ? "zoom-out" : "default" }} onClick={clickBackground}>
      <div ref={worldRef} style={{ position: "absolute", inset: 0, transition: "transform 1.1s cubic-bezier(.5,0,.15,1)", willChange: "transform" }}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" style={{ display: "block", position: "absolute", inset: 0 }} preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="bossglow" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#c7e6ff" /><stop offset="45%" stopColor="var(--blu)" /><stop offset="100%" stopColor="var(--blu)" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sunglow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff8e0" stopOpacity="0.95" /><stop offset="100%" stopColor="#fff8e0" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx="1080" cy="70" r="60" fill="url(#sunglow)" />
          {CLOUDS.map((c, i) => <Cloud key={i} x={c[0]} y={c[1]} s={c[2]} i={i} />)}

          {/* The pipeline, drawn as it is actually wired: boss → keyword → writer → quality
              gate → publish (HANDOFF_FROM in lib/agents-data.ts). The old version drew a tube
              from Mr Lxwa to every room with a dot marching along each one at all times, which
              said "everything is flowing" while the office was asleep. These are dim until a
              handoff really happens. */}
          {AGENTS.filter((a) => HANDOFF_FROM[a.id]).map((a) => {
            const from = ROOMS[HANDOFF_FROM[a.id]], to = ROOMS[a.id];
            if (!from || !to) return null;
            const mx = (from.cx + to.cx) / 2, my = (from.cy + to.cy) / 2 - 40;
            const d = `M ${from.cx} ${from.cy} Q ${mx} ${my} ${to.cx} ${to.cy}`;
            const lit = liveHandoff?.to === a.id && liveHandoff?.from === HANDOFF_FROM[a.id];
            return (
              <g key={a.id} opacity={solo ? 0 : 1} style={{ transition: "opacity .5s ease" }}>
                <path d={d} fill="none" stroke={lit ? a.c : "#5fb3e0"} strokeWidth={lit ? 4 : 2.5}
                      opacity={lit ? 0.9 : 0.16} strokeLinecap="round"
                      className={lit ? "office-arc-live" : undefined}
                      style={{ transition: "opacity .4s, stroke-width .4s" }} />
                {lit && (
                  <circle r="6" fill={a.c}>
                    <animateMotion dur="1.15s" repeatCount="indefinite" path={d} />
                  </circle>
                )}
              </g>
            );
          })}

          {/* rooms */}
          {AGENTS.map(a => {
            const r = ROOMS[a.id]; const st = agents[a.id] || { st: "i", task: "Idle" };
            // Adding a sixth agent to AGENTS without a profile should cost you a plain-looking
            // room, not a blank dashboard.
            const profile = AGENT_PROFILES[a.id] ?? {
              title: a.role, brief: "", job: null,
              look: { skin: "#f5cba0", hair: "#332822", hairStyle: "short" as const, shirt: a.c, wears: "none" as const, prop: "none" as const },
            };
            const isBoss = a.id === "boss";
            // Awake = a real job is running (or just failed, which needs attention). Everyone
            // else has the lights off and is asleep — that is the honest picture of an office
            // where one agent is working, and it makes the working one impossible to miss.
            const working = st.st === "w";
            const alarm = st.st === "e";
            const asleep = !working && !alarm;
            const dim = asleep ? (st.st === "o" ? 0.45 : 0.6) : 1;
            const hidden = !!solo && solo !== a.id;
            return (
              <g key={a.id} onClick={e => { e.stopPropagation(); clickRoom(a.id); }}
                 opacity={hidden ? 0 : 1}
                 style={{ cursor: "pointer", transition: "opacity .5s ease", pointerEvents: hidden ? "none" : "auto" }}>
                <ellipse cx={r.cx} cy={r.cy + r.h / 2 + 10} rx={r.w / 2 + 14} ry="13" fill="#1c2540" opacity="0.14" />
                {working && (
                  <rect x={r.cx - r.w / 2 - 6} y={r.cy - r.h / 2 - 6} width={r.w + 12} height={r.h + 12} rx="26"
                    fill="none" stroke={a.c} strokeWidth="2" opacity="0.5" className="office-lit-ring" />
                )}
                {/* The room the order was just handed to, before its first row exists. */}
                {!working && run?.agentId === a.id && (
                  <rect x={r.cx - r.w / 2 - 6} y={r.cy - r.h / 2 - 6} width={r.w + 12} height={r.h + 12} rx="26"
                    fill="none" stroke={a.c} strokeWidth="2" strokeDasharray="10 8" opacity="0.6" className="office-arc-live" />
                )}
                <rect x={r.cx - r.w / 2} y={r.cy - r.h / 2} width={r.w} height={r.h} rx="22"
                  fill={isBoss ? "var(--panel2)" : "var(--panel)"} stroke={alarm ? "var(--red)" : a.c}
                  strokeOpacity={working || alarm ? 1 : 0.35} strokeWidth={working ? 3 : 2.5}
                  opacity={dim} style={{ transition: "opacity .5s, stroke-opacity .5s, stroke-width .5s" }} />
                <rect x={r.cx - r.w / 2} y={r.cy - r.h / 2} width={r.w} height={r.h * 0.35} rx="22" fill="var(--line)" opacity={dim * 0.35} />
                {working && (
                  <rect x={r.cx - r.w / 2} y={r.cy - r.h / 2} width={r.w} height={r.h} rx="22"
                    fill={a.c} opacity="0.09" className="office-lit-wash" />
                )}
                {asleep && (
                  <rect x={r.cx - r.w / 2} y={r.cy - r.h / 2} width={r.w} height={r.h} rx="22"
                    fill="#050a18" opacity={st.st === "o" ? 0.55 : 0.4}
                    style={{ transition: "opacity .5s" }} />
                )}

                {/* Every room gets the same screen, boss included — "what is Mr Lxwa doing"
                    was exactly as unanswerable as it was for everyone else. */}
                <WallScreen
                  x={r.cx - (isBoss ? 92 : 78)} y={r.cy - r.h / 2 + 18}
                  w={isBoss ? 184 : 156} h={isBoss ? 62 : 56}
                  colour={a.c} state={st} last={lastByAgent[a.id] ?? null}
                />

                {isBoss ? (
                  <g transform={`translate(${r.cx},${r.cy + 58})`}>
                    <circle r="46" fill="url(#bossglow)" className="office-orb-glow" />
                    <circle r="30" fill="none" stroke="var(--blu)" strokeWidth="1.5" opacity="0.55" className="office-ring" />
                    <circle r="21" fill="none" stroke="var(--blu)" strokeWidth="1" opacity="0.4" strokeDasharray="4 6" className="office-ring2" />
                    <g transform="translate(0,-4) scale(0.92)">
                      <Character look={profile.look} working={working} />
                    </g>
                  </g>
                ) : (
                  <>
                    <g transform={`translate(${r.cx - r.w / 2 + 34},${r.cy + r.h / 2 - 34}) scale(1.1)`} opacity={dim * 0.9}>{plant()}</g>
                    <g transform={`translate(${r.cx},${r.cy + r.h / 2 - 62}) scale(1.3)`} opacity={dim} style={{ transition: "opacity .4s" }}>
                      <Desk look={profile.look} working={working} />
                      <g transform="translate(0,-58)"><Character look={profile.look} working={working} /></g>
                    </g>
                  </>
                )}

                {asleep && !isBoss && (
                  <g className="office-zzz" style={{ transformOrigin: `${r.cx + r.w / 2 - 30}px ${r.cy - r.h / 2 + 24}px` }}>
                    <text x={r.cx + r.w / 2 - 30} y={r.cy - r.h / 2 + 24} fontSize="13" fontWeight="800" fill="#8f9dc4">z</text>
                    <text x={r.cx + r.w / 2 - 20} y={r.cy - r.h / 2 + 16} fontSize="10" fontWeight="800" fill="#8f9dc4" opacity="0.75">z</text>
                    <text x={r.cx + r.w / 2 - 13} y={r.cy - r.h / 2 + 10} fontSize="8" fontWeight="800" fill="#8f9dc4" opacity="0.5">z</text>
                  </g>
                )}
                {/* a job that just finished pops a receipt over the room that did it */}
                {flash && flash.id === a.id && (
                  <foreignObject x={r.cx - 130} y={r.cy - r.h / 2 - 84} width="260" height="52">
                    <div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} style={{ display: "flex", justifyContent: "center" }}>
                      <div className="office-flash" style={{ background: "var(--panel2)", border: `1px solid ${flash.tone === "error" ? "var(--red)" : "var(--grn)"}`, color: "var(--ink)", fontSize: 10.5, fontWeight: 700, padding: "7px 11px", borderRadius: 10, boxShadow: "0 10px 26px #00000066", textAlign: "center", lineHeight: 1.35 }}>
                        {flash.tone === "error" ? "⚠ " : "✓ "}{flash.text}
                      </div>
                    </div>
                  </foreignObject>
                )}

                <foreignObject x={r.cx - 145} y={r.cy - r.h / 2 - 38} width="290" height="34">
                  <RoomTag name={a.name} title={profile.title} task={st.task} st={st.st} />
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="office-hud">
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--grn)", boxShadow: "0 0 8px var(--grn)" }} className="office-pulse-dot" />
          Your office — live
        </div>
        <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 2 }}>{shownFocus ? "Click anywhere to come back" : "Click a room to watch that agent work"}</div>
      </div>

      {/* The clock on the office wall. Reads the tenant's own schedules row — when automation
          is off it says so rather than showing a countdown to nothing. */}
      {!demo && nextRun && (
        <div className="office-board">
          <div className="ob-h">Next automatic run</div>
          {nextRun.enabled && nextAt ? (
            <>
              <div className="ob-t">{now == null ? "…" : gap(nextAt - now)}</div>
              <div className="ob-s">
                {new Intl.DateTimeFormat("en-GB", { timeZone: nextRun.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(nextAt))} · {nextRun.timezone}
              </div>
              <div className="ob-s">
                {nextRun.count} article{nextRun.count === 1 ? "" : "s"} · {nextRun.autoPublish ? "publishes straight to your site" : "lands in Approvals"}
              </div>
            </>
          ) : (
            <div className="ob-s">Automation is off — nothing runs by itself.</div>
          )}
        </div>
      )}

      {/* The run log. One line per real jobs_log row, oldest first, with the time it started.
          This is what "Mr Lx planning… assigned to Mr. Writer… Mr. Writer accepted" was asking
          for, and every line of it is answerable from the database. */}
      {!demo && (timeline.length > 0 || run) && (
        <div className="office-log" onClick={(e) => e.stopPropagation()}>
          <div className="ol-h">
            <span className="ol-dot" />
            Run log
            <span className="ol-c">{timeline.length + (run ? 1 : 0)}</span>
          </div>
          <div className="ol-body" ref={logRef}>
            {timeline.map((e) => {
              const tone = e.status === "error" ? "err" : e.status === "running" || e.status === "queued" ? "live" : e.status === "skipped" ? "warn" : "ok";
              return (
                <div key={e.id} className={"ol-row is-" + tone}>
                  <span className="ol-time">{clock(e.at)}</span>
                  <span className="ol-name">{e.name}</span>
                  <span className="ol-what">
                    {e.from && <em>accepted from {NAME[e.from] ?? e.from} · </em>}
                    {e.status === "running" || e.status === "queued" ? e.task : e.summary}
                  </span>
                </div>
              );
            })}
            {run && (
              <div className="ol-row is-live">
                <span className="ol-time">{now == null ? "" : new Date(run.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <span className="ol-name">{NAME[run.agentId] ?? run.agentId}</span>
                <span className="ol-what">{run.label}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx global>{`
        .office2d .office-char.is-working .office-char-bob { animation: office-bob .76s ease-in-out infinite; transform-origin: center bottom; }
        @keyframes office-bob { 0%,100%{ transform: translateY(0); } 50%{ transform: translateY(-2px); } }
        .office-orb-glow { animation: office-glow 3s ease-in-out infinite; transform-origin: center; }
        @keyframes office-glow { 50%{ transform: scale(1.08); opacity: .85; } }
        .office-ring { animation: office-rot 10s linear infinite; transform-origin: center; }
        .office-ring2 { animation: office-rot 14s linear infinite reverse; transform-origin: center; }
        @keyframes office-rot { to{ transform: rotate(360deg); } }
        .office-cloud { animation: office-drift 90s linear infinite; }
        @keyframes office-drift { from{ transform: translate(-60px, var(--y, 0px)); } to{ transform: translate(1320px, var(--y, 0px)); } }
        .office-pulse-dot { animation: office-pulse 2s infinite; }
        .office2d .office-lit-ring { animation: office-lit 2.2s ease-in-out infinite; }
        @keyframes office-lit { 50%{ opacity: .16; } }
        .office2d .office-lit-wash { animation: office-wash 2.2s ease-in-out infinite; }
        @keyframes office-wash { 50%{ opacity: .16; } }
        .office2d .office-arc-live { animation: office-arc 1.4s ease-in-out infinite; }
        @keyframes office-arc { 50%{ opacity: .4; } }
        .office2d .office-screen-dot { animation: office-pulse 1.4s infinite; }
        .office2d .office-zzz { animation: office-sleep 3.4s ease-in-out infinite; }
        @keyframes office-sleep { 0%,100%{ opacity: .25; transform: translateY(2px); } 50%{ opacity: .9; transform: translateY(-4px); } }
        .office2d .office-flash { animation: office-flash-in .35s cubic-bezier(.2,.7,.3,1); }
        @keyframes office-flash-in { from{ opacity: 0; transform: translateY(8px) scale(.96); } to{ opacity: 1; transform: none; } }
        @keyframes office-pulse { 50%{ opacity: .4; } }
        @media (prefers-reduced-motion: reduce) {
          .office2d * { animation: none !important; transition: none !important; }
        }
      `}</style>

      <style jsx>{`
        .office-hud { position: absolute; left: clamp(10px, 1.6vw, 18px); top: clamp(10px, 1.6vw, 16px);
                      pointer-events: none; z-index: 2; max-width: 55%; }

        .office-board { position: absolute; right: clamp(10px, 1.6vw, 18px); top: clamp(10px, 1.6vw, 16px);
                        z-index: 3; background: var(--panel); border: 1px solid var(--line);
                        border-radius: 12px; padding: 9px 13px; min-width: 168px; max-width: 46%;
                        box-shadow: 0 10px 26px #00000033; }
        .ob-h { font-size: 9px; font-weight: 800; letter-spacing: .6px; text-transform: uppercase;
                color: var(--mut2); }
        .ob-t { font-size: 19px; font-weight: 800; color: var(--ink); margin-top: 2px;
                font-variant-numeric: tabular-nums; line-height: 1.1; }
        .ob-s { font-size: 10.5px; color: var(--mut); margin-top: 3px; line-height: 1.4; }

        /* Docked to the bottom of the office frame, never over the rooms' name tags. It has
           its own scroll so a long run cannot push the office out of the viewport. */
        .office-log { position: absolute; left: 0; right: 0; bottom: 0; z-index: 4;
                      background: color-mix(in srgb, var(--panel) 92%, transparent);
                      border-top: 1px solid var(--line); backdrop-filter: blur(6px);
                      max-height: 38%; display: flex; flex-direction: column; }
        .ol-h { display: flex; align-items: center; gap: 7px; padding: 7px 13px 5px;
                font-size: 10px; font-weight: 800; letter-spacing: .5px; text-transform: uppercase;
                color: var(--mut2); flex: none; }
        .ol-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--grn);
                  box-shadow: 0 0 7px var(--grn); animation: office-pulse 2s infinite; }
        .ol-c { margin-left: auto; font-weight: 700; color: var(--mut); letter-spacing: 0; }
        .ol-body { overflow-y: auto; padding: 0 13px 9px; display: flex; flex-direction: column; gap: 3px; }
        .ol-row { display: grid; grid-template-columns: 62px 92px 1fr; gap: 9px; align-items: baseline;
                  font-size: 11px; line-height: 1.45; padding: 3px 0;
                  border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
        .ol-row:first-child { border-top: none; }
        .ol-time { color: var(--mut2); font-variant-numeric: tabular-nums; font-size: 10px; }
        .ol-name { color: var(--ink); font-weight: 700; overflow: hidden; text-overflow: ellipsis;
                   white-space: nowrap; }
        .ol-what { color: var(--mut); min-width: 0; overflow-wrap: anywhere; }
        .ol-what em { font-style: normal; color: var(--mut2); }
        .ol-row.is-live .ol-name { color: var(--ac); }
        .ol-row.is-live .ol-what::after { content: "…"; }
        .ol-row.is-err .ol-name, .ol-row.is-err .ol-what { color: var(--red); }
        .ol-row.is-warn .ol-name { color: var(--amb); }

        /* Phone: the countdown still matters, so it shrinks rather than disappearing, and the
           log drops the fixed time/name columns that a 360px screen cannot afford. */
        @media (max-width: 720px) {
          .office-hud { max-width: 48%; }
          .office-board { padding: 7px 10px; min-width: 0; max-width: 44%; border-radius: 10px; }
          .ob-t { font-size: 15px; }
          .ob-s { font-size: 9.5px; }
          .ob-s + .ob-s { display: none; }
          .office-log { max-height: 46%; }
          .ol-body { padding: 0 11px 8px; }
          .ol-row { grid-template-columns: 50px 1fr; column-gap: 8px; row-gap: 0; font-size: 10.5px; }
          .ol-time { grid-row: span 2; }
          .ol-name, .ol-what { grid-column: 2; }
        }
      `}</style>
    </div>
  );
}
