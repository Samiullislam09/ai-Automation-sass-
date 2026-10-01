import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** A CRM stage change by a human — including THE APPROVAL GATE (migration 028).
 *
 *  This route still never sends anything. What changed on 2026-09-30 is what it records:
 *  `approved` is the one stage Mr. WhatsApp is allowed to pick up from, so this PATCH is the
 *  exact moment a human says "yes, message this specific lead". That is why approving stamps
 *  who and when — "why did my number message them?" must have a name and a time as its answer —
 *  and why the stages a human may SET is a shorter list than the stages that EXIST: sent /
 *  delivered / read / replied belong to the machine that observed them, and letting a PATCH
 *  claim them would make the log a story instead of a record.
 *
 *  `opted_out` sets the opt_out flag too, and nothing anywhere clears that flag — the sender
 *  re-checks it immediately before every send, so marking it here stops even a message already
 *  queued. */
const ALLOWED_STAGES = [
  "approved", // the gate: Mr. WhatsApp may now queue this lead
  "rejected", // the gate's no: kept for the record, never re-surfaced
  "contacted", // "I contacted this one myself, off-platform"
  "in_conversation",
  "interested",
  "won",
  "lost",
  "opted_out", // they asked to stop. Terminal, forever
] as const;

/** Why a human rejected a lead (high-quality-leads plan, Phase 6). Two of these feed back into
 *  discovery: competitor/wrong_industry add the lead's domain to the tenant's negative list so
 *  Gate A never surfaces it again. The rest are recorded for the metrics and the profile-
 *  suggestion card; none silently edits the confirmed buyer profile. */
const REJECT_REASONS = ["competitor", "wrong_industry", "wrong_city", "too_small", "too_large", "already_served", "duplicate", "other"] as const;
const FEEDBACK_TO_NEGATIVE = new Set(["competitor", "wrong_industry"]);

/** Append a domain to this tenant's lead negative list in agent_settings (merge, idempotent).
 *  Best-effort: a feedback-loop failure must never fail the reject the user asked for. */
async function addNegativeDomain(supabase: any, tenantId: string, domain: string) {
  const d = String(domain || "").trim().toLowerCase().replace(/^www\./, "");
  if (!d) return;
  try {
    const { data } = await supabase.from("agent_settings").select("settings").eq("tenant_id", tenantId).eq("agent", "leads").maybeSingle();
    const settings = (data?.settings && typeof data.settings === "object" ? data.settings : {}) as Record<string, any>;
    const list: string[] = Array.isArray(settings.negative_domains) ? settings.negative_domains : [];
    if (list.includes(d)) return;
    const next = { ...settings, negative_domains: [...list, d].slice(-2000) };
    await supabase.from("agent_settings").upsert(
      { tenant_id: tenantId, agent: "leads", settings: next, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,agent" },
    );
  } catch {
    // swallow — the reject itself already succeeded
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const stage = body?.stage;
  if (!ALLOWED_STAGES.includes(stage)) {
    return NextResponse.json({ ok: false, error: `stage must be one of: ${ALLOWED_STAGES.join(", ")}` }, { status: 400 });
  }

  // The reject reason (Phase 6). Validated, stored on the row, and — for competitor/wrong_industry
  // — fed back into the negative list. Optional, so an old client that sends no reason still works.
  const rejectReason = REJECT_REASONS.includes(body?.reject_reason) ? body.reject_reason : null;

  const patch: Record<string, unknown> = { stage, updated_at: new Date().toISOString() };
  if (stage === "approved") {
    const { data: u } = await supabase.auth.getUser();
    patch.approved_at = new Date().toISOString();
    patch.approved_by = u?.user?.id ?? null;
  } else if (stage === "rejected") {
    patch.rejected_at = new Date().toISOString();
    if (rejectReason) patch.reject_reason = rejectReason;
  } else if (stage === "opted_out") {
    patch.opt_out = true;
    patch.opt_out_at = new Date().toISOString();
  }

  let error = (await supabase.from("leads").update(patch).eq("id", id).eq("tenant_id", tenantId)).error;
  // If reject_reason isn't a column yet (pre-030), retry without it rather than fail the reject.
  if (error && /reject_reason/i.test(error.message)) {
    delete patch.reject_reason;
    error = (await supabase.from("leads").update(patch).eq("id", id).eq("tenant_id", tenantId)).error;
  }
  if (error) {
    const hint = /leads_stage_check|violates check/i.test(error.message)
      ? " (has supabase/migrations/028_outreach_crm.sql been applied?)"
      : "";
    return NextResponse.json({ ok: false, error: error.message + hint }, { status: 500 });
  }

  // Feedback loop: a competitor / wrong-industry reject teaches Gate A not to surface that domain.
  if (stage === "rejected" && rejectReason && FEEDBACK_TO_NEGATIVE.has(rejectReason)) {
    const { data: lead } = await supabase.from("leads").select("domain, website").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    const dom = lead?.domain || (lead?.website ? String(lead.website).replace(/^https?:\/\/(www\.)?/i, "").replace(/[/:?#].*$/, "") : "");
    if (dom) await addNegativeDomain(supabase, tenantId, dom);
  }

  return NextResponse.json({ ok: true });
}
