import type { SupabaseClient } from "@supabase/supabase-js";

/** Looks up the current user's tenant_id via their membership row. Self-healing: if a
 *  signed-in user somehow has no tenant/membership yet (e.g. they logged in via a path
 *  that predates the auto-bootstrap in app/auth/callback/route.ts), creates one on the
 *  spot instead of failing — every authenticated user should always resolve to a tenant. */
export async function getCurrentTenantId(supabase: SupabaseClient): Promise<string | null> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) console.error("[getCurrentTenantId] auth.getUser() error:", userErr.message);
  if (!userData.user) return null;

  const { data: membership } = await supabase
    .from("memberships")
    .select("tenant_id")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();

  if (membership?.tenant_id) return membership.tenant_id;

  // No membership yet — bootstrap one now.
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .insert({ name: userData.user.email?.split("@")[0] ?? "My Business" })
    .select("id")
    .single();

  if (tenantErr || !tenant) {
    console.error("[getCurrentTenantId] tenant bootstrap failed:", tenantErr?.message);
    return null;
  }

  const { error: memErr } = await supabase.from("memberships").insert({
    user_id: userData.user.id,
    tenant_id: tenant.id,
    role: "owner",
  });
  if (memErr) console.error("[getCurrentTenantId] membership bootstrap failed:", memErr.message);

  return tenant.id;
}
