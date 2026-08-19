import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Admin client — SERVICE ROLE key, bypasses RLS entirely.
 *  Server-only (route handlers / server actions / agent-server). NEVER import this from a
 *  Client Component and never expose SUPABASE_SERVICE_ROLE_KEY to the browser. */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
