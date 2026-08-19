import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/** Service-role client — the agent-server runs with no user session, so it always
 *  needs to bypass RLS (it's trusted server-side infrastructure, not a user). */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
