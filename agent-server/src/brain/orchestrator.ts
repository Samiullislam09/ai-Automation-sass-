/** The part that actually runs an order, remembers where it got to, and picks it back up.
 *
 *  Plan §5.4. One task = one row in `tasks`, N rows in `task_steps` (migration 017). The
 *  orchestrator's whole job is to move those rows through their states honestly:
 *
 *   - a step runs only when everything in its `needs` is `done`;
 *   - steps that share a `no` run at the same time, and the join waits for all of them;
 *   - a crash loses nothing, because "what to do next" is a query, not a variable in memory;
 *   - a failure is a state, not an exception that vanishes into a log;
 *   - nothing irreversible happens without a confirmation that is recorded with a timestamp.
 *
 *  WHAT THIS FILE DELIBERATELY DOES NOT DO. It does not decide the order (that is the
 *  planner, from the manifests' `needs`), it does not decide what the user is told (that is
 *  `events.ts`, from typed fields), and it does not know how to reach an agent (that is the
 *  adapter it is handed). Keeping those out is what makes "same intent → same plan → same
 *  order, every time" a property of the code rather than a hope.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../supabase.js";
import { emit } from "./events.js";
import type { Intent, Plan, PlanStep, TaskStatus } from "./types.js";

/** How a step's input says "this field comes from an earlier step's output".
 *  The planner writes these; only this file resolves them. Kept as a string prefix rather
 *  than a nested object so a step's input stays a flat, readable JSON blob in the database. */
export const FROM_STEP = "step:";

/** Retry policy from the plan: three attempts, 1s / 4s / 16s, then the task stops and says so. */
const BACKOFF_SECONDS = [1, 4, 16];
const MAX_ATTEMPTS = BACKOFF_SECONDS.length;

/** How the orchestrator reaches an agent. The in-process adapter (today) and an HTTP adapter
 *  (when agents move out) both fit this; neither is imported here. */
export type StepRunner = (call: {
  task_id: string;
  step_id: string;
  tenant_id: string;
  agent_id: string;
  action: string;
  input: Record<string, unknown>;
  attempt: number;
}) => Promise<void>;

/** Deferring a job — pg-boss in production, an array in tests. */
export type Scheduler = (
  when: { startAfterSeconds?: number; at?: string } | null,
  job: { task_id: string; step_id: string },
) => Promise<void>;

export type OrchestratorDeps = {
  db?: SupabaseClient;
  runStep: StepRunner;
  schedule: Scheduler;
  /** Returns null when the tenant may proceed, or the sentence explaining why not. */
  checkCap?: (tenantId: string, agentId: string) => Promise<string | null>;
  now?: () => Date;
};

let deps: OrchestratorDeps | null = null;

export function configureOrchestrator(d: OrchestratorDeps) {
  deps = { db: supabase, now: () => new Date(), ...d };
}

function need(): Required<Pick<OrchestratorDeps, "db" | "runStep" | "schedule" | "now">> & OrchestratorDeps {
  if (!deps) throw new Error("configureOrchestrator() was never called — the brain was not started");
  return deps as any;
}

const iso = (d: Date) => d.toISOString();

/* ────────────────────────────────────────────────────────────────────────────────────────
 * Creating a task
 * ──────────────────────────────────────────────────────────────────────────────────────── */

export type CreateResult =
  | { ok: true; task_id: string; status: TaskStatus; duplicate: false }
  | { ok: true; task_id: string; status: TaskStatus; duplicate: true }
  | { ok: false; message: string };

/** Write the order down before anything runs.
 *
 *  Three endings, and which one you get is decided here rather than anywhere later:
 *   - irreversible (manifest says so) → `awaiting_confirm`; nothing is queued until a human says yes
 *   - `when` in the future            → `scheduled`; the scheduler picks it up
 *   - otherwise                       → `queued`, and the first steps go out immediately
 *
 *  The idempotency key is what makes a double-click one article instead of two: the unique
 *  index in migration 017 rejects the second insert and we hand back the first task. */
export async function createTask(
  tenantId: string,
  intent: Intent,
  plan: Plan,
  opts: { userId?: string | null } = {},
): Promise<CreateResult> {
  const { db, now } = need();

  const runAt = intent.when?.at ?? null;
  const future = runAt ? new Date(runAt).getTime() > now().getTime() + 5_000 : false;
  const status: TaskStatus = intent.irreversible ? "awaiting_confirm" : future ? "scheduled" : "queued";

  const { data, error } = await db
    .from("tasks")
    .insert({
      tenant_id: tenantId,
      user_id: opts.userId ?? null,
      kind: intent.action,
      params: intent.params,
      status,
      delivery: intent.delivery,
      source: intent.source ?? "chat",
      conversation_id: intent.conversation_id ?? null,
      run_at: runAt,
      echo: intent.echo,
      idempotency_key: intent.idempotency_key ?? null,
      cost_units: plan.cost_units,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique violation, i.e. this exact order already exists for this minute.
    if ((error as any).code === "23505" && intent.idempotency_key) {
      const { data: existing } = await db
        .from("tasks")
        .select("id, status")
        .eq("tenant_id", tenantId)
        .eq("idempotency_key", intent.idempotency_key)
        .maybeSingle();
      if (existing) return { ok: true, task_id: existing.id, status: existing.status, duplicate: true };
    }
    return { ok: false, message: `Could not save the order: ${error.message}` };
  }

  const taskId = data.id as string;

  const rows = plan.steps.map((s) => ({
    task_id: taskId,
    tenant_id: tenantId,
    no: s.no,
    agent_id: s.agent_id,
    action: s.action,
    needs: s.needs,
    provides: s.provides,
    optional: s.optional,
    input: s.input,
    status: "pending" as const,
    // Written explicitly rather than left to the column default: the retry arithmetic reads
    // this back, and a missing value turned `attempts + 1` into NaN, which made every first
    // failure look like the third one and skipped the retries entirely.
    attempts: 0,
  }));
  const { error: stepErr } = await db.from("task_steps").insert(rows);
  if (stepErr) {
    await db.from("tasks").update({ status: "failed", error: `Plan could not be saved: ${stepErr.message}` }).eq("id", taskId);
    return { ok: false, message: `Could not save the plan: ${stepErr.message}` };
  }

  emit({ type: "task_created", task_id: taskId, tenant_id: tenantId, at: iso(now()), echo: intent.echo, outline: plan.outline });

  if (status === "scheduled" && runAt) {
    emit({
      type: "task_scheduled",
      task_id: taskId,
      tenant_id: tenantId,
      at: iso(now()),
      run_at: runAt,
      human: intent.when?.matched ?? runAt,
    });
  } else if (status === "queued") {
    await start(taskId, tenantId);
  }

  return { ok: true, task_id: taskId, status, duplicate: false };
}

/** The yes to an echo. Recorded with a timestamp, because "did the user actually agree to
 *  this going live?" has to be answerable months later. */
export async function confirmTask(taskId: string, tenantId: string): Promise<{ ok: boolean; message?: string }> {
  const { db, now } = need();
  const { data, error } = await db
    .from("tasks")
    .update({ status: "queued", confirmed_at: iso(now()) })
    .eq("id", taskId)
    .eq("tenant_id", tenantId)
    .eq("status", "awaiting_confirm")
    .select("id, run_at")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "That order is not waiting for a confirmation any more." };

  emit({ type: "task_confirmed", task_id: taskId, tenant_id: tenantId, at: iso(now()) });

  // A confirmed order with a future run_at goes back to waiting, it does not start now.
  if (data.run_at && new Date(data.run_at).getTime() > now().getTime() + 5_000) {
    await db.from("tasks").update({ status: "scheduled" }).eq("id", taskId);
    return { ok: true };
  }
  await start(taskId, tenantId);
  return { ok: true };
}

export async function cancelTask(taskId: string, tenantId: string, by: "user" | "system" = "user") {
  const { db, now } = need();
  const { data } = await db
    .from("tasks")
    .update({ status: "cancelled" })
    .eq("id", taskId)
    .eq("tenant_id", tenantId)
    .in("status", ["awaiting_confirm", "queued", "scheduled", "running", "choosing", "needs_attention"])
    .select("id")
    .maybeSingle();
  if (!data) return { ok: false, message: "That order has already finished — there is nothing to cancel." };

  await db.from("task_steps").update({ status: "cancelled" }).eq("task_id", taskId).in("status", ["pending", "running"]);
  emit({ type: "task_cancelled", task_id: taskId, tenant_id: tenantId, at: iso(now()), by });
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * Running it
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/** Move a task to running and send out whatever is ready. Safe to call twice — it only ever
 *  dispatches steps that are still `pending` with their needs met. */
export async function start(taskId: string, tenantId: string): Promise<void> {
  const { db, now } = need();
  const { data: steps } = await db.from("task_steps").select("*").eq("task_id", taskId).order("no");
  if (!steps?.length) return;

  await db.from("tasks").update({ status: "running" }).eq("id", taskId).eq("tenant_id", tenantId);
  emit({ type: "task_started", task_id: taskId, tenant_id: tenantId, at: iso(now()), steps: steps.length });

  await dispatchReady(taskId, tenantId);
}

/** The one function that decides what runs next, and the reason a crash costs nothing: it
 *  answers purely from the rows.
 *
 *  Exported because a delayed retry has to re-enter here after its backoff: the queue job
 *  that wakes up carries only ids, and this rebuilds the whole picture from them. */
export async function dispatchReady(taskId: string, tenantId: string): Promise<void> {
  const { db, schedule, runStep, checkCap, now } = need();
  const { data: steps } = await db.from("task_steps").select("*").eq("task_id", taskId).order("no");
  if (!steps) return;

  const satisfied = new Set(
    steps.filter((s: any) => s.status === "done").map((s: any) => s.provides as string),
  );
  // A skipped optional step counts as satisfied for anything that only optionally needed it —
  // otherwise one missing image would strand a whole article.
  for (const s of steps as any[]) if (s.status === "skipped") satisfied.add(s.provides);

  const ready = (steps as any[]).filter(
    (s) => s.status === "pending" && s.needs.every((n: string) => satisfied.has(n)),
  );

  if (!ready.length) {
    await maybeFinish(taskId, tenantId, steps as any[]);
    return;
  }

  for (const step of ready) {
    if (checkCap) {
      const capMessage = await checkCap(tenantId, step.agent_id);
      if (capMessage) {
        await failStep(step, tenantId, capMessage, { retryable: false });
        continue;
      }
    }

    const attempt = (step.attempts ?? 0) + 1;
    await db.from("task_steps").update({ status: "running", started_at: iso(now()), attempts: attempt }).eq("id", step.id);

    const input = await resolveInput(taskId, step);
    try {
      await schedule(null, { task_id: taskId, step_id: step.id });
      await runStep({
        task_id: taskId,
        step_id: step.id,
        tenant_id: tenantId,
        agent_id: step.agent_id,
        action: step.action,
        input,
        attempt,
      });
    } catch (e: any) {
      await onStepFailed(taskId, tenantId, step.id, e?.message ?? "The agent could not be reached", true);
    }
  }
}

/** Resolve a step's real input: its literal fields, with every name in its `__from` overwritten
 *  by the actual output of the step that produced it. Resolution happens at dispatch time, not
 *  plan time, because the value does not exist until the earlier step has run.
 *
 *  planner.ts's `__from` is a NESTED object, not flat fields — `{ topic: "solar", __from: {
 *  keywords: "step:1:keyword" } }` (see its own header comment) — and each reference is keyed by
 *  `(no, agent_id)`, migration 017's own unique key on `task_steps`, NOT by `provides`: `no`
 *  alone is not unique (parallel steps share it), and two DIFFERENT steps in the same plan can
 *  legitimately share a `provides` value across separate branches, so `(no, agent_id)` is the
 *  only collision-free lookup.
 *
 *  Found live 2026-08-31 while wiring a new step: this function had drifted to scanning `raw`'s
 *  own TOP-LEVEL values for a flat `"step:…"` string (and keying the lookup by `provides`) —
 *  which matched orchestrator.test.ts's own hand-built fixtures (they used that older, flatter
 *  shape) but not what `plan()` actually emits, where every reference sits inside `__from`. So
 *  `wanted` was always empty against a real plan, `raw` was returned completely unresolved, and
 *  every real multi-step chain (keyword → writer, writer → seo, …) silently handed the NEXT
 *  agent a stray `__from` key instead of the value it needed — nothing in the test suite ran the
 *  real planner's output through this function to catch it. */
async function resolveInput(taskId: string, step: any): Promise<Record<string, unknown>> {
  const { db } = need();
  const raw = (step.input ?? {}) as Record<string, unknown>;
  const { __from, ...literal } = raw as { __from?: Record<string, string> } & Record<string, unknown>;
  if (!__from || !Object.keys(__from).length) return literal;

  const { data: done } = await db.from("task_steps").select("no, agent_id, output").eq("task_id", taskId).eq("status", "done");
  const byStep = new Map<string, unknown>((done ?? []).map((d: any) => [`${d.no}:${d.agent_id}`, d.output]));

  const out: Record<string, unknown> = { ...literal };
  for (const [need, ref] of Object.entries(__from)) {
    if (typeof ref !== "string" || !ref.startsWith(FROM_STEP)) continue;
    const key = ref.slice(FROM_STEP.length);
    out[need] = byStep.get(key) ?? null;
  }
  return out;
}

/** An agent finished. Record it, then see what that unblocks. */
export async function onStepDone(taskId: string, tenantId: string, stepId: string, output: unknown): Promise<void> {
  const { db, now } = need();

  // A step can return without throwing and still not have done its job — Mr. Writer's
  // duplicate locks (lib/dedupe.ts §25.5) decline to write rather than error, and say so with
  // `written: false`. Marking that "done" is how a task with no article ever produced still
  // finished as "awaiting_approval" and told the user "Done" (found live 2026-08-31: SEO then
  // skipped for lack of an article, and the whole task reported success over nothing). Treated
  // the same as `failStep` treats a real failure — skipped if optional, otherwise the task
  // stops honestly in `needs_attention` with the real reason — rather than inventing a new
  // status. Generic on purpose (`output.written === false`), not writer-specific: any agent
  // that adopts the same "I checked, I chose not to" convention gets the same honesty for free.
  const declined = !!output && typeof output === "object" && (output as any).written === false;
  if (declined) {
    const { data: step } = await db.from("task_steps").select("*").eq("id", stepId).maybeSingle();
    if (step) {
      const reason = typeof (output as any).reason === "string" ? (output as any).reason : "Kaam nahi hua — koi wajah nahi di gayi.";
      await db.from("task_steps").update({ output: output ?? null }).eq("id", stepId);
      await failStep(step, tenantId, reason, { retryable: false });
      return;
    }
  }

  await db
    .from("task_steps")
    .update({ status: "done", output: output ?? null, finished_at: iso(now()) })
    .eq("id", stepId)
    .eq("task_id", taskId);
  await dispatchReady(taskId, tenantId);
}

/** An agent failed. Retry three times with backoff; after that the task stops in
 *  `needs_attention` — visible, with a reason, never a silent drop. */
export async function onStepFailed(
  taskId: string,
  tenantId: string,
  stepId: string,
  message: string,
  retryable: boolean,
): Promise<void> {
  const { db, schedule, now } = need();
  const { data: step } = await db.from("task_steps").select("*").eq("id", stepId).maybeSingle();
  if (!step) return;

  // `?? 1` and not `?? 0`: by the time a step can fail it has been dispatched at least once.
  const attempt = Number(step.attempts) || 1;

  if (retryable && attempt < MAX_ATTEMPTS) {
    const wait = BACKOFF_SECONDS[attempt] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
    await db.from("task_steps").update({ status: "pending", error: message }).eq("id", stepId);
    await schedule({ startAfterSeconds: wait }, { task_id: taskId, step_id: stepId });
    return;
  }

  await failStep(step, tenantId, message, { retryable: false });
}

/** A step is over and it did not work. Optional steps take the task down with them only if
 *  something required was waiting on them. */
async function failStep(step: any, tenantId: string, message: string, _o: { retryable: boolean }): Promise<void> {
  const { db, now } = need();

  if (step.optional) {
    await db.from("task_steps").update({ status: "skipped", error: message, finished_at: iso(now()) }).eq("id", step.id);
    emit({
      type: "step_skipped",
      task_id: step.task_id,
      tenant_id: tenantId,
      at: iso(now()),
      step_no: step.no,
      agent_id: step.agent_id,
      why: message,
    });
    await dispatchReady(step.task_id, tenantId);
    return;
  }

  await db.from("task_steps").update({ status: "failed", error: message, finished_at: iso(now()) }).eq("id", step.id);
  await db.from("tasks").update({ status: "needs_attention", error: message }).eq("id", step.task_id);
  emit({
    type: "task_failed",
    task_id: step.task_id,
    tenant_id: tenantId,
    at: iso(now()),
    message,
    step_no: step.no,
  });
}

/** Nothing left to dispatch: decide whether that means done, or stuck.
 *
 *  "Stuck" is a real ending and it gets its own status — a task whose remaining steps can
 *  never have their needs met must say so rather than sit in `running` forever. */
async function maybeFinish(taskId: string, tenantId: string, steps: any[]): Promise<void> {
  const { db, now } = need();
  const running = steps.filter((s) => s.status === "running");
  if (running.length) return; // still working

  const pending = steps.filter((s) => s.status === "pending");
  const failed = steps.filter((s) => s.status === "failed");

  if (failed.length) return; // failStep already set needs_attention

  if (pending.length) {
    const blocked = pending.map((s) => `${s.agent_id}.${s.action}`).join(", ");
    const message = `Ye order aage nahi badh sakta — ${blocked} ko jo chahiye wo kabhi ready nahi hoga.`;
    await db.from("tasks").update({ status: "needs_attention", error: message }).eq("id", taskId);
    emit({ type: "task_failed", task_id: taskId, tenant_id: tenantId, at: iso(now()), message });
    return;
  }

  const { data: task } = await db.from("tasks").select("delivery, created_at").eq("id", taskId).maybeSingle();
  const published = steps.some((s) => s.provides === "published_url" && s.status === "done");
  const status: TaskStatus = published ? "published" : task?.delivery === "approvals" ? "awaiting_approval" : "done";

  await db.from("tasks").update({ status }).eq("id", taskId);
  const ms = task?.created_at ? now().getTime() - new Date(task.created_at).getTime() : 0;
  emit({ type: "task_finished", task_id: taskId, tenant_id: tenantId, at: iso(now()), status, ms });
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * Scheduled work
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/** Everything whose time has come. Called on the same tick as today's `tickOrders()`.
 *  Claims each task by flipping it out of `scheduled` first, so two ticks (or two instances)
 *  cannot start the same order twice. */
export async function runDueTasks(): Promise<number> {
  const { db, now } = need();
  const { data: due } = await db
    .from("tasks")
    .select("id, tenant_id")
    .eq("status", "scheduled")
    .lte("run_at", iso(now()))
    .limit(25);

  let started = 0;
  for (const t of due ?? []) {
    const { data: claimed } = await db
      .from("tasks")
      .update({ status: "queued" })
      .eq("id", t.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    await start(t.id, t.tenant_id);
    started++;
  }
  return started;
}

/** After a restart: anything left `running` has no worker behind it any more. Put its
 *  unfinished steps back to pending and dispatch again — the outputs of the steps that did
 *  finish are still in the table, so nothing is redone. */
export async function resumeAfterRestart(): Promise<number> {
  const { db } = need();
  const { data: stale } = await db.from("tasks").select("id, tenant_id").eq("status", "running").limit(50);
  let resumed = 0;
  for (const t of stale ?? []) {
    await db.from("task_steps").update({ status: "pending" }).eq("task_id", t.id).eq("status", "running");
    await dispatchReady(t.id, t.tenant_id);
    resumed++;
  }
  return resumed;
}
