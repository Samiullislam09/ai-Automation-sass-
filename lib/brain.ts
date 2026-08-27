/** lib/brain.ts — the web app's one door into the brain.
 *
 *  The brain (agent-server/src/brain/*) owns everything that happens after "what did the user
 *  ask for": the plan, the task row, the retries, the recording. This file is the only place
 *  in the web app that knows its URL, and it speaks exactly six routes:
 *
 *      GET  /brain/registry            what the team can do  → the chat's tool list
 *      POST /brain/tasks               an Intent in, a task out
 *      POST /brain/tasks/:id/confirm   the yes to an echo
 *      POST /brain/tasks/:id/cancel
 *      GET  /brain/tasks/:id           status and steps
 *      GET  /brain/tasks/:id/events    the recording
 *
 *  AUTH is the same shared secret as `/jobs` — `x-agent-token`, from AGENT_SERVER_TOKEN, sent
 *  only when it is set (lib/agent-jobs.ts made the same call, for the same reason: an unset
 *  token in dev must not break every request).
 *
 *  TWO RULES THIS FILE EXISTS TO KEEP.
 *
 *  1. NOTHING THROWN REACHES THE CHAT STREAM. Every function returns a flat result carrying a
 *     sentence a customer can read. A 500 in the middle of a streamed reply is the one failure
 *     mode with no good UI, and the chat already has a card for "this did not happen".
 *
 *  2. UNREACHABLE IS SAID, NEVER PAPERED OVER. If the brain cannot be reached, the caller must
 *     say so — it must NOT quietly fall back to the old direct-enqueue path. Two systems that
 *     both create work is how one order becomes two articles and two bills.
 *
 *  The one exception to rule 2 is the REGISTRY, and it is not really an exception: a registry
 *  is a description, not an action. A brain restart takes a few seconds, and refusing to talk
 *  for those seconds because the list of tools is momentarily unavailable would be the wrong
 *  trade — so a stale copy is served while a fresh one is fetched, marked `stale` so the
 *  caller can tell. Serving a stale DESCRIPTION cannot create work; serving a stale ACTION can.
 */

import { createHash } from "node:crypto";

/* ── What the brain says the team can do ─────────────────────────────────────────────── */

/** One action, as `GET /brain/registry` returns it. Mirrors ActionSpec in the agent contract;
 *  it is re-declared here rather than imported because tsconfig.json excludes `agent-server/`
 *  and `packages/` from the web build on purpose — the web app must not compile the brain. */
export type BrainAction = {
  id: string;
  phrases: string[];
  /** Field name → contract type: "string", "string[]", "number?", … `?` = optional. */
  input: Record<string, string>;
  irreversible: boolean;
  estimated_seconds: number;
  needs: string[];
  provides: string;
};

export type BrainAgent = {
  id: string;
  name: string;
  version: string;
  description: string;
  /** false = a stub, or an agent with no adapter yet. Its actions are NOT offered as tools. */
  enabled: boolean;
  healthy: boolean;
  office?: { room: string; ico: string; color: string };
  actions: BrainAction[];
};

export type BrainRegistry = {
  agents: BrainAgent[];
  /** describeCapabilities() from the brain: "CAN DO NOW" / "CANNOT DO YET", already in the
   *  user's language. This is what makes an honest "no" possible in conversation. */
  capabilities: string;
  problems: unknown[];
  /** When this copy was fetched, and whether it is being served past its TTL. */
  fetchedAt: number;
  stale: boolean;
};

/* ── What the web app is allowed to send ─────────────────────────────────────────────── */

/** The intent engine's output (plan §5.1), which is also the brain's input.
 *
 *  `irreversible` is deliberately absent: the brain sets it from the manifest. A caller that
 *  could declare its own order reversible would be a caller that could skip the confirmation. */
export type BrainIntent = {
  action: string;
  params: Record<string, unknown>;
  /** Already resolved by lib/when.ts. The brain rejects a phrase. null = now. */
  when: { at: string; kind: "absolute" | "relative" | "recurring"; matched: string } | null;
  delivery: "approvals" | "publish" | "chat";
  confidence: number;
  missing: string[];
  echo: string;
};

export type BrainTaskCreated = {
  task_id: string;
  status: string;
  duplicate?: boolean;
  echo: string;
  outline: string[];
  estimated_seconds: number;
  cost_units: number;
  irreversible: boolean;
};

export type BrainTaskView = {
  task: Record<string, any>;
  steps: Array<Record<string, any>>;
};

/** Flat, not a discriminated union: this repo compiles with `strict: false`, where TypeScript
 *  cannot narrow `ok: true | false` unions at all (see lib/agent-jobs.ts for the same note). */
export type BrainResult<T> = {
  ok: boolean;
  data?: T;
  /** A sentence a customer can read. Always present when ok is false. */
  error?: string;
  status?: number;
  /** false = we never got an answer from the brain at all (down, DNS, timeout, not configured).
   *  The caller must say so rather than trying another route to the same work. */
  reachable?: boolean;
};

/** The sentence for "the brain did not answer". Exported so the chat and the tests use the
 *  same words, and so it can be found by grep the day it needs translating. */
export const BRAIN_UNREACHABLE = "Team abhi reachable nahi hai — dobara bhejta hun.";

/* ── The HTTP plumbing ───────────────────────────────────────────────────────────────── */

const REGISTRY_TIMEOUT_MS = 8_000;
/** Creating a task plans it and writes two tables; 10s matches lib/agent-jobs.ts. */
const TASK_TIMEOUT_MS = 10_000;

function baseUrl(): string | null {
  const url = process.env.AGENT_SERVER_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(process.env.AGENT_SERVER_TOKEN ? { "x-agent-token": process.env.AGENT_SERVER_TOKEN } : {}),
  };
}

/** One request, one result, never a throw.
 *
 *  A non-2xx carries the brain's own sentence when it sent one — those are already written for
 *  a customer ("\"foo\" naam ka koi kaam registered nahi hai."), and rewriting them here would
 *  put the same message in two places and let them drift. */
async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number }
): Promise<BrainResult<T>> {
  const base = baseUrl();
  if (!base) {
    // Not configured is not the same bug as not running, but it is the same answer to the
    // user: nothing was started, and no other path may be tried.
    console.error("[brain] AGENT_SERVER_URL is not set — no task can be created");
    return { ok: false, error: BRAIN_UNREACHABLE, status: 503, reachable: false };
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method,
      headers: headers(),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(init.timeoutMs),
      cache: "no-store",
    });
  } catch (e: any) {
    console.error(`[brain] ${init.method} ${path} unreachable:`, e?.message);
    return { ok: false, error: BRAIN_UNREACHABLE, status: 502, reachable: false };
  }

  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const sentence =
      typeof data?.error === "string" && data.error.trim()
        ? data.error.trim()
        : `Team ne ye order lene se mana kar diya (${res.status}). Kuch shuru nahi hua.`;
    return { ok: false, error: sentence, status: res.status, reachable: true };
  }
  return { ok: true, data: data as T, status: res.status, reachable: true };
}

/* ── The registry, cached ────────────────────────────────────────────────────────────── */

const REGISTRY_TTL_MS = 60_000;

let cached: { value: BrainRegistry; at: number } | null = null;
let inFlight: Promise<BrainResult<BrainRegistry>> | null = null;

/** Drops the cached registry. Called by the tests, and available for the day a "reload the
 *  team" button exists. */
export function clearRegistryCache(): void {
  cached = null;
  inFlight = null;
}

/** Forces the next read to go to the brain, WITHOUT throwing away the copy we have.
 *
 *  The difference from `clearRegistryCache` is the whole stale-while-revalidate story: this
 *  says "go and look again", and if the looking fails the old list still answers. Use this for
 *  a refresh; use `clearRegistryCache` only when the copy itself must not be trusted. */
export function expireRegistryCache(): void {
  if (cached) cached = { ...cached, at: 0 };
  inFlight = null;
}

function shapeRegistry(raw: any, at: number): BrainRegistry {
  const agents: BrainAgent[] = Array.isArray(raw?.agents)
    ? raw.agents
        .filter((a: any) => a && typeof a.id === "string")
        .map((a: any) => ({
          id: a.id,
          name: typeof a.name === "string" ? a.name : a.id,
          version: typeof a.version === "string" ? a.version : "0.0.0",
          description: typeof a.description === "string" ? a.description : "",
          enabled: a.enabled !== false,
          healthy: a.healthy !== false,
          office: a.office ?? undefined,
          actions: Array.isArray(a.actions)
            ? a.actions
                .filter((x: any) => x && typeof x.id === "string")
                .map((x: any) => ({
                  id: x.id,
                  phrases: Array.isArray(x.phrases) ? x.phrases.map(String) : [],
                  input: x.input && typeof x.input === "object" ? x.input : {},
                  irreversible: x.irreversible === true,
                  estimated_seconds: typeof x.estimated_seconds === "number" ? x.estimated_seconds : 60,
                  needs: Array.isArray(x.needs) ? x.needs.map(String) : [],
                  provides: typeof x.provides === "string" ? x.provides : x.id,
                }))
            : [],
        }))
    : [];

  return {
    agents,
    capabilities: typeof raw?.capabilities === "string" ? raw.capabilities : "",
    problems: Array.isArray(raw?.problems) ? raw.problems : [],
    fetchedAt: at,
    stale: false,
  };
}

/** What the team can do, at most once every 60 seconds.
 *
 *  STALE-WHILE-REVALIDATE, and why it is safe here: a Railway restart is a few seconds of
 *  refused connections. Without the fallback, every chat message in that window would be
 *  answered "Team abhi reachable nahi hai" — including "hello". With it, the chat keeps
 *  talking from the list it already had, and only a real ORDER fails (createTask has no such
 *  fallback and never will). The copy is marked `stale: true` so a caller that cares can say
 *  so; nothing that spends money reads this flag to decide whether to spend. */
export async function getRegistry(): Promise<BrainResult<BrainRegistry>> {
  const now = Date.now();
  if (cached && now - cached.at < REGISTRY_TTL_MS) {
    return { ok: true, data: cached.value, reachable: true };
  }
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<BrainResult<BrainRegistry>> => {
    const res = await call<any>("/brain/registry", { method: "GET", timeoutMs: REGISTRY_TIMEOUT_MS });
    if (res.ok) {
      const value = shapeRegistry(res.data, Date.now());
      cached = { value, at: value.fetchedAt };
      return { ok: true, data: value, reachable: true };
    }
    if (cached) {
      console.warn("[brain] registry refresh failed, serving the copy from", new Date(cached.at).toISOString());
      return { ok: true, data: { ...cached.value, stale: true }, reachable: false };
    }
    return res as BrainResult<BrainRegistry>;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/* ── Tasks ───────────────────────────────────────────────────────────────────────────── */

/** hash(tenant, conversation, action, params, minute) — the double-click guard from plan §5.5.
 *
 *  The minute bucket is what makes it a guard against a double-click rather than a ban on ever
 *  ordering the same thing twice: the same order at 9:01 and at 9:14 is two orders, and the
 *  same order twice in one second is one. Params are stringified through a key-sorted replacer
 *  so `{a,b}` and `{b,a}` are the same order. */
export function idempotencyKey(
  tenantId: string,
  conversationId: string | null,
  action: string,
  params: Record<string, unknown>,
  at: Date = new Date()
): string {
  const minute = Math.floor(at.getTime() / 60_000);
  const stable = JSON.stringify(params ?? {}, Object.keys(params ?? {}).sort());
  return createHash("sha256")
    .update([tenantId, conversationId ?? "-", action, stable, String(minute)].join(" "))
    .digest("hex")
    .slice(0, 32);
}

export async function createTask(
  tenantId: string,
  intent: BrainIntent,
  opts: { userId?: string | null; conversationId?: string | null; idempotencyKey?: string; source?: string } = {}
): Promise<BrainResult<BrainTaskCreated>> {
  return call<BrainTaskCreated>("/brain/tasks", {
    method: "POST",
    timeoutMs: TASK_TIMEOUT_MS,
    body: {
      tenantId,
      userId: opts.userId ?? null,
      intent: {
        ...intent,
        conversation_id: opts.conversationId ?? null,
        idempotency_key:
          opts.idempotencyKey ?? idempotencyKey(tenantId, opts.conversationId ?? null, intent.action, intent.params),
        source: opts.source ?? "chat",
      },
    },
  });
}

export async function confirmTask(taskId: string, tenantId: string): Promise<BrainResult<{ ok: boolean }>> {
  return call<{ ok: boolean }>(`/brain/tasks/${encodeURIComponent(taskId)}/confirm`, {
    method: "POST",
    timeoutMs: TASK_TIMEOUT_MS,
    body: { tenantId },
  });
}

export async function cancelTask(taskId: string, tenantId: string): Promise<BrainResult<{ ok: boolean }>> {
  return call<{ ok: boolean }>(`/brain/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
    timeoutMs: TASK_TIMEOUT_MS,
    body: { tenantId },
  });
}

export async function getTask(taskId: string, tenantId: string): Promise<BrainResult<BrainTaskView>> {
  return call<BrainTaskView>(
    `/brain/tasks/${encodeURIComponent(taskId)}?tenantId=${encodeURIComponent(tenantId)}`,
    { method: "GET", timeoutMs: TASK_TIMEOUT_MS }
  );
}

export async function getTaskEvents(
  taskId: string,
  tenantId: string
): Promise<BrainResult<{ events: Array<Record<string, any>> }>> {
  return call<{ events: Array<Record<string, any>> }>(
    `/brain/tasks/${encodeURIComponent(taskId)}/events?tenantId=${encodeURIComponent(tenantId)}`,
    { method: "GET", timeoutMs: TASK_TIMEOUT_MS }
  );
}

/* ── The flag ────────────────────────────────────────────────────────────────────────── */

/** Is the chat allowed to route orders through the brain?
 *
 *  `BRAIN_ENABLED=1` on, `BRAIN_ENABLED=0` off. Unset means ON — everywhere, production
 *  included. It was not always: the strangler's rollout had this off in production by
 *  default until Phase 1's own exit criterion was met (end-to-end "40 min baad article likh
 *  ke publish kar do", tested, §14's acceptance rows green). Leaving it there past that point
 *  is the thing MASTER_PLAN §4's "ek dimaag" is a principle against — two systems that can
 *  each decide what a message means is exactly the shape of bug a customer would never be
 *  able to explain ("kabhi kaam karta hai, kabhi nahi"). So the default flips: ONE decision
 *  system runs in every environment now, and the flag remains only as an emergency kill
 *  switch if the brain itself needs to be pulled out of the loop — set `BRAIN_ENABLED=0`,
 *  never rely on an environment's NAME to make that call for you.
 *
 *  This does not retire `legacyJobOf`'s four cases (lib/chat-brain.ts) — those stay, and
 *  correctly so: they are not a second brain, they are the documented, narrow set of things
 *  that are not the brain's job at all (a schedule setting, a reject, a cancel) or that need
 *  a lookup the intent model has no way to do today (which article "isko publish karo" means
 *  — see the comment on `legacyJobOf` itself). Read at call time, never cached, so a test can
 *  flip it. */
export function brainEnabled(): boolean {
  const raw = process.env.BRAIN_ENABLED;
  if (raw === undefined || raw === "") return true;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "on";
}
