import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** The tenant's plan, in the database rather than in one browser's localStorage.
 *
 *  agent-server reads `tenants.plan` to decide the daily allowance (see
 *  agent-server/src/config/caps.ts), so a plan that only exists client-side meant every
 *  customer — paying or not — was rationed identically. That's what this fixes.
 *
 *  ⚠️ SELF-SERVE WRITE. Today the billing page is a mock: it takes no payment and grants the
 *  plan on a click (app/app/billing/page.tsx). Persisting that is no weaker than the mock it
 *  replaces, but the moment real payments exist this route MUST NOT be the thing that grants
 *  a plan — the payment webhook must. So it refuses as soon as a billing provider is
 *  configured, instead of quietly becoming a free-upgrade endpoint nobody remembered.
 */

const PLANS = ["free", "starter", "growth"];

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase.from("tenants").select("plan, daily_cap_overrides").eq("id", tenantId).single();
  if (error) {
    // Migration 009 not applied yet — say so rather than reporting a plan that isn't stored.
    return NextResponse.json({ ok: true, plan: null, needsMigration: /plan|column/i.test(error.message) });
  }
  return NextResponse.json({ ok: true, plan: (data as any)?.plan ?? "free", overrides: (data as any)?.daily_cap_overrides ?? {} });
}

export async function POST(request: NextRequest) {
  if (process.env.BILLING_PROVIDER) {
    return NextResponse.json(
      { ok: false, error: "Plan changes must come from the payment webhook now that billing is configured." },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { plan } = await request.json().catch(() => ({} as any));
  if (!PLANS.includes(plan)) return NextResponse.json({ ok: false, error: `Unknown plan: ${plan}` }, { status: 400 });

  const { error } = await supabase.from("tenants").update({ plan }).eq("id", tenantId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, plan });
}
