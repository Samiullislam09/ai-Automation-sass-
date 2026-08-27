"use client";
/**
 * lib/live.ts — the browser's side of the live channel (MASTER_PLAN §24).
 *
 * The server half already exists and is the authority: `agent-server/src/brain/events.ts`
 * broadcasts every event on `tenant:{id}:live` (Supabase Realtime, event name `"live"`) and
 * writes the same event into `task_events` as the recording. This file does three things and
 * nothing else:
 *
 *   1. `foldEvents(state, event)` — a PURE reducer. Events in, a small typed state machine
 *      out. No React, no browser, no Supabase: it is the thing `lib/live.test.ts` runs.
 *   2. `useLiveEvents(tenantId)` — subscribes, hydrates, reconnects, and falls back to
 *      polling when Realtime will not connect.
 *   3. `useReplay(...)` — plays a finished task's recording back through *the same reducer*.
 *      Replay and live are not two renderers; they are one reducer with two clocks.
 *
 * THE HONESTY RULES (§24.5) THIS FILE OWNS:
 *
 *   - **A sentence a person reads is never written by an agent.** `userMessage()` below is a
 *     faithful mirror of the brain's own `userMessage()` — the same switch, the same nulls.
 *     `data`, `log`, `run_started`, `run_finished` and `step_finished` deliberately produce no
 *     sentence: they are structure, drawn as a row appearing or a gauge moving. A `log` event
 *     is the do-channel rule in miniature — it carries a developer string and it must never
 *     become something a customer reads.
 *   - **No other tenant's anything.** Every incoming broadcast is checked against the tenant
 *     id we subscribed with before it reaches the reducer; the reads go through the browser
 *     client, so RLS (`is_tenant_member`) is the second lock.
 *   - **`lastEventAt` is the evidence clock.** The UI freezes every animation when it stops
 *     moving. That number is the only thing standing between "live" and "fake typing", so it
 *     is set by real arrivals only — never by a timer.
 *
 * WHY THE READS DO NOT GO STRAIGHT TO `/brain/tasks/:id`. Those routes exist and are the
 * documented shape, but they are authed with the shared `x-agent-token`, which cannot be in a
 * browser bundle, and this change is not allowed to add an API route to proxy it. So the
 * default `WorkspaceSource` reads `tasks` / `task_steps` / `task_events` directly through the
 * browser Supabase client, where the RLS policies in migration 017 already scope every row to
 * the caller's tenant — the same rows, the same shape, one less hop. `httpSource()` is here
 * and returns the identical shape, so the day a proxy exists the swap is one line.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "./supabase/client";

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 1 · The wire format
 *
 * Mirrors `agent-server/src/vendor/agent-contract/events.ts` and the `TaskEvent` union in
 * `agent-server/src/brain/events.ts`. It is copied rather than imported because tsconfig.json
 * excludes `agent-server` and `packages` from the web app's program — the two must be kept in
 * step by hand, which is why every field below is spelled out instead of widened to `any`.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface EventBase {
  run_id: string;
  tenant_id: string;
  agent_id: string;
  /** ISO-8601. */
  at: string;
}

export type AgentEvent =
  | (EventBase & { type: "run_started"; action: string })
  | (EventBase & { type: "step_started"; step_id: string; label: string })
  | (EventBase & { type: "step_finished"; step_id: string; ms: number })
  | (EventBase & { type: "progress"; step_id?: string; fraction: number; label?: string })
  | (EventBase & { type: "data"; step_id?: string; kind: string; payload: unknown })
  | (EventBase & { type: "log"; step_id?: string; level: LogLevel; message_dev: string })
  | (EventBase & {
      type: "run_finished";
      output: unknown;
      ms: number;
      cost_units: number;
      llm_calls: number;
      tokens_in: number;
      tokens_out: number;
    })
  | (EventBase & { type: "run_error"; message: string; retryable: boolean; ms: number });

export type TaskEvent =
  | { type: "task_created"; task_id: string; tenant_id: string; at: string; echo: string; outline: string[] }
  | { type: "task_confirmed"; task_id: string; tenant_id: string; at: string }
  | { type: "task_scheduled"; task_id: string; tenant_id: string; at: string; run_at: string; human: string }
  | { type: "task_started"; task_id: string; tenant_id: string; at: string; steps: number }
  | { type: "task_finished"; task_id: string; tenant_id: string; at: string; status: string; ms: number }
  | { type: "task_failed"; task_id: string; tenant_id: string; at: string; message: string; step_no?: number }
  | { type: "task_cancelled"; task_id: string; tenant_id: string; at: string; by: "user" | "system" }
  | { type: "step_skipped"; task_id: string; tenant_id: string; at: string; step_no: number; agent_id: string; why: string };

export type LiveEvent = (AgentEvent & { task_id: string }) | TaskEvent;

/** What the reducer actually accepts: a `LiveEvent` plus the two things only the recording
 *  knows. `message_user` is the sentence the brain already decided on and wrote to the row —
 *  when it is present it wins over recomputing it, so a replay says exactly what the live
 *  view said, word for word. `seq` is `task_events.id`, used for ordering ties only. */
export type IncomingEvent = LiveEvent & { message_user?: string | null; seq?: number };

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 2 · The one place that decides what a person reads
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/** A faithful mirror of `userMessage()` in `agent-server/src/brain/events.ts`. If that switch
 *  changes, this one changes with it — and the divergence is visible, because a recorded row
 *  carries the server's answer and this function only runs on live broadcasts.
 *
 *  Returning `null` is the point of the function, not an edge case: `data`, `log`,
 *  `run_started`, `run_finished`, `step_finished` and `task_confirmed` are structural. They
 *  move a gauge or add a row; they do not put words in anyone's mouth. */
export function userMessage(e: LiveEvent): string | null {
  switch (e.type) {
    case "task_created":
      return e.echo;
    case "task_scheduled":
      return `Booked — ${e.human}`;
    case "task_started":
      return `On it — ${e.steps} step${e.steps === 1 ? "" : "s"}`;
    case "task_finished":
      return e.status === "published" ? "Live on your site" : "Done";
    case "task_failed":
      return e.message;
    case "task_cancelled":
      return e.by === "user" ? "Cancelled" : "Cancelled by the system";
    case "step_skipped":
      return `Skipped ${e.agent_id} — ${e.why}`;
    case "step_started":
      return e.label;
    case "progress":
      return e.label ?? null;
    case "run_error":
      return e.message;
    default:
      return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 3 · The state machine
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped" | "cancelled";

export type TaskStatus =
  | "awaiting_confirm"
  | "queued"
  | "scheduled"
  | "running"
  | "choosing"
  | "awaiting_approval"
  | "done"
  | "published"
  | "failed"
  | "needs_attention"
  | "cancelled";

/** One thing an agent produced: a keyword, a section, an image, a score. The UI picks a
 *  renderer by `kind` and nothing else — an unknown kind is a rendering decision, never an
 *  error. */
export type DataItem = {
  /** Content-addressed. Two broadcasts of the same keyword collapse into one row. */
  key: string;
  kind: string;
  payload: any;
  agent_id: string;
  step_id: string | null;
  /** ms since epoch, from the event's own `at`. */
  at: number;
  /** Arrival counter — breaks ties when two events share a timestamp. */
  seq: number;
};

export type StepState = {
  /** `step_id` when the agent gave one, otherwise `agent#no` from the plan. */
  key: string;
  step_id: string | null;
  no: number | null;
  agent_id: string;
  action: string | null;
  /** The agent's own step label, exactly as the brain's `userMessage()` blesses it. */
  label: string | null;
  optional: boolean;
  status: StepStatus;
  fraction: number | null;
  progressLabel: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  ms: number | null;
  /** Why it ended badly. Always a `message_user`, never a dev string or an API error body. */
  reason: string | null;
  /** The run this status belongs to, so a retry may legitimately re-open a failed step. */
  runId: string | null;
};

export type PaneStatus = "idle" | "running" | "done" | "failed";

/** One tab in the live panel. An agent gets a tab once it has produced something. */
export type AgentPane = {
  agent_id: string;
  status: PaneStatus;
  /** Distinct data kinds, in first-seen order — that is the order the blocks are drawn in. */
  kinds: string[];
  items: DataItem[];
  lastEventAt: number;
};

export type LineTone = "info" | "ok" | "warn" | "err";

/** A sentence a person reads. There is exactly one way to make one: `userMessage()` said so,
 *  or the recording already carried it. */
export type Line = {
  key: string;
  at: number;
  /** Arrival counter — the tie-break when two sentences share a timestamp. */
  seq: number;
  text: string;
  agent_id: string | null;
  tone: LineTone;
};

export type TaskState = {
  task_id: string;
  status: TaskStatus;
  /** The one line the user was shown and confirmed. */
  echo: string | null;
  kind: string | null;
  outline: string[];
  steps: StepState[];
  agents: AgentPane[];
  items: DataItem[];
  lines: Line[];
  createdAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** THE evidence clock. Set by arrivals only. The UI freezes when this stops moving. */
  lastEventAt: number;
  reason: string | null;
  totalSteps: number | null;
  /** Dedupe ledger, content-addressed so a broadcast and its recorded twin are one event. */
  seen: Record<string, true>;
  seq: number;
};

export type LiveState = {
  /** Task ids, newest first. */
  order: string[];
  byTask: Record<string, TaskState>;
};

export const emptyLive: LiveState = { order: [], byTask: {} };

const TERMINAL_TASK: TaskStatus[] = ["done", "published", "failed", "cancelled", "needs_attention", "awaiting_approval"];
const TERMINAL_STEP: StepStatus[] = ["done", "failed", "skipped", "cancelled"];

export function isTerminalTask(s: TaskStatus): boolean {
  return TERMINAL_TASK.indexOf(s) >= 0;
}
export function isTerminalStep(s: StepStatus): boolean {
  return TERMINAL_STEP.indexOf(s) >= 0;
}

/** Status is monotonic. This is what makes out-of-order delivery harmless: a `step_finished`
 *  that overtakes its `step_started` leaves the step done, and the late `step_started` only
 *  fills in the label it was carrying. */
const STEP_RANK: Record<StepStatus, number> = {
  pending: 0,
  running: 1,
  done: 2,
  failed: 2,
  skipped: 2,
  cancelled: 2,
};

const TASK_RANK: Record<TaskStatus, number> = {
  awaiting_confirm: 0,
  queued: 1,
  scheduled: 1,
  choosing: 2,
  running: 2,
  awaiting_approval: 3,
  done: 3,
  published: 3,
  failed: 3,
  needs_attention: 3,
  cancelled: 3,
};

/* ── small pure helpers ────────────────────────────────────────────────────────────────── */

/** Key order must not change an object's identity, or the same keyword arriving through the
 *  broadcast and through the recording would be drawn twice. Depth-capped so a pathological
 *  payload cannot spin here. */
function stable(v: any, depth = 0): string {
  if (depth > 6) return '"…"';
  if (v === null || v === undefined) return "null";
  const t = typeof v;
  if (t === "number" || t === "boolean") return String(v);
  if (t === "string") return JSON.stringify(v);
  if (t !== "object") return '"?"';
  if (Array.isArray(v)) return "[" + v.map((x) => stable(x, depth + 1)).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(v[k], depth + 1)).join(",") + "}";
}

function ms(at: string | null | undefined): number {
  if (!at) return 0;
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : 0;
}

/** The dedupe key. Deliberately does NOT include the timestamp: `task_events.at` defaults to
 *  `now()` at insert time, so the recorded copy of an event has a *different* `at` from the
 *  broadcast copy. Content addressing is the only key that survives both paths — which is
 *  exactly what a cold start needs, because it hydrates from the recording while the
 *  broadcast is already arriving. `run_id` is included wherever the event carries one, so a
 *  genuine retry is a new run and not a duplicate. */
function identityOf(e: IncomingEvent): string {
  switch (e.type) {
    case "data":
      return `data|${e.agent_id}|${e.step_id ?? ""}|${e.kind}|${stable(e.payload)}`;
    case "progress":
      return `progress|${e.agent_id}|${e.step_id ?? ""}|${e.fraction}|${e.label ?? ""}`;
    case "step_started":
      return `step_started|${e.run_id}|${e.step_id}`;
    case "step_finished":
      return `step_finished|${e.run_id}|${e.step_id}`;
    case "run_started":
      return `run_started|${e.run_id}`;
    case "run_finished":
      return `run_finished|${e.run_id}`;
    case "run_error":
      return `run_error|${e.run_id}|${e.message}`;
    case "log":
      return `log|${e.run_id}|${e.level}|${e.message_dev}|${e.at}`;
    case "step_skipped":
      return `step_skipped|${e.step_no}|${e.agent_id}`;
    default:
      return `${e.type}|${e.task_id}`;
  }
}

function toneOf(e: IncomingEvent): LineTone {
  switch (e.type) {
    case "task_failed":
    case "run_error":
      return "err";
    case "task_cancelled":
    case "step_skipped":
      return "warn";
    case "task_finished":
      return "ok";
    default:
      return "info";
  }
}

function blankTask(taskId: string): TaskState {
  return {
    task_id: taskId,
    status: "queued",
    echo: null,
    kind: null,
    outline: [],
    steps: [],
    agents: [],
    items: [],
    lines: [],
    createdAt: null,
    startedAt: null,
    finishedAt: null,
    lastEventAt: 0,
    reason: null,
    totalSteps: null,
    seen: {},
    seq: 0,
  };
}

/** Insert into a list kept in `at` order, tie-broken by arrival. Late events land where they
 *  belong rather than at the bottom, so a table read top to bottom is chronological even
 *  when the network was not. */
function insertOrdered<T extends { at: number; seq: number }>(list: T[], item: T): T[] {
  if (!list.length || list[list.length - 1].at <= item.at) return list.concat(item);
  let i = list.length;
  while (i > 0 && (list[i - 1].at > item.at || (list[i - 1].at === item.at && list[i - 1].seq > item.seq))) i--;
  return list.slice(0, i).concat(item, list.slice(i));
}

function advanceStep(prev: StepState, next: Partial<StepState> & { status?: StepStatus }, runId?: string | null): StepState {
  const out: StepState = { ...prev };
  for (const k of Object.keys(next)) {
    const v = (next as any)[k];
    if (v === undefined || v === null) continue;
    if (k === "status") continue;
    (out as any)[k] = v;
  }
  if (next.status) {
    // A retry is the one legitimate way back: a NEW run may re-open a step that failed.
    const retry = !!runId && !!prev.runId && runId !== prev.runId && prev.status === "failed";
    if (retry || STEP_RANK[next.status] >= STEP_RANK[prev.status]) out.status = next.status;
    if (retry) out.reason = next.reason ?? null;
  }
  if (runId) out.runId = runId;
  return out;
}

function upsertStep(steps: StepState[], key: string, seed: Partial<StepState> & { agent_id: string }, patch: Partial<StepState>, runId?: string | null): StepState[] {
  const i = steps.findIndex((s) => s.key === key);
  if (i < 0) {
    const fresh: StepState = {
      key,
      step_id: seed.step_id ?? null,
      no: seed.no ?? null,
      agent_id: seed.agent_id,
      action: seed.action ?? null,
      label: seed.label ?? null,
      optional: seed.optional ?? false,
      status: "pending",
      fraction: null,
      progressLabel: null,
      startedAt: null,
      finishedAt: null,
      ms: null,
      reason: null,
      runId: runId ?? null,
    };
    const made = advanceStep(fresh, patch, runId);
    // Plan order when we know it (`no`), arrival order otherwise.
    const next = steps.concat(made);
    return next.every((s) => s.no != null) ? next.slice().sort((a, b) => a.no! - b.no!) : next;
  }
  const copy = steps.slice();
  copy[i] = advanceStep(copy[i], patch, runId);
  return copy;
}

function upsertPane(panes: AgentPane[], agentId: string, patch: (p: AgentPane) => AgentPane): AgentPane[] {
  const i = panes.findIndex((p) => p.agent_id === agentId);
  if (i < 0) return panes.concat(patch({ agent_id: agentId, status: "idle", kinds: [], items: [], lastEventAt: 0 }));
  const copy = panes.slice();
  copy[i] = patch(copy[i]);
  return copy;
}

/* ── the reducer ───────────────────────────────────────────────────────────────────────── */

/**
 * Fold one event into the state. PURE: never mutates `state`, and returns the *same object*
 * when the event changes nothing — a duplicate, an event for a tenant we are not watching, or
 * a late event that a monotonic guard rejects. React leans on that reference equality; the
 * tests lean on it too, because "a duplicate produces no change" is literally `s2 === s1`.
 */
export function foldEvents(state: LiveState, incoming: IncomingEvent): LiveState {
  if (!incoming || typeof incoming !== "object" || typeof (incoming as any).type !== "string") return state;
  const e = incoming;
  const taskId = (e as any).task_id;
  if (!taskId || typeof taskId !== "string") return state;

  const prev = state.byTask[taskId];
  const base = prev ?? blankTask(taskId);

  const id = identityOf(e);
  if (base.seen[id]) return state;

  const at = ms(e.at) || base.lastEventAt || Date.now();
  const agentId = "agent_id" in e && typeof (e as any).agent_id === "string" ? (e as any).agent_id : null;
  const runId = "run_id" in e && typeof (e as any).run_id === "string" ? (e as any).run_id : null;
  const stepId = "step_id" in e && typeof (e as any).step_id === "string" ? (e as any).step_id : null;

  let t: TaskState = {
    ...base,
    seen: { ...base.seen, [id]: true },
    seq: base.seq + 1,
    // The evidence clock only ever moves forward: a late event must not make a stalled agent
    // look busy again.
    lastEventAt: Math.max(base.lastEventAt, at),
  };
  const seq = t.seq;

  /* — the sentence, if there is one. `message_user` on a recorded row wins, so a replay reads
       word for word what the live view read. — */
  const text = e.message_user !== undefined ? e.message_user : userMessage(e);
  if (text) {
    const lineKey = `${e.type}|${stepId ?? ""}|${text}`;
    if (!t.lines.some((l) => l.key === lineKey)) {
      t.lines = insertOrdered(t.lines, { key: lineKey, at, seq, text, agent_id: agentId, tone: toneOf(e) });
    }
  }

  const setTask = (status: TaskStatus) => {
    if (TASK_RANK[status] >= TASK_RANK[t.status]) {
      // Once a task has ended it has ended. A stray later event may still add a line, but it
      // may not resurrect the status.
      if (!(isTerminalTask(t.status) && !isTerminalTask(status))) t.status = status;
    }
  };

  switch (e.type) {
    /* ── task-level ───────────────────────────────────────────────────────────────────── */
    case "task_created":
      t.echo = e.echo ?? t.echo;
      t.outline = Array.isArray(e.outline) && e.outline.length ? e.outline : t.outline;
      t.createdAt = t.createdAt ?? at;
      setTask("queued");
      break;

    case "task_confirmed":
      setTask("queued");
      break;

    case "task_scheduled":
      setTask("scheduled");
      break;

    case "task_started":
      t.startedAt = t.startedAt ?? at;
      t.totalSteps = typeof e.steps === "number" ? e.steps : t.totalSteps;
      setTask("running");
      break;

    case "task_finished":
      t.finishedAt = t.finishedAt ?? at;
      setTask((e.status as TaskStatus) ?? "done");
      break;

    case "task_failed":
      t.finishedAt = t.finishedAt ?? at;
      t.reason = e.message ?? t.reason;
      // The orchestrator writes `needs_attention` to the row, not `failed` — the workspace
      // says the same word the database says.
      setTask("needs_attention");
      if (typeof e.step_no === "number") {
        const target = t.steps.find((s) => s.no === e.step_no);
        if (target) t.steps = upsertStep(t.steps, target.key, { agent_id: target.agent_id }, { status: "failed", reason: e.message, finishedAt: at });
      }
      break;

    case "task_cancelled":
      t.finishedAt = t.finishedAt ?? at;
      setTask("cancelled");
      break;

    case "step_skipped": {
      const key = `${e.agent_id}#${e.step_no}`;
      const existing = t.steps.find((s) => s.no === e.step_no && s.agent_id === e.agent_id);
      t.steps = upsertStep(
        t.steps,
        existing ? existing.key : key,
        { agent_id: e.agent_id, no: e.step_no, optional: true },
        { status: "skipped", reason: e.why, finishedAt: at, optional: true },
      );
      break;
    }

    /* ── agent-level ──────────────────────────────────────────────────────────────────── */
    case "run_started":
      setTask("running");
      t.startedAt = t.startedAt ?? at;
      if (agentId) {
        // A new run over a failed step is a retry; let the step re-open.
        const failed = t.steps.filter((s) => s.agent_id === agentId && s.status === "failed");
        for (const s of failed) t.steps = upsertStep(t.steps, s.key, { agent_id: agentId }, { status: "running", reason: null, runId }, runId);
        t.agents = upsertPane(t.agents, agentId, (p) => ({ ...p, status: "running", lastEventAt: Math.max(p.lastEventAt, at) }));
      }
      break;

    case "step_started":
      setTask("running");
      t.steps = upsertStep(
        t.steps,
        stepId ?? `${agentId}#${t.steps.length + 1}`,
        { agent_id: agentId ?? "?", step_id: stepId },
        { label: e.label, status: "running", startedAt: at },
        runId,
      );
      if (agentId) t.agents = upsertPane(t.agents, agentId, (p) => ({ ...p, status: "running", lastEventAt: Math.max(p.lastEventAt, at) }));
      break;

    case "step_finished":
      t.steps = upsertStep(
        t.steps,
        stepId ?? `${agentId}#${t.steps.length + 1}`,
        { agent_id: agentId ?? "?", step_id: stepId },
        { status: "done", finishedAt: at, ms: e.ms, fraction: 1 },
        runId,
      );
      if (agentId) t.agents = upsertPane(t.agents, agentId, (p) => ({ ...p, lastEventAt: Math.max(p.lastEventAt, at) }));
      break;

    case "progress": {
      const key = stepId ?? (agentId ? t.steps.find((s) => s.agent_id === agentId && s.status === "running")?.key : undefined);
      if (key) {
        const cur = t.steps.find((s) => s.key === key);
        // Only forward. A progress event that overtook a later one must not rewind the bar.
        if (cur && !isTerminalStep(cur.status) && (cur.fraction == null || e.fraction >= cur.fraction)) {
          t.steps = upsertStep(t.steps, key, { agent_id: agentId ?? "?" }, { fraction: e.fraction, progressLabel: e.label ?? null }, runId);
        }
      }
      if (agentId) t.agents = upsertPane(t.agents, agentId, (p) => ({ ...p, lastEventAt: Math.max(p.lastEventAt, at) }));
      break;
    }

    case "data": {
      const item: DataItem = { key: id, kind: e.kind, payload: e.payload, agent_id: agentId ?? "?", step_id: stepId, at, seq };
      t.items = insertOrdered(t.items, item);
      const aid = agentId ?? "?";
      t.agents = upsertPane(t.agents, aid, (p) => ({
        ...p,
        status: p.status === "failed" ? p.status : "running",
        kinds: p.kinds.indexOf(e.kind) >= 0 ? p.kinds : p.kinds.concat(e.kind),
        items: insertOrdered(p.items, item),
        lastEventAt: Math.max(p.lastEventAt, at),
      }));
      break;
    }

    case "run_finished":
      if (agentId) {
        t.agents = upsertPane(t.agents, agentId, (p) => ({
          ...p,
          status: p.status === "failed" ? p.status : "done",
          lastEventAt: Math.max(p.lastEventAt, at),
        }));
      }
      break;

    case "run_error":
      if (agentId) {
        t.agents = upsertPane(t.agents, agentId, (p) => ({ ...p, status: "failed", lastEventAt: Math.max(p.lastEventAt, at) }));
        // Attribute it to whichever of this agent's steps was running; if none is, the line
        // and the pane already carry it and no step is falsely blamed.
        const running = t.steps.filter((s) => s.agent_id === agentId && s.status === "running");
        if (running.length === 1) {
          t.steps = upsertStep(t.steps, running[0].key, { agent_id: agentId }, { status: "failed", reason: e.message, finishedAt: at }, runId);
        }
      }
      break;

    /* ── the do-channel rule: a log is for us, never for them ─────────────────────────── */
    case "log":
      // Nothing but the clock. `userMessage()` already returned null; this case exists so the
      // omission is deliberate and readable rather than a default-case accident.
      break;

    default:
      break;
  }

  const order = state.byTask[taskId] ? state.order : [taskId].concat(state.order);
  return { order, byTask: { ...state.byTask, [taskId]: t } };
}

/** Fold a whole batch. Used by the cold start and by every replay seek. */
export function foldAll(state: LiveState, events: IncomingEvent[]): LiveState {
  let s = state;
  for (const e of events) s = foldEvents(s, e);
  return s;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 4 · Snapshots — the truth from the tables, folded in the same shape
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export type TaskRow = {
  id: string;
  tenant_id?: string;
  kind?: string | null;
  status?: string | null;
  echo?: string | null;
  delivery?: string | null;
  error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StepRow = {
  id: string;
  no: number;
  agent_id: string;
  action: string;
  status: string;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  optional?: boolean | null;
};

/** The shape of one row from `task_events` / `GET /brain/tasks/:id/events`. */
export type RecordedRow = {
  id: number | string;
  at: string;
  kind: string;
  agent_id: string | null;
  step_id: string | null;
  message_user: string | null;
  message_dev: string | null;
  payload: any;
};

/**
 * Merge a `{ task, steps }` snapshot — exactly what `GET /brain/tasks/:id` returns — into the
 * state. Same monotonic guards as the reducer, so a snapshot that is a second behind the
 * broadcast cannot drag a finished step back to running.
 *
 * This is what makes a cold start honest and what makes the polling fallback worth having:
 * `task_steps` is written by the orchestrator on every transition, so the timeline strip is
 * correct even for the events no agent emits yet.
 */
export function hydrateTask(state: LiveState, snap: { task: TaskRow; steps?: StepRow[] }): LiveState {
  const task = snap?.task;
  if (!task || !task.id) return state;
  const prev = state.byTask[task.id];
  let t: TaskState = prev ? { ...prev } : blankTask(task.id);

  if (task.echo) t.echo = task.echo;
  if (task.kind) t.kind = task.kind;
  if (task.created_at) t.createdAt = t.createdAt ?? ms(task.created_at);
  if (task.error) t.reason = t.reason ?? task.error;

  const status = task.status as TaskStatus;
  if (status && TASK_RANK[status] != null && TASK_RANK[status] >= TASK_RANK[t.status]) {
    if (!(isTerminalTask(t.status) && !isTerminalTask(status))) t.status = status;
  }

  for (const row of snap.steps ?? []) {
    const key = row.id ?? `${row.agent_id}#${row.no}`;
    const started = row.started_at ? ms(row.started_at) : null;
    const finished = row.finished_at ? ms(row.finished_at) : null;
    t.steps = upsertStep(
      t.steps,
      key,
      { agent_id: row.agent_id, step_id: row.id ?? null, no: row.no, action: row.action, optional: !!row.optional },
      {
        step_id: row.id ?? null,
        no: row.no,
        action: row.action,
        optional: !!row.optional,
        status: (row.status as StepStatus) ?? "pending",
        startedAt: started,
        finishedAt: finished,
        // `task_steps.error` is the same string the orchestrator hands to `task_failed`, which
        // the brain's own `userMessage()` shows to people. Not a new channel.
        reason: row.error ?? null,
      },
    );
    if (started && (t.startedAt == null || started < t.startedAt)) t.startedAt = started;
  }
  if (t.totalSteps == null && (snap.steps?.length ?? 0) > 0) t.totalSteps = snap.steps!.length;
  if (isTerminalTask(t.status) && t.finishedAt == null && task.updated_at) t.finishedAt = ms(task.updated_at);

  const order = state.byTask[task.id] ? state.order : state.order.concat(task.id);
  return { order, byTask: { ...state.byTask, [task.id]: t } };
}

/** Turn a recorded row back into the event that made it. The reverse of `payloadOf()` in the
 *  brain, field for field — anything the brain chose not to record simply is not here, which
 *  is the point: the recording cannot leak what was never written to it. */
export function eventFromRow(row: RecordedRow, taskId: string, tenantId: string): IncomingEvent | null {
  if (!row || !row.kind) return null;
  const p = row.payload ?? {};
  const common = {
    task_id: taskId,
    tenant_id: tenantId,
    at: row.at,
    message_user: row.message_user,
    seq: typeof row.id === "number" ? row.id : Number(row.id) || 0,
  };
  const agent = { run_id: `rec:${row.id}`, agent_id: row.agent_id ?? "?" };

  switch (row.kind) {
    case "data":
      return { ...common, ...agent, type: "data", step_id: row.step_id ?? undefined, kind: String(p.data_kind ?? "unknown"), payload: p.payload ?? null } as IncomingEvent;
    case "progress":
      return { ...common, ...agent, type: "progress", step_id: row.step_id ?? undefined, fraction: Number(p.fraction) || 0, label: p.label ?? undefined } as IncomingEvent;
    case "step_started":
      return { ...common, ...agent, type: "step_started", step_id: row.step_id ?? "", label: String(p.label ?? row.message_user ?? "") } as IncomingEvent;
    case "step_finished":
      return { ...common, ...agent, type: "step_finished", step_id: row.step_id ?? "", ms: Number(p.ms) || 0 } as IncomingEvent;
    case "run_started":
      return { ...common, ...agent, type: "run_started", action: "" } as IncomingEvent;
    case "run_finished":
      return {
        ...common,
        ...agent,
        type: "run_finished",
        output: null,
        ms: Number(p.ms) || 0,
        cost_units: Number(p.cost_units) || 0,
        llm_calls: Number(p.llm_calls) || 0,
        tokens_in: Number(p.tokens_in) || 0,
        tokens_out: Number(p.tokens_out) || 0,
      } as IncomingEvent;
    case "run_error":
      return { ...common, ...agent, type: "run_error", message: row.message_user ?? "", retryable: !!p.retryable, ms: Number(p.ms) || 0 } as IncomingEvent;
    case "log":
      // Reconstructed so replay counts it as an arrival (the clock moves) and for nothing
      // else. `message_dev` never leaves this object.
      return { ...common, ...agent, type: "log", level: "info", message_dev: row.message_dev ?? "" } as IncomingEvent;
    case "task_created":
      return { ...common, type: "task_created", echo: row.message_user ?? "", outline: Array.isArray(p.outline) ? p.outline : [] } as IncomingEvent;
    case "task_confirmed":
      return { ...common, type: "task_confirmed" } as IncomingEvent;
    case "task_scheduled":
      return { ...common, type: "task_scheduled", run_at: String(p.run_at ?? ""), human: "" } as IncomingEvent;
    case "task_started":
      return { ...common, type: "task_started", steps: Number(p.steps) || 0 } as IncomingEvent;
    case "task_finished":
      return { ...common, type: "task_finished", status: String(p.status ?? "done"), ms: Number(p.ms) || 0 } as IncomingEvent;
    case "task_failed":
      return { ...common, type: "task_failed", message: row.message_user ?? "", step_no: p.step_no ?? undefined } as IncomingEvent;
    case "task_cancelled":
      return { ...common, type: "task_cancelled", by: "user" } as IncomingEvent;
    case "step_skipped":
      return { ...common, type: "step_skipped", step_no: Number(p.step_no) || 0, agent_id: String(p.agent_id ?? row.agent_id ?? "?"), why: String(p.why ?? "") } as IncomingEvent;
    default:
      return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 5 · Where the snapshots come from
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

export interface WorkspaceSource {
  listTasks(tenantId: string, limit: number): Promise<TaskRow[]>;
  /** The shape of `GET /brain/tasks/:id`. */
  getTask(taskId: string, tenantId: string): Promise<{ task: TaskRow; steps: StepRow[] }>;
  /** The shape of `GET /brain/tasks/:id/events` — the recording, oldest first. */
  getEvents(taskId: string, tenantId: string): Promise<RecordedRow[]>;
}

/** The default. Reads the same three tables the brain routes read, through the browser client,
 *  under the RLS policies of migration 017 (`is_tenant_member`). No token in the bundle. */
export function supabaseSource(): WorkspaceSource {
  const db = createClient();
  return {
    async listTasks(tenantId, limit) {
      const { data, error } = await db
        .from("tasks")
        .select("id, tenant_id, kind, status, echo, delivery, error, created_at, updated_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as TaskRow[];
    },
    async getTask(taskId, tenantId) {
      const { data: task, error } = await db
        .from("tasks")
        .select("id, tenant_id, kind, status, echo, delivery, error, created_at, updated_at")
        .eq("id", taskId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!task) throw new Error("No such order.");
      const { data: steps, error: stepErr } = await db
        .from("task_steps")
        .select("id, no, agent_id, action, status, error, started_at, finished_at, optional")
        .eq("task_id", taskId)
        .order("no");
      if (stepErr) throw new Error(stepErr.message);
      return { task: task as TaskRow, steps: (steps ?? []) as StepRow[] };
    },
    async getEvents(taskId, tenantId) {
      const { data, error } = await db
        .from("task_events")
        .select("id, at, kind, agent_id, step_id, message_user, message_dev, payload")
        .eq("task_id", taskId)
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as RecordedRow[];
    },
  };
}

/** For the day the app grows a `/api/brain/*` proxy that adds `x-agent-token` server-side:
 *  point `NEXT_PUBLIC_BRAIN_PROXY` at it and the workspace reads the brain routes verbatim,
 *  with no other change anywhere. Returns the identical shapes on purpose. */
export function httpSource(base: string): WorkspaceSource {
  const get = async (path: string) => {
    const r = await fetch(`${base}${path}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`The brain answered ${r.status}.`);
    return r.json();
  };
  return {
    async listTasks(tenantId, limit) {
      const j = await get(`/tasks?tenantId=${encodeURIComponent(tenantId)}&limit=${limit}`);
      return (j.tasks ?? []) as TaskRow[];
    },
    async getTask(taskId, tenantId) {
      const j = await get(`/tasks/${encodeURIComponent(taskId)}?tenantId=${encodeURIComponent(tenantId)}`);
      return { task: j.task as TaskRow, steps: (j.steps ?? []) as StepRow[] };
    },
    async getEvents(taskId, tenantId) {
      const j = await get(`/tasks/${encodeURIComponent(taskId)}/events?tenantId=${encodeURIComponent(tenantId)}`);
      return (j.events ?? j ?? []) as RecordedRow[];
    },
  };
}

export function defaultSource(): WorkspaceSource {
  const proxy = process.env.NEXT_PUBLIC_BRAIN_PROXY;
  return proxy ? httpSource(proxy.replace(/\/$/, "")) : supabaseSource();
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 6 · The hooks
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/** How long an agent may say nothing before the UI stops animating and says it is waiting.
 *  §24.5: "agent ruka hai to screen bhi ruki dikhe". */
export const STALL_MS = 8000;
/** The fallback cadence when Realtime will not connect. Named because the UI says it out loud. */
export const POLL_MS = 3000;

export type Connection = "connecting" | "live" | "polling" | "offline";

export type UseLive = {
  tasks: TaskState[];
  byTask: Record<string, TaskState>;
  connected: Connection;
  /** Plain English, for the banner. Never a spinner with no explanation. */
  error: string | null;
  loading: boolean;
  reload: () => void;
  loadTask: (taskId: string) => void;
  source: WorkspaceSource;
};

export function useLiveEvents(tenantId: string | null, opts?: { source?: WorkspaceSource; limit?: number }): UseLive {
  const limit = opts?.limit ?? 12;
  const sourceRef = useRef<WorkspaceSource | null>(opts?.source ?? null);
  if (!sourceRef.current) sourceRef.current = opts?.source ?? defaultSource();
  const source = sourceRef.current;

  const [state, setState] = useState<LiveState>(emptyLive);
  const [connected, setConnected] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;
  const hydrated = useRef<Record<string, true>>({});
  const alive = useRef(true);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  /** Pull one task's steps and its recording. Idempotent — the reducer's content addressing
   *  means running it while the broadcast is already arriving cannot double anything. */
  const pull = useCallback(
    async (taskId: string, withEvents: boolean) => {
      if (!tenantId) return;
      try {
        const snap = await source.getTask(taskId, tenantId);
        if (!alive.current) return;
        setState((s) => hydrateTask(s, snap));
        if (withEvents) {
          const rows = await source.getEvents(taskId, tenantId);
          if (!alive.current) return;
          const events = rows.map((r) => eventFromRow(r, taskId, tenantId)).filter(Boolean) as IncomingEvent[];
          if (events.length) setState((s) => foldAll(s, events));
        }
      } catch (err: any) {
        if (alive.current) setError(err?.message ?? "Could not reach the brain.");
      }
    },
    [source, tenantId],
  );

  const loadTask = useCallback(
    (taskId: string) => {
      if (hydrated.current[taskId]) return;
      hydrated.current[taskId] = true;
      void pull(taskId, true);
    },
    [pull],
  );

  /* ── cold start: a page refresh mid-run must show the truth, not an empty panel ─────── */
  useEffect(() => {
    alive.current = true;
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const rows = await source.listTasks(tenantId, limit);
        if (!alive.current) return;
        setState((s) => rows.reduce((acc, task) => hydrateTask(acc, { task }), s));
        // The newest task gets its steps and its recording immediately — that is the one the
        // panel opens on. The rest hydrate when they are selected.
        const first = rows[0];
        if (first) {
          hydrated.current[first.id] = true;
          await pull(first.id, true);
        }
        if (alive.current) setError(null);
      } catch (err: any) {
        if (alive.current) setError(err?.message ?? "Could not reach the brain.");
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [tenantId, limit, source, pull, nonce]);

  /* ── Realtime ──────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!tenantId) return;
    const db = createClient();
    let cancelled = false;

    const channel = db.channel(`tenant:${tenantId}:live`, { config: { broadcast: { self: false } } });

    channel.on("broadcast", { event: "live" }, (msg: any) => {
      const e = msg?.payload as IncomingEvent;
      // The channel name already carries the tenant and RLS guards the tables, but the
      // cheapest lock is the one right here: an event that is not ours never reaches the
      // reducer, let alone the screen.
      if (!e || e.tenant_id !== tenantId) return;
      setState((s) => foldEvents(s, e));
      const id = (e as any).task_id;
      if (id && !hydrated.current[id]) {
        hydrated.current[id] = true;
        void pull(id, false);
      }
    });

    channel.subscribe((status: string) => {
      if (cancelled) return;
      if (status === "SUBSCRIBED") {
        setConnected("live");
        // Whatever arrived while we were disconnected is in the tables. Ask for it.
        const open = Object.values(stateRef.current.byTask).filter((t) => !isTerminalTask(t.status));
        for (const t of open) void pull(t.task_id, true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnected("polling");
      } else if (status === "CLOSED") {
        setConnected((c) => (c === "live" ? "polling" : c));
      }
    });

    return () => {
      cancelled = true;
      try {
        void db.removeChannel(channel);
      } catch {
        /* going away anyway */
      }
    };
  }, [tenantId, pull]);

  /* ── the fallback: poll, and say so ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!tenantId || connected === "live") return;
    if (connected === "connecting") {
      // Give Realtime a moment before declaring the fallback — but not forever.
      const t = setTimeout(() => setConnected((c) => (c === "connecting" ? "polling" : c)), 6000);
      return () => clearTimeout(t);
    }
    const id = setInterval(() => {
      const open = Object.values(stateRef.current.byTask).filter((t) => !isTerminalTask(t.status));
      if (!open.length) {
        void (async () => {
          try {
            const rows = await source.listTasks(tenantId, limit);
            setState((s) => rows.reduce((acc, task) => hydrateTask(acc, { task }), s));
          } catch {
            /* the banner already says we are struggling */
          }
        })();
        return;
      }
      for (const t of open) void pull(t.task_id, true);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [tenantId, connected, pull, source, limit]);

  // Newest first, by the task's own clock rather than by which code path happened to add it:
  // a broadcast prepends, a poll appends, and the rail must not reorder itself depending on
  // whether Realtime was up when the order arrived.
  const tasks = useMemo(
    () =>
      state.order
        .map((id) => state.byTask[id])
        .filter(Boolean)
        .sort((a, b) => (b.createdAt ?? b.lastEventAt) - (a.createdAt ?? a.lastEventAt)),
    [state],
  );

  return { tasks, byTask: state.byTask, connected, error, loading, reload, loadTask, source };
}

/* ── replay ────────────────────────────────────────────────────────────────────────────── */

export type ReplayState = {
  /** The task being replayed, or null when replay is closed. */
  taskId: string | null;
  /** The same `TaskState` the live view renders — same reducer, same shape, same components. */
  task: TaskState | null;
  playing: boolean;
  /** Virtual position, ms from the first recorded event. */
  position: number;
  duration: number;
  speed: number;
  loading: boolean;
  error: string | null;
  count: number;
};

export type UseReplay = ReplayState & {
  open: (taskId: string) => void;
  close: () => void;
  toggle: () => void;
  seek: (ms: number) => void;
  setSpeed: (x: number) => void;
};

/** Replay is the live view with a different clock.
 *
 *  It fetches the recording, converts each row back into the event that made it, and feeds
 *  those events through `foldEvents` — the same function, in the same order, producing the
 *  same `TaskState` the components already know how to draw. There is deliberately no second
 *  rendering path: if a replay looks different from the live run, the recording is wrong, and
 *  that is worth finding out. */
export function useReplay(tenantId: string | null, source: WorkspaceSource, speedDefault = 10): UseReplay {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<{ t: number; e: IncomingEvent }[]>([]);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(speedDefault);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Incremental fold: as the virtual clock advances we only fold the events it just crossed.
  // A backwards seek throws the state away and refolds from zero, which is the only way to be
  // certain that scrubbing back shows what that moment actually looked like.
  const cursor = useRef(0);
  const acc = useRef<LiveState>(emptyLive);
  const [, bump] = useState(0);

  const duration = timeline.length ? timeline[timeline.length - 1].t : 0;

  const open = useCallback(
    (id: string) => {
      if (!tenantId) return;
      setTaskId(id);
      setLoading(true);
      setError(null);
      setPlaying(false);
      setPosition(0);
      cursor.current = 0;
      acc.current = emptyLive;
      (async () => {
        try {
          const rows = await source.getEvents(id, tenantId);
          const events = rows.map((r) => eventFromRow(r, id, tenantId)).filter(Boolean) as IncomingEvent[];
          if (!events.length) {
            setTimeline([]);
            setError("Nothing was recorded for this order.");
            setLoading(false);
            return;
          }
          const base = Date.parse(rows[0].at);
          const tl = events.map((e, i) => ({ t: Math.max(0, Date.parse(rows[i].at) - base), e }));
          setTimeline(tl);
          setLoading(false);
          setPlaying(true);
        } catch (err: any) {
          setError(err?.message ?? "Could not read the recording.");
          setLoading(false);
        }
      })();
    },
    [source, tenantId],
  );

  const close = useCallback(() => {
    setTaskId(null);
    setTimeline([]);
    setPlaying(false);
    setPosition(0);
    cursor.current = 0;
    acc.current = emptyLive;
  }, []);

  const seek = useCallback(
    (to: number) => {
      const clamped = Math.max(0, Math.min(duration, to));
      if (clamped < position) {
        cursor.current = 0;
        acc.current = emptyLive;
      }
      setPosition(clamped);
    },
    [duration, position],
  );

  // Advance the folded state to `position`.
  useEffect(() => {
    let moved = false;
    while (cursor.current < timeline.length && timeline[cursor.current].t <= position) {
      acc.current = foldEvents(acc.current, timeline[cursor.current].e);
      cursor.current++;
      moved = true;
    }
    if (moved) bump((n) => n + 1);
  }, [position, timeline]);

  // The clock. 100ms of wall time, `speed` × 100ms of recording.
  useEffect(() => {
    if (!playing || !timeline.length) return;
    const id = setInterval(() => {
      setPosition((p) => {
        const next = p + 100 * speed;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, speed, duration, timeline.length]);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && position >= duration && duration > 0) {
        cursor.current = 0;
        acc.current = emptyLive;
        setPosition(0);
      }
      return !p;
    });
  }, [position, duration]);

  const task = taskId ? acc.current.byTask[taskId] ?? null : null;

  return { taskId, task, playing, position, duration, speed, loading, error, count: timeline.length, open, close, toggle, seek, setSpeed };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 7 · Little things the UI needs and must not reinvent per component
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/** Is this task's evidence still arriving? The single gate on every animation in the UI.
 *  A terminal task is never flowing; a running task that has said nothing for `STALL_MS` is
 *  not flowing either, and the panel says so out loud. */
export function isFlowing(t: TaskState | null, now: number): boolean {
  if (!t) return false;
  if (isTerminalTask(t.status)) return false;
  if (!t.lastEventAt) return false;
  return now - t.lastEventAt < STALL_MS;
}

/** mm:ss, frozen at `finishedAt` once the task is over. */
export function elapsedMs(t: TaskState | null, now: number): number {
  if (!t) return 0;
  const from = t.startedAt ?? t.createdAt;
  if (!from) return 0;
  const to = t.finishedAt ?? (isTerminalTask(t.status) ? t.lastEventAt || from : now);
  return Math.max(0, to - from);
}

export function clock(msTotal: number): string {
  const s = Math.floor(msTotal / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

/** A ticking `Date.now()` that only ticks while something is actually running — so a finished
 *  task's screen is a still image, in the DOM as well as on the eye. */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return now;
}
