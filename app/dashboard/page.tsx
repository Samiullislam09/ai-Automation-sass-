import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Dashboard — MrLxwa" };

/** The real dashboard, approved 2026-08-29 to replace /app (app/app/page.tsx, renamed to
 *  page.tsx.outdated — unrouted, kept for reference, not deleted). Deliberately a top-level
 *  route, NOT under app/app/**: that route group's layout.tsx wraps every page in <AppShell>,
 *  which already renders its own sidebar/topbar/chat; MrLxwaDashboard is a full standalone
 *  page shell with its own sidebar/topbar/assistant panel, and the two would nest inside
 *  each other.
 *
 *  Real, wired 2026-08-29: the Assistant chat panel (/api/chat, same backend as production's
 *  BossChat) and the agent network's per-agent status, resolved here server-side (same
 *  tenantId pattern as app/app/workspace/page.tsx → components/Workspace.tsx) and handed
 *  down as a prop — MrLxwaDashboard's own useLiveEvents(tenantId) call reads the same
 *  Realtime task/step feed Workspace already uses.
 *
 *  No auth/onboarding gate here yet (app/app/layout.tsx's redirect logic) — this is running
 *  local-only for now, per the owner ("abhi hum local pe hain"). A null tenantId (not signed
 *  in) still renders — chat/status just stay honestly empty/idle rather than fake. Add the
 *  redirect gate before this is meant to be reachable by real signed-out visitors. */
export default async function DashboardPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return <MrLxwaDashboard tenantId={tenantId} />;
}
