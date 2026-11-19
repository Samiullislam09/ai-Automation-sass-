import type { SupabaseClient } from "@supabase/supabase-js";

/** Who is signed in, WITHOUT a round trip to Supabase Auth.
 *
 *  `auth.getUser()` asks the Auth server on every call. It was in the middleware, the dashboard layout and ~70 API routes, so one page open paid for ~8 of them (100-300 ms
 *  each, more when the function and the project are on different continents). `getClaims()` verifies the session's JWT locally against the project's published signing key
 *  (ES256, cached) and only calls the server when the token must be refreshed. It also refreshes an expired session, so the cookie handling in middleware.ts is unchanged.
 *
 *  What it gives up: a session revoked on the server (sign-out everywhere, a deleted user) keeps working until its access token expires (default 1 hour). Anything that
 *  must see revocation at once (account deletion, changing a password) should still call getUser() itself.
 *
 *  Safe by construction: if getClaims() fails or returns nothing usable, this falls back to getUser(), so the worst case is the old behaviour, never a wrongly signed-in user. */
export type AuthedUser = { id: string; email: string | null };

export async function authUser(supabase: SupabaseClient): Promise<AuthedUser | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = (data as any)?.claims?.sub;
    if (!error && typeof sub === "string" && sub) return { id: sub, email: typeof (data as any).claims.email === "string" ? (data as any).claims.email : null };
  } catch {
    /* fall through to the server check */
  }
  const { data } = await supabase.auth.getUser();
  return data?.user ? { id: data.user.id, email: data.user.email ?? null } : null;
}
