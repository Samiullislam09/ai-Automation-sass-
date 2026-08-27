/**
 * In-process adapter: for agents that live inside the brain process
 * (today's keyword / writer). Same contract, no HTTP.
 */
import { runAction, type AgentDefinition, type RunResult } from "../agent.js";
import type { LlmClient, RunRequest } from "../context.js";
import type { EventSink } from "../events.js";

export interface InProcessOptions {
  llm?: LlmClient;
  sink?: EventSink;
  timeoutMs?: number;
}

export interface InProcessAgent {
  manifest: AgentDefinition["manifest"];
  run(req: RunRequest, overrides?: { sink?: EventSink; signal?: AbortSignal; timeoutMs?: number }): Promise<RunResult>;
}

export function inProcess(agent: AgentDefinition, opts: InProcessOptions = {}): InProcessAgent {
  return {
    manifest: agent.manifest,
    run(req, overrides = {}) {
      const sink: EventSink | undefined =
        opts.sink && overrides.sink
          ? async (e) => {
              await Promise.all([opts.sink!(e), overrides.sink!(e)]);
            }
          : overrides.sink ?? opts.sink;
      return runAction(agent, req, {
        llm: opts.llm,
        sink,
        signal: overrides.signal,
        timeoutMs: overrides.timeoutMs ?? opts.timeoutMs,
      });
    },
  };
}
