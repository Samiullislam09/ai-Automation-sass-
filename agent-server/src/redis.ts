import { Redis } from "ioredis";
import { env } from "./env.js";

// Log (once) exactly what host/port we parsed out of REDIS_URL — without the password —
// so a bad env var value is obvious in the deploy logs instead of causing a silent hang.
try {
  const parsed = new URL(env.REDIS_URL);
  console.log(`[redis] connecting to ${parsed.hostname}:${parsed.port || 6379} (tls: ${parsed.protocol === "rediss:"})`);
} catch (e: any) {
  console.error("[redis] REDIS_URL is not a valid URL:", e.message);
}

/** Single shared Redis connection for every BullMQ Queue/Worker.
 *  maxRetriesPerRequest: null is required by BullMQ (command-level retries must be
 *  infinite) — connectTimeout below only bounds the initial TCP/TLS handshake, so a
 *  bad host/credentials fails fast with a clear error instead of hanging forever. */
export const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  connectTimeout: 10000,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

connection.on("error", (err: Error) => console.error("[redis] connection error:", err.message));
connection.on("connect", () => console.log("[redis] TCP connected"));
connection.on("ready", () => console.log("[redis] ready"));
