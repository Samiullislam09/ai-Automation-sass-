/** The live channel: what the agents are doing, as it happens, plus a recording of it.
 *
 *  Plan §24. Two destinations for one event, and they answer different questions:
 *
 *   - **Broadcast** (Supabase Realtime, channel `tenant:{id}:live`) — "what is happening right
 *     now". Fire and forget; a dropped message costs a frame of animation, nothing more.
 *   - **`task_events` table** (migration 017) — "what happened". This is the replay, the
 *     receipt, and the only evidence when a user says the agent did something odd. Written in
 *     batches so a chatty agent does not turn into hundreds of inserts.
 *
 *  WHY REALTIME AND NOT THE socket.io SERVER THAT ALREADY EXISTS. `src/socket.ts` has run a
 *  socket.io server with per-tenant rooms since Step 6 — but nothing connects to it: the web
 *  app has no `socket.io-client` dependency at all, and the dashboard polls instead. Adding the
 *  client would mean a new bundle dependency plus a websocket from Vercel straight to Railway
 *  (its own CORS and sleep-on-idle problems). The web app already ships `@supabase/supabase-js`,
 *  so Realtime costs zero new dependencies and rides Supabase's edge. socket.io is left alone
 *  and unused for now; it should be deleted once nothing references it.
 *
 *  WHAT MAY BE EMITTED. Only the things in `AgentEvent` (the contract, discriminated by
 *  `type`) plus the task-level events below (discriminated by `type` as well, so one switch
 *  handles both). Never raw prompts, never model reasoning, never another tenant's anything —
 *  the channel name carries the tenant id and the table is behind RLS, but the real guard is
 *  that `payload` is built field by field, never spread from whatever an agent returned.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../supabase.js";
import type { AgentEvent } from "../vendor/agent-contract/index.js";

/** Task-level events the orchestrator emits around the agents' own events.
 *  `task_id` and `tenant_id` are on every one of them; `agent_id` only where an agent is
 *  involved, because a task exists before any agent has been chosen. */
export type TaskEvent =
  | { type: "task_created"; task_id: string; tenant_id: string; at: string; echo: string; outline: string[] }
  | { type: "task_confirmed"; task_id: string; tenant_id: string; at: string }
  | { type: "task_scheduled"; task_id: string; tenant_id: string; at: string; run_at: string; human: string }
  | { type: "task_started"; task_id: string; tenant_id: string; at: string; steps: number }
  | { type: "task_finished"; task_id: string; tenant_id: string; at: string; status: string; ms: number }
  | { type: "task_failed"; task_id: string; tenant_id: string; at: string; message: string; step_no?: number }
  | { type: "task_cancelled"; task_id: string; tenant_id: string; at: string; by: "user" | "system" }
  | { type: "step_skipped"; task_id: string; tenant_id: string; at: string; step_no: number; agent_id: string; why: string };

/** What goes on the wire and into the table. An agent event carries its task through `task_id`,
 *  which the orchestrator adds — an agent only knows its own run. */
export type LiveEvent = (AgentEvent & { task_id: string }) | TaskEvent;

type Row = {
  task_id: string;
  tenant_id: string;
  step_id: string | null;
  agent_id: string | null;
  kind: string;
  message_user: string | null;
  message_dev: string | null;
  payload: Record<string, unknown> | null;
};

/** Batch window. Long enough that a writer streaming sections does not cause an insert per
 *  paragraph; short enough that a crash loses at most half a second of the recording. */
const FLUSH_MS = 500;
const MAX_BATCH = 100;

let queue: Row[] = [];
let timer: NodeJS.Timeout | null = null;
let db: SupabaseClient = supabase;
let broadcaster: ((tenantId: string, event: LiveEvent) => void) | null = null;

/** Tests inject a fake client and capture broadcasts instead of touching Supabase. */
export function configureEvents(opts: { client?: SupabaseClient; broadcast?: (tenantId: string, event: LiveEvent) => void }) {
  if (opts.client) db = opts.client;
  if (opts.broadcast) broadcaster = opts.broadcast;
}

/** One channel per tenant, kept alive and reused — subscribing per event would be a handshake
 *  per keyword. */
const channels = new Map<string, ReturnType<SupabaseClient["channel"]>>();

function channelFor(tenantId: string) {
  let ch = channels.get(tenantId);
  if (!ch) {
    ch = db.channel(`tenant:${tenantId}:live`, { config: { broadcast: { self: false } } });
    ch.subscribe();
    channels.set(tenantId, ch);
  }
  return ch;
}

/** The user-facing sentence for an event, or null when the event is only for us.
 *
 *  This is the one place that decides what a person reads. Agents do NOT write user-facing
 *  text (plan §20: `ctx.log` carries a dev message; the user's sentence is built here), which
 *  is what stops an agent's prose from claiming something the system did not do.
 *
 *  `data`, `log`, `run_started`, `run_finished` and `step_finished` deliberately return null:
 *  they are structural, and the UI renders them as a row appearing or a gauge moving. */
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

/** Typed extraction, not a spread: whatever an agent returns must not walk into the event log
 *  wholesale. Anything not listed here is simply not recorded. */
function payloadOf(e: LiveEvent): Record<string, unknown> | null {
  switch (e.type) {
    case "data":
      return { data_kind: e.kind, payload: e.payload ?? null };
    case "progress":
      return { fraction: e.fraction, label: e.label ?? null };
    case "step_started":
      return { label: e.label };
    case "step_finished":
      return { ms: e.ms };
    case "run_finished":
      return { ms: e.ms, cost_units: e.cost_units, llm_calls: e.llm_calls, tokens_in: e.tokens_in, tokens_out: e.tokens_out };
    case "run_error":
      return { retryable: e.retryable, ms: e.ms };
    case "task_created":
      return { outline: e.outline };
    case "task_scheduled":
      return { run_at: e.run_at };
    case "task_started":
      return { steps: e.steps };
    case "task_finished":
      return { status: e.status, ms: e.ms };
    case "task_failed":
      return e.step_no != null ? { step_no: e.step_no } : null;
    case "step_skipped":
      return { step_no: e.step_no, agent_id: e.agent_id, why: e.why };
    default:
      return null;
  }
}

function agentIdOf(e: LiveEvent): string | null {
  if ("agent_id" in e && typeof e.agent_id === "string") return e.agent_id;
  return null;
}

function stepIdOf(e: LiveEvent): string | null {
  if ("step_id" in e && typeof e.step_id === "string") return e.step_id;
  return null;
}

function devMessageOf(e: LiveEvent): string | null {
  if (e.type === "log") return e.message_dev;
  if (e.type === "run_error") return e.message;
  if (e.type === "task_failed") return e.message;
  return null;
}

function toRow(e: LiveEvent): Row {
  return {
    task_id: e.task_id,
    tenant_id: e.tenant_id,
    step_id: stepIdOf(e),
    agent_id: agentIdOf(e),
    kind: e.type,
    message_user: userMessage(e),
    message_dev: devMessageOf(e),
    payload: payloadOf(e),
  };
}

/** Emit one event: broadcast now, persist soon. Never throws — a broken event pipe must not
 *  fail the work it is describing. */
export function emit(e: LiveEvent): void {
  if (!e.tenant_id) return;

  try {
    if (broadcaster) broadcaster(e.tenant_id, e);
    else void channelFor(e.tenant_id).send({ type: "broadcast", event: "live", payload: e });
  } catch (err: any) {
    console.warn("[events] broadcast failed:", err?.message);
  }

  queue.push(toRow(e));
  if (queue.length >= MAX_BATCH) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
}

/** Write everything queued. Called on the timer, at the batch cap, and on shutdown. */
export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  try {
    const { error } = await db.from("task_events").insert(batch);
    if (error) throw new Error(error.message);
  } catch (err: any) {
    // The recording is best-effort by design: losing it must never lose the work. But say so
    // loudly, because a missing recording is how "the agent did something odd" becomes
    // unanswerable.
    console.error(`[events] could not persist ${batch.length} event(s):`, err?.message);
  }
}

/** For a clean SIGTERM: stop the timer, write what is left, drop the channels. */
export async function stopEvents(): Promise<void> {
  await flush();
  for (const ch of channels.values()) {
    try {
      await ch.unsubscribe();
    } catch {
      /* shutting down anyway */
    }
  }
  channels.clear();
}

/** Replay: one task's recording, oldest first. The ▶ button in Approvals reads this.
 *
 *  Capped at the newest REPLAY_LIMIT for the same reason lib/live.ts caps its own read: this
 *  is unbounded per task and nothing downstream renders more than a window of it. */
const REPLAY_LIMIT = 400;

export async function replay(taskId: string, tenantId: string) {
  const { data, error } = await db
    .from("task_events")
    .select("id, at, kind, agent_id, step_id, message_user, message_dev, payload")
    .eq("task_id", taskId)
    .eq("tenant_id", tenantId)
    .order("id", { ascending: false })
    .limit(REPLAY_LIMIT);
  if (error) throw new Error(`Could not read the recording: ${error.message}`);
  return (data ?? []).reverse();
}
