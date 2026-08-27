"use client";
/**
 * components/Workspace.tsx — the Agent Workspace (MASTER_PLAN §24.4b).
 *
 * The v3 decision: the pixel office stops being the default and becomes a theme. What a
 * customer opens is the pattern every 2026 agent product converged on — orders on the left,
 * and on the right a large panel where the agent's *real output* is built in front of them:
 * the keyword table filling row by row, the document assembling heading by heading, the image
 * resolving, the gauge moving. Under it, a timeline strip and a clock.
 *
 * Everything on this screen is a function of `TaskState` from `lib/live.ts`. That matters more
 * than it sounds: **replay and live are the same code path**. Replay does not re-render a
 * recording differently — it folds the recorded events through the same reducer with a faster
 * clock and hands the resulting `TaskState` to these same components. If a replay ever looked
 * different from the live run, the recording would be wrong, and that is worth finding out.
 *
 * ── the §24.5 rules, and where each one actually lives ────────────────────────────────────
 *
 *   "animation sirf event pe chale"   → `flowing`, computed once here from
 *                                       `isFlowing(task, now)` (live) or `replay.playing`
 *                                       (replay), threaded into every renderer. The evidence
 *                                       clock is `task.lastEventAt`, which only a real arrival
 *                                       moves. When it stops, so does the screen.
 *   "agent ruka hai to screen bhi     → `<Stalled/>`: a running task whose last event is older
 *    ruki dikhe, wajah ke saath"        than STALL_MS says how long it has been quiet, and
 *                                       shows the step's own reason when it has one.
 *   "mat dikhao: raw prompts, model   → no renderer draws an unrecognised nested object
 *    ka reasoning, doosre tenants"      (`visibleEntries` denylist); the hook drops any
 *                                       broadcast whose tenant_id is not ours; the reads run
 *                                       under RLS as the signed-in user.
 *   "sach hi dikhao"                  → every sentence on this screen comes from
 *                                       `task.lines`, which `foldEvents` fills only from
 *                                       `message_user`. This file contains no template about
 *                                       what an agent "is doing". Names, column headers and
 *                                       status words are chrome; they make no claim.
 */

import { useEffect, useMemo, useState } from "react";
import KindBlock from "@/components/WorkspaceRenderers";
import {
  useLiveEvents,
  useReplay,
  isFlowing,
  isTerminalTask,
  isTerminalStep,
  elapsedMs,
  clock,
  useNow,
  STALL_MS,
  POLL_MS,
  type TaskState,
  type StepState,
  type TaskStatus,
  type Connection,
} from "@/lib/live";

/* ── chrome: names and words, never claims ─────────────────────────────────────────────── */

/** Straight from `agent-server/src/brain/manifests.ts`. A name is not a statement about what
 *  the agent is doing; when we do not have one, the id itself is shown rather than guessed at. */
const AGENT_LABEL: Record<string, string> = {
  boss: "Mr Lxwa",
  crawler: "Mr. Crawler",
  analyst: "Mr. Analyst",
  keyword: "Mr. Keyword",
  writer: "Mr. Writer",
  seo: "Mr. SEO",
  qa: "Mr. QA",
  publish: "Mr. Publish",
  social: "Mr. Social",
  leads: "Mr. Lead",
  image: "Mr. Image",
};
const agentName = (id: string) => AGENT_LABEL[id] ?? id;

const STATUS_WORD: Record<TaskStatus, string> = {
  awaiting_confirm: "Needs your yes",
  queued: "Queued",
  scheduled: "Scheduled",
  running: "Working",
  choosing: "Choosing",
  awaiting_approval: "Waiting for you",
  done: "Done",
  published: "Published",
  failed: "Stopped",
  needs_attention: "Needs you",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<TaskStatus, string> = {
  awaiting_confirm: "wait",
  queued: "draft",
  scheduled: "draft",
  running: "run",
  choosing: "run",
  awaiting_approval: "wait",
  done: "pub",
  published: "pub",
  failed: "fail",
  needs_attention: "fail",
  cancelled: "off",
};

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * The screen
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export default function Workspace({ tenantId }: { tenantId: string | null }) {
  const live = useLiveEvents(tenantId);
  const replay = useReplay(tenantId, live.source);

  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("activity");
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  // First load picks the newest order. After that the choice is the user's and nothing steals
  // it — a new task arriving mid-read must not yank the panel away.
  useEffect(() => {
    if (!selected && live.tasks.length) setSelected(live.tasks[0].task_id);
  }, [live.tasks, selected]);

  const liveTask: TaskState | null = selected ? live.byTask[selected] ?? null : null;
  const replaying = !!replay.taskId;
  const task: TaskState | null = replaying ? replay.task : liveTask;

  // The clock ticks only while something is genuinely moving, so a finished order's screen is
  // a still image in the DOM as well as to the eye.
  const anyRunning = live.tasks.some((t) => !isTerminalTask(t.status));
  const now = useNow(anyRunning || replay.playing);

  const flowing = replaying ? replay.playing : isFlowing(task, now);
  const quietFor = task && task.lastEventAt ? Math.max(0, now - task.lastEventAt) : 0;

  const panes = useMemo(() => (task?.agents ?? []).filter((a) => a.items.length > 0), [task]);

  // A tab that no longer exists (order switched, replay scrubbed back before the agent ran)
  // falls back to Activity rather than rendering nothing.
  useEffect(() => {
    if (tab !== "activity" && !panes.some((p) => p.agent_id === tab)) setTab("activity");
  }, [panes, tab]);

  const choose = (id: string) => {
    replay.close();
    setSelected(id);
    setOpenStep(null);
    setRailOpen(false);
    live.loadTask(id);
  };

  /* ── the states that are not the happy path ─────────────────────────────────────────── */

  if (!tenantId) {
    return (
      <div className="ws-solo card">
        <h2 className="pg-h2">You are not signed in to a workspace</h2>
        <p className="mut sm">Sign in again and this screen will show your team working.</p>
      </div>
    );
  }

  if (live.loading && !live.tasks.length) {
    return (
      <div className="ws-solo card">
        <h2 className="pg-h2">Reading your orders…</h2>
        <p className="mut sm">Fetching this workspace&rsquo;s tasks and the recording of the most recent one.</p>
      </div>
    );
  }

  if (live.error && !live.tasks.length) {
    return (
      <div className="ws-solo card">
        <h2 className="pg-h2">Could not reach the brain</h2>
        <p className="mut sm">
          The workspace could not read your orders. It said: <b className="brk">{live.error}</b>
        </p>
        <div className="btnrow" style={{ marginTop: 14 }}>
          <button className="btn btn-p btn-sm" onClick={live.reload}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!live.tasks.length) {
    return (
      <div className="ws-solo card">
        <h2 className="pg-h2">No orders yet</h2>
        <p className="mut sm">
          This screen fills up the moment you give the team something to do. Open the chat and type an order — for
          example:
        </p>
        <ul className="ws-examples">
          <li>solar panels pe ek article likho</li>
          <li>ISO 27001 ke liye keywords nikalo</li>
          <li>kal subah 9 baje ek article publish kar do</li>
        </ul>
        <p className="mut xs">
          Every step the team takes then appears here, as it happens, and stays as a recording you can replay.
        </p>
      </div>
    );
  }

  /* ── the workspace ──────────────────────────────────────────────────────────────────── */

  return (
    <div className={"ws" + (railOpen ? " rail-open" : "")}>
      <button className="ws-scrim" aria-label="Close orders" tabIndex={railOpen ? 0 : -1} onClick={() => setRailOpen(false)} />

      {/* ── left: the orders ── */}
      <aside className="ws-rail">
        <div className="ws-rail-h">
          <span className="ws-kicker">Orders</span>
          <ConnectionChip state={live.connected} />
        </div>
        <div className="ws-rail-list">
          {live.tasks.map((t) => (
            <button
              key={t.task_id}
              className={"ws-task" + (t.task_id === selected ? " is-on" : "")}
              onClick={() => choose(t.task_id)}
            >
              <span className="ws-task-top">
                <span className={"pillst st-" + STATUS_TONE[t.status]}>{STATUS_WORD[t.status] ?? t.status}</span>
                <span className="ws-task-time">{clock(elapsedMs(t, now))}</span>
              </span>
              <span className="ws-task-echo">{t.echo ?? t.kind ?? "Order"}</span>
              <MiniDots steps={t.steps} />
            </button>
          ))}
        </div>
        {live.error && <p className="ws-rail-err">{live.error}</p>}
      </aside>

      {/* ── right: the live panel ── */}
      <section className="ws-main">
        <header className="ws-head">
          <button className="ws-rail-btn" onClick={() => setRailOpen(true)} aria-label="Show orders">
            ☰
          </button>
          <div className="ws-head-t">
            <h1 className="ws-h1 brk">{task?.echo ?? task?.kind ?? "Order"}</h1>
            <div className="ws-head-sub">
              {task && <span className={"pillst st-" + STATUS_TONE[task.status]}>{STATUS_WORD[task.status] ?? task.status}</span>}
              <span className="ws-elapsed">{clock(elapsedMs(task, now))}</span>
              {replaying && <span className="ws-tag ws-tag-live">replay</span>}
              {!replaying && flowing && <span className="ws-tag ws-tag-live is-flowing">live</span>}
            </div>
          </div>
          {selected && !replaying && (
            <button className="btn btn-g btn-sm" onClick={() => replay.open(selected)} title="Replay this order from its recording, 10× speed">
              ▶ Replay
            </button>
          )}
          {replaying && (
            <button className="btn btn-g btn-sm" onClick={replay.close}>
              Back to live
            </button>
          )}
        </header>

        {live.connected === "polling" && !replaying && (
          <p className="ws-banner">
            Live channel not connected — checking every {POLL_MS / 1000} seconds instead. Steps and status are
            up to date; items an agent sends between checks appear on the next one.
          </p>
        )}
        {live.connected === "connecting" && !replaying && <p className="ws-banner">Connecting to the live channel…</p>}
        {replay.error && <p className="ws-banner is-err">{replay.error}</p>}

        {/* tabs: one per agent that has produced something, plus the activity log */}
        <nav className="ws-tabs scroll-x" role="tablist">
          <button role="tab" aria-selected={tab === "activity"} className={"ws-tab" + (tab === "activity" ? " is-on" : "")} onClick={() => setTab("activity")}>
            Activity
          </button>
          {panes.map((p) => (
            <button
              key={p.agent_id}
              role="tab"
              aria-selected={tab === p.agent_id}
              className={"ws-tab" + (tab === p.agent_id ? " is-on" : "") + " st-" + p.status}
              onClick={() => setTab(p.agent_id)}
            >
              <i className="ws-tab-dot" />
              {agentName(p.agent_id)}
              <span className="ws-count">{p.items.length}</span>
            </button>
          ))}
        </nav>

        <div className="ws-body">
          {task && !flowing && !isTerminalTask(task.status) && task.lastEventAt > 0 && quietFor >= STALL_MS && (
            <Stalled task={task} quietFor={quietFor} />
          )}

          {tab === "activity" ? (
            <Activity task={task} flowing={flowing} />
          ) : (
            (() => {
              const pane = panes.find((p) => p.agent_id === tab);
              if (!pane) return null;
              return (
                <>
                  {pane.kinds.map((kind) => (
                    <KindBlock key={kind} kind={kind} items={pane.items.filter((i) => i.kind === kind)} flowing={flowing} />
                  ))}
                </>
              );
            })()
          )}
        </div>

        {/* ── the timeline strip ── */}
        <footer className="ws-strip">
          <Timeline steps={task?.steps ?? []} flowing={flowing} openStep={openStep} onOpen={setOpenStep} />
          {replaying ? (
            <ReplayBar replay={replay} />
          ) : (
            <span className="ws-strip-time">{clock(elapsedMs(task, now))}</span>
          )}
        </footer>

        {openStep && task && <StepDetail step={task.steps.find((s) => s.key === openStep) ?? null} onClose={() => setOpenStep(null)} />}
      </section>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * pieces
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

function ConnectionChip({ state }: { state: Connection }) {
  const label =
    state === "live" ? "live" : state === "polling" ? `every ${POLL_MS / 1000}s` : state === "connecting" ? "connecting" : "offline";
  return (
    <span className={"ws-conn is-" + state} title={
      state === "live"
        ? "Subscribed to this workspace's live channel."
        : state === "polling"
        ? "The live channel is not connected, so the workspace is re-reading the order every few seconds."
        : "Opening the live channel."
    }>
      <i />
      {label}
    </span>
  );
}

/** §24.5, verbatim: "Agent ruka hai to screen bhi ruki dikhe, 'ruk gaya: wajah' ke saath."
 *  The screen has already stopped by the time this renders — `flowing` is false, so every
 *  animation is off. This is the part that says so in words. */
function Stalled({ task, quietFor }: { task: TaskState; quietFor: number }) {
  const running = task.steps.find((s) => s.status === "running");
  const reason = running?.reason ?? task.reason;
  return (
    <div className="ws-stall">
      <b>Waiting</b>
      <span>
        Nothing new for {Math.round(quietFor / 1000)}s
        {running ? ` — ${agentName(running.agent_id)} has not sent an update since it started` : ""}.
      </span>
      {reason && <span className="ws-stall-why brk">{reason}</span>}
    </div>
  );
}

/** The Activity tab: the sentences, and nothing else. Every one of them came out of
 *  `userMessage()` on the server or out of `task_events.message_user`. */
function Activity({ task, flowing }: { task: TaskState | null; flowing: boolean }) {
  if (!task) return null;
  const hasArtifacts = task.agents.some((a) => a.items.length > 0);
  return (
    <div className="ws-block">
      {task.outline.length > 0 && (
        <div className="ws-outline">
          <span className="ws-kicker">Plan</span>
          <ol>
            {task.outline.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ol>
        </div>
      )}

      <ul className="ws-lines">
        {task.lines.map((l) => (
          <li key={l.key} className={"ws-line tone-" + l.tone}>
            <span className="ws-line-t">{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            {l.agent_id && <span className="ws-line-a">{agentName(l.agent_id)}</span>}
            <span className="brk">{l.text}</span>
          </li>
        ))}
        {!task.lines.length && <li className="ws-muted">Nothing has been said about this order yet.</li>}
      </ul>

      {!hasArtifacts && (
        <p className="ws-note">
          No agent has sent an artifact for this order yet. When one does — a keyword, a section, an image, a
          score — it gets its own tab above and is drawn here as it arrives.
          {flowing ? "" : " The order is not producing anything right now."}
        </p>
      )}
    </div>
  );
}

/** The steps as dots: current one active, failed ones red and clickable for the reason.
 *  The pulse on the running dot is gated on `flowing` — a step that is "running" but silent
 *  gets a still dot, because a pulsing one would be a claim. */
function Timeline({
  steps,
  flowing,
  openStep,
  onOpen,
}: {
  steps: StepState[];
  flowing: boolean;
  openStep: string | null;
  onOpen: (k: string | null) => void;
}) {
  if (!steps.length) return <div className="ws-dots ws-dots-empty">no steps yet</div>;
  return (
    <ol className={"ws-dots" + (flowing ? " is-flowing" : "")}>
      {steps.map((s, i) => (
        <li key={s.key}>
          {i > 0 && <i className={"ws-link" + (isTerminalStep(s.status) || s.status === "running" ? " is-done" : "")} />}
          <button
            className={"ws-dot st-" + s.status + (openStep === s.key ? " is-open" : "")}
            onClick={() => onOpen(openStep === s.key ? null : s.key)}
            title={`${agentName(s.agent_id)} — ${s.status}`}
            aria-label={`${agentName(s.agent_id)} — ${s.status}`}
          >
            {s.status === "done" ? "✓" : s.status === "failed" ? "!" : s.status === "skipped" ? "–" : ""}
            {s.status === "running" && s.fraction != null && (
              <i className="ws-dot-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, s.fraction))})` }} />
            )}
          </button>
          <span className="ws-dot-l">{agentName(s.agent_id)}</span>
        </li>
      ))}
    </ol>
  );
}

function StepDetail({ step, onClose }: { step: StepState | null; onClose: () => void }) {
  if (!step) return null;
  return (
    <div className={"ws-detail st-" + step.status} role="status">
      <div className="ws-detail-h">
        <b>{agentName(step.agent_id)}</b>
        <span className="ws-muted">{step.action ?? ""}</span>
        <button className="iconbtn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {/* Sentences only from the event stream. `label` is the agent's own step label, which the
          brain's userMessage() already blesses as user-facing; `reason` is a message_user. */}
      {step.label && <p className="ws-detail-p brk">{step.label}</p>}
      {step.progressLabel && <p className="ws-detail-p ws-muted brk">{step.progressLabel}</p>}
      {step.reason && <p className="ws-detail-p ws-detail-why brk">{step.reason}</p>}
      <div className="ws-detail-facts">
        <span>{step.status}</span>
        {step.ms != null && <span>{(step.ms / 1000).toFixed(1)}s</span>}
        {step.optional && <span>optional</span>}
        {step.fraction != null && step.status === "running" && <span>{Math.round(step.fraction * 100)}%</span>}
      </div>
    </div>
  );
}

function MiniDots({ steps }: { steps: StepState[] }) {
  if (!steps.length) return null;
  return (
    <span className="ws-mini">
      {steps.slice(0, 8).map((s) => (
        <i key={s.key} className={"st-" + s.status} />
      ))}
    </span>
  );
}

function ReplayBar({ replay }: { replay: ReturnType<typeof useReplay> }) {
  const { playing, position, duration, speed, count } = replay;
  return (
    <div className="ws-replay">
      <button className="ws-play" onClick={replay.toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        className="ws-scrub"
        type="range"
        min={0}
        max={Math.max(1, duration)}
        value={Math.min(position, duration)}
        onChange={(e) => replay.seek(Number(e.target.value))}
        aria-label="Scrub the recording"
      />
      <span className="ws-strip-time">
        {clock(position)} / {clock(duration)}
      </span>
      <select className="ws-speed" value={speed} onChange={(e) => replay.setSpeed(Number(e.target.value))} aria-label="Replay speed">
        <option value={1}>1×</option>
        <option value={5}>5×</option>
        <option value={10}>10×</option>
        <option value={25}>25×</option>
      </select>
      <span className="ws-muted xs">{count} events</span>
    </div>
  );
}
