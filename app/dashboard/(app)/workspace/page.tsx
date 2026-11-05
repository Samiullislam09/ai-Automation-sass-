import type { Metadata } from "next";
import WorkspaceSection from "@/components/dashboard/WorkspaceSection";
import { getRequestContext } from "@/lib/supabase/request";

export const metadata: Metadata = { title: "Office (Agents) — MrLxwa" };
export const dynamic = "force-dynamic";

export default async function DashboardWorkspacePage() {
  const { tenantId } = await getRequestContext();
  return (
    <>
      <WorkspaceSection tenantId={tenantId} />
    </>
  );
}
