import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTimeOfDay } from "@/lib/when";

/** Changing the RECURRING schedule by talking to Mr Lxwa.
 *
 *  "roz subah 9 baje 3 article banao", "automation band kar do", "seedha publish kar diya karo".
 *  Until this existed the chat could book a one-off order but not touch the timetable, so
 *  "control the whole site from the chat box" stopped at the one screen the customer most often
 *  wants to change — and asked to change it, Mr Lxwa could only describe the Schedule page.
 *
 *  A PARTIAL EDIT, NEVER A FORM SUBMIT. /api/schedule PUT upserts a whole row: send it a
 *  timeOfDay and nothing else and the frequency, the count and the auto-publish flag all snap
 *  back to their defaults. Someone saying "9 baje kar do" is changing ONE thing and would have
 *  no idea the other three moved. So the current row is read first and the patch applied on
 *  top of it.
 */

export type SchedulePatch = {
  enabled?: boolean;
  frequency?: "daily" | "weekdays" | "weekly";
  dayOfWeek?: number;
  timeOfDay?: string;
  count?: number;
  autoPublish?: boolean;
};

/* ── Reading the instruction ──────────────────────────────────────────────────────────── */

// The words that make a message about the TIMETABLE rather than about one article.
const SCHEDULE_WORD = /\b(schedule|schudule|schedual|shedule|automation|automatic|automate)\b/i;
const RECUR =
  /\b(roz|rozana|rozaana|har\s*din|har\s*roz|daily|every\s*day|weekday|weekdays|har\s*hafte|weekly|har\s*(?:somvar|mangal|budh|guru|shukra|shani|ravi)\w*|every\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
// Turning it on or off. "band"/"bandh" is Urdu/Hindi for closed; "chalu" for started.
const TURN_OFF = /\b(band|bandh|off|disable|stop|rok\s*do|rokdo|mat\s*chalao|pause)\b/i;
const TURN_ON = /\b(chalu|chaalu|on|enable|start|shuru)\b/i;
// An instruction, as opposed to a question about the same subject. "9 baje wala schedule kya
// hai?" mentions a time and the schedule and asks for nothing to change.
//
// `kar\s*do\w*` rather than `kar\s*do`, and `banao` at all. Both were found by the tests, not
// by reading: "roz 9 baje kar doge?" is a bare word boundary away from "kar do" and matched
// nothing, and "roz subah 9 baje 3 article banao" — the single most natural way anyone phrases
// this — used a verb that was simply not in the list.
const SET_VERB =
  /\b(kar\s*do\w*|kardo|karo|karna|set|change|badal\w*|rakho|rakh\s*do|lagao|laga\s*do|update|kar\s*dena|kar\s*diya\s*karo|banao|bana\s*do|bana\s*dena|chahiye|chaiye)\b/i;

const DAY_INDEX: Record<string, number> = {
  ravi: 0, sunday: 0, somvar: 1, som: 1, monday: 1, mangal: 2, tuesday: 2,
  budh: 3, wednesday: 3, guru: 4, thursday: 4, brihaspati: 4,
  shukra: 5, friday: 5, shani: 6, saturday: 6,
};

// "3 article roz", "2 posts per day". Bounded 1-5 by the API, so a "10 article" is clamped
// rather than rejected — the customer still gets a schedule, and the reply says what it is.
const COUNT = /\b(\d{1,2})\s*(?:articles?|artic\w*|blogs?|posts?|pieces?)\b/i;

// Straight to the site, versus into the approval queue. Same words the one-off orders use, and
// the negative side wins for the same reason: publishing is the irreversible one.
const WANTS_AUTO_PUBLISH =
  /\b(?:seedha|seedhe|sidha|sidhe|directly|straight)\b[^.!?]{0,24}?\bpublish\w*|\bbina\s+(?:review|approval)\b|\bwithout\s+(?:review|approval)\b|\bauto[\s-]?publish\b/i;
const WANTS_APPROVAL =
  /\b(?:approval|approve|review)\s*(?:me|mein|ke liye|for|first|pehle)\b|\bmujhe\s+(?:dikha|dekhne)\w*|\bshow\s+me\s+first\b|\bauto[\s-]?publish\s*(?:band|off|nahi|mat)\b/i;

/** Reads a timetable change out of a message, or returns null.
 *
 *  Null is the common answer and the safe one: everything it does not recognise falls through
 *  to a normal conversation, where the worst case is Mr Lxwa saying he is not sure. A wrong
 *  patch silently rewrites when the customer's site publishes. */
export function parseScheduleCommand(raw: string): SchedulePatch | null {
  const q = String(raw ?? "").trim();
  if (!q || q.length > 400) return null;

  const onOff = TURN_OFF.test(q) || TURN_ON.test(q);
  const mentionsTimetable = SCHEDULE_WORD.test(q) || RECUR.test(q);
  if (!mentionsTimetable) return null;

  // Without an on/off word this has to look like an instruction. "mera schedule kya hai" and
  // "schedule kab chalta hai" mention the timetable and ask about it; neither should rewrite it.
  if (!onOff && !SET_VERB.test(q)) return null;

  const patch: SchedulePatch = {};

  // Off wins over on: "chalu hai to band kar do" contains both, and the instruction is the
  // second half. Stopping something that should have kept running is a complaint; starting
  // something that should have stayed off publishes to a live site.
  if (TURN_OFF.test(q)) patch.enabled = false;
  else if (TURN_ON.test(q)) patch.enabled = true;

  const time = parseTimeOfDay(q);
  if (time) patch.timeOfDay = time;

  if (/\bweekdays?\b|\bhar\s*(?:working|kaam)\s*din\b|mon(?:day)?\s*(?:se|to|-)\s*fri(?:day)?/i.test(q)) {
    patch.frequency = "weekdays";
  } else if (/\b(?:har\s*hafte|weekly|every\s*week)\b/i.test(q)) {
    patch.frequency = "weekly";
  } else {
    const dayM = q.match(
      /\bhar\s*(somvar|mangal|budh|guru|shukra|shani|ravi)\w*|\bevery\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
    );
    if (dayM) {
      const key = (dayM[1] ?? dayM[2] ?? "").toLowerCase();
      const idx = DAY_INDEX[key];
      if (idx != null) { patch.frequency = "weekly"; patch.dayOfWeek = idx; }
    } else if (/\b(?:roz|rozana|rozaana|har\s*din|har\s*roz|daily|every\s*day)\b/i.test(q)) {
      patch.frequency = "daily";
    }
  }

  const countM = q.match(COUNT);
  if (countM) {
    const n = Number(countM[1]);
    if (Number.isFinite(n) && n > 0) patch.count = Math.min(5, n);
  }

  // The negative is tested first and returns, rather than both being tested and the later one
  // winning by accident of ordering.
  if (WANTS_APPROVAL.test(q)) patch.autoPublish = false;
  else if (WANTS_AUTO_PUBLISH.test(q)) patch.autoPublish = true;

  // A message that mentioned the schedule and changed nothing is not a command. Answering it
  // with "saved" would be a confirmation of no change at all.
  return Object.keys(patch).length ? patch : null;
}

/* ── Applying it ──────────────────────────────────────────────────────────────────────── */

export type ScheduleRow = {
  enabled: boolean; frequency: string; day_of_week: number; time_of_day: string;
  timezone: string; count: number; auto_publish: boolean;
};

const DEFAULTS: ScheduleRow = {
  enabled: false, frequency: "daily", day_of_week: 1, time_of_day: "09:00",
  timezone: "UTC", count: 2, auto_publish: false,
};

/** The row as it stands, or the same defaults the Schedule page shows for a tenant with none.
 *  select("*") for the reason every other reader of this table uses it: auto_publish arrives
 *  with migration 014, and naming it breaks the whole read on a database one file behind. */
export async function currentSchedule(supabase: SupabaseClient, tenantId: string): Promise<ScheduleRow> {
  const { data } = await supabase.from("schedules").select("*").eq("tenant_id", tenantId).eq("kind", "article").limit(1);
  const r = data?.[0] as any;
  if (!r) return { ...DEFAULTS };
  return {
    enabled: r.enabled === true,
    frequency: String(r.frequency ?? DEFAULTS.frequency),
    day_of_week: Number(r.day_of_week ?? DEFAULTS.day_of_week),
    time_of_day: String(r.time_of_day ?? DEFAULTS.time_of_day).slice(0, 5),
    timezone: String(r.timezone ?? DEFAULTS.timezone),
    count: Number(r.count ?? DEFAULTS.count),
    auto_publish: r.auto_publish === true,
  };
}

export type ApplyResult = { ok: boolean; row?: ScheduleRow; error?: string; autoPublishAvailable?: boolean };

/** Merges the patch onto the current row and writes it back.
 *
 *  Turning the schedule ON is treated as part of setting a time: someone who says "roz 9 baje
 *  article banao" is asking for articles at nine, not for a disabled row that would have made
 *  articles at nine. Turning it OFF is never inferred — only an explicit word does that. */
export async function applySchedule(
  supabase: SupabaseClient,
  tenantId: string,
  patch: SchedulePatch
): Promise<ApplyResult> {
  const now = await currentSchedule(supabase, tenantId);

  const enabled =
    patch.enabled != null ? patch.enabled
    : patch.timeOfDay || patch.frequency || patch.count != null ? true
    : now.enabled;

  const row = {
    tenant_id: tenantId,
    kind: "article",
    enabled,
    frequency: patch.frequency ?? now.frequency,
    day_of_week: patch.dayOfWeek ?? now.day_of_week,
    time_of_day: patch.timeOfDay ?? now.time_of_day,
    timezone: now.timezone,
    count: Math.min(5, Math.max(1, patch.count ?? now.count)),
    updated_at: new Date().toISOString(),
  };
  const autoPublish = patch.autoPublish ?? now.auto_publish;

  let autoPublishAvailable = true;
  let { error } = await supabase
    .from("schedules")
    .upsert({ ...row, auto_publish: autoPublish }, { onConflict: "tenant_id,kind" });

  if (error && /auto_publish/.test(error.message)) {
    // Migration 014 not run. Save the rest rather than losing the change, and say which half
    // did not land — the alternative is telling someone auto-publish is on when the column it
    // lives in does not exist.
    autoPublishAvailable = false;
    ({ error } = await supabase.from("schedules").upsert(row, { onConflict: "tenant_id,kind" }));
  }

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    autoPublishAvailable,
    row: {
      enabled: row.enabled, frequency: row.frequency, day_of_week: row.day_of_week,
      time_of_day: row.time_of_day, timezone: row.timezone, count: row.count,
      auto_publish: autoPublishAvailable ? autoPublish : false,
    },
  };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The saved row, read back as a sentence. Built from what was WRITTEN, not from what was
 *  asked for — so a clamped count or an auto-publish flag that could not be stored shows up
 *  in the confirmation instead of being discovered a week later. */
export function describeSchedule(r: ScheduleRow): string {
  if (!r.enabled) return "Automation is **off** — nothing runs by itself.";
  const when =
    r.frequency === "weekly" ? `every ${DAY_NAMES[r.day_of_week] ?? "Monday"}`
    : r.frequency === "weekdays" ? "every weekday (Mon–Fri)"
    : "every day";
  const lands = r.auto_publish ? "**straight to your site**, no approval step" : "in **Approvals** for review";
  return `${when} at **${r.time_of_day}** ${r.timezone} · ${r.count} article${r.count === 1 ? "" : "s"} per run · lands ${lands}`;
}
