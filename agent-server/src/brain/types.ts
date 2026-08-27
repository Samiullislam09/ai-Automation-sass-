/** The brain's vocabulary — the shapes every other brain module agrees on.
 *
 *  WHERE THE BRAIN LIVES (a decision, and why it differs from the plan's §11 diagram)
 *
 *  The plan draws `mrlxwa-brain` as its own repo and its own Railway service. Two facts on the
 *  ground argue against doing that today, and neither is about taste:
 *
 *   1. The orchestrator IS pg-boss, and pg-boss already lives here with every worker and the
 *      scheduler. A separate service would mean two processes fighting over the same queue
 *      tables on day one, for no gain until the agents themselves are separate services.
 *   2. Railway is at $4.42 of credit. A second always-on service is a real cost against a
 *      budget that has to survive the rest of the rebuild.
 *
 *  So the brain is built here, in `src/brain/`, as a self-contained module: it imports from
 *  `../db.js`, `../queues.js` and the agent contract, and NOTHING outside `src/brain/` imports
 *  from inside it except the HTTP layer in `src/index.ts`. That is the strangler shape the plan
 *  asks for (§22 con #10) — when the budget allows, `src/brain/` moves to its own repo with the
 *  imports rewritten and nothing else changed.
 *
 *  WHERE INTENT LIVES. Intent extraction stays in the web app (`lib/chat-*.ts`), not here.
 *  The chat stream is served from Vercel and already talks straight to NVIDIA; routing it
 *  through Railway would add a hop to the one number users actually feel (first token). What
 *  changes is that the web app stops hard-coding what the agents can do: it fetches the
 *  registry from `GET /brain/registry` and builds its tool list from the manifests, so a new
 *  agent becomes routable without a web deploy. The web app then POSTs a structured Intent
 *  (the shape below) to `POST /brain/tasks`, and everything after that — plan, run, retry,
 *  events — happens in here.
 *
 *  Time parsing stays in the web app too (`lib/when.ts`, 26 tests green). The brain receives a
 *  resolved instant, never a phrase like "40 min baad", so there is exactly one implementation
 *  of "when" in the product.
 */

// The contract's own source, vendored into this package by scripts/sync-contract.mjs — see
// that file for why it is a copy and how drift is caught (a test runs it with --check).
import type { Manifest, ActionSpec } from "../vendor/agent-contract/index.js";

/** What the user asked for, after the LLM and `when.ts` have both had their say.
 *  This is the ONLY thing the web app is allowed to send the brain. Plan §5.1. */
export type Intent = {
  /** Must be an action id registered in the registry; anything else is rejected at the door. */
  action: string;
  /** Which agent owns that action. Filled by the registry, not by the model. */
  agent?: string;
  params: Record<string, unknown>;
  /** Already resolved to an instant by the web app's when.ts. null = now. */
  when: { at: string; kind: "absolute" | "relative" | "recurring"; matched: string } | null;
  delivery: "approvals" | "publish" | "chat";
  confidence: number;
  /** Slots the model could not fill. Non-empty = ask one question, do not guess. */
  missing: string[];
  /** From the manifest, never from the model. true = echo and wait for a yes. */
  irreversible: boolean;
  /** The one line shown to the user when confirming, in their own language. */
  echo: string;
  /** Chat conversation this came from, so a follow-up ("haan") can find its pending order. */
  conversation_id?: string | null;
  /** hash(tenant, conversation, action, params, minute) — the double-click guard. */
  idempotency_key?: string;
  source?: "chat" | "schedule" | "ui" | "api";
};

/** One step of a plan: an agent action, what it waits for, what it produces. Mirrors the
 *  `task_steps` row in migration 017 so the planner can insert without translation. */
export type PlanStep = {
  no: number;
  agent_id: string;
  action: string;
  needs: string[];
  provides: string;
  optional: boolean;
  input: Record<string, unknown>;
};

export type Plan = {
  steps: PlanStep[];
  /** Human-readable, one line per step — this is what the "here is what I will do" card shows. */
  outline: string[];
  /** The **critical path**, not the sum: steps that run in parallel are counted once, at the
   *  slowest of them. "~5 min" is then arithmetic rather than a guess, and it does not inflate
   *  every time another parallel check is added to the plan. `cost_units` IS a plain sum —
   *  parallel work costs twice and takes once. */
  estimated_seconds: number;
  cost_units: number;
};

/** Why a plan could not be made. Never a thrown error: the user gets one of these sentences. */
export type PlanFailure =
  | { kind: "unknown_action"; action: string }
  | { kind: "missing_slots"; slots: string[] }
  | { kind: "no_provider"; need: string; forStep: string }
  | { kind: "agent_unhealthy"; agent_id: string; required: true }
  | { kind: "cycle"; involved: string[] };

export type PlanResult = { ok: true; plan: Plan } | { ok: false; failure: PlanFailure; message: string };

/** A registered agent as the registry holds it: the manifest plus how to reach it and
 *  whether it answered its last health check. */
export type RegisteredAgent = {
  id: string;
  manifest: Manifest;
  /** null = in-process adapter (today's keyword/writer live inside this process). */
  base_url: string | null;
  enabled: boolean;
  healthy: boolean;
  healthy_at: string | null;
  /** action id → spec, for the planner's needs walk. */
  actions: Record<string, ActionSpec>;
};

/** What the registry refuses to accept, checked at boot and on every re-register.
 *  Plan §5.5 "panga" table: two agents claiming one phrase, and cycles, are structural bugs
 *  and must be impossible rather than debugged later. */
export type RegistryProblem =
  | { kind: "duplicate_action"; action: string; agents: string[] }
  | { kind: "phrase_collision"; phrase: string; actions: string[] }
  | { kind: "cycle"; involved: string[] }
  | { kind: "invalid_manifest"; agent_id: string; errors: string[] };

/** The task lifecycle, exactly the CHECK constraint in migration 017. */
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

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped" | "cancelled";

/** What the orchestrator writes and the UI reads. Keep in step with 017. */
export type TaskRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  kind: string;
  params: Record<string, unknown>;
  status: TaskStatus;
  delivery: "approvals" | "publish" | "chat";
  source: "chat" | "schedule" | "ui" | "api";
  conversation_id: string | null;
  run_at: string | null;
  echo: string | null;
  confirmed_at: string | null;
  idempotency_key: string | null;
  cost_units: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};
