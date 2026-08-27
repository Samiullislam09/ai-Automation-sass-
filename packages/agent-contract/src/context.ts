/**
 * RunContext — what a handler receives (MASTER_PLAN §20.2, §24.2).
 *
 * The agent never writes user-facing copy, never calls fetch() for an LLM and
 * never touches the DB: it gets input + context, emits events, returns output.
 */
import type { AgentEvent, EventSink, LogLevel } from "./events.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** Model hint; the adapter decides what it actually maps to. */
  model?: string;
  /** Ask the provider for a JSON object response. */
  json?: boolean;
  maxTokens?: number;
  /** Aborted when the run is cancelled / times out. Injected by the context. */
  signal?: AbortSignal;
}

export interface LlmResponse {
  text: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
}

/**
 * The only thing the contract defines about LLMs is this interface. Provider
 * rotation, retries and cost live in whatever implementation the adapter injects.
 */
export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Default when no client is injected: fails loudly instead of silently doing nothing. */
export const noLlm: LlmClient = {
  async complete() {
    throw new Error(
      "@mrlxwa/agent-contract: no LlmClient was injected. Pass { llm } to runAction / inProcess / createHttpAgent.",
    );
  },
};

/** What the brain sends to POST /run (minus callback_url, which is transport). */
export interface RunRequest<I = Record<string, unknown>> {
  run_id: string;
  tenant_id: string;
  action: string;
  input: I;
  /** Arbitrary object from the brain: site profile, ICP, tenant style, credentials for this run… */
  context: Record<string, unknown>;
}

export interface RunContext<I = Record<string, unknown>> {
  readonly run_id: string;
  readonly tenant_id: string;
  readonly agent_id: string;
  readonly action: string;
  readonly input: I;
  readonly context: Record<string, unknown>;
  /** Aborted on timeout or cancel. Long loops should check `signal.aborted`. */
  readonly signal: AbortSignal;

  /** Start a named step (finishes the previous one). Emits step_started. */
  step(id: string, label: string): void;
  /** Progress inside the current step, 0..1. */
  progress(fraction: number, label?: string): void;
  /** One user-meaningful data item (a keyword row, a section, an image…). */
  data(kind: string, payload: unknown): void;
  /** Developer log line; goes to task_events, never shown raw to the user. */
  log(message: string, level?: LogLevel): void;
  /** LLM access; calls and tokens are counted by the context. */
  readonly llm: LlmClient;
}

export interface RunContextOptions {
  /** Manifest id of the agent running this request. */
  agent_id: string;
  sink?: EventSink;
  llm?: LlmClient;
  signal?: AbortSignal;
}

export interface RunContextHandle<I = Record<string, unknown>> {
  ctx: RunContext<I>;
  /** Counters accumulated so far (live). */
  usage(): { llm_calls: number; tokens_in: number; tokens_out: number };
  /** Finish the current step if one is open (called by runAction at the end). */
  closeStep(): void;
  /** Resolves once every event handed to the sink has settled. */
  flush(): Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createRunContext<I = Record<string, unknown>>(
  req: RunRequest<I>,
  opts: RunContextOptions,
): RunContextHandle<I> {
  const agentId = opts.agent_id;
  const sink: EventSink = opts.sink ?? (() => {});
  const signal = opts.signal ?? new AbortController().signal;
  const inner = opts.llm ?? noLlm;

  let llm_calls = 0;
  let tokens_in = 0;
  let tokens_out = 0;

  let currentStep: { id: string; startedAt: number } | undefined;
  const pending: Promise<unknown>[] = [];

  const emit = (e: AgentEvent): void => {
    try {
      const r = sink(e);
      if (r && typeof (r as Promise<void>).then === "function") {
        const p = (r as Promise<void>).catch(() => {});
        pending.push(p);
        void p.finally(() => {
          const i = pending.indexOf(p);
          if (i >= 0) pending.splice(i, 1);
        });
      }
    } catch {
      /* a broken sink must never break the run */
    }
  };

  const base = () => ({
    run_id: req.run_id,
    tenant_id: req.tenant_id,
    agent_id: agentId,
    at: nowIso(),
  });

  const closeStep = (): void => {
    if (!currentStep) return;
    emit({ ...base(), type: "step_finished", step_id: currentStep.id, ms: Date.now() - currentStep.startedAt });
    currentStep = undefined;
  };

  const llm: LlmClient = {
    async complete(r) {
      llm_calls += 1;
      const res = await inner.complete({ ...r, signal: r.signal ?? signal });
      tokens_in += Number.isFinite(res.tokens_in) ? res.tokens_in : 0;
      tokens_out += Number.isFinite(res.tokens_out) ? res.tokens_out : 0;
      return res;
    },
  };

  const ctx: RunContext<I> = {
    run_id: req.run_id,
    tenant_id: req.tenant_id,
    agent_id: agentId,
    action: req.action,
    input: req.input,
    context: req.context ?? {},
    signal,
    llm,
    step(id, label) {
      closeStep();
      currentStep = { id, startedAt: Date.now() };
      emit({ ...base(), type: "step_started", step_id: id, label });
    },
    progress(fraction, label) {
      const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
      emit({ ...base(), type: "progress", step_id: currentStep?.id, fraction: f, ...(label !== undefined ? { label } : {}) });
    },
    data(kind, payload) {
      emit({ ...base(), type: "data", step_id: currentStep?.id, kind, payload });
    },
    log(message, level = "info") {
      emit({ ...base(), type: "log", step_id: currentStep?.id, level, message_dev: message });
    },
  };

  return {
    ctx,
    usage: () => ({ llm_calls, tokens_in, tokens_out }),
    closeStep,
    flush: async () => {
      while (pending.length) await Promise.all([...pending]);
    },
  };
}
