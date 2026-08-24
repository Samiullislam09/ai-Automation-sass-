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
import { dailyUsage } from "./jobsLog.js";
import { DAILY_CAPS } from "./config/caps.js";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
app.use(express.json());

const STARTED_AT = new Date().toISOString();

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
    features: { scheduler: true, keywordAiFallback: true, writerThinkingDisabled: true },
    // The caps actually in force, including any DAILY_CAP_* overrides. The dashboard reads
    // these so it can show "3 of 25 runs used today" instead of letting a tenant walk into
    // an invisible wall.
    dailyCaps: DAILY_CAPS,
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
      return res.status(429).json({
        error: `Daily cap reached — the ${type} agent has already run ${usage.used} time(s) today (limit ${usage.cap}). Nothing was started, and no credits were used. Raise DAILY_CAP_${type.toUpperCase()} on agent-server, or try again tomorrow.`,
        used: usage.used,
        cap: usage.cap,
      });
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
    await boss.stop();
    httpServer.close();
  });
}

main().catch((e) => {
  console.error("[agent-server] fatal startup error:", e);
  process.exit(1);
});
