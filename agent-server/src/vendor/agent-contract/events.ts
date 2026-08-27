// GENERATED — do not edit. Source: packages/agent-contract/src/events.ts
// Edit the package, then run: node scripts/sync-contract.mjs
/**
 * AG-UI style event stream (MASTER_PLAN §24.2). We adopt the *shape* of AG-UI
 * (RUN_STARTED, STEP_STARTED/FINISHED, ACTIVITY, CUSTOM) — not its SDK.
 *
 * Granularity rule: one event per user-meaningful thing (a keyword, a section,
 * an image, a lead) — never token-by-token.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface EventBase {
  run_id: string;
  tenant_id: string;
  agent_id: string;
  /** ISO-8601 timestamp. */
  at: string;
}

export interface RunStartedEvent extends EventBase {
  type: "run_started";
  action: string;
}

export interface StepStartedEvent extends EventBase {
  type: "step_started";
  step_id: string;
  label: string;
}

export interface StepFinishedEvent extends EventBase {
  type: "step_finished";
  step_id: string;
  /** Milliseconds the step took. */
  ms: number;
}

export interface ProgressEvent extends EventBase {
  type: "progress";
  /** Current step, if any. */
  step_id?: string;
  /** 0..1 */
  fraction: number;
  label?: string;
}

export interface DataEvent extends EventBase {
  type: "data";
  step_id?: string;
  /** e.g. "keyword", "section", "image", "score", "lead" — the UI picks a renderer by kind. */
  kind: string;
  payload: unknown;
}

export interface LogEvent extends EventBase {
  type: "log";
  step_id?: string;
  level: LogLevel;
  /** Developer message. The brain renders the user copy from manifest.user_messages. */
  message_dev: string;
}

export interface RunUsage {
  ms: number;
  cost_units: number;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
}

export interface RunFinishedEvent extends EventBase, RunUsage {
  type: "run_finished";
  output: unknown;
}

export interface RunErrorEvent extends EventBase {
  type: "run_error";
  message: string;
  retryable: boolean;
  ms: number;
}

export type AgentEvent =
  | RunStartedEvent
  | StepStartedEvent
  | StepFinishedEvent
  | ProgressEvent
  | DataEvent
  | LogEvent
  | RunFinishedEvent
  | RunErrorEvent;

export type AgentEventType = AgentEvent["type"];

export type EventSink = (e: AgentEvent) => void | Promise<void>;

/** A sink that drops everything. */
export const nullSink: EventSink = () => {};

/** Fan out one event to several sinks; a throwing sink never breaks the others. */
export function combineSinks(...sinks: Array<EventSink | undefined>): EventSink {
  const list = sinks.filter((s): s is EventSink => typeof s === "function");
  return async (e) => {
    await Promise.all(
      list.map(async (s) => {
        try {
          await s(e);
        } catch {
          /* sinks are best-effort */
        }
      }),
    );
  };
}
