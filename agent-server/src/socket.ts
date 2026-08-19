import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "./env.js";

export type AgentStatusEvent = {
  agent: string;
  tenant: string;
  status: "queued" | "running" | "idle" | "error";
  task: string;
};

let io: SocketIOServer | undefined;

export function initSocket(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()) },
  });

  io.on("connection", (socket) => {
    // Frontend joins a room per tenant so it only hears its own agents' status —
    // the dashboard's isometric office (components/Office.tsx) will subscribe here.
    socket.on("join", (tenantId: string) => socket.join(`tenant:${tenantId}`));
  });

  return io;
}

export function emitAgentStatus(event: AgentStatusEvent) {
  io?.to(`tenant:${event.tenant}`).emit("agent:status", event);
}
