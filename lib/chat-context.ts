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
 *  business?" has to be answered from.
 *
 *  PREFERS `site_profiles` (Mr. Analyst's real output, migration 019 — the same table the Site
 *  Brain page reads) over the older `tenants.niche`/`tone_profile` fields. Found live 2026-08-29:
 *  a tenant's Site Brain page showed a full, HIGH-CONFIDENCE profile ("ISO certification &
 *  compliance...") while chat still answered "I don't know anything about your site" — because
 *  this function had never been pointed at `site_profiles` at all. `tenants.niche` stays as the
 *  fallback for a tenant that onboarded but whose analyst hasn't produced a profile yet (table
 *  missing migration 019, or no active row) — better a thin answer than none. */
export async function loadBusiness(supabase: SupabaseClient, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const [{ data: tenant }, { data: profileRow }, { data: samplePages }] = await Promise.all([
      supabase.from("tenants").select("website_url, niche, tone_profile, icp_profile, onboarded").eq("id", tenantId).single(),
      supabase.from("site_profiles").select("profile").eq("tenant_id", tenantId).eq("active", true).maybeSingle(),
      supabase.from("site_pages").select("title").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(6),
    ]);
    if (!tenant) return null;
    const profile = (profileRow?.profile as Record<string, any> | undefined) ?? null;
    // `onboarded` used to gate this whole function, on the assumption that nothing worth
    // saying could exist before the onboarding wizard finished. Found live 2026-08-29: a
    // tenant who connected WordPress from the Connect page (skipping the wizard) had a real,
    // full Mr. Analyst profile — and still got "I don't know anything about your site",
    // because this return happened before the profile was ever looked at. A real profile is
    // real regardless of how the site got connected; the flag only still matters for the
    // OLDER, thinner tenants.niche fallback below, which has nothing to say without it.
    if (!tenant.onboarded && !profile) return null;

    const facts: string[] = [];
    if (tenant.website_url) facts.push(`website=${tenant.website_url}`);

    if (profile) {
      if (profile.what_they_do) facts.push(`what they do=${profile.what_they_do}`);
      if (profile.audience) facts.push(`audience=${profile.audience}`);
      if (Array.isArray(profile.offerings) && profile.offerings.length) {
        facts.push(`offerings=${profile.offerings.map((o: any) => o?.name).filter(Boolean).join(", ")}`);
      }
      if (profile.geo) facts.push(`location/service area=${profile.geo}`);
      if (profile.voice?.tone) facts.push(`brand tone=${profile.voice.tone}`);
      if (Array.isArray(profile.topic_clusters) && profile.topic_clusters.length) {
        facts.push(`content topics=${profile.topic_clusters.map((t: any) => t?.name).filter(Boolean).slice(0, 10).join(", ")}`);
      }
    } else {
      // No Mr. Analyst profile yet — the same fields chat always fell back to.
      const tone = (tenant.tone_profile as any) ?? {};
      const icp = (tenant.icp_profile as any) ?? {};
      if (tenant.niche) facts.push(`niche=${tenant.niche}`);
      if (icp.businessType) facts.push(`business type=${icp.businessType}`);
      if (tone.audience) facts.push(`audience=${tone.audience}`);
      if (tone.tone) facts.push(`brand tone=${tone.tone}`);
      if (Array.isArray(tone.topics) && tone.topics.length) facts.push(`content topics=${tone.topics.join(", ")}`);
    }
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
      // Five, not eight. Eight rows of raw log line is more text than the rest of the prompt
      // put together, and the model answered "kya update hai" by pasting all of it back.
      .limit(5);
    if (!data?.length) return null;
    return data
      .map((j: any) => {
        const when = new Date(j.created_at).toLocaleString();
        // Job labels carry the full article title, which can run past a hundred characters
        // and drowns the outcome that actually answers the question.
        const raw = j.action && j.action !== j.agent ? j.action : j.agent;
        const what = raw.length > 70 ? raw.slice(0, 70).trimEnd() + "…" : raw;
        const hint = j.detail?.hint ? ` (${String(j.detail.hint).slice(0, 120)})` : "";
        const outcome =
          j.status === "error" ? `FAILED: ${String(j.detail?.message ?? "unknown error").slice(0, 120)}${hint}`
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
    // Both halves, read together. The recurring timetable and the one-off orders placed in the
    // chat live in two different tables, and answering from only one of them is how "kya
    // schedule pe hai" came back missing the thing the customer had booked ninety seconds ago.
    const [{ data }, oneOffs] = await Promise.all([
      supabase.from("schedules").select("*").eq("tenant_id", tenantId),
      loadPendingOrders(supabase, tenantId),
    ]);
    if (!data?.length) {
      return [oneOffs, "No recurring automatic schedule has been set up yet."].filter(Boolean).join("\n");
    }

    const recurring = data
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
          // Written out in the tenant's own timezone rather than as an ISO instant. Asked
          // "schedule kab chalta hai", the model answered "2026-08-26T03:30:00.833Z" — it had
          // been told to convert and simply pasted. A time nobody can read is not a fact the
          // model should be trusted to reformat; it is a fact this function should format.
          next ? `next run ${humanTime(next, s.timezone)} (${untilPhrase(next)})` : null,
          s.last_run_at ? `last ran ${humanTime(new Date(s.last_run_at), s.timezone)}` : "has not run yet",
        ].filter(Boolean).join(" · ");
      })
      .join("\n");

    return [recurring, oneOffs].filter(Boolean).join("\n");
  } catch (e: any) {
    // Before migration 014 the auto_publish column doesn't exist. Say nothing rather than
    // making the model guess.
    console.error("[chat] schedule context failed:", e?.message);
    return null;
  }
}

/** One-off orders placed in the chat that have not fired yet — "30 min baad publish kar do".
 *
 *  Read from the ROW, never from the sentence that created it. The row is what the scheduler
 *  will act on, so if the two ever disagree the row is the one that is true — and this is the
 *  reference Mr Lxwa answers "kya schedule pe hai" from.
 *
 *  Returns null rather than throwing when migration 015 has not been run, so the rest of the
 *  schedule answer survives a database that is one file behind. */
export async function loadPendingOrders(supabase: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("scheduled_orders")
    .select("kind, topic, auto_publish, run_at")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .order("run_at", { ascending: true })
    .limit(10);
  if (error || !data?.length) return null;

  const tzRow = await supabase.from("schedules").select("timezone").eq("tenant_id", tenantId).limit(1);
  const tz = tzRow.data?.[0]?.timezone ?? "UTC";

  const lines = (data as any[]).map((o) => {
    const what =
      o.kind === "publish" ? "publish an article that is already written"
      : o.kind === "research" ? `research keywords${o.topic ? ` for "${o.topic}"` : ""}`
      : o.kind === "plan" ? "pick this week's topics and write them"
      : `write an article${o.topic ? ` about "${o.topic}"` : ""}`;
    const lands =
      o.kind === "research" ? "nothing published"
      : o.auto_publish ? "publishes straight to the site" : "lands in Approvals";
    const at = new Date(o.run_at);
    return `- ONE-OFF: ${what} at ${humanTime(at, tz)} (${untilPhrase(at)}) · ${lands}`;
  });

  return `One-off orders the user booked in this chat, not yet fired (${lines.length}):\n${lines.join("\n")}`;
}

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Wednesday 26 August, 09:00 Asia/Calcutta" — a time a person can repeat out loud. */
export function humanTime(at: Date, timeZone: string): string {
  try {
    const s = new Intl.DateTimeFormat("en-GB", {
      timeZone, weekday: "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(at);
    return `${s} ${timeZone}`;
  } catch {
    return at.toISOString();
  }
}

/** "in 16 hours", "in 12 minutes" — the part people actually want when they ask "kab". */
export function untilPhrase(at: Date, from: Date = new Date()): string {
  const mins = Math.round((at.getTime() - from.getTime()) / 60000);
  if (mins < 1) return "any moment now";
  if (mins < 60) return `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `in ${Math.round(hours / 24)} days`;
}

/** How much has actually been produced, counted rather than estimated.
 *
 *  "kitne article ban chuke hain" was being answered off the last five job-log rows, which
 *  cannot possibly know the total — it replied "3" from a window that held two. A count is a
 *  count; it should come from a COUNT. */
export type Counts = { lines: string; awaiting: number; total: number };

export async function loadCounts(supabase: SupabaseClient, tenantId: string | null): Promise<Counts | null> {
  if (!tenantId) return null;
  try {
    const head = (status: string) =>
      supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("type", "article")
        .eq("status", status);

    const [published, awaiting, failed, draft] = await Promise.all([
      head("published"), head("awaiting_approval"), head("failed"), head("draft"),
    ]);
    const total = (published.count ?? 0) + (awaiting.count ?? 0) + (failed.count ?? 0) + (draft.count ?? 0);
    // One number per line, as key = value. Written as a sentence with the figures in
    // parentheses, the model read "total 8 (published 1, awaiting 6, failed 1)" and answered
    // "3 articles completed". A 30B model with reasoning off parses a table; it does not
    // reliably parse prose full of digits.
    return {
      total,
      awaiting: awaiting.count ?? 0,
      lines: [
        `TOTAL ARTICLES WRITTEN = ${total}`,
        `PUBLISHED = ${published.count ?? 0}`,
        `AWAITING YOUR APPROVAL = ${awaiting.count ?? 0}`,
        `FAILED = ${failed.count ?? 0}`,
        `STILL DRAFT = ${draft.count ?? 0}`,
      ].join("\n"),
    };
  } catch (e: any) {
    console.error("[chat] counts failed:", e?.message);
    return null;
  }
}

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
