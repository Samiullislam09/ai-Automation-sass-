import { PgBoss } from "pg-boss";
import { env } from "./env.js";

// Log (once) exactly what host/port/db we parsed out of DATABASE_URL — without the
// password — so a bad/malformed env var value is obvious in the deploy logs instead of
// surfacing only as a cryptic downstream DNS/connection error.
let queueHost = "";
try {
  const parsed = new URL(env.DATABASE_URL);
  queueHost = parsed.hostname;
  console.log(
    `[db] connecting to ${parsed.hostname}:${parsed.port || 5432}${parsed.pathname} (user: ${parsed.username || "(none)"}, password set: ${!!parsed.password})`
  );
} catch (e: any) {
  console.error("[db] DATABASE_URL is not a valid URL:", e.message);
}

// Railway's private network (`*.railway.internal`) speaks plain Postgres — demanding TLS
// there fails with "The server does not support SSL connections". Everywhere else (Supabase,
// Railway's public proxy) TLS is required; rejectUnauthorized:false accepts their self-signed
// chains.
const queueSsl = queueHost.endsWith(".railway.internal") ? false : { rejectUnauthorized: false };

/** Job queue backend: Postgres (via pg-boss), not Redis/BullMQ.
 *
 *  Why: Upstash's free Redis tier has a hard 500,000 request/month cap, and BullMQ's
 *  internal bookkeeping (locks, markers, events) burns through that fast even at low
 *  job volume — we hit "max requests limit exceeded" in production.
 *
 *  Which Postgres: a dedicated Railway Postgres, NOT Supabase, since 2026-10-01. The queue
 *  lived in Supabase first ("one less service"), but an always-on queue means always-on
 *  polling, and even at the 30s backstop that idle chatter was ~170 MB/day of pooler egress
 *  plus ~100 MB/day of Supabase Log Ingestion — the free tier's 1 GB log quota gone in ten
 *  days, org restricted, app down (see docs/EGRESS_AUDIT.md). On Railway the agent-server and
 *  its queue DB share a private network: the same chatter costs nothing and generates no
 *  Supabase logs. App data (tenants, leads, articles) stays in Supabase via supabase.ts —
 *  only pg-boss's own bookkeeping lives here. Pointing DATABASE_URL back at Supabase still
 *  works (local dev), it just spends quota.
 *
 *  pg-boss auto-creates its own schema/tables in Postgres on start() (default schema
 *  "pgboss") — no manual migration needed, which is also what makes the move safe: a fresh
 *  database simply starts with an empty queue. Switch when nothing is mid-run.
 *
 *  LISTEN/NOTIFY needs a session-pinned connection. Railway Postgres is a direct connection,
 *  so it simply works; on Supabase it required the Session pooler (transaction mode breaks it). */
export const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  ssl: queueSsl,
  // Kept small on purpose. Railway's Postgres default max_connections is generous, but the
  // habit came from Supabase's Session pooler (15 connections total on free/nano) and it
  // still protects local dev + Railway connecting to the same queue DB at once.
  max: 5,
  connectionTimeoutMillis: 15000,
  // LISTEN/NOTIFY: a worker is woken the moment a job is created instead of finding it on its
  // next poll, which is what lets the polling interval drop from 2s to 30s (queues.ts) without
  // any job starting later than it does today.
  //
  // Why this matters on the money side: 13 queues polling every 2 seconds is ~560,000 queries
  // a day against Supabase, forever, whether or not anybody uses the product — and on
  // 2026-09-05 the free plan's 5 GB egress allowance was gone in four days (7.67 GB) with one
  // active user, which restricted the whole org. This is the single biggest always-on
  // consumer we control.
  //
  // Safe if it cannot be established: it needs a session-pinned connection (it will not work
  // through a transaction-mode pooler), and when it fails pg-boss emits a warning and keeps
  // polling. The polling interval is the correctness floor either way, never the only path.
  useListenNotify: true,
});

boss.on("error", (err) => console.error("[pg-boss] error:", err.message));

let startPromise: Promise<PgBoss> | null = null;

/** Idempotent — safe to call from multiple entry points (server boot, workers, health check). */
export function ensureBossStarted(): Promise<PgBoss> {
  if (!startPromise) {
    startPromise = boss.start().then(() => {
      console.log("[pg-boss] started (Postgres-backed queue)");
      return boss;
    });
  }
  return startPromise;
}
