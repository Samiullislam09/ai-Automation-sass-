import express from "express";
import cors from "cors";
import { createServer } from "http";
import { env } from "./env.js";
import { AGENT_TYPES, enqueue, type AgentType } from "./queues.js";
import { initSocket } from "./socket.js";
import { startWorkers } from "./workers.js";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
app.use(express.json());

app.get("/health", (_req, res) => res.send("ok"));

// Enqueue a job — the Next.js app calls this once the real agents are wired in (Steps 9+).
// Useful right now for smoke-testing the queue/worker/jobs_log framework itself.
app.post("/jobs/:type", async (req, res) => {
  const type = req.params.type as AgentType;
  if (!AGENT_TYPES.includes(type)) {
    return res.status(400).json({ error: `Unknown agent type. Use one of: ${AGENT_TYPES.join(", ")}` });
  }
  const { tenantId, ...rest } = req.body ?? {};
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const job = await enqueue(type, { tenantId, ...rest });
  res.json({ ok: true, jobId: job.id });
});

const httpServer = createServer(app);
initSocket(httpServer);
const workers = startWorkers();

httpServer.listen(env.PORT, () => {
  console.log(`[agent-server] listening on :${env.PORT} — agents: ${AGENT_TYPES.join(", ")}`);
});

process.on("SIGTERM", async () => {
  await Promise.all(workers.map((w) => w.close()));
  httpServer.close();
});
