import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { exchangeCode, loadGoogle, packCreds, saveGoogle } from "@/lib/google";

/** Step 2 — Google sends the user back here with ?code=. Swap it for a refresh token,
 *  store it encrypted, and drop the user back on /app/connect where they pick which
 *  property/site to read. */
export async function GET(request: NextRequest) {
  const back = (status: string) => NextResponse.redirect(new URL(`/app/connect?google=${status}`, request.url));

  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.redirect(new URL("/login", request.url));

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back(params.get("error") === "access_denied" ? "denied" : "error");

  const state = params.get("state");
  const cookieState = request.cookies.get("g_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) return back("bad_state");

  const code = params.get("code");
  if (!code) return back("error");

  try {
    const token = await exchangeCode(code, request.nextUrl.origin);
    if (!token.refresh_token) {
      // Happens when the account already authorised this app and Google decided not to
      // re-issue one. Revoking at myaccount.google.com/permissions and retrying fixes it.
      return back("no_refresh_token");
    }

    // Keep whichever property/site was already chosen, so re-consenting (e.g. to add
    // Business Profile) doesn't silently reset the selection and stop the daily sync.
    const existing = await loadGoogle(supabase, tenantId);
    const email = readEmailFromIdToken(token.id_token);
    const scopes = (token.scope ?? "").split(" ").filter(Boolean);

    await saveGoogle(supabase, tenantId, packCreds(token.refresh_token, scopes, email, existing ?? undefined));

    const res = back("connected");
    res.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e: any) {
    console.error("[google/callback] token exchange failed:", e?.message);
    return back("error");
  }
}

/** The id_token is a JWT from Google over TLS in a request we initiated, and it is used
 *  only to label the connection ("connected as you@business.com") — so the payload is read
 *  without signature verification rather than pulling in a JWKS client for a display string.
 *  Nothing is authorised on the strength of it. */
function readEmailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf8"));
    return typeof payload?.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
