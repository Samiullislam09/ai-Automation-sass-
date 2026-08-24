import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { getDailyUsage } from "@/lib/agent-caps";

/** Everything the account menu shows, in one call.
 *
 *  There was nowhere in the product to answer "which plan am I on?": the plan card lived in
 *  the sidebar, which is collapsed by default, and the avatar in the topbar did nothing. And
 *  the plan the UI did show came from localStorage, so it could disagree with the plan
 *  agent-server was actually rationing by.
 *
 *  Everything here is read from the database and from agent-server's own cap table — the same
 *  values that decide whether a job runs. */

// The three agents whose allowance a human actually feels. Mr. QA and Mr. Publish are stages
// inside the writer job, so they have no cap of their own to report.
const SHOWN = [
  { agent: "writer", label: "Articles written" },
  { agent: "boss", label: "Planning runs" },
  { agent: "keyword", label: "Keyword research" },
];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "No workspace yet." }, { status: 401 });

  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("name, website_url, plan, onboarded")
    .eq("id", tenantId)
    .single();

  const [usage, { count: connected }, { count: awaiting }] = await Promise.all([
    Promise.all(
      SHOWN.map(async (s) => ({ ...s, ...(await getDailyUsage(supabase, tenantId, s.agent).catch(() => null)) }))
    ),
    supabase.from("integrations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "connected"),
    supabase.from("content_items").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "awaiting_approval"),
  ]);

  return NextResponse.json({
    ok: true,
    email: user.email ?? null,
    workspace: tenant?.name ?? null,
    website: tenant?.website_url ?? null,
    onboarded: !!tenant?.onboarded,
    // Before migration 009 there is no plan column; don't guess a tier at the user.
    plan: tenantErr ? null : (tenant?.plan ?? "free"),
    usage: usage.filter((u) => u && "used" in u),
    connected: connected ?? 0,
    awaiting: awaiting ?? 0,
  });
}
