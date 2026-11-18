/** lib/meeting-outcome.ts — the owner tells MenCra what happened on a call; MenCra records it.
 *
 *  WHY. The system books a call and sees the time pass. It cannot see whether the lead joined (nothing reads Google Meet attendance), so "did the meeting happen?" can
 *  only be answered by the owner. Until 2026-11-19 a missed call was marked "done" whenever the lead wrote ANYTHING afterwards, and the assistant then told the owner the meeting
 *  "took place" when the lead had never joined. Now the sweep records only that the time passed, the lead is flagged for the owner with the question, and THIS tool records the
 *  answer: "he did not come" -> no-show, "he came" -> attended. The tool returns what the call was before and is now, so the confirmation names what actually changed. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatTool } from "@/lib/chat-tools";
import { matchLeads, selectLeads } from "@/lib/chat-lead-tools";

export const MANAGE_MEETING_OUTCOME = "manage_meeting_outcome";

export const MEETING_OUTCOME_TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: MANAGE_MEETING_OUTCOME,
      description:
        "RECORD what happened on a call with a lead, as the OWNER tells you: they joined, or they did not turn up. " +
        'Call this when the customer states the outcome: "sainiul meeting me aya nahi", "wo call pe nahi aaya", "no-show tha", "he did not join", "no vino a la llamada", ' +
        '"sainiul aaya tha, meeting ho gayi", "the call went well, he attended". `who` = the lead\'s name, company or number as the customer said it; `outcome` = attended or no_show. ' +
        'NOT for asking whether a call happened ("kya meeting hui thi?" is a lookup: lookup_lead_conversation) and NOT for booking or cancelling a call.',
      parameters: {
        type: "object",
        properties: {
          who: { type: "string", description: "The lead's name, company or phone number as the customer said it." },
          outcome: { type: "string", enum: ["attended", "no_show"], description: "attended = they joined; no_show = they did not turn up." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

export async function runManageMeetingOutcome(
  supabase: SupabaseClient,
  tenantId: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; tool: string; data?: unknown; note?: string }> {
  const who = String(args?.who ?? "").trim();
  const outcome = args?.outcome === "attended" || args?.outcome === "no_show" ? (args.outcome as "attended" | "no_show") : null;
  if (!outcome) return { ok: false, tool: MANAGE_MEETING_OUTCOME, note: "Say whether the lead joined the call or did not turn up." };
  if (!who) return { ok: false, tool: MANAGE_MEETING_OUTCOME, note: "Say which lead (a name, company or phone number)." };
  const leads = await selectLeads(supabase, tenantId, ["id, company, name, whatsapp, phone, stage", "id, company, name, whatsapp, phone, stage"]);
  const found = matchLeads(leads as any, who);
  if (found.length === 0) return { ok: false, tool: MANAGE_MEETING_OUTCOME, note: `No lead matches "${who}". Ask the customer to check the spelling or give the phone number.` };
  if (found.length > 1) return { ok: false, tool: MANAGE_MEETING_OUTCOME, note: `More than one lead matches "${who}": ${found.slice(0, 6).map((l: any) => l.company || l.name).join(", ")}. Ask which one.` };
  const lead: any = found[0];
  const { data: rows, error } = await supabase.from("lead_meetings").select("id, status, start_at, outcome").eq("tenant_id", tenantId).eq("lead_id", lead.id).neq("status", "cancelled").neq("status", "offered").order("created_at", { ascending: false }).limit(1);
  if (error) return { ok: false, tool: MANAGE_MEETING_OUTCOME, note: `The call record could not be read: ${error.message}` };
  const m: any = (rows ?? [])[0];
  if (!m) return { ok: false, tool: MANAGE_MEETING_OUTCOME, note: `${lead.company || lead.name} has no booked call on record, so there is nothing to mark.` };
  const before = { status: m.status, outcome: m.outcome ?? null, lead_stage: lead.stage };
  const now = new Date().toISOString();
  const upd = await supabase.from("lead_meetings").update({ status: outcome === "no_show" ? "no_show" : "done", outcome, updated_at: now }).eq("id", m.id).eq("tenant_id", tenantId);
  if (upd.error) return { ok: false, tool: MANAGE_MEETING_OUTCOME, note: `That did not save: ${upd.error.message}` };
  // The lead's stage follows the truth: a call that happened is "met"; a no-show goes back to being a conversation, flagged so a person offers a new time.
  const leadPatch: Record<string, unknown> = outcome === "attended"
    ? { stage: "meeting_done", needs_attention: false, needs_attention_reason: null, updated_at: now }
    : { stage: "in_conversation", needs_attention: true, needs_attention_reason: "Did not join the call. Offer them a new time.", updated_at: now };
  const lp = await supabase.from("leads").update(leadPatch).eq("id", lead.id).eq("tenant_id", tenantId);
  return {
    ok: true,
    tool: MANAGE_MEETING_OUTCOME,
    data: {
      lead: lead.company || lead.name,
      before,
      after: { status: outcome === "no_show" ? "no_show" : "done", outcome, lead_stage: leadPatch.stage },
      lead_updated: !lp.error,
      next_step: outcome === "no_show" ? "The lead is flagged for a new time. Ask the owner whether to offer them a new slot." : "Recorded as attended.",
    },
  };
}
