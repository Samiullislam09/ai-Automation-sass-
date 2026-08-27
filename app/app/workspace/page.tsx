import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import Workspace from "@/components/Workspace";

/** The Agent Workspace (MASTER_PLAN §24.4b).
 *
 *  The tenant id is resolved here, on the server, and handed down as a prop. Two reasons, and
 *  neither is style: the browser must not have to ask "who am I?" before it can subscribe (a
 *  round trip in front of a screen whose whole point is immediacy), and the id is what names
 *  the Realtime channel — `tenant:{id}:live`. Deriving it from an authenticated server session
 *  means a client can never subscribe to a channel by guessing at an id. RLS on `tasks`,
 *  `task_steps` and `task_events` (migration 017) is the second lock behind it.
 *
 *  Dynamic because the answer is per-user; there is nothing here to cache. */
export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return <Workspace tenantId={tenantId} />;
}
