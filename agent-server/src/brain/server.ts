/** The brain's front door and its boot sequence.
 *
 *  Everything the web app is allowed to ask the brain to do is one of these six routes. There
 *  is deliberately no route that runs an agent directly: work is created as a *task*, and the
 *  planner decides which agents that means. That is what makes "same intent → same plan" true
 *  no matter who is calling.
 *
 *      GET  /brain/registry            what the team can do (the web builds its tool list from this)
 *      POST /brain/tasks               an Intent in, a plan and a task out
 *      POST /brain/tasks/:id/confirm   the yes to an echo
 *      POST /brain/tasks/:id/cancel
 *      GET  /brain/tasks/:id           status, steps, and where it got to
 *      GET  /brain/tasks/:id/events    the recording, for replay
 *
 *  AUTH. Same shared secret as `/jobs` (`x-agent-token`). The web app has already checked that
 *  the signed-in user belongs to the tenant it names — the brain trusts that the way it trusts
 *  the token, and every query is still scoped by `tenant_id` so a wrong tenant returns nothing
 *  rather than someone else's work.
 */

import type { Request, Response, Express } from "express";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { enqueueBrainDispatch } from "../queues.js";
import { MANIFESTS, STUB_AGENTS, NOT_YET_ROUTED } from "./manifests.js";
import { buildRegistry, assertHealthyRegistry, describeCapabilities, enabledActions, syncToDatabase, type Registry } from "./registry.js";
import { plan as makePlan } from "./planner.js";
import {
  configureOrchestrator,
  createTask,
  confirmTask,
  cancelTask,
  dispatchReady,
  runDueTasks,
  resumeAfterRestart,
} from "./orchestrator.js";
import { makeStepRunner } from "./adapter.js";
import { replay } from "./events.js";
import type { Intent } from "./types.js";
import { dailyUsage } from "../jobsLog.js";

let registry: Registry | null = null;

export function getRegistry(): Registry {
  if (!registry) throw new Error("The brain has not started yet");
  return registry;
}

/** Build the registry, refuse to run on a contradictory one, and hand the orchestrator its
 *  two collaborators. Called once from index.ts before the server listens.
 *
 *  A phrase collision or a cycle throws here on purpose. Both are bugs that would otherwise
 *  show up as a user's order going to the wrong agent, intermittently — the kind of thing
 *  that takes a week to reproduce and five seconds to prevent. */
export async function startBrain(): Promise<Registry> {
  registry = buildRegistry(MANIFESTS, { stubs: STUB_AGENTS, notRouted: NOT_YET_ROUTED });
  assertHealthyRegistry(registry);

  const problems = registry.problems.length;
  if (problems) console.warn(`[brain] registry has ${problems} non-fatal problem(s):`, registry.problems);

  configureOrchestrator({
    runStep: makeStepRunner(),
    schedule: async (when, job) => {
      if (!when) return; // the immediate case is the adapter's own enqueue
      const tenant = await tenantOfTask(job.task_id);
      if (!tenant) return;
      await enqueueBrainDispatch({ task_id: job.task_id, tenant_id: tenant }, { startAfter: when.startAfterSeconds });
    },
    checkCap: async (tenantId, agentId) => {
      try {
        const usage = await dailyUsage(tenantId, agentId as any);
        if (!usage.over) return null;
        return usage.runaway
          ? `Safety guard tripped — ${agentId} ne pichhle ghante me ${usage.runaway.usedThisHour} jobs shuru kiye (limit ${usage.runaway.limit}). Kuch nahi chala.`
          : `Aaj ki limit poori — ${agentId} ${usage.used} baar chal chuka hai (${usage.plan} plan ki limit ${usage.cap}). Kuch nahi chala, koi credit kharch nahi hua.`;
      } catch (e: any) {
        // A cap check that cannot run is a budget guard failing open, not a gate.
        console.error("[brain] cap check failed, allowing:", e?.message);
        return null;
      }
    },
  });

  try {
    await syncToDatabase(supabase as any, registry);
  } catch (e: any) {
    // The registry table is for the dashboard's benefit; the brain works without it.
    console.warn("[brain] could not sync the agents table:", e?.message);
  }

  const resumed = await resumeAfterRestart().catch((e) => {
    console.error("[brain] resume after restart failed:", e?.message);
    return 0;
  });
  if (resumed) console.log(`[brain] picked up ${resumed} task(s) that were running when the process died`);

  console.log(`[brain] ready — ${enabledActions(registry).length} action(s) available`);
  return registry;
}

async function tenantOfTask(taskId: string): Promise<string | null> {
  const { data } = await supabase.from("tasks").select("tenant_id").eq("id", taskId).maybeSingle();
  return data?.tenant_id ?? null;
}

/** Called from the scheduler tick: start whatever is due. */
export async function brainTick(): Promise<number> {
  return runDueTasks();
}

/** The worker body for BRAIN_QUEUE — "look at this task again". */
export async function handleBrainDispatch(data: { task_id: string; tenant_id: string }): Promise<void> {
  await dispatchReady(data.task_id, data.tenant_id);
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * Routes
 * ──────────────────────────────────────────────────────────────────────────────────────── */

function authed(req: Request, res: Response): boolean {
  if (!env.AGENT_SERVER_TOKEN) {
    // Same rule as /jobs: in production an unset token is an open door, not a warning.
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_OPEN_JOBS !== "1") {
      res.status(503).json({ error: "Agent server is not configured: AGENT_SERVER_TOKEN missing" });
      return false;
    }
    return true;
  }
  if (req.get("x-agent-token") !== env.AGENT_SERVER_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/** Everything the web app needs to know an Intent is well formed before it reaches a plan.
 *  Rejecting here with a named field beats a planner failure the user cannot act on. */
function readIntent(body: any): { ok: true; tenantId: string; intent: Intent } | { ok: false; error: string } {
  const tenantId = body?.tenantId ?? body?.tenant_id;
  if (typeof tenantId !== "string" || !tenantId) return { ok: false, error: "tenantId is required" };

  const i = body?.intent;
  if (!i || typeof i !== "object") return { ok: false, error: "intent is required" };
  if (typeof i.action !== "string" || !i.action) return { ok: false, error: "intent.action is required" };
  if (i.when != null && (typeof i.when !== "object" || typeof i.when.at !== "string")) {
    // The brain never parses "40 min baad" — the web app's when.ts already did, and having two
    // implementations of "when" is how two different answers happen.
    return { ok: false, error: "intent.when must be null or { at: ISO string, kind, matched } — resolve the phrase before sending it" };
  }

  const intent: Intent = {
    action: i.action,
    agent: typeof i.agent === "string" ? i.agent : undefined,
    params: i.params && typeof i.params === "object" ? i.params : {},
    when: i.when ?? null,
    delivery: i.delivery === "publish" || i.delivery === "chat" ? i.delivery : "approvals",
    confidence: typeof i.confidence === "number" ? i.confidence : 1,
    missing: Array.isArray(i.missing) ? i.missing.map(String) : [],
    irreversible: false, // set from the manifest below, never from the caller
    echo: typeof i.echo === "string" ? i.echo : "",
    conversation_id: typeof i.conversation_id === "string" ? i.conversation_id : null,
    idempotency_key: typeof i.idempotency_key === "string" ? i.idempotency_key : undefined,
    source: ["chat", "schedule", "ui", "api"].includes(i.source) ? i.source : "chat",
  };
  return { ok: true, tenantId, intent };
}

export function mountBrain(app: Express): void {
  app.get("/brain/registry", (req, res) => {
    if (!authed(req, res)) return;
    const reg = getRegistry();
    res.json({
      agents: [...reg.agents.values()].map((a) => ({
        id: a.id,
        name: a.manifest.name,
        version: a.manifest.version,
        description: a.manifest.description,
        enabled: a.enabled,
        healthy: a.healthy,
        office: a.manifest.office,
        actions: a.manifest.actions.map((x) => ({
          id: x.id,
          phrases: x.phrases,
          input: x.input,
          irreversible: x.irreversible,
          estimated_seconds: x.estimated_seconds,
          needs: x.needs,
          provides: x.provides,
        })),
      })),
      capabilities: describeCapabilities(reg),
      problems: reg.problems,
    });
  });

  app.post("/brain/tasks", async (req, res) => {
    if (!authed(req, res)) return;

    const parsed = readIntent(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { tenantId, intent } = parsed;

    const reg = getRegistry();
    const action = reg.actions.get(intent.action);
    if (!action) {
      return res.status(400).json({
        error: `"${intent.action}" naam ka koi kaam registered nahi hai.`,
        available: enabledActions(reg).map((a) => a.spec.id),
      });
    }
    // Irreversibility is a property of the action, not a claim the caller gets to make.
    intent.irreversible = action.spec.irreversible || intent.delivery === "publish";
    intent.agent = action.agent_id;

    const planned = makePlan(intent, reg);
    if (!planned.ok) {
      return res.status(422).json({ error: planned.message, failure: planned.failure });
    }

    const created = await createTask(tenantId, intent, planned.plan, { userId: req.body?.userId ?? null });
    if (!created.ok) return res.status(500).json({ error: created.message });

    res.json({
      task_id: created.task_id,
      status: created.status,
      duplicate: created.duplicate,
      echo: intent.echo,
      outline: planned.plan.outline,
      estimated_seconds: planned.plan.estimated_seconds,
      cost_units: planned.plan.cost_units,
      irreversible: intent.irreversible,
    });
  });

  app.post("/brain/tasks/:id/confirm", async (req, res) => {
    if (!authed(req, res)) return;
    const tenantId = req.body?.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const out = await confirmTask(req.params.id, tenantId);
    res.status(out.ok ? 200 : 409).json(out);
  });

  app.post("/brain/tasks/:id/cancel", async (req, res) => {
    if (!authed(req, res)) return;
    const tenantId = req.body?.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const out = await cancelTask(req.params.id, tenantId, "user");
    res.status(out.ok ? 200 : 409).json(out);
  });

  app.get("/brain/tasks/:id", async (req, res) => {
    if (!authed(req, res)) return;
    const tenantId = String(req.query.tenantId ?? "");
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const { data: task } = await supabase.from("tasks").select("*").eq("id", req.params.id).eq("tenant_id", tenantId).maybeSingle();
    if (!task) return res.status(404).json({ error: "No such order." });

    const { data: steps } = await supabase
      .from("task_steps")
      .select("id, no, agent_id, action, status, error, started_at, finished_at, optional")
      .eq("task_id", req.params.id)
      .order("no");

    res.json({ task, steps: steps ?? [] });
  });

  app.get("/brain/tasks/:id/events", async (req, res) => {
    if (!authed(req, res)) return;
    const tenantId = String(req.query.tenantId ?? "");
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    try {
      res.json({ events: await replay(req.params.id, tenantId) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Could not read the recording." });
    }
  });
}
