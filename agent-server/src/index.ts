import "./lib/dns-fix.js";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { env } from "./env.js";
import { AGENT_TYPES, enqueue, initQueues, type AgentType } from "./queues.js";
import { boss } from "./db.js";
import { initSocket } from "./socket.js";
import { startWorkers } from "./workers.js";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
app.use(express.json());

app.get("/health", (_req, res) => res.send("ok"));

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

  httpServer.listen(env.PORT, () => {
    console.log(`[agent-server] listening on :${env.PORT} — agents: ${AGENT_TYPES.join(", ")}`);
  });

  process.on("SIGTERM", async () => {
    await boss.stop();
    httpServer.close();
  });
}

main().catch((e) => {
  console.error("[agent-server] fatal startup error:", e);
  process.exit(1);
});
