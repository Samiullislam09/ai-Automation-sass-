// GENERATED — do not edit. Source: packages/agent-contract/src/agent.ts
// Edit the package, then run: node scripts/sync-contract.mjs
/**
 * defineAgent + runAction — the /run wrapper every agent shares.
 */
import { validateManifest, validateAgainstSchema, type Manifest, type ManifestInput, type ActionSpec } from "./manifest.js";
import { createRunContext, type LlmClient, type RunContext, type RunRequest } from "./context.js";
import type { EventSink, RunUsage } from "./events.js";

export type ActionHandler<I = Record<string, unknown>, O = unknown> = (ctx: RunContext<I>) => Promise<O>;

export interface AgentDefinition {
  manifest: Manifest;
  handlers: Record<string, ActionHandler<any, unknown>>;
  action(id: string): ActionSpec | undefined;
}

export interface DefineAgentArgs {
  manifest: ManifestInput | Manifest | unknown;
  handlers: Record<string, ActionHandler<any, unknown>>;
}

export class ManifestError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid manifest:\n  - ${errors.join("\n  - ")}`);
    this.name = "ManifestError";
  }
}

/** Validates the manifest and checks every action has a handler. Throws at definition time. */
export function defineAgent(args: DefineAgentArgs): AgentDefinition {
  const v = validateManifest(args.manifest);
  if (!v.ok) throw new ManifestError(v.errors);
  const manifest = v.manifest;

  const errors: string[] = [];
  for (const a of manifest.actions) {
    if (typeof args.handlers[a.id] !== "function") errors.push(`no handler for action "${a.id}"`);
  }
  for (const id of Object.keys(args.handlers)) {
    if (!manifest.actions.some((a) => a.id === id)) errors.push(`handler "${id}" has no action in the manifest`);
  }
  if (errors.length) throw new ManifestError(errors);

  return {
    manifest,
    handlers: args.handlers,
    action: (id) => manifest.actions.find((a) => a.id === id),
  };
}

export type RunResult =
  | ({ ok: true; output: unknown } & RunUsage)
  | { ok: false; error: string; retryable: boolean; ms: number };

export interface RunOptions {
  sink?: EventSink;
  llm?: LlmClient;
  /** Defaults to 2 × estimated_seconds (the brain's watchdog rule). */
  timeoutMs?: number;
  /** External cancel (user pressed cancel). */
  signal?: AbortSignal;
}

/** Errors a handler can throw to control retry semantics. */
export class AgentError extends Error {
  constructor(message: string, public readonly retryable = false, public readonly code?: string) {
    super(message);
    this.name = "AgentError";
  }
}

function errorInfo(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof AgentError) return { message: err.message, retryable: err.retryable };
  if (err instanceof Error) {
    const name = err.name;
    if (name === "AbortError" || name === "TimeoutError") return { message: err.message, retryable: true };
    return { message: err.message || name, retryable: false };
  }
  return { message: String(err), retryable: false };
}

/**
 * Run one action end to end. Emits run_started / run_finished / run_error itself,
 * enforces a timeout via AbortController, validates input and output against the
 * manifest, and never throws.
 */
export async function runAction(agent: AgentDefinition, req: RunRequest, opts: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const agent_id = agent.manifest.id;
  const sink: EventSink = opts.sink ?? (() => {});
  const base = () => ({ run_id: req.run_id, tenant_id: req.tenant_id, agent_id, at: new Date().toISOString() });

  const safeEmit = async (e: Parameters<EventSink>[0]) => {
    try {
      await sink(e);
    } catch {
      /* best-effort */
    }
  };

  const fail = async (message: string, retryable: boolean): Promise<RunResult> => {
    const ms = Date.now() - started;
    await safeEmit({ ...base(), type: "run_error", message, retryable, ms });
    return { ok: false, error: message, retryable, ms };
  };

  await safeEmit({ ...base(), type: "run_started", action: req.action });

  const spec = agent.action(req.action);
  if (!spec) return fail(`unknown action "${req.action}" for agent "${agent_id}"`, false);
  const handler = agent.handlers[spec.id];
  if (!handler) return fail(`no handler for action "${spec.id}"`, false);

  const inputErrors = validateAgainstSchema(spec.input, req.input, "input");
  if (inputErrors.length) return fail(`invalid input: ${inputErrors.join("; ")}`, false);

  const ac = new AbortController();
  const timeoutMs = opts.timeoutMs ?? spec.estimated_seconds * 2 * 1000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort(new Error(`timeout after ${timeoutMs}ms`));
  }, timeoutMs);
  const onExternalAbort = () => ac.abort(opts.signal?.reason ?? new Error("cancelled"));
  if (opts.signal) {
    if (opts.signal.aborted) onExternalAbort();
    else opts.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const handle = createRunContext(req, { agent_id, sink, llm: opts.llm, signal: ac.signal });

  try {
    const output = await Promise.race([
      handler(handle.ctx),
      new Promise<never>((_, reject) => {
        ac.signal.addEventListener(
          "abort",
          () => reject(ac.signal.reason instanceof Error ? ac.signal.reason : new Error(String(ac.signal.reason ?? "aborted"))),
          { once: true },
        );
      }),
    ]);

    handle.closeStep();

    const outputErrors = validateAgainstSchema(spec.output, output, "output");
    if (outputErrors.length) {
      await handle.flush();
      return fail(`handler returned invalid output: ${outputErrors.join("; ")}`, false);
    }

    const usage = handle.usage();
    const ms = Date.now() - started;
    await handle.flush();
    await safeEmit({ ...base(), type: "run_finished", output, ms, cost_units: spec.cost_units, ...usage });
    return { ok: true, output, ms, cost_units: spec.cost_units, ...usage };
  } catch (err) {
    handle.closeStep();
    await handle.flush();
    if (timedOut) return fail(`timeout: action "${spec.id}" exceeded ${timeoutMs}ms`, true);
    if (opts.signal?.aborted) return fail("cancelled", false);
    const info = errorInfo(err);
    return fail(info.message, info.retryable);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}
