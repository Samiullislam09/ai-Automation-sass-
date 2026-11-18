/** lib/autopilot.ts — the lead chain as ONE thing you can switch and tune: find leads -> first WhatsApp message -> follow-ups -> answer replies -> book the call -> reminders and report.
 *
 *  The pieces already existed, scattered: the daily lead discovery lives in `schedules` (kind 'leads'), and the WhatsApp engine's switches live in agent_settings
 *  (auto-reply, first messages, follow-ups, sending hours, reminders, daily summary). Nothing showed them together, nothing could turn the whole chain on or off, and the
 *  chat could not touch any of it. This module is the single place that READS that picture (shapeAutopilot, in lib/chat-lead-tools.ts), SUMMARISES the settings, and APPLIES a
 *  change — used by the Autopilot page's API (app/api/autopilot) and by the chat's `manage_autopilot` tool, so both always do exactly the same thing.
 *
 *  Honesty rules, as everywhere in this product: a change returns what it was BEFORE and what it is NOW (the confirmation names what actually moved); a part that could not
 *  be written is reported as not written, never as done; turning the chain on lists what is still missing for it to run end to end. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { callWhatsapp } from "@/lib/whatsapp-proxy";
import { loadAutopilotInputs, shapeAutopilot, type AutopilotInput } from "@/lib/chat-lead-tools";

export type AutopilotPatch = {
  /** The master switch: lead discovery + first messages + follow-ups + auto-replies, all together. */
  on?: boolean;
  leads_per_day?: number;
  /** Tenant-local "HH:MM" when the daily discovery runs. */
  run_time?: string;
  send_start?: number;
  send_end?: number;
  followups?: boolean;
  reminders?: boolean;
  daily_summary?: boolean;
  /** Auto-replies on their own (the master switch sets it too). */
  auto_replies?: boolean;
};

export type AutopilotSummary = {
  lead_discovery: { on: boolean; per_day: number | null; run_time: string | null; timezone: string | null };
  first_messages: boolean | null;
  followups: boolean | null;
  auto_replies: boolean | null;
  sending_hours: string | null;
  meeting_reminders: boolean | null;
  daily_summary: boolean | null;
};

/** Pure: the settings the customer can change, in the words they use. null = could not be read just now. */
export function summariseAutopilot(i: AutopilotInput): AutopilotSummary {
  const s = i.settings;
  const sch = i.leadSchedule;
  return {
    lead_discovery: { on: !!sch?.enabled, per_day: sch?.count ?? null, run_time: sch?.time_of_day ?? null, timezone: sch?.timezone ?? null },
    first_messages: s ? s.outbound_enabled !== false : null,
    followups: s ? s.followups_enabled !== false : null,
    auto_replies: i.whatsapp ? (typeof i.whatsapp.autoReply === "boolean" ? i.whatsapp.autoReply : null) : null,
    sending_hours: s ? `${s.send_start ?? 9}:00 to ${s.send_end ?? 21}:00` : null,
    meeting_reminders: s ? s.meeting_reminders !== false : null,
    daily_summary: s ? s.daily_summary !== false : null,
  };
}

/** Pure: validate a patch. Returns the cleaned patch, or the reason it is refused. Nothing is clamped silently into a different meaning: a number out of range is refused. */
export function cleanPatch(raw: Record<string, unknown>): { ok: true; patch: AutopilotPatch } | { ok: false; error: string } {
  const p: AutopilotPatch = {};
  const bool = (k: string) => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : undefined);
  const on = bool("on"); if (on !== undefined) p.on = on;
  const fu = bool("followups"); if (fu !== undefined) p.followups = fu;
  const rem = bool("reminders"); if (rem !== undefined) p.reminders = rem;
  const sum = bool("daily_summary"); if (sum !== undefined) p.daily_summary = sum;
  const ar = bool("auto_replies"); if (ar !== undefined) p.auto_replies = ar;
  if (raw.leads_per_day != null) {
    const n = Number(raw.leads_per_day);
    if (!Number.isInteger(n) || n < 1 || n > 50) return { ok: false, error: "Leads per day must be a whole number from 1 to 50." };
    p.leads_per_day = n;
  }
  if (raw.run_time != null) {
    const t = String(raw.run_time).trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return { ok: false, error: "The run time must be a 24-hour time like 09:30." };
    p.run_time = t;
  }
  for (const k of ["send_start", "send_end"] as const) {
    if (raw[k] != null) {
      const n = Number(raw[k]);
      if (!Number.isInteger(n) || n < 0 || n > 23) return { ok: false, error: "Sending hours must be whole hours from 0 to 23." };
      p[k] = n;
    }
  }
  if (p.send_start != null && p.send_end != null && p.send_start === p.send_end) return { ok: false, error: "The sending window cannot start and end at the same hour." };
  return { ok: true, patch: p };
}

/** Pure: the WhatsApp-engine part of a patch (what goes to the agent server's settings route). */
export function whatsappPart(p: AutopilotPatch): Record<string, unknown> {
  const w: Record<string, unknown> = {};
  if (p.on !== undefined) { w.auto_reply = p.on; w.outbound_enabled = p.on; w.followups_enabled = p.on; }
  if (p.auto_replies !== undefined) w.auto_reply = p.auto_replies;
  if (p.followups !== undefined) w.followups_enabled = p.followups;
  if (p.reminders !== undefined) w.meeting_reminders = p.reminders;
  if (p.daily_summary !== undefined) w.daily_summary = p.daily_summary;
  if (p.send_start !== undefined) w.send_start = p.send_start;
  if (p.send_end !== undefined) w.send_end = p.send_end;
  return w;
}

export type ApplyResult = { ok: boolean; before: AutopilotSummary; after: AutopilotSummary; not_saved: string[]; still_missing: string[]; verdict: string };

/** Apply a validated patch. Every part is attempted; a part that fails is listed in `not_saved` (never reported as done). `after` is RE-READ, not assumed. */
export async function applyAutopilot(supabase: SupabaseClient, tenantId: string, patch: AutopilotPatch): Promise<ApplyResult> {
  const beforeIn = await loadAutopilotInputs(supabase, tenantId);
  const before = summariseAutopilot(beforeIn);
  const not_saved: string[] = [];

  // 1 — the daily lead discovery (the `schedules` row of kind 'leads').
  if (patch.on !== undefined || patch.leads_per_day !== undefined || patch.run_time !== undefined) {
    try {
      const { data: row } = await supabase.from("schedules").select("*").eq("tenant_id", tenantId).eq("kind", "leads").maybeSingle();
      let tz: string = (row as any)?.timezone || "";
      if (!tz) {
        const { data: any1 } = await supabase.from("schedules").select("timezone").eq("tenant_id", tenantId).limit(1);
        tz = String((any1 as any)?.[0]?.timezone || "UTC");
      }
      const next = {
        tenant_id: tenantId,
        kind: "leads",
        enabled: patch.on !== undefined ? patch.on : !!(row as any)?.enabled,
        frequency: (row as any)?.frequency ?? "daily",
        day_of_week: (row as any)?.day_of_week ?? 0,
        time_of_day: patch.run_time ?? (row as any)?.time_of_day ?? "09:00",
        timezone: tz,
        count: patch.leads_per_day ?? (row as any)?.count ?? 10,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("schedules").upsert(next, { onConflict: "tenant_id,kind" });
      if (error) not_saved.push(`daily lead discovery (${error.message})`);
    } catch (e: any) {
      not_saved.push(`daily lead discovery (${e?.message ?? "error"})`);
    }
  }

  // 2 — the WhatsApp engine's switches and hours.
  const w = whatsappPart(patch);
  if (Object.keys(w).length) {
    const r: any = await callWhatsapp(tenantId, "settings", { method: "POST", body: w }).catch((e: any) => ({ ok: false, error: e?.message }));
    if (!r?.ok) not_saved.push(`WhatsApp settings (${r?.error ?? "the agent server did not answer"})`);
  }

  const afterIn = await loadAutopilotInputs(supabase, tenantId);
  const shape = shapeAutopilot(afterIn);
  const after = summariseAutopilot(afterIn);
  const verdict = not_saved.length
    ? `Part of this was NOT saved: ${not_saved.join("; ")}.`
    : patch.on === true
      ? shape.missing_for_end_to_end.length ? `Autopilot is switched on, but ${shape.missing_for_end_to_end.length} thing(s) still stop it running end to end.` : "Autopilot is on and everything it needs is connected."
      : patch.on === false ? "Autopilot is switched off: nothing is found, sent or answered automatically until it is switched on again." : "Saved.";
  return { ok: not_saved.length === 0, before, after, not_saved, still_missing: shape.missing_for_end_to_end, verdict };
}

/* ── The chat's write tool ─────────────────────────────────────────────────────────────────── */

import type { ChatTool } from "@/lib/chat-tools";

export const MANAGE_AUTOPILOT = "manage_autopilot";

export const AUTOPILOT_TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: MANAGE_AUTOPILOT,
      description:
        "SWITCH or TUNE the lead chain — find leads, message them on WhatsApp, follow up, answer replies, book calls, remind — as one: turn the whole autopilot on or off, " +
        "change how many leads are found per day, at what time discovery runs, the hours messages may be sent, and the follow-up / reminder / daily-summary / auto-reply switches. " +
        'Call this for "autopilot on karo", "sab kuch automatic chalu kar do", "leads ka kaam band kar do", "pause everything", "roz 20 leads dhundo", "subah 9 baje leads nikalna", ' +
        '"messages sirf 10 se 6 ke beech bhejo", "follow-up band karo", "activa el piloto automático", "turn off the daily summary". ' +
        "`action` is turn_on or turn_off for the master switch, or change for the other settings (give only the ones they named). " +
        'NOT for questions ("autopilot kaisa chal raha hai", "kya sab auto hai" are lookups: lookup_autopilot) and NOT for the article / audit timetable (that is manage_schedule). ' +
        "Turning OFF stops messages and auto-replies as well, so only do it when they clearly asked to stop everything; for one part, use change.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["turn_on", "turn_off", "change"], description: "turn_on / turn_off = the master switch for the whole chain; change = only the settings given below." },
          leads_per_day: { type: "number", description: "How many new leads to find per day, 1 to 50." },
          run_time: { type: "string", description: "24-hour time HH:MM (the customer's own time) when the daily discovery runs." },
          send_start: { type: "number", description: "First hour (0-23) messages may be sent." },
          send_end: { type: "number", description: "Hour (0-23) messages stop." },
          followups: { type: "boolean", description: "Follow-ups after 48 hours, 5 days and 7 days of silence." },
          reminders: { type: "boolean", description: "Meeting reminders to the customer and the team." },
          daily_summary: { type: "boolean", description: "The evening summary WhatsApp to the team." },
          auto_replies: { type: "boolean", description: "The assistant answering customer messages by itself." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

/** Run the tool. The result carries before / after / what was not saved / what is still missing, so the confirmation names what really moved. */
export async function runManageAutopilot(
  supabase: SupabaseClient,
  tenantId: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; tool: string; data?: unknown; note?: string }> {
  const a = { ...args } as Record<string, unknown>;
  if (a.action === "turn_on") a.on = true;
  else if (a.action === "turn_off") a.on = false;
  delete a.action;
  const cleaned = cleanPatch(a);
  if ("error" in cleaned) return { ok: false, tool: MANAGE_AUTOPILOT, note: cleaned.error };
  if (Object.keys(cleaned.patch).length === 0) return { ok: false, tool: MANAGE_AUTOPILOT, note: "Nothing to change was given: say whether to turn the autopilot on or off, or which setting to change." };
  const r = await applyAutopilot(supabase, tenantId, cleaned.patch);
  if (!r.ok && JSON.stringify(r.before) === JSON.stringify(r.after)) return { ok: false, tool: MANAGE_AUTOPILOT, note: r.verdict };
  return { ok: true, tool: MANAGE_AUTOPILOT, data: r };
}
