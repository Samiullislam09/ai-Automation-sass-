import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Real, DB-backed picture of "what does the team actually know/have connected" —
 *  the tenant's crawled niche/topics, connected integrations (sanitized, no secrets),
 *  and how many site pages were actually indexed. Powers the Memory page's "What we've
 *  connected" / "What we've learned from your site" sections. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const [{ data: tenant }, { data: integrations }, { count: pagesIndexed }, { data: samplePages }] = await Promise.all([
    supabase.from("tenants").select("website_url, niche, tone_profile, onboarded").eq("id", tenantId).single(),
    supabase.from("integrations").select("type, status, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    supabase.from("site_pages").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("site_pages").select("title, url").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(8),
  ]);

  return NextResponse.json({
    ok: true,
    tenant: {
      websiteUrl: tenant?.website_url ?? null,
      niche: tenant?.niche ?? null,
      topics: (tenant?.tone_profile as any)?.topics ?? [],
      onboarded: !!tenant?.onboarded,
    },
    integrations: (integrations ?? []).map((i) => ({ type: i.type, status: i.status, connectedAt: i.created_at })),
    crawl: { pagesIndexed: pagesIndexed ?? 0, samplePages: samplePages ?? [] },
  });
}
