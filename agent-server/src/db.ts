import { PgBoss } from "pg-boss";
import { env } from "./env.js";

// Log (once) exactly what host/port/db we parsed out of DATABASE_URL — without the
// password — so a bad/malformed env var value is obvious in the deploy logs instead of
// surfacing only as a cryptic downstream DNS/connection error.
try {
  const parsed = new URL(env.DATABASE_URL);
  console.log(
    `[db] connecting to ${parsed.hostname}:${parsed.port || 5432}${parsed.pathname} (user: ${parsed.username || "(none)"}, password set: ${!!parsed.password})`
  );
} catch (e: any) {
  console.error("[db] DATABASE_URL is not a valid URL:", e.message);
}

/** Job queue backend: Postgres (via pg-boss), not Redis/BullMQ.
 *
 *  Why: Upstash's free Redis tier has a hard 500,000 request/month cap, and BullMQ's
 *  internal bookkeeping (locks, markers, events) burns through that fast even at low
 *  job volume — we hit "max requests limit exceeded" in production. Since Supabase
 *  Postgres is already the app's database, pg-boss reuses it as the queue too: one
 *  less service to run/pay for/monitor, no per-request billing surprises.
 *
 *  pg-boss auto-creates its own schema/tables in Postgres on start() (default schema
 *  "pgboss") — no manual migration needed. */
export const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  // Supabase's pooled/direct connection strings both require SSL; rejectUnauthorized:false
  // avoids local CA-trust issues with Supabase's certificate chain.
  ssl: { rejectUnauthorized: false },
  // Supabase's Session pooler caps total connections per project (15 on the free/nano
  // tier) — keep this pool small and shared across all 5 queues rather than defaulting
  // to pg's max:10 per instance, which leaves no headroom once Railway + local dev (or
  // multiple Railway replicas) connect at the same time.
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
