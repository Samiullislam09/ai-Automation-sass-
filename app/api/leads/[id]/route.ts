import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** A CRM-style status change only — "I contacted this one myself", "don't contact this one",
 *  "not now". §7.6's compliance rule (outreach *sending* is Phase 3+, always after approval)
 *  means this route never sends anything; it only records what the owner already did or
 *  decided off-platform. There is no "send" here and there should not be one until that phase. */
const ALLOWED_STAGES = ["draft", "contacted", "do_not_contact", "skipped"] as const;

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

  const { error } = await supabase.from("leads").update({ stage }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
