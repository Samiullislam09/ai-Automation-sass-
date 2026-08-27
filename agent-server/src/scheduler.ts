import { randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";
import { enqueue } from "./queues.js";
import { publishContentItem } from "./lib/publish.js";
import { logJobStart, logJobFinish } from "./jobsLog.js";
import { brainTick } from "./brain/server.js";

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
  setTimeout(() => void sweep(), 5_000);
  timer = setInterval(() => void sweep(), TICK_MS);
  console.log("[scheduler] running — checking schedules and one-off orders every 60s");
}

/** Three timetables, one tick. Independent on purpose: a broken recurring schedule must not
 *  stop a customer's one-off order from firing, and vice versa.
 *
 *  `tickAudits` is the fourth, and the only one nobody books: §7.4 says the site audit is
 *  weekly by default, so it runs itself rather than waiting to be asked.
 *
 *  `brainTick` is the third: tasks booked for later (`tasks.run_at`, migration 017). It runs
 *  alongside `tickOrders` rather than replacing it, because `scheduled_orders` still holds
 *  everything booked before the brain existed — the old table drains, it is not migrated
 *  (plan §22 con #10). */
async function sweep() {
  await Promise.allSettled([tick(), tickOrders(), brainSweep(), tickAudits()]);
}

async function brainSweep() {
  try {
    const started = await brainTick();
    if (started) console.log(`[scheduler] brain started ${started} booked task(s)`);
  } catch (e: any) {
    // Before the brain has booted (or if it refused to), this is simply not its turn yet.
    if (!/has not started/i.test(e?.message ?? "")) console.error("[scheduler] brain tick failed:", e?.message);
  }
}

/* ── The weekly site audit ────────────────────────────────────────────────────────────── */

/** §7.4: "Scheduled: weekly default". Nobody books this one — a site audit is worth having
 *  precisely when the owner has stopped thinking about it, so it books itself.
 *
 *  Three deliberate limits, all for the same reason (this runs for every tenant at once and
 *  fetches fifty pages of somebody's website each time):
 *
 *   · a tenant is only audited if it has a website address AND pages we have already crawled.
 *     A half-finished signup is not a customer, and auditing one spends three minutes on a
 *     site nobody has connected;
 *   · at most `AUDITS_PER_TICK` are started per sweep, so a hundred tenants due on the same
 *     Monday become a queue that drains over an hour instead of a hundred simultaneous crawls;
 *   · there is no separate schedule table. "Is the newest audit older than a week?" is the
 *     whole rule, and it is a query — which means it survives a restart, cannot drift, and a
 *     manual audit today correctly pushes the automatic one out by a week.
 */
const AUDIT_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const AUDITS_PER_TICK = 3;

export async function tickAudits(now: Date = new Date()): Promise<number> {
  const { data: tenants, error } = await supabase.from("tenants").select("id, website_url").not("website_url", "is", null).limit(500);
  if (error) {
    console.error("[scheduler] could not read tenants for the weekly audit:", error.message);
    return 0;
  }
  if (!tenants?.length) return 0;

  let started = 0;
  for (const t of tenants) {
    if (started >= AUDITS_PER_TICK) break;
    try {
      const { data: last, error: auditError } = await supabase
        .from("site_audits")
        .select("created_at")
        .eq("tenant_id", t.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Migration 020 not applied: this is not a reason to log once a minute for every tenant,
      // and it is certainly not a reason to audit everybody. Stop the sweep entirely.
      if (auditError) {
        console.error("[scheduler] weekly audit paused:", auditError.message);
        return started;
      }

      const lastAt = last?.created_at ? new Date(last.created_at).getTime() : 0;
      if (lastAt && now.getTime() - lastAt < AUDIT_EVERY_MS) continue;

      // Never audit a site we have not read: an account that stopped halfway through signup
      // has an address and nothing behind it.
      const { count } = await supabase.from("site_pages").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);
      if (!count) continue;

      await enqueue("audit", { tenantId: t.id, taskLabel: "Weekly site audit", source: "schedule" } as any);
      started++;
      console.log(`[scheduler] tenant ${t.id}: weekly site audit enqueued`);
    } catch (e: any) {
      console.error(`[scheduler] weekly audit for tenant ${t.id} failed:`, e?.message);
    }
  }
  return started;
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

/* ── One-off orders placed in the chat ────────────────────────────────────────────────── */

/** "30 min baad ek article publish kar do" — supabase/migrations/015_scheduled_orders.sql.
 *
 *  The other half of the same product promise as `tick()` above, and the half that was
 *  missing. The chat could start work now, but a message with a time in it had nowhere to go:
 *  the time was dropped, the writer started immediately, and when the customer objected the
 *  model replied "Mr. Publish — queued for immediate publish (30 minutes from now)". No row,
 *  no job, and Mr. Publish had never run once.
 *
 *  Unlike the recurring schedule, missed orders ARE run late. The arguments differ: skipping a
 *  daily article costs one article out of hundreds, but skipping "publish this at 5pm" silently
 *  drops a specific thing a specific person asked for, and they will not find out until they
 *  check their site. Anything older than the grace window below is failed with a reason
 *  instead — publishing six hours late is its own kind of wrong.
 */
const ORDER_GRACE_MS = 60 * 60 * 1000;

export async function tickOrders() {
  const nowIso = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from("scheduled_orders")
    .select("*")
    .eq("status", "pending")
    .lte("run_at", nowIso)
    .order("run_at", { ascending: true })
    .limit(25);

  if (error) {
    // Table missing = migration 015 not applied. Same treatment as a missing `schedules`:
    // say so once a minute, and let every other part of the server carry on.
    console.error("[scheduler] could not read scheduled_orders:", error.message);
    return;
  }
  if (!rows?.length) return;

  for (const row of rows) {
    // Claimed BEFORE the work starts. Two ticks can overlap if an enqueue is slow, and this
    // is a customer's live website — "fired twice" is not a recoverable kind of wrong.
    const claimed = await claim(row.id);
    if (!claimed) continue;

    const late = Date.now() - new Date(row.run_at).getTime();
    if (late > ORDER_GRACE_MS) {
      const mins = Math.round(late / 60000);
      await finishOrder(row.id, "failed", null, `Missed by ${mins} minutes — not run. Nothing was published.`);
      console.warn(`[scheduler] order ${row.id} was ${mins}m late; refused`);
      continue;
    }

    try {
      const jobId = await runOrder(row);
      await finishOrder(row.id, "done", jobId, null);
      console.log(`[scheduler] order ${row.id} (${row.kind}) fired -> ${jobId ?? "done inline"}`);
    } catch (e: any) {
      await finishOrder(row.id, "failed", null, e?.message ?? "Unknown error");
      console.error(`[scheduler] order ${row.id} failed:`, e?.message);
    }
  }
}

/** Moves one row out of `pending`, and reports whether THIS caller is the one that did it.
 *  The `.eq("status", "pending")` is the lock: the second writer matches nothing. */
async function claim(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("scheduled_orders")
    .update({ status: "running", fired_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  return !error && !!data?.length;
}

async function finishOrder(id: string, status: "done" | "failed", jobId: string | null, error: string | null) {
  await supabase.from("scheduled_orders").update({ status, job_id: jobId, error }).eq("id", id);
}

/** Does the thing. Returns the agent job id when it queued one, or null when it finished on
 *  the spot (publishing is not a queue — see below). Throws on failure, so the row is marked
 *  failed with the real reason rather than quietly marked done. */
async function runOrder(row: any): Promise<string | null> {
  const tenantId = row.tenant_id as string;

  if (row.kind === "publish") {
    if (!row.content_item_id) throw new Error("No article was attached to this order.");
    return await publishOne(tenantId, String(row.content_item_id));
  }

  const chain = row.kind === "research" ? false : row.kind === "write" ? true : true;
  const autoPublish = row.auto_publish === true;
  // A scheduled write does NOT stop to ask which keyword. The customer already made the one
  // decision this run needed — when it should happen — and a countdown nobody is watching at
  // 3am resolves to the recommended keyword anyway, one hour later than it should have.
  const topic = typeof row.topic === "string" && row.topic.trim() ? row.topic.trim() : null;

  if (topic) {
    return (await enqueue("keyword", {
      tenantId, topic, chain, autoPublish,
      source: "scheduled-order",
      taskLabel: row.kind === "research" ? `Keyword research: "${topic}"` : `Researching "${topic}"`,
    } as any)) as string;
  }

  return (await enqueue("boss", {
    tenantId,
    count: row.kind === "plan" ? 3 : 1,
    chain, autoPublish,
    source: "scheduled-order",
    taskLabel: "Scheduled order — picking a topic",
  } as any)) as string;
}

/** Publishing has no queue: it is one HTTP call to the customer's site and there is nothing to
 *  chain afterwards. It is still logged as a `publish` job so it shows up in the office, the
 *  run log and the chat exactly like every other piece of work — which is the whole point.
 *  Mr. Publish having never appeared in jobs_log is what made a fabricated confirmation about
 *  him impossible to notice. */
async function publishOne(tenantId: string, itemId: string): Promise<string | null> {
  const { data: item, error } = await supabase
    .from("content_items")
    .select("id, title, body, type, status, meta")
    .eq("id", itemId)
    .eq("tenant_id", tenantId)
    .single();

  const title = item?.title ?? "the article";
  const logId = await logJobStart(tenantId, "publish", `Publishing "${title}"`);

  if (error || !item) {
    await logJobFinish(logId, { published: false, title, error: "The article no longer exists." });
    throw new Error("The article no longer exists.");
  }
  if (item.status === "published") {
    await logJobFinish(logId, { published: false, title, error: "It was already live." });
    return null;
  }
  if (!item.body) {
    await logJobFinish(logId, { published: false, title, error: "It has no body — it was never finished." });
    throw new Error("The article has no body.");
  }

  const result = await publishContentItem(tenantId, {
    id: String(item.id), title: item.title, body: item.body, type: item.type,
  });
  const prevMeta = (item.meta as Record<string, unknown>) ?? {};

  if (result.ok) {
    await supabase
      .from("content_items")
      .update({ status: "published", meta: { ...prevMeta, publishedUrl: result.url ?? null, scheduledPublish: true } })
      .eq("id", itemId);
    await logJobFinish(logId, { published: true, title, url: result.url ?? null });
    return null;
  }

  // The article is NOT marked failed. It is still a perfectly good draft waiting in Approvals,
  // and burning its status because a WordPress password expired would lose the writer's work
  // over someone else's problem.
  await logJobFinish(logId, {
    published: false, title, error: result.error,
    hint: "Check the site connection on the Connect page. The article is untouched and still in Approvals.",
  });
  throw new Error(result.error ?? "Publishing failed.");
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
