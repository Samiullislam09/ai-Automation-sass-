import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./admin";

/** Looks up the current user's tenant_id via their membership row. Self-healing: if a
 *  signed-in user somehow has no tenant/membership yet (e.g. they logged in via a path
 *  that predates the auto-bootstrap in app/auth/callback/route.ts), creates one on the
 *  spot instead of failing — every authenticated user should always resolve to a tenant.
 *
 *  THE LOOKUP AND THE BOOTSTRAP BOTH RUN ON THE ADMIN (service-role) CLIENT, NOT THE
 *  CALLER'S RLS-SCOPED ONE. Found live on a freshly created Supabase project (2026-09-06):
 *  a real, valid, unexpired, `role: authenticated` session — confirmed by `auth.getUser()`
 *  succeeding one line above — still had its `tenants` insert rejected with "new row
 *  violates row-level security policy for table tenants", even though that policy is only
 *  `auth.role() = 'authenticated'`. Whatever the project-level cause (PostgREST not
 *  resolving the JWT the same way the Auth server does), a brand-new user's very first
 *  write — the one action every other feature in the product depends on — must not be the
 *  one place a platform-level RLS quirk leaves them permanently signed in with no tenant.
 *  The membership SELECT is moved alongside it for the same reason: it is gated by the
 *  same `is_tenant_member()` → `auth.uid()` chain, so if the insert side is unreliable
 *  there is no reason to trust the read side either. Every OTHER tenant-scoped query in the
 *  app still goes through the caller's normal RLS-scoped client — this is the one lookup
 *  that is inherently self-scoped already (explicitly filtered to the caller's own
 *  `userData.user.id`), so running it with elevated privileges gives up no real isolation. */
export async function getCurrentTenantId(supabase: SupabaseClient): Promise<string | null> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) console.error("[getCurrentTenantId] auth.getUser() error:", userErr.message);
  if (!userData.user) return null;

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("memberships")
    .select("tenant_id")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();

  if (membership?.tenant_id) return membership.tenant_id;

  // No membership yet — bootstrap one now.
  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .insert({ name: userData.user.email?.split("@")[0] ?? "My Business" })
    .select("id")
    .single();

  if (tenantErr || !tenant) {
    console.error("[getCurrentTenantId] tenant bootstrap failed:", tenantErr?.message);
    return null;
  }

  const { error: memErr } = await admin.from("memberships").insert({
    user_id: userData.user.id,
    tenant_id: tenant.id,
    role: "owner",
  });
  if (memErr) console.error("[getCurrentTenantId] membership bootstrap failed:", memErr.message);

  return tenant.id;
}
