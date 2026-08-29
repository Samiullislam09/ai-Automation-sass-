import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import WorkspaceSection from "@/components/dashboard/WorkspaceSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Office (Agents) — MrLxwa" };
export const dynamic = "force-dynamic";

export default async function DashboardWorkspacePage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <WorkspaceSection tenantId={tenantId} />
    </MrLxwaDashboard>
  );
}
