import type { SupabaseClient } from "@supabase/supabase-js";

/** Everything the chat needs to know before it can answer, gathered in PARALLEL.
 *
 *  This file exists because of a stopwatch. Asking Mr Lxwa "hi hello" took 6-7 seconds, and
 *  almost none of that was the model: the route made seven Supabase round trips one after the
 *  other — auth.getUser, memberships, tenants, site_pages, the conversation row, the message
 *  history, the job log — and only then started thinking. Each hop is a few hundred
 *  milliseconds to a hosted Postgres; strung end to end they are most of the wait.
 *
 *  Nothing here is new work. It is the same queries, started together, on one client, with
 *  one auth check instead of two.
 */

export type Turn = { role: "user" | "assistant"; content: string };

export type ChatContext = {
  business: string | null;
  recentWork: string | null;
  schedule: string | null;
  history: Turn[];
};

/** The tenant's saved profile plus a few real page titles — what "what do you know about my
 *  business?" has to be answered from. */
export async function loadBusiness(supabase: SupabaseClient, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const [{ data: tenant }, { data: samplePages }] = await Promise.all([
      supabase.from("tenants").select("website_url, niche, tone_profile, icp_profile, onboarded").eq("id", tenantId).single(),
      supabase.from("site_pages").select("title").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(6),
    ]);
    if (!tenant || !tenant.onboarded) return null;

    const tone = (tenant.tone_profile as any) ?? {};
    const icp = (tenant.icp_profile as any) ?? {};
    const facts: string[] = [];
    if (tenant.website_url) facts.push(`website=${tenant.website_url}`);
    if (tenant.niche) facts.push(`niche=${tenant.niche}`);
    if (icp.businessType) facts.push(`business type=${icp.businessType}`);
    if (tone.audience) facts.push(`audience=${tone.audience}`);
    if (tone.tone) facts.push(`brand tone=${tone.tone}`);
    if (Array.isArray(tone.topics) && tone.topics.length) facts.push(`content topics=${tone.topics.join(", ")}`);
    if (samplePages?.length) facts.push(`recently read pages=${samplePages.map((p) => p.title).join(", ")}`);

    return facts.length ? facts.join(" · ") : null;
  } catch (e: any) {
    console.error("[chat] business context failed:", e?.message);
    return null;
  }
}

/** The last few real jobs, one line each. Without this Mr Lxwa could only invent an answer to
 *  "what did the team do?" — and invention is the one thing he must not do. */
export async function loadRecentWork(supabase: SupabaseClient, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const { data } = await supabase
      .from("jobs_log")
      .select("agent, action, status, detail, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (!data?.length) return null;
    return data
      .map((j: any) => {
        const when = new Date(j.created_at).toLocaleString();
        const what = j.action && j.action !== j.agent ? j.action : j.agent;
        const hint = j.detail?.hint ? ` (${String(j.detail.hint).slice(0, 200)})` : "";
        const outcome =
          j.status === "error" ? `FAILED: ${String(j.detail?.message ?? "unknown error").slice(0, 200)}${hint}`
          : j.status === "success" ? "done"
          : j.status;
        return `- ${when} · ${j.agent} · ${what} — ${outcome}`;
      })
      .join("\n");
  } catch (e: any) {
    console.error("[chat] recent work failed:", e?.message);
    return null;
  }
}

/** The automation calendar, in the same words the Schedule page uses.
 *
 *  Mr Lxwa used to be blind to this: asked "kaunsa task schedule pe hai aur kitne baje?" he
 *  had nothing to read, so he changed the subject. The schedules table was right there. */
export async function loadSchedule(supabase: SupabaseClient, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  try {
    // select("*") on purpose: auto_publish arrives with migration 014, and naming it in the
    // column list would make this whole block fail on a database that hasn't run it yet —
    // costing Mr Lxwa every other schedule fact over one missing column.
    const { data } = await supabase.from("schedules").select("*").eq("tenant_id", tenantId);
    if (!data?.length) return "No automatic schedule has been set up yet.";

    return data
      .map((s: any) => {
        if (!s.enabled) return `- ${s.kind}: automation is OFF.`;
        const next = nextRunAt(s);
        const when =
          s.frequency === "weekly" ? `every ${DAYS[s.day_of_week] ?? "Monday"}`
          : s.frequency === "weekdays" ? "every weekday (Mon-Fri)"
          : "every day";
        return [
          `- ${s.kind}: ON, ${when} at ${s.time_of_day} ${s.timezone}, ${s.count} per run`,
          s.auto_publish ? "publishes straight to the site with no review" : "lands in Approvals for review",
          next ? `next run ${next.toISOString()}` : null,
          s.last_run_at ? `last ran ${new Date(s.last_run_at).toISOString()}` : "has not run yet",
        ].filter(Boolean).join(" · ");
      })
      .join("\n");
  } catch (e: any) {
    // Before migration 014 the auto_publish column doesn't exist. Say nothing rather than
    // making the model guess.
    console.error("[chat] schedule context failed:", e?.message);
    return null;
  }
}

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** THE one implementation of "when does this fire next".
 *
 *  It used to exist twice — once in the scheduler that actually fires, once in the page that
 *  tells you when it will — and two copies of a timezone calculation is two answers waiting to
 *  disagree. The API now serves this to the page, and the agent-server's isDue() checks the
 *  same fields.
 */
export function nextRunAt(
  s: { frequency: string; day_of_week: number; time_of_day: string; timezone: string },
  from: Date = new Date()
): Date | null {
  const [hh, mm] = String(s.time_of_day ?? "09:00").split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
    // Walk forward in real time, then ask what the wall clock says in the tenant's zone —
    // the only way to land on "09:00 in Asia/Dubai" without a date library.
    const probe = new Date(from.getTime() + dayOffset * 86400000);
    let parts;
    try {
      parts = localParts(probe, s.timezone);
    } catch {
      return null; // invalid IANA name; the API rejects these on save
    }
    if (s.frequency === "weekdays" && (parts.dow === 0 || parts.dow === 6)) continue;
    if (s.frequency === "weekly" && parts.dow !== Number(s.day_of_week)) continue;

    // Offset between UTC and the tenant's zone at this moment, so the slot can be expressed
    // as a real instant rather than a wall-clock string.
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hh, mm, 0);
    const zoneOffsetMs = probe.getTime() - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const instant = new Date(asUtc + zoneOffsetMs);
    if (instant.getTime() > from.getTime()) return instant;
  }
  return null;
}

export function localParts(at: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
    dow: DOW[p.weekday] ?? 0,
  };
}
