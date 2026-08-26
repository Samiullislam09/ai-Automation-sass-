// Side-effect import: forces Node to resolve IPv4 before IPv6. It belongs HERE, in the one
// module every server-side Supabase call already goes through, rather than being remembered
// file by file — which is how it came to be missing from the busiest endpoint in the app.
//
// The symptom, measured on /api/dashboard/live: the same request answered in 626ms and then
// in 42,665ms, with the phase log showing all of it inside the reads. That is the signature
// the fix was written for — a connection trying IPv6 first and sitting on a ~15-20s timeout
// before falling back — and instrumentation.ts, which is supposed to set this at boot, does
// not reliably run: this dev server never printed its line at all. A route that only works
// when some other route happened to be loaded first is not fixed, it is lucky.
import "@/lib/dns-fix";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-side Supabase client — for Server Components, Server Actions, Route Handlers.
 *  Uses the anon key + the request's cookies, so RLS still applies as the logged-in user. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // called from a Server Component render — middleware refreshes the session instead
          }
        },
      },
    }
  );
}
