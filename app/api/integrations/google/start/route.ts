import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { consentUrl, googleConfigured } from "@/lib/google";

/** Step 1 of the Google connect — bounce the user to Google's consent screen.
 *  Business Profile's scope is only requested when asked for (?gbp=1): it is the one scope
 *  Google gates behind a manual access request, and dragging it into every connection would
 *  block Analytics + Search Console on an approval nobody needs yet. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.redirect(new URL("/login", request.url));

  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/app/connect?google=not_configured", request.url));
  }

  // CSRF: the value goes to Google and comes back in the query string; the copy in this
  // httpOnly cookie is what proves the round trip started here.
  const state = crypto.randomBytes(24).toString("hex");
  const includeGbp = request.nextUrl.searchParams.get("gbp") === "1";

  const res = NextResponse.redirect(consentUrl(request.nextUrl.origin, state, includeGbp));
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax", // must survive the redirect back from accounts.google.com
    path: "/",
    maxAge: 600,
  });
  return res;
}
