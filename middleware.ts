import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
// NOTE: do NOT import lib/dns-fix here — middleware runs in the Edge runtime, which
// doesn't support Node's `dns` module at all (this broke every guarded request when
// tried). The dns-fix is only safe in normal Node.js routes (app/api/*/route.ts).

/** Guards /app/** server-side — replaces the old 350ms client-side redirect.
 *  Also refreshes the Supabase session cookie on every request. */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // An EMPTY value means "drop this cookie", and it has to be dropped, not stored as
          // an empty string. Supabase splits its session across numbered chunks
          // (sb-...-auth-token.0, .1, ...); when a refreshed token needs fewer chunks than the
          // old one, the leftovers arrive here with value "". Writing them back as empty
          // cookies left the page reassembling a token out of one real chunk and one blank
          // one — corrupt, so auth.getUser() found nobody.
          //
          // Every Server Component under /app was affected, which until now was only the
          // layout (where a null tenant silently skipped the onboarding check, so nobody
          // noticed) and then the article reviewer, which rendered "no workspace" over and
          // over while the same request's Route Handlers were perfectly authenticated.
          cookiesToSet.forEach(({ name, value }) => {
            if (value === "") request.cookies.delete(name);
            else request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            if (value === "") response.cookies.set(name, "", { ...options, maxAge: 0 });
            else response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Only page routes redirect to /login on no-session — API routes under this matcher
  // (onboarding/dashboard) still get their cookies refreshed, but return their own JSON
  // 401 instead (a redirect would hand the client's fetch() an HTML login page).
  const guarded = request.nextUrl.pathname.startsWith("/app") || request.nextUrl.pathname === "/onboarding";

  // A network hiccup reaching Supabase must NOT look like "not logged in" — that was
  // force-logging out real, still-valid sessions. Only redirect on a genuine no-session
  // result; on a transient fetch/network error, fail open and let the request through
  // (the page's own client-side data fetching will retry and sort itself out).
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user && guarded) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      const redirectRes = NextResponse.redirect(url);
      // Carry over whatever getUser() just wrote (e.g. the clearing of a dead session).
      // Returning a bare redirect threw those away, so the stale cookie survived and the
      // very next request repeated the same round trip.
      response.cookies.getAll().forEach((c) => redirectRes.cookies.set(c));
      return redirectRes;
    }
  } catch (err) {
    console.error("[middleware] auth.getUser() network error, failing open:", (err as Error).message);
  }

  return response;
}

// Narrowly scoped to routes that actually need an auth check or a refreshed session
// cookie. Public/unauthenticated routes (/, /login, /api/chat, /connect/nextjs, the
// WordPress/webhook test-connection endpoints, ...) are deliberately NOT matched here —
// running Supabase's auth.getUser() on every single request (including chat) was adding
// several extra seconds of latency to routes that don't need a session check at all.
// NOTE: /api/dashboard/** is deliberately NOT matched. The dashboard is polled every 3s
// (components/LiveAgents.tsx), and running auth.getUser() here on each of those meant ~20
// server-side token refreshes a minute racing the browser client's own refresh — a known
// way to invalidate a rotating refresh token and log a live user out. Those routes already
// authenticate themselves (createClient + getCurrentTenantId, 401 on no session) and, being
// route handlers, can write the refreshed cookie on their own.
export const config = {
  matcher: ["/app/:path*", "/onboarding", "/api/onboarding/:path*"],
};
