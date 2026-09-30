import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Real `leads` table — written by agent-server's Mr. Lead (agents/leads.ts) as a row per
 *  qualified lead, stage "draft": researched, scored and a message written, nothing sent.
 *  This is the page that agent's own comments call "the Leads page's Approve button" — it
 *  never existed until now. `select("*")` rather than a fixed column list because the richer
 *  outreach columns (website, domain, draft, channel, observation, evidence) only exist once
 *  `agents/leads.ts`'s probe has found them on this database — a fixed select would 500 on a
 *  database that hasn't run that migration yet. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const stage = req.nextUrl.searchParams.get("stage") || "all";
  let query = supabase
    .from("leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (stage !== "all") query = query.eq("stage", stage);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: data });
}

/** Manually add a lead — from the Leads page's "Add lead" form, or from the WhatsApp page's
 *  "New chat" (a number the user wants to message directly). A manually added lead is `approved`
 *  from the start: the human chose to add it, which IS the approval the gate exists to capture,
 *  so it can be messaged straight away without a second click. Source is "manual" so it is
 *  distinguishable from what Mr. Lead discovered. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const company = String(b?.company ?? "").trim();
  const phone = String(b?.phone ?? b?.whatsapp ?? "").trim();
  const name = String(b?.name ?? "").trim();
  if (!company && !name) return NextResponse.json({ ok: false, error: "A company or contact name is required." }, { status: 400 });
  if (!phone) return NextResponse.json({ ok: false, error: "A phone number is required to message them." }, { status: 400 });

  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    company: company || null,
    name: name || null,
    phone,
    whatsapp: phone,
    website: String(b?.website ?? "").trim() || null,
    city: String(b?.city ?? "").trim() || null,
    source: "manual",
    stage: "approved",
    approved_at: new Date().toISOString(),
    reason: "Added manually.",
  };

  const { data, error } = await supabase.from("leads").insert(row).select("id").maybeSingle();
  if (error) {
    const hint = /column .* does not exist|leads_stage_check/i.test(error.message)
      ? " (has supabase/migrations/028_outreach_crm.sql been applied?)"
      : "";
    return NextResponse.json({ ok: false, error: error.message + hint }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data?.id });
}
