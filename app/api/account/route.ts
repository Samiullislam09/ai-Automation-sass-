import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Everything the account menu shows, minus today's usage.
 *
 *  There was nowhere in the product to answer "which plan am I on?": the plan card lived in
 *  the sidebar, which is collapsed by default, and the avatar in the topbar did nothing. And
 *  the plan the UI did show came from localStorage, so it could disagree with the plan
 *  agent-server was actually rationing by.
 *
 *  Every field here is a local Supabase read — no call to agent-server, on purpose. Today's
 *  per-agent usage needs agent-server's own cap table (a real network hop that measured
 *  ~1.1-1.2s even warm — see app/api/account/usage/route.ts's header), and bundling it in here
 *  meant this whole panel waited on a remote service for data that is otherwise instant. That
 *  route is now its own thing; the client fetches both in parallel and renders this one first. */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

    const tenantId = await getCurrentTenantId(supabase);
    if (!tenantId) return NextResponse.json({ ok: false, error: "No workspace yet." }, { status: 401 });

    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .select("name, website_url, niche, icp_profile, plan, onboarded, created_at")
      .eq("id", tenantId)
      .single();

    const [{ count: connected }, { count: awaiting }, membership] = await Promise.all([
      supabase.from("integrations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "connected"),
      supabase.from("content_items").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "awaiting_approval"),
      supabase.from("memberships").select("role").eq("tenant_id", tenantId).eq("user_id", user.id).maybeSingle(),
    ]);

    return NextResponse.json({
      ok: true,
      email: user.email ?? null,
      memberSince: user.created_at ?? null,
      role: membership.data?.role ?? null,
      workspace: tenant?.name ?? null,
      website: tenant?.website_url ?? null,
      // icp_profile is written by onboarding (see components/OnboardingWizard.tsx's finish()) —
      // {businessType} is the only key it reliably has; niche is Mr. Analyst's own free-text read
      // of the site, so it's the more specific of the two when both exist.
      businessType: (tenant?.icp_profile as any)?.businessType ?? tenant?.niche ?? null,
      tenantCreatedAt: tenant?.created_at ?? null,
      onboarded: !!tenant?.onboarded,
      // Before migration 009 there is no plan column; don't guess a tier at the user.
      plan: tenantErr ? null : (tenant?.plan ?? "free"),
      connected: connected ?? 0,
      awaiting: awaiting ?? 0,
    });
  } catch (e: any) {
    // A thrown exception here (a transient Supabase/network blip, getCurrentTenantId's admin
    // client hiccuping, anything unexpected) used to surface as a non-JSON 500 page. The
    // sidebar's `fetch(...).then(r => r.json())` then threw on the parse, landing in its own
    // catch and showing "Couldn't load your account." with no real error behind it and no way
    // to tell a genuine outage from a one-off blip (owner report 2026-09-09: "baar baar aata
    // hai"). Always answering with real JSON — even for a failure — is what lets a future retry
    // (or just refreshing) actually recover instead of repeating the same opaque crash.
    console.error("[api/account] unexpected error:", e?.message ?? e);
    return NextResponse.json({ ok: false, error: "Could not load your account — please try again." }, { status: 500 });
  }
}
