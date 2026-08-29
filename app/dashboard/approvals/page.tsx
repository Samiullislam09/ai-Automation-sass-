import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import ApprovalsSection from "@/components/dashboard/ApprovalsSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Approvals — MrLxwa" };

export default async function DashboardApprovalsPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <ApprovalsSection />
    </MrLxwaDashboard>
  );
}
