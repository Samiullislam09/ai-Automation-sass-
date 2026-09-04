import "./lib/dns-fix.js";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { env } from "./env.js";
import { AGENT_TYPES, enqueue, initQueues, type AgentType } from "./queues.js";
import { boss } from "./db.js";
import { initSocket } from "./socket.js";
import { startWorkers } from "./workers.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { dailyUsage, sweepOrphanedJobs } from "./jobsLog.js";
import { CAP_TABLE } from "./config/caps.js";
import { nvidiaWindow } from "./lib/nvidia.js";
import { mountBrain, startBrain, getRegistry } from "./brain/server.js";
import { enabledActions } from "./brain/registry.js";
import { stopEvents } from "./brain/events.js";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
app.use(express.json());

const STARTED_AT = new Date().toISOString();

/** "Is the brain up, and what can it actually route?" — the question that used to need a real
 *  order and a look at the logs. `actions` is the honest number: stubs and unrouted agents are
 *  registered but excluded, so this counts what a user could really ask for. */
let brainStartupError: string | null = null;

function brainStatus() {
  try {
    const reg = getRegistry();
    return { up: true, actions: enabledActions(reg).length, agents: reg.agents.size, problems: reg.problems.length, error: null };
  } catch {
    // The reason, not just the fact. "brain.up: false" with no explanation is the kind of
    // status line that sends someone reading Railway logs for twenty minutes.
    return { up: false, actions: 0, agents: 0, problems: 0, error: brainStartupError ?? "not started yet" };
  }
}

app.get("/health", (_req, res) => res.send("ok"));

/** Which commit is actually running here.
 *
 *  Railway does not auto-deploy this repo, so "the fix is pushed" and "the fix is live" have
 *  drifted apart more than once — and the only way to tell was to run a real job and read the
 *  error wording. One curl answers it now. Railway injects RAILWAY_GIT_COMMIT_SHA itself. */
app.get("/version", (_req, res) => {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "";
  res.json({
    commit: sha ? sha.slice(0, 7) : "unknown",
    startedAt: STARTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    agents: AGENT_TYPES,
    // Cheap, honest capability flags — each one is a feature whose absence has previously
    // been mistaken for a bug in the web app rather than a stale deploy.
    features: { scheduler: true, keywordAiFallback: true, writerThinkingDisabled: true, brain: brainStatus() },
    // Per-plan caps plus the runaway guard, so the dashboard can show a tenant their real
    // allowance ("3 of 30 runs used today") instead of letting them walk into an invisible
    // wall. null in here means that plan has no daily cap for that agent.
    caps: CAP_TABLE,
    // How many NVIDIA requests this process has sent in the last 60s, against the ceiling it
    // holds itself to. The provider exposes no quota of its own, so this is the only usage
    // number that exists anywhere.
    nvidia: nvidiaWindow(),
    tokenGate: !!env.AGENT_SERVER_TOKEN,
  });
});

// Enqueue a job — the Next.js app calls this once the real agents are wired in (Steps 9+).
// Useful right now for smoke-testing the queue/worker/jobs_log framework itself.
app.post("/jobs/:type", async (req, res) => {
  // Anyone who learns this URL can otherwise queue jobs on someone else's tenant and burn
  // their model credits — it was reachable with no key at all. When AGENT_SERVER_TOKEN is
  // set here, the caller must send it; when it isn't, we log the exposure rather than
  // silently pretending the endpoint is safe.
  if (env.AGENT_SERVER_TOKEN) {
    if (req.get("x-agent-token") !== env.AGENT_SERVER_TOKEN) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  } else if (process.env.NODE_ENV === "production" && process.env.ALLOW_OPEN_JOBS !== "1") {
    // In production an unset token is not a warning, it is an open door to everyone's
    // model credits. Refuse rather than log — the log was warning for weeks and nobody
    // reads Railway logs until something is already wrong.
    console.error("[jobs] refusing request: AGENT_SERVER_TOKEN is not set (set it, or ALLOW_OPEN_JOBS=1 to accept the exposure)");
    return res.status(503).json({ error: "Agent server is not configured: AGENT_SERVER_TOKEN missing" });
  } else {
    console.warn("[jobs] AGENT_SERVER_TOKEN is not set — this endpoint is open to anyone with the URL");
  }

  const type = req.params.type as AgentType;
  if (!AGENT_TYPES.includes(type)) {
    return res.status(400).json({ error: `Unknown agent type. Use one of: ${AGENT_TYPES.join(", ")}` });
  }
  const { tenantId, ...rest } = req.body ?? {};
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  // Refuse here rather than accepting the job and dropping it in the worker. Handing back a
  // job id for work that will never run is how "Mr Lxwa says On it, then nothing happens,
  // and there is no error anywhere" happened: the caller has to be able to tell the user.
  try {
    const usage = await dailyUsage(tenantId, type);
    if (usage.over) {
      // Two different refusals, and conflating them would send someone chasing the wrong
      // problem: a plan cap is commercial (upgrade, or lift it), a runaway is a bug.
      const error = usage.runaway
        ? `Safety guard tripped — the ${type} agent has started ${usage.runaway.usedThisHour} jobs in the last hour (limit ${usage.runaway.limit}). That is far more than anyone runs by hand, so something is looping. Nothing was started.`
        : `Daily limit reached on the ${usage.plan} plan — the ${type} agent has already run ${usage.used} time(s) today (limit ${usage.cap}). Nothing was started, and no credits were used.`;
      return res.status(429).json({ error, used: usage.used, cap: usage.cap, plan: usage.plan, runaway: usage.runaway ?? null });
    }
  } catch (e: any) {
    // Budget guard, not a gate: never block real work because the count query failed.
    console.error("[jobs] cap pre-check failed, allowing:", e?.message);
  }

  try {
    // If Postgres is unreachable, fail loudly within 8s instead of hanging the request forever.
    const jobId = await Promise.race([
      enqueue(type, { tenantId, ...rest }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Postgres queue did not respond in time")), 8000)),
    ]);
    res.json({ ok: true, jobId });
  } catch (e: any) {
    console.error("[jobs] enqueue failed:", e.message);
    res.status(503).json({ error: "Could not reach the job queue (Postgres)", detail: e.message });
  }
});

async function main() {
  await initQueues(); // declares each agent's queue in Postgres before anything sends/works them
  // Close jobs_log rows a previous process left "running" — before the workers start, so a
  // retry pg-boss hands this process is never confused with the dead attempt's row.
  await sweepOrphanedJobs().catch((e: any) => console.error("[jobsLog] orphan sweep threw:", e?.message));

  // The brain refuses to start on a contradictory registry — two agents claiming a phrase, a
  // cycle in the needs graph. That refusal is deliberate: those bugs otherwise surface as an
  // order going to the wrong agent, intermittently, weeks later.
  //
  // But the refusal is scoped to the brain, not to the process. Taking the crawler, the
  // writer and the scheduler down with it would turn a routing bug into an outage — every
  // customer's booked work would stop for a mistake that only affects new orders. So the
  // brain stays down and says so: /version reports `brain.up: false`, its routes are never
  // mounted, and the web app's client already has a sentence for "team abhi reachable nahi".
  try {
    await startBrain();
    mountBrain(app);
  } catch (e: any) {
    brainStartupError = e?.message ?? String(e);
    console.error(
      "\n[brain] REFUSED TO START — new orders will be declined until this is fixed:\n" +
        `        ${brainStartupError}\n` +
        "        Everything already scheduled keeps running. See GET /version.\n",
    );
  }

  const httpServer = createServer(app);
  initSocket(httpServer);
  await startWorkers();
  // Recurring automation (/app/schedule). Safe to start even before migration 006 is
  // applied — it logs the missing table and keeps ticking.
  startScheduler();

  httpServer.listen(env.PORT, () => {
    console.log(`[agent-server] listening on :${env.PORT} — agents: ${AGENT_TYPES.join(", ")}`);
  });

  process.on("SIGTERM", async () => {
    stopScheduler();
    // Write the last half-second of the recording before the process goes: a redeploy in the
    // middle of a run should not lose the evidence of what was happening.
    await stopEvents();
    await boss.stop();
    httpServer.close();
  });
}

main().catch((e) => {
  console.error("[agent-server] fatal startup error:", e);
  process.exit(1);
});
