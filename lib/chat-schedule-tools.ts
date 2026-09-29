/** lib/chat-schedule-tools.ts — the tools Mr Lxwa calls to CHANGE THE TIMETABLE.
 *
 *  WHY THIS EXISTS. Reported live 2026-09-28. The customer wrote:
 *
 *      "ispe ek new task add karo ok mujhe har roz mere site ka audit rport batana ok possible ha"
 *
 *  and was answered "Saved — every day at 09:00 Asia/Calcutta · 2 articles per run · lands in
 *  Approvals for review." No audit was scheduled. What actually happened, confirmed in the row:
 *  their existing WEEKLY article timetable was rewritten to DAILY. They asked for a report they
 *  were not getting and received seven times the article spend they had not asked for, reported
 *  as a success.
 *
 *  THE CAUSE, EXACTLY. `parseScheduleCommand` in lib/chat-schedule.ts is a regular expression. It
 *  reads WHEN — "har roz" became frequency=daily — and it has no concept of WHAT. The word
 *  "audit" in that sentence matched nothing at all, and `applySchedule` only ever wrote the row
 *  where kind='article'. So the one piece of the request that mattered was the one piece nothing
 *  in the path could see, and a pattern that matched half a sentence was allowed to write a
 *  setting and call it done.
 *
 *  It is the same mistake lib/chat-data-tools.ts was written to undo on the reading side, and its
 *  header already says why regexes lose: "it made the numbers right and everything else worse …
 *  every new phrasing needed a new pattern". That argument is stronger here, not weaker. A wrong
 *  READ is a sentence the customer can disbelieve. A wrong WRITE changes what their money is
 *  spent on every morning at nine, silently, until they happen to look.
 *
 *  SO: TOOLS, AND THE SAME SPLIT. The model keeps the language — understanding Hinglish, deciding
 *  that this is a timetable change, working out which timetable and how often. It cannot write a
 *  schedule without naming the KIND, because the schema requires it. There is no default and no
 *  fallback: a kind this product cannot schedule comes back as a refusal that says what it CAN
 *  schedule, never as a quiet write to the nearest row that happens to exist.
 *
 *  NOTHING HERE MATCHES THE CUSTOMER'S WORDS. No phrase list, no pattern, no "if it says audit".
 *  The model reads the sentence; this file validates a structured request and reports what
 *  actually changed. That is the rule the owner set when the read tools were built, and it is the
 *  rule this file is an apology for having broken on the write side.
 *
 *  WHAT IT REPORTS BACK. Every successful write returns `before` and `after`. The model is told
 *  to name what moved, so "I meant the audit, not my articles" is catchable in the same breath
 *  rather than a week later. The failure above would have been visible in its own confirmation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatTool } from "@/lib/chat-tools";
import {
  SCHEDULE_KINDS,
  applySchedule,
  currentSchedule,
  isScheduleKind,
  type ScheduleKind,
  type ScheduleRow,
} from "@/lib/chat-schedule";

/* ── The tools, as the model sees them ───────────────────────────────────────────────────── */

/** Write tools are prefixed so `isWriteTool` never has to know the list, and so neither an agent
 *  action nor a `lookup_` read can ever collide with one. */
export const WRITE_PREFIX = "manage_";

export const MANAGE_SCHEDULE = "manage_schedule";

export function isWriteTool(name: string | null | undefined): boolean {
  return typeof name === "string" && name.startsWith(WRITE_PREFIX);
}

/** Built from SCHEDULE_KINDS rather than typed out, so a kind added to that list is offered to
 *  the model on the next request and a kind removed from it stops being offerable — instead of
 *  the tool advertising something the scheduler will silently skip. */
const KIND_ENUM = Object.keys(SCHEDULE_KINDS) as ScheduleKind[];
const KIND_HELP = KIND_ENUM.map((k) => `'${k}' — ${SCHEDULE_KINDS[k].runs}`).join("; ");

const RAW_WRITE_TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: MANAGE_SCHEDULE,
      description:
        "Change the customer's RECURRING timetable — the standing instruction for work that repeats by itself. " +
        'Call this for "roz subah 9 baje 2 article banao", "har Monday article likho", "har roz site ka audit ' +
        'report do", "ek naya task add karo", "schedule daily kar do", "change my schedule to weekdays" — and for ' +
        'STOPPING one just the same: "is schedule ko close kar do", "automation band kar do", "rok do", "pause ' +
        'karo", "turn it off", "schedule hata do" (that is enabled=false; the timetable is kept so they can switch ' +
        "it back on, and nothing is deleted). " +
        "\n\n" +
        "YOU MUST NAME THE KIND. It is the only required field and it is never assumed: " +
        KIND_HELP +
        ". If the customer asks to schedule something that is not in that list, do NOT pick the nearest one — call " +
        "this tool with the kind you believe they meant and the refusal will say what is possible, or simply tell " +
        "them it cannot be scheduled yet. Rewriting the wrong timetable is the single worst thing this tool can do.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: KIND_ENUM,
            description:
              "WHICH recurring job the customer is talking about. Read it from their sentence — an audit or report " +
              "request is 'audit', an article/post/content request is 'article'. Never guess from the schedule that " +
              "already exists.",
          },
          enabled: {
            type: "boolean",
            description:
              'false to switch this timetable OFF — "close kar do", "band kar do", "rok do", "stop", "pause", ' +
              '"hata do", "turn it off". true to switch it back on ("chalu karo", "start"). Leave it out when they ' +
              "are only changing when or how much — setting a time turns it on by itself. Switching off KEEPS the " +
              "timetable, it does not delete it, so say it is paused/off rather than gone.",
          },
          frequency: {
            type: "string",
            enum: ["daily", "weekdays", "weekly"],
            description:
              "'daily' for roz/har din/every day, 'weekdays' for Mon-Fri only, 'weekly' for once a week (then also " +
              "give day_of_week). Leave it out to keep what they have.",
          },
          day_of_week: {
            type: "integer",
            minimum: 0,
            maximum: 6,
            description: "0 = Sunday … 6 = Saturday. Only meaningful with frequency 'weekly'.",
          },
          time_of_day: {
            type: "string",
            description:
              "24-hour HH:MM in the customer's own timezone, e.g. '09:00', '18:30'. Convert their words: " +
              '"subah 9 baje" is 09:00, "shaam 6 baje" is 18:30 only if they said 6:30 — do not invent minutes.',
          },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "How many articles per run. ARTICLES ONLY — it means nothing for an audit. Maximum 5.",
          },
          auto_publish: {
            type: "boolean",
            description:
              "ARTICLES ONLY. true means finished articles go straight to the live site; false means they wait in " +
              "Approvals. Only ever set true when the customer has clearly asked for it in this message.",
          },
        },
        required: ["kind"],
        additionalProperties: false,
      },
    },
  },
];

/** Appended to every write tool's description.
 *
 *  The read tools carry the mirror image of this (`NEVER_FOR_ORDERS`, lib/chat-data-tools.ts)
 *  because once lookups existed, orders started landing on them. The same confusion runs the
 *  other way: "aaj ka audit karo" is one audit now, and answering it by booking a daily audit
 *  forever is a different thing than was asked for — and one the customer has to notice to undo.
 */
const ONLY_FOR_RECURRING =
  "\n\nTHIS IS THE REPEATING TIMETABLE, NOT A ONE-OFF. If the customer wants something done ONCE — now, today, " +
  'tomorrow, "abhi karo", "aaj kar do", "ek article likho" — call that agent\'s own action instead. Booking a ' +
  "standing daily job when they asked for one run means work and money they did not agree to, every day, until " +
  "they spot it.";

export const WRITE_TOOLS: ChatTool[] = RAW_WRITE_TOOLS.map((t) => ({
  ...t,
  function: { ...t.function, description: t.function.description + ONLY_FOR_RECURRING },
}));

/* ── Running one ─────────────────────────────────────────────────────────────────────────── */

export type WriteResult = {
  ok: boolean;
  tool: string;
  /** What changed, for the model to read back. Present only on success. */
  data?: unknown;
  /** Why nothing changed. The model is told to relay this rather than soften it. */
  note?: string;
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function runWriteTool(
  name: string,
  args: Record<string, unknown>,
  supabase: SupabaseClient,
  tenantId: string
): Promise<WriteResult> {
  try {
    switch (name) {
      case MANAGE_SCHEDULE:
        return await manageSchedule(supabase, tenantId, args);
      default:
        return { ok: false, tool: name, note: "No such setting." };
    }
  } catch (e: any) {
    // Surfaced, never swallowed. A model told "the write failed" says so; a model handed silence
    // after asking to change a setting tends to report the change it intended.
    console.error(`[chat-write] ${name} failed:`, e?.message);
    return { ok: false, tool: name, note: `That change did not save: ${String(e?.message ?? "unknown error")}` };
  }
}

async function manageSchedule(
  supabase: SupabaseClient,
  tenantId: string,
  args: Record<string, unknown>
): Promise<WriteResult> {
  // THE GUARD THIS FILE EXISTS FOR. An unknown or missing kind is a refusal that names the real
  // options — never a default, and above all never a write to kind='article' because that is the
  // row that happens to exist. Getting this wrong is what cost the customer a 7x article bill.
  const kind = args?.kind;
  if (!isScheduleKind(kind)) {
    return {
      ok: false,
      tool: MANAGE_SCHEDULE,
      note:
        `Nothing was changed. ${kind == null ? "No kind of schedule was named" : `"${String(kind)}" is not something this product can put on a timetable`}. ` +
        `What can be scheduled: ${KIND_HELP}. Tell the customer plainly that this particular thing cannot be ` +
        `scheduled yet, and do not offer to set up one of the others unless that is what they meant.`,
    };
  }

  const spec = SCHEDULE_KINDS[kind];
  const before = await currentSchedule(supabase, tenantId, kind);

  // Fields that mean nothing for this kind are DROPPED and said out loud, rather than written to
  // a column where they would read as a real setting later.
  const ignored: string[] = [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

  let count = num(args?.count);
  let autoPublish = typeof args?.auto_publish === "boolean" ? (args.auto_publish as boolean) : undefined;
  if (!spec.takesCount) {
    if (count != null) ignored.push(`count (${count}) — an ${kind} run has no article count`);
    if (autoPublish != null) ignored.push(`auto_publish — nothing is published by an ${kind} run`);
    count = undefined;
    autoPublish = undefined;
  }

  const frequency = args?.frequency;
  if (frequency != null && !["daily", "weekdays", "weekly"].includes(String(frequency))) {
    return { ok: false, tool: MANAGE_SCHEDULE, note: `"${String(frequency)}" is not a frequency. Use daily, weekdays or weekly. Nothing was changed.` };
  }

  const time = args?.time_of_day;
  if (time != null && !HHMM.test(String(time))) {
    return { ok: false, tool: MANAGE_SCHEDULE, note: `"${String(time)}" is not a 24-hour HH:MM time. Nothing was changed — ask the customer what time they meant.` };
  }

  const day = num(args?.day_of_week);
  if (day != null && (day < 0 || day > 6 || !Number.isInteger(day))) {
    return { ok: false, tool: MANAGE_SCHEDULE, note: `day_of_week must be 0 (Sunday) to 6 (Saturday). Nothing was changed.` };
  }

  const res = await applySchedule(
    supabase,
    tenantId,
    {
      ...(typeof args?.enabled === "boolean" ? { enabled: args.enabled as boolean } : {}),
      ...(frequency != null ? { frequency: String(frequency) as "daily" | "weekdays" | "weekly" } : {}),
      ...(day != null ? { dayOfWeek: day } : {}),
      ...(time != null ? { timeOfDay: String(time) } : {}),
      ...(count != null ? { count } : {}),
      ...(autoPublish != null ? { autoPublish } : {}),
    },
    kind
  );

  if (!res.ok || !res.row) {
    return {
      ok: false,
      tool: MANAGE_SCHEDULE,
      note:
        `The ${kind} schedule did NOT save: ${res.error ?? "unknown error"}. It is unchanged` +
        (/violates check constraint/i.test(res.error ?? "")
          ? ` — this database has not run supabase/migrations/027_schedule_audit_kind.sql yet, so '${kind}' is not a kind it accepts.`
          : ".") +
        " Say so; do not describe the change as done.",
    };
  }

  return {
    ok: true,
    tool: MANAGE_SCHEDULE,
    data: {
      kind,
      runs: spec.runs,
      before: summarise(before, kind),
      after: summarise(res.row, kind),
      changed: diff(before, res.row, kind),
      ...(ignored.length ? { ignored_because_they_do_not_apply: ignored } : {}),
      ...(res.autoPublishAvailable === false && autoPublish === true
        ? { auto_publish_did_not_save: "That column is not in this database yet (migration 014). Everything else saved." }
        : {}),
    },
  };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** One row as plain fields, with the article-only ones left out of an audit row so the model is
 *  never handed a "2 articles per run" to read off a timetable that writes no articles. */
function summarise(r: ScheduleRow, kind: ScheduleKind) {
  const when =
    r.frequency === "weekly" ? `every ${DAY_NAMES[r.day_of_week] ?? "Monday"}`
    : r.frequency === "weekdays" ? "every weekday (Mon-Fri)"
    : "every day";
  return {
    enabled: r.enabled,
    when: r.enabled ? `${when} at ${r.time_of_day} ${r.timezone}` : "off — nothing runs by itself",
    ...(SCHEDULE_KINDS[kind].takesCount
      ? { articles_per_run: r.count, goes_to: r.auto_publish ? "published straight to the site" : "Approvals, for review" }
      : {}),
  };
}

/** Named differences only. An empty list is itself an answer — "saved" on a request that changed
 *  nothing is the confirmation that hides a misunderstanding. */
function diff(before: ScheduleRow, after: ScheduleRow, kind: ScheduleKind): string[] {
  const out: string[] = [];
  if (before.enabled !== after.enabled) out.push(after.enabled ? "switched ON" : "switched OFF");
  if (before.frequency !== after.frequency) out.push(`${before.frequency} → ${after.frequency}`);
  if (before.frequency === "weekly" && after.frequency === "weekly" && before.day_of_week !== after.day_of_week) {
    out.push(`${DAY_NAMES[before.day_of_week] ?? "?"} → ${DAY_NAMES[after.day_of_week] ?? "?"}`);
  }
  if (before.time_of_day !== after.time_of_day) out.push(`${before.time_of_day} → ${after.time_of_day}`);
  if (SCHEDULE_KINDS[kind].takesCount) {
    if (before.count !== after.count) out.push(`${before.count} → ${after.count} articles per run`);
    if (before.auto_publish !== after.auto_publish) {
      out.push(after.auto_publish ? "now publishes straight to the site" : "now lands in Approvals");
    }
  }
  return out;
}

/* ── Handing the result to the model ─────────────────────────────────────────────────────── */

export function writeResultBlock(result: WriteResult): string {
  const head = `TOOL RESULT — you called ${result.tool}. This is what the database now holds.`;
  if (!result.ok) {
    return [
      head,
      `NOTHING WAS CHANGED. ${result.note ?? "unknown reason"}`,
      "Tell the customer exactly that, in their own language. Do NOT say saved, done, set, ho gaya, kar diya, or " +
        "anything that means the change happened — it did not.",
    ].join("\n");
  }
  return [
    head,
    JSON.stringify(result.data, null, 1),
    // The whole point of returning `before` as well as `after`. A confirmation that only states
    // the new value reads as correct even when the wrong row was written, which is exactly how
    // "har roz audit report" came back as "2 articles per run" and went unnoticed.
    "Confirm it in one sentence, naming WHICH schedule this was and WHAT MOVED — the `changed` list is that, " +
      "already worked out. A confirmation that states only the new setting hides a change to the wrong thing.",
    "If `changed` is empty, the timetable already said this. Say that instead of saying you saved something.",
    "If `ignored_because_they_do_not_apply` is present, mention it briefly — the customer asked for something " +
      "this kind of schedule has no room for, and staying quiet about it means they think it took effect.",
    "This is a STANDING instruction you have just changed. Nothing ran now. Never say the work itself was done, " +
      'started or refreshed — no "audit kar diya", "article bana diya", "I have run".',
  ].join("\n");
}
