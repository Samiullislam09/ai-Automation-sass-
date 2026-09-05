import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Email-verification link and Google OAuth both land here with ?code=...
 *  Exchanges it for a session, then makes sure a tenant + membership row exists
 *  for this user (first-login bootstrap — Build Guide Step 3).
 *
 *  The tenant/membership bootstrap itself is `getCurrentTenantId`'s job, not duplicated
 *  here — this route used to run its own copy of the same insert-if-missing logic on the
 *  caller's own (RLS-scoped) client, silently swallowing the result either way (no error
 *  was ever logged, and the redirect to /app happened whether or not the bootstrap actually
 *  worked). That is how a genuine RLS failure on a fresh Supabase project went unnoticed:
 *  the user landed on a working-looking dashboard with no tenant behind it at all. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const tenantId = await getCurrentTenantId(supabase);
      if (!tenantId) console.error("[auth/callback] signed in but no tenant could be resolved for this user");
      return NextResponse.redirect(`${origin}/app`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
