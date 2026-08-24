import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Reads/writes the tenant's recurring automation (see supabase/migrations/006_schedules.sql).
 *  The row is only configuration — what actually fires it is the minute tick in
 *  agent-server/src/scheduler.ts, which is a separate process on Railway. Saving here while
 *  agent-server is down therefore stores the intent and starts running when it comes back. */

const FREQUENCIES = ["daily", "weekdays", "weekly"];
const KINDS = ["article", "social"];

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from("schedules")
    .select("kind, enabled, frequency, day_of_week, time_of_day, timezone, count, last_run_at")
    .eq("tenant_id", tenantId);

  if (error) {
    // Migration 006 not applied yet — say so plainly instead of rendering an empty form
    // that silently drops whatever the customer types into it.
    return NextResponse.json({ ok: false, error: error.message, needsMigration: /schedules/i.test(error.message) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, schedules: data ?? [] });
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

  const { error } = await supabase.from("schedules").upsert(row, { onConflict: "tenant_id,kind" });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
