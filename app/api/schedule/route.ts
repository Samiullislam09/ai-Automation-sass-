import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { nextRunAt } from "@/lib/chat-context";

/** Reads/writes the tenant's recurring automation (see supabase/migrations/006_schedules.sql).
 *  The row is only configuration — what actually fires it is the minute tick in
 *  agent-server/src/scheduler.ts, which is a separate process on Railway. Saving here while
 *  agent-server is down therefore stores the intent and starts running when it comes back.
 *
 *  GET also answers "when does this fire next", as an ISO instant. That number used to be
 *  worked out a second time in the browser (app/app/schedule/page.tsx had its own copy of the
 *  timezone walk) and two implementations of a timezone calculation is two answers waiting to
 *  disagree. There is now one — nextRunAt() in lib/chat-context.ts, the same function the chat
 *  reads — and the page only formats and ticks it. */

const FREQUENCIES = ["daily", "weekdays", "weekly"];
const KINDS = ["article", "social"];

// Named so the pre-migration retry below can drop exactly this one column and nothing else.
const BASE_COLUMNS = "kind, enabled, frequency, day_of_week, time_of_day, timezone, count, last_run_at";

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let autoPublishAvailable = true;
  // Deliberately untyped: the retry below selects one column fewer, and the two row shapes
  // are not assignable to each other — the whole point of the fallback is that they differ.
  const first = await supabase.from("schedules").select(`${BASE_COLUMNS}, auto_publish`).eq("tenant_id", tenantId);
  let data: any[] | null = first.data;
  let error: { message: string } | null = first.error;

  if (error && isMissingAutoPublish(error.message)) {
    // Migration 014 hasn't been applied. The rest of the schedule is still perfectly readable,
    // so read it — and tell the page which column is missing so it can say "run migration 014"
    // next to a disabled toggle instead of showing an error where the form should be.
    autoPublishAvailable = false;
    const retry = await supabase.from("schedules").select(BASE_COLUMNS).eq("tenant_id", tenantId);
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    // Migration 006 not applied yet — say so plainly instead of rendering an empty form
    // that silently drops whatever the customer types into it.
    return NextResponse.json({ ok: false, error: error.message, needsMigration: /schedules/i.test(error.message) }, { status: 500 });
  }

  const now = new Date();
  const schedules = (data ?? []).map((row: any) => ({
    ...row,
    auto_publish: row.auto_publish ?? false,
    // Only for a schedule that is actually on. A next-run time under an off switch is a
    // promise nothing is going to keep.
    nextRunAt: row.enabled ? (nextRunAt(row, now)?.toISOString() ?? null) : null,
  }));

  return NextResponse.json({ ok: true, schedules, autoPublishAvailable, serverNow: now.toISOString() });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const kind = String(body?.kind ?? "article");
  if (!KINDS.includes(kind)) return NextResponse.json({ ok: false, error: `Unknown kind: ${kind}` }, { status: 400 });

  const frequency = String(body?.frequency ?? "daily");
  if (!FREQUENCIES.includes(frequency)) return NextResponse.json({ ok: false, error: `Unknown frequency: ${frequency}` }, { status: 400 });

  const timeOfDay = String(body?.timeOfDay ?? "09:00");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
    return NextResponse.json({ ok: false, error: "Time HH:MM format me hona chahiye (24-hour)." }, { status: 400 });
  }

  const timezone = String(body?.timezone ?? "UTC");
  // A bad IANA name would make the scheduler throw on every tick for every tenant, so it
  // is rejected here rather than at 3am in a worker.
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
  } catch {
    return NextResponse.json({ ok: false, error: `Timezone samajh nahi aaya: ${timezone}` }, { status: 400 });
  }

  const row = {
    tenant_id: tenantId,
    kind,
    enabled: body?.enabled === true,
    frequency,
    day_of_week: Math.min(6, Math.max(0, Number(body?.dayOfWeek) || 0)),
    time_of_day: timeOfDay,
    timezone,
    count: Math.min(5, Math.max(1, Number(body?.count) || 2)),
    updated_at: new Date().toISOString(),
  };

  const autoPublish = body?.autoPublish === true;
  let autoPublishAvailable = true;

  let { error } = await supabase.from("schedules").upsert({ ...row, auto_publish: autoPublish }, { onConflict: "tenant_id,kind" });

  if (error && isMissingAutoPublish(error.message)) {
    // Save the rest rather than losing the whole form over a column that isn't there yet.
    // The response says which half didn't land, so the page can keep showing the migration
    // notice instead of quietly pretending auto-publish is on.
    autoPublishAvailable = false;
    ({ error } = await supabase.from("schedules").upsert(row, { onConflict: "tenant_id,kind" }));
  }

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, autoPublishAvailable });
}

/** PostgREST reports an unknown column as PGRST204 / 42703 with the column name in the text.
 *  Matching on the name is the only signal available through supabase-js's error shape, so it
 *  is kept narrow: only auto_publish, so a genuine schema error still surfaces as an error. */
function isMissingAutoPublish(message: string | null | undefined): boolean {
  return !!message && /auto_publish/.test(message);
}
