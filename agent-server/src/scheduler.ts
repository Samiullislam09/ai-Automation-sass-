import { randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";
import { enqueue } from "./queues.js";

/** The thing that makes this product actually automatic.
 *
 *  Every agent in here has always been reactive: a job existed because a human pressed
 *  "Run the team" or asked Mr Lxwa in chat. This ticks once a minute, reads the `schedules`
 *  table (supabase/migrations/006_schedules.sql) and starts the boss chain for any tenant
 *  whose local wall-clock has just reached their chosen time.
 *
 *  Why wall-clock and not a UTC cron: "har roz subah 9 baje" has to stay 9am for the
 *  customer through daylight saving. Each row carries an IANA timezone, and matching is
 *  done by formatting "now" into that zone.
 *
 *  Missed runs are NOT replayed. If Railway was asleep at 09:00 the run is simply skipped —
 *  waking up at noon and firing yesterday's backlog would spend the customer's model credits
 *  on articles they were no longer expecting.
 *
 *  Each firing gets a `scheduleRunId` that is threaded boss -> keyword -> writer and stamped
 *  on every content_items row it produces, so /app/schedule can say exactly which articles
 *  came out of the 9am run instead of guessing from timestamps.
 */

const TICK_MS = 60_000;
// A tick can land a few seconds late (or the process can be busy). Matching only the exact
// minute would silently drop those runs, so a small window is accepted — and last_run_at
// then stops the same slot firing twice inside it.
const WINDOW_MINUTES = 5;

let timer: NodeJS.Timeout | null = null;

export function startScheduler() {
  if (timer) return;
  // First sweep shortly after boot, then every minute.
  setTimeout(() => void tick(), 5_000);
  timer = setInterval(() => void tick(), TICK_MS);
  console.log("[scheduler] running — checking schedules every 60s");
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function tick() {
  // select("*") rather than a column list: auto_publish arrives with migration 014, and
  // naming it would make every tick fail — for every tenant — on a database that has not run
  // it yet. A missing column then simply reads as undefined, which falls through to false.
  const { data: rows, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("enabled", true);

  if (error) {
    // Table missing = migration 006 not applied. Say it once a minute rather than crashing
    // the whole server; every other agent keeps working without it.
    console.error("[scheduler] could not read schedules:", error.message);
    return;
  }
  if (!rows?.length) return;

  const now = new Date();
  for (const row of rows) {
    try {
      if (!isDue(row, now)) continue;

      // Only the boss chain is scheduled today. 'social' rows are rejected by the API for
      // now (the social agent is a stub) — this guard means a hand-inserted row can't
      // quietly start burning jobs either.
      if (row.kind !== "article") continue;

      // The customer approved this run when they saved the schedule; auto_publish says they
      // also approved what comes out of it. false whenever the column is missing or unset —
      // publishing on its own is never something this falls back to.
      const autoPublish = row.auto_publish === true;
      const scheduleRunId = randomUUID();

      const jobId = await enqueue("boss", {
        tenantId: row.tenant_id,
        count: row.count,
        taskLabel: "Scheduled run — planning today's topics",
        source: "schedule",
        scheduleRunId,
        autoPublish,
      } as any);

      // Written before anything else can tick again, so a slow enqueue can't double-fire.
      await supabase.from("schedules").update({ last_run_at: now.toISOString() }).eq("id", row.id);
      console.log(
        `[scheduler] tenant ${row.tenant_id}: enqueued boss job ${jobId} (${row.count} topics,` +
          ` run ${scheduleRunId}, ${autoPublish ? "auto-publish" : "approvals"})`
      );
    } catch (e: any) {
      console.error(`[scheduler] tenant ${row.tenant_id} failed:`, e?.message);
    }
  }
}

type Row = {
  frequency: string;
  day_of_week: number;
  time_of_day: string;
  timezone: string;
  last_run_at: string | null;
};

/** True when `now`, expressed in the row's own timezone, has just passed its slot and that
 *  slot hasn't already been served. Exported for the sake of being testable in isolation. */
export function isDue(row: Row, now: Date): boolean {
  let local: ReturnType<typeof localParts>;
  try {
    local = localParts(now, row.timezone);
  } catch {
    console.error(`[scheduler] invalid timezone "${row.timezone}" — skipping`);
    return false;
  }

  if (row.frequency === "weekdays" && (local.dow === 0 || local.dow === 6)) return false;
  if (row.frequency === "weekly" && local.dow !== row.day_of_week) return false;

  const [hh, mm] = row.time_of_day.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return false;

  const minutesSinceSlot = local.hour * 60 + local.minute - (hh * 60 + mm);
  if (minutesSinceSlot < 0 || minutesSinceSlot > WINDOW_MINUTES) return false;

  // Same local calendar day already ran → done. Comparing local dates (not "24h ago")
  // keeps a DST jump from either skipping a day or firing twice.
  if (row.last_run_at) {
    const last = localParts(new Date(row.last_run_at), row.timezone);
    if (last.y === local.y && last.m === local.m && last.d === local.d) return false;
  }

  return true;
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    dow: DOW[get("weekday")] ?? 0,
  };
}
