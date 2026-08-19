import { Redis } from "ioredis";
import { env } from "./env.js";

/** Single shared Redis connection for every BullMQ Queue/Worker.
 *  maxRetriesPerRequest: null is required by BullMQ — it does its own retry handling. */
export const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

connection.on("error", (err: Error) => console.error("[redis] connection error:", err.message));
