import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Email-verification link and Google OAuth both land here with ?code=...
 *  Exchanges it for a session, then makes sure a tenant + membership row exists
 *  for this user (first-login bootstrap — Build Guide Step 3). */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const { data: existing } = await supabase
        .from("memberships")
        .select("tenant_id")
        .eq("user_id", data.user.id)
        .limit(1)
        .maybeSingle();

      if (!existing) {
        const { data: tenant, error: tenantErr } = await supabase
          .from("tenants")
          .insert({ name: data.user.email?.split("@")[0] ?? "My Business" })
          .select("id")
          .single();

        if (!tenantErr && tenant) {
          await supabase.from("memberships").insert({
            user_id: data.user.id,
            tenant_id: tenant.id,
            role: "owner",
          });
        }
      }

      return NextResponse.redirect(`${origin}/app`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
