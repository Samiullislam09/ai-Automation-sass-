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

  const patch: Record<string, unknown> = { stage, updated_at: new Date().toISOString() };
  if (stage === "approved") {
    const { data: u } = await supabase.auth.getUser();
    patch.approved_at = new Date().toISOString();
    patch.approved_by = u?.user?.id ?? null;
  } else if (stage === "rejected") {
    patch.rejected_at = new Date().toISOString();
  } else if (stage === "opted_out") {
    patch.opt_out = true;
    patch.opt_out_at = new Date().toISOString();
  }

  const { error } = await supabase.from("leads").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (error) {
    // A database still on the pre-028 stage vocabulary rejects the new names via its check
    // constraint. Saying which migration beats a bare constraint name six ways.
    const hint = /leads_stage_check|violates check/i.test(error.message)
      ? " (has supabase/migrations/028_outreach_crm.sql been applied?)"
      : "";
    return NextResponse.json({ ok: false, error: error.message + hint }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
