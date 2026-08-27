/**
 * HTTP adapter — framework-agnostic implementation of the three endpoints
 * (MASTER_PLAN §6.1 / §6.3):
 *
 *   GET  /health    → { ok, version, uptime }
 *   GET  /manifest  → manifest
 *   POST /run       → 202 { accepted, run_id }; result + events POSTed to callback_url
 *
 * Auth: `x-agent-token` header must equal the agent's token.
 * Callback: `x-agent-token` + `x-run-signature` = HMAC-SHA256(callbackToken ?? token, run_id + "." + status).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { runAction, type AgentDefinition, type RunResult } from "../agent.js";
import type { LlmClient, RunRequest } from "../context.js";
import type { AgentEvent, EventSink } from "../events.js";

export interface HttpRequest {
  method: string;
  /** Path only, e.g. "/run" (query string is ignored). */
  path: string;
  /** Header names are matched case-insensitively. */
  headers: Record<string, string | string[] | undefined>;
  /** Parsed JSON body (or a raw JSON string). */
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

export interface HttpAgentOptions {
  /** Shared secret the brain sends as x-agent-token. */
  token: string;
  llm?: LlmClient;
  /** Local sink (logging / metrics) in addition to the callback stream. */
  sink?: EventSink;
  /** Secret for signing callbacks. Defaults to `token`. */
  callbackToken?: string;
  /** Injected for tests; defaults to globalThis.fetch. */
  fetch?: FetchLike;
  /** Max time a run may take before the adapter aborts it. Defaults to 2 × estimated_seconds. */
  timeoutMs?: number;
  /** Event batch interval (ms). Default 500. */
  batchMs?: number;
  /** Reject a body whose run_id is already running/finished in this process. Default true. */
  dedupe?: boolean;
  /** Called for adapter-internal problems (callback failures). */
  onError?: (err: Error) => void;
}

export interface HttpAgent {
  handle(req: HttpRequest): Promise<HttpResponse>;
  /** Resolves when all background runs started so far have completed and posted their result. Useful in tests / graceful shutdown. */
  drain(): Promise<void>;
}

export interface RunBody extends RunRequest {
  callback_url: string;
}

export type CallbackMessage =
  | { kind: "event"; run_id: string; events: AgentEvent[] }
  | { kind: "result"; run_id: string; result: RunResult };

export function signRun(secret: string, run_id: string, status: string): string {
  return createHmac("sha256", secret).update(`${run_id}.${status}`).digest("hex");
}

/** Brain side: constant-time check of x-run-signature. */
export function verifyCallbackSignature(secret: string, run_id: string, status: string, signature: string | undefined): boolean {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signRun(secret, run_id, status), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function header(h: HttpRequest["headers"], name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(h ?? {})) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseRunBody(raw: unknown): { ok: true; body: RunBody } | { ok: false; errors: string[] } {
  let b = raw;
  if (typeof b === "string") {
    try {
      b = JSON.parse(b);
    } catch {
      return { ok: false, errors: ["body must be valid JSON"] };
    }
  }
  if (typeof b !== "object" || b === null || Array.isArray(b)) return { ok: false, errors: ["body must be a JSON object"] };
  const o = b as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of ["run_id", "tenant_id", "action", "callback_url"] as const) {
    if (typeof o[k] !== "string" || !(o[k] as string).trim()) errors.push(`${k} must be a non-empty string`);
  }
  if (typeof o.callback_url === "string" && !/^https?:\/\//.test(o.callback_url)) errors.push("callback_url must be an http(s) URL");
  if (typeof o.input !== "object" || o.input === null || Array.isArray(o.input)) errors.push("input must be an object");
  if (o.context !== undefined && (typeof o.context !== "object" || o.context === null || Array.isArray(o.context))) errors.push("context must be an object when present");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      run_id: o.run_id as string,
      tenant_id: o.tenant_id as string,
      action: o.action as string,
      input: o.input as Record<string, unknown>,
      context: (o.context as Record<string, unknown>) ?? {},
      callback_url: o.callback_url as string,
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createHttpAgent(agent: AgentDefinition, opts: HttpAgentOptions): HttpAgent {
  if (!opts.token) throw new Error("createHttpAgent: token is required");
  const startedAt = Date.now();
  const secret = opts.callbackToken ?? opts.token;
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const batchMs = opts.batchMs ?? 500;
  const dedupe = opts.dedupe ?? true;
  const onError = opts.onError ?? (() => {});
  const seen = new Set<string>();
  const inflight = new Set<Promise<void>>();

  async function post(url: string, msg: CallbackMessage, status: string, attempts: number): Promise<boolean> {
    const headers = {
      "content-type": "application/json",
      "x-agent-token": opts.token,
      "x-run-signature": signRun(secret, msg.run_id, status),
      "x-agent-id": agent.manifest.id,
    };
    const body = JSON.stringify(msg);
    let lastErr: Error | undefined;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await doFetch(url, { method: "POST", headers, body });
        if (res.ok) return true;
        lastErr = new Error(`callback ${url} responded ${res.status}`);
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
      if (i < attempts - 1) await sleep(250 * 2 ** i);
    }
    onError(lastErr ?? new Error("callback failed"));
    return false;
  }

  function startRun(body: RunBody): void {
    const { callback_url, ...req } = body;

    // ---- batched event forwarding ----
    let buffer: AgentEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sending: Promise<void> = Promise.resolve();
    const flushEvents = (): Promise<void> => {
      if (timer) { clearTimeout(timer); timer = undefined; }
      if (!buffer.length) return sending;
      const events = buffer;
      buffer = [];
      sending = sending.then(() => post(callback_url, { kind: "event", run_id: req.run_id, events }, "event", 1).then(() => {}));
      return sending;
    };
    const callbackSink: EventSink = (e) => {
      if (e.type === "run_finished" || e.type === "run_error") return; // carried by the result message
      buffer.push(e);
      if (!timer) timer = setTimeout(() => void flushEvents(), batchMs);
    };
    const sink: EventSink = async (e) => {
      callbackSink(e);
      if (opts.sink) {
        try { await opts.sink(e); } catch { /* best-effort */ }
      }
    };

    const p = (async () => {
      const result = await runAction(agent, req, { sink, llm: opts.llm, timeoutMs: opts.timeoutMs });
      await flushEvents();
      const status = result.ok ? "ok" : "error";
      await post(callback_url, { kind: "result", run_id: req.run_id, result }, status, 3);
    })()
      .catch((e) => onError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => inflight.delete(p));
    inflight.add(p);
  }

  async function handle(req: HttpRequest): Promise<HttpResponse> {
    const method = (req.method ?? "GET").toUpperCase();
    const path = (req.path ?? "/").split("?")[0].replace(/\/+$/, "") || "/";

    if (method === "GET" && path === "/health") {
      return { status: 200, body: { ok: true, version: agent.manifest.version, uptime: Math.round((Date.now() - startedAt) / 1000) } };
    }
    if (method === "GET" && path === "/manifest") {
      return { status: 200, body: agent.manifest };
    }
    if (method === "POST" && path === "/run") {
      if (!tokenMatches(header(req.headers, "x-agent-token"), opts.token)) {
        return { status: 401, body: { error: "unauthorized" } };
      }
      const parsed = parseRunBody(req.body);
      if (!parsed.ok) return { status: 400, body: { error: "invalid run request", details: parsed.errors } };
      const body = parsed.body;
      if (!agent.action(body.action)) {
        return { status: 400, body: { error: `unknown action "${body.action}"`, actions: agent.manifest.actions.map((a) => a.id) } };
      }
      if (dedupe) {
        if (seen.has(body.run_id)) return { status: 409, body: { error: "duplicate run_id", run_id: body.run_id } };
        seen.add(body.run_id);
        if (seen.size > 10_000) seen.delete(seen.values().next().value as string);
      }
      startRun(body);
      return { status: 202, body: { accepted: true, run_id: body.run_id } };
    }
    return { status: 404, body: { error: "not found", routes: ["GET /health", "GET /manifest", "POST /run"] } };
  }

  return {
    handle,
    drain: async () => {
      while (inflight.size) await Promise.all([...inflight]);
    },
  };
}

/** Structural subset of express' (req, res) — no express import. */
export interface BridgeReq {
  method: string;
  path?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
export interface BridgeRes {
  status(code: number): BridgeRes;
  json(body: unknown): unknown;
  setHeader?(name: string, value: string): unknown;
}

/**
 * Adapt an express-style (req, res) handler to `handle`. Mount with
 * `app.use(express.json()); app.all(["/health","/manifest","/run"], expressBridge(agent.handle))`.
 */
export function expressBridge(handle: HttpAgent["handle"]): (req: BridgeReq, res: BridgeRes) => Promise<void> {
  return async (req, res) => {
    try {
      const out = await handle({ method: req.method, path: req.path ?? req.url ?? "/", headers: req.headers, body: req.body });
      if (out.headers && res.setHeader) for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
      res.status(out.status).json(out.body);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}
