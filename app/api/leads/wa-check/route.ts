import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";
import { applyWaResults, planWaCheck, type LeadWaRow } from "@/lib/phone-wa";

/** POST /api/leads/wa-check  { ids: string[] }  ->  { statuses: { "<leadId>": "yes" | "no" | null } }
 *
 *  Which of these leads are on WhatsApp. The Leads page uses it to show the WhatsApp button only where
 *  it can work. Order of evidence, strongest first:
 *   1. the lead's own site published a wa.me number            -> "yes" (no question asked)
 *   2. an answer already stored on the lead (wa_status)         -> reused, WhatsApp is not asked again
 *      (a "no" is re-checked after 30 days; a "yes" is kept)
 *   3. a toll-free / premium-rate / shared-cost line            -> "no", decided offline
 *   4. the number made international with the lead's country    -> asked of WhatsApp itself, one batch
 *   5. anything else (no country, WhatsApp not connected)       -> null: "cannot tell", and the page
 *                                                                   keeps the button
 *  Definite answers (yes / no) are written back to the lead, so the next visit does not depend on WhatsApp
 *  being connected. If migration 038 is not applied the answers are still returned, just not stored. */

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, 60) : [];
  if (!ids.length) return NextResponse.json({ ok: true, statuses: {}, stored: true });

  let stored = true;
  let { data, error } = await supabase.from("leads").select("id, phone, whatsapp, country, stage, replied_at, wa_status, wa_checked_at").eq("tenant_id", tenantId).in("id", ids);
  if (error && /wa_status|wa_checked_at|column .* does not exist/i.test(error.message)) {
    stored = false; // migration 038 not applied yet: answer anyway, just cannot remember it
    ({ data, error } = (await supabase.from("leads").select("id, phone, whatsapp, country, stage, replied_at").eq("tenant_id", tenantId).in("id", ids)) as any);
  }
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let plan = planWaCheck((data ?? []) as LeadWaRow[], { stored });
  if (plan.ask.size) {
    const w = await callWhatsapp(tenantId, "check", { method: "POST", body: { phones: Array.from(plan.ask.keys()) } });
    plan = applyWaResults(plan, ((w.ok ? w.results : undefined) as Record<string, boolean | null> | undefined) ?? {});
  }
  const { statuses, toStore } = plan;

  if (stored && Object.keys(toStore).length) {
    const at = new Date().toISOString();
    await Promise.all(Object.entries(toStore).map(([id, wa_status]) =>
      supabase.from("leads").update({ wa_status, wa_checked_at: at }).eq("id", id).eq("tenant_id", tenantId)
    ));
  }
  return NextResponse.json({ ok: true, statuses, stored });
}
