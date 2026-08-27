// GENERATED — do not edit. Source: packages/agent-contract/src/client.ts
// Edit the package, then run: node scripts/sync-contract.mjs
/**
 * Brain-side client for a remote agent that speaks the HTTP contract.
 * `run` only sends the request and returns the 202 body; the result arrives
 * later at callback_url (verify it with `verifyCallbackSignature`).
 */
import type { Manifest } from "./manifest.js";
import { validateManifest } from "./manifest.js";
import type { RunRequest } from "./context.js";

export interface RemoteAgentOptions {
  /** e.g. "https://writer.up.railway.app" (no trailing slash needed). */
  baseUrl: string;
  token: string;
  /** Injected for tests; defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout. Default 10 000 ms. */
  timeoutMs?: number;
  /** Used in error messages before the manifest is known. */
  agentId?: string;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  uptime: number;
}

export interface RunAccepted {
  accepted: true;
  run_id: string;
}

export class RemoteAgentError extends Error {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly status: number | undefined,
    public readonly url: string,
  ) {
    super(`[agent ${agentId}] ${message}${status !== undefined ? ` (HTTP ${status})` : ""} — ${url}`);
    this.name = "RemoteAgentError";
  }
}

export interface RemoteAgent {
  health(): Promise<HealthResponse>;
  manifest(): Promise<Manifest>;
  run(req: RunRequest & { callback_url: string }): Promise<RunAccepted>;
}

export function remoteAgent(opts: RemoteAgentOptions): RemoteAgent {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let agentId = opts.agentId ?? base;

  async function call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown }, expect: number): Promise<T> {
    const url = `${base}${path}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        method: init.method,
        headers: {
          accept: "application/json",
          "x-agent-token": opts.token,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: ac.signal,
      });
    } catch (e) {
      const aborted = ac.signal.aborted;
      throw new RemoteAgentError(aborted ? `timeout after ${timeoutMs}ms` : `network error: ${e instanceof Error ? e.message : String(e)}`, agentId, undefined, url);
    } finally {
      clearTimeout(timer);
    }
    let body: unknown = undefined;
    const text = await res.text().catch(() => "");
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (res.status !== expect) {
      const detail = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : text.slice(0, 200);
      throw new RemoteAgentError(`expected ${expect}, got ${res.status}${detail ? `: ${detail}` : ""}`, agentId, res.status, url);
    }
    return body as T;
  }

  return {
    async health() {
      const h = await call<HealthResponse>("/health", { method: "GET" }, 200);
      if (!h || h.ok !== true) throw new RemoteAgentError("health check returned ok=false", agentId, 200, `${base}/health`);
      return h;
    },
    async manifest() {
      const raw = await call<unknown>("/manifest", { method: "GET" }, 200);
      const v = validateManifest(raw);
      if (!v.ok) throw new RemoteAgentError(`invalid manifest: ${v.errors.join("; ")}`, agentId, 200, `${base}/manifest`);
      agentId = v.manifest.id;
      return v.manifest;
    },
    async run(req) {
      const out = await call<RunAccepted>("/run", { method: "POST", body: req }, 202);
      if (!out || out.accepted !== true || out.run_id !== req.run_id) {
        throw new RemoteAgentError(`unexpected 202 body: ${JSON.stringify(out).slice(0, 200)}`, agentId, 202, `${base}/run`);
      }
      return out;
    },
  };
}
